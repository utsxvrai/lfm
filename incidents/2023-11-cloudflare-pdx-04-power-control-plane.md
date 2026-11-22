---
title: "Cloudflare's control plane went dark when one Oregon data center lost all power"
dek: "A ground fault at Flexential's PDX-04 tripped both the utility feed and the generators, and the UPS ran out early. Cloudflare's high-availability cluster survived as designed, but services that should have been redundant turned out to depend on Kafka and ClickHouse running only in that building."
belief: "Cloudflare thought its control plane survived losing any one data center. Key services depended on one building."
date: 2023-11-02
company: Cloudflare
kind: outage
topics: [power-cooling, dependency, cascading-failure]
stack: [kafka, clickhouse, data-center]
impact: "Cloudflare's dashboard, APIs, logging and analytics were disrupted from 11:44 UTC on 2 November until 04:25 UTC on 4 November 2023; traffic through its network was not affected."
rule: "A redundant cluster is only as redundant as its least-redundant dependency; test failover by removing whole facilities, not just the parts you already think are redundant."
postmortem: https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/
sources: [https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/]
---

# Cloudflare's control plane went dark when one Oregon data center lost all power

On 2 November 2023, Cloudflare's control plane and analytics services went down. The control plane is the customer-facing side: the dashboard and APIs used to configure every Cloudflare product. Analytics covers logging and analytics reporting. The postmortem gives the incident window as [11:44 UTC on 2 November until 04:25 UTC on 4 November](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/). (The same post's opening line gives the start as 11:43 UTC.)

Cloudflare's network kept working throughout. Traffic flowed and security services ran, but there were periods when customers couldn't change their configuration, and some services stayed down far longer than others. Raw log services were [unavailable for most customers for the duration](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/).

The CEO's postmortem opens bluntly: ["To start, this never should have happened."](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/) Cloudflare had built a three-data-center high-availability design specifically to survive losing one facility. It lost one facility, and the design mostly held. The outage came from the parts that had never actually been placed inside it.

## What happened

From Cloudflare's [postmortem](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/), all times UTC. Note that Cloudflare labels part of this as "informed speculation", since Flexential, the data center operator, hadn't yet given it a root cause.

- **08:50**: Portland General Electric (PGE) has an unplanned maintenance event that shuts down one of the independent utility feeds into Flexential's PDX-04. Flexential starts its generators to supplement the remaining feed. It **does not tell Cloudflare**, and Cloudflare's observability tools can't see the power source change.
- **About 11:40**: A **ground fault on a PGE transformer** at PDX-04. The protective shutdown also takes down **all of the facility's generators**. Both power sources are now offline.
- The UPS batteries are supposed to last about 10 minutes. Based on its own equipment failing, Cloudflare saw them [start to fail after only 4 minutes](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/).
- **11:44**: The two routers connecting PDX-04 to the world go offline. This is Cloudflare's first sign of trouble. Between 11:44 and 12:01, all customers in the facility lose power.
- **12:28**: Flexential's first message to Cloudflare, saying a power issue began at approximately 12:00 UTC.
- **12:48**: Generators restarted. When Flexential tries to power up Cloudflare's circuits, the **circuit breakers are faulty**, and more need replacing than Flexential has on site.
- **13:40**: With no restoration time available, Cloudflare decides to fail over to its disaster recovery sites in Europe. First services come up at **13:43**.
- **17:57**: Services moved to disaster recovery are stable; most customers no longer directly affected.
- **22:48**: Flexential replaces the breakers, restores both utility feeds and confirms clean power.
- **3 November**: Cloudflare begins a full bootstrap of PDX-04.
- **04:25, 4 November**: All services restored.

## What the engineers believed

Cloudflare's control plane ran mainly in three independent data centers around Hillsboro, Oregon, each with multiple utility feeds and redundant network connections, far enough apart to limit shared natural-disaster risk but close enough to run active-active clusters. By design, if any one facility went offline, the [remaining ones could keep operating](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/).

The expected failure mode for losing PDX-04 was specific and acceptable: analytics would go offline, logs would queue at the network edge and be delayed, and some lower-priority services not yet on the high-availability cluster would be down until restored elsewhere. Logging had been deliberately left out of the high-availability cluster on the reasoning that edge queuing made a delay tolerable.

So the belief was: **critical services are on the HA cluster, and the HA cluster survives any one facility.** The first half wasn't fully true.

## What was actually going on

### How a building loses power when it has three sources

*Background:* a well-built data center has layers. Utility feeds supply normal power; generators take over when utility fails; UPS batteries bridge the seconds-to-minutes gap while generators start. The design assumes these fail independently.

