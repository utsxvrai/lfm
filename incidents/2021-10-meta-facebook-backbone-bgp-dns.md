---
title: "One maintenance command disconnected Facebook's backbone and its DNS withdrew itself from the internet"
dek: "A command meant to assess backbone capacity took down every backbone link instead, and a buggy audit tool let it through. Facebook's DNS servers, designed to withdraw their BGP routes when they lose the data centers, did exactly that, and facebook.com stopped resolving for the whole internet."
belief: "Facebook trusted an audit tool to stop bad backbone commands. A bug let one through, and its DNS went dark."
date: 2021-10-04
company: Meta
kind: outage
topics: [bgp, dns, human-error, cascading-failure]
stack: [bgp, dns, backbone]
impact: "Facebook, Instagram and WhatsApp were unreachable worldwide; Cloudflare saw facebook.com stop resolving on 1.1.1.1 at around 15:50 UTC and return at 21:20 UTC."
rule: "A health check that withdraws you from the world must be able to tell 'I am broken' from 'everything is broken'. And keep a way into your own network that doesn't depend on that network."
postmortem: https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/
sources: [https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/, https://engineering.fb.com/2021/10/04/networking-traffic/outage/, https://blog.cloudflare.com/october-2021-facebook-outage/]
---

# One maintenance command disconnected Facebook's backbone and its DNS withdrew itself from the internet

On 4 October 2021, Facebook, Instagram and WhatsApp vanished from the internet. Not slow, not erroring: gone. Cloudflare, watching from outside, said their DNS names stopped resolving and their infrastructure IPs were unreachable, ["as if someone had 'pulled the cables' from their data centers all at once"](https://blog.cloudflare.com/october-2021-facebook-outage/).

Facebook's explanation, published the next day, starts with routine maintenance on its global backbone. A command [issued with the intention to assess the availability of global backbone capacity](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/) instead took down all the backbone connections. A tool meant to catch exactly this kind of mistake had a bug and didn't stop it.

The backbone failure alone would have been a huge internal outage. What made it invisible to the whole internet was a second, well-intentioned piece of automation in Facebook's DNS servers. That's the part worth understanding.

## What happened

Facebook didn't publish a timeline with timestamps. The outside view comes from [Cloudflare's analysis](https://blog.cloudflare.com/october-2021-facebook-outage/), all UTC:

- **Around 15:40:** Cloudflare saw a peak of BGP routing changes from Facebook. ["That's when the trouble began."](https://blog.cloudflare.com/october-2021-facebook-outage/)
- **15:51:** Cloudflare opened an internal incident titled "Facebook DNS lookup returning SERVFAIL", initially worried that its own resolver 1.1.1.1 was at fault.
- **15:58:** Cloudflare noticed Facebook had stopped announcing the routes to its DNS prefixes.
- **Around 21:00:** Renewed BGP activity from Facebook's network, peaking at 21:17.
- **21:20:** facebook.com available again on 1.1.1.1, after it [stopped being available at around 15:50 UTC](https://blog.cloudflare.com/october-2021-facebook-outage/).

The inside view, from [Facebook's engineering post](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/):

1. During a routine maintenance job, a command meant to assess global backbone capacity took down all backbone connections, **disconnecting Facebook's data centers globally**.
2. Facebook's systems are designed to audit such commands, but [a bug in that audit tool prevented it from properly stopping the command](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/).
3. Facebook's DNS servers, unable to reach the data centers, treated that as unhealthy and withdrew their BGP advertisements. The DNS servers [became unreachable even though they were still operational](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/).
4. Recovery was slowed because remote access was down and engineers had to go on site.

Facebook's first-day statement described the trigger as [configuration changes on the backbone routers](https://engineering.fb.com/2021/10/04/networking-traffic/outage/) and said there was no malicious activity and no evidence that user data was compromised.

Neither Facebook post states the outage's duration or the number of affected users, so neither appears here as a fact. The 15:50 and 21:20 times are what Cloudflare observed on its resolver, not an official start and end.

## What the engineers believed

Two pieces of design were built on reasonable assumptions.

**"The audit tool will catch a dangerous command."** Facebook had a safety net specifically for backbone commands. That is the right design: humans running commands against global infrastructure will eventually type something wrong. The assumption was that the net worked. It had a bug.

**"If a DNS server can't reach the data centers, it is the one that's broken."** This is the important one. Facebook's edge facilities run its authoritative DNS. Facebook says they [disable those BGP advertisements if they themselves can not speak to our data centers, since this is an indication of an unhealthy network connection](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/). For a single site with a bad link, that's exactly right. If one edge location loses its path to the backend, it should stop attracting DNS traffic so the internet routes users to a healthy location instead.

The design assumed failures are local. It had no answer for the case where every location loses the backend at the same time.

## What was actually going on

### How Facebook's DNS reaches the internet

*(Background, consistent with both posts.)* When someone looks up facebook.com, a recursive resolver (like 1.1.1.1 or 8.8.8.8) has to ask Facebook's authoritative name servers. Those servers live at [well known IP addresses](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/), and the internet knows how to reach those addresses only because Facebook announces routes to them using **BGP**, the protocol networks use to tell each other which IP ranges they can deliver to. Cloudflare's description: BGP is how one network advertises its presence to the others, and without that, ["ISPs and other networks can't find Facebook's network"](https://blog.cloudflare.com/october-2021-facebook-outage/).

The same addresses are typically announced from many locations (anycast), so the internet routes each query to a nearby site. If a site withdraws its announcement, traffic flows to the others. That's the mechanism the health check relies on.

### How a correct local rule became a global shutdown

Put the pieces together:

1. The backbone went down everywhere at once.
2. Every edge DNS site checked: "can I reach the data centers?" Every one got "no".
3. Every site concluded it was unhealthy and withdrew its BGP announcements, all at the same moment.
4. There was no healthy site left to route to. The DNS prefixes disappeared from the global routing table. Cloudflare showed this from public route servers: queries for Facebook's DNS prefixes returned ["Network not in table"](https://blog.cloudflare.com/october-2021-facebook-outage/).

```diagram
title: every site withdrew at once
flow: one site cut off -> withdraws BGP -> others serve
flow!: all sites cut off -> all withdraw BGP -> DNS unreachable
note: the rule assumed some site would always be healthy
```

Cloudflare noted that other Facebook IP ranges [remained routed but weren't particularly useful](https://blog.cloudflare.com/october-2021-facebook-outage/), because without DNS nobody could find them.

### The retry storm outside

Once resolvers couldn't reach Facebook's name servers, they returned SERVFAIL. Cloudflare describes what happened next: apps retried, sometimes aggressively, and users reloaded pages and relaunched apps. Cloudflare saw DNS resolvers worldwide handling [30x more queries than usual](https://blog.cloudflare.com/october-2021-facebook-outage/) for these names.

### Why recovery was slow

Facebook names [two large obstacles](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/): data centers couldn't be reached by normal means because their networks were down, and the total loss of DNS broke many of the internal tools used to investigate and fix outages. Facebook's first-day statement says the root cause [also impacted many of the internal tools and systems we use in our day-to-day operations](https://engineering.fb.com/2021/10/04/networking-traffic/outage/).

With [primary and out-of-band network access](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/) both down, Facebook sent engineers on site. That took time too, because the facilities are built to be hard to get into and the hardware is designed to be hard to modify even with physical access.

## How they fixed it

Once engineers were on site and through the secure access procedures, they could [confirm the issue and bring our backbone back online](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/). Restoring the backbone brought everything else back with it.

But turning everything back on at once was a risk of its own. Individual data centers were reporting [dips in power usage in the range of tens of megawatts](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/), and suddenly reversing that could endanger everything from electrical systems to caches. Facebook credits its "storm" drills, which simulate taking a service, data center or region offline, for giving the team the experience to bring load back carefully. It also says it had never run a storm that simulated the global backbone going offline.

## What changed afterwards

Facebook's post describes intentions rather than specific changes:

- Look for ways to simulate a global backbone loss in future storm drills.
- [Strengthen our testing, drills, and overall resilience](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/).

Facebook also reflected that the security hardening of its facilities slowed recovery from an outage caused by its own error, and called that trade-off worth it.

Neither post says how the audit tool bug was fixed or whether the DNS withdrawal logic was changed, so that's not claimed here.

## The rule

Self-protecting automation has to know the difference between "I'm the problem" and "everything is the problem". A rule like "withdraw if you can't reach the backend" is safe only while some peer is still healthy to take the traffic; when every instance sees the same failure, the rule turns a partial outage into a total one. Give those rules a floor (never withdraw the last N sites) or make them check whether the failure is local. Separately, keep at least one way into your network, and one way to talk to each other, that doesn't depend on the network, DNS or tools that just failed. And test the safety net that guards your most dangerous commands, because on this day it was the only thing between a typo and the whole company.

## Sources

- [Meta Engineering, "More details about the October 4 outage" (Santosh Janardhan, 5 October 2021)](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/): the main postmortem, covering the backbone command, the audit tool bug, the DNS BGP withdrawal, on-site recovery and the power and storm-drill discussion.
- [Meta Engineering, "Update about the October 4th outage" (4 October 2021, updated 5 October)](https://engineering.fb.com/2021/10/04/networking-traffic/outage/): the first-day statement, attributing the outage to configuration changes on backbone routers and ruling out malicious activity.
- [Cloudflare, "Understanding how Facebook disappeared from the Internet" (Celso Martinho and Tom Strickx)](https://blog.cloudflare.com/october-2021-facebook-outage/): the outside view, with UTC times of the BGP withdrawals and DNS failures, route-server output and the resolver query surge.
