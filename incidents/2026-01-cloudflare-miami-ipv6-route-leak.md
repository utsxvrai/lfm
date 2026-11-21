---
title: "Deleting one prefix list turned a Cloudflare export policy into 'advertise everything internal'"
dek: "An automated change removed a Bogotá prefix list from Miami's BGP export policies. What was left of the term matched every internal route on Juniper routers, so Cloudflare leaked its internally redistributed IPv6 prefixes, including routes learned from peers like Meta, to transit providers and peers for 25 minutes."
date: 2026-01-22
company: Cloudflare
kind: outage
topics: [bgp, config-change, automation, networking]
stack: [bgp, junos, ipv6]
duration_min: 25
impact: "A 25-minute IPv6 route leak from Miami congested Cloudflare's Miami–Atlanta backbone and at peak saw around 12Gbps of traffic for non-downstream prefixes discarded."
rule: "A filter term whose match list can become empty must fail closed; check generated policies for terms that would match more than they did before."
postmortem: https://blog.cloudflare.com/route-leak-incident-january-22-2026/
sources: [https://blog.cloudflare.com/route-leak-incident-january-22-2026/, https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/, https://securityonline.info/the-miami-glitch-how-a-single-config-error-leaked-cloudflares-ipv6-routes-to-the-global-internet/]
---

# Deleting one prefix list turned a Cloudflare export policy into "advertise everything internal"

On the evening of 22 January 2026 (UTC), a router in Cloudflare's Miami data center started telling the rest of the Internet that it was a good path to networks it had no business carrying traffic for. The leak [lasted 25 minutes](https://blog.cloudflare.com/route-leak-incident-january-22-2026/) and affected only IPv6.

The effects were felt on both sides. Cloudflare's backbone between Miami and Atlanta congested, which meant elevated loss for some Cloudflare customer traffic and higher latency. And other networks whose routes Cloudflare leaked had their traffic pulled into Miami, where router firewall filters, which only accept traffic for Cloudflare and its customers, dropped it. At peak, Cloudflare [discarded around 12Gbps](https://blog.cloudflare.com/route-leak-incident-january-22-2026/) of this traffic.

The cause was a config change that **removed** something. That's what makes it worth studying: the diff was all deletions, and deleting a restriction is the easiest way to make a filter accept more than you meant.

## What happened

From the [postmortem](https://blog.cloudflare.com/route-leak-incident-january-22-2026/), all times UTC on 22 January 2026:

- **19:52.** A change that ultimately triggers the routing policy bug is merged into the network automation repository.
- **20:25.** Automation runs on a single Miami edge router. Unexpected advertisements go out to BGP transit providers and peers. **Impact starts.**
- **20:40.** The network team begins investigating the unintended advertisements.
- **20:44.** An incident is raised.
- **20:50.** A network operator manually reverts the bad configuration, and automation is paused for that router. **Impact stops.**
- **21:47.** The triggering change is reverted in the code repository.
- **22:07.** Operators confirm automation is healthy to run again on the Miami router.
- **22:40.** Automation is unpaused.

## What the engineers believed

The intent was a cleanup. Cloudflare had been forwarding some IPv6 traffic through Miami toward its Bogotá data center (BOG04), and [recent infrastructure upgrades removed the need](https://blog.cloudflare.com/route-leak-incident-january-22-2026/) to do so. So the change removed the BOG04 announcements from Miami.

The generated diff, which the postmortem reproduces, deletes the same line from nine export policy statements, named for Cogent, Comcast, GTT, Level3, Telefonica, Telia and for private and public peers. One of them:

```
[edit policy-options policy-statement 6-TELIA-ACCEPT-EXPORT term ADV-SITELOCAL-GRE-RECEIVER from]
-    prefix-list 6-BOG04-SITE-LOCAL;
```

Cloudflare's own description: the change ["looks innocent at a glance"](https://blog.cloudflare.com/route-leak-incident-january-22-2026/). The reasonable belief is that removing a prefix list from a term means the term no longer matches those prefixes, and so advertises less. Every line in the diff is a removal. Nothing in it looks like it could add an advertisement.

## What was actually going on

### How a Junos policy term matches

*Background:* a Junos routing policy is a series of terms. Each has a `from` block (match conditions) and a `then` block (actions), and a route must satisfy the conditions in `from` to match. This is the term after the change, from the postmortem:

```
term ADV-SITELOCAL-GRE-RECEIVER {
    from route-type internal;
    then {
        community add STATIC-ROUTE;
        community add SITE-LOCAL-ROUTE;
        community add MIA01;
        community add NORTH-AMERICA;
        accept;
    }
}
```

Comparing the diff with the result (my reading), the `from` block used to say, roughly, "route-type internal **and** in prefix list BOG04". The prefix list was the condition doing the narrowing. Remove it and the only condition left is `route-type internal`.

That's where the second surprise comes in. On Junos and Junos EVO, `route-type internal` [will match any non-external route type](https://blog.cloudflare.com/route-leak-incident-january-22-2026/), including routes learned over internal BGP (IBGP). Cloudflare's backbone uses IBGP to redistribute IPv6 prefixes between its sites. So the term now matched [all IPv6 prefixes that Cloudflare redistributes internally across the backbone](https://blog.cloudflare.com/route-leak-incident-january-22-2026/), tagged them with some communities, and, most importantly, ran `accept`. In an export policy, accept means "advertise this to the neighbor". Those routes went out to every BGP neighbor in Miami.

```diagram
title: how a deletion widened the filter
flow: internal AND BOG04 -> BOG04 prefixes -> Miami neighbors
flow!: BOG04 list deleted -> route-type internal -> all IBGP IPv6 -> peers and transit
note: removing the narrowing condition left a term that matched everything internal
```

*Background:* the general shape is "a match list is empty or missing, so the filter matches everything". It shows up in firewall rules, SQL `WHERE` clauses built from lists, and access policies. A condition that narrows a match is safe to add and dangerous to remove, because removing it widens the match.

### Why this counts as a leak

Some of those internally redistributed prefixes were routes Cloudflare had learned from its **peers**. The postmortem walks through one, collected by public route collectors with the `monocle` tool: prefix `2a03:2880:f077::/48` with AS path `64112 22850 174 3356 13335 32934`. Reading right to left: Meta (AS32934) originated it and gave it to Cloudflare (AS13335) as a peer, and Cloudflare then [advertised it toward Lumen (AS3356)](https://blog.cloudflare.com/route-leak-incident-january-22-2026/), one of its upstream transit providers.

That breaks the basic rule of Internet routing economics that the postmortem calls "valley-free" routing: routes from a peer may be passed on only to your customers, never sideways to another peer or up to a provider. When they are, the rest of the Internet sees a new, plausible-looking path through the leaker and starts sending traffic that way. By the definitions in RFC 7908, Cloudflare caused [a mixture of Type 3 and Type 4 route leaks](https://blog.cloudflare.com/route-leak-incident-january-22-2026/).

### Where the traffic went

Leaked routes attract traffic. Traffic from providers and peers headed for those prefixes started arriving at the Miami router. Two things then happened, per the postmortem:

1. **Congestion.** The extra traffic congested Cloudflare's backbone between Miami and Atlanta, which [would have resulted in elevated loss](https://blog.cloudflare.com/route-leak-incident-january-22-2026/) for some Cloudflare customer traffic and higher latency on those links.
2. **Black-holing.** Cloudflare's routers have firewall filters that only accept traffic for Cloudflare services and its customers. Traffic for the leaked third-party prefixes hit those filters and was dropped. At peak that was around 12Gbps.

So the networks whose prefixes were leaked lost some IPv6 traffic, because part of the Internet briefly believed the best path to them ran through a Cloudflare router in Miami that would then throw the packets away.

### It had happened before

The postmortem says this was ["very similar to the outage we experienced in 2020"](https://blog.cloudflare.com/route-leak-incident-january-22-2026/). That July 2020 incident is worth reading next to this one. An engineer relieving congestion on a router in Atlanta deactivated a prefix list in a backbone export term. In the [2020 postmortem's words](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/), "instead of removing the Atlanta routes from the backbone, a one line change started leaking all BGP routes into the backbone". That outage lasted 27 minutes.

The two are the same mechanism. In 2020, a human removed the narrowing prefix list from a term that otherwise accepted everything. In 2026, an automation pipeline did. Automation made the change reproducible and reviewable, but the diff it produced still looked innocent, because the problem wasn't in what the diff removed. It was in what was left behind.

## How they fixed it

At [20:50 UTC a network operator manually reverted](https://blog.cloudflare.com/route-leak-incident-january-22-2026/) the bad configuration on the router and paused automation for it, so it couldn't re-apply the change. Pausing matters: if automation is the source of truth, a manual fix on the box gets overwritten the next time automation runs. The code change was reverted in the repository at 21:47, and automation was unpaused on the Miami router at 22:40, after operators confirmed it would no longer generate the bug.

## What changed afterwards

[Cloudflare's follow-ups](https://blog.cloudflare.com/route-leak-incident-january-22-2026/) for its own automation:

- Patch the failure in the routing policy automation that caused the leak.
- Add **BGP community-based safeguards** that explicitly reject, on external export policies, routes received from providers and peers. This is defence in depth: even if a term matches too much, routes tagged as peer- or provider-learned get dropped before they leave.
- Add automatic routing policy evaluation to CI/CD that looks specifically for **empty or erroneous policy terms**.
- Improve early detection of the negative effects of automated network changes.

And for route leaks in general:

- Validate vendors' implementations of **RFC 9234** (BGP roles and the Only-to-Customer attribute) ahead of rolling it out. Cloudflare calls it the only way, independent of routing policy, to prevent route leaks caused at the local AS. With roles configured, the router itself knows a session is a peer or a provider and refuses to send peer-learned routes over it, whatever the policy says.
- Encourage adoption of **RPKI ASPA**, which lets other networks reject routes with anomalous AS paths automatically.

A note on secondary coverage: [SecurityOnline's summary](https://securityonline.info/the-miami-glitch-how-a-single-config-error-leaked-cloudflares-ipv6-routes-to-the-global-internet/) describes the 12Gbps as "an aggregate throughput deficit". Cloudflare's postmortem describes it more narrowly, as traffic for non-downstream prefixes that its Miami router discarded at peak. This post uses Cloudflare's wording.

## The rule

A filter built from "match X **and** match Y" turns into "match X" the moment Y is deleted, and X alone may be much broader than anyone thinks. Here X was `route-type internal`, which on Junos includes every IBGP route.

So (my interpretation) review policy changes by the **result**, not the diff: compare what the term matches before and after, not which lines were removed. And layer protections that don't depend on the term being right. Community tags that mark peer-learned routes as never-export, and BGP roles that enforce the same thing in the protocol, would have stopped this leak even with the bad term in place.

## Sources

- [Bryton Herdes and Tom Strickx, "Route leak incident on January 22, 2026", Cloudflare blog, 23 January 2026](https://blog.cloudflare.com/route-leak-incident-january-22-2026/): Cloudflare's postmortem, with the timeline, the policy diff, the Junos `route-type internal` behaviour, the leaked AS paths, the 12Gbps figure and follow-ups.
- ["Cloudflare outage on July 17, 2020", Cloudflare blog](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/): the earlier backbone incident the 2026 postmortem compares itself to.
- ["The Miami Glitch: How a Single Config Error Leaked Cloudflare's IPv6 Routes to the Global Internet", SecurityOnline](https://securityonline.info/the-miami-glitch-how-a-single-config-error-leaked-cloudflares-ipv6-routes-to-the-global-internet/): secondary summary of the postmortem.
