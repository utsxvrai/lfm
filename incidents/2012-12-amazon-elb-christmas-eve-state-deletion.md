---
title: "A maintenance job deleted AWS load balancer state on Christmas Eve, and Netflix went dark on TVs"
dek: "A process run against production ELB state data by mistake didn't break any load balancers directly. The damage came later, each time the control plane tried to change a load balancer using data that was no longer there."
date: 2012-12-24
company: Amazon
kind: outage
topics: [human-error, backup, auth, automation]
stack: [aws, elb]
impact: "At peak, 6.8% of running ELB load balancers in US-East were impacted; Netflix streaming on TV-connected devices was disrupted on Christmas Eve."
rule: "A control plane that writes from its own stored state will faithfully spread a hole in that state. Gate production data access per change, and teach reconcilers to stop when their source of truth looks wrong."
postmortem: https://aws.amazon.com/message/680587/
sources: [https://aws.amazon.com/message/680587/, https://web.archive.org/web/2013/http://techblog.netflix.com/2012/12/a-closer-look-at-christmas-eve-outage.html]
---

# A maintenance job deleted AWS load balancer state on Christmas Eve, and Netflix went dark on TVs

On Christmas Eve 2012, Netflix subscribers in the US, Canada and Latin America sat down in front of their TVs, game consoles and streaming boxes and found that Netflix wouldn't start. The website still worked, and Macs and PCs could mostly still stream. But game consoles and several other device types were [impacted for about seven hours](https://web.archive.org/web/2013/http://techblog.netflix.com/2012/12/a-closer-look-at-christmas-eve-outage.html).

The cause was inside AWS. At [12:24 PM PST](https://aws.amazon.com/message/680587/) on December 24, a maintenance process was accidentally run against the production state data of Elastic Load Balancing (ELB) in the US-East region, and part of that data was logically deleted. At the peak, [6.8% of running ELB load balancers](https://aws.amazon.com/message/680587/) were impacted. Several of them were Netflix's.

What makes this incident worth studying isn't the deletion itself. It's that nothing broke at first. The running load balancers kept forwarding traffic. The damage spread over the following hours as a well-behaved control plane did its normal job using data that was no longer complete.

## What happened

From [AWS's summary](https://aws.amazon.com/message/680587/), all times PST:

- **Dec 24, 12:24 PM:** a maintenance process, run by one of a very small number of developers with access to the production environment, logically deleted part of the ELB state data. The developer didn't realize the mistake at the time.
- **Right after:** the ELB control plane showed high latency and error rates on API calls. Running load balancers were unaffected.
- **Next couple of hours:** the team focused on the API errors and was puzzled that some APIs worked (creating and managing *new* load balancers) while others failed (managing existing ones). Meanwhile some customers began seeing problems on running load balancers that the control plane had tried to change.
- **Root cause found:** digging into degraded load balancers, the team identified the missing state data.
- **5:02 PM:** several control plane workflows, including scaling and descaling, were disabled to stop more load balancers being damaged.
- **Overnight:** a first restore method ran for several hours and failed to produce a usable snapshot.
- **Dec 25, 2:45 AM:** a snapshot from just before the deletion was restored by another method.
- **5:40 AM:** the merge of that snapshot with later changes was complete and verified.
- **8:15 AM:** most APIs and workflows re-enabled. **10:30 AM:** almost all affected load balancers restored. **12:05 PM:** AWS announced normal operation.

Netflix's account matches from the customer side: traffic stopped on a few ELBs at [12:24 PM Pacific](https://web.archive.org/web/2013/http://techblog.netflix.com/2012/12/a-closer-look-at-christmas-eve-outage.html), more ELBs, used by game consoles, mobile and other devices, stopped around 3:30 PM, and those were patched back around 10:30 PM. AWS finished restoring all of Netflix's ELBs around 8 AM on December 25.

## What the engineers believed

Two beliefs matter here.

**The operator's belief:** they were running the maintenance process somewhere safe. AWS doesn't say what the process was meant to do, only that it was ["inadvertently run against the production ELB state data"](https://aws.amazon.com/message/680587/). The developer had standing access, so nothing stopped the command.

**The responders' belief:** an API error-rate problem is an API problem. For hours the team chased latency and errors in the control plane's API. That made sense: the data plane was fine, and only some API calls failed. The pattern of *which* calls failed, new load balancers fine and existing ones broken, was the clue that the state behind existing load balancers was missing. It took the running load balancers starting to degrade to make that obvious.

## What was actually going on

### Control plane, data plane, and the state between them

An ELB is a fleet of proxy nodes (the **data plane**) plus a management system (the **control plane**). The control plane keeps a central record of each load balancer's configuration, for example the [back-end hosts each load balancer should route to](https://aws.amazon.com/message/680587/). When a customer changes a load balancer, or the load balancer needs to scale up or down, the control plane reads that record and pushes a new configuration to the nodes.

The proxies themselves already have their configuration loaded. They don't need to consult the central record to forward a packet. That's why AWS says the missing data ["was not integral to the basic operation of running load balancers"](https://aws.amazon.com/message/680587/), and why nothing broke at 12:24.

### How a hole in state spreads

The trouble starts the moment the control plane *writes*. To change a load balancer it builds the full desired configuration from its central record, then applies it. If part of that record is missing, the computed configuration is wrong. AWS says load balancers that were modified [were improperly configured by the control plane](https://aws.amazon.com/message/680587/).

And modifications happen all the time without anyone asking: ELBs scale with traffic. So every time a load balancer whose state was missing needed to grow, shrink, or be updated by its owner, the control plane overwrote its healthy running configuration with a broken one.

```diagram
title: how missing state reached the data plane
flow: state deleted -> proxies keep config -> traffic still flows
flow!: scale or edit event -> config from hole -> proxy breaks
note: damage spread one write at a time
```

This is why the spread was gradual, and why disabling the scaling and descaling workflows at 5:02 PM was the first effective containment. With the writers stopped, no more running load balancers could be overwritten. The cost was that the [rest of the load balancers couldn't scale or be modified](https://aws.amazon.com/message/680587/) until recovery.

The general shape is a **reconciler that trusts its source of truth unconditionally.** It's the same pattern as a config-management tool applying an empty file, or a Kubernetes controller acting on a truncated list. The reconciler isn't buggy. It's doing exactly what it was designed to do with input that should never have been possible.

### Why the restore took all night

A plain point-in-time restore would have been wrong: thousands of legitimate changes had happened after 12:24 PM. AWS's plan was to restore to [just before 12:24 PM](https://aws.amazon.com/message/680587/) and then merge in every event since, to rebuild an accurate state for each load balancer.

The first restore method took several hours and didn't produce a usable snapshot. Only after an alternate process restored a good snapshot at 2:45 AM could the merge start, and it took until 5:40 AM. Re-enabling workflows then had to be slow and careful to avoid harming load balancers that had been fine all along. AWS's summary doesn't explain why the first restore method failed.

### Why it hit TVs and not laptops

Netflix used [hundreds of ELBs](https://web.archive.org/web/2013/http://techblog.netflix.com/2012/12/a-closer-look-at-christmas-eve-outage.html), each for a distinct service or service version, and groups of similar devices tended to depend on specific ELBs. Only a handful failed, but those were the ones game consoles, mobile and other devices used to start up and load lists of titles. Devices already playing often kept going. The Netflix site and PC/Mac streaming stayed up. Netflix was built to survive the loss of an Availability Zone, but this failure was across [all availability zones](https://web.archive.org/web/2013/http://techblog.netflix.com/2012/12/a-closer-look-at-christmas-eve-outage.html) in the region at once, because it lived in a regional control plane.

## How they fixed it

Containment was disabling the control plane workflows that write to load balancers. Some affected load balancers were recovered manually that night. The full recovery was the snapshot restore plus merge, followed by gradually re-enabling workflows and APIs.

## What changed afterwards

AWS listed three changes in its [summary](https://aws.amazon.com/message/680587/):

1. **Access control.** The small group of developers had access for operational processes being automated, and that access had been [incorrectly set to be persistent](https://aws.amazon.com/message/680587/) instead of requiring per-access approval. All access to production ELB data now requires per-incident Change Management approval. AWS says this protection, used across its services, would have prevented the deletion.
2. **Recovery process.** The data recovery process was updated with what was learned, and AWS expected to recover similar data significantly faster.
3. **Self-healing control plane.** AWS planned to reprogram the control plane workflows to reconcile central service data with actual load balancer state, so the service could recover from logical data loss without a manual restore.

Netflix said it would work in 2013 on [running in more than one AWS region](https://web.archive.org/web/2013/http://techblog.netflix.com/2012/12/a-closer-look-at-christmas-eve-outage.html) to survive regional failures.

That third AWS item is the transferable idea. The running load balancers were themselves a copy of the truth. A control plane that compares its records with what's actually deployed, and refuses to push when they disagree sharply, turns a silent hole into a loud alarm.

## The rule

Standing write access to production state is an incident waiting for a typo; require approval per change. And if your control plane rebuilds the world from a central record, give it a sanity check before it writes: when the record suddenly says much less than reality does, stop and page someone instead of "fixing" reality to match.

## Sources

- [AWS: Summary of the December 24, 2012 Amazon ELB Service Event in the US-East Region](https://aws.amazon.com/message/680587/): the official postmortem with timeline, mechanism and changes.
- [Netflix Tech Blog: A Closer Look At The Christmas Eve Outage (Adrian Cockcroft, December 31, 2012), via Internet Archive](https://web.archive.org/web/2013/http://techblog.netflix.com/2012/12/a-closer-look-at-christmas-eve-outage.html): customer-side impact on Netflix streaming and its resiliency plans.
