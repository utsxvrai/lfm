---
title: "A 3ms voltage dip cost Google Cloud's europe-west4-a zone power and cooling for 15 hours"
dek: "A brief transient on the utility grid tripped both power feeds into a third-party data center in the Netherlands. One backup generator failed, one row of racks lost both feeds, and the chiller controller dropped offline while the redundant chiller was out for construction. The data hall reached 44°C and Google powered down VMware Engine, Bare Metal Solution and NetApp Volumes."
date: 2026-07-15
company: Google
kind: outage
topics: [power-cooling, hardware, cascading-failure]
stack: [gcp, vmware-engine, bare-metal-solution, netapp-volumes, drups]
duration_min: 895
impact: "Google Cloud VMware Engine, Bare Metal Solution and Cloud NetApp Volumes in europe-west4-a were disrupted for 14 hours 55 minutes; 24 private clouds of 20 GCVE customers and 9 BMS customers were affected."
detected_by: alert
rule: "Redundancy only counts if the redundant parts fail independently. Check what the A and B sides share (the grid, a controller, a construction schedule) and whether one side can actually carry the full load."
postmortem: https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw
sources: [https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw, https://w.media/electrical-fault-knocked-out-google-clouds-netherlands-zone/]
---

# A 3ms voltage dip cost Google Cloud's europe-west4-a zone power and cooling for 15 hours

On Wednesday, July 15, 2026, three Google Cloud products in the europe-west4-a zone in the Netherlands went down: Google Cloud VMware Engine (GCVE), Bare Metal Solution (BMS) and Google Cloud NetApp Volumes. Customers lost connectivity to their private clouds, database servers and storage volumes. Google's incident report puts the total disruption at [14 hours, 55 minutes](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw), from 16:39 on July 15 to 07:34 on July 16, US/Pacific.

The trigger, per the report: ["a 3ms voltage drop in the power feed from the utility provider and subsequent utility breaker protective action"](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw).

Three milliseconds of bad power turning into fifteen hours of outage is the story. The building had two power feeds, backup generators on each, an automatic transfer between feeds, and a redundant cooling system. Each of those layers failed or wasn't there.

## What happened

From the [incident report](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw). Its tables are labelled PST; the text says US/Pacific.

- **16:24.** An electrical fault on the utility grid upstream of the data center. The backup power system for side A fails to take the load. The chiller controller drops offline, and the chilled-water distribution pumps stop and can't restart.
- **16:30.** GCVE power monitoring alert received.
- **16:37.** Rows 1 and 2 transfer to power feed B. Row 3 fails to transfer and loses power.
- **16:41.** Servers report redundant power feed failures.
- **17:32.** All 6 NetApp clusters fail and shut down automatically due to high temperature.
- **18:29.** Data hall temperature reaches 44°C, past the safe operating threshold.
- **18:37.** Four NetApp SAN storage nodes used by BMS fail from overheating; first BMS server shutdown.
- **19:00–19:55.** GCVE server and network shutdown starts; all reachable server and network devices are down by 19:55.
- **21:05.** Cooling fully recovered; temperatures back in the normal range.
- **23:55.** All 6 NetApp clusters recovered and validated.
- **02:36 (Jul 16).** GCVE mitigated; all customer private clouds healthy.
- **08:42 (Jul 16).** All impacted BMS customer servers rebooted and confirmed healthy.

Google's numbers don't line up perfectly across the page. The headline impact window ends at [07:34](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw), but the BMS timeline in the same report marks the incident mitigated at 08:42. The preliminary report gives per-product durations of [9 hours 24 minutes for GCVE, 8 hours 31 minutes for NetApp Volumes and 12 hours 57 minutes for BMS](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw), with NetApp ending at 01:10, while the final NetApp timeline has all clusters recovered at 23:55. And the status page header says the incident [began at 16:57 and ended at 05:25](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw), which looks like the window of public updates rather than impact.

## What the engineers believed

The design assumption is the standard one for a data center: two independent utility feeds, A and B, each with its own backup. If one side has trouble, its backup takes over; if the backup fails, the load moves to the other side. Cooling has a redundant source too. Any single failure should be absorbed.

That's a reasonable assumption, and on side B it worked: the transfer to backup power was [successful without any power interruption](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw).

## What was actually going on

### One event hit both sides

The voltage transient affected [both utility power feeds A and B](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw), and the utility breakers on both tripped and started the transfer to the backup source, a DRUPS (Diesel Rotary Uninterruptible Power Supply). *Interpretation:* "two feeds" protects you from a fault on one feed. A disturbance upstream that reaches both is a common-mode event, so both sides became dependent on their backups at the same instant.

### Side A's backup failed, and row 3 couldn't fall back

The DRUPS for side A [failed to take over the facility load due to electrical component failures](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw). That triggered automatic transfer of the 3 affected rows from feed A to feed B. Rows 1 and 2 transferred. Row 3 failed and lost all power when an overload protection breaker tripped. Google attributes that to a ["load deployment discrepancy"](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw) that was still under investigation.

*Interpretation:* the report doesn't say more, but an overload trip on transfer suggests row 3 was drawing more than its B side could carry alone. Dual-feed redundancy assumes each side can take the full load. If the deployed load drifts past what one side can carry, everything looks fine (both feeds share the load) until the day you need one side to carry it all.

### Cooling failed for a different reason

This is what took most of the zone down. During the transient, the chiller controller [dropped offline](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw) and failed to signal the chilled-water distribution pumps to restart. The chillers themselves still had power, but with the pumps stopped there was [no water flow](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw), and chiller system A shut down. The redundant cooling source [was not available due to known ongoing construction work at the facility](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw).

```diagram
title: one transient, three layers down
flow: grid transient -> feed B to DRUPS -> rows 1-2 OK
flow!: grid transient -> DRUPS A fails -> row 3 overload trip
flow!: controller offline -> pumps stay off -> 44°C hall
note: the redundant chiller was out for construction
```

The data hall climbed to [44°C](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw). Hosts, storage clusters and network switches were shut down to protect the hardware and customer data, some automatically, the rest by Google's emergency shutdown procedure. So even the machines that never lost power went dark. That's why the impact went far beyond row 3: during the incident GCVE said it had [shut down all Private Clouds in this zone](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw).

*Interpretation:* the cooling failure is the more instructive one. The thing that failed wasn't the chiller or its power; it was a small controller whose job was to restart the pumps after a power event. Control systems often run on a different power path from what they control, and a "brief" disturbance that the big equipment rides through can still reboot the small box that tells it what to do.

### Where this was

W.Media notes that Google's europe-west4 region runs from Eemshaven, where Google has [its own data center that opened in 2016](https://w.media/electrical-fault-knocked-out-google-clouds-netherlands-zone/), but Google's wording points to a third-party facility provider, so it's [unclear where exactly](https://w.media/electrical-fault-knocked-out-google-clouds-netherlands-zone/) the affected facility is. Google's report does refer to the [data center provider](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw) fixing the failed systems.

## How they fixed it

The facility team switched the chilled-water pumps [from auto to hand mode](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw) to get water moving again, and deployed an interim portable UPS to keep the chiller controllers powered. When utility power was confirmed restored, the facility switched back automatically, except for two Remote Power Panels that needed manual checks before row power was restored. For row 3, teams reset the tripped breakers once the electrical fault was isolated. A swing DRUPS unit was aligned to restore redundancy on feed A while the faulty one was repaired.

Then came the slow part: field and remote engineers booted and verified server hosts, storage nodes and network fabric [in a controlled sequence](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw). For GCVE that included an onsite technician arriving at 22:40 to recover console servers. Cooling was back at 21:05, but GCVE wasn't healthy until 02:36 and BMS until the next morning.

## What changed afterwards

From the [report](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw):

- Investigate why the load didn't transfer to the DRUPS system [ETA Aug 2026].
- Find and fix the overload condition that cut power to row 3 [ETA Aug 2026].
- Investigate chiller pump control system redundancy [ETA Sep 2026].
- Better facility alerts for power events and earlier alert thresholds for cooling excursions [ETA Aug 2026].
- GCVE: better automated triggering of shutdown in fast thermal runaway [ETA Oct 2026].
- BMS: update incident classification and SLOs to improve personnel availability during major data center events [ETA Sep 2026].
- NetApp Volumes: review incident handling and runbooks with the data center team, set up a monthly joint emergency drill, and see if cluster recovery can be faster [ETA Aug 2026].

## The rule

Redundancy is a claim about independence, and it has to be checked like one. Both feeds shared the grid. Feed B was expected to carry row 3 alone and couldn't. The cooling had a second source, but that source was offline for construction the report calls "known", so (my reading) the facility was knowingly running without cooling redundancy. When you accept a period of reduced redundancy, treat it as a risk with a duration and a plan, not as background.

And look at the small controllers. Here the pumps needed a signal to restart, and the box that sends it didn't survive a 3ms disturbance.

## Sources

- [Google Cloud Service Health, incident 3BvH3LVGcupoYqV6F4Nw](https://status.cloud.google.com/incidents/3BvH3LVGcupoYqV6F4Nw): Google's final incident report (July 25, 2026), preliminary incident report (July 17) and live status updates; root cause, per-product timelines, impact counts, remediation and follow-ups.
- [W.Media, "Electrical fault knocked out Google Cloud's Netherlands zone"](https://w.media/electrical-fault-knocked-out-google-clouds-netherlands-zone/): coverage of the preliminary report and context on the facility's location.
