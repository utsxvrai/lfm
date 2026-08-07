# Learn From Mistakes — 1 published

Real backend engineering mistakes, one at a time. Not tutorials. Each post is one thing I got
wrong: what broke, what I wrongly believed, what was actually happening, and the rule I follow now.

By [@utsxvrai](https://x.com/utsxvrai) — backend dev working on production agentic AI in Node/TS.
One a week. Live at [learnfrommistakes.in](https://learnfrommistakes.in) *(site coming — the posts
below are the source of truth)*.

## The mistakes

| # | Mistake | Root cause | Caught by |
| --- | --- | --- | --- |
| [001](posts/001-esbuild-name-helper.md) | My browser agent died on a function name it never wrote | leaky-abstraction | manual testing |

## The shape

Every post is five sections and 250–400 words:

1. **What broke** — the symptom, with the verbatim error.
2. **What I thought was wrong** — the hypothesis I chased. This is the actual payload; a post
   without a wrong belief you might also hold is just a changelog.
3. **What was actually wrong** — the mechanism, plus a repro of five lines or less.
4. **The fix** — the one line or the diff.
5. **The rule** — one sentence, imperative, useful without the story around it.

## The bar

Deliberately lower than my engineering bar, written down here so it can't quietly drift up:

- Over 600 words means it's two mistakes. Split it or cut it.
- No code block over five lines. Repros are rewritten from scratch, never pasted from a work repo.
- One pass, no editing pass. Typos ship and get fixed in the next commit — the series is called
  learn-from-mistakes.
- Success for the first ten posts is that they exist. Not impressions.

Anything from client work is anonymized: no employer or brand names, no credentials, no project or
key IDs, no internal hostnames, table names or dashboard URLs, no user data. Error strings stay,
with paths and IDs stripped.

## Not doing yet

Deliberate cuts, recorded so they're decisions and not oversights:

- **Hashnode / dev.to** — until post #5, then all five imported at once with canonical pointing here.
  Setting up a publication before there's anything to discover is an hour that produces zero
  published words.
- **LinkedIn** — from month 2, batch-derived four at a time. It's a rewrite, not a repost.
- **A capture inbox / tracker** — not until there are four posts. The backlog already exists in my
  notes; a tracker with nothing shipped behind it is just a guilt object.
