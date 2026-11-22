---
title: "Basecamp 3 went read-only when its events table ran out of 32-bit IDs"
dek: "The table that records nearly every action in Basecamp 3 used a regular integer primary key. At 2,147,483,647 inserts stopped, and the fix was a column type change on a very large table that took hours."
belief: "Basecamp thought it had headroom on its events table IDs. It ran out of 32-bit integers and went read-only."
date: 2018-11-08
company: Basecamp
kind: outage
topics: [database, capacity, migration]
stack: [rails, sql]
impact: "Basecamp 3 was stuck in read-only mode for almost five hours; users could read existing data but could not post or change anything."
detected_by: alert
rule: "Every auto-increment column has a ceiling. Monitor how close each one is, and widen it while you still have months of headroom, because widening a big table is itself an hours-long operation."
postmortem: https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/
sources: [https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/, https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/]
---

# Basecamp 3 went read-only when its events table ran out of 32-bit IDs

In November 2018 Basecamp 3 spent [almost five hours in read-only mode](https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/). Users could open existing messages, to-do lists and files, but ["no new information could be entered, and no existing information could be altered"](https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/).

Nothing crashed and no data was lost. A counter reached its maximum. The table that records almost every action in Basecamp had a primary key declared as a regular integer, and it hit [2,147,483,647](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/), the largest value a signed 32-bit integer can hold. Once there were no more IDs, there were no more inserts, and once there were no more inserts, Basecamp could not do anything that changed state.

Basecamp's CTO, David Heinemeier Hansson, called it [the worst outage at Basecamp in probably 10 years](https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/). It took their Basecamp 3 uptime record from [99.998% to 99.978%](https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/).

A note on the date: the live update was posted on [8 November 2018](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/) and its title says "Nov 8". The later postmortem's title and text say ["Thursday, November 9th"](https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/). The two Basecamp sources disagree; this post follows the live update, which was written on the day.

## What happened

The timeline below comes from the [live update](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/), in US Central time:

| Time (CST) | Event |
|---|---|
| 7:21am | Alert: the database had run out of ID numbers on an important tracking table. |
| 7:29am | Team diagnosed the problem and started on a migration to change the column from integer to big integer. |
| 7:52am | Fix verified on a staging database; migration started on production. It was estimated to take [about one hour and forty minutes](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/). |
| 10:56am | Database upgrade completed. Verification and configuration updates still to do. |
| 11:52am | Verification taking longer than expected across 8 databases (4 per data center, 2 data centers). |
| 12:22pm | Basecamp back online after data was verified intact. |
| 12:33pm | A caching server was overwhelmed by the load of the application coming back. Basecamp down again. |
| 12:41pm | Back online after switching to backup caching servers. |

The sources differ slightly on the end time. The postmortem gives the read-only period as [7:21am to 12:11pm CST](https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/); the live update reports the site back at 12:22pm and then briefly down again from 12:33pm.

The update also says all data was confirmed safe and intact and that [no emails sent to Basecamp during the outage were dropped](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/).

## What the engineers believed

They were not unaware. The postmortem says the team was ["actively working on expanding the capacity of the events table in the days prior to this outage"](https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/). The mistake was about speed: they ["failed to properly account for how quickly we were running out of headroom"](https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/).

That is the quiet assumption in most ID-exhaustion incidents. Two billion feels like an unreachable number, and the work to widen the column feels like something that can be scheduled. Both feelings are wrong for a table that grows with every user action. The remaining headroom shrinks at the table's write rate, and the fix itself takes hours, so "we're working on it" has to start long before the counter is close.

The framework had already moved on. Heinemeier Hansson, who created Ruby on Rails, notes that [Rails 5.1, released in 2017](https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/), changed the default primary key so the ceiling went from 2,147,483,647 to 9,223,372,036,854,775,807. (The live update describes that change as happening [two years ago](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/); the postmortem says 2017.) New defaults only apply to tables created after the upgrade. Existing tables keep the column type they were created with until someone changes it.

## What was actually going on

### Why one table could freeze the whole app

The table was the **events** table. Per the postmortem, ["almost every single activity in Basecamp is tracked in this table"](https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/): posting a message, updating a to-do list, applauding a comment. Every write action in the product also writes an event row. So when the events table couldn't accept rows, every action that would have written one failed, and Basecamp was effectively read-only.

That coupling is also why the table was the one to run out. It grows with the total activity of every customer, not with the number of customers or projects. It is, as the update put it, very large, ["That's why it ran out of regular integers"](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/).

### What an integer primary key actually is

Background: an auto-increment primary key is a counter kept by the database. Each insert takes the next value and stores it in the ID column. The column has a fixed-width type, and that type decides the ceiling:

