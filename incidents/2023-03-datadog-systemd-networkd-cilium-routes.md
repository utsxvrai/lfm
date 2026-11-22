---
title: "Datadog's first global outage: an automatic systemd update deleted Kubernetes routes in every region at once"
dek: "A legacy auto-update channel applied a systemd security patch to tens of thousands of nodes in the same one-hour window. When systemd-networkd restarted, it removed the routes Cilium had installed, and nodes in five regions on three clouds went offline together."
belief: "Datadog thought every change went through its region-by-region rollout. An OS auto-update hit every region at once."
date: 2023-03-08
company: Datadog
kind: outage
topics: [automation, networking, software-bug, cascading-failure]
stack: [systemd, ubuntu, cilium, kubernetes]
impact: "Users in the US1, EU1, US3, US4 and US5 regions could not access the platform or APIs and monitors were not alerting; all services were operational again on 9 March and the incident fully resolved on 10 March 2023."
detected_by: alert
rule: "Anything that runs on a timer in the base image is a deploy you don't control; route every change, including OS security updates, through the same staged rollout."
postmortem: https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/
sources: [https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/]
---

# Datadog's first global outage: an automatic systemd update deleted Kubernetes routes in every region at once

At 06:03 UTC on 8 March 2023, Datadog went down in [US1, EU1, US3, US4 and US5](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/), across all services. Users couldn't reach the web app or APIs, and monitors were unavailable and not alerting. For a monitoring company, that last part means its customers lost their alarms.

Those regions were built to fail independently. They run across many availability zones on three different cloud providers, with no direct network links between them and no shared global control plane. Datadog's postmortem calls this ["our first global incident"](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/).

The trigger wasn't a Datadog deploy. It was a routine Ubuntu security update to systemd, applied automatically by the OS itself, at the same time everywhere.

## What happened

From Datadog's [postmortem](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/), all times UTC:

- **06:00, 8 March**: A security update to systemd is automatically applied to a number of VMs. On Ubuntu 22.04 (systemd v249), the update restarts `systemd-networkd`, which **forcibly deletes the routes managed by Cilium**, the container network interface (CNI) plugin Datadog uses for container networking. Affected nodes go offline.
- **06:03**: The outage begins, by Datadog's account. Internal monitoring alerts three minutes after the first faulty upgrade. An internal high-severity incident is declared 18 minutes into the investigation.
- **06:00 to 07:00**: Tens of thousands of nodes are affected. By **06:31** enough of the fleet is offline that customers see the outage; the first status page update goes out at 06:31.
- **07:23**: First status update about possible impact to data ingestion and monitors.
- **09:13**: First signs of recovery; web access restored.
- **16:44**: First major service declared operational.
- **08:58, 9 March**: All services operational in all regions.
- **06:25, 10 March**: Incident fully resolved after historical data was backfilled.

The response involved an emergency operations center of 10 senior engineering leaders, about 70 local incident commanders and [a pool of 450 to 750 responders](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/) across four shifts, plus about 200 status updates.

## What the engineers believed

Datadog's change management was strong, and the postmortem explains why it trusted it. Code, security patches and config changes roll out region by region, cluster by cluster, node by node. Nodes and containers aren't changed in place; they're replaced blue/green, and unsuccessful changes trigger automatic rollback. The tooling runs [dozens of times a day](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/), so it's well exercised.

The belief that followed was reasonable: **every change to the fleet goes through this pipeline, so no single change can hit every region at once.** Regional independence was a design goal, built on separate clouds with no shared control plane.

The belief was wrong because one channel of change didn't go through the pipeline at all.

## What was actually going on

### A legacy update channel, on a default timer

The base OS image Datadog used to run Kubernetes had a [legacy security update channel enabled](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/), so security updates were installed automatically by the OS itself. Because the images were minimal, these updates were rare and had never caused trouble before.

The OS default schedule for these updates is a window [between 06:00 and 07:00 UTC](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/). So every node in every region, on every cloud, picked up the same package in the same hour. Datadog writes that this "very indirect coupling" between regions also confused the first responders, who didn't know it existed either.

