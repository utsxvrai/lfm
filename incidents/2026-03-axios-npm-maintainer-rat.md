---
title: "A fake Teams call put a RAT on the axios maintainer's laptop and two backdoored releases on npm"
dek: "Attackers used a cloned company, a real Slack workspace and a fake Teams meeting to get axios's lead maintainer to install what looked like a Teams update. From his machine they published axios 1.14.1 and 0.30.4 with one extra dependency whose postinstall hook dropped a cross-platform backdoor. 2FA was on. It didn't matter."
belief: "axios's maintainer trusted 2FA to protect npm publishing. A RAT on the maintainer's laptop published for them."
date: 2026-03-31
company: axios
kind: security-breach
topics: [supply-chain, security, dependency]
stack: [npm, nodejs, axios]
impact: "axios 1.14.1 and 0.30.4 were live on npm for about three hours and installed a remote access trojan on macOS, Windows and Linux through the injected dependency plain-crypto-js."
detected_by: third-party
rule: "A long-lived publish credential on a laptop is only as safe as everything else that runs on that laptop. Publish from CI with short-lived identity, and watch for releases that didn't come through it."
postmortem: https://github.com/axios/axios/issues/10636
sources: [https://github.com/axios/axios/issues/10636, https://github.com/axios/axios/issues/10636#issuecomment-4180237789, https://github.com/axios/axios/issues/10636#issuecomment-4179144478, https://cloud.google.com/blog/topics/threat-intelligence/north-korea-threat-actor-targets-axios-npm-package, https://www.theregister.com/2026/03/31/axios_npm_backdoor_rat/]
---

# A fake Teams call put a RAT on the axios maintainer's laptop and two backdoored releases on npm

Google's Threat Intelligence Group (GTIG) calls axios [the most popular JavaScript library used to simplify HTTP requests](https://cloud.google.com/blog/topics/threat-intelligence/north-korea-threat-actor-targets-axios-npm-package), and says the two affected packages [typically have over 100 million and 83 million weekly downloads](https://cloud.google.com/blog/topics/threat-intelligence/north-korea-threat-actor-targets-axios-npm-package).

On March 31, 2026, two malicious versions, `axios@1.14.1` and `axios@0.30.4`, were [published to npm through the lead maintainer's compromised account](https://github.com/axios/axios/issues/10636). The axios code itself was untouched. Each release added one new dependency, `plain-crypto-js@4.2.1`, which [installed a remote access trojan on macOS, Windows, and Linux](https://github.com/axios/axios/issues/10636). The maintainer's postmortem says the versions were live for [about 3 hours](https://github.com/axios/axios/issues/10636).

The interesting part isn't the malware. It's how the attackers got the publish rights: not by phishing a password or beating 2FA, but by getting the maintainer to install software on his own machine.

## What happened

The maintainer's timeline, all UTC ([postmortem](https://github.com/axios/axios/issues/10636)):

- **About two weeks before March 31.** A social engineering campaign against the lead maintainer begins.
- **March 30, 05:57.** `plain-crypto-js@4.2.0` is published to npm.
- **March 31, 00:21.** `axios@1.14.1` is published with `plain-crypto-js@4.2.1` injected.
- **Around 01:00.** `axios@0.30.4` is published with the same payload. First external detections come in. Community members file issues, and the attacker deletes them using the compromised account.
- **01:38.** Collaborator DigitalBrainJS opens a PR to deprecate the versions, flags the deleted issues and contacts npm directly.
- **03:15.** The malicious axios versions are removed from npm.
- **03:29.** `plain-crypto-js` is removed.

GTIG's window is slightly different. It says the malicious dependency was in axios releases [between 00:21 and 03:20 UTC](https://cloud.google.com/blog/topics/threat-intelligence/north-korea-threat-actor-targets-axios-npm-package), not the 03:15 in the maintainer's timeline.

StepSecurity's CTO, quoted by The Register, describes the preparation: ["The malicious dependency was staged 18 hours in advance. Three separate payloads were pre-built for three operating systems. Both release branches were hit within 39 minutes."](https://www.theregister.com/2026/03/31/axios_npm_backdoor_rat/)

GTIG [attributes the attack to UNC1069](https://cloud.google.com/blog/topics/threat-intelligence/north-korea-threat-actor-targets-axios-npm-package), a financially motivated North Korea-nexus actor. That's based on the malware family and on infrastructure overlap. GTIG's chief analyst told The Register it was ["unrelated to the recent TeamPCP supply chain issues"](https://www.theregister.com/2026/03/31/axios_npm_backdoor_rat/), meaning the Trivy compromise earlier that month.

## What the maintainer believed

The reasonable assumption: a meeting with a plausible company, set up through a real Slack workspace, is a meeting. And 2FA on the npm account protects publishing.

Later, in the postmortem's issue thread, the maintainer described the approach in the issue thread ([comment](https://github.com/axios/axios/issues/10636#issuecomment-4180237789)):

- They contacted him pretending to be the founder of a company, having cloned both the founder's likeness and the company.
- They invited him to a real Slack workspace, branded and populated with channels and what he presumes were fake profiles of the company's team and of other open-source maintainers.
- They set up a meeting on Microsoft Teams with what seemed to be a group of people.
- The meeting said something on his system was out of date. He installed it, assuming it was Teams-related. In his words: ["this was the RAT"](https://github.com/axios/axios/issues/10636#issuecomment-4180237789).

Asked how the attackers got past npm's mandatory 2FA, he answered: ["yes i did have 2fa enabled on my account"](https://github.com/axios/axios/issues/10636#issuecomment-4179144478), and once a RAT is on your machine the attacker can do anything you can.

## What was actually going on

### Why 2FA didn't help

2FA protects the step where you prove who you are. A RAT doesn't need to prove anything, because it's already running as you, on the machine that's already logged in. GTIG reports that the account's [email address was changed to an attacker-controlled one](https://cloud.google.com/blog/topics/threat-intelligence/north-korea-threat-actor-targets-axios-npm-package), and The Register, citing StepSecurity, says the packages were pushed [manually via the npm CLI, completely bypassing the project's GitHub Actions CI/CD pipeline](https://www.theregister.com/2026/03/31/axios_npm_backdoor_rat/).

The maintainer's own lesson: ["Publishing directly from a personal account was a risk that could have been avoided."](https://github.com/axios/axios/issues/10636)

There's one more detail about privilege. The postmortem thanks DigitalBrainJS for acting fast ["when the compromised account had higher permissions than his own"](https://github.com/axios/axios/issues/10636). The attacker held the most powerful account on the project and used it to delete the issues reporting the attack. The defenders had to go over the attacker's head to npm.

### Why one new dependency was enough

```diagram
title: two hops from a meeting to your CI box
flow!: fake Teams call -> RAT on laptop -> npm publish 1.14.1
flow!: npm install -> postinstall hook -> RAT on dev or CI
note: axios's own code never changed
```

npm runs lifecycle scripts from dependencies at install time. GTIG explains that the attacker used the [postinstall hook](https://cloud.google.com/blog/topics/threat-intelligence/north-korea-threat-actor-targets-axios-npm-package) in `plain-crypto-js`'s `package.json`, so installing axios automatically ran an obfuscated dropper, `setup.js`. According to GTIG, the dropper:

- Checks the operating system and fetches a platform-specific second stage from `sfrclak[.]com` on port 8000: a PowerShell script on Windows, a Mach-O binary disguised under `/Library/Caches/com.apple.act.mond` on macOS, and a Python backdoor at `/tmp/ld.py` on Linux.
- Deploys variants of a backdoor GTIG tracks as WAVESHAPER.V2, which [beacons to the C2 endpoint over port 8000 at 60-second intervals](https://cloud.google.com/blog/topics/threat-intelligence/north-korea-threat-actor-targets-axios-npm-package) and supports reconnaissance, command execution, file system enumeration and payload injection.
- On Windows, persists through a hidden batch file and a `Run` registry key named `MicrosoftUpdate`.
- Cleans up after itself. It tries to delete itself and to [replace the modified package.json with a clean copy stored as package.md](https://cloud.google.com/blog/topics/threat-intelligence/north-korea-threat-actor-targets-axios-npm-package), so someone inspecting `node_modules` afterwards wouldn't see a postinstall hook.

*Background:* most projects depend on axios through a range like `^1.14.0`, not an exact version. A lockfile pins the resolved version, so existing installs were safe. The exposure came from anything that resolved the range fresh during the window: a new project, a CI job without a lockfile, a `npx some-tool` that pulls axios transitively. That's why the maintainer's all-clear is worded as it is: if you were [already pinned to a clean version and didn't run a fresh install between 00:21 and 03:15 UTC](https://github.com/axios/axios/issues/10636), you're fine.

### How it was caught

The maintainer is frank about it: ["There was no automated way to detect an unauthorized publish. Detection depended entirely on the community noticing."](https://github.com/axios/axios/issues/10636) Here, outsiders noticed [around 01:00 UTC](https://github.com/axios/axios/issues/10636). But the project had no signal of its own that a release hadn't come from its pipeline.

## How they fixed it

The malicious versions were deprecated and then removed by npm, and `plain-crypto-js` followed at [03:29 UTC](https://github.com/axios/axios/issues/10636). On the maintainer side: ["Complete wipe of all lead maintainer devices as well as resetting of all credentials"](https://github.com/axios/axios/issues/10636), across every platform and account.

For users, the postmortem says:

- **Check lockfiles** for `axios@1.14.1`, `axios@0.30.4` or `plain-crypto-js`.
- **If found, treat the machine as compromised.** Downgrade to `1.14.0` or `0.30.3`, delete `node_modules/plain-crypto-js/` and rotate every secret on that machine.
- **Check network logs** for connections to the C2.
- **On CI runners, rotate every secret** injected during the affected build.

## What changed afterwards

The [postmortem](https://github.com/axios/axios/issues/10636) lists:

- **Immutable release setup.**
- **Proper adoption of the OIDC flow for publishing**, so releases come from CI with short-lived identity rather than a token on someone's laptop.
- **Updating all GitHub Actions to follow best practices.**
- **General security posture improvements**, which it says "should have been in place before this happened."

## The rule

If a personal machine can publish your package, then anyone who can run code on that machine can publish your package, 2FA or not. Move publishing into CI with OIDC so there's no long-lived token on a laptop to steal, and alert on any release that didn't come through the pipeline (interpretation, consistent with the maintainer's own lessons).

As a consumer: commit your lockfile and install from it in CI. A range resolved fresh during a three-hour window is how a compromise in someone else's account reaches your machine.

## Sources

- [Jason Saayman, "Post Mortem: axios npm supply chain compromise", axios/axios#10636, 31 March 2026](https://github.com/axios/axios/issues/10636): the maintainer's postmortem, with timeline, remediation, changes and lessons.
- [Maintainer comment on the social engineering approach, axios/axios#10636](https://github.com/axios/axios/issues/10636#issuecomment-4180237789): how the fake company, Slack workspace and Teams meeting led to the RAT.
- [Maintainer comment on 2FA, axios/axios#10636](https://github.com/axios/axios/issues/10636#issuecomment-4179144478): confirms 2FA was enabled.
- [Google Threat Intelligence Group, "North Korea-Nexus Threat Actor Compromises Widely Used Axios NPM Package in Supply Chain Attack"](https://cloud.google.com/blog/topics/threat-intelligence/north-korea-threat-actor-targets-axios-npm-package): exposure window, dropper and WAVESHAPER.V2 analysis, attribution to UNC1069, download figures.
- [The Register, "Supply chain blast: Top npm package backdoored to drop dirty RAT on dev machines", 31 March 2026](https://www.theregister.com/2026/03/31/axios_npm_backdoor_rat/): StepSecurity's findings on manual CLI publishing and staging, and GTIG's statement that the attack was unrelated to TeamPCP.
