---
title: "A routine ScyllaDB OS upgrade and one slow disk broke Discord logins"
dek: "Discord upgraded its ScyllaDB clusters one zone at a time, which a quorum-replicated cluster is designed to survive. On the small authentication cluster, one zone down plus one degraded disk plus cold caches plus client retries was enough to take availability to about 25%."
date: 2023-11-06
company: Discord
kind: outage
topics: [database, capacity, hardware, cascading-failure]
stack: [scylladb, rust, raid, nvme]
duration_min: 50
impact: "Discord's authentication service went down for about 50 minutes, preventing users from connecting, logging in, or reading and sending messages."
rule: "Tolerating the loss of one zone means nothing left in the remaining zones may be degraded. Before taking a zone down on purpose, check the health of everything you are about to depend on, including disks and cache warmth."
postmortem: https://discord.com/blog/authentication-outage
sources: [https://discord.com/blog/authentication-outage]
---

# A routine ScyllaDB OS upgrade and one slow disk broke Discord logins

On 6 November 2023, [beginning at 10:52 AM PST and lasting for approximately 50 minutes](https://discord.com/blog/authentication-outage), Discord's authentication service went down. Users could not connect, log in, or read and send messages. Discord's availability, measured as the share of HTTP requests returning a 2xx response, [dropped to approximately 25%](https://discord.com/blog/authentication-outage) the moment the trigger fired. That figure is where the postmortem's title, "25% or 6 to 4", comes from.

Nobody attacked anything and no data was wrong. Discord says the outage affected [availability only, not the correctness of authentication results](https://discord.com/blog/authentication-outage), and was not caused by external actors.

The trigger was a planned operating-system upgrade on a ScyllaDB cluster, done zone by zone, a procedure that had already run on [over a hundred nodes](https://discord.com/blog/authentication-outage) without trouble. What made this cluster different was its size, the state of one disk in another zone, and how cold its caches were.

## What happened

All times are PST, from the [postmortem](https://discord.com/blog/authentication-outage).

- **3 November onward.** The persistence infrastructure team begins upgrading the OS on Discord's Scylla clusters. For each cluster they take one zone offline, detach the persistent data disks, terminate the instances, provision new instances with the new OS, reattach the disks, let the RAID rebuild and bring Scylla back. They then wait a configured period for the cluster to settle before moving to the next zone.
- **Monday 6 November, before the upgrade.** Two clusters remain, including `scylla-authentication`. Because that cluster hadn't had a full zonal restart recently, the team takes zone `b` offline for ten minutes as a test. They see no degradation and proceed.
- **9:16 AM.** The upgrade begins with zone `b`. Latency and errors are nominal. One odd datapoint: node `scylla-authentication-b-2` rebuilds its RAID array much more slowly than its sibling. The team treats it as a quirk.
- **10:42 AM.** Zone `b` is done. The procedure's ten-minute stabilisation wait begins after an operator validates the cluster and advances to the next zone.
- **10:52 AM.** The script drains all connections from zone `c`. Availability falls to about 25%.
- **10:56 AM.** First alerts fire. An incident call was [already running](https://discord.com/blog/authentication-outage) by then.
- **11:05 AM.** To shed load, Discord turns off typing events and read-marking. Authentication recovers for about 50% of users.
- **11:35 AM.** The team identifies the two `b` nodes as overwhelmed and briefly considers restarting `b-2`, but the zone `c` rebuild is five minutes from done, so they wait.
- **11:41 AM.** The `c` nodes come back. The `b` nodes are restarted one at a time.
- **11:43 AM.** User activity is back to normal.

## What the engineers believed

The belief was the one every multi-zone database deployment is built on: **lose one zone, keep serving.** Discord designs its clusters so that ["if we lose one zone, the cluster should continue to successfully serve requests"](https://discord.com/blog/authentication-outage), using a replication factor spread over three zones and quorum-consistency reads.

The team didn't take that on faith for this cluster. They knew it hadn't been fully restarted zone by zone in a while, so they ran a ten-minute test with zone `b` offline and saw no degradation. Every cluster upgraded so far had behaved the same way. The slow RAID rebuild on `b-2` looked like trivia: the rebuild runs [faster than the disks are normally allowed to operate](https://discord.com/blog/authentication-outage), so a slower one didn't obviously mean anything.

The postmortem names what that test actually did: the earlier zonal downtime procedure [gave them false confidence](https://discord.com/blog/authentication-outage). The test ran against a cluster of four nodes [with full caches](https://discord.com/blog/authentication-outage). By 10:52 AM, the cluster was no longer that cluster.

## What was actually going on

### Quorum arithmetic leaves no slack

*Background, standard to Dynamo-style databases such as Cassandra and ScyllaDB:* with one replica of each row in each of three zones, a quorum read needs answers from two replicas. Lose a whole zone and every read now needs **both** of the two remaining replicas. You've gone from "any two of three" to "exactly these two". The cluster still works, but every remaining node is now on the critical path for its share of the data, and any one of them being slow makes reads slow.

Discord says the same thing in operational terms: removing a zone [removes a third of the compute and "leaves no additional room for error"](https://discord.com/blog/authentication-outage). Further downtime in a second zone means loss of quorum.

The authentication cluster was small. Discord gives the arithmetic itself: with [two nodes per zone](https://discord.com/blog/authentication-outage), one zone down plus one more node out means about 50% of requests failing.

### The deliberate window you can't undo

The upgrade had a property that turned a bad moment into a long one. After the data disk is detached, the capacity [can't be restored for at least 45 minutes](https://discord.com/blog/authentication-outage). The reason is the storage design: Discord uses RAID to mirror fast local NVMe SSDs, which are wiped on reboot, with a slower persistent disk. On startup the RAID has to sync data from the persistent disk to the NVMe drives, which takes [about 40 minutes, scaling with disk size](https://discord.com/blog/authentication-outage), before Scylla can start.

So once the script drained zone `c` and detached its disks, there was no "put it back" button. By the time the team had identified the cause, [the disk had already been detached](https://discord.com/blog/authentication-outage).

### Four things that each looked survivable

The postmortem lists the combination:

1. **The cluster was underprovisioned.** One zone offline plus one degraded node ["should not have caused an outage of this magnitude"](https://discord.com/blog/authentication-outage).
2. **A degraded disk.** One of the NVMe SSDs on `b-2` was degraded, which is why its RAID rebuild had been slow. That hurt disk I/O on the node.
3. **Cold row caches.** ScyllaDB keeps a row cache in front of disk reads. Discord had found that for some clusters the cache hit rate has to reach a certain level before it is safe to restart more nodes, and it calls this [a sign of an underprovisioned cluster](https://discord.com/blog/authentication-outage). The `b` nodes had just been restarted, and nobody checked whether their hit rate had recovered before draining `c`.
4. **A retry storm.** The application retries requests on server errors from authentication endpoints. Once the cluster began timing out, those retries [added further load](https://discord.com/blog/authentication-outage).

Put them together and the state at 10:52 AM was: zone `b` with one degraded node and one healthy node, both with relatively empty caches; zone `c` offline; zone `d` with two healthy nodes. For half the data, the quorum had to include a `b` node, and a cold-cache node sends far more reads to disk. On `b-2`, the disk was the degraded part.

```diagram
title: why zone c going away hurt so much
flow: zone c drained -> reads need b AND d -> b nodes cold cache
flow!: b-2 slow disk -> timeouts -> client retries
note: each factor alone was survivable; together they saturated the cluster
```

### Why the dashboards pointed somewhere else

ScyllaDB uses a shard-per-core design. When the team looked, all four remaining nodes showed [load at 100% for some shards](https://discord.com/blog/authentication-outage). Everything looked overloaded, so the culprit wasn't obvious, and a [misleading error message in the authentication service](https://discord.com/blog/authentication-outage) cost them a detour. The breakthrough came from Scylla's own logs, which showed errors connecting to the two `b` nodes. Saying that out loud reminded someone of the slow rebuild that morning.

## How they fixed it

They had already used what the postmortem calls [the biggest hammer available](https://discord.com/blog/authentication-outage): at 11:05 AM they turned off typing events and read-marking to cut traffic to the cluster. That brought authentication back for about half of users.

The other option was to restart nodes to clear long-running queries that clients had abandoned. With zone `c` down, restarting any node would definitely break quorum for part of the data. Restarting the right node might fix things; restarting the wrong one might take Discord fully down. They kept investigating instead.

When they found the `b` nodes were the problem it was 11:35, with the zone `c` rebuild due five minutes later. They chose to wait rather than risk the recovery. At 11:41 the `c` nodes came back, the `b` nodes were restarted one at a time, and at 11:43 activity was back to normal.

## What changed afterwards

From the [postmortem](https://discord.com/blog/authentication-outage):

- **Doubled the cluster.** Immediately after the incident, `scylla-authentication` was expanded to twice its size, so each node handles half as many requests and there is more room when nodes are offline.
- **Rebuilt the bad node** with new disks, and started work on detecting disk degradation that is subtle enough not to affect overall latency but still threatens reliability.
- **Moved upgrades into a control plane.** Discord is building a more automatic control plane for its Scylla clusters, so procedures like this one can check things such as cache hit rate before advancing.
- **Treat this cluster differently.** Discord concluded the small auth cluster needs different operating rules from its much larger clusters and was considering a higher replication factor or a hot-standby cluster in another region, noting the second would complicate auth's consistency model.

## The rule

"We tolerate the loss of a zone" is a statement about a healthy cluster. When you take a zone down on purpose, you are spending that tolerance, and everything left has to be fully healthy: disks, caches, headroom. Check those things before the drain, especially when the step can't be reversed for 45 minutes. The slow rebuild on `b-2` was a real signal, and the procedure had no step that asked about it.

Two general practices this incident illustrates (interpretation, not from the postmortem): a dry-run test only tells you about the conditions it ran under, so a ten-minute outage test with warm caches says little about a drain right after a restart. And client retries on a saturated dependency need backoff and a budget, or they make the overload worse at exactly the wrong time.

## Sources

- [Mark Smith, "25% or 6 to 4: The 11/6/23 Authentication Outage", Discord blog, 15 November 2023](https://discord.com/blog/authentication-outage): Discord's official postmortem, covering the cluster topology, upgrade procedure, timeline, contributing factors and follow-up actions.
