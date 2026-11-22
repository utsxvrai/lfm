---
title: "An automated repair of one optical device cut Azure West US off from the WAN"
dek: "A bug in Azure's blast-radius analysis widened a routine break-fix on one optical device to every optical device leaving a datacenter. The safety check ran, but it judged each device on its own, so it approved withdrawing routes from all of them at once. The links still looked healthy, and the automated rollback needed the very connectivity it had just removed."
belief: "Azure expected a single-device optical repair to be impactless. A scope bug withdrew every path out of a datacenter."
date: 2026-07-23
company: Microsoft
kind: outage
topics: [automation, networking, software-bug, rollback]
stack: [azure, optical-network, wan, routing]
impact: "From 14:44 to 19:41 UTC, a subset of customers had connectivity failures, higher latency or trouble reaching Azure services in West US; only traffic entering or leaving the region was affected."
detected_by: alert
rule: "Safety checks for automated changes must evaluate the aggregate effect of the whole request, and a recovery system must not depend on the thing the change can break."
postmortem: https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG
sources: [https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG, https://petri.com/microsoft-azure-outage-network-maintenance-error/, https://surfingcomplexity.blog/2026/08/16/quick-thoughts-on-azure-regional-outage-from-july-23-26/]
---

# An automated repair of one optical device cut Azure West US off from the WAN

On July 23, 2026, between [14:44 and 19:41 UTC](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG), some customers couldn't reach Azure services in the West US region. They saw connectivity failures, increased latency, or both. The affected list in Microsoft's Post Incident Review (PIR) is long: App Service, Cosmos DB, AKS, Azure Firewall, ExpressRoute, VPN Gateway, Azure Virtual Desktop and more, with downstream impact to Microsoft 365.

The odd part was what *wasn't* broken. Traffic that stayed entirely inside the region was [not affected](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG). Only traffic entering or leaving the region failed. A datacenter had effectively been disconnected from Microsoft's wide-area network (WAN), and for hours nobody could tell why.

The cause was a repair. An automated system set out to fix one optical device and, through a chain of three small failures, took down every path out of the datacenter.

## What happened

All times UTC, from the [PIR](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG):

- **14:44.** Device break-fix begins. Earliest potential customer impact.
- **14:45.** Service alerts fire; multiple Azure service teams start investigating traffic anomalies.
- **14:54.** The automated recovery system starts retrying recovery of the affected devices.
- **15:26.** A routing anomaly alert is incorrectly triaged as a WAN issue and sent to engineers.
- **16:58.** After multiple retries, the automated recovery system raises an alert. Engineers try to recover devices manually.
- **17:19.** Engineers correlate the routing anomaly with the break-fix and start attempting auto-rollback.
- **17:45.** Manual rollback of the break-fix begins.
- **18:26.** Rollback succeeds on all affected devices.
- **19:41.** Customer impact confirmed mitigated.

[Petri](https://petri.com/microsoft-azure-outage-network-maintenance-error/) put the start at 07:44 AM Pacific time and described customers being unable to access critical services for nearly five hours.

## What the engineers believed

Azure datacenters connect to the WAN through [redundant network paths](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG), so traffic keeps flowing when one path is down for maintenance or repair. When an optical device on one path needs unplanned "break-fix" repair, the process is automated. It generates system-readable instructions, checks that the redundant path is healthy, and runs safety checks to confirm customers won't be affected.

Because break-fix on a single device is [generally expected to be impactless](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG), these requests run automatically without a human looking at them. That's a sensible design. Repairing one device on one of two redundant paths is the boring case redundancy exists for.

## What was actually going on

### Failure 1: the scope grew

A break-fix was started on one optical device to address a network reliability risk. A [defect in the blast radius analysis system](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG) expanded the repair to include all optical devices egressing a specific datacenter.

Lorin Hochstein points out the irony: a system that presumably exists [to contribute to reliability](https://surfingcomplexity.blog/2026/08/16/quick-thoughts-on-azure-regional-outage-from-july-23-26/) by limiting blast radius ended up increasing it.

### Failure 2: the safety check checked the wrong thing

The safety validation step is meant to confirm that at least one of the two redundant paths stays available. It ran, and it concluded the operation was safe. The reason, in Microsoft's words: ["The checks validated each device individually rather than evaluating the aggregate effect of isolating all devices at once"](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG). The system was never designed to handle a full datacenter's worth of devices in one request.

*Interpretation:* this is the classic composition bug. For each device in isolation, the question "is the other path still up?" was answered yes, because at the moment of checking, it was. But the request was going to take down both paths. A check that loops over items and asks "is this one OK?" can't catch a problem that only exists in the combination. The check had silently assumed that a request contains one device, and the upstream bug broke that assumption.

```diagram
title: why the safety check said yes
flow: one device repair -> check other path -> path healthy
flow!: scope bug adds all -> check each alone -> all paths withdrawn
note: per-item checks approved a set that was unsafe as a whole
```

Routes were [withdrawn from multiple devices simultaneously](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG), cutting the datacenter off from the WAN.

### Failure 3: everything looked healthy

After the withdrawals took effect at 14:44, the physical links and routing adjacencies [continued to appear healthy](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG). The impact looked like a WAN routing anomaly, because third-party networks couldn't reach Azure in the region. It didn't look like a datacenter connectivity failure.

Engineers did stop all physical work in the region, but still couldn't connect the outage to the repair, because [the preparation activities in advance of the break-fix did not succeed](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG), so the physical layer and traffic looked fine. The PIR later says those incomplete preparation activities [established the trigger conditions](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG). Hochstein calls this wording ["a little oblique"](https://surfingcomplexity.blog/2026/08/16/quick-thoughts-on-azure-regional-outage-from-july-23-26/). His best guess is that because the repair never completed, it didn't appear in the log of events that operators check for changes around the time of an incident.

Two investigation streams ran in parallel, one on the WAN routing anomaly and one on device health inside the datacenter. It wasn't until [17:19 UTC](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG) that engineers tied the anomaly to the break-fix.

### Failure 4: the rollback needed the network

Azure's automated recovery and rollback system noticed the device failures and retried several times. But it [depended on the same datacenter connectivity that had been disrupted](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG), so every attempt failed. It kept retrying from 14:54 until it finally escalated to humans at 16:58.

*Interpretation:* a recovery path that shares a dependency with the failure it recovers from isn't a recovery path for that failure. It's the same lesson as storing a status page on the infrastructure it reports on, or putting the runbook for an auth outage behind SSO.

## How they fixed it

Once the trigger was identified, engineers started a [manual rollback at 17:45 UTC](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG). Datacenter-to-WAN connectivity came back when it finished at 18:26, and all services had recovered by 19:41.

## The preliminary vs final story

The details shifted between Microsoft's preliminary and final reviews. Petri, reporting on the preliminary PIR, quotes Microsoft blaming ["a bug in the request conversion system"](https://petri.com/microsoft-azure-outage-network-maintenance-error/) that marked additional devices as part of the maintenance event. It describes the work as scheduled maintenance and the trigger as a fiber maintenance activity. The final PIR names the [blast radius analysis system](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG) and calls the work unplanned break-fix. The mechanism is the same either way: a bug widened the set of devices, and the checks didn't catch it.

## What changed afterwards

From the [PIR](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG):

- **Completed:** the blast-radius defect is fixed, and input validation now prevents both diverse paths for a datacenter from being in break-fix requests at the same time.
- **Completed:** all existing break-fix requests were scanned for similar conditions.
- **Completed:** safety checks now block any break-fix or maintenance that would affect all diverse paths for a datacenter.
- **August 2026:** break-fix requests recorded in the standard Azure change ledger, so they're faster to correlate during an investigation.
- **September 2026:** faster detection of abnormal inbound/outbound datacenter traffic; tooling guardrails so multiple devices can't be isolated at once during maintenance.
- **October 2026:** the recovery system fails faster and escalates sooner instead of retrying against broken connectivity; automated rollback made robust to degraded connectivity.

Note the first and third items: they don't just fix the scope bug. They add a check that looks at the *set* ("both diverse paths"), which is exactly what the per-device check lacked.

## The rule

When automation approves a change, the safety check has to evaluate the whole change, not each item separately. "Each step is safe" doesn't mean "the batch is safe". The upper bound on a request's size should be enforced, not just assumed.

And give your rollback path its own way in. If recovery needs the network that the change can take down, it will fail in exactly the incident it was built for.

## Sources

- [Microsoft Azure, Post Incident Review ZJV6-SGG, "Network connectivity – Issues accessing resources in West US"](https://azure.status.microsoft/en-us/status/history/?trackingid=ZJV6-SGG): the final PIR; mechanism, timeline and repair items.
- [Petri, "Microsoft Explains Cause of Five-Hour West US Azure Outage"](https://petri.com/microsoft-azure-outage-network-maintenance-error/): coverage of the preliminary PIR, including its "request conversion system" wording.
- [Lorin Hochstein, "Quick thoughts on Azure Regional Outage from July 23, '26", Surfing Complexity, August 16, 2026](https://surfingcomplexity.blog/2026/08/16/quick-thoughts-on-azure-regional-outage-from-july-23-26/): analysis of the PIR's contributors.
