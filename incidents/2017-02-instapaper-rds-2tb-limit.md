---
title: "Instapaper's bookmarks table hit an invisible 2TB ext3 limit on RDS"
dek: "MySQL RDS instances created before April 2014 sat on ext3, which caps a single file at 2TB. Instapaper's replica-upgraded instance inherited the cap, and its backups inherited it too."
date: 2017-02-09
company: Instapaper
kind: outage
topics: [database, storage, capacity, backup]
stack: [mysql, aws-rds, ext3]
duration_min: 1860
impact: "31 hours of total downtime and five days of limited access to archives, with no loss of users' articles."
rule: "Know the hard limits under your managed service, including ones you inherited from an old instance, and plan recovery for the case where every backup shares the same flaw."
postmortem: https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f
sources: [https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f]
---

# Instapaper's bookmarks table hit an invisible 2TB ext3 limit on RDS

Instapaper, the read-it-later service, went down at [12:30PM PT on "Wednesday, February 9"](https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f) and stayed down until 7:30pm PT the next day. (The post was published on February 14, 2017. In 2017, February 9 was a Thursday; the post's weekday and date don't match, and this archive uses the date.) It came back with limited access to older articles, and full service returned on February 14.

The postmortem, by Brian Donohue, counts [31 hours of total downtime and five days of limited access](https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f). Instapaper says that in the end no users' articles were lost.

The cause was neither load nor a bad deploy. A single table grew past a file-size limit that came from a filesystem choice made years earlier by AWS. Nothing in the console showed that limit, and it applied equally to every backup Instapaper had.

## What happened

Instapaper's main datastore was MySQL on Amazon RDS. Its `bookmarks` table, which stores every article users save, crossed [the 2TB file size limit](https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f), and inserts into it started failing. For a read-it-later service, failing to save a bookmark means the product is down.

The history matters. Betaworks acquired Instapaper in April 2013 and moved it from Softlayer to AWS, with help from two devops contractors. The original RDS instance was created in June 2013. In early 2015, during performance problems in the backup window, AWS support advised upgrading from MySQL 5.6.18 to 5.6.19 or later. In March 2015 Instapaper created a read replica, upgraded it, and cut over with roughly 5 minutes of downtime ([Instapaper](https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f)).

## What the engineers believed

The belief was a natural one: **the instance created in 2015 is a 2015 instance.** Instances created after April 2014 run on ext4, with a 6TB file size limit. Instapaper's production database had been created in March 2015.

But it had been created *as a read replica* of the June 2013 instance, and "as such, inherited the same filesystem and 2TB file size limitation" ([Instapaper](https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f)).

The team also believed, reasonably, that RDS would warn them about anything that dangerous. Donohue writes that as far as they could tell there was nothing in the RDS console (monitoring, alerts or logging) that would have shown they were close to the limit, or subject to it at all. Even after the incident, there was nothing to show the hosted database had a critical issue. Any knowledge of the limit, he suggests, likely left with the 2013-era contractors.

## What was actually going on

### Why a filesystem limits a table

MySQL rows ultimately live in files on disk. With InnoDB's file-per-table mode, each table gets its own `.ibd` file holding its rows and indexes. The postmortem doesn't name the InnoDB setting, but a single table running into a *file* size limit is exactly what happens when one table is one file. A database can be much bigger than any one file, and Instapaper's was [2.5TB](https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f), but no single table's file can exceed the filesystem's maximum file size.

