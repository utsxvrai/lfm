---
title: "GitLab.com deleted its primary database and found its backups didn't work"
dek: "While rebuilding a broken replica, an engineer wiped the data directory on the wrong host. The pg_dump backups had been failing silently for a version mismatch, and nobody knew because the alert emails were being rejected."
belief: "GitLab thought its database backups were running. The pg_dump job had been failing silently."
date: 2017-01-31
company: GitLab
kind: data-loss
topics: [database, backup, replication, human-error]
stack: [postgresql, pg_dump, lvm, azure]
duration_min: 1080
impact: "GitLab.com was unavailable for many hours and lost database changes (an estimated 5,000 projects, 5,000 comments and 700 new user accounts) made after 17:20 UTC that day."
detected_by: engineers
rule: "A backup you have never restored from is a hope, not a backup: give it an owner and test restores on a schedule."
postmortem: https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/
sources: [https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/]
---

# GitLab.com deleted its primary database and found its backups didn't work

On January 31, 2017, GitLab.com went down after "an accidental removal of data from our primary database server" ([GitLab](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/)). It stayed down for [about 18 hours](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/), and some data never came back.

GitLab estimates it lost [roughly 5,000 projects, 5,000 comments and 700 new user accounts](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/), meaning database rows created or changed in a window of several hours. Git repositories and wikis weren't affected, because they live on separate storage. GitLab Enterprise, GitHost and self-managed installs weren't affected either. During the recovery GitLab streamed its work on YouTube, with a peak of [around 5000 viewers](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/).

The famous part is the wrong `rm`. The more useful part is everything after it: GitLab had several independent ways to recover a database, and when it needed them, almost none of them worked.

## What happened

GitLab.com ran one PostgreSQL primary and one secondary in hot-standby mode, used only for failover ([GitLab](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/)). The timeline, all UTC:

- **±17:20**: Before starting staging work on database load balancing, an engineer took a manual LVM snapshot of production and loaded it into staging. This normally happens automatically once every 24 hours. That accidental extra copy ended up saving most of the day's data.
- **±19:00**: Database load climbs, from what GitLab suspected was spam. Part of the load later turned out to be a background job deleting a GitLab employee's account, which had been reported for abuse by a troll and scheduled for removal by mistake.
- **±23:00**: Under the load, the secondary's replication falls behind and then fails, because the primary had already removed WAL segments the secondary still needed. GitLab wasn't using WAL archiving, so the only fix was a manual re-sync: wipe the secondary's data directory and run `pg_basebackup` to copy the primary.
- `pg_basebackup` hangs without useful output, even with `--verbose`. After several tries it reports that the primary doesn't have enough replication connections. Engineers raise `max_wal_senders` from 3 to 32. PostgreSQL then refuses to restart, complaining about too many semaphores, because `max_connections` was set to 8000. They reduce it to 2000. `pg_basebackup` still appears to hang; `strace` shows it waiting in a `poll` call.
- **±23:30**: An engineer suspects that the failed attempts left files in the secondary's data directory and decides to wipe it again. The command runs on the primary. They stop it "a second or two" later, but [around 300 GB of data](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/) is already gone.

## What the engineers believed

Two beliefs were wrong, and both were reasonable at the time.

**First: "`pg_basebackup` is hung, so something is broken."** The tool printed nothing for a long time. GitLab later learned this is normal: `pg_basebackup` waits silently until the primary starts sending replication data ([GitLab](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/)). That wasn't clearly documented in GitLab's engineering runbooks. So under pressure, engineers kept trying fixes for a problem that might not have existed, and each attempt was another destructive step on a production host.

**Second: "If something goes wrong, we have backups."** GitLab listed its safety nets: daily `pg_dump` uploaded to S3, daily LVM snapshots, Azure disk snapshots, and replication to the secondary. Four mechanisms is the kind of list that makes a team feel covered.

## What was actually going on

### Why the secondary needed a rebuild at all

PostgreSQL streaming replication works by shipping the **write-ahead log** (WAL) from primary to standby. Every change is written to the WAL first, and the standby replays it. The primary keeps a limited amount of WAL. If the standby falls far enough behind that the segments it needs have been recycled, it can't catch up. It has to be reseeded from a full copy.

