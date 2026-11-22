---
title: "Google's London generators didn't start because the controller could still see voltage on a feed that was switched off"
dek: "One of the europe-west2-b facility's two utility feeds was open for repairs when an underground cable fault cut the other. The generator controller's undervoltage sensors sat upstream of the open breaker, saw a live feed, and never sent a start signal. The UPS batteries ran down and the zone went dark."
belief: "Google Cloud expected generators to start if feed A failed. The controller saw live voltage on feed B and didn't."
date: 2026-10-19
company: Google
kind: outage
topics: [power-cooling, hardware, cascading-failure, capacity]
stack: [gcp, plc, ups, compute-engine, persistent-disk, gke]
duration_min: 368
impact: "A power loss in europe-west2-b made zonal resources unavailable and caused latency and errors across the europe-west2 region; the main impact lasted 6 hours and 8 minutes."
detected_by: alert
rule: "A safety interlock must sense the thing it is protecting, not a proxy for it; and maintenance that removes redundancy should trigger a check that the remaining failover path still works."
postmortem: https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj
sources: [https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj, https://www.theregister.com/a/5307739]
---

# Google's London generators didn't start because the controller could still see voltage on a feed that was switched off

At 06:53 BST on Tuesday, 20 October 2026 (22:53 US/Pacific on the 19th), the data center facility hosting Google Cloud's europe-west2-b zone in London lost utility power. That alone shouldn't take down a data center. This one had two utility feeds, UPS batteries, a generator plant and a redundant controller to start it. The generators [never received a start signal](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj), the batteries ran down, and at 07:00 BST the zone's servers, storage and network hardware lost power.

Google says the main impact lasted [6 hours and 8 minutes](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj), from 23:00 to 05:08 US/Pacific. Zonal resources in europe-west2-b were unavailable, and the failover onto zones a and c caused latency and errors across the whole region. The Register reported that the outage [caused service interruptions at outfits including Lloyds, HSBC, Royal Mail, and Revolut](https://www.theregister.com/a/5307739).

## What happened

From Google's [incident report](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj), US/Pacific with BST in brackets:

- **Oct 14.** A quarterly generator load test identifies issues. To repair them, feeder B's breaker is opened (the report doesn't give the date), leaving feed A carrying the whole critical load.
- **Oct 19, 22:53 (06:53).** An underground cable fault on the utility network outside the facility cuts feed A. Generators don't start. The UPS carries the load.
- **23:00 (07:00).** Impact starts as the batteries run out and europe-west2-b hardware loses power.
- **23:04 (07:04).** Engineers alerted by automated monitoring and probers.
- **23:09 (07:09).** Automated failover toward the other zones begins.
- **23:54 (07:54).** Power from the standby utility source restored; restoration to the data hall begins.
- **Oct 20, 00:20 (08:20).** Utility power re-established to the data halls.
- **00:40–00:50 (08:40–08:50).** Clusters start recovering, network devices back online. Storage devices that shut down uncleanly begin recovery.
- **03:13 (11:13).** Storage sufficiently restored to prepare traffic re-admission; gradual re-admission starts at 03:45.
- **04:11 (12:11).** Google Cloud services and APIs fully available, though some VMs are still down.
- **05:08 (13:08).** Compute Engine VMs 99.5% operational and new VM creation fully supported. Main impact ends.

## What the engineers believed

The facility was built so that losing utility power would be a non-event. It uses a [2N utility power architecture](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj): two independent feeders, A and B, plus a standby utility connection for manual transfer. Behind that sits a high-voltage generator bank managed by a dual-redundant Programmable Logic Controller (PLC). The UPS batteries provide [approximately five minutes](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj) of runtime, enough for the PLC to detect undervoltage, start the diesel generators, synchronize them and transfer the load.

With feed B open for repairs, the site was knowingly running in a reduced, single-feed (1N) posture. The working assumption was that this was safe, because if feed A failed, the generators would still start. The PLC was the backstop for exactly this situation.

## What was actually going on

### The sensor was on the wrong side of the breaker

To decide whether to start the generators, the PLC checked for an undervoltage condition. But its undervoltage sensing inputs were [wired upstream (line side) of the isolated utility feed breakers](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj). It checked whether voltage was present on the line side of each feeder. It did not check the physical position of the breakers.

On the night, feed B's breaker was open, but the utility side of feed B was still energized. So both PLCs, the active and the standby (running identical logic), saw live voltage on feed B. In Google's words, the PLC logic ["indicated that a healthy utility source was available, even though the primary and secondary distribution feeds were de-energized"](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj), and it did not issue a start command.

```diagram
title: what the generator controller saw
flow: feed A lost -> PLC sees no voltage -> generators start
flow!: feed A lost -> sensor sees feed B -> no start signal
note: feed B was live on the utility side of an open breaker; the site was not getting any of it
```

*Interpretation:* the PLC answered the question "is there utility voltage on the line?" when the question that mattered was "is the facility actually receiving power?". In normal operation those have the same answer, so the gap was invisible. It only showed when a breaker was deliberately opened for maintenance, which is exactly when the backup path matters most. Redundancy in the controller didn't help either: two PLCs running identical logic share the same blind spot.

### Five minutes isn't long enough to debug a PLC

The onsite team tried a remote load transfer through the PLC, but the system [inhibited the action](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj) because of the live voltage reading on feed B. Realising the batteries would run out before remote operations could be sorted out, they transferred the load to the standby utility source, but the critical load had already been lost when the batteries depleted.

### Why the outage outlasted the power cut

Utility power was back at the data halls at [00:20 US/Pacific](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj), but the main impact lasted until 05:08. The gap was storage. Because power was lost instantly, storage devices had unclean shutdowns and began recovering at 00:50. Responders [chose not to restore services that would otherwise make this worse](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj), and with a large volume of devices involved, that took a long time before customer traffic could return.

### How a zone outage became a region problem

Losing one zone is meant to be survivable for regional services. Google says some customers in europe-west2-a and -c also saw [unexpected impact](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj), for two main reasons: sudden demand surges on the surviving zones, and control-plane dependencies across zonal boundaries. Some examples from the product sections of the report:

- **Apigee X** returned elevated 5xx errors for [7 hours and 19 minutes](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj). Its datastore keeps three replicas across three zones, but a scheduling misconfiguration had put two of the three in the zone that lost power, so the datastore lost quorum.
- **AlloyDB** regional primaries saw up to a [95-minute delay](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj) in starting automated failovers because of delayed failover notifications; about 4% stalled on Persistent Disk issues and needed manual recovery.
- **GKE** was affected for [7 hours and 34 minutes](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj) in total. Regional clusters tried to scale up in the other zones, but that was limited by available capacity and by failing underlying APIs.
- **BigQuery** was disrupted for [approximately 5 hours and 9 minutes](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj); a critical data-plane job had an autoscaling dependency and couldn't scale up during failover. Some customers outside the impacted zone saw [elevated (1%) error rates](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj) because of overly broad concurrency throttling.
- **Looker:** [about 45% of instances](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj) became unresponsive when its messaging tier couldn't re-establish database connectivity.

Cloud Bigtable, by contrast, [behaved as expected](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj): multi-cluster instances failed over to other zones.

### The reports disagree on a few numbers

Google's [preliminary report](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj) (22 Oct) gave the end as 05:10 US/Pacific and the duration as 6 hours 10 minutes, with engineers alerted at 23:08. The final report (updated 4 Nov) says 05:08, 6 hours 8 minutes, and 23:04. The status-page updates during the incident also gave 23:08 as the start. This post uses the final report.

The Register's write-up says ["the root cause of the incident was failure in an external underground cable"](https://www.theregister.com/a/5307739). Google's report calls the cable fault the trigger and names the PLC misconfiguration as the root cause.

## How they fixed it

On the night, the facility team moved the load to the standby utility source. Once power was back and batteries were recharging, onsite teams and the OEM vendors [reconfigured and validated the PLC](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj) on both undervoltage and breaker status. Google engineers isolated the offline zone from regional routing, adjusted scheduler allocations to protect customer reservations, then waited for storage integrity before gradually re-admitting traffic.

## What changed afterwards

From Google's [action list](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj):

- **PLC:** reconfigured and validated (completed 26 Oct); a full PLC code review with the facility vendor; validation of PLC configurations at sites with similar topologies and PLC manufacturers.
- **Testing:** full generator load transfer tests, including automatic generator start through PLC signals within the battery window (completed 20 and 26 Oct), repeated once both feeds are back.
- **Emergency procedures:** an updated procedure for unexpected loss of the active utility source, including manual generator restart and manual transfer within the UPS runtime, practised twice per shift.
- **Process:** PLC code reviews validated during commissioning and integrated system tests; a freeze on planned maintenance at similar sites and extra approvals for configuration changes outside standard designs (completed 30 Oct).
- **Communications:** an automated alert-to-communication mechanism for location-impacting incidents.

Product teams listed their own follow-ups, such as Apigee X strictly enforcing one datastore replica per zone, and AlloyDB improving zonal outage detection.

## The rule

A safety interlock should measure what it protects. "Is there voltage on the utility line?" is a proxy for "is the building powered?", and the proxy fails exactly when someone has opened a breaker, which is during maintenance, when you've already given up a layer of redundancy.

So treat "we're running on one feed" as an event that triggers a check of the remaining fallback path, not as a quiet state. And look for the software version of this bug: replicas that are "spread across three zones" until a scheduler puts two in one, or a health check that reads a signal next to the real one.

## Sources

- [Google Cloud Service Health, incident Xs2XTHzAVC9YnafnPyzj](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj): Google's status page with live updates, the preliminary incident report (22 Oct), and the final incident report (27 Oct, updated 4 Nov) covering the facility power design, PLC root cause, timeline, per-product impact and actions.
- [The Register, "When datacenters lose power, generators should kick in. That didn't happen for Google in London"](https://www.theregister.com/a/5307739): press coverage of the November 4 update, including named affected customers.
