---
id: 1
title: "One keyword turned an instant migration into a two-minute outage"
dek: "ADD COLUMN can be free. AFTER makes it copy every row. On ~100 million rows that's a locked table, and MySQL picks between the two silently."
date: 2026-08-08
time_lost: 2
root_cause: wrong-assumption
detected_by: alert
stack: [mysql, innodb, node20]
rule: "Write ALGORITHM=INSTANT, LOCK=NONE explicitly. Let the database refuse the migration instead of silently rebuilding the table."
---

# #001 — One keyword turned an instant migration into a two-minute outage

I added a nullable column to our chat table. One column, no default to backfill,
no index. The kind of migration you run without thinking about it.

```sql
ALTER TABLE chats
  ADD COLUMN classification_meta LONGTEXT NULL DEFAULT NULL AFTER classification_type;
```

It ran for two minutes. The table was locked for all two of them, and roughly ten
thousand requests failed while it did.

The word that cost me is `AFTER`. Below is why that word is expensive, which
requires explaining how InnoDB actually stores a row — because that's the thing I
didn't understand, and everything else follows from it.

## What I thought was wrong

Nothing about the migration, initially. I was confident it was safe, so when the
error rate spiked I went looking at the application: bad deploy, connection pool
exhausted, something downstream timing out. I spent the first stretch of the
incident investigating the wrong system entirely, because I'd already mentally
filed the schema change under "done, harmless".

The belief underneath that: **adding a nullable column is a metadata change.**
There are no values to write — every existing row is `NULL` for the new column —
so surely the database just records "this table now has one more column" and
moves on.

That belief is correct. It's also exactly what MySQL does. It stops being true the
moment you tell it *where* to put the column, and I didn't know those two facts
were connected.

## How InnoDB stores a row

To see why position matters, you have to stop thinking of a row as a dictionary
of named fields and start thinking of it as **bytes laid out in order**.

InnoDB stores each row as a header followed by its column values packed
back-to-back in a fixed order. There are no field names in the row — the names
live once, in the table's data dictionary. To read `classification_type` the
engine looks up "column 7" and walks to the right offset.

That layout is why appending is free:

- **Add a column at the end.** Every existing row's bytes are already correct. The
  new column is simply *absent* from old rows, and InnoDB records "rows written
  before version N don't have this column; if you don't find it, it's the default."
  Nothing on disk is touched. This is what MySQL calls **`ALGORITHM=INSTANT`**, and
  it finishes in milliseconds on a table of any size — ten rows or a billion, same
  cost, because the work is O(1) metadata.

- **Insert a column in the middle.** Now the byte offsets of every column after it
  shift. There's no way to express "column 8 moved" as metadata, because the
  positions are implicit in the layout. The only way to make the table match the
  new definition is to write out every row again in the new order.

```diagram
title: what the row bytes actually do
flow: add at END -> old row bytes still valid -> metadata only, instant
flow!: add with AFTER -> every offset after it shifts -> rewrite all ~100M rows
note: same column. same nullability. different cost.
```

`AFTER` was pure cosmetics. I wanted the new column next to the one it related to
so `DESCRIBE chats` would read nicely. That preference is worth exactly nothing,
and it cost two minutes of downtime.

## The three algorithms, and why MySQL won't tell you which it picked

Every `ALTER TABLE` runs one of three ways. The names matter because the failure
modes are completely different.

| Algorithm | What it does | Cost on a big table |
| --- | --- | --- |
| `INSTANT` | Updates the data dictionary only. No rows touched. | Milliseconds, any size |
| `INPLACE` | Rebuilds the table, usually without a full copy, often allowing concurrent reads and writes | Minutes to hours |
| `COPY` | Builds a whole new table, copies every row in, swaps | Slowest, blocks writes |

The trap: **if you don't specify one, MySQL picks the fastest algorithm it can
support and does not tell you.** The statement succeeds either way. The only
externally visible difference between the instant version and the rewrite version
is how long your prompt sits there — and, if you're unlucky, your error rate.

There's a second trap on top of that one. Which operations qualify for `INSTANT`
has **changed between MySQL versions.** Instant `ADD COLUMN` arrived in 8.0.12,
and in those early versions the new column had to go *last* — using `AFTER` or
`FIRST` disqualified it. Later 8.x versions relaxed the positional restriction.
So the same migration, byte for byte, can be instant on one server and a full
rebuild on another.

This is the actual lesson, and it's bigger than one keyword. **You cannot read a
migration and know what it will do.** The answer depends on your server version,
your column type, your row format, and which clauses you used. Check `SELECT
VERSION();` on the box you're actually migrating, not the one on your laptop.

## The lock is worse than the rebuild

Two minutes of rebuilding wouldn't have taken the table down on its own. A rebuild
under `INPLACE` with `LOCK=NONE` lets reads and writes continue.

What took it down is the **metadata lock**. Every `ALTER TABLE` needs an exclusive
metadata lock briefly, and — this is the part that gets people — that lock queues.
Once the `ALTER` is waiting for its lock, every query that arrives behind it also
waits, including plain `SELECT`s that would otherwise be untouched by a schema
change. The queue forms behind the writer, not behind the rebuild.

So the failure isn't "the table was slow for two minutes". It's "everything
touching this table piled up behind one statement, and connections ran out". That's
why ten thousand requests failed rather than ten.

## The fix

Drop the positioning, and say out loud what you expect:

```sql
ALTER TABLE chats
  ADD COLUMN classification_meta LONGTEXT NULL DEFAULT NULL,
  ALGORITHM=INSTANT, LOCK=NONE;
```

Naming the algorithm does not make it faster. It makes MySQL **refuse**. If the
operation can't be done instantly on this server, you get:

```
ERROR 1845 (0A000): ALGORITHM=INSTANT is not supported for this operation.
Try ALGORITHM=COPY/INPLACE.
```

That error is the entire point. It's a one-second failure in code review instead
of a two-minute success in production. You've converted a silent, environment-
dependent performance cliff into a loud, deterministic assertion — which is what
you want from anything that runs against production.

`LOCK=NONE` does the same job for the lock: if the operation would need to block
readers or writers, the statement errors instead of blocking them.

## How to not do this again

Concrete, in the order I'd apply them:

1. **Always state `ALGORITHM=` and `LOCK=` on every `ALTER TABLE`.** Make it a
   review rule. A migration without them is a migration whose behaviour nobody has
   decided.
2. **Never use `AFTER` or `FIRST` in production.** Column order is cosmetic and the
   cost is not. If you want related columns adjacent, that's what a view is for.
3. **Test on a table with production-scale rows**, not an empty staging table.
   Every dangerous migration in this class is instant on 100 rows. Row count is the
   only thing that separates the safe version from the outage.
4. **Know your escape hatch.** When a rewrite genuinely is required — changing a
   column type, adding an index to a huge table — that's what `pt-online-schema-change`
   and `gh-ost` exist for. They build a shadow table, backfill it in throttled
   chunks, keep it in sync with triggers or the binlog, and swap at the end. Slower
   in wall-clock, no outage.
5. **Check the version on the box that matters.** `SELECT VERSION();` before you
   assume anything in this post applies to you.

## The rule

> Write `ALGORITHM=INSTANT, LOCK=NONE` explicitly on every `ALTER TABLE`. Let the
> database refuse the migration instead of silently rebuilding the table.

The dangerous migration and the safe one are one word apart, they produce the same
success message, and which one you ran depends on a server version you probably
didn't check. The only defence is to stop asking the database to guess and start
telling it what you require.

Column order is cosmetic. A table rebuild is not.

What's the smallest schema change that's ever taken you down?
