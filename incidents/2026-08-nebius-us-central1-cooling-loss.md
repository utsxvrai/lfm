---
title: "A storm took out Nebius's cooling and the system that would have reported it"
dek: "A storm-related event at the us-central1 facility disabled both the chilled-water loop and the building management system that monitors it, so no facility alert fired while the halls overheated. Bringing a whole region back from a hard power loss then exposed recovery automation built for one failure at a time, and a disk hot-plug bug kept Kubernetes control planes down for hours."
date: 2026-08-19
company: Nebius
kind: outage
topics: [power-cooling, monitoring, automation, software-bug]
stack: [kubernetes, etcd, gpu, s3, block-storage]
impact: "Region-wide disruption of us-central1: GPU and CPU compute, VM external connectivity, object and block storage, Managed Kubernetes, Token Factory, managed platform services and the regional API and console."
detected_by: alert
rule: "Monitoring must not share a failure domain with the thing it monitors, and recovery automation has to be designed for the day everything fails at once, not only for one broken host."
postmortem: https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19
sources: [https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19]
---

# A storm took out Nebius's cooling and the system that would have reported it

On August 19, 2026, a storm-related event hit the building of the data center that hosts Nebius's us-central1 region. It took the facility's building management system offline and [shut down the chilled-water cooling loop](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19). With no active cooling, the data halls [overheated within roughly two hours](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19), and servers, network switches and rack power systems began shutting down on thermal protection.

Almost everything in the region was hit: GPU and CPU compute, external networking for VMs, object and block storage, Managed Kubernetes, the Token Factory inference service, managed platform services and the regional API and console. [Roughly one third](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19) of running VMs in the region were interrupted. Peak air inlet temperature reached [58.5 °C](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19).

The facility itself was thermally stable [about six hours](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19) after the storm. The platform took much longer. Nebius declared the incident fully mitigated at [08:38 UTC on August 20](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19), when all reserved GPU capacity was confirmed restored. Nebius's own summary is that restoring the platform "took significantly longer than the facility recovery itself". That gap is the interesting part of this incident.

## What happened

All times UTC, from the [postmortem](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19):

- **~08:30.** The storm-related event takes the building management system (BMS) offline. The chilled-water loop shuts down.
- **~09:15.** Regional dashboards start showing a temperature rise. No alert exists on that metric; Nebius found it afterwards.
- **~09:40.** InfiniBand fabric degradation and GPU over-temperature alerts start to accumulate. First customer reports arrive shortly after 10:00.
- **10:15.** On-call engineers are paged on critical component temperature alerts.
- **10:21.** Incident declared. At 10:27 the team tries to reach the facility operator; contact is made at 10:46.
- **~10:40–11:00.** Rack power systems trip on thermal overload, including racks with regional control-plane and network gateway components. External VM connectivity is fully lost by 11:00.
- **11:15.** The operator switches cooling to manual bypass mode; rack rear doors are opened to vent heat. First temperature drop at 11:45.
- **12:11–12:26.** Tripped racks re-energized, control-plane racks first.
- **12:42.** Regional infrastructure control plane restored after manual intervention. External VM connectivity back at 12:50; object storage at 13:27.
- **15:43–18:11.** Kubernetes control planes come back in waves, but 79 clusters still have an unreachable control plane at 18:11.
- **18:17.** The cause of the long Kubernetes outage is found: a disk hot-plug bug.
- **21:58.** All Managed Kubernetes clusters reported healthy.
- **Aug 20, 08:38.** All reserved GPU capacity confirmed restored. Incident fully mitigated.

The public status page was opened at [10:43 UTC](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19) and marked resolved at 08:16 UTC on August 20.

## What the engineers believed

The implicit belief was that a cooling failure would announce itself. Facilities have a building management system precisely so that someone gets told when the chillers stop.

That belief had a hidden dependency. Nebius writes that the BMS ["is also the system that monitors the facility"](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19), so when the storm disabled it, no facility-level alert reached either the operator or Nebius. On Nebius's own side, the temperature trend was visible on dashboards from around 09:15, but [no alerting existed](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19) on facility or room temperature. The first signals anyone acted on were component over-temperature alerts at 10:15, which Nebius calls "a consequence rather than the cause".

The second belief was about recovery. Nebius's VM recovery, disk attachment handling and Kubernetes control planes all had automation that worked for isolated failures. Nobody had yet run that automation against an entire region coming back from a hard power loss.

## What was actually going on

### Detection lost the race with heat

The order of events matters. Cooling stopped around 08:30, the halls overheated within about two hours, and humans were first paged at 10:15. By the time anyone considered shedding heat load in a controlled way, [about a quarter of the affected servers](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19) had already shut down. There was, in Nebius's words, "no practical window" to do it gracefully.

*Interpretation:* this is the general shape of a monitor that shares a failure domain with what it monitors. The BMS failing and the chillers failing were one event, so "BMS is silent" looked the same as "everything is fine". The useful signal (a room getting hotter) existed, but only as a graph nobody was paged on.

