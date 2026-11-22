---
title: "Deactivating the wrong line sent Cloudflare's backbone traffic to Atlanta"
dek: "To take traffic off Atlanta, an engineer deactivated the prefix-list in a routing policy instead of the whole term. With no match condition, the term matched every route and announced them all to the backbone at a higher local-preference, so Atlanta attracted everyone's traffic."
belief: "Cloudflare tried to move traffic off Atlanta. One deactivated config line sent its backbone traffic there instead."
date: 2020-07-17
company: Cloudflare
kind: outage
topics: [bgp, config-change, human-error, networking]
stack: [bgp, ibgp, routing-policy]
duration_min: 27
impact: "A 27-minute outage in which traffic across Cloudflare's network dropped by about 50%, localized to backbone-connected locations."
rule: "In a routing policy, removing a match condition widens the match; it doesn't disable the rule. Disable whole terms, and cap what a single session can announce."
postmortem: https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/
sources: [https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/]
---

# Deactivating the wrong line sent Cloudflare's backbone traffic to Atlanta

On 17 July 2020, a configuration error in Cloudflare's backbone network caused an outage that [lasted 27 minutes](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/). Cloudflare saw [traffic drop by about 50% across our network](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/). Because of how the backbone is built, the failure stayed in certain regions: San Jose, Dallas, Seattle, Los Angeles, Chicago, Washington DC, Richmond, Newark, Atlanta, London, Amsterdam, Frankfurt, Paris, Stockholm, Moscow, St. Petersburg, São Paulo, Curitiba and Porto Alegre were [the affected locations](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/). Other locations kept running normally.

It wasn't an attack. It was a one-line change on one router in Atlanta, meant to *reduce* Atlanta's traffic. It made Atlanta the preferred destination for traffic from across the backbone. The Atlanta router was overwhelmed, and the locations sending it traffic stopped serving.

## What happened

Cloudflare runs a private backbone, [a series of private lines between our data centers](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/), so traffic between its locations can avoid the public internet. The timeline, [all in UTC](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/):

| Time | Event |
| --- | --- |
| 20:25 | Backbone link between Newark (EWR) and Chicago (ORD) lost |
| 20:25 | Backbone between Atlanta (ATL) and Washington (IAD) congesting |
| 21:12 | Config change in Atlanta; ATL starts attracting traffic from across the backbone |
| 21:39 | ATL router dropped from the backbone; service restored |
| 21:47 to 22:10 | Congestion at a core data center that processes logs and metrics; some logs dropped, edge unaffected |
| 22:10 | Full recovery, including logs and metrics |

Cloudflare's traffic manager showed CPU in Atlanta [reaching overload](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/), while affected data centers saw CPU drop to near zero because they were no longer handling traffic.

## What the engineers believed

The team was dealing with congestion between Atlanta and Washington, a knock-on effect of the lost Newark–Chicago link. The plan was sensible: take some of Atlanta's routes out of the backbone so less traffic flowed through Atlanta. The post says that [instead of removing the Atlanta routes from the backbone, a one line change started leaking all BGP routes into the backbone](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/).

The change was a deactivation. Deactivating something in a config *feels* like turning it off, the safe direction. Whether that's true depends on what you deactivate.

## What was actually going on

### The policy term

Here's the change as Cloudflare published it:

```
{master}[edit]
atl01# show | compare
[edit policy-options policy-statement 6-BBONE-OUT term 6-SITE-LOCAL from]
!    inactive: prefix-list 6-SITE-LOCAL { ... }
```

And the complete term:

```
from {
    prefix-list 6-SITE-LOCAL;
}
then {
    local-preference 200;
    community add SITE-LOCAL-ROUTE;
    community add ATL01;
    community add NORTH-AMERICA;
    accept;
}
```

The policy `6-BBONE-OUT` controls what this router exports to the other backbone routers. The term says: **for routes matching the `6-SITE-LOCAL` prefix list**, set local-preference to 200, tag them with communities, and accept them, meaning announce them to the backbone.

*Background:* in this style of routing policy, a term has a `from` block (the match conditions) and a `then` block (the actions). A term with no conditions in `from` matches everything. So deactivating the only condition doesn't turn the term off. It turns it into "apply these actions to every route".

That's what happened. Cloudflare explains that [by removing the prefix-list condition, the router was instructed to send all its BGP routes to all other backbone routers, with an increased local-preference of 200](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/). The post adds: ["The correct change would have been to deactivate the term instead of the prefix-list."](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/)

### Why local-preference 200 pulled everything to Atlanta

*Background:* when a BGP router has more than one path to the same prefix, it runs a best-path selection. Local-preference is one of the first attributes compared, and **higher wins**. Unlike some attributes, local-preference is shared with every router inside the same network, which is what Cloudflare means by [a transitive property on iBGP sessions](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/).

Each Cloudflare location's edge routers learn routes for their own compute nodes locally. At the time, those local routes had [a local-preference of 100](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/). Now Atlanta was announcing, over the backbone, routes for the same destinations with local-preference 200. Every backbone router compared its own local path at 100 with Atlanta's at 200 and chose Atlanta. In Cloudflare's words, [all the traffic meant for local compute nodes went to Atlanta compute nodes instead](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/).

```diagram
title: why every site chose Atlanta
flow: local servers route -> local-pref 100 -> normally wins
flow!: ATL leaks all routes -> local-pref 200 -> ATL wins everywhere
note: higher local-pref beats the local path
```

The router doesn't know that "send Chicago's traffic to Atlanta" is absurd. It knows 200 is greater than 100. The policy assumed that only site-local prefixes would ever carry the 200 tag, and without the prefix-list nothing enforced that.

### Why it stayed regional

The overload in Atlanta [caused Cloudflare network locations connected to the backbone to fail](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/). Locations not on the backbone never received the leaked routes (our inference from the architecture), which is why the outage was localized to certain geographies. Cloudflare also says its network is [built to function properly without a backbone](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/), which is why pulling Atlanta off the backbone was a safe fix: the other locations went back to their local paths and the public internet.

## How they fixed it

Once the cause was understood, [the Atlanta router was disabled](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/) and traffic flowed normally again at 21:39 UTC. A short tail followed: congestion at a core data center that processes logs and metrics dropped some logs until 22:10, while the edge network kept working.

## What changed afterwards

Cloudflare listed [two changes](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/):

- **A maximum-prefix limit on backbone BGP sessions.** A session that suddenly receives far more routes than expected gets shut down. Cloudflare says this ["would have shut down the backbone in Atlanta"](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/), which is survivable because the network works without the backbone. Planned for Monday, 20 July.
- **A different local-preference for local server routes,** so that one location can't attract other locations' traffic this way again. Deployed right after the incident.

The first is a blast-radius limit: it doesn't prevent the mistake, it caps what one session can do. The second fixes the preference so a local route is never outranked by one from another site.

## The rule

In any match-then-act policy language (routing policies, firewall rules, WAF rules), removing a condition **broadens** the rule. If you want a rule to stop applying, disable the whole rule, and look at a diff of what the router will actually export, not just a diff of the config text.

Then make sure one bad session can only do limited damage. A maximum-prefix limit, a sanity bound on what any single peer can announce, turns "every site sends its traffic to Atlanta" into "Atlanta drops off the backbone", which Cloudflare's network was built to handle.

## Sources

- [Cloudflare, "Cloudflare outage on July 17, 2020"](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/): the official postmortem with the timeline, affected locations, the exact config diff and policy term, the local-preference explanation and follow-up changes.
