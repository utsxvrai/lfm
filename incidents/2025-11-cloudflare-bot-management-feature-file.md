---
title: "A ClickHouse permissions change doubled Cloudflare's Bot Management feature file and made the proxy panic"
dek: "A metadata query that never filtered by database started returning every column twice once users could see the underlying tables. The Bot Management feature file grew past a 200-feature preallocation limit, and the Rust proxy hit an unwrap() on the error. Because the file was regenerated every five minutes from a partly upgraded cluster, the network failed, recovered and failed again."
belief: "Cloudflare first suspected a DDoS attack. A doubled Bot Management feature file was crashing its proxy."
date: 2025-11-18
company: Cloudflare
kind: outage
topics: [config-change, database, software-bug]
stack: [clickhouse, rust, cdn, bot-management]
impact: "Cloudflare's network failed to deliver core network traffic, returning 5xx errors to visitors of customer sites; Cloudflare called it its worst outage since 2019."
detected_by: alert
rule: "Treat files your own systems generate with the same suspicion as user input. A size limit that is hit should reject the new file and keep the old one, not crash the process that serves traffic."
postmortem: https://blog.cloudflare.com/18-november-2025-outage/
sources: [https://blog.cloudflare.com/18-november-2025-outage/]
---

# A ClickHouse permissions change doubled Cloudflare's Bot Management feature file and made the proxy panic

On 18 November 2025, Cloudflare's network [began experiencing significant failures to deliver core network traffic](https://blog.cloudflare.com/18-november-2025-outage/). Visitors to Cloudflare customers' sites got an error page saying something had failed inside Cloudflare's network. Core traffic was [largely flowing as normal by 14:30 UTC](https://blog.cloudflare.com/18-november-2025-outage/), and all systems were back to normal at 17:06.

Cloudflare CEO Matthew Prince, who wrote the postmortem, called it ["Cloudflare's worst outage since 2019"](https://blog.cloudflare.com/18-november-2025-outage/): in more than six years, no other outage had stopped the majority of core traffic flowing through the network.

It wasn't an attack, though for a while the team thought it was. The trigger was a change to database permissions, which changed what a metadata query returned, which doubled a configuration file, which exceeded a limit in the proxy.

## What happened

All times UTC, from the [postmortem](https://blog.cloudflare.com/18-november-2025-outage/):

- **11:05.** A database access control change is deployed to a ClickHouse cluster, rolled out gradually.
- **11:20 / 11:28.** The post's introduction says failures began at 11:20; its timeline says the deployment reached customer environments and first errors were seen on customer HTTP traffic at 11:28. The postmortem gives both.
- **11:31.** The first automated test detects the issue. Manual investigation starts at 11:32; the incident call opens at 11:35.
- **11:32–13:05.** The team chases what looks like degraded Workers KV and tries traffic manipulation and account limiting.
- **13:05.** Workers KV and Cloudflare Access are switched to bypass the newer proxy; impact drops.
- **13:37.** Focus shifts to rolling back the Bot Management configuration file to a last-known-good version.
- **14:24.** Generation and propagation of new Bot Management files stopped; a test with the old file succeeds.
- **14:30.** A correct file is deployed globally. Main impact resolved.
- **17:06.** All downstream services restarted. Impact ends.

## What the engineers believed

Two beliefs were in play, at different layers.

**The query author's belief:** asking ClickHouse's `system.columns` for the columns of table `http_requests_features` returns one row per column. Cloudflare says [assumptions were made in the past](https://blog.cloudflare.com/18-november-2025-outage/) that such a query would only include the `default` database. Until 11:05 that was true, because users couldn't see metadata for any other database.

**The responders' belief:** this was a DDoS attack. The postmortem says they [initially wrongly suspected](https://blog.cloudflare.com/18-november-2025-outage/) a hyper-scale DDoS. Two symptoms pushed them there. The network kept failing and then recovering, which Cloudflare calls very unusual for an internal error. And Cloudflare's status page went down, even though it is hosted entirely off Cloudflare's infrastructure. That turned out to be [a coincidence](https://blog.cloudflare.com/18-november-2025-outage/), but in the incident chat, people worried it was a continuation of the recent Aisuru DDoS attacks.

## What was actually going on

### The permissions change

The postmortem explains how Cloudflare's ClickHouse is laid out. A cluster has many shards. Queries go to **distributed tables** in a database called `default`, which fan out to the underlying tables in a database called `r0` on each shard.

Distributed queries had been running through a shared system account. Cloudflare was moving them to run as the initial user, so that query limits and grants could be evaluated per user and one bad subquery couldn't affect others. As part of that, at 11:05 it made users' existing **implicit** access to `r0` **explicit**, so that they could see the metadata of those tables too.

That's a reasonable, security-improving change. Its side effect was that `system.columns` now returned accurate metadata for everything the user could access, which now included `r0`.

### The query that didn't filter

The Bot Management feature file is built from a query like this one, shown in the postmortem:

```sql
SELECT name, type
FROM system.columns
WHERE table = 'http_requests_features'
ORDER BY name;
```

Cloudflare's comment: ["Note how the query does not filter for the database name."](https://blog.cloudflare.com/18-november-2025-outage/) After the change, the same table name existed in both `default` and `r0`, so every column came back twice. The response [more than doubled](https://blog.cloudflare.com/18-november-2025-outage/), and so did the number of features in the generated file.

*Background:* this is a classic latent bug. The query was always under-specified; it relied on an environmental fact (only one database is visible) instead of stating it (`AND database = 'default'`). Nothing exercised the gap until someone changed the environment for a good reason.

### The limit in the proxy

Every request through Cloudflare passes through its core proxy, FL ("Frontline"), which runs per-customer modules including Bot Management. Bot Management uses a machine learning model to score each request, and the model's input is the **feature file**, refreshed [every few minutes](https://blog.cloudflare.com/18-november-2025-outage/) and pushed to the whole network so Cloudflare can react quickly to new bots.

For performance, proxy modules preallocate memory, so they have hard limits. Bot Management's limit on runtime features was [200, well above the ~60 features in use](https://blog.cloudflare.com/18-november-2025-outage/). The doubled file exceeded 200. The check in the new Rust proxy, FL2, returned an error, and the calling code unwrapped it. The resulting panic, quoted in the postmortem:

```
thread fl2_worker_thread panicked: called Result::unwrap() on an Err value
```

The panic became a 5xx for any traffic that depended on the bots module.

```diagram
title: from a GRANT to a 5xx
flow: grant on r0 -> columns listed twice -> feature file doubles
flow!: over 200 features -> unwrap() panics -> 5xx everywhere
note: the limit check worked; the caller didn't handle its error
```

*Background:* in Rust, `unwrap()` on a `Result` means "I'm certain this can't fail; if it does, crash". Here the limit check did its job and reported the problem. The panic came from treating "the file is bigger than expected" as impossible rather than as a case to handle, for example by keeping the previous file.

The old proxy, FL, behaved differently. Customers on FL didn't see errors, but bot scores weren't generated correctly, so all traffic scored [zero](https://blog.cloudflare.com/18-november-2025-outage/). Customers with rules blocking bots saw large numbers of false positives.

### Why it flickered

The feature file was regenerated [every five minutes](https://blog.cloudflare.com/18-november-2025-outage/), and the permissions change was rolling out gradually across the ClickHouse cluster. Bad data came out only if the query ran on an already-updated node. So every five minutes, the network got either a good file or a bad one, and failed or recovered accordingly. Eventually every node was updated and the system settled into the failing state.

That flicker is what made it look like an attack. A deterministic bug usually fails and stays failed. This one depended on which shard answered a query.

### Knock-on effects

Workers KV's front-end gateway goes through the core proxy, so KV returned elevated 5xx errors, and so did Access, which depends on it. Turnstile failed to load, so most users couldn't log in to the dashboard. CDN latency also rose because debugging and observability systems [consumed large amounts of CPU](https://blog.cloudflare.com/18-november-2025-outage/) enriching uncaught errors. After the fix, a backlog of dashboard logins plus retries overwhelmed the dashboard again until about 15:30.

## How they fixed it

At 13:05, Workers KV and Access were switched to a prior version of the proxy, where the impact was smaller. Then the team stopped generating and propagating new feature files, manually inserted a known-good file into the distribution queue, and [forced a restart of the core proxy](https://blog.cloudflare.com/18-november-2025-outage/). The long tail to 17:06 was restarting other services that had entered a bad state.

## What changed afterwards

Cloudflare's [listed follow-ups](https://blog.cloudflare.com/18-november-2025-outage/):

- **Harden ingestion of Cloudflare-generated configuration files** the same way as user-generated input.
- **More global kill switches** for features.
- **Stop core dumps and error reports from overwhelming system resources.**
- **Review failure modes for error conditions across all core proxy modules.**

## The rule

Internal configuration that ships to every machine every few minutes is a deploy, and the code that reads it should handle bad input the way it would handle a hostile request: validate, reject, keep running on the last good version. A limit exists to protect the process; hitting it should never be what kills the process.

And write metadata queries that state their assumptions (interpretation). `WHERE table = 'x'` without a database filter works only as long as no one changes what the user can see. Here, someone improving security changed exactly that.

## Sources

- [Matthew Prince, "Cloudflare outage on November 18, 2025", Cloudflare blog, 18 November 2025](https://blog.cloudflare.com/18-november-2025-outage/): Cloudflare's postmortem, covering the ClickHouse permissions change, the feature-file query, the 200-feature limit and Rust panic, the fluctuating failures, affected services, timeline and follow-ups.
