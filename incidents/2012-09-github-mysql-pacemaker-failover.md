---
title: "GitHub's new high-availability MySQL cluster caused the outages it was built to prevent"
dek: "A heavy migration failed a health check, automated failover moved the master to a cold server that failed the check too, and a day later a Pacemaker segfault split the cluster and elected an out-of-date node as master."
date: 2012-09
company: GitHub
kind: outage
topics: [database, replication, automation, cascading-failure]
stack: [mysql, innodb, pacemaker, heartbeat, percona-replication-manager, redis]
duration_min: 106
impact: "One hour and 46 minutes of downtime and another hour of significantly degraded performance; 16 private repositories were exposed for seven minutes."
detected_by: engineers
rule: "Automated failover is a decision to restart your database on a cold machine. Make sure the health check that triggers it can tell 'dead' from 'busy'."
postmortem: https://github.blog/2012-09-14-github-availability-this-week/
sources: [https://github.blog/2012-09-14-github-availability-this-week/]
---

# GitHub's new high-availability MySQL cluster caused the outages it was built to prevent

In the week of September 10, 2012, GitHub.com went down twice. In total there was [one hour and 46 minutes of downtime and another hour of significantly degraded performance](https://github.blog/2012-09-14-github-availability-this-week/). On the second day, for [seven minutes](https://github.blog/2012-09-14-github-availability-this-week/), 16 private repositories were reachable by people who weren't their collaborators.

Both outages traced back to infrastructure deployed about a month earlier to make GitHub's database *more* available: a three-node MySQL cluster with automated failover. Jesse Newland's postmortem is unusually candid about this. The automated failover of the main production database, he wrote, ["could be described as the root cause of both of these downtime events."](https://github.blog/2012-09-14-github-availability-this-week/)

It's one of the clearest public case studies of how high-availability machinery can turn a slow database into a down database, and a split cluster into a data integrity problem.

## What happened

**The setup.** In a mid-August maintenance window, GitHub [replaced its pair of DRBD-backed MySQL servers with a 3-node cluster](https://github.blog/2012-09-14-github-availability-this-week/). The cluster exposed two virtual IPs, one read/write and one read-only, managed by **Pacemaker** and **Heartbeat**. **Percona Replication Manager** (PRM), a Pacemaker resource agent, decided which node held the "active" role (master, reads and writes) and which held "standby" (read-only replica). The application mostly used the active role.

**Monday, September 10.**

1. A schema migration, run with GitHub's two-pass zero-downtime migration system, put [more load on the database than the team had seen](https://github.blog/2012-09-14-github-availability-this-week/) in such migrations.
2. The load made PRM's health checks fail on the master. PRM moved the active role to another node and stopped MySQL on the node it thought had failed.
3. The new master had a **cold InnoDB buffer pool**. Under the site's full query load it performed poorly, failed the health check too, and the active role moved back.
4. Newland put Pacemaker into **maintenance-mode**, which disables all health checks and automatic failover. The site recovered slowly as the buffer pool warmed.

**Tuesday, September 11.**

1. A developer reported [incorrect query results from the standby node](https://github.blog/2012-09-14-github-availability-this-week/). Maintenance-mode had blocked the actions that should have pointed the standby at the new master and started replication, so it was stale.
2. The team decided to turn maintenance-mode off so PRM could fix the standby. Doing so triggered a **Pacemaker segfault** that partitioned the cluster's state: nodes a and b rejected most messages from c, and c rejected most from a and b.
3. Even though the cluster was configured to require a majority, [two master elections ran at once](https://github.blog/2012-09-14-github-availability-this-week/). On the a/b side, the election was interrupted and MySQL stopped. On the c side, c elected itself at **8:19 AM**.
4. Node c was the out-of-date node. The team powered it off at **8:26 AM**, which ended the split but took down all database access and so all of github.com.
5. They stopped every Pacemaker and Heartbeat process, started them only on node a, and brought MySQL up there as active. Performance came back slowly as the buffer pool warmed.

## What the engineers believed

The new cluster rested on a reasonable set of beliefs:

- **Fast failover is better than slow failover.** In the old DRBD setup, failover meant a cold start of MySQL. In the new one, MySQL ran on every node all the time, and failover just [moved a virtual IP after flushing transactions and toggling `read_only`](https://github.blog/2012-09-14-github-availability-this-week/).
- **A failed health check means a failed master.** If the master doesn't respond, move the role.
- **Quorum prevents split brain.** The cluster required a majority of nodes to agree before acting.
- **Maintenance-mode is a safe pause.** It stops automation from acting, so a human can stabilise things.

Every one of these turned out to be incomplete.

## What was actually going on

### "Running" is not "ready": the cold buffer pool

InnoDB keeps hot data and index pages in memory in the **buffer pool**. A master that's been serving traffic for weeks has the working set in RAM. A replica that has only been applying replication writes has a very different set of pages cached. So "MySQL is running on all nodes" doesn't mean all nodes can serve the master's read load. When the active role moves, the new master has to pull most of its working set from disk, and every query is slower until it warms up.

That's the loop on Monday:

```diagram
title: failover that feeds itself
flow: migration load -> health check fails -> move master
flow!: new master cold -> slow under load -> check fails again
note: the check couldn't tell busy from dead
```

The health check measured *responsiveness*, and both "this node is dead" and "this node is overloaded" fail it. Failover is the right response to the first and the worst response to the second: it moves the load to a machine that's *less* able to carry it. GitHub's summary lists this first among the causes: [several failovers happened when they shouldn't have](https://github.blog/2012-09-14-github-availability-this-week/).

### Maintenance-mode froze more than failover

Maintenance-mode did what it said: [no health checks, no automatic failover](https://github.blog/2012-09-14-github-availability-this-week/). But PRM was also responsible for routine replication topology: after the master moved, the standby needed to be pointed at the new master and start replicating. That was frozen too. The cluster looked calm while the standby silently fell further out of date. The tool that caused trouble on Monday was also doing quiet, essential work, and pausing it paused both.

### Split brain despite quorum

On Tuesday, the segfault while leaving maintenance-mode left the cluster's nodes disagreeing about state. GitHub's post says the majority requirement was configured, yet [two simultaneous master election decisions were attempted without proper coordination](https://github.blog/2012-09-14-github-availability-this-week/). The post doesn't explain why quorum failed to prevent this; the team said it would audit the Pacemaker code path behind the segfault. The result was the worst case: the minority node, which was also the stale one, won, and for seven minutes it accepted writes.

### Why a stale master leaked private repositories

GitHub didn't keep everything in MySQL. Redis held dashboard event stream entries and repository routes, [keyed by MySQL-generated ids](https://github.blog/2012-09-14-github-availability-this-week/).

The post doesn't spell out exactly how the ids went wrong; the standard mechanism, and the likely one here, is this. Auto-increment ids are only unique within one history. Node c was behind, so its counters were behind too. When it became master and accepted inserts, it handed out ids that the real master had **already assigned** to other records. Redis entries written with those ids now collided with, or pointed at, rows that meant something else on the authoritative side. GitHub's post says the cross-data-store foreign keys ["became out of sync"](https://github.blog/2012-09-14-github-availability-this-week/) for records created in that window. Events showed up on the wrong users' dashboards, and some new repositories were routed incorrectly, which is how [16 private repositories](https://github.blog/2012-09-14-github-availability-this-week/) were exposed between 8:19 and 8:26 AM PDT.

This is the hidden cost of split brain. Even seven minutes of writes on the wrong node doesn't just lose data; any system that copied ids out of the database now holds references that mean different things depending on which history you believe.

## How they fixed it

- **Monday:** maintenance-mode stopped the failover loop. Recovery was waiting for the buffer pool.
- **Tuesday:** powering off node c ended the split. The team then [restarted Pacemaker cleanly on node a alone](https://github.blog/2012-09-14-github-availability-this-week/) after attempts to change the cluster state failed.
- **Cleanup:** leaked dashboard events were removed, incorrectly routed repositories were audited, and owners of the 16 affected private repositories were contacted directly.

GitHub's status site, hosted on Heroku, struggled too. Scaling from 8 to 64 to 90 dynos [exhausted connections to a shared development database add-on](https://github.blog/2012-09-14-github-availability-this-week/); moving to a production database fixed it.

## What changed afterwards

From the [postmortem](https://github.blog/2012-09-14-github-availability-this-week/):

- **No more automatic master failover.** Pacemaker was reconfigured so the active role moves only when a member of the operations team starts it. Newland's reasoning: in every case, if an operator had been asked whether the failover should happen, ["the answer would have been a resounding no."](https://github.blog/2012-09-14-github-availability-this-week/)
- **Warm replicas.** The team was evaluating ways to warm InnoDB buffer pools on replicas so failovers, when they do happen, don't degrade performance.
- **Audit the segfault.** A full audit of the Pacemaker/Heartbeat stack around the crash, plus hardware testing of the server where it happened.
- **Status site.** A database replica for the status site.

## The rule

Automatic failover is only as smart as its health check. If the check can't tell an overloaded master from a dead one, failover will move load onto a colder, weaker machine at the worst possible moment. And if anything outside the database stores database-generated ids, a few minutes of split brain becomes a data integrity incident, not just downtime.

## Sources

- [GitHub Blog: GitHub availability this week (Jesse Newland, September 14, 2012)](https://github.blog/2012-09-14-github-availability-this-week/): the postmortem for both outages, the data exposure, and the status site problems.
