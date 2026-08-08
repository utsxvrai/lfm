---
title: gatekeeper
tagline: App-agnostic Android E2E testing — AI explores the app, deterministic tooling replays it.
stack: [typescript, maestro, adb, anthropic-sdk]
status: building
year: 2026
featured: false
---

# gatekeeper

An end-to-end Android testing platform that doesn't need to be told what the app
contains. It discovers flows itself, then pins them down as repeatable tests.

The split is the whole design:

- **Discovery is AI.** Given an app, it walks the UI and works out what the
  screens and flows actually are. This is the part that can't be scripted, because
  scripting it is exactly the work you're trying to avoid.
- **Execution is deterministic.** Once a flow is known it runs through Maestro and
  ADB — no model in the loop. A test that passes or fails based on a model's mood
  isn't a test.

Letting an LLM drive discovery but never the assertion is the pattern I keep coming
back to. AI for the ambiguous part, plain code for the part that has to be
reproducible.
