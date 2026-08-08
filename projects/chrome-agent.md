---
title: chrome-agent
tagline: A browser agent that drives my already-logged-in Chrome over CDP, reading the DOM instead of screenshots.
stack: [typescript, playwright, cdp, claude-cli]
status: working
year: 2026
featured: true
---

# chrome-agent

A faster, self-hosted take on "AI in your browser". It attaches to the Chrome I'm
already signed into via `chromium.connectOverCDP`, so every session, cookie and
SSO token I already have just works — no separate login, no headless profile to
keep warm.

**Perception is DOM-first.** It reads the accessibility tree and tags interactable
elements as compact text, using screenshots only as a fallback. That's dramatically
cheaper and faster than vision-on-every-step, and for most pages it's also more
precise — a button's accessible name beats guessing at pixels.

**The brain runs with no API key.** It auto-detects a provider: if
`ANTHROPIC_API_KEY` is set it uses the SDK, otherwise it shells out to the
logged-in `claude` CLI. That means the agent costs nothing beyond the
subscription I already pay for. Most of my tools work this way now.

**Where it falls down:** a DOM-only loop is imprecise on dense widget UIs — think
a charting tool's drag-and-drop builder, where the meaningful state isn't in the
accessibility tree at all. For those I hand-drive with CDP scripts and verify with
screenshots. Vision fallback is the obvious fix and needs an API key, which is the
tradeoff I've been avoiding.

It's also the source of [mistake #002](/mistakes) — the DOM collector had to be
injected as a raw JS string, because passing a TypeScript function let the
compiler smuggle a helper into the page that didn't exist there.
