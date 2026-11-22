---
title: "Maintenance automation descheduled Google's network control plane in several US locations at once"
dek: "A maintenance event in one place stopped the jobs that run Google's network control plane in many places, because of two benign-looking configuration settings and a bug in the maintenance software. The network ran on autopilot for a few minutes, then BGP routes were withdrawn and US regions lost much of their capacity."
belief: "Google thought maintenance stayed local. A bug descheduled its network control plane in several US locations."
date: 2019-06-02
company: Google
kind: outage
topics: [automation, config-change, networking, bgp]
stack: [gcp, bgp, cluster-management]
impact: "Elevated packet loss in multiple Google Cloud US regions for between 3 hours 19 minutes and 4 hours 25 minutes; YouTube, Gmail and Google Cloud Storage were also affected."
detected_by: alert
rule: "Automation that drains or stops jobs needs a hard limit on blast radius that is enforced by the thing being drained, not just by the caller. And the system that controls the network must be recoverable without the network."
postmortem: https://status.cloud.google.com/incident/cloud-networking/19009
sources: [https://status.cloud.google.com/incident/cloud-networking/19009, https://cloud.google.com/blog/topics/inside-google-cloud/an-update-on-sundays-service-disruption]
---

# Maintenance automation descheduled Google's network control plane in several US locations at once

On Sunday 2 June 2019, Google Cloud projects in multiple US regions saw elevated packet loss from network congestion [for between 3 hours 19 minutes and 4 hours 25 minutes](https://status.cloud.google.com/incident/cloud-networking/19009), depending on the region. Customers saw latency, intermittent errors and lost connectivity to instances in us-central1, us-east1, us-east4, us-west2, northamerica-northeast1 and southamerica-east1. Google called it ["a major outage, both in its scope and duration"](https://status.cloud.google.com/incident/cloud-networking/19009).

It wasn't only Cloud. In a blog post two days later, Google's VP of 24x7, Benjamin Treynor Sloss, wrote that [YouTube measured a 2.5% drop in views for one hour](https://cloud.google.com/blog/topics/inside-google-cloud/an-update-on-sundays-service-disruption), Google Cloud Storage a 30% reduction in traffic, and about 1% of active Gmail users had problems, which ["still represents millions of users who couldn't receive or send email"](https://cloud.google.com/blog/topics/inside-google-cloud/an-update-on-sundays-service-disruption).

No link was cut and no router failed. Software that automates datacenter maintenance stopped the jobs that run the network's control plane, in more places than it should have, and the network did exactly what it was designed to do once its brain went away.

## What happened

From [Google's incident report](https://status.cloud.google.com/incident/cloud-networking/19009), times US/Pacific:

- **11:45.** A maintenance event starts in a single physical location. The automation builds a list of jobs to deschedule there. The list includes logical clusters that run network control jobs, and those clusters also contain network control jobs in **other** physical locations. The automation deschedules all of them.
- **A few minutes later.** The network keeps running normally for ["several minutes"](https://status.cloud.google.com/incident/cloud-networking/19009) without its control plane. Then BGP routing between specific locations is withdrawn, network capacity drops sharply and some regions become inaccessible.
- **11:47 to 11:49.** End-user impact begins.
- **13:01.** Root cause found. Engineers halt the maintenance automation and start re-enabling the network control plane.
- **14:03.** Rebuilt configuration begins rolling out.
- **15:19.** Network capacity starts to recover.
- **16:10.** Full service resumed.

The sources aren't perfectly consistent on the edges. The incident page header lists the incident as [beginning at 11:45 and ending at 15:40](https://status.cloud.google.com/incident/cloud-networking/19009), its summary line says resolved as of 4:00pm, and the report body says full service resumed at 16:10. The detailed impact section reports us-east1 packet loss [from 11:38](https://status.cloud.google.com/incident/cloud-networking/19009), before the 11:45 start. On detection, the report says engineers were [alerted two minutes after the failure began](https://status.cloud.google.com/incident/cloud-networking/19009), while the blog says the issue was [detected within seconds](https://cloud.google.com/blog/topics/inside-google-cloud/an-update-on-sundays-service-disruption).

## What the engineers believed

The design was built around redundancy at every level. Within one physical datacenter, machines are split into [multiple logical clusters, each with its own cluster management software](https://status.cloud.google.com/incident/cloud-networking/19009), so one cluster manager failing doesn't matter. The network control plane runs under several separate instances of that cluster management software in each location, ["so that failure of any individual instance has no impact on network capacity"](https://status.cloud.google.com/incident/cloud-networking/19009).

Maintenance was also routine. Google's scale makes maintenance events ["globally common, although rare in any single location"](https://status.cloud.google.com/incident/cloud-networking/19009). Each job is labelled with how it should behave during one: move to a machine not under maintenance, or stop and be rescheduled after.

The assumption was that maintenance is local. An event in one location affects jobs in that location, and redundancy across instances and locations covers the rest. Each of the three things that broke this assumption looked harmless alone.

## What was actually going on

### Three ingredients

The report says [two normally-benign misconfigurations and a specific software bug](https://status.cloud.google.com/incident/cloud-networking/19009) combined:

1. **Network control plane jobs were set to stop during maintenance**, rather than move. For a job in one location during local maintenance, that's tolerable, because other instances keep running.
2. **The cluster management instances running the network control plane were eligible for a particular, relatively rare type of maintenance event.**
3. **The maintenance software had a bug** that let it deschedule multiple independent software clusters at once, ["crucially even if those clusters were in different physical locations"](https://status.cloud.google.com/incident/cloud-networking/19009).

The bug is what turned a local event into a regional one. The logical clusters in scope spanned multiple physical sites, and the automation acted on the whole logical cluster rather than on the part of it in the location under maintenance. Every redundant instance that was supposed to keep the control plane alive was in the same blast radius.

```diagram
title: how one site's maintenance hit many
flow: maintenance at A -> jobs to deschedule -> logical clusters
flow!: span sites A, B, C -> control plane gone -> BGP withdrawn
note: redundancy across instances didn't help; all were in scope
```

The status report's root-cause section describes the trigger as maintenance automation. The blog post frames it as ["a configuration change that was intended for a small number of servers in a single region"](https://cloud.google.com/blog/topics/inside-google-cloud/an-update-on-sundays-service-disruption) but applied to servers across several neighboring regions. Both describe the same thing at different levels of detail: an action scoped to one place that reached many.

### Fail static, then fail

Background: a network has a data plane, which forwards packets using routing tables already installed in the switches and routers, and a control plane, which computes those routes, keeps them up to date and speaks routing protocols such as BGP with neighbors. Losing the control plane doesn't stop packets immediately. The installed routes keep working until something expires them.

Google designed for that. The network is built to ["fail static"](https://status.cloud.google.com/incident/cloud-networking/19009) and run for a period without the control plane, as a second line of defense. That window held: the network ran normally for several minutes. But the control plane didn't come back, because the automation had stopped it on purpose, and when the window ran out, BGP routing between the affected locations was withdrawn.

The report doesn't explain the exact mechanism of the withdrawal. As general background, BGP sessions use hold timers and keepalives; routes learned from a peer that stops responding are eventually withdrawn, and that is a safety feature, because a router shouldn't keep sending traffic toward a neighbor that may be gone. Here the safety feature removed paths that were physically fine.

### Why it showed up as congestion, not a clean outage

Losing routes didn't mean losing all paths. It meant losing capacity. The blog post says the affected regions [stopped using more than half of their available network capacity](https://cloud.google.com/blog/topics/inside-google-cloud/an-update-on-sundays-service-disruption). Traffic to and from those regions then tried to fit into what remained, and didn't. Google's networking systems prioritized, dropping ["larger, less latency-sensitive traffic in order to preserve smaller latency-sensitive traffic flows"](https://cloud.google.com/blog/topics/inside-google-cloud/an-update-on-sundays-service-disruption).

That explains the uneven impact. High-bandwidth services suffered most: per the report, Cloud Storage error rates in us-west2 averaged [96.2%](https://status.cloud.google.com/incident/cloud-networking/19009), while low-bandwidth services like Search saw only [a short-lived increase in latency](https://cloud.google.com/blog/topics/inside-google-cloud/an-update-on-sundays-service-disruption) as they shifted to unaffected regions. Compute Engine instances in us-east4, us-west2, northamerica-northeast1 and southamerica-east1 [were inaccessible for the duration](https://status.cloud.google.com/incident/cloud-networking/19009). Regions us-west1, Europe and Asia did not have regional congestion.

### Why diagnosis and recovery were slow

Two things stretched the outage.

**The tools needed the network.** Debugging was ["significantly hampered by failure of tools competing over use of the now-congested network"](https://status.cloud.google.com/incident/cloud-networking/19009). The backup plans worked but were slow: they included engineers travelling to secure facilities and lowering the priority of less critical traffic classes to reduce congestion. The blog makes the same point: the congestion that caused the degradation ["also slowed the engineering teams' ability to restore the correct configurations"](https://cloud.google.com/blog/topics/inside-google-cloud/an-update-on-sundays-service-disruption).

**The control plane's configuration was gone.** With every instance of the network control plane descheduled in several locations, [configuration data had been lost and needed to be rebuilt and redistributed](https://status.cloud.google.com/incident/cloud-networking/19009). The redundant instances had been each other's source of state. When all of them stopped together, there was nothing to recover from, and rebuilding the config for multiple locations during a major network event took time. The root cause was known at 13:01; the new configuration didn't begin rolling out until 14:03.

## How they fixed it

Engineers halted the maintenance automation at 13:01, rescheduled the network control plane jobs, rebuilt and distributed their configuration, and watched capacity come back location by location from 15:19. In parallel, teams across Google moved their own services' traffic [away from the affected regions](https://status.cloud.google.com/incident/cloud-networking/19009).

## What changed afterwards

Google listed these changes in the [report](https://status.cloud.google.com/incident/cloud-networking/19009):

- The maintenance automation was halted and would only return with safeguards against descheduling jobs in multiple physical locations at once.
- Cluster management software would reject such requests ["regardless of origin"](https://status.cloud.google.com/incident/cloud-networking/19009), as an extra layer of defense.
- The network control plane would reject the type of maintenance request involved.
- The control plane in each location would persist its configuration, so it doesn't need rebuilding if all jobs are descheduled. Google expected this to [reduce recovery time by an order of magnitude](https://status.cloud.google.com/incident/cloud-networking/19009).
- The network would stay in fail-static mode longer after losing the control plane.
- Emergency tooling, including customer communication tooling, would be reviewed and tested against network failures of this kind, and disaster recovery testing would cover this class of failure.

## The rule

Redundancy only helps if the copies can't be taken out by the same action. When automation can stop jobs, the limit on how much it can stop at once has to be enforced by the system receiving the request, not trusted to the caller, because callers have bugs. And the system that runs your network should be able to restart from its own persisted state, with operator tools that still work when the network is the thing that's broken.

## Sources

- [Google Cloud Status Dashboard, "Google Cloud Networking Incident #19009"](https://status.cloud.google.com/incident/cloud-networking/19009): Google's incident report, with root cause, timeline, remediation, follow-up actions and per-service impact, plus the live updates from 2 June 2019.
- [Benjamin Treynor Sloss, "An update on Sunday's service disruption", Google Cloud Blog](https://cloud.google.com/blog/topics/inside-google-cloud/an-update-on-sundays-service-disruption): Google's interim public explanation from 4 June 2019, with impact on YouTube, Gmail and Cloud Storage and the congestion mechanism.
