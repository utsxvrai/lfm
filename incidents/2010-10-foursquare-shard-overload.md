---
title: "Foursquare's 11-hour outage: adding a shard to an overloaded one took the site down"
dek: "One database shard was getting too many check-ins. Foursquare added a new shard to take load off it, and the site went down. Moving the data didn't free the memory they expected, because of fragmentation."
belief: "Foursquare thought it could add a shard with the site up. The overloaded shard took the site down."
date: 2010-10-04
company: Foursquare
kind: outage
topics: [database, capacity, migration, storage]
stack: [mongodb]
duration_min: 660
impact: "Foursquare was down for about 11 hours; the company said no data was lost."
detected_by: engineers
rule: "Rebalance before a shard is in trouble. Migrating data off a shard that is already overloaded adds load, and moving data out of a fragmented store doesn't give memory back."
postmortem: https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/
sources: [https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/]
---

# Foursquare's 11-hour outage: adding a shard to an overloaded one took the site down

On October 4, 2010, Foursquare, the location check-in app, went down for [about 11 hours](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/). The next day the company published a short, frank postmortem titled "So, that was a bummer." It said the team was [32 people](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/) and that the outage was "unacceptably long."

The outage didn't start with a crash. It started with a capacity fix. One database shard was overloaded, so the team added a new one to take load off it, and that step took the entire site down. The data they then moved off the hot shard [did not free up as much space as anticipated](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/).

The post is brief, and the company itself wrote that some of the causes were "[not entirely clear to us right now](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/)." This write-up keeps to what it says and marks where general background fills in the mechanism.

## What happened

Most of Foursquare's data was user check-in history. Per the post, it was [spread evenly across multiple database "shards"](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/), each of which "can only store so many check-ins," and the database was partitioned by user ID. The database was MongoDB; the post says its makers were "[working very closely with us](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/)" on the problem.

The timeline, all times EST, from the post:

| Time | Event |
| --- | --- |
| ~11:00am | The team noticed one shard performing poorly because [a disproportionate share of check-ins were being written to it](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/) |
| ~11:00am to 12:30pm | Tried "various measures to ensure a proper load balance." None worked |
| After 12:30pm | Introduced a new shard, planning to move data to it in the background with the site up. Adding the shard [caused the entire site to go down](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/) |
| Next ~5 hours | Tried different ways to migrate data and restart. Each time, the initial shard overloaded again |
| 6:30pm | Decided to [re-index the shard](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/) to address "memory fragmentation and usage issues" |
| 11:30pm | Site back up after about five hours of re-indexing and testing for data loss and corruption |

## What the engineers believed

The plan was sensible and textbook: when a shard is full, add a shard and move some data to it. Two assumptions sat under that plan.

1. **The migration could run in the background, with the site up.** The post says so directly: "[We wanted to move this data in the background while the site remained up.](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/)"
2. **Moving data off a shard frees resources on that shard in proportion to the data moved.** Move a third of the check-ins and the shard should have about a third more room.

Neither held. Adding the shard took the site down, and the move freed less than expected, "[partially because of data fragmentation, partially because our database is partitioned by user ID](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/)."

## What was actually going on

Foursquare's post doesn't give a byte-level explanation, and it says some of the cause wasn't yet clear. What follows is general background on why these two assumptions fail in sharded databases. It is interpretation, not Foursquare's stated analysis.

### Why an "even" shard key can still produce a hot shard

Partitioning by user ID spreads *users* evenly. It doesn't spread *activity* evenly. A shard's load is the sum of what its users do, and users vary a lot: some check in a few times a month, some many times a day. If a range of user IDs holds more heavy users, or the chunk boundaries for that range were set when those users were less active, one shard can collect a disproportionate share of writes. Foursquare reported exactly that symptom: a disproportionate share of check-ins going to one shard.

The post also shows why that's hard to fix quickly. Data is placed by user ID, so a single user's check-ins can't be split across shards to even things out. You can only move whole groups of users, and the groups you move may not hold the hot data.

### Why migrating off an overloaded shard makes it worse first

Moving data between shards is not free for the source. It has to:

- **Read** every document being moved, often data that's cold and not in memory, pulling it in from disk.
- **Keep serving** normal reads and writes for those documents while the copy runs.
- **Delete** the moved documents once the copy is done, which is more writes.

So a rebalance adds load to the busiest node at exactly the moment it has no capacity to spare. That's a general property of live migration, and it fits what Foursquare saw: each attempt "[encountered the same problem of overloading the initial shard](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/)." A shard can be rebalanced cheaply only while it still has headroom.

### Why deleting data doesn't give memory back

This is the part the post names directly: "data fragmentation." In many storage engines, especially ones that map data files into memory, deleting a document leaves a hole in the data file instead of shrinking it. The page holding that hole still contains the other documents. If the documents that stayed are scattered across most pages, those pages are all still "hot," and the amount of memory the database needs to cover its working set hardly drops.

```diagram
title: why moving data off didn't help
flow: move 1/3 of docs -> holes in data pages -> pages still needed
flow: rebuild / compact -> live data packed -> fewer pages needed
note: deleting documents is not the same as freeing memory
```

Here's an analogy. If you remove every third book from every shelf in a library, you haven't freed any shelves. You've made every shelf a third empty. To free shelves, you have to repack. Foursquare's fix, a re-index described as addressing "[memory fragmentation and usage issues](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/)," was the repacking step.

### Why the repair took five hours

A rebuild has to read and rewrite the shard's data and indexes. On a large shard that takes hours however fast the hardware is. Foursquare also chose to include "[extensive testing against data loss and data corruption](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/)" before bringing the site back. Given that the alternative was risking users' check-in histories, that was the right call, and it's why the total came to about five hours.

## How they fixed it

At 6:30pm EST the team stopped trying to migrate around the problem and re-indexed the overloaded shard instead. The site came back at 11:30pm. The post says that "[because of our safeguards and extensive backups, no data was lost](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/)," and that the company now had "more shards and no danger of overloading in the short-to-medium term."

## What changed afterwards

Foursquare listed three areas of technical work:

- Working with the makers of MongoDB to [better deal with the problems we encountered](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/).
- Changing operational procedures to prevent overloading and to add safeguards so the site stays up.
- Looking at "[artful degradation](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/)": turning off some features under overload rather than letting the whole site go down.

It also changed how it communicates during outages: downtime messages from @4sqsupport, updates at least hourly, a new status blog at status.foursquare.com, and a more informative error page in place of a static graphic that the post admits said they were upgrading servers, "[which was not completely accurate](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/)."

## The rule

Rebalance while you still have headroom. Migration costs the source shard more before it saves anything, so the best time to split a shard is when it's at 60% and the worst time is when it's on fire. And measure what your database actually needs in memory, not just how much data it stores. In a fragmented store, deleting data doesn't free memory until you compact or rebuild.

## Sources

- [Foursquare blog: "So, that was a bummer." (October 5, 2010), via the Internet Archive](https://web.archive.org/web/2010/http://blog.foursquare.com/2010/10/05/so-that-was-a-bummer/). Foursquare's postmortem: the hot shard, the failed shard addition, fragmentation, the re-index, the timeline and the follow-up changes.
