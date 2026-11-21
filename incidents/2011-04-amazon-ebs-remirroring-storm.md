---
title: "A wrong traffic shift set off an EBS re-mirroring storm in AWS us-east-1"
dek: "A network change sent EBS's primary traffic onto a low-capacity backup network. A large number of storage nodes concluded their replicas were dead, all tried to re-replicate at once, used up the free space in the cluster and kept retrying."
date: 2011-04-21
company: Amazon
kind: outage
topics: [networking, replication, cascading-failure, capacity]
stack: [aws, ec2, ebs, rds]
impact: "About 13% of EBS volumes in one us-east-1 Availability Zone became stuck; 0.07% of volumes in that zone could not be restored in a consistent state."
rule: "Recovery traffic needs a budget. A replica-repair mechanism that is fast for one failure must back off when many fail at once, or the repair becomes the outage."
postmortem: https://aws.amazon.com/message/65648/
sources: [https://aws.amazon.com/message/65648/]
---

# A wrong traffic shift set off an EBS re-mirroring storm in AWS us-east-1

Early on April 21, 2011, part of Amazon EBS, the network block storage that backs EC2 instances, stopped answering reads and writes in one Availability Zone in US East. Instances using those volumes froze on I/O. For parts of the first day, the EBS APIs also failed across the whole region. In the affected zone, getting volumes fully back took until the weekend, and AWS later reported that [0.07% of the volumes in the affected Availability Zone could not be restored for customers in a consistent state](https://aws.amazon.com/message/65648/).

The trigger was one wrong step in a routine network upgrade. The damage came from EBS's own durability mechanism. When a storage node loses contact with its replica, it immediately makes a new copy somewhere else. That's exactly right when one node fails. When a large number of nodes lost contact at the same moment, they all went looking for free space at once, used it all up, and kept looking.

AWS's postmortem names it: a "[re-mirroring storm](https://aws.amazon.com/message/65648/)."

## What happened

At [12:47 AM PDT on April 21st](https://aws.amazon.com/message/65648/), AWS made a network change in a single Availability Zone as part of normal scaling, upgrading the capacity of EBS's primary network. One standard step was to shift traffic off one of the redundant primary routers. The traffic shift [was executed incorrectly](https://aws.amazon.com/message/65648/). Instead of going to the other primary router, traffic went onto EBS's lower-capacity secondary network.

That left part of the EBS cluster with no working network. The primary had been drained on purpose, and the secondary couldn't handle the load. Many EBS nodes were [completely isolated from other EBS nodes in its cluster](https://aws.amazon.com/message/65648/).

When the shift was rolled back and connectivity returned, the isolated nodes started re-mirroring all at once. Key times from the postmortem (all PDT):

| Time | Event |
| --- | --- |
| Apr 21, 12:47 AM | Network change. Traffic shifted to the wrong network |
| (after rollback) | Re-mirroring storm. [About 13%](https://aws.amazon.com/message/65648/) of volumes in the AZ stuck |
| 2:40 AM | Create Volume disabled in the AZ. Other EBS APIs recover by 2:50 AM |
| 5:30 AM | Region-wide EBS API errors and latency rise again |
| 8:20 AM | Team begins cutting off the degraded cluster from the EBS control plane |
| 11:30 AM | Change stops nodes from fruitlessly searching for space. Cluster stops degrading |
| 12:04 PM | Outage contained to the one AZ |
| Apr 22, ~2:00 AM | New capacity starts being added successfully |
| Apr 22, 12:30 PM | All but about 2.2% of affected volumes restored |
| Apr 23, 6:15 PM | EBS API access restored in the affected AZ |
| Apr 24, 12:30 PM | All but 1.04% of affected volumes recovered. Forensics on the rest |

## What the engineers believed

The postmortem describes EBS's replication as a "[peer-to-peer based, fast failover strategy that aggressively provisions new replicas](https://aws.amazon.com/message/65648/)" whenever a copy goes out of sync or becomes unavailable. And "in a normally functioning cluster, finding a location for the new replica occurs in milliseconds."

The assumption built into "aggressive" is that **replica loss is rare and scattered**. A few nodes fail, their peers quickly find space elsewhere, and durability is restored before anyone notices. Being aggressive is the right setting when failures are independent: the faster you re-replicate, the shorter the window in which a volume has only one copy.

The second assumption is about the network itself. EBS had two networks precisely so that losing one wouldn't isolate nodes. AWS's post points out that "[unlike a normal network interruption, this change disconnected both the primary and secondary network simultaneously](https://aws.amazon.com/message/65648/)." The redundancy was real, but this one change took out both networks at once.

## What was actually going on

### How an EBS node protects your data

From the postmortem: each EBS volume's data is replicated to multiple EBS nodes. When a node loses connection to the node it replicates to, [it assumes the other node failed](https://aws.amazon.com/message/65648/). To keep durability, it searches the cluster for a node with enough free space, connects to it, and copies the volume data over. That's **re-mirroring**.

Two safety rules make this conservative:

- While re-mirroring, every node holding the data [holds onto it](https://aws.amazon.com/message/65648/) until another node confirms it has taken ownership. Nothing is let go early.
- While a volume is being re-mirrored, access to it is blocked until a new primary (writable) replica is chosen, for consistency. To the EC2 instance, the volume [will appear "stuck"](https://aws.amazon.com/message/65648/).

Both rules are correct. Together they mean that re-mirroring *needs free space* and *blocks I/O until it finishes*.

### Why it became a storm

When a huge number of volumes needed new replicas at once, the [free capacity of the EBS cluster was quickly exhausted](https://aws.amazon.com/message/65648/). There was nowhere to put new copies. And because of the hold-onto-data rule, the old copies couldn't be released either.

Nodes that couldn't find space didn't wait. The postmortem says they "[did not back off aggressively enough](https://aws.amazon.com/message/65648/) when they could not find space, but instead, continued to search repeatedly." Every stuck node kept probing every other node, which created a flood of connection attempts across a cluster that had no space to give.

A latent bug made it worse. A [race condition](https://aws.amazon.com/message/65648/) in the EBS node code could crash a node when it was closing a large number of replication requests at the same time. In normal operation this was rare. Under the storm's connection volume, it fired often. Each crashed node left *more* volumes needing re-mirroring, which fed the storm.

```diagram
title: the re-mirroring storm
flow: replica lost -> finds free space -> new copy in ms
flow!: mass replica loss -> no free space left -> retry, no backoff
flow!: connection flood -> race-bug crashes -> more to re-mirror
note: a mechanism tuned for one failure, hit by many at once
```

### How one zone hurt the whole region

EBS has a regional **control plane** that handles API calls and acts as the authority when a volume elects its primary replica. It's spread across zones, but it's a single set of services for the region.

Two separate paths spread the problem out of the zone:

1. **Thread starvation.** The degraded cluster couldn't serve Create Volume. The control plane was [configured with a long time-out period](https://aws.amazon.com/message/65648/), so those calls piled up and held threads from a *regional* pool. When the pool filled, API calls for every other zone failed too. Disabling Create Volume in the affected zone at 2:40 AM cleared it.
2. **Negotiation load.** Electing a new primary requires a negotiation between the EC2 instance, the EBS nodes and the control plane. As more nodes crashed, these negotiations multiplied and were retried, causing a [brown out of the EBS control plane](https://aws.amazon.com/message/65648/) around 5:30 AM. The fix, starting at 8:20 AM, was to cut the degraded cluster off from the control plane entirely, which in turn blocked all EBS API access in that zone.

This is the classic bulkhead failure. A regional resource (a thread pool, then control-plane capacity) was shared across zones with no per-zone limit, so one sick zone could use it all up.

### RDS felt it more than EBS did

RDS instances use multiple EBS volumes, so one stuck volume makes the whole database unusable. In the affected zone, a [peak of 45% of single-AZ instances](https://aws.amazon.com/message/65648/) had stuck I/O, a much larger share than the 13% of volumes. Striping a database across volumes raises throughput, and it also raises the odds that at least one of those volumes is stuck. Separately, [2.5% of multi-AZ](https://aws.amazon.com/message/65648/) RDS instances in the region did not fail over automatically. A previously unseen bug left the primary in a state where failing over automatically risked losing data.

## How they fixed it

**Stop the bleeding.** At 11:30 AM, AWS deployed a change that stopped degraded nodes from [futilely contacting other servers](https://aws.amazon.com/message/65648/) for space while leaving other node-to-node communication intact. The cluster stopped getting worse.

**Add capacity, the slow way.** The stuck volumes needed free space. But EBS deliberately [does not reuse a failed node until every data replica is successfully re-mirrored](https://aws.amazon.com/message/65648/), so that data can still be recovered from it. So AWS had to physically move spare servers from across US East into the affected cluster. Then the throttle that had stabilized the cluster made the new servers hard to bring in. The team had to loosen negotiation throttles carefully so that the new nodes could be used without flooding the old ones again.

**Reconnect the control plane gradually.** There was a large backlog of state changes in both directions. AWS built a [separate instance of the EBS control plane](https://aws.amazon.com/message/65648/) dedicated to the affected zone, along with finer-grained throttles, and started steadily processing the backlog shortly after 11:30 AM on April 23.

**Restore the rest from snapshots.** The last 2.2% of affected volumes had been [snapshotted to S3 early in the event](https://aws.amazon.com/message/65648/) as a precaution, and AWS restored them from those snapshots in batches. Forensics on the volumes left after that brought the final unrecoverable share to 0.07%.

## What changed afterwards

The postmortem lists specific changes:

- **More spare capacity** so the cluster can absorb a large re-mirroring event, plus capacity planning and alarming for it.
- **Retry logic** in EBS nodes that backs off more aggressively and focuses on [re-establishing connectivity with previous replicas rather than futilely searching for new nodes](https://aws.amazon.com/message/65648/).
- **A fix for the race condition** that crashed nodes.
- **Timeout fixes** in the control plane to prevent thread exhaustion. AWS says this alone would have prevented the API impact from 12:50 AM to 2:40 AM.
- **Zone-aware load shedding** in the control plane, and moving more control-plane functions into per-cluster services in the same zone.
- **Audit and automate** the network change process.
- **Customer-facing:** multiple Availability Zones for VPC, better multi-AZ tooling, and the ability to snapshot a stuck volume.
- **A 10-day credit** equal to 100% of EBS, EC2 and RDS usage for customers with resources in the affected zone.

The retry change is the important one. The best move after a mass partition is usually to *wait for the old partner to come back*, not to copy data to a stranger. AWS doesn't say how many of the partner nodes were actually healthy. But the shape of the fix suggests the lesson: after a network partition, a node that looks dead is often just unreachable for a while.

## The rule

Every self-healing mechanism needs to know how much healing is going on. Re-replication, retries and failover are all tuned for one failure at a time. When many fail at once, they need to back off, prefer reconnecting to old partners over building new copies, and stay inside a budget for recovery traffic. If they don't, the repair work uses up the capacity it needs, and anything shared across zones will carry the failure along with it.

## Sources

- [AWS: "Summary of the Amazon EC2 and Amazon RDS Service Disruption in the US East Region" (April 2011)](https://aws.amazon.com/message/65648/). AWS's postmortem: EBS architecture, the network change, the re-mirroring storm, the race condition, control-plane impact, RDS impact, recovery timeline and remediation.