That maximum comes from how the filesystem addresses data. ext3 maps file contents through block pointers. With common block sizes, the most it can address for one file works out to a few terabytes (general background: with 4 KiB blocks, ext3's maximum file size is 2 TiB). ext4 changed the on-disk structures, allowing much larger files. RDS chose the filesystem per instance at creation time, and per Instapaper the boundary for MySQL was April 2014: [ext3 with a 2TB limit before, ext4 with a 6TB limit after](https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f).

### Why the replica inherited it

An RDS read replica isn't built by replaying SQL into a fresh, empty instance. It's seeded from the source's storage and then follows the source's changes. The storage layout, filesystem included, comes along. So "created in 2015" described the instance's metadata, not the bytes on disk. This is the kind of property that survives every migration that copies volumes rather than rebuilding them.

```diagram
title: how a 2013 limit reached 2015
flow: June 2013 RDS -> ext3 volume -> 2TB per file
flow!: 2015 read replica -> same ext3 volume -> bookmarks > 2TB
note: the upgrade copied the filesystem along with the data
```

### Why the backups didn't help

RDS kept [10 days](https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f) of automated daily backups. But they were filesystem snapshots, "subject to the 2TB file size limit" too. Restoring any of them would bring back the same full ext3 file. Every recovery point had the same flaw.

There were only two ways out, both expensive: a logical dump and restore into a fresh ext4-backed instance, or a replica on Aurora. Aurora wasn't an easy option because it ran only inside a VPC and Instapaper was still on EC2-classic. Donohue writes that it was unlikely they'd have done either in advance without knowing about the limit.

### Why the estimate was wrong

The team's first estimate for dumping the database was six to eight hours. That estimate was based on row count, and later they learned "the first 25 percent of Instapaper bookmarks account for only 10 percent of overall data" ([Instapaper](https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f)). Newer rows were bigger. The first dump took 24 hours and a parallelised second one took 10 hours. If you estimate a data operation by rows instead of bytes, you're assuming every row is the same size, and in a table that has grown for years they usually aren't.

## How they fixed it

After calls with AWS support and Pinterest's SRE team (Instapaper was by then part of Pinterest), the plan was a full dump and restore. Pinterest's SREs helped dump production onto a 5.5TB RAID-0 disk on an i2.8xlarge instance ([Instapaper](https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f)).

When it was clear the dump would take far too long, they switched to a contingency: a working instance with limited access to archives. Building it took roughly six hours, and it went live after 31 hours of downtime.

Then two recovery paths ran in parallel with RDS engineers over the weekend:

1. An Aurora read replica of the old database, risky because untested against Instapaper's code, finished in about 24 hours.
2. A new MySQL RDS instance: importing the data without secondary indexes took 8 hours, then each of three secondary indexes took roughly 16 hours.

Neither finished first. An Amazon engineer mounted an ext4 filesystem on the failed production database and rsynced the ext3 data across, which took roughly 8 hours and produced an ext4-backed instance with all data and indexes. RDS engineers then used row-based replication from the temporary production database's binary logs to catch up on changes made since Thursday, which took roughly three hours. Finally they promoted the new database and pointed the application at it.

Donohue notes that this fix (rsync at the filesystem level) was only possible with Amazon's direct help, since customers' only interface to RDS is MySQL itself. He also estimates that even perfect execution would have meant at least 10 hours of downtime.

## What changed afterwards

The action items were modest, and the post says plainly that "neither of the above action items would have prevented this issue" ([Instapaper](https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f)):

- escalate system-wide Instapaper outages immediately to Pinterest's SRE team
- test MySQL backups monthly instead of every three months
- keep using RDS. The RDS team took a feature request to show more information about ext3-backed databases.

Donohue takes responsibility for not knowing the limits of the technology and for the missing disaster recovery plan.

The general lesson for backend engineers: managed services remove operational work, not physical limits. The limits are still there, set by choices you didn't make and may not be able to see. The defence is to ask your provider for the hard limits of your specific instance (filesystem, max file or table size, IOPS, connection caps), to alert on growth toward them yourself, and to have at least one recovery path that doesn't share storage-level properties with production, such as a logical dump.

## The rule

Know the hard limits under your managed service, including ones you inherited from an old instance, and plan recovery for the case where every backup shares the same flaw.

## Sources

- [Instapaper Outage Cause & Recovery](https://web.archive.org/web/20260306053318/https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f): Brian Donohue's postmortem on the Making Instapaper blog, published February 14, 2017 (archive.org copy). It is the source for all times, sizes, durations, the RDS history and the recovery steps.
