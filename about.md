---
title: Utsav Rai
dek: "Backend engineer, 22, from Bihar. I build production agentic AI systems in Node and TypeScript — and I write down what breaks."
---

# Utsav Rai

I'm a backend engineer. I write systems in Node and TypeScript, mostly around
production AI — model routing, fallback chains, evaluation harnesses, and the
unglamorous plumbing that keeps all of it from falling over at 2 AM.

22, from Bihar, India.

## What I actually work on

Day to day that means things like moving inference off a hosted API and onto
self-hosted open-weight models behind a gateway, then building the A/B machinery
to prove the swap didn't quietly degrade quality — and the eval harnesses that
catch it when it does.

A lot of it is latency work: streaming versus non-streaming, where the tail
actually sits, which timeout is lying to you. It turns out the non-streaming path
is usually the one that times out in production, which is not what you'd guess
from a benchmark.

The rest is ordinary backend craft at a size where ordinary stops being ordinary
— schema changes on tables with nine figures of rows, queues, caches, migrations,
and the interesting ways each of them fails once the row count gets serious.

## Why this site exists

Most engineering writing shows you the finished thing. It skips the part where
someone believed something false for six hours.

That gap is the useful part. A tutorial tells you what to type. A mistake tells
you which of your assumptions is load-bearing and wrong — and that's the thing
that actually transfers, because the specific bug won't repeat but the bad
instinct behind it will.

So: **[Learn From Mistakes](/)** is one post per real thing I got wrong. The
wrong belief stated plainly, the mechanism explained properly rather than
hand-waved, and the rule I follow now. One a week.

I'd rather be the person who publishes the outage than the person with a clean
blog and a loud incident channel.

## Side projects

I build a lot of small tools, usually to scratch one specific itch. A running
theme: most of them run with **no API key** — they borrow my Claude Code
subscription by shelling out to the CLI, so a personal agent costs nothing per
run. Browser agents, growth automation, an Android test platform, a LeetCode
tutor that refuses to give answers.

See [projects](/projects).

## Elsewhere

- [X / Twitter](https://x.com/utsxvrai) — where most of this gets discussed
- [GitHub](https://github.com/utsxvrai) — the code
- [LinkedIn](https://linkedin.com/in/utsavrai07)

If you want to talk about backend, inference infrastructure, or something you
broke recently, X DMs are open.
