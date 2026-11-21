---
title: "Facebook's self-healing config check sent the whole site to the database"
dek: "An automated system replaced bad cached config values with the copy from the database. Then the database copy itself was the bad value, and every client tried to fix it at once."
date: 2010-09-23
company: Meta
kind: outage
topics: [config-change, cache, automation, cascading-failure]
stack: [cache, database]
duration_min: 150
impact: "Facebook was down or unreachable for many users for approximately 2.5 hours, the worst outage it had had in over four years."
rule: "Automatic repair must never assume that the place it repairs from is correct, and a failed repair must never count as a reason to try again."
postmortem: https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919
sources: [https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919]
---

# Facebook's self-healing config check sent the whole site to the database

On September 23, 2010, Facebook was [down or unreachable for many users for approximately 2.5 hours](https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919). Robert Johnson of Facebook Engineering wrote that same evening that it was "the worst outage we've had in over four years."

The cause was not a hardware failure or a bad code deploy. It was a safety system: an automated checker built to find invalid configuration values in the cache and repair them from the database. On that day it took down a database cluster, then kept it down after the original problem was fixed, until engineers had to switch off the site to stop it.

Johnson's summary is one line: "[An automated system for verifying configuration values ended up causing much more damage than it fixed.](https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919)"

## What happened

Facebook's post describes the system this way. Configuration values lived in two places: a **persistent store** (the authoritative copy, in a cluster of databases) and a **cache** that clients read from. An automated system [checked for configuration values that were invalid in the cache and replaced them with updated values from the persistent store](https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919).

On the day of the outage, Facebook changed the persistent copy of a configuration value. The new value [was interpreted as invalid](https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919). What followed:

1. Every client read the value, saw it was invalid, and tried to fix it.
2. The fix was a query to the database cluster, which was soon [overwhelmed by hundreds of thousands of queries a second](https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919).
3. When a client's database query failed, the client treated the failure as an invalid value and **deleted the corresponding cache key**.
4. So even after the original bad value was corrected, the queries kept coming. Every failed query made another query more likely.

Facebook called it "[a feedback loop that didn't allow the databases to recover](https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919)."

## What the engineers believed

The checker was built for a particular failure, and Facebook's post names it. The design "[works well for a transient problem with the cache, but it doesn't work when the persistent store is invalid](https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919)."

Two beliefs were built into it:

- **The database is the source of truth.** If the cache and the database disagree, the cache is wrong. That's what "source of truth" means. But it carries a hidden corollary: the database copy is *valid*. The repair logic had no plan for the case where the authoritative copy was the problem.
- **An error is evidence of a bad value.** If the client can't read a good value, delete the cached one so the next read refetches it. For a single corrupted cache entry, that's sensible. For a database under load, it's fuel for the fire.

Each belief is reasonable on its own and was probably true for every incident the checker had handled before. That day, both turned out to be false at once.

## What was actually going on

### The normal cache-aside pattern

Most read-heavy systems put a cache in front of a database using *cache-aside* (also called look-aside):

```
value = cache.get(key)
if value is missing:
    value = db.query(key)
    cache.set(key, value)
return value
```

The cache works only because nearly all reads are hits. If the hit rate drops from 99.9% to 0%, the database's load rises by about a thousand times. Facebook's post doesn't give its hit rates. The general point is that the database behind a big cache is sized for the *misses*, not for total traffic. A cache in front of a database is a load multiplier the database is quietly relying on.

### What the checker added

Facebook's checker added a validity step:

```
value = cache.get(key)
if value is missing or invalid(value):
    value = db.query(key)      # may fail under load
    if query failed:
        cache.delete(key)      # treat error as invalid value
    else:
        cache.set(key, value)
```

Walk through the incident with that sketch. (It is an illustration of the behavior Facebook describes, not Facebook's code.)

- The database now holds a value that `invalid()` rejects. Every client that reads the cache gets an invalid value and queries the database. Repairing doesn't help: what comes back is the same invalid value, so the next read queries again. The cache has stopped absorbing load for this key.
- Every client in the fleet is doing this at once. That's the "[hundreds of thousands of queries a second](https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919)."
- The database starts timing out. A timeout takes the error branch, which deletes the cache key. Now even clients that would have read a good cached value find nothing and go to the database too.
- Someone fixes the persistent value. It doesn't matter. Clients still can't get through to read it, and each failure deletes the key again.

```diagram
title: the repair loop that fed itself
flow: invalid in cache -> query database -> repair cache
flow!: db overloaded -> query errors -> delete cache key -> more queries
note: errors were treated as invalid values, so load created more load
```

### Why fixing the original cause didn't help

This is the property that makes an incident a *metastable* failure rather than an ordinary one. The trigger (the bad config value) starts the overload, but the overload keeps itself going after the trigger is gone. The system has two stable states, healthy and overloaded, and it needs a push to get from one to the other in *either* direction. Rolling back the change that caused the problem isn't enough of a push to get back.

You see the same shape in retry storms, where clients retry on timeout and the retries cause more timeouts, and in thundering-herd cache misses. Facebook's case had two features that made it worse:

1. **Every client did the same thing at the same moment.** The behavior was deterministic, with no jitter, sampling or leader election.
2. **The error path increased the miss rate.** In a plain retry storm, failed requests come back. Here, failed requests also *removed* cached data, so even requests that would have succeeded turned into misses.

## How they fixed it

The only way out was to remove the load entirely. Facebook [had to stop all traffic to this database cluster, which meant turning off the site](https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919). With no client traffic, the databases recovered. With the root cause fixed, they then [slowly allowed more people back onto the site](https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919).

Both parts mattered. Draining all traffic broke the loop. Letting traffic back in slowly kept the cold cache from causing a second stampede. When every client comes back to an empty cache at once, the database sees the same miss storm as before, only now for an innocent reason.

## What changed afterwards

Two changes are stated in the post:

- For the time being, Facebook [turned off the system that attempts to correct configuration values](https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919).
- It was exploring new designs for the configuration system, "following design patterns of other systems at Facebook that deal more gracefully with feedback loops and transient spikes."

The post doesn't say what those patterns were. In general, the techniques that defuse this shape are:

- **Serve stale rather than nothing.** If the refetch fails, keep using the last good value. An error is never a reason to delete what you have.
- **Validate before you publish.** Reject an invalid value at write time, when one writer can be stopped, rather than at read time across the whole fleet.
- **Coalesce refetches.** Only one request per key goes to the database (single-flight, or a lease on the key). Everyone else waits for it or serves stale data.
- **Bound the repair rate.** Limit or jitter how often a client may repair. Automatic healing should have a budget.

## The rule

Self-healing code needs two guards. It must not assume that the source it repairs from is correct: when the authoritative copy is the bad one, "repair" means copying the problem everywhere. And a failed repair must not be treated as a reason to repair harder. If your error path generates more load than your success path, you have built a feedback loop, and it will run until someone turns the site off.

## Sources

- [Facebook Engineering note: "More details on today's outage" by Robert Johnson (September 23, 2010), via the Internet Archive](https://web.archive.org/web/2011/http://www.facebook.com/notes/facebook-engineering/more-details-on-todays-outage/431441338919). Facebook's postmortem: the configuration checker, the invalid persistent value, the feedback loop, the shutdown and the follow-up changes.
