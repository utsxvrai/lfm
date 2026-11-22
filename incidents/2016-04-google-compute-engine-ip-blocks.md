---
title: "Google Compute Engine withdrew its own IP blocks from the internet, and the canary's warning got lost"
dek: "Removing one unused IP block hit a bug that dropped every GCE block from the new network config. The canary caught it, a second bug threw away the verdict, and BGP anycast hid the damage until the last site stopped announcing."
belief: "Google trusted a canary to catch bad network config. A bug skipped it, and GCE's IPs stopped being announced."
date: 2016-04-11
company: Google
kind: outage
topics: [bgp, config-change, automation, software-bug]
stack: [gce, bgp, cloud-vpn, network-load-balancer]
duration_min: 18
impact: "Google Compute Engine instances in all regions lost external connectivity for 18 minutes, from 19:09 to 19:27 Pacific Time."
detected_by: alert
rule: "A safety check that can be ignored isn't a safety check. Make the rollout fail closed on the canary's verdict, and watch for lost redundancy even while things still appear to work."
postmortem: https://status.cloud.google.com/incident/compute/16007
sources: [https://status.cloud.google.com/incident/compute/16007]
---

# Google Compute Engine withdrew its own IP blocks from the internet, and the canary's warning was ignored

On Monday, 11 April 2016, Google Compute Engine instances in every region [lost external connectivity for 18 minutes, from 19:09 to 19:27 Pacific Time](https://status.cloud.google.com/incident/compute/16007). Inbound internet traffic to GCE wasn't routed correctly. Connections dropped and couldn't be re-established. Network load balancers and Cloud VPN, which depend on that inbound path, failed with it.

Google called it severe enough to offer credits to all affected customers of [10% of monthly GCE charges and 25% of monthly VPN charges](https://status.cloud.google.com/incident/compute/16007), more than its SLAs required.

The chain of events started more than four hours earlier, at 14:50, with a routine change: deleting an IP block nobody was using. Two software bugs and one well-intentioned fault-tolerance feature turned that into a global outage, and the outage stayed hidden until almost the end.

## What happened

From [Google's incident report](https://status.cloud.google.com/incident/compute/16007), all times Pacific:

- **14:50.** Engineers remove an unused GCE IP block from the network configuration and tell the automated systems to propagate it. This kind of change had been made before without problems.
- **Bug one.** The configuration management software detects an inconsistency. Its designed response is to fail safe and keep the current configuration. A previously unseen bug makes it instead remove *all* GCE IP blocks from the new configuration and start pushing that.
- **Bug two.** The canary site correctly finds the new config unsafe. A second bug fails to pass that result back to the push process, which treats the config as valid and starts a progressive rollout.
- **Rollout.** Each site that gets the config stops announcing GCE IP blocks. Traffic moves to the sites still announcing them.
- **18:14.** Cloud VPN in asia-east1 stops working, because it was announced from fewer sites than GCE overall. User latency to GCE rises. SREs start investigating when the first alerts arrive.
- **19:07.** The last site announcing GCE IP blocks gets the config. That's [53 minutes](https://status.cloud.google.com/incident/compute/16007) after the investigation started.
- **19:08–19:09.** Traffic loss becomes visible, with dozens of alerts within seconds. Inbound traffic loss passes [95% by 19:09](https://status.cloud.google.com/incident/compute/16007).
- **Decision.** Engineers revert the most recent network configuration changes without yet knowing for sure what the problem was.
- **19:27.** Connectivity is restored.
- **07:00 on 12 April.** The team is confident the root cause was a bug in the network configuration management software.

There's one small inconsistency. The live status updates on the same page give the start of the asia-east1 VPN issue as [18:25](https://status.cloud.google.com/incident/compute/16007), while the final report says [18:14](https://status.cloud.google.com/incident/compute/16007). This post uses the report's timeline.

## What the engineers believed

Google had layers of defense, and each one rested on a reasonable belief:

1. **Removing an unused block is harmless.** It had been done before. Nobody was using the block.
2. **The config system fails safe.** If it finds an inconsistency, it [keeps the current configuration](https://status.cloud.google.com/incident/compute/16007) instead of pushing the new one.
3. **The canary stops bad configs.** A config goes to one site first, gets checked, and only then rolls out.
4. **Progressive rollout limits the damage.** Changes go to [only a fraction of sites at a time](https://status.cloud.google.com/incident/compute/16007), so a new failure shows up early.

The first three failed outright. The fourth worked as built, but the fault tolerance underneath it made the damage invisible.

## What was actually going on

### Anycast: one prefix, many doors

GCE's external addresses come from contiguous IP blocks. Google announces them to the rest of the internet with [BGP](https://status.cloud.google.com/incident/compute/16007), the protocol networks use to tell each other "send traffic for these addresses to me".

Google announces [the same IP blocks from several different locations](https://status.cloud.google.com/incident/compute/16007). This is anycast. Every location advertises the same prefix, and each network on the internet picks the route it prefers, which is usually the shortest path. That gives users the nearest door into Google. It also gives resilience: if one location stops announcing, BGP withdraws those routes and traffic shifts to the next-best location. Google calls this the internet's ["fabled ability to 'route around' problems"](https://status.cloud.google.com/incident/compute/16007).

Keep that in mind, because it's why the rollout looked nearly harmless for four hours.

### Bug one: "fail safe" that deleted everything

The trigger was a timing quirk. The unused block had been removed from [one configuration file but not yet from a second file](https://status.cloud.google.com/incident/compute/16007) that the configuration management also used. The software spotted the mismatch. Its designed behavior was to fall back to the current config. Because of a bug, it [removed all GCE IP blocks from the new configuration](https://status.cloud.google.com/incident/compute/16007) and started pushing that.

The fail-safe path is code that almost never runs, and code that almost never runs is where bugs hide.

### Bug two: the canary caught it and nobody acted

The canary did its job: it [correctly identified that the new configuration was unsafe](https://status.cloud.google.com/incident/compute/16007). A second bug meant that verdict never reached the push process. The push system had no failure signal, assumed success and went ahead with the progressive rollout.

The canary was effectively reporting into a void. The check ran, but nothing was set up to stop the rollout if the check failed or never answered.

### Why progressive rollout didn't reveal it

Normally a progressive rollout limits damage. The first few sites break, someone notices, and the rollout stops. Here, each site that got the bad config stopped announcing GCE blocks, and anycast did exactly its job: traffic moved to the [remaining sites still announcing](https://status.cloud.google.com/incident/compute/16007). Users were still reachable. They were just routed to a door further away.

So partway through, the failure only looked like slightly higher latency. Two anomalies showed up: latency rising as users were routed to distant sites, and the asia-east1 VPN failing early because it had fewer announcing sites. SREs were investigating, but as a localized problem. Then the last site got the config. With no site left announcing GCE blocks, there was nowhere left to route, and traffic fell off a cliff within a minute.

Google states the lesson directly: ["the safeguard of a progressive rollout can be undone by a system designed to mask partial failures."](https://status.cloud.google.com/incident/compute/16007)

```diagram
title: how anycast hid the rollout
flow: site gets config -> stops announcing -> traffic shifts away
flow!: last site withdraws -> nowhere to route -> >95% loss
note: canary said unsafe; a bug dropped the verdict
```

## How they fixed it

When the alerts fired at 19:08, the engineers who had been investigating asia-east1 VPN realized the problem was widespread. They [decided to revert the most recent configuration changes](https://status.cloud.google.com/incident/compute/16007) before knowing for sure what the cause was. Google says this is what it trains for, and that the time from detection to decision to revert to the end of the outage was ["just 18 minutes"](https://status.cloud.google.com/incident/compute/16007).

They then froze all network configuration changes and worked in shifts overnight. First they made sure the systems were stable with no remaining customer impact, then found the root cause by 07:00 the next morning.

## What changed afterwards

When the report was written on the evening of 12 April, [14 distinct engineering changes](https://status.cloud.google.com/incident/compute/16007) were planned across prevention, detection and mitigation. The immediate ones listed:

- **Monitoring specific GCE network paths** to detect if they change or stop working.
- **Comparing IP block announcements before and after a config change** to make sure they're identical in size and coverage.
- **Semantic checks on network configurations** to make sure they contain specific Cloud IP blocks.

The report also names a broader action: ["monitoring directly for a decrease in capacity or redundancy even when the system is still functioning properly"](https://status.cloud.google.com/incident/compute/16007).

## The rule

The canary has to be able to stop the rollout, and the rollout should only proceed on an explicit pass. If the result is missing, late or unparseable, that should count as failure. A rollout that continues when it hasn't heard back is relying on the absence of bad news.

Second, if a system is designed to hide partial failures (anycast, load balancers, retries, replicas), you need to measure the redundancy it's using up, not just whether it still works. "Still serving" tells you nothing about how close you are to the edge. Count announcing sites, healthy replicas or remaining headroom, and alert when that number drops, even if every user request is still succeeding.

Third, for any config change that is meant to be small, compare the before and after on the thing that matters. Removing one unused block should change the announced address space by exactly that block. A semantic diff showing "all GCE blocks gone" would have caught this before it left the building.

## Sources

- [Google Cloud Status Dashboard, Compute Engine incident 16007](https://status.cloud.google.com/incident/compute/16007): Google's official incident report and live status updates, covering the anycast background, both software bugs, the timeline, the revert and the planned changes.
