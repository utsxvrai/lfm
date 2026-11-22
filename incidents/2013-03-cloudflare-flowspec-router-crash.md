---
title: "One impossible firewall rule crashed every Cloudflare edge router at once"
dek: "To stop a DDoS, an engineer pushed a Flowspec rule matching packets around 99,971 bytes long. Flowspec delivered it to every edge router, and the routers ate all their RAM and died. Anycast then sent all the traffic to whichever few came back."
belief: "Cloudflare thought a Flowspec rule for impossible packet sizes was harmless. It crashed every edge router."
date: 2013-03-03
company: Cloudflare
kind: outage
topics: [bgp, networking, ddos, config-change]
stack: [juniper, junos, flowspec, bgp, anycast]
impact: "All Cloudflare services, including DNS and the web proxy, were unreachable; visitors to any site on the network got DNS errors."
detected_by: alert
rule: "A mechanism that pushes rules to every router in seconds is a global deploy with no canary. Validate the rule, and roll it out to one place first."
postmortem: https://blog.cloudflare.com/todays-outage-post-mortem-82515/
sources: [https://blog.cloudflare.com/todays-outage-post-mortem-82515/]
---

# One impossible firewall rule crashed every Cloudflare edge router at once

At [09:47 UTC on March 3, 2013](https://blog.cloudflare.com/todays-outage-post-mortem-82515/), Cloudflare, in its CEO Matthew Prince's words, ["effectively dropped off the Internet."](https://blog.cloudflare.com/todays-outage-post-mortem-82515/) Every service went with it: Cloudflare's DNS, its web proxy, and every customer site behind them. Anyone visiting a Cloudflare site got a DNS error. Pings and traceroutes to Cloudflare's network came back with "No Route to Host."

At the time Cloudflare ran [23 data centers in 14 countries](https://blog.cloudflare.com/todays-outage-post-mortem-82515/). The network was designed so that losing one or a few routers was routine. This time all of them failed together, because the same rule reached all of them through the same system at the same moment.

The trigger was an attempt to block a DDoS attack. The rule that was supposed to drop attack packets should have matched nothing at all. Instead it made Cloudflare's Juniper routers consume all their memory and crash.

## What happened

From Cloudflare's [same-day postmortem](https://blog.cloudflare.com/todays-outage-post-mortem-82515/):

1. A DDoS attack was hitting one customer's DNS servers.
2. Cloudflare's internal attack profiler analyzed it and reported that the attack packets were between **99,971 and 99,985 bytes** long.
3. An ops engineer on the 24/7 team took the profiler's output and, as was normal practice, added a router rule to drop packets in that size range to the customer's DNS IP on port 53.
4. The rule was pushed using **Flowspec**. Flowspec accepted it and relayed it to the entire edge network.
5. On encountering the rule, the routers consumed all their RAM until they crashed.
6. An automatic reboot process worked for some routers. Many crashed in a way that prevented automatic reboot and left their management ports unreachable.
7. Some data centers came back, then fell over again as the whole network's traffic landed on them.
8. Engineers who could reach routers saw the crashes were caused by the bad rule and removed it. They called data center operations teams to physically hard-reboot the unresponsive routers.
9. Within about 30 minutes restoration began; by **10:49 UTC** all services were restored.

## What the engineers believed

The rule, as written, looked harmless for a simple reason: **no packet that size exists on the network.** Prince lays out the numbers: typical maximum packets on the Internet are around 1,500 bytes, the average is around 500 to 600, and Cloudflare's own network maximum was [4,470 bytes](https://blog.cloudflare.com/todays-outage-post-mortem-82515/). A rule matching 99,971 to 99,985 bytes should have matched zero packets and done nothing.

So the worst case, in the engineer's mental model, was a rule that didn't help. The idea that a no-op rule could be dangerous isn't something anyone would naturally consider. The profiler's output was odd, but acting on an odd signal with a rule that "can't match" felt like a free action.

The second belief was structural: **routers fail independently.** Cloudflare routinely took a router or two offline for upgrades, and because of Anycast, traffic simply moved to the next closest data center. Losing routers was a solved problem.

## What was actually going on

### Anycast and why routers are the network

Cloudflare uses **Anycast**: the same IP prefixes are announced over BGP from every data center. Each network on the Internet picks the "closest" announcement by its own routing policy, so users reach a nearby Cloudflare location. The router is what makes the announcement. When a router goes down, its BGP sessions drop and [the routes behind it are withdrawn](https://blog.cloudflare.com/todays-outage-post-mortem-82515/) from the Internet.

That's the resilience model: if one data center's router dies, its announcements disappear, and the Internet's routing quietly shifts those users to the next nearest location. It works as long as the failures are *independent*. If every router withdraws at once, there is no next nearest location. The prefixes vanish from the global routing table, which is exactly what "No Route to Host" means.

### What Flowspec is

**BGP Flowspec** is an extension of BGP that carries traffic-filtering rules instead of only routes. A rule says something like "packets matching destination X, port Y, length Z: discard" (or rate-limit). Because it rides on BGP, one rule injected at one point propagates to every router in the mesh, efficiently. Cloudflare liked Juniper partly for its Flowspec support, and used it constantly [to fight attacks and to shift traffic](https://blog.cloudflare.com/todays-outage-post-mortem-82515/).

That property is the whole point of Flowspec and the whole problem here. It's a **global, near-instant configuration push**, with no staging and no canary. Every router receives the same rule and processes it the same way.

### The rule

The simplified Junos rule from the postmortem matched a /32 destination, port 53, and a `packet-length` range of 99971 to 99985, with action `discard`. Flowspec [accepted the rule and relayed it](https://blog.cloudflare.com/todays-outage-post-mortem-82515/) to the edge network. The routers then consumed all their RAM until they crashed.

Cloudflare's post doesn't explain the bug inside the router software. It says the team had asked Juniper whether this was a known bug or specific to Cloudflare's setup and traffic. So the specifics of *why* this packet-length range exhausted memory aren't in the source. What we can say, as interpretation, is that a length far beyond any possible packet size is the kind of out-of-range input that validation should reject and that code paths are rarely tested against. Nothing between the engineer and the routers rejected it.

```diagram
title: why one rule took down everything
flow: one router fails -> routes withdrawn -> next site serves
flow!: Flowspec rule -> all routers crash -> nowhere left to go
note: independent failures are survivable; identical ones are not
```

### Why recovery stalled and relapsed

Two things made this worse than a single crash.

**Crashed routers didn't come back on their own.** Cloudflare ran a monitoring process to reboot crashed routers. It worked for some, but many crashed in a way that [didn't reboot automatically and left management ports inaccessible](https://blog.cloudflare.com/todays-outage-post-mortem-82515/). That turned a software fix into a physical one: people in data centers across 14 countries had to go and hard-reboot boxes.

**Anycast concentrated the load.** When some data centers recovered first, they were the only ones announcing Cloudflare's prefixes. All of Cloudflare's global traffic converged on them. They [fell over again](https://blog.cloudflare.com/todays-outage-post-mortem-82515/) under the load. The same mechanism that spreads traffic gracefully when one site is down concentrates it brutally when only one or two are up. This is a thundering herd at the routing layer.

## How they fixed it

Cloudflare's monitors, internal and external, flagged the incident [immediately](https://blog.cloudflare.com/todays-outage-post-mortem-82515/). The first visible symptom was simply that packets couldn't find a route to the network. Engineers logged into the routers they could still reach, saw them crashing on the rule, and removed it. Then data center operations teams physically rebooted the unreachable ones. Service started returning within about 30 minutes, and all services were back by 10:49 UTC. Some users kept seeing errors afterwards because their resolvers had cached bad DNS responses; clearing the DNS cache usually fixed it.

## What changed afterwards

From the [postmortem](https://blog.cloudflare.com/todays-outage-post-mortem-82515/), Cloudflare committed to:

- Asking Juniper whether the crash was a known bug or specific to Cloudflare's setup and traffic.
- More extensive testing of Flowspec-provisioned filters.
- Evaluating ways to apply rules only to the data centers that need them, rather than network-wide.
- Proactive service credits for SLA customers.

The second and third items are the general lessons. Any system that can push configuration everywhere at once (feature flags, WAF rules, routing policy, firewall rules) needs:

- **Input validation that rejects the impossible.** A packet length above the network's MTU should be refused, not accepted and passed on.
- **Blast-radius control.** Push to one site, watch it, then widen. The DDoS was against one customer; the rule didn't need to reach 23 data centers at once.
- **Out-of-band access.** If the thing you're configuring is also the path you use to reach it, a bad push can lock you out. Management access that doesn't depend on the router being healthy shortens recovery from hours of phone calls to minutes.

## The rule

Redundancy only protects you from failures that are independent. A mechanism that delivers the same change to every node at the same instant makes every node fail the same way, so treat it like a deploy: validate the input, roll out to one location first, and keep a way in that doesn't depend on the thing you just changed.

## Sources

- [Cloudflare Blog: Today's Outage Post Mortem (Matthew Prince, March 3, 2013)](https://blog.cloudflare.com/todays-outage-post-mortem-82515/): the official postmortem with the rule, timeline and follow-up actions.
