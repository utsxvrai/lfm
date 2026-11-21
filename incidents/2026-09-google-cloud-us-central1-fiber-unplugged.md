---
title: "A router upgrade meant for several days unplugged every fiber in 13 minutes and cut off part of Google Cloud us-central1"
dek: "The plan was one router at a time with traffic drained and connectivity verified between steps. A procedural error handed the technician the full list of transceiver swaps at once, with no sequencing and no verification step, and the redundant routers went dark together."
date: 2026-09-01
company: Google
kind: outage
topics: [human-error, networking, automation]
stack: [gcp, compute-engine, gke, cloud-run, optical-transceivers]
duration_min: 251
impact: "Parts of us-central1-b and us-central1-f lost network connectivity, with traffic drop rates reaching 100% at peak, affecting Compute Engine and many products built on it."
detected_by: alert
rule: "Redundancy only protects you if maintenance is sequenced to respect it; the sequencing and the stop conditions belong in tooling, not in a technician's memory."
postmortem: https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev
sources: [https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev, https://www.theregister.com/a/5294418]
---

# A router upgrade meant for several days unplugged every fiber in 13 minutes and cut off part of Google Cloud us-central1

On Tuesday, September 1, 2026, from [07:41 to 11:52 US/Pacific](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev), part of Google Cloud's us-central1 region was cut off from the network. Customers couldn't reach their VMs, and the VMs couldn't connect to anything outside their zone. At the peak, traffic drop rates for resources in the affected area [reached 100%](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev). Google puts the duration at [4 hours and 11 minutes](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev).

Nothing broke on its own. A technician was doing a planned capacity upgrade on data center routers, and [unplugged all fiber paths across the affected devices within 13 minutes](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev). The Register's headline summed it up as an engineer who ["unplugged every fiber they could see"](https://www.theregister.com/a/5294418). Google's final report tells a more useful story: the work order itself was wrong.

## What happened

All times US/Pacific, from Google's [incident report](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev):

- **07:41.** Customers in the affected clusters lose all network connectivity. (The incident header on the same page says the incident began at 07:42.)
- **07:45 and 08:00.** Engineers divert traffic to reduce impact on regional products. Regional products are affected until diversions are fully in place at 08:00.
- **08:50.** Most physical connections restored; traffic starts recovering.
- **09:15.** GKE control-plane errors and timeouts end (they ran from 07:40).
- **09:19.** Traffic diversions removed.
- **11:52.** Full recovery across nearly all affected services confirmed.

Who was hit: Compute Engine VMs in the affected clusters, and products built on them, including Cloud SQL, AlloyDB, Apigee, Dataflow, Filestore and Looker. Spanner and Firestore saw elevated errors and latency for [nam5 multi-region instances](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev). Some Cloud VPN tunnels went down until replacement tunnel tasks started elsewhere, and Envoy-based regional load balancers saw latency or connectivity problems if enough of their proxies lived in the affected clusters.

Cloud Run and App Engine lasted longest. Traffic was diverted to other clusters, and when the impacted cluster came back, demand for new backends created what Google calls ["a 'thundering herd' of concurrent instance initializations"](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev) that bypassed warm caches and overwhelmed internal file-serving tiers until emergency capacity was added.

## What the engineers believed

The design assumption was that you can't take this network down by working on one router. Google's preliminary report says the network is [designed to be resilient to all single device or fiber-path failures](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev), and that most double or triple failures don't affect customer traffic. Devices and fiber paths are physically separated, with diverse power. The final report adds that redundant routers sit in separate data center rooms of the same building.

The maintenance plan was built around that: [upgrade one router at a time over several days](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev), divert traffic at each step, and verify that the network is fully connected again before moving on. Done that way, each step is a planned single-device failure, which is exactly what the network is designed to absorb.

## What was actually going on

### Why every swap was an outage for that link

The upgrade replaced the optical transceivers on the routers' fibers with a higher-density model. That new transceiver [was not compatible with the transceivers still in place in the data center fabric](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev), so each fiber lost connectivity when its router end was swapped.

*Interpretation:* that's fine if only one router's links are down at a time and traffic has been drained away from it first. It turns every swap into a deliberate, temporary failure of one router, and the safety of the whole operation depends on never having two of those at once.

### The work order lost its sequencing

The upgrade was manually orchestrated. Google says a procedural error [caused the complete list of transceiver replacements across all routers to be issued to the technician](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev), without instructions to do the work one router at a time. The workflow also lacked the expected human and software verification steps that would have caught unintended disruption.

So the technician worked through the list. All fiber paths across the affected devices were unplugged in 13 minutes. Google says the speed and nature of the error ["prevented warnings of incorrect action from reaching the engineer"](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev) before connectivity was gone.

```diagram
title: one router at a time, or all at once
flow: drain router 1 -> swap its optics -> verify, then next
flow!: full swap list -> every fiber pulled -> zone isolated
note: each swap was a planned single failure; doing them together removed every redundant path
```

### The last safety net was a habit

There was one more check. Google has a standing procedure to [halt if light is detected on any fiber-optic cable after unplug](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev). It was not followed.

*Interpretation:* light on a fiber you've just pulled means the far end is still transmitting, i.e. the link was live, and you probably weren't supposed to touch it. It's a good physical check, but it relies on a person stopping to look under time pressure, which is the weakest kind of control. Google's fixes move the protection into software.

### The scope changed between reports

The early status updates and the [preliminary report](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev) described the problem as limited to us-central1-b (the status updates mention one cluster, then two). The final report and a later addendum say the routers supported a fraction of capacity in us-central1-b and a small fraction in us-central1-f, and that [two clusters](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev) were isolated. Google notes that customers with projects in both zones would have seen at most one zone affected.

The Register wrote its piece from the preliminary report, which said only that "a procedural error" unplugged everything, and concluded the engineer [had failed to "RTFM"](https://www.theregister.com/a/5294418). The final report, published later, places most of the cause in the work order and the missing verification steps.

## How they fixed it

Automated network loss monitoring and probes detected it [immediately](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev). Engineers moved traffic away from the affected infrastructure while on-site technicians found the disconnected links and put the original transceivers back in. Once links were restored and traffic flow normalized, traffic was moved back. Google also halted maintenance in the region while it ran proactive audits.

Multi-zone deployments that spread across us-central1 zones were [largely able to keep serving](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev), since the isolation was limited to specific clusters.

## What changed afterwards

Google's [listed actions](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev):

- **Training:** reinforce safe maintenance, including the mandatory check for light on every unplugged fiber.
- **Automation:** finish moving network upgrade workflows to a fully automatically sequenced orchestration system. Regional workflows were mostly done in 2025; zonal workflows are in progress.
- **Work-stop alerting** for actions that disconnect live fibers.
- **Faster zone evacuation:** an automated system to move regional traffic away from faulty zones, cutting the time from [approximately 19 minutes in this instance to around 5 minutes](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev).

## The rule

N+1 redundancy only holds if every operation on the system is sequenced to stay within N+1. When the sequencing lives in a manually prepared list and a person's discipline, one formatting mistake in the list can do what no hardware failure would.

Put the order of operations and the stop conditions in tooling that refuses to proceed until the previous step has verifiably healed. The best fix here isn't telling technicians to look harder for light; it's a system that won't hand out step two until step one is green.

## Sources

- [Google Cloud Service Health, incident J5ia5t9p3g9Q5Wi7r8Ev](https://status.cloud.google.com/incidents/J5ia5t9p3g9Q5Wi7r8Ev): Google's status page with the live updates, the preliminary incident report (Sep 3), the final incident report (Sep 10) and the addendum on impact (Sep 29).
- [The Register, "Google engineer unplugged every fiber they could see and – surprise! – took down a chunk of the G-Cloud"](https://www.theregister.com/a/5294418): press coverage written from the preliminary report.
