---
title: "A Windows defect shipped in July sat dormant until a busy Thursday took down most of Exchange Online's gateways"
dek: "A change on Microsoft 365's network gateway servers caused lock contention under heavy load. Planned maintenance, a Teams failover and the US morning peak finally supplied that load, and automatic traffic redistribution carried the failure from server to server and then region to region."
belief: "Microsoft thought shifting Teams onto Exchange's gateway was routine. A latent defect spread failure to every region."
date: 2026-11-12
company: Microsoft
kind: outage
topics: [software-bug, cascading-failure, capacity, deploy]
stack: [exchange-online, windows, microsoft-teams, outlook, load-balancing]
impact: "Most users could not access their Exchange Online mailboxes through Outlook or other clients and email delivery was delayed, with knock-on failures in Teams, Copilot, SharePoint, OneDrive, Defender, Purview and other Microsoft 365 services."
detected_by: alert
rule: "Failover moves load, and if every destination shares the same latent defect, failover is how the defect spreads; cap how far automatic redistribution can reach."
postmortem: https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf
sources: [https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf, https://next.ink/wp-content/uploads/2026/11/PostIncidentReport.pdf, https://petri.com/microsoft-explains-microsoft-365-outage/]
---

# A Windows defect shipped in July sat dormant until a busy Thursday took down most of Exchange Online's gateways

On Thursday, November 12, 2026, starting at [4:20 PM UTC](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf), most Microsoft 365 users couldn't get into their Exchange Online mailboxes through Outlook or any other client, and email delivery was delayed. Copilot, Teams, SharePoint, OneDrive, Defender, Purview and others broke wherever they depended on Exchange Online. At the lowest point, [more than 80% of servers](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf) in the network gateway fleet in front of Exchange Online were unresponsive.

Microsoft says customers stopped seeing active impact at [4:10 PM UTC on Friday, November 13](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf), and the incident was declared resolved at 4:15 AM UTC on November 14. [No mail was lost](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf), and Microsoft says it was not a cyberattack and the change "was not caused by AI tooling."

**A note on sources.** Microsoft's Post Incident Reports for this incident are PDFs, and the only copies reachable when this post was written were hosted by third parties, not by Microsoft. This post cites those mirrors: the final PIR dated November 20 [on 365fanatic.com](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf), and the preliminary PIR dated November 15 [on next.ink](https://next.ink/wp-content/uploads/2026/11/PostIncidentReport.pdf). Both carry Microsoft's incident IDs (EX1550543/MO1550821) and Microsoft's boilerplate, but I can't verify them against an original. Where the two differ, I say so.

## What happened

All times UTC, from the [final PIR](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf):

- **Nov 12, 12:25 AM.** Teams users in US East start timing out on their own networking gateway.
- **1:07 AM.** Automated failover moves Teams traffic onto the gateway servers shared with Exchange Online.
- **1:07 AM – 4:00 PM.** Load rises gradually. Isolated server failures in some regions; automated mitigations apply.
- **4:03 PM.** Connectivity anomaly detection sees more end-user connection failures. At 4:17 PM automation starts redirecting traffic to healthy endpoints.
- **4:20 PM.** On-call engineers get a high-priority alert; Microsoft posts EX1550543 to the Service Health Dashboard.
- **6:27 PM.** MO1550821 posted for Teams, Copilot, Defender and other services.
- **7:00 PM.** All ongoing and planned deployments and configuration changes paused.
- **7:20 PM.** Responders realise the load isn't more traffic; it's servers disappearing and shifting their load onto the rest.
- **11:55 PM.** Servers returned to service stay healthy briefly, then go unresponsive again once they get traffic.
- **Nov 13, 12:30–1:00 AM.** Connection negotiation identified as the problem: a process that establishes connections is being overwhelmed.
- **7:20 AM.** Mitigation found and applied to part of the capacity: an update that reverts the defective change.
- **11:35 AM.** Europe back to healthy levels. Global Outlook on the web availability recovers at 2:17 PM.
- **4:10 PM.** No more active customer impact.

## What the engineers believed

Microsoft runs [two independent and heterogeneous network gateway systems](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf) for Microsoft 365, so services can fail over between them during disruptions. That's standard procedure, and Teams failing over to the gateway Exchange uses was routine: such shifts ["have not historically impacted Exchange Online"](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf).

The gateway also kept spare capacity. Taking a slice of servers out for maintenance wouldn't, on its own, cause impact. And inside the gateway, when servers become unresponsive, traffic management routes their load to healthy "capacity units". Microsoft calls that "normally what makes the service resilient".

Each belief was true on its own. The PIR's point is that [these conditions in combination](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf) are normally within operating parameters. They weren't, because of something nobody knew was there.

## What was actually going on

### Factor 1: a defect waiting for load

A latent defect caused Windows servers to become overwhelmed under certain load conditions, through [lock contention inside an internal Windows process](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf) that exhausted CPU and memory. It came from an update enabled on the Microsoft 365 gateway servers; neither the defect nor the update applies to broader Windows deployments.

The change started deploying in July. It went through safe deployment, reached the whole fleet over several weeks, and then ran worldwide for [more than three months](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf) without impact.

It hit newer hardware SKUs but not older ones. Newer SKUs have more cores, which allows more concurrent requests, which means more contention. Microsoft's load testing used older SKUs with fewer cores and different traffic, so it didn't find the bug.

*Background:* lock contention gets worse non-linearly. More threads fighting for the same lock spend more time waiting and less time working, so beyond some load, throughput falls as demand rises. A server like that is fine until it's suddenly very not fine, which matches "more than three months without impact".

### Factors 2 to 4: the load arrived

- **Reduced capacity.** [Nearly 14%](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf) of gateway server capacity was out of service as part of routine operations while the latest version of the service was being deployed.
- **Teams failover.** A routing issue on Teams' own gateway in US East triggered automatic failover of Teams traffic onto the gateway shared with Exchange at 1:07 AM. According to the final PIR, all services stayed healthy for [the next ~16 hours](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf), because the gateways weren't yet at daily peak. One of Microsoft's findings is that this routing issue in one region moved all Teams traffic worldwide.
- **Peak load.** Broad failures in North America began at [approximately 4:00 PM UTC](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf), as US traffic approached its daily peak.

### How the failure spread

The gateway is made of [thousands of 'capacity units'](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf), shards of compute and networking. When servers in one go unresponsive, traffic moves to healthy units in the same region. Here, those healthy units ran the same defective code. The extra load made them more likely to hit the contention too, so they went unhealthy and pushed their load further. In under two hours the defect was triggered across a significant part of the North American fleet.

When a region runs out of healthy capacity, traffic management sends traffic to other regions. Those regions had the same defect. [Within about two hours](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf) of the broad North American failures, servers in every region were affected.

```diagram
title: how failover spread the bug
flow: units go dark -> load moves to peers -> peers hit the bug
flow!: region runs dry -> spills to regions -> every region hit
note: every destination ran the same defective code, so redistribution carried the failure with it
```

*Interpretation:* the mechanism that protects against a broken server is the one that spread this. Failover assumes failures are independent: the place you send load to is healthy for a different reason. A shared latent defect breaks that assumption, and then each failover step adds load to the next victim.

### Why recovery was slow

Servers that came back were [immediately overwhelmed by queuing client traffic](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf) and went unresponsive again. Because the change was months old, change auditing took longer to point at it. And the usual fast reverts (stop a config rollout, roll back a deployment, switch off a new feature) couldn't quickly undo something already baked into the whole fleet.

Fixing each server took five steps: take it out of service, restart it from its failed state, apply the patch, restart again to activate the patch, and return it to service. Microsoft did this by moving large groups of capacity units out of rotation, recovering their servers together, and returning the group.

### Where the two reports differ

The preliminary PIR ([Nov 15](https://next.ink/wp-content/uploads/2026/11/PostIncidentReport.pdf)) and the final PIR ([Nov 20](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf)) tell the same core story, but some details changed:

| | Preliminary (Nov 15) | Final (Nov 20) |
|---|---|---|
| Number of factors | three | four (peak load added) |
| Why ~14% of capacity was out | "an unrelated issue from the previous day" | routine operations while deploying the latest service version |
| Time between Teams failover and outage | "Approximately fifteen hours" | "~16 hours" |
| Why the failure crossed regions | normal bulkheads didn't stop it "due to a separate issue" | traffic management redirects to other regions when a region exhausts capacity |
| The originating change | "a fix that was prepared specifically" for the gateways | "an update that was enabled" on the gateways |

Petri's write-up of the preliminary report describes the disruption as lasting ["more than twelve hours"](https://petri.com/microsoft-explains-microsoft-365-outage/) and the cascade as affecting "roughly 80% of the fleet"; the PIRs themselves say "more than 80% of servers" at the lowest point.

## How they fixed it

First, Microsoft moved Teams, OneDrive, SharePoint and Office apps traffic to the redundant gateway, which is why those services [recovered earlier](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf). The preliminary PIR says Exchange Online can't fail out of this gateway [for scale reasons](https://next.ink/wp-content/uploads/2026/11/PostIncidentReport.pdf). Responders tried alternative health checks, automated restarts, traffic protection and blocking, and extra VMs, with partial success. The real fix was the update reverting the connection-handling change, rolled out by groups of capacity units starting at 7:20 AM UTC on November 13, prioritising regions in or entering business hours. Microsoft also extended the email retry window [from 24 to 48 hours](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf) before generating a non-delivery report. Some delayed mail to consumer mailboxes inactive for more than 30 days still expired.

## What changed afterwards

From the [final PIR](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf):

- **Done:** the reverting update, a permanently fixed Windows image, extra capacity, monitoring for traffic redirection and connection health, and temporary guardrails against automatic traffic distribution.
- **Blast radius:** fix traffic distribution so failures don't cascade to other regions; smaller fault zones; partition gateway capacity into pools serving different workloads.
- **Failover:** Teams fails over only for the affected region, not worldwide; failover testing that covers peak conditions.
- **Recovery:** gradual traffic ramp-up and admission control when servers rejoin; controls to cut traffic by protocol, workload or region; better retry and back-off.
- **Testing:** load testing on the newest, highest-core hardware with production-like traffic.
- **Diagnosis:** better change auditing for Windows changes.

## The rule

Automatic failover is only safe when the place you fail over to doesn't share the cause. Against a latent bug present everywhere, unlimited redistribution turns one overloaded unit into a fleet-wide outage. Bound how far and how fast traffic can move, and let a region fail on its own rather than drag the others down with it.

And test on the hardware you actually run. A load test on older, smaller machines told Microsoft nothing about a contention bug that grows with core count.

## Sources

- [Microsoft, "Post Incident Report for Microsoft 365", EX1550543/MO1550821, report date November 20, 2026 (third-party copy on 365fanatic.com)](https://www.365fanatic.com/wp-content/uploads/2026/11/postincidentreport-mo1550821.pdf): the final PIR, with the four factors, cascade mechanism, recovery steps, timeline and action items. Not hosted by Microsoft.
- [Microsoft, "Preliminary Post Incident Report for Microsoft 365", report date November 15, 2026 (third-party copy on next.ink)](https://next.ink/wp-content/uploads/2026/11/PostIncidentReport.pdf): the preliminary PIR, used here for the differences from the final report. Not hosted by Microsoft.
- [Petri, "Microsoft 365 Outage: Microsoft Explains How Multiple Failures Triggered It"](https://petri.com/microsoft-explains-microsoft-365-outage/): press summary of the preliminary PIR.
