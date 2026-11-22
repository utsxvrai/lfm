---
title: "A security clean-up job locked Azure out of its own VM extension storage, then recovery overloaded Managed Identity"
dek: "A remediation workflow that disables anonymous access on storage accounts was pointed, by a targeting bug, at the Microsoft-managed accounts that serve VM extension packages. VMs couldn't be created or scaled in many regions. When access came back, the backlog of blocked work and its retries overwhelmed Managed Identities in East US and West US."
belief: "Azure's anonymous-access clean-up was meant for accounts open by mistake. It locked VMs out of extension storage."
date: 2026-02-02
company: Microsoft
kind: outage
topics: [automation, storage, cascading-failure, auth]
stack: [azure, azure-storage, vm-extensions, managed-identity]
impact: "VM, scale set and AKS provisioning failed across multiple Azure regions, GitHub Actions hosted runners were affected in all regions, and Managed Identity operations failed in East US and West US during recovery."
detected_by: alert
rule: "A safety policy is a deploy: give it the same blast-radius limits, health checks and fast rollback as code, and test its target list against things that must stay open."
postmortem: https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ
sources: [https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ, https://www.theregister.com/2026/02/03/azure_virtual_machine_outage/, https://networkworld.com/article/4127142/azure-outage-disrupts-vms-and-identity-services-for-over-10-hours.html]
---

# A security clean-up job locked Azure out of its own VM extension storage, then recovery overloaded Managed Identity

On the evening of 2 February 2026 (UTC), Azure customers in many regions found they couldn't create or scale virtual machines. Kubernetes nodes failed to provision. GitHub Actions jobs queued and timed out waiting for hosted runners, and Microsoft's review says [all regions and runner types were impacted](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ). Copilot Coding Agent, CodeQL, Dependabot and GitHub Pages, which use the same compute, were hit too.

Then, as Microsoft was fixing it, a second outage started. From 00:08 UTC on 3 February, customers in East US and West US couldn't create, update or delete resources that use managed identities, or [acquire Managed Identity tokens](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ), until 06:05 UTC.

The trigger was a security job doing what it was built to do, on the wrong targets. The second outage came from the recovery itself.

## What happened

From Microsoft's Post Incident Review (PIR, tracking ID [FNJ8-VQZ](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ)), all times UTC:

- **2 Feb 18:03.** Customer impact begins, triggered by the periodic remediation workflow starting.
- **18:29.** Internal monitoring detects increasing control plane failures in a subset of regions.
- **19:46.** Issues correlated across multiple regions.
- **19:55.** Monitoring detects failure rates exceeding failure-limit thresholds.
- **20:10.** Teams start working on mitigation and root cause.
- **21:15.** A proposed mitigation is validated on a test instance.
- **21:18.** The remediation workflow is identified and disabled.
- **21:50.** Broader mitigation of affected storage accounts begins.
- **3 Feb 00:07.** Storage for a few high-volume VM extensions that use managed identity finishes re-enablement in East US.
- **00:08.** Impact unexpectedly increases, first in East US, then cascading to West US.
- **00:14.** Automated alerting flags Managed Identity availability in East US; engineers start scaling out.
- **00:30.** All extension storage accounts re-enabled. Impact mitigated everywhere except East US and West US.
- **00:50 and 02:00.** Two rounds of Managed Identity scale-out complete. Neither can keep up with the backlog of retries.
- **03:55.** Engineers start removing all traffic from the Managed Identity infrastructure so it can recover without load.
- **04:25.** Traffic is gradually ramped back.
- **06:05.** Backlog cleared. Impact mitigated.

### The timestamps don't agree everywhere

Press coverage used different start times. [Network World](https://networkworld.com/article/4127142/azure-outage-disrupts-vms-and-identity-services-for-over-10-hours.html) says the outage "began at 19:46 UTC" and lasted over 10 hours, with the Managed Identity issue running from 00:10 to 06:05. [The Register](https://www.theregister.com/2026/02/03/azure_virtual_machine_outage/) reported that Microsoft acknowledged the issue at 1946 UTC, and gave the Managed Identity issue as 0015 to 0605 UTC, "almost six hours". The PIR, published later, puts customer impact from 18:03, which is earlier than either, and the Managed Identity impact from 00:08. 19:46 in the PIR is when issues were correlated across regions. The Register also reported that GitHub noted degraded performance for Actions [at 1903 UTC](https://www.theregister.com/2026/02/03/azure_virtual_machine_outage/) and declared its incident resolved at 0056 UTC on 3 February. This post uses the PIR's times.

Microsoft's early explanation, quoted by The Register, was ["a configuration change that unintentionally restricted public access"](https://www.theregister.com/2026/02/03/azure_virtual_machine_outage/) to the storage accounts hosting VM extension packages. The PIR later described that "configuration change" as a security remediation workflow with a targeting bug.

## What the engineers believed

The job at the center of this was a security control. A resource policy drives a remediation workflow that [disables anonymous access on Microsoft-managed storage accounts](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ), to reduce unintended exposure by making sure anonymous access is on only when explicitly required.

The belief built into that design is that the workflow's target list contains only accounts where anonymous access is a mistake. Some Microsoft-managed accounts are open on purpose. The PIR says the workflow ["followed safe deployment practices"](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ) and was rolled out region by region. So there were two reasonable assumptions: the targeting was right, and if it wasn't, the region-by-region rollout would limit the damage.

Neither held.

## What was actually going on

### Why VMs need anonymous storage

When Azure provisions or scales a VM, it installs **VM extensions**, which the PIR describes as [small applications used during provisioning and lifecycle operations](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ) to configure, secure and manage VMs. The extension artifacts are downloaded directly from storage accounts early in provisioning. Those storage accounts are intentionally configured to allow anonymous read access, because they're part of the platform plumbing.

### The targeting bug

Due to ["a data synchronization problem in the targeting logic"](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ), the policy was applied to a subset of these extension storage accounts. The workflow turned off anonymous access, as designed. VMs and dependent services could no longer fetch extension packages, and provisioning failed.

The blast radius was wide because of everything that quietly depends on VM extensions: VMs, Virtual Machine Scale Sets, AKS node provisioning and extension installation, Azure DevOps and GitHub Actions pipelines, Azure Arc-enabled servers and Azure Database for PostgreSQL, according to the PIR.

The PIR doesn't explain what the "data synchronization problem" was: which data, synced from where, and why it caused these accounts to be included. My interpretation: the targeting relied on some record of which accounts need anonymous access, that record was out of date or incomplete, and nothing checked it against a list of accounts that must never be closed.

### Why region-by-region didn't contain it

This is the most important sentence in the PIR: although the rollout was region by region, ["the health assessment defect caused the incorrect targeting state to propagate broadly across public cloud regions in a short time window"](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ). The PIR names a "health assessment defect" but doesn't describe it further. The implication is that the health gate between regions, the thing that should have noticed region one breaking and stopped before region two, didn't stop it.

A staged rollout only limits blast radius if a stage can fail. If the health signal between stages is broken, a staged rollout behaves like a global one, just more slowly.

```diagram
title: two outages, one chain
flow: targeting bug -> anon read disabled -> extension fetch fails -> VM create fails
flow!: storage restored -> blocked jobs resume -> retries pile up -> MI overloaded
note: the second failure came from recovering from the first
```

### The second outage: recovery as a load spike

Microsoft disabled the workflow at 21:18 and began restoring anonymous access, validated first in a test region and then [executed region by region](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ).

Restoring access let previously blocked workflows across infrastructure orchestration systems and dependent services all resume at once. That surge of resource management operations sent a [significant and sudden increase in requests](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ) to the backend behind Managed Identities for Azure resources. It started at 00:08 in East US, right after storage for some high-volume extensions that use managed identity came back.

Then retries made it worse. Automatic retry behaviour in upstream components, designed for resiliency under transient failures, amplified traffic against the managed identity backend and pushed it past service limits in East US. Resilient routing then sent the retry traffic to West US, which saturated too. So a failover mechanism carried the overload from one region to another.

Scaling out didn't fix it. Two rounds of scale-out (complete at 00:50 and 02:00) couldn't keep up, because [retry amplification continued to generate load](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ) faster than the service could recover. What worked was the opposite of adding capacity: at 03:55 Microsoft removed all traffic, let the infrastructure recover with no load, and from 04:25 brought traffic back gradually while the backlog drained.

*Background:* this is a recognisable pattern. When work has been blocked for hours, unblocking it creates a thundering herd, every queued job firing at once. If those jobs retry on failure, the herd feeds itself. Shedding all load and ramping back in a controlled way is often the only exit, because a service under sustained overload can't get healthy while the load is still coming.

## How they fixed it

In two phases:

1. **Stop the damage, then undo it.** Disable the remediation workflow (21:18), validate the rollback in a test region, then restore anonymous access region by region. All extension storage was re-enabled by 00:30.
2. **Recover Managed Identity.** Scale out (twice, insufficiently), then shed all traffic at 03:55, repair the infrastructure without load, and ramp traffic back from 04:25. Backlog cleared at 06:05.

## What changed afterwards

Microsoft's [repair items](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ), with the PIR's estimated completion dates:

- Stronger traffic controls and throttling so retry storms can't overwhelm Managed Identity (February 2026).
- Fix the data synchronization problem by addressing detection gaps and code defects, with validation coverage (March 2026).
- Exercise and optimise rollback of the remediation workflow, with automation where appropriate (April 2026).
- More capacity headroom and tighter scaling safeguards for recovery events (April 2026).
- Orchestrate the remediation workflow in line with Safe Deployment Practices, integrated with service health indicators (May 2026).
- Better retry behaviour so the service degrades more gracefully (June 2026).
- Better regional isolation so failures or recovery in one region don't cascade into paired regions (July 2026).

The fifth item is telling. Earlier the PIR says the workflow "followed safe deployment practices". Here it commits to making it "more in line" with them and integrating it with service health. My reading: the workflow had a staged rollout but not a real health gate, which matches the "health assessment defect" that let it spread.

The PIR also says there was [nothing customers could have done](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ) to avoid or minimise the impact.

## The rule

Security remediation jobs change production. A policy that closes things is as dangerous as a deploy that opens them, because some things are open on purpose. Treat these jobs like deploys: an explicit deny-list of resources they must never touch, a health gate between stages that actually stops the rollout, and a rollback you've practised.

And plan the recovery as carefully as the fix. Unblocking hours of queued work is itself a load event. Restore in stages, rate-limit retries, and know where your failover will send overflow before it sends it somewhere that also falls over.

## Sources

- [Microsoft Azure, "Post Incident Review (PIR) – Virtual Machines, Managed identities for Azure resources, and dependent services – Service management issues in multiple regions", tracking ID FNJ8-VQZ](https://azure.status.microsoft/en-us/status/history/?trackingid=FNJ8-VQZ): Microsoft's PIR, with impact, root cause, timeline and repair items.
- [Richard Speed, "Azure outages ripple across multiple dependent Microsoft services", The Register, 3 February 2026](https://www.theregister.com/2026/02/03/azure_virtual_machine_outage/): contemporaneous report, with Microsoft's early root-cause statement and GitHub's status times.
- ["Azure outage disrupts VMs and identity services for over 10 hours", Network World, 4 February 2026](https://networkworld.com/article/4127142/azure-outage-disrupts-vms-and-identity-services-for-over-10-hours.html): contemporaneous report, with a different start time from the PIR.