### A whole-region cold start

Once power and cooling returned, several recovery paths needed humans:

- **The infrastructure control plane** did not come back unattended. It needed [about two hours](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19) of manual restoration before anything depending on it could recover.
- **VM recovery** is designed as a single attempt per instance and is rate-limited, to protect the platform during isolated failures. The platform launched recovery for roughly a third of all running instances; [about a third of those attempts succeeded](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19). Most of the rest failed on storage-attachment errors and were not retried automatically. The rate limits had to be raised by hand at around 14:25.
- **Stale disk attachments.** Hosts that lost power abruptly left disks with attachment state that said they were still in use. Those disks could not be mounted or deleted until the state was reconciled manually. Block-storage host components were restarted between 13:41 and 13:56 to clear it, but by then many one-shot VM recovery attempts had already failed.
- **Stopped versus stopped.** The platform could not tell instances stopped by the incident from instances customers had stopped on purpose. At 20:53, [104 customer VMs](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19) stopped by the incident were identified and started.

*Interpretation:* every one of these is a reasonable design for the normal case. A single recovery attempt avoids flapping. A rate limit stops a recovery storm from hurting healthy tenants. But each assumes failures are rare and independent. When a third of the region fails at once, "one try, slowly" means most of the work falls to people.

### The hot-plug bug

Managed Kubernetes control planes store their state (etcd) on secondary data disks attached to the control-plane VMs. Nebius found a bug in its managed disks hot-plug functionality that [could leave a data disk unattached](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19) when an instance was recovered.

So the VM came back, but without the disk holding its cluster's data. The first recovery wave (15:43–16:05) brought roughly half of the control planes back. Around 140 clusters were still estimated unreachable at 16:15–16:23; manual starts restored another quarter by about 17:00; and at 18:11, [79 clusters](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19) still had no reachable control plane, with etcd unavailable.

*Background:* "hot-plug" here means attaching a disk to a VM while it runs, rather than defining it at boot. The postmortem doesn't explain the bug's internals. What it shows is that the bug only mattered on the recovery path, which is exactly the path that gets exercised least.

```diagram
title: why nobody was told
flow: storm -> BMS and chillers off -> halls overheat
flow!: BMS down -> no facility alert -> paged on GPU temps
note: the monitor shared a failure domain with the thing it monitored
```

### The console flapped back into a dead region

Global console traffic failed over away from us-central1 at 10:52. At 11:01, a health check [incorrectly reported the region as recovered](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19), and some console traffic went back to it for about seven minutes until engineers removed the region from rotation by hand. Regional monitoring also depended on components inside the region, so responders had less visibility exactly when they needed it.

## How they fixed it

The facility operator switched cooling to manual bypass at 11:15 and opened rack rear doors. Once temperatures fell, racks were re-energized with control-plane racks first. From there it was layer by layer: manual restoration of the infrastructure control plane, restarting block-storage host components to clear stale attachments, manually raising VM recovery rate limits, and manually starting Kubernetes control-plane instances.

The Kubernetes fix was a controlled stop and start of the affected control-plane instances. It was tested on one cluster by 18:30 and applied at scale between 19:36 and 19:55, taking clusters with an unreachable control plane [from 55 to 8](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19). All clusters were healthy at 21:58. On-demand GPU capacity stayed reduced for several more days while individual nodes went through the normal hardware repair process.

Nebius does note what worked: improvements from earlier incidents meant control-plane racks were powered first, network gateways were back within about two hours of power returning, and object storage recovered automatically.

## What changed afterwards

From the [post-incident action plan](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19):

- **Facility:** a joint resilience review with the operator, covering redundancy of the facility-management and monitoring systems and whether cooling can keep running if they fail; facility-level environmental alerting (cooling plant state, room temperature trend) that pages Nebius independently of the BMS; a documented emergency escalation path; and an emergency heat-load reduction procedure.
- **Region recovery:** a formal, dependency-ordered cold-start procedure, and regular region-scale recovery drills that cover VMs, storage attachments and Kubernetes clusters.
- **Customer resources:** the disk-attachment bug is fixed and deployed to all regions (completed); better recovery policies for instances; automated reconciliation of stale storage attachments.
- **Observability:** remove in-region dependencies from monitoring, and make the health checks used for global traffic management reflect real availability.

## The rule

If the only thing that can tell you a system has failed is part of that system, you have no alert for that failure. Put an independent signal on the cause (room temperature, chiller state), not just on the consequences (hot GPUs).

And test recovery at the scale of the failure you're afraid of. Single-attempt, rate-limited automation is right for one dead host; for a dead region it turns into a queue of manual work, and bugs that live only on the recovery path, like this hot-plug bug, wait for exactly that day.

## Sources

- [Nebius, "Incident post-mortem analysis: us-central1 service disruption on August 19, 2026", August 27, 2026](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19): Nebius's postmortem, with the per-service impact, full timeline, root cause, the hot-plug bug, response lessons and action plan.
