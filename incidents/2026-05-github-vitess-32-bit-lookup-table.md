---
title: "GitHub widened a table's key to 64 bits but not its Vitess lookup table, and review comments stopped working"
dek: "GitHub had migrated the primary table behind pull request review threads to a 64-bit integer key. The Vitess lookup table that maps those IDs to shards stayed 32-bit. When the IDs passed the 32-bit range, almost every attempt to start a new review thread failed from 15:12 to 19:02 UTC."
date: 2026-05-06
company: GitHub
kind: bug
topics: [database, migration, monitoring]
stack: [vitess, mysql]
impact: "Creation of new pull request review threads, including line and file comments, failed at a near 100% rate; existing pull requests and comments were unaffected."
rule: "A key is only as wide as its narrowest copy. When you widen an ID column, find every index, lookup table, foreign key and client type that stores that ID, and widen them too."
postmortem: https://github.blog/news-insights/company-news/github-availability-report-may-2026/
sources: [https://github.blog/news-insights/company-news/github-availability-report-may-2026/, https://www.githubstatus.com/incidents/f5pb5d5mr9yh, https://vitess.io/docs/24.0/reference/features/vindexes/, https://dev.mysql.com/doc/refman/8.0/en/integer-types.html]
---

# GitHub widened a table's key to 64 bits but not its Vitess lookup table, and review comments stopped working

On 6 May 2026, between [15:12 and 19:02 UTC](https://github.blog/news-insights/company-news/github-availability-report-may-2026/), you couldn't leave a line comment on a GitHub pull request. Creating new pull request review threads failed, and that [included new line comments and file comments](https://github.blog/news-insights/company-news/github-availability-report-may-2026/). Existing pull requests and comments were fine, and so were top-level PR comments, opening and merging PRs, and Actions, according to the [status page updates](https://www.githubstatus.com/incidents/f5pb5d5mr9yh) posted during the incident.

The cause is one of the oldest bugs in databases: an integer ID ran out of room. The twist is that GitHub had already seen it coming and widened the column. It missed a second copy of the same ID.

GitHub's write-up is short, a paragraph in its [May 2026 availability report](https://github.blog/news-insights/company-news/github-availability-report-may-2026/) and the same text on the status page, so this post is short too. The Vitess and MySQL background comes from their documentation and is labelled as such.

## What happened

From the [status page](https://www.githubstatus.com/incidents/f5pb5d5mr9yh), all UTC:

- **15:12.** Thread creation starts failing (start time from the final summary).
- **15:25.** GitHub opens an incident for degraded performance on Pull Requests.
- **15:28.** "We are investigating failures for new thread creation on Pull Requests."
- **15:55.** Cause identified; mitigation started.
- **16:20.** A mitigation is being applied. Recovery will be gradual, with complete recovery expected by 8:00pm UTC.
- **17:52.** Partial recovery.
- **19:02.** Service fully restored (end time from the final summary).
- **19:04.** Full recovery posted, followed by the root-cause summary.

The availability report gives the incident a duration of ["3 hours and 39 minutes"](https://github.blog/news-insights/company-news/github-availability-report-may-2026/) measured from 15:25. That fits the time the incident was open on the status page. The impact window it states, 15:12 to 19:02, is longer. Both figures come from GitHub.

## What the engineers believed

GitHub's summary says the primary table [was migrated to a 64-bit integer key](https://github.blog/news-insights/company-news/github-availability-report-may-2026/). Someone had looked at the ID growth, seen it approaching the 32-bit limit, and done the expensive part: migrating a large, heavily used table to a wider key. With that done, the reasonable belief was that the ID space problem for review threads was solved.

That belief was true for the table. It wasn't true for the system, because in a sharded Vitess setup an ID can live in more than one table.

## What was actually going on

### How a Vitess lookup table works

*Background from the Vitess docs, not from GitHub's report.* Vitess shards MySQL. It decides which shard a row lives on using a "vindex" on some column. If you query by that column, Vitess can send the query straight to the right shard. If you query by a different column, it would have to ask every shard, unless you add a **lookup vindex**.

A lookup vindex is [implemented as a MySQL lookup table](https://vitess.io/docs/24.0/reference/features/vindexes/) that maps a column value to the shard location (the keyspace ID) of the row. When a row is inserted into the owner table, Vitess [creates the lookup row in the lookup table](https://vitess.io/docs/24.0/reference/features/vindexes/) as part of the same write. The docs note the cost: an extra write to the lookup table on every insert. The lookup row usually lives on a different shard from the row it points to.

So every new review thread meant two inserts: the thread row in the primary table, and a lookup row recording where to find it. Both stored the ID, each in its own column with its own type.

### Where the ID ran out

GitHub's summary: the incident [was caused by a 32-bit integer key reaching its maximum value in a Vitess lookup table used during pull request thread creation](https://github.blog/news-insights/company-news/github-availability-report-may-2026/). The primary table had been moved to 64-bit. The lookup table had not. Once IDs in the primary table [passed the available 32-bit ID space](https://github.blog/news-insights/company-news/github-availability-report-may-2026/), the lookup insert couldn't store them, and new thread creation failed at a [near 100% rate](https://github.blog/news-insights/company-news/github-availability-report-may-2026/).

```diagram
title: one ID, two column widths
flow: new review thread -> primary table 64-bit -> row stored
flow!: same thread ID -> lookup table 32-bit -> insert fails
note: the primary write was fine; the lookup write could not hold the ID
```

How big is "32-bit"? MySQL's `INT` is 4 bytes. Signed, its maximum is [2147483647](https://dev.mysql.com/doc/refman/8.0/en/integer-types.html); unsigned, [4294967295](https://dev.mysql.com/doc/refman/8.0/en/integer-types.html). `BIGINT` is 8 bytes. GitHub doesn't say whether the column was signed or unsigned, so I can't say which of those ceilings it hit, or what error the insert returned.

*My interpretation of why it failed so cleanly:* because the lookup row is written as part of creating the thread, it isn't an optional side index that can fall behind. If it can't be written, the thread can't be created. That's why the failure rate jumped to near 100% right away instead of degrading.

### Why it was missed

GitHub doesn't explain why the lookup table was left out of the migration. Its follow-up says it is [expanding existing monitoring of database columns to include Vitess lookup tables](https://github.blog/news-insights/company-news/github-availability-report-may-2026/). So GitHub already monitored columns for approaching their size limits, and lookup tables were outside that monitoring. *My interpretation:* the lookup table is defined in the Vitess schema rather than as part of the application's own tables, which makes it easy for both migrations and monitoring to overlook it.

## How they fixed it

GitHub [updated the impacted lookup table definitions across all shards to use 64-bit integer column types](https://github.blog/news-insights/company-news/github-availability-report-may-2026/), and service was fully restored once the schema change completed globally.

The cause was known early: the status page shows it identified at 15:55 UTC. What took the rest of the afternoon was applying a schema change to a lookup table on every shard of a production database. The [16:20 update](https://www.githubstatus.com/incidents/f5pb5d5mr9yh) already warned that recovery would be gradual and that full recovery was expected by 8:00pm UTC. Full restoration came at 19:02.

## What changed afterwards

GitHub lists one follow-up: column monitoring now [covers Vitess lookup tables](https://www.githubstatus.com/incidents/f5pb5d5mr9yh), to give notice in advance when any table is approaching a column size limit, before customers are affected.

## The rule

An ID isn't stored in one place. It's in the primary key, in every foreign key that points at it, in secondary indexes, in sharding lookup tables, in caches, in analytics pipelines, and in client code that parses it into an `int`. Widening the primary column only moves the limit to the narrowest of those copies.

Before you migrate a key to 64 bits, list every place that holds that value, including tables your sharding layer creates for you, and migrate them together. Then point your "column approaching its maximum" alert at all of those places, not only the tables you wrote yourself.

## Sources

- [GitHub, "GitHub availability report: May 2026"](https://github.blog/news-insights/company-news/github-availability-report-may-2026/): GitHub's monthly incident summaries, including the 6 May review-thread incident, its cause, mitigation, follow-up, and the "3 hours and 39 minutes" duration.
- [GitHub Status, "Incident with Pull Requests", 6 May 2026](https://www.githubstatus.com/incidents/f5pb5d5mr9yh): the live status updates with timestamps, and the same root-cause summary.
- [Vitess documentation, "Vindexes"](https://vitess.io/docs/24.0/reference/features/vindexes/): background on lookup vindexes, how their lookup tables are populated on insert, and their write cost.
- [MySQL 8.0 Reference Manual, "Integer Types"](https://dev.mysql.com/doc/refman/8.0/en/integer-types.html): storage sizes and ranges for `INT` and `BIGINT`.
