---
title: "A latent regression made Azure East US's networking control plane too slow to fail over or roll back"
dek: "Lock contention in one partition of Azure's PubSub service should have triggered a routine failover. A recently deployed version had made replica builds slow in East US's large zones, so the failover failed, the rollback crawled through update domains, and impact moved between availability zones."
date: 2026-04-24
company: Microsoft
kind: outage
topics: [deploy, rollback, cascading-failure, networking]
stack: [azure, service-fabric, pubsub, virtual-network]
impact: "Between 11:30 and 23:22 UTC, customers may have seen failures or delays provisioning, scaling or updating resources in East US across many services, plus intermittent connectivity for some newly provisioned workloads."
rule: "Recovery paths (failover, replica rebuild, rollback) are features with their own performance budget. Test them under production-size load, because a regression that slows them makes every other failure last longer."
postmortem: https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G
sources: [https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G, https://techcommunity.microsoft.com/event/azureevents/azure-incident-retrospective---please-register-session-1---tracking-id-5gp8-w0g/4517562]
---

# A latent regression made Azure East US's networking control plane too slow to fail over or roll back

On 24 April 2026, between [11:30 and 23:22 UTC](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G), customers in Azure's East US region may have seen failures or delays when trying to provision, scale or update resources. The PIR frames this as impact to service management: the ability to change things, such as creating a VM, scaling a set or updating a network.

The affected list in Microsoft's Post Incident Review (PIR) is long. It includes Virtual Machines, Virtual Machine Scale Sets, AKS, App Service, Azure Databricks, Azure Virtual Desktop, Azure Cache for Redis and Oracle Database@Azure, ["and potentially additional services that were dependent on new compute allocations in the region."](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G) A small subset of customers also saw intermittent connectivity problems for newly provisioned workloads.

The trigger was small: lock contention in one partition of one service, in one availability zone, for several minutes. What made the day long was that each recovery mechanism Azure reached for depended on something a recent deployment had quietly made slower.

## What happened

All times UTC on 24 April, from the [PIR](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G):

- **11:30.** Customer impact begins.
- **11:38.** An issue is detected in AZ-01: a control plane partition has lock contention, and automatic failover to secondary replicas doesn't complete.
- **11:38–13:40.** Manual failover in AZ-01 is attempted and fails.
- **11:59.** First targeted notifications go to a subset of affected customers.
- **13:40.** A recently deployed update is identified as the likely trigger.
- **13:50.** Impact appears in AZ-03.
- **14:07.** Rollback to the last known good version starts in AZ-03.
- **15:03.** AZ-03 control plane availability exceeds 99%.
- **15:04.** Rollback starts in AZ-01.
- **15:36.** First public Azure Status page update.
- **19:02.** AZ-01 availability exceeds 99%.
- **19:05.** Impact appears in AZ-02 as load redistributes. Rollback starts at 19:10.
- **21:02.** Instability returns in AZ-03. The rollback there hadn't completed across all update domains, so it's restarted manually.
- **22:39.** AZ-03 rollback confirmed complete.
- **23:22.** All customer impact mitigated.

Microsoft also held public [Azure Incident Retrospective livestreams](https://techcommunity.microsoft.com/event/azureevents/azure-incident-retrospective---please-register-session-1---tracking-id-5gp8-w0g/4517562) on the incident.

## What the engineers believed

Three beliefs, each reasonable, each wrong on this day:

1. **A stuck partition fails over.** The platform is built so that if a primary replica misbehaves, a secondary takes over. When contention hit, the platform ["initiated an automatic failover to a secondary replica"](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G), as designed.
2. **Rolling back to last known good is the fast, safe exit.** Once a recent update was suspected, rollback was the obvious move, and in AZ-03 it seemed to work, with control plane availability above 99% by 15:03.
3. **The update was proven.** It had passed testing and was already running in other regions. The PIR says the issue [had not surfaced during earlier testing, or in any other regions](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G) that had received it.

## What was actually going on

### What PubSub does

The Azure PubSub service is part of the networking control plane. Resource providers such as the Network Resource Provider (NRP) publish customer network configuration when a VM or network is created, updated or deleted. Networking agents on each host subscribe and fetch that configuration to program the host's networking stack. PubSub also acts as a cache for those configurations over a VM's lifetime. In Microsoft's words, this is ["essential for resource allocation and network mappings"](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G) in virtual networks.

My reading is that this explains the shape of the outage. Existing VMs had already been configured, while anything new needed PubSub, so creation, scaling and updates stalled.

### Compute and data on the same nodes

PubSub runs on Azure Service Fabric and keeps compute and replicated state together: application logic and its data on the same nodes. The PIR says this is for [low-latency, high-performance execution with built-in consistency](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G).

*Background:* the cost of that design shows up during recovery. If state lives on the node, then moving the service, by failing over or by upgrading or downgrading it, can mean copying that state to a new node first. Rebuilding a replica is a data transfer, and it takes as long as the data takes.

### The regression

Here is the PIR's root cause:

> "a latent regression in a recently deployed version of the PubSub service exacerbated the replica build times for the large Availability Zones of this region."

The same regression also [contributed to the failure of the failover process](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G), because it increased contention and reduced the service's ability to build replicas successfully. So one bug hit all three things Azure relied on:

```diagram
title: one regression, three slow exits
flow: lock contention -> failover to replica -> partition healthy
flow!: regression -> slow replica builds -> failover fails
flow!: rollback by stage -> rebuild replicas -> slow recovery
note: the fix needed the same slow operation the bug had slowed
```

Note the phrase "large Availability Zones". My interpretation: the regression was latent, present elsewhere but apparently harmless at smaller scale, which would explain why testing and other regions didn't catch it. Microsoft's follow-up supports this: it rolled the update back in [other regions with large Availability Zones](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G).

### Why the rollback took hours

Service Fabric rolls back in stages, through update domains, so that it never takes down too much at once. With co-located state, some stages required [rebuilding full replicas on new nodes](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G), which made each stage much slower. And the rebuilds were running on the regressed code.

Microsoft had the option to push harder and chose not to: it ["intentionally prioritized maintaining availability for unaffected partitions and services rather than accelerating the rollback."](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G) That's a defensible trade. A faster rollback could have widened the outage to partitions that were still fine.

### Why it moved between zones

PubSub requires two simultaneous, fully healthy instances across availability zones for normal replication and control plane operations. Twice during mitigation, Azure couldn't keep two healthy, and the service [temporarily lost quorum](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G). As the service tried to self-heal, impact shifted between zones: AZ-02 started failing at 19:05, after AZ-01 recovered, and AZ-03 failed again at 21:02.

The AZ-03 relapse had a simpler cause. Its first rollback, which had looked like a success at 15:03, [had not fully completed to all update domains](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G). Recovery metrics above 99% had hidden an unfinished operation.

### Communications

The first automated customer message went out [within 30 minutes](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G), via Microsoft's "BRAIN" system, but only to subscriptions it could identify as affected. Notifications widened at 13:14 and again at 17:19, and the public status page didn't carry the incident until 15:36. The PIR admits that some updates ["lacked specificity"](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G) that would have helped customers understand how widespread it was.

## How they fixed it

They rolled back the PubSub update to the last known good version, zone by zone: AZ-03, then AZ-01, then AZ-02, then AZ-03 a second time to finish the update domains it had missed. Impact was mitigated at [23:22 UTC](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G).

## What changed afterwards

From the [PIR](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G):

- **Rolled back the PubSub update in other regions with large availability zones** (completed).
- **More test coverage** for the failure cases and load patterns involved (June 2026).
- **Smaller partitions**, to reduce each partition's blast radius (June 2026).
- **Better NRP monitoring** to identify affected subscriptions and send first communications automatically (August 2026).
- **Keep resource constraints from delaying recovery**, given co-located compute and data (September 2026).
- **More detailed customer updates** from the AI-assisted communication system (September 2026).

## The rule

The code paths you only exercise when something is already wrong (failover, replica rebuild, rollback) need the same load testing as the happy path, at the size of your biggest deployment. A change that makes them slower doesn't cause an outage on its own. It waits until something else goes wrong, then turns a few minutes of contention into a day.

And "recovered" isn't the same as "rollback complete". Check that the rollback actually finished everywhere, not just that the metrics look healthy (interpretation, drawn from the AZ-03 relapse).

## Sources

- [Microsoft Azure, Post Incident Review, Tracking ID 5GP8-W0G](https://azure.status.microsoft/en-us/status/history/?trackingid=5GP8-W0G): the official PIR, with impact, affected services, PubSub architecture, root cause, timeline, communications and repair items.
- [Microsoft Tech Community, "Azure Incident Retrospective, Tracking ID 5GP8-W0G" event page](https://techcommunity.microsoft.com/event/azureevents/azure-incident-retrospective---please-register-session-1---tracking-id-5gp8-w0g/4517562): registration page for Microsoft's public retrospective livestream on this incident.
