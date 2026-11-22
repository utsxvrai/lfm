---
title: "43 seconds of lost connectivity sent GitHub's MySQL primaries across the country and cost 24 hours"
dek: "A brief network partition let Orchestrator's Raft quorum promote West Coast MySQL primaries. East Coast had a few seconds of writes the West never saw, so GitHub could not simply fail back, and chose a day of degraded service over losing data."
belief: "GitHub never expected MySQL failover to cross the country. A 43-second network partition moved its primaries West."
date: 2018-10-21
company: GitHub
kind: outage
topics: [replication, database, automation, networking]
stack: [mysql, orchestrator, raft]
duration_min: 1451
impact: "Degraded service for 24 hours and 11 minutes, with out-of-date and inconsistent data shown, webhooks and GitHub Pages builds paused, and about 200,000 webhook payloads dropped during backlog processing."
detected_by: alert
rule: "Automated failover must only make topology changes the application can actually run on. A failover that is correct for the database but moves writes across a continent is not a recovery, and after a split you can't fail back without reconciling."
postmortem: https://github.blog/2018-10-30-oct21-post-incident-analysis/
sources: [https://github.blog/2018-10-30-oct21-post-incident-analysis/]
---

# 43 seconds of lost connectivity sent GitHub's MySQL primaries across the country and cost 24 hours

At 22:52 UTC on 21 October 2018, routine maintenance to replace failing 100G optical equipment cut the link between GitHub's US East Coast network hub and its primary US East Coast data center. [Connectivity was restored in 43 seconds](https://github.blog/2018-10-30-oct21-post-incident-analysis/). The result was [24 hours and 11 minutes of service degradation](https://github.blog/2018-10-30-oct21-post-incident-analysis/).

For most of that day GitHub showed out-of-date and inconsistent information, and it was [unable to serve webhook events or build and publish GitHub Pages sites](https://github.blog/2018-10-30-oct21-post-incident-analysis/). No user data was lost, but at the time of the postmortem, manual reconciliation of ["a few seconds of database writes"](https://github.blog/2018-10-30-oct21-post-incident-analysis/) was still going on.

The 43 seconds didn't do the damage. What did was the automated failover that ran during them, which was correct by its own rules and left GitHub's databases in a state that couldn't simply be undone.

## What happened

GitHub stores non-Git metadata, such as pull requests, issues, authentication and background job coordination, in [multiple MySQL clusters](https://github.blog/2018-10-30-oct21-post-incident-analysis/) ranging from hundreds of gigabytes to nearly five terabytes, each with up to dozens of read replicas. Applications send writes to each cluster's primary and most reads to replicas. [Orchestrator](https://github.blog/2018-10-30-oct21-post-incident-analysis/) manages the cluster topologies and handles automated failover, and is built on Raft for consensus.

The timeline, from [GitHub's analysis](https://github.blog/2018-10-30-oct21-post-incident-analysis/):

| Time (UTC) | Event |
|---|---|
| Oct 21 22:52 | Network partition. Orchestrator nodes in the West Coast data center and East Coast public cloud form a quorum and fail clusters over to the West Coast. When connectivity returns, applications start writing to the new West Coast primaries. |
| 22:54 | Monitoring alerts on numerous faults. |
| 23:02 | Responders find many database clusters in an unexpected state; the Orchestrator API shows topologies containing only West Coast servers. |
| 23:07 | Deployment tooling locked. Status yellow at 23:09, red at 23:13. |
| 23:19 | Webhook delivery and Pages builds paused to protect data. |
| Oct 22 00:05 | Plan: restore from backups, sync replicas in both sites, return to a stable topology, then resume queued jobs. |
| 00:41 | Backup restores running for all affected clusters. |
| 06:51 | Several clusters restored in the East and replicating from the West. Larger clusters still restoring. |
| 11:12 | All primaries back in the US East Coast. Dozens of read replicas still hours behind. |
| 13:15 | Near peak traffic, replication lag growing; extra read replicas added in the East Coast public cloud. |
| 16:24 | Replicas in sync; failover to the original topology. Status stays red while the backlog is processed. |
| 16:45 | Backlog processing begins: over five million webhook events and 80 thousand Pages builds queued. |
| 23:03 | Backlog processed, systems confirmed. Status green. |

## What the engineers believed

The design assumption is in the postmortem's background section. GitHub notes that Orchestrator ["can implement topologies that applications are unable to support, therefore care must be taken to align Orchestrator's configuration with application-level expectations"](https://github.blog/2018-10-30-oct21-post-incident-analysis/). In other words, the team knew the two could diverge.

The belief that turned out wrong was about what a partition would look like in practice. Orchestrator was allowed to promote primaries across regions. Applications in the East Coast could not live with a primary in the West: they were ["unable to cope with the additional latency introduced by a cross-country round trip for the majority of their database calls"](https://github.blog/2018-10-30-oct21-post-incident-analysis/). GitHub describes the cross-region promotion as ["emergent behavior of the system given that we hadn't previously seen an internal network partition of this magnitude"](https://github.blog/2018-10-30-oct21-post-incident-analysis/). Leader election had worked; nobody had seen it pick a leader on the other side of the country.

## What was actually going on

### Quorum is about who can talk, not where the apps are

Background on Raft: a Raft cluster elects a leader by majority vote. If the current leader can't reach a majority of nodes, it can't stay leader, and any group of nodes that holds a majority can elect a new one. This protects against split brain inside the consensus cluster itself, because two majorities can't exist at the same time.

Orchestrator's nodes were spread across the primary East Coast data center, the West Coast data center and the East Coast public cloud. When the East Coast data center dropped off the network, its Orchestrator node lost its majority and began [leadership deselection](https://github.blog/2018-10-30-oct21-post-incident-analysis/). The West Coast and public-cloud nodes still had a quorum, so they elected a leader and did what a failover manager is built to do: they saw primaries they couldn't reach and promoted replicas they could, in the West.

From inside the Orchestrator cluster, this was all correct. The problem is that Raft guarantees agreement among Orchestrator nodes, not that the result is good for applications. The applications were in the East, where the old primaries were. Within 43 seconds the link was back, and the application tier ["immediately began directing write traffic to the new primaries in the West Coast site"](https://github.blog/2018-10-30-oct21-post-incident-analysis/).

### Why they couldn't just fail back

MySQL replication is asynchronous in the common setup (background): the primary commits a transaction, then ships it to replicas. A replica can lag behind by some seconds. If a replica is promoted while it lags, any transactions the old primary committed but hadn't shipped exist only on the old primary.

That is what happened. The East Coast databases [held a brief period of writes that had not been replicated to the West](https://github.blog/2018-10-30-oct21-post-incident-analysis/). Then the West took new writes from the application. Now each side had writes the other lacked. For example, one of the busiest clusters had [954 writes in the affected window](https://github.blog/2018-10-30-oct21-post-incident-analysis/) that never reached the West.

```diagram
title: why failback was unsafe
flow: East primary -> seconds of writes -> not yet replicated
flow!: West promoted -> new app writes -> two histories
note: neither side can replicate from the other without losing data
```

At that point there is no clean option. Failing back to the East throws away the West's writes. Staying on the West keeps those writes but leaves the East's unreplicated seconds orphaned, and sends every write across the country. By 23:13 the West had been taking writes for [nearly 40 minutes](https://github.blog/2018-10-30-oct21-post-incident-analysis/). GitHub decided that the [30+ minutes of data](https://github.blog/2018-10-30-oct21-post-incident-analysis/) in the West ruled out anything other than failing forward, and accepted that this ["would result in our service being unusable for many users"](https://github.blog/2018-10-30-oct21-post-incident-analysis/). Their stated priority was data integrity over usability and time to recovery.

### Why recovery took a day

To move the primaries back East safely, GitHub had to rebuild the East Coast replicas from backups and then let them catch up from the West. Backups ran [every four hours](https://github.blog/2018-10-30-oct21-post-incident-analysis/) and were stored in a public cloud blob storage service. Restoring multiple terabytes meant transferring the data, then decompressing, checksumming, preparing and loading it onto new MySQL servers. The restore was tested daily, so its duration was known, but GitHub had [never needed to rebuild an entire cluster from backup](https://github.blog/2018-10-30-oct21-post-incident-analysis/) before, having relied on strategies such as delayed replicas.

Then replication had to catch up, and the team misjudged how. Their recovery estimate was linearly interpolated from replication telemetry. In reality, catch-up ["adhered to a power decay function instead of a linear trajectory"](https://github.blog/2018-10-30-oct21-post-incident-analysis/), and write load rose as Europe and the US started their workday. Background on why: a replica applying a backlog has to apply both the old backlog and all the new writes arriving meanwhile. Its effective progress is apply rate minus incoming write rate, and when the incoming rate rises during the day, progress slows or reverses.

After 11:12 every primary was back in the East, but [dozens of read replicas were hours behind](https://github.blog/2018-10-30-oct21-post-incident-analysis/). Reads were spread across a large pool, so a request had a good chance of landing on a stale replica, which is why users saw inconsistent data. At 13:15 lag was growing. Adding more read replicas reduced the load on each one, which ["allowed replication to catch up"](https://github.blog/2018-10-30-oct21-post-incident-analysis/).

### The backlog had its own failure

Paused webhooks and Pages builds piled up: [over five million hook events and 80 thousand Pages builds](https://github.blog/2018-10-30-oct21-post-incident-analysis/). When processing resumed, about [200,000 webhook payloads](https://github.blog/2018-10-30-oct21-post-incident-analysis/) turned out to be older than an internal TTL and were dropped. GitHub paused processing and raised the TTL. A queue designed for minutes of delay met a day of delay, and its expiry rule did what it was built to do.

## How they fixed it

In order: lock deploys, pause writers that could make inconsistency worse (webhooks, Pages), restore East Coast replicas from backup, replicate them from the West, add read capacity so they could catch up, fail the primaries back to the East, then drain the backlog while staying in degraded status until everything settled. For the few seconds of unreplicated East Coast writes, GitHub captured the [MySQL binary logs](https://github.blog/2018-10-30-oct21-post-incident-analysis/) from each affected cluster and was working through which writes could be reconciled automatically and which needed user outreach.

## What changed afterwards

From the [postmortem](https://github.blog/2018-10-30-oct21-post-incident-analysis/):

- **Orchestrator configured to prevent promoting primaries across regional boundaries.** GitHub notes Orchestrator behaved as configured, and that leader election within a region is generally safe.
- **A richer status page** showing individual components instead of only green, yellow and red.
- **Accelerated work on active/active/active serving** across multiple data centers, aiming to tolerate the full failure of one data center without user impact.
- **Testing assumptions proactively**, including investment in fault injection and chaos engineering tooling.

## The rule

A failover system optimizes for the database's view of health: is there a writable primary? The application needs something narrower: is there a writable primary *it can use*? Constrain automatic promotion to topologies your application can actually serve, typically within one region, and treat cross-region promotion as a human decision. And remember what asynchronous replication means at failover time: the moment you promote a lagging replica and accept writes, you have two histories, and getting back to one is measured in hours, not seconds.

## Sources

- [GitHub, "October 21 post-incident analysis"](https://github.blog/2018-10-30-oct21-post-incident-analysis/): GitHub's postmortem with background on its MySQL and Orchestrator setup, the full timeline, the backup and replication recovery, and the follow-up initiatives.
