---
title: lt
tagline: Solves the LeetCode daily problem at 5:40 AM, and writes down what it got wrong so tomorrow's run is smarter.
stack: [typescript, launchd, claude-cli]
status: working
year: 2026
featured: false
---

# lt

A scheduled agent that does the LeetCode problem of the day before I wake up.

The interesting part isn't the solving, it's the loop. On a wrong answer or a
timeout it takes the failing testcase, feeds it back in, and retries. When it
eventually passes it writes a lesson to disk — and the next morning's run reads
every lesson it has written before it starts. So the prompt gets better on its own
without me touching it.

Zero runtime dependencies, and the brain is the `claude` CLI, so it costs nothing
per run.

**Honest status:** the agent works. The schedule didn't — the job has run
essentially once. A `launchd` job that fails silently is indistinguishable from one
that was never installed, which is its own lesson and probably its own post.