- A signed 32-bit `INT` holds values up to 2³¹ − 1 = 2,147,483,647.
- A signed 64-bit `BIGINT` holds values up to 2⁶³ − 1 = 9,223,372,036,854,775,807.

Both numbers match the [figures Basecamp gives](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/). At 2.1 billion, the 32-bit counter has nowhere to go. The sources don't describe the error the application saw. In general, databases refuse the insert rather than wrap around, because wrapping would collide with existing IDs; an insert that would need ID 2,147,483,648 fails.

Two details make this easy to miss:

1. **The counter only goes up.** Deleted rows don't free their IDs, and failed or rolled-back inserts can consume IDs too, depending on the engine. The table can hold far fewer than two billion rows and still be at the ceiling. What runs out is the counter, not the space.
2. **Nothing degrades beforehand.** Inserts are exactly as fast at ID 2,147,483,646 as at ID 1. There is no warning sign in latency or error rates. The only signal is the number itself, and someone has to be watching it.

### Why the fix took hours

The fix was the same one Rails had adopted as its default: change the column from `integer` to `bigint`. Basecamp wrote ["a database migration where you change the column type from the regular integer to the big integer type"](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/).

Background: changing a column from 4 bytes to 8 bytes changes the layout of every row on disk, and the primary key is also the key of the table's main index. Most databases can't do that as a metadata-only change; they rebuild the table, rewriting every row and every index that references the key. The cost is proportional to the table size. A table big enough to exhaust 32-bit IDs is, by definition, big. Basecamp's estimate was [about one hour and forty minutes](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/); the migration started at 7:52am and completion was reported at 10:56am.

```diagram
title: why a full counter means a long outage
flow: events table -> INT id -> 2,147,483,647
flow!: no new IDs -> every write fails -> rebuild as BIGINT
note: the fix rewrites the whole table, so it can't be instant
```

This is the trap. Done months earlier, the same migration can run during normal operation, using an online schema change tool or a replica-and-swap, while the old column keeps working. Done after the ceiling is hit, it has to run while the application is down, and the outage lasts as long as the rewrite.

### Why verification took longer than the migration

After the migration, Basecamp did not go straight back online. They had [4 databases per data center and two data centers](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/), 8 in total, and wanted to be sure all of them were in sync. The update says: ["99% sure isn't good enough. Need 100%."](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/) Changing the type of a primary key under replication is exactly the kind of operation where a copy can end up different, so checking before accepting writes again was a deliberate choice of longer downtime over risk of divergence.

### The second dip

When Basecamp came back at 12:22pm, the load of everyone returning at once overwhelmed a caching server, and the site went down again at 12:33pm until it was [switched to backup caching servers at 12:41pm](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/). The update doesn't go deeper than that. As interpretation: a recovery after hours of downtime brings a burst of pent-up traffic, often with cold caches, and the system has to survive a load it rarely sees in normal operation.

## How they fixed it

The integer columns were converted to big integers, which the postmortem describes as ["the same root-cause fix that we applied to our tables"](https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/) that Rails had made the default. After the migration, the team verified all 8 databases, updated configuration, brought the app back, and moved to backup caching servers when the first cache was overwhelmed.

## What changed afterwards

The postmortem is mostly an apology rather than a list of follow-up actions. Heinemeier Hansson writes that he ["should have been more vigilant with our own database schema when Rails 5.1 announced the new default"](https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/) and should have asked the right questions when remediation finally started. Basecamp chose to count the read-only time as a full outage in its uptime figures rather than call it a partial outage. The sources don't describe specific monitoring or process changes, so none are listed here.

## The rule

Every fixed-width counter is a countdown. For each auto-increment column, know the current value, the ceiling and the rate, and alert on the projected date, not on a percentage you'll only check when it's too late. Widen the column while you still have months of headroom, because the fix is a rewrite of the table: online and invisible when done early, an outage of the same length when done after the counter is full. And when your framework changes a default for safety reasons, check what that change means for the tables you created before it.

## Sources

- [DHH, "Update on Basecamp 3 being stuck in read-only as of Nov 8, 9:22am CST", Signal v. Noise](https://m.signalvnoise.com/update-on-basecamp-3-being-stuck-in-read-only-as-of-nov-8-922am-cst/): the live update posted on the day, with the timestamped timeline, the integer limits and the cache-server relapse.
- [DHH, "Postmortem on the read-only outage of Basecamp on November 9th, 2018", Signal v. Noise](https://m.signalvnoise.com/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/): the postmortem, naming the events table, the Rails 5.1 default change and the uptime impact.
