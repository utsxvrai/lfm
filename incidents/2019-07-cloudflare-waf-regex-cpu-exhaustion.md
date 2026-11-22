---
title: "One WAF regex exhausted every HTTP CPU core in Cloudflare's network for 27 minutes"
dek: "A new XSS rule contained a regex with two greedy wildcards in a row, which backtracks super-linearly. WAF rules shipped globally in seconds with no staged rollout, a CPU guard had been removed weeks earlier, and every proxy on the network went to nearly 100% CPU at once."
belief: "Cloudflare thought a simulate-mode WAF rule was safe to push globally. One regex exhausted CPU network-wide."
date: 2019-07-02
company: Cloudflare
kind: outage
topics: [regex, deploy, software-bug]
stack: [pcre, lua, waf, quicksilver]
duration_min: 27
impact: "Customers and their visitors saw 502 errors on Cloudflare domains worldwide; Cloudflare's core proxying, CDN and WAF went down and at one point 80% of its traffic was lost."
detected_by: alert
rule: "A rule engine that runs on every request is code, and pushing rules is a deploy. Give it a staged rollout, a CPU budget per match, and a regex engine with a linear-time guarantee."
postmortem: https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/
sources: [https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/]
---

# One WAF regex exhausted every HTTP CPU core in Cloudflare's network for 27 minutes

On 2 July 2019, Cloudflare deployed a new rule to its WAF Managed Rules that [exhausted the CPU on every core that handles HTTP/HTTPS traffic on the Cloudflare network worldwide](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/). Cloudflare's core proxying, CDN and WAF went down. Visitors to any Cloudflare domain got a 502 error page. The service was down for [27 minutes](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/).

The 502s came from Cloudflare's front-line web servers, which ["still had CPU cores available but were unable to reach the processes that serve HTTP/HTTPS traffic"](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/). Those processes were busy matching one regular expression.

