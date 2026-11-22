---
title: "A paused Azure gateway update resumed all at once and overwhelmed a control plane that had just been made slower"
dek: "When a temporary deployment restriction expired, a backlog of gateway OS updates restarted together and flooded the shared regional networking control plane, which an earlier performance change had already slowed. ExpressRoute gateways were also marked healthy before their config was restored, so updates moved on to their redundant twin."
belief: "Azure thought its gateway updates rolled out gradually. A paused batch resumed at once and swamped the control plane."
date: 2026-09-30
company: Microsoft
kind: outage
topics: [deploy, capacity, cascading-failure, rollback]
stack: [azure, expressroute, vpn-gateway, application-gateway, azure-firewall]
impact: "Intermittent management-operation failures for Azure networking gateway services across many regions, and temporary connectivity loss for some upgraded ExpressRoute gateways and Azure VMware Solution environments."
detected_by: alert
rule: "A paused rollout is a backlog: when the pause ends, it must re-enter staged rollout, not resume everywhere at once; and a health check should mean the instance is ready to serve, not merely up."
postmortem: https://azure.status.microsoft/en-us/status/history/?trackingid=7Q30-010
sources: [https://azure.status.microsoft/en-us/status/history/?trackingid=7Q30-010, https://techcommunity.microsoft.com/t5/azure-events/azure-incident-retrospective-please-register-session-1-tracking/ec-p/4565998]
---

# A paused Azure gateway update resumed all at once and overwhelmed a control plane that had just been made slower

Between [20:30 UTC on 30 September 2026 and 02:15 UTC on 1 October](https://azure.status.microsoft/en-us/status/history/?trackingid=7Q30-010), customers of several Azure networking services (ExpressRoute Gateway, Application Gateway, Azure Firewall, Bastion, Virtual WAN and VPN Gateway) saw intermittent failures when performing service management operations on those resources. Worse, some upgraded ExpressRoute gateways [could not retrieve their configuration](https://azure.status.microsoft/en-us/status/history/?trackingid=7Q30-010) and temporarily lost connectivity, and some Azure VMware Solution customers lost network connectivity to their environments.

The PIR lists affected regions on several continents, from Australia Central 2 to West US 3. Impact moved region by region, because the trigger was a rolling update.

Microsoft's Post Incident Review (tracking ID 7Q30-010) is short, and so is this post. It is still worth reading closely, because it describes two classic failure modes in one incident: a rollout that resumes in a burst, and a health check that says "ready" too early.

## What happened

All times UTC, from the [PIR](https://azure.status.microsoft/en-us/status/history/?trackingid=7Q30-010):

- **Sep 30, 20:30.** Customer impact begins: intermittent failures on management operations across Azure networking services.
- **20:43.** ExpressRoute monitoring detects connectivity degradation.
- **20:58.** Control plane monitoring detects health failures across more regions.
- **21:12.** Multiple teams engaged.
- **21:45.** Further gateway OS updates paused.
- **22:09.** Shifting traffic gives temporary relief, but resource use climbs again. Traffic shifts stopped.
- **22:15.** Attempts to add control plane resources; constraints in dependent platform services addressed.
- **22:36.** Affected ExpressRoute gateways restore connectivity on their own, using last known good configurations.
- **23:55.** Slower configuration operations tied to a previously deployed performance change. Rollback chosen.
- **Oct 1, 01:15.** Rollback begins in one region, validated before proceeding.
- **02:15.** Rollback complete across affected regions. Impact ends.

## What the engineers believed

Azure applies OS and security updates to its networking gateways regularly, and those updates are [designed to roll out gradually](https://azure.status.microsoft/en-us/status/history/?trackingid=7Q30-010) across deployment stages and redundant gateway instances, so health can be evaluated before they continue. That's the belief: the rollout system controls the pace, so the load an update puts on shared services is bounded.

For ExpressRoute specifically, the belief was that an instance reported healthy after restarting is ready, so it's safe to start updating its redundant partner.

## What was actually going on

### A pause that turned into a burst

Before the incident, a [temporary deployment restriction](https://azure.status.microsoft/en-us/status/history/?trackingid=7Q30-010) had paused OS updates for a group of networking gateways. When the restriction expired, a large number of gateway updates resumed within a short period. Every gateway that updates restarts and then asks the regional networking control plane for its configuration. So the expiry generated a surge of restarts and configuration-retrieval requests.

*Interpretation:* the gradual rollout was gradual only while it was running. A pause let pending work pile up, and nothing re-applied the staging when the pause ended. Microsoft's own fix describes exactly this: making resumed updates "follow staged rollout practices rather than resuming across large numbers of gateways at once."

### A control plane that had already slowed down

The burst alone might have been survivable. But a previously deployed change had [increased the processing time](https://azure.status.microsoft/en-us/status/history/?trackingid=7Q30-010) for configuration operations in the shared regional networking control plane. More requests, each taking longer, overwhelmed it. Management operations for several networking services failed intermittently, and Microsoft says existing throttling and load-protection mechanisms ["did not sufficiently protect critical processing"](https://azure.status.microsoft/en-us/status/history/?trackingid=7Q30-010).

*Background:* a server's load is roughly arrival rate times time per request. Here both went up at once: the rate because of the burst, the time per request because of the earlier change. That's why neither change alone showed a problem, and why responders' first moves (shifting traffic, adding resources) gave only temporary relief. The fix that worked was reducing the time per request, by rolling back the performance change.

```diagram
title: two changes that only hurt together
flow: update pause ends -> mass restarts -> config fetch surge
flow!: slower config ops -> control plane jams -> mgmt ops fail
note: more requests, each taking longer; the rollback fixed the second half
```

### ExpressRoute: healthy, but not ready

ExpressRoute had a second problem. Gateway instances restarting during the update were [marked healthy before their configuration and routing state had been fully restored](https://azure.status.microsoft/en-us/status/history/?trackingid=7Q30-010). So the update moved on to the redundant instance before the first was actually ready. With the control plane overwhelmed, neither instance could fetch its routing configuration, and some gateways lost connectivity to customers' on-premises networks.

After [approximately 30 minutes](https://azure.status.microsoft/en-us/status/history/?trackingid=7Q30-010) of failed retrieval attempts, the affected gateways fell back to their locally stored last known good (LKG) configurations and restored connectivity, at 22:36.

*Interpretation:* the LKG fallback is the part that worked. A gateway that can serve from its last good config when the control plane is unavailable turns a control-plane outage into a data-plane delay instead of a data-plane outage. The bug was upstream of it: a health signal that meant "process is up" was being used as if it meant "safe to take my partner down".

## How they fixed it

Microsoft paused further gateway updates at 21:45, tried shifting control plane traffic and adding resources, and got only temporary relief. Once it connected the slower configuration operations to the earlier performance change, it rolled that change back, starting in one region at 01:15 and validating before going wider. Impact ended at 02:15.

## What changed afterwards

From the [PIR](https://azure.status.microsoft/en-us/status/history/?trackingid=7Q30-010):

- **Rolled back** the change that introduced the performance regression (completed).
- **Staged resumption** of paused OS updates, rather than resuming across many gateways at once (estimated October 2026).
- **Stronger ExpressRoute health checks**, so redundant instances update only after the first has fully restored its configuration and routing state (estimated March 2027).
- **Control plane scale-out:** fix platform issues that stopped it scaling out during the incident (estimated March 2027).
- **Throttling and load shedding** in the control plane to protect critical requests during demand spikes (estimated June 2027).

Microsoft also ran a public [Azure Incident Retrospective webcast](https://techcommunity.microsoft.com/t5/azure-events/azure-incident-retrospective-please-register-session-1-tracking/ec-p/4565998) on this incident. The PIR says there was nothing customers could have done to avoid or reduce impact from this specific incident.

## The rule

A pause in a rollout doesn't stop the rollout; it stores it up. When the pause ends, the backlog has to go back through the same staging as new work, or the "gradual" system delivers its biggest burst exactly when the restriction lifts.

And make "healthy" mean "ready to take over for my partner". If a health check passes before configuration and routing are restored, every redundant pair is one rollout step away from having two unready halves.

## Sources

- [Azure status history, Post Incident Review 7Q30-010, "Network Connectivity – Gateway service degradation in multiple regions"](https://azure.status.microsoft/en-us/status/history/?trackingid=7Q30-010): Microsoft's PIR with impact, affected regions, root cause, timeline and repair items.
- [Microsoft Community Hub, "Azure Incident Retrospective – Session 1 – Tracking ID: 7Q30-010"](https://techcommunity.microsoft.com/t5/azure-events/azure-incident-retrospective-please-register-session-1-tracking/ec-p/4565998): registration page for Microsoft's retrospective webcast on this incident.
