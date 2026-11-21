---
title: "A reordered BGP policy put 'reject the rest' first and took 19 Cloudflare data centers offline"
dek: "A change meant only to add informational BGP communities also reordered the terms of a router policy. Two terms that advertised site-local prefixes ended up below an explicit reject, so 19 of Cloudflare's busiest data centers stopped announcing them. Those sites were 4% of the network and carried 50% of requests."
date: 2022-06-21
company: Cloudflare
kind: outage
topics: [bgp, config-change, rollback]
stack: [bgp, junos, clos-network]
impact: "19 data centers went offline from 06:27 UTC; they are 4% of Cloudflare's network but the outage affected 50% of total requests. All were back by 07:42 UTC."
rule: "In a first-match policy, order is behavior: review the rendered result of a policy change, not just the lines you meant to add, and roll network changes out with an automatic commit-confirm."
postmortem: https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/
sources: [https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/]
---

# A reordered BGP policy put 'reject the rest' first and took 19 Cloudflare data centers offline

On 21 June 2022, starting at 06:27 UTC, Cloudflare had an outage that [affected traffic in 19 of our data centers](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/). Depending on where they were, users couldn't reach websites and services behind Cloudflare. Elsewhere, Cloudflare kept working normally.

Nineteen sites doesn't sound like much for a network of Cloudflare's size, and Cloudflare says those locations are [only 4% of our total network](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/). But they were the busiest ones, and the outage hit [50% of total requests](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/).

The change that caused it was meant to be cosmetic: attaching some informational labels to route announcements. What it actually did was move two lines in a router policy below a line that rejects everything.

## What happened

Over the previous 18 months, Cloudflare had converted its 19 busiest locations to a new architecture called [Multi-Colo PoP (MCP)](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/): Amsterdam, Atlanta, Ashburn, Chicago, Frankfurt, London, Los Angeles, Madrid, Manchester, Miami, Milan, Mumbai, Newark, Osaka, São Paulo, San Jose, Singapore, Sydney and Tokyo. MCP is a Clos network with an added layer of routing, the **spines**, that makes it easy to take parts of a data center out for maintenance.

Cloudflare was rolling out a change to [standardize the BGP communities](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/) attached to its site-local prefixes. The [timeline](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/), UTC:

