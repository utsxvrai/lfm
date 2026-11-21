---
title: "Slack's first workday of 2021 overloaded the AWS gateways linking its VPCs"
dek: "Traffic jumped overnight from the quietest week of the year to one of the busiest days, and the AWS Transit Gateways linking Slack's VPCs didn't scale fast enough. Packet loss tricked autoscaling, overloaded the service that provisions new servers, and took down the dashboards engineers needed to debug it."
date: 2021-01-04
company: Slack
kind: outage
topics: [networking, capacity, cascading-failure, monitoring]
stack: [aws, transit-gateway, autoscaling, apache]
impact: "Slack became unavailable shortly after 7am PST on January 4, 2021, was degraded rather than down by around 9:15am, and the network returned to normal by 10:40am PST."
detected_by: alert
rule: "Your monitoring must not depend on the network path it is meant to watch, and the autoscaler's signals must still mean what you think when the network is the thing failing."
postmortem: https://slack.engineering/slacks-outage-on-january-4th-2021/
sources: [https://slack.engineering/slacks-outage-on-january-4th-2021/]
---

# Slack's first workday of 2021 overloaded the AWS gateways linking its VPCs

January 4th, 2021 was [the first working day of the year](https://slack.engineering/slacks-outage-on-january-4th-2021/) for most of Slack's users. Asia-Pacific and Europe got through the morning without trouble. During the Americas' morning, an external monitoring service paged Slack: error rates were creeping up. Shortly after 7am Pacific, [Slack became unavailable](https://slack.engineering/slacks-outage-on-january-4th-2021/).

The root cause was in AWS's network, not Slack's code. One of the AWS Transit Gateways connecting Slack's VPCs [became overloaded](https://slack.engineering/slacks-outage-on-january-4th-2021/) and dropped packets. What makes the incident worth studying is how Slack's own automation reacted to a lossy network: autoscaling went the wrong way and then too far, provisioning collapsed under the load, and the monitoring went dark because it depended on the same failing gateway.

## What happened

From the [Slack engineering postmortem](https://slack.engineering/slacks-outage-on-january-4th-2021/) (times in PST):

- **Morning:** an external monitor pages on rising errors. While the team investigates, **the dashboarding and alerting service becomes unavailable.** They roll back that day's changes. That doesn't help, and those changes turned out not to be the cause.
- Signs of widespread network degradation; the team escalates to AWS.
- **6:57am:** 99% of messages still send successfully. That sounds high, but the normal rate is over 99.999%.
- **7:00am:** Slack has [mini-peaks at the top of each hour and half hour](https://slack.engineering/slacks-outage-on-january-4th-2021/) from reminders and automation. This peak, on top of the network problems, saturates the web tier. Slack goes down.
- **7:01 to 7:15am:** autoscaling attempts to add [1,200 servers](https://slack.engineering/slacks-outage-on-january-4th-2021/) to the web tier.
- The provisioning service collapses under that load. Instances are created but never become ready.
- **Around 8:15am:** provisioning is back. Healthy instances start entering service.
- **Around 9:15am:** enough functioning hosts. Slack is ["degraded, not down"](https://slack.engineering/slacks-outage-on-january-4th-2021/).
- **10:40am:** AWS's manual capacity increase on the Transit Gateway has rolled out across all Availability Zones. Network, error rates and latency return to normal.

## What the engineers believed

Slack's systems were built for a busy Monday, and specifically for this one. Slack says its serving systems [scale quickly to meet these kinds of peaks](https://slack.engineering/slacks-outage-on-january-4th-2021/) and had always handled the post-holiday return before.

The Transit Gateways were a managed AWS service, [intended to scale transparently](https://slack.engineering/slacks-outage-on-january-4th-2021/). Nobody had to think about their capacity.

And the monitoring stack was something Slack tried to keep [as independent of Slack's infrastructure as possible](https://slack.engineering/slacks-outage-on-january-4th-2021/), so it would still be there in an outage.

All three assumptions were wrong in the same incident.

## What was actually going on

### A traffic shape the gateway's scaling didn't expect

Slack had moved from a single AWS account to many accounts and VPCs, for isolation and finer-grained operator permissions. Transit Gateways act as [hubs to link our VPCs](https://slack.engineering/slacks-outage-on-january-4th-2021/). Every request that crosses from one VPC to another passes through one.

Slack's yearly traffic has an unusual edge. Traffic is low over the holidays. Then, on the first Monday back, [client caches are cold and clients pull down more data than usual](https://slack.engineering/slacks-outage-on-january-4th-2021/) on their first connection. Slack goes from its quietest time of the year to one of its biggest days "quite literally overnight". Its own servers scaled for that. The gateways [did not scale fast enough](https://slack.engineering/slacks-outage-on-january-4th-2021/). AWS said it would review its TGW scaling algorithms for large packet-per-second increases.

*Background:* managed network services generally scale in response to observed load, which takes time. A jump that is large and sudden compared with the recent baseline is the hardest case for that kind of scaling.

### Packet loss confuses autoscaling

Slack scales its web tier on two signals: **CPU utilization** and **utilization of Apache worker threads**. With a lossy network, both changed in ways that misled the autoscaler.

*Background:* a web worker waiting on a slow backend holds its thread but uses almost no CPU. Packet loss means retransmissions and timeouts, so requests take longer and threads spend most of their time waiting.

That's what the postmortem describes. Before 7:00am, [threads were spending more time waiting, which caused CPU utilization to drop](https://slack.engineering/slacks-outage-on-january-4th-2021/). Low CPU triggered **downscaling**, removing servers just before the 7am peak. Then thread utilization climbed as backend calls got slower, and that triggered **upscaling**: the 1,200-server request.

```diagram
title: how packet loss steered the autoscaler
flow: packet loss -> threads wait on I/O -> CPU drops -> scale down
flow!: threads all busy -> scale up 1,200 -> provisioning overloads
note: both signals reacted to the network, not to load
```

The downscale also cut off responders. Several engineers were SSH'd into production instances because dashboards were down, and [many had their SSH sessions ended abruptly](https://slack.engineering/slacks-outage-on-january-4th-2021/) as instances were deprovisioned. At the same time, automation marked some instances unhealthy because they couldn't reach their backends, and replaced them. The team disabled downscaling.

### The provisioner hit its own limits

New instances go through `provision-service`, which configures and tests them and talks to internal systems and AWS APIs, over the same degraded network. Asked to bring up a huge batch at once while every call was slow, it hit [two separate resource bottlenecks](https://slack.engineering/slacks-outage-on-january-4th-2021/): the most significant was the **Linux open files limit**, and it also exceeded an **AWS quota limit**.

*Background:* slow network calls hold their sockets (file descriptors) open longer. At the same request rate, longer-lived connections mean more of them open at once. That's how a network slowdown can push a process into its file-descriptor limit.

Broken, half-provisioned instances then filled the autoscaling groups up to their [pre-configured size limits](https://slack.engineering/slacks-outage-on-january-4th-2021/), multiples of the normal peak. The web tier was at its maximum instance count and still short of capacity, because most of those instances weren't serving. Responders had to clean them up by hand.

### Why the dashboards went dark

The dashboard and alerting services [were running in a different VPC from their backend databases](https://slack.engineering/slacks-outage-on-january-4th-2021/), so they depended on the Transit Gateways too. The metric backends were still up and could be queried directly, but without pre-built dashboards that was much slower. Replacement dashboard instances couldn't be provisioned either, because `provision-service` was overloaded.

### How serving came back before the network did

By 9:15am the load balancers were still failing a very high share of health checks because of the network. Slack's load balancers have a **"panic mode"** that [balances requests across all instances when many are failing health checks](https://slack.engineering/slacks-outage-on-january-4th-2021/). Together with retries and circuit breaking, that got Slack serving again while degraded. Slack says it then [took an hour to provision enough instances](https://slack.engineering/slacks-outage-on-january-4th-2021/) to bring error rates down, because the unhealthy network needed more instances than usual and provisioning itself was slow.

## How they fixed it

AWS engineers, alerted by their own monitoring to the packet drops, [increased our TGW capacity manually](https://slack.engineering/slacks-outage-on-january-4th-2021/). Slack disabled downscaling, repaired `provision-service`, cleared broken instances, and added capacity until the network was healthy again.

## What changed afterwards

- **Preemptive gateway scaling:** a Slack reminder to ask AWS to scale up the TGWs [at the end of the next holiday season](https://slack.engineering/slacks-outage-on-january-4th-2021/).
- **Monitoring co-located with its database:** running dashboard instances in the same VPC as their database removes the TGW dependency.
- **Regular load tests of `provision-service`.** It had been load tested before, but this event [exceeded our previous scale-ups](https://slack.engineering/slacks-outage-on-january-4th-2021/).
- **Re-evaluating health-check and autoscaling configuration** so they can't overload provisioning again, even in extreme network disruption.
- AWS is reviewing its TGW scaling algorithms.

## The rule

Check every dependency your monitoring has against the failures it needs to report. If the dashboards cross the same network hop as production, a network failure blinds you at exactly the wrong time.

And look at what your autoscaling signals mean when the network is the failing component. CPU falls and thread usage rises when backends are slow, not only when load changes. A scaling policy that can request 1,200 instances in one burst also needs a provisioning path that has been tested at that size.

## Sources

- [Slack Engineering, "Slack's Outage on January 4th 2021"](https://slack.engineering/slacks-outage-on-january-4th-2021/): the official postmortem with the timeline, the Transit Gateway root cause, the autoscaling and provisioning failures, the monitoring dependency and follow-up actions.
