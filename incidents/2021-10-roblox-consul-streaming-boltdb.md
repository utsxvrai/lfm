---
title: "Roblox was down for 73 hours because Consul, its service discovery, couldn't keep up with writes"
dek: "A newly enabled Consul streaming feature created contention on a single Go channel under heavy read and write load, and a BoltDB freelist problem made every Raft write on some leaders drag a 7.8MB freelist to disk. Every service depended on that one Consul cluster, including the monitoring needed to find the cause."
belief: "Roblox thought Consul's streaming feature was proven. Under heavy load it blocked writes, and Roblox went down."
date: 2021-10-28
company: Roblox
kind: outage
topics: [software-bug, dependency, cascading-failure, monitoring]
stack: [consul, boltdb, raft, nomad, vault, go]
duration_min: 4380
impact: "A 73-hour outage from 28 to 31 October 2021 on a platform that fifty million players use every day."
rule: "Your coordination service is a single point of failure for everything that uses it: shard it, keep monitoring off it, and roll out changes to it as carefully as a database migration."
postmortem: https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/
sources: [https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/, https://blog.roblox.com/2022/01/roblox-return-to-service-10-28-10-31-2021/]
---

# Roblox was down for 73 hours because Consul, its service discovery, couldn't keep up with writes

Starting on 28 October 2021 and fully resolving on 31 October, [Roblox experienced a 73-hour outage](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/). Roblox says [fifty million players](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/) use it every day. For most of those three days, none of them could play.

There was no attack and no user data loss. Roblox and HashiCorp engineers spent days trying hypotheses (bad hardware, too much load, too many reconnecting clients) before finding [two issues](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/), both deep inside Consul: contention in a newly enabled streaming feature, and a pathological performance problem in BoltDB, the embedded database Consul uses for its Raft log.

It's one of the best-documented outages of a coordination system, and the lesson is less "Consul had a bug" than "everything, including the tools you'd use to debug, depended on one cluster". All times below are [Pacific](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/), as in the postmortem.

## What happened

Roblox runs its own data centers, with [over 18,000 servers and 170,000 containers](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/), orchestrated with HashiCorp's Nomad, Consul and Vault. Consul handled service discovery, health checks, session locking and a KV store. The cluster had [5 voters and 5 non-voters](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/), with one voter elected leader via Raft.

The [timeline](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/):

- **Months before:** Roblox upgraded from Consul 1.9 to 1.10 to use a new streaming feature, and enabled it gradually on more services.
- **27 Oct, 14:00:** Streaming enabled on a backend service responsible for traffic routing. At the same time, the number of traffic-routing nodes was increased by 50% to prepare for end-of-year traffic.
- **28 Oct, 13:37:** Vault performance degraded and one Consul server had high CPU. Players not yet affected. KV write latency at the 50th percentile was 2 seconds instead of the usual under 300ms.
- **First theory, bad hardware:** a Consul node was replaced. No improvement.
- **16:35:** Online players dropped to 50% of normal, followed by a complete outage.
- **Second theory, load:** all Consul nodes replaced with 128-core machines with faster NVMe disks. Still unhealthy by 19:00.
- **29 Oct, 02:00 to 04:00:** Cluster reset from a snapshot, with iptables blocking clients. Healthy until traffic was let back in, then back to 2-second writes.
- **Third theory, too many clients:** non-essential Consul usage disabled, services scaled to single digits, health checks slowed from 60 seconds to 10 minutes. Restart at 16:00; unhealthy again by 02:00 on 30 October.
- **30 Oct, 02:00 to 12:00:** Investigation of contention. A move back to 64-core servers didn't help.
- **30 Oct, 15:51:** Streaming disabled everywhere. KV write p50 back to 300ms.
- **31 Oct, 05:00:** Consul and the caching system healthy.
- **31 Oct, 16:45:** [100% of players were given access](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/), 73 hours after the start.

## What the engineers believed

Every hypothesis the team tried was reasonable, and the postmortem is honest that each one was wrong.

**"Slow hardware."** At Roblox's scale, hardware problems are routine, and a node that is slow rather than dead can drag down a consensus cluster. Replacing it was the textbook first move.

**"The cluster is overloaded, so give it bigger machines."** More cores and faster disks should help a cluster that can't keep up. Here they [potentially hurt stability](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/).

**"Streaming is proven."** This is the assumption underneath everything. Streaming had been rolled out gradually for months and had [worked as expected](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/). It was even running fine on the traffic-routing service for a day before the incident. HashiCorp had [benchmarked streaming at similar scale](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/) to Roblox's usage. Nobody had a reason to suspect it.

## What was actually going on

There were two independent problems, which is a big part of why diagnosis took so long.

### Problem 1: streaming concentrated contention on one Go channel

*(Background.)* Consul clients that want to know when a service's instances change used to do it with long polling: ask, wait until something changes, ask again. Streaming replaces that with a push-based subscription, which is cheaper for the servers in the normal case. That's why Roblox adopted it.

HashiCorp's explanation, as reported by Roblox: streaming [used fewer concurrency control elements (Go channels) in its implementation than long polling](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/). Under very high read load **and** very high write load at the same time, the design increased contention on a single Go channel, which caused blocking during writes.

*(Background.)* A Go channel is a synchronised queue. When many goroutines send on or receive from the same channel, they serialise on its internal lock. A design that funnels many subscribers through one channel is efficient until there are enough of them, changing fast enough, that the lock is the bottleneck. Then every write waits.

Roblox's perf data showed [the majority of time was spent in kernel spin locks via the Streaming subscription code path](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/). It also explains the bigger machines: the 128-core servers were dual-socket NUMA systems, where [contention on shared resources thus got worse](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/). More cores meant more contenders for the same lock, with more expensive cross-socket memory traffic.

HashiCorp hadn't seen this in benchmarks because it came from [a combination of both a large number of streams and a high churn rate](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/). The 50% increase in traffic-routing nodes on 27 October, on a service that had just moved to streaming, plausibly added both. The postmortem doesn't state that as the trigger, so treat it as interpretation.

### Problem 2: BoltDB's freelist made small writes huge

Even after streaming was turned off, some leaders were still slow. Consul uses BoltDB to store the Raft log, a rolling log of operations. To keep it from growing forever, Consul regularly snapshots its state and deletes the oldest log entries.

But BoltDB's file [never shrinks](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/). Pages (4KB segments) that held deleted data are marked free and tracked in a structure called the **freelist**, which is written out as part of each commit. On one of Roblox's servers, the postmortem shows:

- A [4.2GB log store holding only 489MB of actual data](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/), with 3.8GB of empty space.
- A freelist of [7.8MB](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/), because it contained nearly a million free page IDs.

So [for every log append](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/), a new 7.8MB freelist was written to disk even though the data being appended was 16KB or less. Back pressure from that filled TCP buffers and contributed to 2-3 second write times on unhealthy leaders.

```diagram
title: why a 16KB write cost 7.8MB
flow: Raft append 16KB -> BoltDB commit -> write data pages
flow!: ~1M free page IDs -> rewrite freelist -> 7.8MB per commit
note: deleting old log entries grew the freelist, never the file
```

*(Background.)* This is a write-amplification trap common to storage engines that reuse space in place. Deleting data doesn't make the next write cheaper; it makes the bookkeeping bigger. A log that's constantly appended and trimmed is the worst case.

### Why one cluster took everything down

Consul was the place every service looked up every other service. When Consul was unhealthy, servers [struggle to connect](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/). Nomad and Vault also depended on it, so the system couldn't schedule containers or fetch production secrets. Roblox's summary: ["the system failed because Consul was a single point of failure, and Consul was not healthy."](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/)

Worse, [critical monitoring systems](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/) that would have shown the cause relied on Consul too. The team was debugging Consul with tools that needed Consul.

## How they fixed it

- **Streaming off.** Once flame graphs pointed at the streaming code path, the team disabled streaming for all Consul systems. The change [finished propagating at 15:51](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/) on 30 October and KV write p50 dropped to 300ms.
- **Slow leaders worked around.** Without knowing why yet, the team noticed the cluster was healthy as long as certain servers weren't leader, so it prevented those [problematic leaders from staying elected](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/). HashiCorp found the BoltDB cause in the following days, and the two companies used existing BoltDB tooling to compact the database.
- **Caches rebuilt.** The caching layer, which handles [1B requests-per-second](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/) normally, was redeployed. That hit problems: wrong scheduling data in Consul KV (likely from the snapshot reset), an unhealthy node the scheduler saw as empty, and a deployment tool built for incremental changes, not bootstrapping from zero.
- **Players let back in gradually.** Using DNS steering, Roblox admitted a random percentage of players and raised it [in roughly 10% increments](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/), checking database load and cache performance each time.

## What changed afterwards

From the [postmortem](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/):

- **Telemetry no longer depends on Consul.** The circular dependency was removed, and Consul and BoltDB got targeted alerts.
- **Multiple data centers and availability zones.** A geographically distinct data center was built out.
- **Consul sharding.** Critical services moved to dedicated clusters; data that didn't belong in Consul KV is being migrated; obsolete KV data was deleted.
- **BoltDB replaced by bbolt**, its successor without the unbounded freelist growth, scheduled for Q1.
- **Faster bootstrapping** for caches and Nomad jobs after a long outage.
- **Streaming to be reintroduced** only after a new implementation is tested at Roblox's scale.

## The rule

Service discovery, config and locking systems sit underneath everything, so a problem there takes down everything, and a slow coordination cluster is as bad as a dead one. Shard it so one workload can't saturate it for all, keep your monitoring and debugging path off it, and treat a change to how clients talk to it (like switching from polling to streaming) with the caution you'd give a database migration, including load tests that reproduce your real churn. And know your storage engine: if it never gives space back, a log that's constantly trimmed can make every write pay for all the deletes that came before.

## Sources

- [Roblox, "Roblox Return to Service" (Daniel Sturman et al., 20 January 2022)](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021/): the full postmortem with HashiCorp, covering the timeline, the streaming contention, the BoltDB freelist analysis, recovery and follow-up work.
- [Roblox blog, same postmortem](https://blog.roblox.com/2022/01/roblox-return-to-service-10-28-10-31-2021/): the original blog URL for the same post.