John Graham-Cumming, who wrote the postmortem, notes that Cloudflare [hadn't had a global outage for six years](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/). He also argues the story is ["much more complex than 'a regular expression went bad'"](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/). The regex was the trigger. The outage needed a list of other things to line up.

## What happened

From the [postmortem](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/), all times UTC:

| Time | Event |
|---|---|
| 13:31 | An engineer merges an approved pull request with a change to XSS detection rules. |
| 13:37 | TeamCity builds the rules and runs the tests. They pass. |
| 13:42 | TeamCity automatically starts deploying the change. |
| 13:45 | First PagerDuty page: a synthetic test of WAF functionality fails. Pages follow for other end-to-end tests, a global traffic drop, widespread 502s and CPU exhaustion in PoPs worldwide. |
| — | Cloudflare learns it has lost [80% of its traffic](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/). Early speculation is a new kind of attack. SRE declares a P0. |
| 14:00 | WAF identified as the cause; attack ruled out. CPU data and strace confirm. |
| 14:02 | A "global terminate" of the WAF is proposed. |
| 14:07 | Global WAF termination executed, after delays reaching internal systems. |
| 14:09 | Traffic and CPU back to expected levels worldwide. |
| 14:52 | Cause understood and fix verified; WAF re-enabled globally. |

## What the engineers believed

By Cloudflare's own account, the process was followed. ["Everything that occurred up to the point the rules were deployed was done 'correctly'"](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/): a pull request was raised and approved, CI built and tested the code, a change request was filed with a rollout and rollback plan, and the rollout was executed.

Several beliefs sat under that process.

**A simulate-mode rule is safe.** The change was deployed in ["simulate" mode](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/), where real traffic passes through the rule but nothing is blocked. That mode is for measuring false positives. The postmortem points out the catch: ["even in the simulate mode the rules actually need to execute"](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/). Simulate mode protects against wrong *decisions*, not against wrong *cost*.

**Rules aren't software.** Cloudflare's software releases go through a staged pipeline: a dogfooding PoP used only by employees (DOG), a PoP with some non-paying customer traffic (PIG), three Canary PoPs, then global. That can take hours or days. WAF rules skip it on purpose, because they have to [respond rapidly to threats](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/). The SOP for a rule change explicitly allowed a global push. The team handled [476 WAF change requests in the previous 60 days](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/), about one every 3 hours, so this was routine.

**The tests cover it.** The WAF test suite fires a large collection of HTTP requests at the rules to check what should be blocked and what should be let through. It didn't test CPU use. Cloudflare checked afterwards and found that [no increase in test suite run time](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/) was observed with the rule that caused the outage.

## What was actually going on

### The regex

The rule contained this pattern:

```
(?:(?:\"|'|\]|\}|\\|\d|(?:nan|infinity|true|false|null|undefined|symbol|math)|\`|\-|\+)+[)]*;?((?:\s|-|~|!|{}|\|\||\+)*.*(?:.*=.*)))
```

The postmortem's appendix says the critical part is `.*(?:.*=.*)`, and that for the purpose of explaining the CPU cost it can be treated as `.*.*=.*`: [anything, then anything, then a literal `=`, then anything](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/).

### Why `.*.*=.*` is expensive

The WAF is written in Lua and uses PCRE, which [uses backtracking for matching and has no mechanism to protect against a runaway expression](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/).

Background on backtracking engines: they try one way of matching, and when it fails they back up to the last choice point and try the next option. A greedy `.*` first takes as many characters as it can, then gives them back one at a time when something later fails.

With two `.*` in a row, the engine has to try every way of splitting the text between them before giving up on a position. Cloudflare walks through the string `x=x`: the first `.*` greedily takes all of `x=x`, the second takes nothing, the `=` fails, and the engine backs up again and again, trying each split, until the first `.*` holds only `x` and the second holds nothing. That takes [23 steps for a three-character string](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/).

Then the cost grows with the input. Cloudflare's counts, from the [appendix](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/):

| Input | Steps |
|---|---|
| `x=x` | 23 |
| `x=xx` | 33 |
| `x=xxx` | 45 |
| `x=` followed by 20 `x` | 555 |
| 20 `x`, no `=` (no match) | 4,067 |

That's super-linear: double the input and the work more than doubles. The no-match case is the worst, because the engine has to exhaust every split at every starting position before it can say no. A WAF sees mostly legitimate traffic, which mostly doesn't match an attack rule, so it spends most of its time in the expensive no-match path.

The appendix shows it could have been worse. Add a literal `;` at the end, `.*.*=.*;`, a natural way to match something like `foo=bar;`, and matching `x=` plus 20 `x` takes [5,353 steps](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/). Making the quantifiers lazy (`.*?`) helps in the first case but, Cloudflare says, isn't a full solution.

```diagram
title: one rule, every core
flow: rule merged -> CI passes -> Quicksilver push
flow!: every request -> .*.*=.* backtracks -> HTTP CPUs at 100%
note: no staged rollout, no CPU limit on the match
```

### Why it hit everywhere at once

WAF rules are distributed through **Quicksilver**, Cloudflare's own distributed key-value store, replicated across [more than 180 cities](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/). It's the same system that carries customer configuration changes and Workers code, and it hits a [p99 of 2.29s](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/) to get a change to every machine in the world. Normally that's a feature. Here it meant ["a change to the rules went global in seconds"](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/), with no DOG, PIG or Canary step to stop it.

Because the WAF runs in the HTTP serving path, every request on every server now ran the regex. CPU on the cores dedicated to HTTP/HTTPS went to nearly 100% everywhere.

### The guard that wasn't there

There had been a protection against this. The postmortem says a protection ["that would have helped prevent excessive CPU use by a regular expression was removed by mistake during a refactoring of the WAF weeks prior"](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/). That refactoring was meant to make the WAF use less CPU.

### Why recovery took longer than it should have

Cloudflare had a kill switch, the global terminate, proposed at 14:02. Using it took until 14:07. Cloudflare uses its own products, and with Cloudflare Access down, the team [couldn't authenticate to the internal control panel](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/). Some team members had lost access because a security feature disables credentials that aren't used often. Jira and the build system were also behind the edge. The team had to use a bypass mechanism that wasn't often used. Customers had the same problem: the Cloudflare Dashboard and API also pass through the Cloudflare edge.

The postmortem's full list of contributing factors includes all of these, plus: the rollback plan required running the complete WAF build twice, the first alert for the global traffic drop took too long to fire, and the status page wasn't updated quickly enough.

## How they fixed it

At 14:07 a team member ran the global WAF termination, and by 14:09 traffic and CPU were normal; [the rest of Cloudflare's protection mechanisms continued to operate](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/). The team then tested in a single city, with paying customers' traffic removed from that location, both that the change was really the cause and that the rollback worked. The WAF was re-enabled globally at 14:52.

## What changed afterwards

Cloudflare stopped all WAF release work and listed [these actions](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/):

- Re-introduce the removed CPU protection (done at publication).
- Manually inspect all 3,868 WAF Managed Rules for possible excessive backtracking (inspection complete).
- Add performance profiling for all rules to the test suite.
- Switch to the re2 or Rust regex engine, both of which have run-time guarantees.
- Change the SOP to stage rule rollouts like other software, keeping emergency global deploys for active attacks.
- Add an emergency ability to take the Dashboard and API off Cloudflare's edge.
- Automate status page updates.

The appendix explains the regex engine switch. The linear-time approach dates to Ken Thompson's [1968 paper](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/): compile the pattern into a state machine and track every state it could be in at once, consuming each input character exactly once. There's no backtracking, so the cost is linear in the input regardless of the pattern.

## The rule

A rule engine that runs on every request is code, whatever the deploy pipeline calls it. Rule pushes need the same staged rollout as binaries, with an emergency path kept for real emergencies. The engine needs a per-match budget so one pattern can't take a whole core, and ideally a regex implementation with a linear-time guarantee, so the worst case is known before deploy. Test for cost as well as correctness. And make sure the tools you use to turn things off don't depend on the thing you're turning off.

## Sources

- [John Graham-Cumming, "Details of the Cloudflare outage on July 2, 2019", Cloudflare Blog](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/): Cloudflare's postmortem with the timeline, release processes, Quicksilver, contributing factors, follow-up actions and an appendix on regex backtracking.