The usual protection is **WAL archiving**: copying finished segments somewhere durable so a lagging standby, or a point-in-time restore, can fetch them. Without it, a load spike that delays replication can force a full rebuild. That's what happened, and a full rebuild means emptying a data directory, which is the dangerous step.

### Why the wipe hit the primary

The postmortem doesn't give terminal details beyond the hostnames: the primary was `db1.cluster.gitlab.com` and the secondary `db2.cluster.gitlab.com` ([GitLab](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/)). Two hosts whose names differ by one character, during an incident. One of the follow-up issues was to update the shell prompt (PS1) on all hosts to tell hosts and environments apart more clearly, in other words to make the shell prompt shout which machine you're on.

### Why every backup failed

This is the real lesson. Going through GitLab's list:

**pg_dump to S3.** The S3 bucket was empty. The backup job ran `pg_dump` 9.2 against a PostgreSQL 9.6 database, and a major-version mismatch makes `pg_dump` exit with an error. The mismatch came from GitLab's Omnibus package: it picks which PostgreSQL binaries to use by reading `PG_VERSION` in the local data directory, and defaults to 9.2 if it doesn't find 9.6. The backup ran on an application server, which has no data directory, so it got 9.2 ([GitLab](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/)).

The cron job did send failure emails. But the emails weren't DMARC-signed, so the receiving mail server rejected them. Nobody knew the backups were failing until it was too late.

```diagram
title: why nobody knew backups were empty
flow: cron pg_dump 9.2 -> fails on 9.6 db -> sends failure email
flow!: email not DMARC -> rejected -> silence
note: a failure alert that can't be delivered looks like success
```

**Azure disk snapshots.** These were enabled for NFS servers but not database servers, because GitLab assumed its other backup procedures were enough. Restoring them across storage accounts could also take hours or days.

**Replication.** The secondary's data had just been wiped as part of the rebuild. Replication protects against a host dying. It gives no protection against a destructive command, because it copies that command too.

**LVM snapshots.** These existed, but only to refresh staging. There were two: the daily one, almost 24 hours old, and the manual one from 17:20, about six hours old.

The "5 whys" section of the postmortem ends on the organisational root: "Why was the backup procedure not tested on a regular basis? - Because there was no ownership, as a result nobody was responsible for testing this procedure" ([GitLab](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/)).

## How they fixed it

GitLab restored from the 17:20 LVM snapshot, the only option that didn't lose almost 24 hours. Staging snapshots have webhooks stripped out (so staging doesn't fire them), so the team copied the staging database to production and separately rebuilt a database from the raw snapshot to recover the webhooks. It also incremented all database sequences by 100,000 so that IDs possibly handed out before the outage wouldn't be reused ([GitLab](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/)).

The slow part was storage. Staging ran on Azure classic without Premium Storage, on network disks throttled to around 60Mbps. Copying the data from staging to production took [around 18 hours](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/). The database was restored without webhooks on February 1 at 17:00 UTC, and the final steps, including webhooks, were done around 18:00 UTC.

A note on the exact loss window: the post's introduction says changes between 17:20 and 00:00 UTC were lost, while its later data-loss section says 17:20 to 23:30 UTC ([GitLab](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/)). Both figures are from the same post.

## What changed afterwards

GitLab published a list of issues ([GitLab](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/)), including:

- Prometheus monitoring for backups, so a missing backup raises an alert instead of relying on an email
- automated testing of restoring PostgreSQL backups
- investigating point-in-time recovery and continuous WAL archiving, plus WAL-E and pgbarman
- hourly LVM snapshots and Azure disk snapshots of production databases
- setting `max_connections` to a sane value
- better replication runbooks
- clearer shell prompts per host and environment
- assigning an owner for data durability

GitLab also explicitly chose not to focus on blocking commands. Aliasing `rm` to something safer, it notes, only protects against one kind of mistake, not against disk corruption or the many other ways to lose data. It focused on making recovery fast and routine.

## The rule

A backup you have never restored from is a hope, not a backup: give it an owner and test restores on a schedule.

## Sources

- [Postmortem of database outage of January 31](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/): GitLab's official postmortem, published February 10, 2017. It is the source for the timeline, the configuration values, the backup failure chain, the restore procedure, the data-loss estimates and the follow-up issue list.
