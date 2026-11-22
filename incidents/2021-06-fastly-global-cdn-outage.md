---
title: "One customer's valid config change took down 85% of Fastly's CDN"
dek: "A bug shipped in a 12 May software deployment sat dormant for almost four weeks until one customer pushed a perfectly valid configuration that hit the exact conditions to trigger it. Because configuration on a CDN is global by design, the trigger reached most of the network at once."
belief: "Fastly treated a valid config as a safe config. One customer's change took down 85% of its CDN."
date: 2021-06-08
company: Fastly
kind: outage
topics: [software-bug, config-change, deploy]
stack: [cdn, edge]
impact: "85% of Fastly's network returned errors; 95% was operating normally again within 49 minutes."
detected_by: alert
rule: "A latent bug plus a globally propagated input is a global outage. Test new code against the full space of valid configurations, and design the edge so one tenant's config can only break that tenant."
postmortem: https://www.fastly.com/blog/summary-of-june-8-outage
sources: [https://www.fastly.com/blog/summary-of-june-8-outage]
---

# One customer's valid config change took down 85% of Fastly's CDN

On the morning of 8 June 2021 (UTC), a large part of the web started returning errors at the same moment. The sites had nothing in common except their CDN. Fastly, which sits in front of many of them, later wrote that a customer configuration change had [caused 85% of our network to return errors](https://www.fastly.com/blog/summary-of-june-8-outage).

The customer hadn't done anything wrong. Fastly is explicit that it was a [valid customer configuration change](https://www.fastly.com/blog/summary-of-june-8-outage). The change triggered an ["undiscovered software bug"](https://www.fastly.com/blog/summary-of-june-8-outage) that Fastly itself had shipped almost four weeks earlier.

Fastly's monitoring caught it fast and the worst of it was over quickly: [within 49 minutes, 95% of our network was operating as normal](https://www.fastly.com/blog/summary-of-june-8-outage). The interesting question isn't the response. It's how one tenant's legitimate change could reach most of a global network at once.

## What happened

Fastly's own summary is short. These are the facts it gives:

- **12 May:** Fastly [began a software deployment that introduced a bug that could be triggered by a specific customer configuration under specific circumstances](https://www.fastly.com/blog/summary-of-june-8-outage).
- **Early 8 June:** A customer pushed a valid configuration change that [included the specific circumstances that triggered the bug](https://www.fastly.com/blog/summary-of-june-8-outage).

The timeline, [all UTC, from Fastly](https://www.fastly.com/blog/summary-of-june-8-outage):

| Time | Event |
|---|---|
| 09:47 | Initial onset of global disruption |
| 09:48 | Global disruption identified by Fastly monitoring |
| 09:58 | Status post published |
| 10:27 | Fastly Engineering identified the customer configuration |
| 10:36 | Impacted services began to recover |
| 11:00 | Majority of services recovered |
| 12:35 | Incident mitigated |
| 12:44 | Status post resolved |
| 17:25 | Bug fix deployment began |

Fastly summarises its response as: it [detected the disruption within one minute, then identified and isolated the cause, and disabled the configuration](https://www.fastly.com/blog/summary-of-june-8-outage).

Fastly's post doesn't name the customer, the configuration option, the component that contained the bug, or what "return errors" meant at the protocol level. None of that is in this write-up either.

## What the engineers believed

Two assumptions were in play, and both are ones nearly every platform team makes.

**"The release is fine because it has been running fine."** The deployment began on 12 May. By 8 June the new code had been serving production traffic for weeks. In most organisations, a release that survives that long without incident is considered proven. Fastly's follow-up list includes [figure out why we didn't detect the bug during our software quality assurance and testing processes](https://www.fastly.com/blog/summary-of-june-8-outage), which says plainly that testing didn't cover the triggering case.

**"A valid configuration is a safe configuration."** Customer config on a CDN is validated before it is accepted. If it parses and passes validation, the platform treats it as safe to deploy. In this incident, the change was valid. The bug was in how Fastly's software handled that valid input under specific circumstances. Validation answers "is this a legal configuration?" It can't answer "does our current software handle this legal configuration correctly?"

## What was actually going on

Fastly's summary doesn't describe the bug's internals, so this section is general background on why a latent bug plus a config change has this shape. It's interpretation, not something Fastly stated.

### Latent bugs and the input space

*(Background.)* A bug that depends on a specific input sits in the code doing nothing until that input appears. Normal traffic exercises the common paths. Tests exercise the paths someone thought to write tests for. A configuration language with many options, combined in many ways, has a huge space of valid inputs, and most of that space is never exercised by tests or by any customer.

That's why a release can look stable for weeks. Stability only tells you about the inputs that have actually shown up. Fastly's wording, [triggered by a specific customer configuration under specific circumstances](https://www.fastly.com/blog/summary-of-june-8-outage), describes a narrow trigger. It took almost four weeks for some customer to produce it.

### Why a CDN spreads configuration everywhere

*(Background.)* A CDN is a single shared platform made of many edge locations. Each location serves many customers. When a customer changes their configuration, the change must reach every location that might serve their traffic, which for a global CDN means essentially all of them. And customers expect that to be fast; quick global configuration pushes are part of what they're paying for.

That makes customer configuration a deployment channel. Code deploys usually go through canaries, staged rollouts and bake time. Configuration pushes are designed to skip all that, because they are many, frequent and small, and they belong to customers. So the input that triggered the bug arrived through the one path built to reach the whole network quickly.

### Shared process, shared fate

*(Background.)* On a multi-tenant edge, one server process typically handles requests for many customers. If handling one customer's config causes that process to fail, every customer served by that process fails too. Fastly doesn't say which part of its software failed, but [85% of our network](https://www.fastly.com/blog/summary-of-june-8-outage) returning errors for everybody, not just for the customer whose config was involved, is consistent with this pattern: the bug affected shared infrastructure, not just one tenant's traffic.

```diagram
title: why one config broke everyone
flow: 12 May release -> latent bug -> weeks look fine
flow!: valid config push -> reaches all POPs -> 85% returns errors
note: the trigger used the fastest path in the system
```

Fastly's own direction afterwards points at the same thing. Its longer-term plan is [fully leveraging the isolation capabilities of WebAssembly and Compute@Edge](https://www.fastly.com/blog/summary-of-june-8-outage). Isolation is the property that would turn "one customer's config triggers a bug" into "one customer's service has a problem" instead of "the whole network has a problem".

## How they fixed it

There were two phases, and they're worth separating.

**Mitigation.** The bug was still in production, but the trigger could be removed. Fastly [identified the customer configuration](https://www.fastly.com/blog/summary-of-june-8-outage) at 10:27 and disabled it. Services began recovering at 10:36, most had recovered by 11:00, and the incident was marked mitigated at 12:35.

This is the general lesson about latent-bug incidents: when you can't fix the code in minutes, you can often remove the input. That depends on being able to find which input is responsible, which in Fastly's timeline happened at 10:27, after the disruption was detected at 09:48.

**The real fix.** After mitigation, Fastly [created a permanent fix for the bug and began deploying it at 17:25](https://www.fastly.com/blog/summary-of-june-8-outage). Until that rolled out, the network was running the same buggy code. The only thing preventing a repeat was that the triggering config was disabled. Fastly says it was deploying the fix [as quickly and safely as possible](https://www.fastly.com/blog/summary-of-june-8-outage).

## What changed afterwards

Fastly's summary lists [short-term actions](https://www.fastly.com/blog/summary-of-june-8-outage):

- Deploy the bug fix across the network.
- Conduct a complete post mortem of the processes and practices followed during the incident.
- Figure out why QA and testing didn't detect the bug.
- Evaluate ways to improve remediation time.

And the longer-term direction: [fundamental changes to the safety of our underlying platforms](https://www.fastly.com/blog/summary-of-june-8-outage), using the isolation of WebAssembly and Compute@Edge.

Fastly also wrote: ["Even though there were specific conditions that triggered this outage, we should have anticipated it."](https://www.fastly.com/blog/summary-of-june-8-outage)

The summary doesn't say whether Fastly changed how customer configuration is rolled out (for example, staging it per location), so that's not claimed here.

## The rule

Treat customer configuration as code that runs on your platform, because it is. A latent bug only needs a trigger, and on a multi-tenant system the fastest global channel you have is usually the configuration push. Three things follow from that. First, test new releases against the real distribution of customer configurations, not just the ones you thought of, because "valid" and "handled correctly" aren't the same set. Second, give yourself a fast way to identify and disable the specific input that's causing harm, since that's what bought Fastly its recovery. Third, and hardest, build isolation so that a failure triggered by one tenant's input is contained to that tenant. The first two shorten an outage. Only the third keeps it from being global.

## Sources

- [Fastly, "Summary of June 8 outage" (Nick Rockwell, 8 June 2021)](https://www.fastly.com/blog/summary-of-june-8-outage): Fastly's official summary, covering the 12 May deployment, the valid customer configuration, the 85% figure, the UTC timeline and the short- and long-term follow-ups.
