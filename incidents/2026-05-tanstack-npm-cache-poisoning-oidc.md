---
title: "A fork PR poisoned TanStack's Actions cache, and the release job published 84 malicious npm versions"
dek: "An attacker never stole an npm token. A pull_request_target workflow ran their fork's code with the base repo's cache scope, which let them plant a poisoned pnpm store. The release workflow on main restored it, and the malware read an OIDC token out of runner memory and published straight to npm."
date: 2026-05-11
company: TanStack
kind: security-breach
topics: [supply-chain, security, cache]
stack: [npm, github-actions, pnpm, oidc]
impact: "84 malicious versions across 42 @tanstack/* npm packages were published with a credential-stealing, self-propagating payload; anyone who installed one on 2026-05-11 was told to treat the install host as compromised."
detected_by: third-party
rule: "A cache is an input to your build. If untrusted code can write to a cache that your release job reads, untrusted code is part of your release."
postmortem: https://tanstack.com/blog/npm-supply-chain-compromise-postmortem
sources: [https://tanstack.com/blog/npm-supply-chain-compromise-postmortem, https://github.com/TanStack/router/issues/7383, https://techcrunch.com/2026/05/14/openai-says-hackers-stole-some-data-after-latest-code-security-issue/]
---

# A fork PR poisoned TanStack's Actions cache, and the release job published 84 malicious npm versions

On 11 May 2026, between [19:20 and 19:26 UTC](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem), an attacker published [84 malicious versions across 42 `@tanstack/*` npm packages](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem). All of them came from the Router/Start monorepo, two versions per package. Installing one ran a script that harvested cloud, Kubernetes, Vault, GitHub, npm and SSH credentials and then republished the victim's own packages with the same payload.

The unusual part is what the attacker *didn't* do. TanStack says [no npm tokens were stolen and the npm publish workflow itself was not compromised](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem). The publishes were authenticated with TanStack's real trusted-publisher binding, from TanStack's real release workflow on `main`. The attacker got there by chaining three known GitHub Actions weaknesses, none of which is enough on its own.

The damage reached beyond TanStack. Later that week, OpenAI confirmed that [two employees had their devices "impacted by this attack"](https://techcrunch.com/2026/05/14/openai-says-hackers-stole-some-data-after-latest-code-security-issue/), with credentials taken from a limited subset of internal repositories those employees could access.

## What happened

All times UTC, from TanStack's [postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem), which was revised on 15 May with verified timestamps.

**Setting the trap (10–11 May)**

- **10 May, 17:16.** The attacker forks `TanStack/router` and renames the fork, which the postmortem says was done to evade fork-list searches.
- **10 May, 23:29.** A malicious commit lands on the fork, adding a ~30,000-line bundled JS file as `packages/history/vite_setup.mjs`. It is authored under a fabricated `claude <claude@users.noreply.github.com>` identity, which TanStack notes is not the real Anthropic Claude, and its message starts with `[skip ci]`.
- **11 May, ~10:49.** A PR titled "WIP: simplify history build" is opened against `main`. Two `pull_request_target` workflows run automatically. The normal `pull_request` CI does not, because it is waiting for first-time-contributor approval.
- **11:11.** A force-push puts the malicious commit on the PR head. `bundle-size.yml` checks out the PR merge ref, runs `pnpm install` and a build, and executes the payload.
- **11:29.** A 1.1 GB pnpm-store cache entry is saved under the `refs/heads/main` scope, keyed to match what `release.yml` will look up.
- **11:31.** The PR is force-pushed back to `main`'s HEAD so it shows zero changed files, then closed and its branch deleted. The poisoned cache stays.

**Detonation (11 May evening)**

- **19:15:44.** A Release workflow run from an earlier, legitimate PR is re-run. It restores the poisoned cache.
- **19:16:18–19:16:22.** A maintainer merges an unrelated fix, which triggers a fresh release run. It restores the same cache.
- **19:20:39.** npm receives publishes for `@tanstack/history@1.161.9` and 41 sibling packages. The workflow's own Publish step was skipped because tests had failed. The publishes came from the malware.
- **19:26:14.** The second batch of versions is published from the second run.

**Response**

- **19:46.** A researcher working for StepSecurity opens [issue #7383](https://github.com/TanStack/router/issues/7383) with the fingerprint and an initial list of 14 packages.
- **20:19.** The first two malicious versions are deprecated.
- **~21:00.** A scan of all 295 `@tanstack/*` packages finds the full scope: 42 packages, 84 versions.
- **21:03.** The final deprecation batch covers all 84.
- **21:30.** The cache-poisoning vector is identified. All Actions caches across TanStack repos are purged, and a hardening PR is merged.
- **22:13–23:55.** npm removes the tarballs from the registry.

The postmortem's [response-timing table](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) puts public detection at ~26 minutes after the first publish, full deprecation at ~1h 43m, and the last npm removal at ~4h 35m. Elsewhere the same post says detection came "within 20 to 26 minutes", depending on which publish batch you count from.

## What the engineers believed

The people who wrote `bundle-size.yml` knew `pull_request_target` was dangerous. It runs with the base repository's context, so fork PRs get access they otherwise wouldn't. So they split the workflow: a `benchmark-pr` job that builds the fork's code, which a YAML comment describes as ["untrusted with read-only permissions"](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem), and a separate job that posts the PR comment.

The belief was that `permissions: contents: read` makes the untrusted job harmless. It can't push, so the worst it can do is waste CPU.

The postmortem calls the split [correct in spirit](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem), but says it missed two facts about the cache.

## What was actually going on

TanStack lists [three vulnerabilities chained together](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) and says each one was necessary.

### 1. pull_request_target ran fork code

`bundle-size.yml` triggered on `pull_request_target`, checked out `refs/pull/<n>/merge` (the fork's code merged into `main`) and ran a build. Building runs code. So anyone who opened a PR could run arbitrary code inside a workflow running in the base repo's context, with no approval gate. `pull_request_target` [bypasses the first-time-contributor approval](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) that held back the normal CI.

### 2. The cache didn't care about permissions

These are the two facts the trust split missed, as the postmortem states them:

- `actions/cache`'s post-job save [is not gated by `permissions:`](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem). It uses a runner-internal token, not the workflow's `GITHUB_TOKEN`, so `contents: read` doesn't stop a cache write.
- Cache scope is per repo. `pull_request_target` runs use the base repo's scope, the same one pushes to `main` use. A PR job can write entries that production workflows on `main` will later restore.

The payload was built for this. It wrote into the pnpm store directory, and the release workflow's cache key is `Linux-pnpm-store-${hashFiles('**/pnpm-lock.yaml')}`. The postmortem says the entry was keyed to match what `release.yml` would look up on the next push to `main`. *My interpretation:* because the key is just a hash of the lockfile, any PR that leaves the lockfile alone computes exactly the key the release job will ask for. When the untrusted job finished, `actions/cache` dutifully saved the poisoned store. When `release.yml` next ran, it restored it, ["entirely as designed"](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem).

TanStack points out this is a known class of attack, documented by Adnan Khan in 2024: a GitHub Actions design issue that needs deliberate mitigation, not a TanStack-specific bug.

### 3. The OIDC token was sitting in memory

TanStack publishes to npm with OIDC trusted publishing. There's no long-lived npm token. Instead `release.yml` has `id-token: write`, and the job exchanges a short-lived GitHub OIDC token for npm publish rights. That's why there was no npm token to steal.

But the poisoned pnpm store meant attacker binaries were on disk and got invoked during the build. According to the postmortem they found the `Runner.Worker` process via `/proc/*/cmdline`, read its memory through `/proc/<pid>/maps` and `/proc/<pid>/mem`, pulled out the OIDC token that the runner [mints lazily, in memory](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) when `id-token: write` is set, and used it to POST directly to `registry.npmjs.org`. The memory-dump script was the same one used in the March 2025 tj-actions/changed-files compromise, copied verbatim, attribution comment included.

```diagram
title: three trust boundaries, crossed in order
flow!: fork PR -> pull_request_target -> poisoned main cache
flow!: release on main -> restores cache -> token from memory
flow!: OIDC token -> direct npm POST -> 84 bad versions
note: the publish step was skipped; the malware published on its own
```

### Why the publish step didn't matter

The release workflow's own "Publish Packages" step [was skipped because tests failed](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem). That didn't help, because the malware ran during the test and cleanup phase and minted its own token. The postmortem names the structural problem: OIDC trusted publishing has [no per-publish review](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem). Once it is configured, any code path in the workflow can mint a token that can publish.

### What the payload did

A researcher's analysis on [issue #7383](https://github.com/TanStack/router/issues/7383) describes the delivery trick. Each bad version's `package.json` gained an `optionalDependencies` entry pointing at a git commit, an orphan commit pushed to a fork. npm builds git dependencies from source, so it fetched that commit and ran its `prepare` script. The script ended in `&& exit 1`, so the optional dependency "failed" and npm silently discarded it, after the payload had already run. That payload, a ~2.3 MB obfuscated `router_init.js` in the package root, harvested credentials from AWS, GCP, Kubernetes, Vault, `~/.npmrc`, GitHub and SSH keys, exfiltrated them over the Session messenger network, and enumerated the victim's own npm packages to republish them infected.

## How they fixed it

The response was deprecation and takedown, since TanStack couldn't simply unpublish. npm's policy blocks unpublishing a package that has dependents, so TanStack had to [rely on npm security to pull tarballs server-side](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem), and the bad versions stayed installable for hours. [At about 20:10 UTC](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) a maintainer also removed every other team member's push permissions, in case a user machine had been compromised. Once the vector was found, all Actions caches for all TanStack repos were purged. A hardening PR restructured `bundle-size.yml`, added `repository_owner` guards and pinned third-party actions to SHAs. A GitHub Security Advisory (GHSA-g7cv-rxg3-hmpx) was published. TanStack declared an [all-clear on 15 May](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) after a three-day sweep.

## What changed afterwards

The postmortem is candid about [what could have been better](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem):

- **No internal alerting.** TanStack learned about the compromise from a third party and wants monitoring on its own publishes.
- **`pull_request_target` workflows had never been audited**, despite being a long-known dangerous pattern.
- **Floating refs** (`@v6.0.2`, `@main`) on third-party actions are a standing supply-chain risk.
- **The unpublish policy** added hours during which malicious tarballs stayed installable.
- **Seven maintainers on the npm scope** meant seven separate credential-theft targets.
- **OIDC publishing needs a gate**: either short-lived tokens with manual review, or provenance checks that flag publishes from unexpected workflow steps.

It also lists what it got lucky on. The payload broke the tests, which made the attack loud. A more careful attacker [could have published silently for hours longer](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem).

## The rule

Most CI threat models look at permissions: what can this job push, read, or deploy? This attack didn't need permissions. It needed one shared resource, the Actions cache, that an untrusted job could write and a trusted job would read. Caches, artifacts and shared runners all carry state between jobs of different trust levels. Treat each one as an input to the trusted job, key it so untrusted runs can't produce a matching entry, or give untrusted runs no write access at all.

And "no long-lived tokens" is not the same as "no tokens". With OIDC, the credential exists in the runner's memory during the job, and any code running in that job can reach it. *My interpretation:* the safest release job runs as little third-party code as possible, and nothing that a pull request can influence, including anything restored from a cache.

## Sources

- [Tanner Linsley, "Postmortem: TanStack npm supply-chain compromise", TanStack blog, 11 May 2026 (updated 15 May)](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem): the full timeline, the three-part root cause, payload behaviour, response timing, lessons and open questions.
- [TanStack/router issue #7383, "Several npm latest releases were compromised"](https://github.com/TanStack/router/issues/7383): the public report that triggered the response, with a researcher's breakdown of the `optionalDependencies` and `prepare` delivery trick and the affected versions.
- [Lorenzo Franceschi-Bicchierai, "OpenAI says hackers stole some data after latest code security issue", TechCrunch, 14 May 2026](https://techcrunch.com/2026/05/14/openai-says-hackers-stole-some-data-after-latest-code-security-issue/): OpenAI's confirmation that two employee devices were hit downstream.