At PDX-04 they didn't. The ground fault on a high-voltage (12,470 volt) line triggered protective shutdowns, which by design stop electrical equipment quickly to prevent damage. In this case that protection also shut down [all of PDX-04's generators](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/). Utility and generator power were gone at the same moment, leaving only the UPS, which lasted less than half its rated time by Cloudflare's observation.

Cloudflare reports, from what Flexential employees told it unofficially, three reasons the generators took so long: they had to be physically accessed and manually restarted because of how the fault tripped circuits; Flexential's access control system wasn't on battery backup, so it was offline; and the overnight staff included security and one technician who had been on the job for a week, with no experienced operations or electrical expert. Cloudflare also notes it was unusual to run both the remaining utility feed and generators at once, and speculates this may relate to a PGE program (DSG) that lets the utility run a data center's generators; Flexential hadn't confirmed whether that was active.

### How "redundant" services depended on one building

Most of Cloudflare's critical control plane had been migrated to the HA cluster, which was the plan. But PDX-04 was also the **default location** for services not yet onboarded, and it housed Cloudflare's largest analytics cluster.

The surprise was a set of services that were supposed to be on the HA cluster but [had dependencies on services exclusively running in PDX-04](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/). In particular, **Kafka and ClickHouse**, which process logs and power analytics, ran only in PDX-04, while services in the HA cluster depended on them. When PDX-04 went dark, those HA services failed too, even though their own instances were running fine in the other two facilities.

```diagram
title: redundant on paper, single-site in practice
flow: HA service -> runs in 3 sites -> survives one loss
flow!: HA service -> Kafka, ClickHouse -> PDX-04 only -> fails
note: the dependency, not the service, set the blast radius
```

### Why testing didn't find it

Cloudflare had tested the HA cluster by taking each of the other two facilities offline, and both together. It had also tested taking the **HA portion** of PDX-04 offline. It had [never tested taking the entire PDX-04 facility offline](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/). The tests that existed removed the parts already believed redundant, which is exactly the set least likely to expose a hidden dependency on the non-redundant part.

The second reason was process. Cloudflare didn't formally require new products to move onto the HA cluster before being declared generally available. Its own verdict: "That was a mistake", because redundancy then worked inconsistently depending on the product.

### Why recovery took two days

The European disaster recovery sites are designed for critical control plane services but [don't support some log processing services](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/). When services came up there, failing API calls retried all at once in a thundering herd, and Cloudflare had to add rate limits. Some newer products, such as Stream uploads, had no fully implemented disaster recovery procedure and had to be rebuilt there or moved to the HA cluster on the spot.

Bringing PDX-04 back was its own job. Because the facility had probably been power-cycled several times, Cloudflare treated server state as unknown and did a full bootstrap. Rebuilding the configuration management servers took [3 hours](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/); each server then took between 10 minutes and 2 hours, with some services needing to come up in sequence. Cloudflare also chose to let the team rest after power was restored at 22:48 and start the move back in the morning, accepting a slower recovery to avoid compounding mistakes.

## How they fixed it

Cloudflare failed over the affected part of the control plane to its European disaster recovery sites, rate-limited the returning traffic, and rebuilt or migrated products without a working DR plan. After Flexential restored power, it bootstrapped PDX-04 from scratch. Most analytics had no data loss because they are also stored in European core data centers, but some datasets not replicated there have [persistent gaps](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/), and log push data not delivered during the event won't be recovered.

## What changed afterwards

Cloudflare declared a **"Code Orange"**, shifting non-critical engineering work to control-plane reliability. Its commitments, per the [postmortem](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/):

- Remove control-plane dependencies on core data centers where possible, and keep the control plane working on the distributed network even if all core data centers are offline.
- Require every GA product to rely on the HA cluster without software dependencies on specific facilities, and to have a tested disaster recovery plan.
- Run more rigorous chaos tests, including **full removal of each core data center**.
- Audit core data centers, and build a logging and analytics DR plan that drops no logs even if all core facilities fail.

## The rule

Redundancy is a property of the whole dependency graph, not of each service. A service running in three places that calls a database running in one is a single-site service. Find those edges by testing the failure you actually fear: switch off an entire facility, including the non-redundant parts, and see what else falls over. And make "on the redundant platform, with a tested DR plan" a gate for launch, not a migration for later.

## Sources

- [Cloudflare, "Post Mortem on Cloudflare Control Plane and Analytics Outage", Matthew Prince, 4 November 2023](https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/): the official postmortem, including the power-failure timeline (partly labeled as informed speculation), the architecture, the hidden dependencies and the Code Orange plan. Primary source for every fact in this post.
