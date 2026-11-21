---
title: "Azure Front Door's bad config passed every health gate because the crash came later"
dek: "Configuration changes across two control-plane versions produced metadata the data plane couldn't handle, but only in an asynchronous cleanup step that ran after health checks had already passed. The metadata rolled out globally, became the 'last known good' snapshot, and then crashed Azure Front Door nodes."
date: 2025-10-29
company: Microsoft
kind: outage
topics: [config-change, software-bug, deploy, rollback]
stack: [azure-front-door, cdn, flatbuffers, kubernetes]
impact: "Azure Front Door crashes impacted connectivity and DNS resolution for all applications onboarded to the platform, including Microsoft services."
rule: "A health gate can only catch failures that happen before it measures. If processing a change does work asynchronously, either make it synchronous during rollout or wait long enough for the deferred work to run."
postmortem: https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416
sources: [https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416, https://www.infoq.com/news/2025/11/azure-afd-control-plane-failure]
---

# Azure Front Door's bad config passed every health gate because the crash came later

On 29 October 2025, Azure Front Door (AFD), Microsoft's global CDN and edge entry point, failed worldwide. Microsoft says the crashes [impacted connectivity and DNS resolutions for all applications onboarded to our platform](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416), and that extended recovery time amplified the impact on customer applications and Microsoft's own services. AFD runs across [210+ points of presence](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416) and fronts many of Microsoft's internal services as well as customers'.

InfoQ, reporting a week later, described it as a [nearly nine-hour global service disruption](https://www.infoq.com/news/2025/11/azure-afd-control-plane-failure) that slowed Microsoft 365, Xbox Live, the Azure Portal and thousands of customer websites. InfoQ's timeline, drawn from Microsoft's preliminary review, ends with AFD impact [confirmed mitigated at 00:05 UTC](https://www.infoq.com/news/2025/11/azure-afd-control-plane-failure).

It was AFD's second incident that month. On 9 October, a manual cleanup had [bypassed the configuration protection layer](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416) and caused availability impact mainly in Europe (~6%) and Africa (~16%). The 29 October failure got through the same protection layer without anyone bypassing it.

## What happened

Microsoft's December post summarizes the 29 October sequence like this ([source](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416)):

1. A sequence of configuration changes **across two control-plane versions** produced incompatible metadata.
2. Because the data-plane failure mode was **asynchronous**, the health checks in the protection system all passed during rollout.
3. The metadata propagated **globally through a staged rollout** and also updated the **last known good (LKG)** snapshot.
4. After the global rollout, the asynchronous process in the data plane hit another defect and crashed.

InfoQ's timeline of the response, all UTC ([source](https://www.infoq.com/news/2025/11/azure-afd-control-plane-failure)):

- **17:26** Azure Portal failed away from AFD so administrators could regain access.
- **17:30** All further AFD configuration changes blocked globally.
- **17:40** Deployment of the "last known good" configuration started across the fleet.
- **18:45** Manual recovery of nodes and gradual traffic rebalancing to healthy PoPs began.
- **00:05** AFD impact confirmed mitigated.

Afterwards Microsoft [blocked configuration changes from 29 October to 5 November](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416) while it deployed hardening.

## What the engineers believed

AFD's configuration pipeline was designed for exactly this class of risk. Microsoft describes a protection system called **ConfigShield** between the control plane and the edge:

- Changes flow through **pre-canary, canary and expanding waves** rather than going global at once.
- Each stage is **health-gated**: the data plane must stay within strict error and latency thresholds before the rollout proceeds, and each stage rechecks the previous stage.
- A successful rollout updates the **LKG snapshot**, used for automated rollback.

The belief built into that design: **if a configuration were going to break the data plane, the canaries would show it** before the change went further. Customer configuration changes are expected to propagate fast; Microsoft says the industry norm is [5–10 minutes globally](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416), so each stage's health check is short. That is fine as long as damage shows up quickly.

A second belief, about rollback: the LKG snapshot is a safe place to go back to, because it is only updated after a rollout succeeds.

## What was actually going on

### How the data plane loads configuration

Microsoft's post explains the data-plane side. Customer configuration is converted into **FlatBuffers** on each AFD node and loaded by the data plane, which runs as Kubernetes pods. Each node has:

- a **master process** that accepts configuration changes (as memory-mapped files with references) and manages worker lifecycles;
- **worker processes**, the L7 proxies that serve traffic.

*Background:* FlatBuffers is a serialization format that can be read directly from memory without parsing into separate objects, which is why the post can say workers apply new configuration ["without memory overhead"](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416). Many processes can map the same buffer. The cost is that someone has to track who is still using each buffer before it can be freed.

The update flow has four steps, and Microsoft's post marks where each October outage happened:

1. **Load and apply in master.** Cleanup of unused references is synchronous, except for certain categories. *The 9 October crash happened here.*
2. **Apply to workers.** FlatBuffers are memory-mapped, so this is cheap.
3. **Serve traffic.** New requests use the new buffers; in-flight requests finish on the old ones, which are queued for cleanup.
4. **Feedback, then cleanup.** Positive feedback goes to the deployment service, signalling readiness to continue the rollout. Then the master frees old FlatBuffers **asynchronously** after all workers have loaded the update. *The 29 October crash happened here*, [due to a latent bug in reference counting logic](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416).

### Why the gates passed

Put step 4's two halves side by side. The node reports "healthy" to the rollout system, and only **after** that does the deferred cleanup run. With the incompatible metadata, that cleanup hit the reference-counting defect and crashed the master. By then the stage's health check had passed, the next wave had started, and eventually the rollout completed and promoted the configuration to LKG.

```diagram
title: why the health gate saw nothing
flow: config applied -> workers OK -> health gate passes
flow!: later, async cleanup -> refcount bug -> master crashes
note: the gate measured before the crash; the rollout moved on
```

The master process is the node's command-and-control. Microsoft says when it [crashes it takes down the entire data plane](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416) on that node. And recovery was slow: reloading hundreds of thousands of configurations from scratch [took approximately 4.5 hours](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416). Microsoft calls data-plane recovery ["the toughest part of recovery efforts"](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416) during the October incidents.

### The rollback target was poisoned

Because the rollout completed successfully by its own measures, the incompatible metadata also [updated the "last known good" (LKG) snapshot](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416). The automated safety net now pointed at the bad state. InfoQ's timeline shows an LKG deployment started at 17:40 and manual node recovery from 18:45; neither source says which LKG version was used or how it was chosen. Microsoft's later fix includes a tool to [revert to any previous version of LKG with a single click](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416), which suggests going back further than the latest snapshot had not been easy (that last point is our inference).

### The sources describe the safety failure differently

- Microsoft's December post says the metadata **passed** the protection system's health checks because the data-plane failure was asynchronous.
- InfoQ quotes Microsoft's earlier Post Incident Review as saying the protection mechanisms ["failed due to a software defect that allowed deployments to bypass safety validations"](https://www.infoq.com/news/2025/11/azure-afd-control-plane-failure).

These may describe the same gap from different angles (the async step escaped validation), but the wording differs, and the December post, written later, is the more detailed account. InfoQ also quotes the PIR as calling the trigger ["an inadvertent tenant configuration change"](https://www.infoq.com/news/2025/11/azure-afd-control-plane-failure).

## How they fixed it

From InfoQ's timeline: fail the Azure Portal away from AFD, block all configuration changes, deploy a known-good configuration, then manually recover nodes and gradually rebalance traffic to healthy PoPs. Microsoft then froze customer configuration changes until 5 November while it shipped immediate hardening.

## What changed afterwards

Microsoft's December post lists, among others ([source](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416)):

- **Defect fixes** in both the control plane (which could generate incompatible tenant metadata under specific operation sequences) and the data plane.
- **Synchronous configuration processing** in the data plane, so that every issue caused by incompatible metadata can be detected [within 10 seconds at every stage](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416). Completed.
- **More rollout stages with longer bake times.** Global configuration propagation went to [approximately 45 minutes](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416), with a plan to bring it back down once more safeguards land.
- **Protection always on**, with no bypass even for internal cleanup (the 9 October lesson).
- **Workers survive a master crash** and keep serving the last good configuration. Completed.
- **"Food Taster"**: a redundant, isolated process on every data-plane server that loads each new configuration first, fully synchronously, and returns "Config OK" before the master and workers touch it. Targeted for January 2026.
- **Cross-version validation and fuzzing** of the control-plane/data-plane metadata contract, targeted for February 2026.
- **Recovery and isolation goals:** data-plane crash recovery in under 10 minutes, and tenant isolation through micro-cellular sharding.

## The rule

A health gate is a measurement at a point in time. If applying a change kicks off work that runs later, such as deferred cleanup, garbage collection, a background compaction or a cache rebuild, the gate needs to wait for that work or the work must be made synchronous during rollout. Otherwise the canary passes, the change goes global, and your "last known good" becomes the thing that's broken.

A practical corollary (interpretation): keep several rollback targets, not just the latest one. The newest snapshot that passed validation is the one most likely to contain a bug the validation can't see.

## Sources

- [Abhishek Tiwari, Amit Srivastava, Varun Chawla, "Azure Front Door: Implementing lessons learned following October outages", Microsoft Tech Community, 18 December 2025](https://techcommunity.microsoft.com/blog/azurenetworkingblog/-/4479416): Microsoft's account of both October incidents, the configuration pipeline and data-plane architecture, where each crash occurred and the remediation plan.
- [Steef-Jan Wiggers, "Azure Front Door Outage: How a Single Control-Plane Defect Exposed Architectural Fragility", InfoQ, 5 November 2025](https://www.infoq.com/news/2025/11/azure-afd-control-plane-failure): news coverage quoting Microsoft's preliminary Post Incident Review, with the UTC mitigation timeline and the reported duration.
