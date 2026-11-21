---
title: "A BGP optimizer's more-specific routes leaked through Verizon and pulled Internet traffic into a small ISP"
dek: "A Pennsylvania ISP's BGP optimizer split real prefixes into smaller ones for internal use. They leaked to a customer, then to Verizon, which passed them to the whole Internet. Because routers always prefer the most specific route, traffic for Cloudflare, Amazon and others headed for networks that couldn't carry it."
date: 2019-06-24
company: Verizon
kind: outage
topics: [bgp, networking, automation]
stack: [bgp, rpki, irr]
impact: "Many services, including Amazon, Linode and Cloudflare, were unreachable from large parts of the Internet; Cloudflare lost about 15% of its global traffic at the worst point."
rule: "Never accept from a customer more than that customer could legitimately originate. Prefix limits, IRR filters and RPKI validation each cost almost nothing and each would have stopped this leak."
postmortem: https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/
sources: [https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/]
---

# A BGP optimizer's more-specific routes leaked through Verizon and pulled Internet traffic into a small ISP

At [10:30 UTC on 24 June 2019](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/), in Cloudflare's words, ["the Internet had a small heart attack"](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/). A small company in northern Pennsylvania became the preferred path for many Internet routes through Verizon (AS701), one of the largest transit providers. Many websites on Cloudflare and other providers became unavailable from large parts of the Internet. Cloudflare names [Amazon, Linode and Cloudflare](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/) among the services affected, and at the worst point it lost [about 15% of its global traffic](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/).

Nothing at Cloudflare or Amazon broke. Their networks were healthy. Other networks had been told, wrongly, that the best way to reach them was through a small ISP, and the Internet's routing protocol believed it.

A note on sourcing: this post relies on Cloudflare's write-up, published the same day by Cloudflare engineer Tom Strickx. Cloudflare was a victim, not the operator at fault, and the post is openly critical of Verizon. Cloudflare says that [more than 8 hours after the incident it had not heard back from Verizon](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/). The networks involved did not publish their own account in the sources used here.

## What happened

The chain, as [Cloudflare describes it](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/):

1. **DQE Communications (AS33154)**, an ISP in Pennsylvania, ran a "BGP optimizer" product from Noction. A feature of that product splits received IP prefixes into smaller parts, called more-specifics. Cloudflare's own route `104.20.0.0/20` became `104.20.0.0/21` and `104.20.8.0/21`.
2. DQE announced these more-specific routes to its customer, **Allegheny Technologies Inc (AS396531)**.
3. Allegheny sent the routing information on to its other transit provider, **Verizon (AS701)**.
4. Verizon passed the routes to the rest of the Internet.
5. Networks everywhere preferred the more-specific routes, and traffic for the affected prefixes headed toward Verizon, Allegheny and DQE. None of them were equipped for that traffic, and service was disrupted.

## What the engineers believed

Two separate assumptions failed, at two different companies.

**At DQE**, the optimizer's split routes were meant for internal traffic engineering. Cloudflare explains that splitting large IP blocks gives a network ["a mechanism to steer traffic within their network but that split should never have been announced to the world at large"](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/). As interpretation: an operator running such a tool assumes its synthetic routes stay inside its own network. Once they reached a BGP session with a customer, that assumption was gone.

**At Verizon**, the session with Allegheny was apparently trusted without filters. Cloudflare's conclusion is that ["it appears that Verizon didn't implement any of this filtering in their BGP session with Allegheny Technologies"](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/). The leak ["should have stopped at Verizon"](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/).

## What was actually going on

### BGP is a network of promises

The Internet is a network of networks called Autonomous Systems, each with an AS number, connected by the [Border Gateway Protocol](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/). Using BGP, networks tell each other which IP ranges they can reach and through which path.

Background on the part that matters here: BGP has no built-in way to check whether an announcement is true. When a neighbor says "I can reach 104.20.0.0/21", your router believes it unless you've configured something to reject it. All protection against bad routes is policy that each operator has to set up on each session.

### Why more-specific routes win

Background: when a router forwards a packet, it looks up the destination address in its routing table and uses the **longest matching prefix**. A `/21` covers 2,048 addresses; a `/20` covers 4,096. If the table has both `104.20.0.0/20` and `104.20.0.0/21`, a packet to `104.20.1.1` matches both, and the router uses the `/21` because it's more specific.