- **03:56:** Change deployed to the first location. No impact; it uses the older architecture.
- **06:17:** Change deployed to the busiest locations, but not those with MCP.
- **06:27:** Rollout reaches the MCP locations and the spines. The 19 locations go offline. Incident starts.
- **06:32:** Internal incident declared.
- **06:51:** First change made on a router to verify the root cause.
- **06:58:** Root cause found and understood. Reverts begin. The first data center is back online.
- **07:42:** Last revert completed, delayed because [network engineers walked over each other's changes, reverting the previous reverts](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/), so the problem reappeared sporadically.
- **08:00:** Incident closed.

## What the engineers believed

The change went through Cloudflare's normal process. It had a Change Request ticket with a dry run and a stepped rollout, and it was [peer reviewed by multiple engineers](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/).

The belief was that the change only **added** information. On the edge routers, it did: the diff added lines like `community add SITE-LOCAL-ROUTE;` to existing terms, which Cloudflare calls [harmless](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/). The spine diff looked like the same kind of change. Cloudflare's own comment: ["An initial glance at this diff might give the impression that this change is identical, but unfortunately, that's not the case."](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/)

The second belief was that the staggered rollout would catch any problem early. The stagger was there, but [the stagger policy did not include an MCP data center until the final step](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/). The locations where the bug could show itself were the last to get the change, and they all got it together.

## What was actually going on

### BGP export policies are evaluated in order

To be reachable, a network announces its IP prefixes to other networks using BGP. Operators write **policies** that decide which prefixes get advertised to which peers. Cloudflare explains that these policies [have individual components, which are evaluated sequentially](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/), and each prefix ends up either advertised or not. If a policy change stops advertising a prefix, it's **withdrawn** and those addresses become unreachable from the internet.

*(Background.)* In Junos-style policy syntax, a `policy-statement` contains named `term`s. For each route, the router walks the terms top to bottom. The first term whose `from` conditions match and whose `then` includes a terminating action (`accept` or `reject`) decides the route's fate. Terms below it are never looked at. That's the same first-match semantics as a firewall rule list. Reordering terms changes behavior even if not a single term's content changes.

### The diff that hid a reorder

On the spines, the policy `AGGREGATES-OUT` ended with a catch-all:

```
term REJECT-THE-REST {
    then reject;
}
```

Before the change, the site-local terms (`4-ADV-SITE-LOCALS` and `6-ADV-SITE-LOCALS`) came near the top. The change rewrote the policy so that several terms moved up and those two moved to the bottom. In the diff, the `!` markers meant ["a re-ordering of the terms"](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/):

```
!    term REJECT-THE-REST { ... }
!    term 4-ADV-SITE-LOCALS { ... }
!    term 6-ADV-SITE-LOCALS { ... }
```

The site-local terms now sat **after** `REJECT-THE-REST`. Every site-local prefix hit the reject first and was never advertised.

```diagram
title: same terms, new order
flow: site-locals term -> accept -> prefix advertised
flow!: REJECT-THE-REST -> reject -> site-locals unseen
note: first match wins, so moving a term changes everything below it
```

The visible part of the diff, the `community add` lines, really was harmless. The dangerous part was a column of `!` characters that are easy to read past.

### Why losing site-local prefixes broke everything

Site-local prefixes are what let Cloudflare's servers [communicate with each other, as well as connect to customer origins](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/). Withdrawing them did three things at once:

1. **Origins became unreachable.** Cloudflare's servers in those locations couldn't fetch content from customer origin servers.
2. **Load balancing inside the data center broke.** Cloudflare's internal load balancer, Multimog, could no longer forward requests between servers in the MCP. Smaller compute clusters got [the same amount of traffic as our largest clusters](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/) and overloaded.
3. **Engineers lost their direct way in.** The withdrawal removed [our direct access to all the impacted locations](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/). Cloudflare used backup procedures to take control of them.

Because these were the busiest locations, a fault in 4% of the network became a fault in half of all requests.

## How they fixed it

Once the root cause was understood at 06:58, engineers reverted the change location by location. The first data center came back at 06:58, and the last revert was completed at 07:42. That last stretch was slowed by engineers [reverting the previous reverts](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/): several people were changing the same routers at once, without coordinating, and undoing each other's fixes.

## What changed afterwards

Cloudflare listed [three areas](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/):

- **Process:** change procedures and automation must include MCP-specific test and deploy steps, so MCP locations aren't only reached at the end of a stagger.
- **Architecture:** the policy statement that caused the incorrect advertisement will be redesigned to prevent an unintentional incorrect ordering.
- **Automation:** enforce an improved stagger policy for network configuration rollouts, and add an automated "commit-confirm" rollback. Cloudflare says the first would have significantly lessened the impact and the second would have greatly reduced the time to resolve.

*(Background.)* Commit-confirm is a router feature: you commit a change with a timer, and unless you confirm it within that window, the router automatically rolls back. If a change cuts off your own access to the router, as this one did, the router undoes it on its own.

## The rule

In any ordered rule list (BGP policy, firewall, ACL, routing table, middleware chain), position is behavior, and a catch-all `reject` or `deny` makes every rule below it dead code. Review the rendered policy after the change, ideally with a tool that evaluates which prefixes will be advertised before and after, not just a line diff. Make sure your staged rollout reaches a representative of every architecture early, not last. And for any change that can cut off your access to the device, use an automatic rollback that fires unless a human confirms the change is healthy, so recovery doesn't depend on reaching a box you just made unreachable.

## Sources

- [Cloudflare, "Cloudflare outage on June 21, 2022" (Tom Strickx and Jeremy Hartman)](https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/): Cloudflare's postmortem, covering the MCP architecture, the timeline, the router diffs, the term reordering, the impact on origins and Multimog, and the follow-up work.