That's the first half of the mechanism: a fleet-wide change with no staging, no canary and no rollback, synchronized by a default.

### systemd-networkd and routes it didn't create

The second half is what that particular update did.

*Background:* on a Kubernetes node, the CNI plugin (here Cilium) installs routes in the Linux kernel's routing table so traffic for pod IPs reaches the right place. Those routes are created by Cilium at runtime. They aren't described in the host's network configuration files. Separately, `systemd-networkd` is the service that configures the host's own interfaces and routes from its `.network` files. systemd-networkd has a setting, `ManageForeignRoutes=`, which defaults to on and tells it to remove routes it finds that weren't configured by it. (This setting is general systemd background; Datadog's postmortem doesn't name it.)

Datadog's account: when the update restarted `systemd-networkd` on a running node, it ["forcibly deleted the routes managed by"](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/) Cilium. With its pod routes gone, the node couldn't do container networking and dropped off.

### Why no test ever caught it

This is the part worth remembering. Datadog points out that neither a fresh node nor a rebooted node shows the problem, because during a normal boot `systemd-networkd` always starts **before** the CNI plugin installs its routes. At boot there are no foreign routes to delete. The bug only appears when `systemd-networkd` restarts on a node that's already running, with Cilium's routes in place.

```diagram
title: same service, different order
flow: boot -> networkd starts -> Cilium adds routes
flow!: running node -> networkd restarts -> routes deleted
note: only an in-place restart hits the bug
```

Datadog's pipeline replaces nodes rather than updating them in place. So its normal path, booting new nodes from an image, was exactly the path where this bug can't happen. In Datadog's words, outside of the update-on-a-running-node scenario, ["no obvious test reproduces the exact sequence"](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/).

### Why recovery took more than a day

Losing tens of thousands of nodes at once made recovery its own incident. Datadog describes a few reasons:

- **Cloud providers behaved differently.** Some marked the broken node unhealthy but didn't retire it, so a reboot fixed it with data intact. Others immediately replaced the node with a fresh one, losing its local data. Replacing tens of thousands of nodes at once also created [a thundering herd that hit the providers' regional rate limits](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/).
- **Order mattered.** Each region's internal control plane had to come back before the hundreds of Kubernetes clusters it manages could be repaired, and only then could service teams fix their services.
- **Quorum-based stores recovered worse than share-nothing ones.** Datadog's primary telemetry stores are statically sharded and degrade roughly linearly as nodes disappear. Its metadata stores, which index and resolve tags, need a quorum: they work normally until quorum is lost and then [refuse to operate](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/). Much of the recovery was getting those back to accepting writes.

## How they fixed it

Datadog first restored real-time ingestion and processing so customers could use the platform with live data, then turned to historical data that had been ingested but not processed. It worked with each cloud provider to scale compute **above** normal so it could process live and backlogged data at the same time. Separating live-data systems from historical-data systems let products become usable before the backfill finished.

## What changed afterwards

The direct fixes, per the [postmortem](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/):

- **Disabled the legacy security update channel** across all affected regions. Datadog notes this doesn't weaken security, since security updates already go through its change management tooling.
- **Changed systemd-networkd's configuration** so it leaves the routing table unchanged on restart.
- **Audited the infrastructure** for similar legacy update channels.

The broader lessons Datadog lists: rethink how it failed to imagine regions being indirectly related; prioritize live data and alerts in a degraded mode; run chaos tests at the scale of degradation it actually saw; give customers clear guidance about which parts work during a long incident; and find a better way than a status page to communicate per-product status.

## The rule

Your deploy pipeline only protects you from changes that go through it. Inventory everything that can change a running host on its own, like OS auto-updates, package timers and agent self-updates, and either route it through your staged rollout or turn it off. Pay special attention to anything on a default schedule: a default is the same on every machine, which is exactly how independent regions end up failing in the same hour. And test the in-place path, not just the boot path, for any component that shares state like a routing table with another.

## Sources

- [Datadog, "2023-03-08 Incident: Infrastructure connectivity issue affecting multiple regions", 16 May 2023](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/): the official postmortem covering the timeline, root cause, recovery and lessons. Primary source for every incident fact in this post.