This comparison happens before any of BGP's other preferences, such as shorter AS paths. A longer, worse path for a more-specific prefix beats a short, direct path for the covering prefix, because to the router they aren't competing routes at all; they're different prefixes, and the narrower one wins the lookup. Cloudflare's analogy: a route to Buckingham Palace is [more specific than a route to London](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/), and specific routes override general ones.

That's why the leak was so effective. Cloudflare kept announcing its genuine `/20`. Every network that received the leaked `/21`s from Verizon sent the traffic toward Verizon anyway.

```diagram
title: how the leak spread
flow: DQE optimizer -> /20 split to /21s -> Allegheny
flow!: Allegheny -> Verizon, no filter -> Internet takes /21s
note: longest-prefix match beats the real, shorter route
```

### Why it was a leak, not just a bad route

Background on how transit normally works: a customer network pays a provider to carry its traffic, and typically announces to that provider only its own prefixes and its own customers' prefixes. A customer that is connected to two providers (here, DQE and Verizon) should never pass routes learned from one provider to the other. If it does, it is offering to carry traffic between two large networks through its own small links. That is what a route leak is, and it's what Allegheny's session did.

The result Cloudflare describes: Verizon, Allegheny and DQE ["had to deal with a stampede of Internet users"](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/) trying to reach those services through their networks. Cloudflare's analogy is Waze routing an entire freeway down a neighborhood street. And it notes that even with enough capacity, those networks ["were not allowed to say they had the best route"](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/) to Cloudflare, Amazon and Linode.

### Three filters, none in place

Cloudflare lists [three mechanisms](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/) that each would have stopped the leak at Verizon:

- **Prefix limits.** A BGP session can be configured with a hard limit on the number of prefixes received; if a neighbor exceeds it, the router shuts the session down. A small customer suddenly announcing a large number of prefixes would trip it. Cloudflare says that had Verizon had such a limit, the incident would not have occurred.
- **IRR-based filtering.** Networks register which prefixes they announce in the Internet Routing Registry. Providers can generate per-session prefix lists from those records and accept only those. Cloudflare points out IRR filtering had been around and documented for [over 24 years](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/).
- **RPKI.** Cloudflare signs its prefixes with a maximum length of 20. A network doing BGP Origin Validation would see a `/21` for that space as invalid and drop it automatically, whatever the path. Cloudflare says AT&T among others had already enabled it.

Cloudflare's view of why they weren't in place is blunt: ["the only explanation we can conceive of why it wasn't in place is sloppiness or laziness"](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/). That is Cloudflare's opinion; Verizon's side isn't in the source.

## How it was fixed

Cloudflare's network team tried to contact DQE and Verizon. Both were hard to reach, which Cloudflare suggests [may have been due to the time](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/), early morning on the US East Coast. A Cloudflare engineer reached DQE, which put them in touch with someone who could act. DQE stopped advertising the "optimized" routes to Allegheny on the phone with Cloudflare, and the Internet stabilized.

Note what the fix was: the source of the leak withdrew its routes. Verizon, whose lack of filtering let the leak spread, had not responded at the time of writing. The fix depended on reaching a human at the one network that could stop it.

## What changed afterwards

The source doesn't report any change by DQE, Allegheny or Verizon, so none is claimed here. Cloudflare used the post to push for routing security: it urged operators to deploy RPKI and pointed to MANRS (Mutually Agreed Norms for Routing Security), which [condenses the three practices above](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/).

## The rule

In BGP, the network that receives a route is the only one in a position to reject it, so every session needs a policy that matches what the neighbor can legitimately announce. For a customer session that means a prefix limit sized to the customer, a filter built from their registered prefixes, and RPKI validation. And if you run tools that synthesize routes for internal traffic engineering, make sure they can't reach any session that leaves your network: a more-specific route is the most powerful thing you can announce, because it overrides everything else.

## Sources

- [Tom Strickx, "How Verizon and a BGP Optimizer Knocked Large Parts of the Internet Offline Today", Cloudflare Blog](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/): Cloudflare's same-day analysis of the leak, the networks involved, its traffic impact, the filters that would have prevented it and how it was resolved.
