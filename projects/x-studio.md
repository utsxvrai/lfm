---
title: x-studio
tagline: A local CMS that drafts posts from my own engagement data and posts them only after I approve each one.
stack: [typescript, playwright, cdp, claude-cli]
status: working
year: 2026
featured: true
---

# x-studio

A semi-automated writing studio for X. It harvests my own timeline and past posts,
scores them by engagement *rate* rather than raw counts, and feeds the winners back
into the drafting prompt — so the model copies the pattern of what actually landed
instead of what I once wrote in a plan document.

Three parts:

- **harvest** — pulls my posts, their engagement, and the live feed over CDP into
  local JSONL.
- **draft** — builds a prompt from a weekly cadence, a ground-truth context file
  about what I'm currently working on, and the top/flop posts, then generates
  candidates through the `claude` CLI. No API key.
- **cms** — a local page where each draft is an editable card with a live character
  counter. Nothing posts automatically; every tweet needs a click.

**What I got wrong.** Two things, and they're the same thing twice. The drafting
prompt told the model to leave a `[bracket]` wherever it lacked a real number
rather than inventing one — correct engineering, and it meant every draft arrived
as homework. And the harvest step, which supplies the personalisation, was never
actually run, so drafts silently fell back to the plan document and read generic.

The tool works. It produced a queue of drafts and zero posts. Good systems that
sit one manual step away from done are still zero.
