# Writing an incident post

Files in `incidents/` become pages at `/incidents/<slug>`. Files starting with `_` are skipped.
The build (`web/scripts/sync-content.mjs`) fails on a missing required field or an unknown `kind`/`topic`.

## File name
`YYYY-MM-company-short-slug.md`, lowercase, hyphens only. Example: `2017-02-amazon-s3-us-east-1.md`.

## Frontmatter
Only scalars and flat inline arrays — no nested YAML, no multi-line values, no commas inside array items.
Quote any string that contains a colon.

```yaml
---
title: "A typo in a playbook command took S3 offline in us-east-1"
dek: "One to two sentences: the hook plus the mechanism."
date: 2017-02-28                      # YYYY-MM-DD from the source (YYYY-MM if only month is known)
company: Amazon                        # canonical name, consistent across posts (Amazon, Google, Microsoft, Meta, Cloudflare…)
kind: outage                           # outage | security-breach | data-loss | financial-loss | bug
topics: [human-error, capacity, cascading-failure]   # 1–4, from the vocabulary below only
stack: [s3, aws]                       # lowercase tech names
duration_min: 240                      # ONLY if a source states it; otherwise omit the line
impact: "One factual line from the source."
detected_by: alert                     # alert | customers | engineers | third-party | regulator — omit if unknown
rule: "The lesson in one sentence."
postmortem: https://...                # primary source (company postmortem / official statement / regulator report)
sources: [https://..., https://...]    # every URL the post cites, including the postmortem
---
```

Topics vocabulary: config-change, deploy, dns, bgp, networking, database, replication, backup,
certificate, auth, capacity, cascading-failure, dependency, human-error, automation, security,
data-leak, regex, time-handling, cache, storage, monitoring, rollback, software-bug, hardware,
power-cooling, supply-chain, ddos, migration.

## Body (~1500 words, English)
Match the bar of `posts/001-alter-table-after-column.md`: explain the underlying mechanism so a
backend engineer actually understands *why*, not just *what*.

```
# <title>

<2–3 paragraph cold open: what users saw, when, how big.>

## What happened
## What the engineers believed      <- the payload: the reasonable assumption that turned out wrong
## What was actually going on       <- the deep explainer: how the system works, why it failed
## How they fixed it
## What changed afterwards
## The rule
## Sources
```

Headings may be retitled to fit the story, but keep that arc and keep `## Sources` last.

Optional hand-drawn diagram (rendered at build time):

    ```diagram
    title: why the failover went the wrong way
    flow: normal path -> step -> outcome
    flow!: bad path -> step -> outcome
    note: short caption
    ```

Keep each box label under ~19 characters; 2–4 boxes per flow.

## Non-negotiable sourcing rules
1. Read the primary source before writing. Never write from memory.
2. Every number, time, date, count, dollar figure and direct quote links inline to the source that
   states it: `[about 4 hours](https://...)`.
3. If no source states something, leave it out. Never estimate, round up, or fill gaps.
4. If sources disagree, say so and cite both.
5. Clearly mark interpretation as interpretation ("the postmortem doesn't say why, but…").
6. Don't copy long passages; quote at most a sentence or two, attributed.
7. `## Sources` lists every URL with a short description of what it is.
