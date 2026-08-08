---
id: 1
title: "One keyword turned an instant migration into a two-minute outage"
dek: "ADD COLUMN can be instant. AFTER makes it a full table rebuild — and on 100 million rows, a rebuild is a locked table."
date: 2026-08-08
time_lost: 2
root_cause: wrong-assumption
detected_by: alert
stack: [mysql, innodb, node20]
rule: "Write ALGORITHM=INSTANT, LOCK=NONE explicitly. Let the database refuse the migration instead of silently rebuilding the table."
---

# #001 — One keyword turned an instant migration into a two-minute outage

I added a nullable column to our chat table. One column, no default value to backfill, no index.
The kind of migration you run without thinking about it.

```sql
ALTER TABLE chats
  ADD COLUMN classification_meta LONGTEXT NULL DEFAULT NULL AFTER classification_type;
```

It ran for two minutes. The table was locked for all two of them, and roughly ten thousand requests
failed while it did.

## What I thought was wrong

Nothing, initially — I thought the migration was safe, so when errors spiked I went looking at the
application. Bad deploy, connection pool exhausted, something downstream.

The belief underneath it: **adding a nullable column is a metadata change.** No rows to rewrite, no
default to backfill, so the database just updates the schema and moves on. That's true. It's also
exactly what MySQL does — right up until you tell it where to put the column.

## What was actually wrong

`AFTER classification_type`.

A column appended to the end of a table can be added instantly, because every existing row stays
byte-for-byte where it is. The moment you specify a position, that stops being true — the column has
to physically sit between two others, so every row has to be rewritten. That's a full table rebuild.

```diagram
title: same column, two very different migrations
flow: ADD COLUMN at end -> rows stay put -> instant, no lock
flow!: ADD COLUMN AFTER x -> every row rewritten -> 2 min, table locked
note: one word apart
```

The table had ~100 million rows. The rebuild took two minutes, and it held a lock the whole time.

`AFTER` was pure cosmetics. I wanted the new column next to the one it related to, so it would read
nicely in `DESCRIBE`. That preference cost two minutes of downtime.

## The fix

Drop the positioning. Let it go to the end:

```sql
ALTER TABLE chats
  ADD COLUMN classification_meta LONGTEXT NULL DEFAULT NULL,
  ALGORITHM=INSTANT, LOCK=NONE;
```

The second line is the part that matters, and not because it makes anything faster. If MySQL
*can't* do it instantly, it throws an error instead of quietly falling back to a rebuild. The
migration fails in one second in code review, rather than succeeding in two minutes in production.

## The rule

> Write `ALGORITHM=INSTANT, LOCK=NONE` explicitly on every `ALTER TABLE`. Let the database refuse
> the migration instead of silently rebuilding the table.

Silent fallback is the real hazard here. The dangerous migration and the safe one are one word
apart, and nothing in the output tells you which one you just ran — until the error rate does.

Column order is cosmetic. A table rebuild is not.

What's the smallest schema change that's ever taken you down?
