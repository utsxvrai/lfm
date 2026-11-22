---
title: "A Mirai DDoS on Dyn's DNS was amplified by the internet's own retries"
dek: "Attack traffic on port 53 looked like real DNS queries, and real resolvers that couldn't get answers kept asking again. Dyn saw 10-20X normal traffic and couldn't tell friend from foe."
belief: "DDoS defence assumes attack traffic looks different. At Dyn, it looked like real DNS queries on port 53."
date: 2016-10-21
company: Dyn
kind: outage
topics: [ddos, dns, cascading-failure]
stack: [dns, anycast]
impact: "Two DDoS waves against Dyn's Managed DNS platform caused significant impact for its customers and their end users, with residual impact until about 20:30 UTC."
rule: "When your protocol has built-in retries, an outage produces its own load: plan capacity and filtering for the retry storm, not just for the attacker."
postmortem: https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/
sources: [https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/]
---

# A Mirai DDoS on Dyn's DNS was amplified by the internet's own retries

On Friday, October 21, 2016, Dyn, a company that runs authoritative DNS for other companies' domains, came under attack. According to Dyn's own analysis, there were two waves: [from approximately 11:10 UTC to 13:20 UTC, and again from 15:50 UTC until 17:00 UTC](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/). Both were large Distributed Denial of Service floods aimed at its Managed DNS infrastructure.

When the service that answers "what IP address is this name?" for a domain can't answer, it doesn't matter that the website's servers are healthy. Users can't find them. Dyn says the attacks were mitigated, but only after its customers and their end users had felt significant impact ([Dyn](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/)). Dyn's summary doesn't name the affected customers, so this post doesn't either.

What makes this incident worth studying isn't only the size of the botnet. A large share of the traffic hammering Dyn came from ordinary, well-behaved DNS resolvers doing exactly what they are designed to do when they don't get an answer: ask again.

## What happened

The first attack [began around 11:10 UTC](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/). Dyn first saw elevated bandwidth against its platform in the Asia Pacific, South America, Eastern Europe and US-West regions. As the incident response started, the attack "abruptly changed" and concentrated on Dyn's points of presence in US-East, with high-volume floods of TCP and UDP packets, all with destination port 53, from a large number of source IP addresses.

Dyn's teams added manual mitigations on top of their automated defences: traffic-shaping incoming traffic, rebalancing traffic by changing anycast policies, internal filtering, and scrubbing services. Mitigation was [fully deployed by 13:20 UTC](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/) and the attack subsided shortly after.

At [roughly 15:50 UTC](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/) a second attack began. It was "more globally diverse" but used the same protocols. Dyn extended the defences from the morning globally and "substantially" recovered by 17:00 UTC, with residual impact from additional sources until approximately 20:30 UTC. Smaller probing TCP attacks followed over the next hours and days, and Dyn says they caused no further customer impact.

## What the engineers believed

Dyn's summary doesn't describe the team's mental model before the attack, so this section is interpretation.

The usual way to fight a flood is to separate bad traffic from good traffic and drop the bad. That works when the attack looks different: wrong port, malformed packets, a protocol you don't serve, a small set of sources. The working assumption behind most DDoS defence is that *there is a difference to find*.

During the attack the traffic also seemed to come from a huge number of machines. Dyn writes that it saw attack and legitimate traffic from millions of IPs in every geography ([Dyn](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/)). The natural reading of that is "the botnet is enormous". That reading turned out to be wrong.

## What was actually going on

### The attack looked like the product

Dyn describes the floods as masked, maliciously targeted TCP and UDP traffic aimed at port 53 ([Dyn](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/)). Port 53 is DNS. An authoritative DNS provider exists to accept packets on port 53 from anyone on the internet. You can't firewall it off, because the legitimate callers (recursive resolvers at ISPs, companies and public DNS services) are also "anyone on the internet". Dyn says plainly that in a DDoS which uses the DNS protocol "it can be difficult to distinguish legitimate traffic from attack traffic."

### How the retry storm forms

Some background on how DNS lookups normally work explains the second half of the problem.

When your laptop looks up a name, it asks a **recursive resolver** (your ISP's, or a public one). The resolver checks its cache. If the record is cached and its TTL hasn't expired, it answers immediately. If not, it asks the **authoritative** servers for that domain, which here were Dyn's, caches the answer for the TTL, and returns it.

Two properties of this design matter under attack:

1. **Caches expire constantly.** Every popular name gets refreshed by thousands of resolvers as TTLs run out. That background refresh traffic is normal and steady.
2. **DNS clients retry.** DNS over UDP has no connection and no delivery guarantee, so resolvers send a query, wait a short time, and try again, often against another of the domain's name servers. Stub resolvers on end-user machines retry too, and applications retry when lookups fail.

When the authoritative servers are overloaded, answers stop coming back. Every resolver whose cache entry expires sends a query, gets nothing, and sends more. Every user whose page failed to load presses reload, which triggers more lookups. Dyn measured the result: the attack "generated a storm of legitimate retry activity as recursive servers attempted to refresh their caches, creating [10-20X normal traffic volume](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/) across a large number of IP addresses."

```diagram
title: how a DNS flood feeds itself
flow: botnet flood -> authoritative slow -> answers time out
flow!: resolvers retry -> 10-20X traffic -> more timeouts
note: the second loop is made of legitimate traffic
```

That's a cascading failure. The attacker only had to push the authoritative layer past the point where it answered reliably. After that, the legitimate retry load added to the attack load, and it came from real resolvers whose traffic Dyn could not simply drop, since dropping it is the same as being down.

### Why the botnet looked bigger than it was

The retry storm also distorted the measurement. Dyn writes that the attacks appear to have come from at least one botnet, and that the retry storm made the set of attacking endpoints look much larger than it really was. Its estimate at the time of the report was [up to 100,000 malicious endpoints](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/), and it confirmed that a significant volume of the attack traffic came from Mirai-based botnets.

So "millions of IPs" during the incident was mostly the real internet's resolvers, pulled in by the outage. If you count unique sources to size an attack, a protocol with retries will make that count wrong in the attacker's favour.

### How big

Early observations from a few Dyn data centers showed TCP packet flow bursts [40 to 50 times higher than normal](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/), and that excludes traffic dropped before reaching Dyn by its own and upstream providers' mitigation. Dyn notes reports of an attack in the 1.2 Tbps range but says it was "unable to verify that claim." This post treats that figure as unverified, as Dyn did.

### Why anycast is both the defence and the target

Dyn's mitigations included rebalancing traffic by changing anycast policies ([Dyn](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/)). Some background: with anycast, the same IP address is announced from many points of presence, and internet routing delivers each packet to the topologically nearest one. A distributed botnet's traffic therefore spreads across many sites, which is good. But it also means you don't choose which site absorbs which attacker. Shifting load means changing which sites announce which routes, and how attractively, so that traffic lands where there is spare capacity. When the first wave narrowed onto US-East, that region's points of presence took the concentrated flood.

## How they fixed it

From Dyn's account, recovery was a set of layered mitigations rather than a single fix:

- traffic-shaping incoming traffic,
- rebalancing via anycast policy changes,
- internal filtering,
- scrubbing services,

all on top of existing automated responses. These were fully deployed for the first wave by [13:20 UTC](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/). For the second wave, Dyn extended the same defences globally, which it credits for substantial recovery by 17:00 UTC.

## What changed afterwards

Dyn's summary is short on specific remediation. It says Dyn put protective measures in place quickly during the attack and is extending and scaling those measures aggressively, that it has been sharing learnings and mitigation methods with other infrastructure providers, and that it is collaborating with an ongoing criminal investigation and will not speculate about the attackers' motives or identity ([Dyn](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/)). It also notes the attack highlighted vulnerabilities in the security of Internet of Things devices.

The general lesson for backend engineers doesn't depend on DNS. Any system where clients retry on failure (HTTP clients with retry middleware, queue consumers, mobile apps reconnecting) has a version of this loop. Once your service crosses into failure, demand goes *up*. The standard defences are exponential backoff with jitter on the client side, retry budgets, and load shedding on the server side. They are not optional extras. They decide whether a brief overload settles down or keeps feeding itself.

## The rule

When your protocol has built-in retries, an outage produces its own load: plan capacity and filtering for the retry storm, not just for the attacker.

## Sources

- [Dyn Analysis Summary Of Friday October 21 Attack](https://web.archive.org/web/20200625183317/https://dyn.com/blog/dyn-analysis-summary-of-friday-october-21-attack/): Dyn's official post-incident summary by Scott Hilton, dated October 26, 2016 (archive.org copy). It is the source for every timestamp, the 10-20X retry figure, the 100,000-endpoint estimate, the Mirai attribution and the unverified 1.2 Tbps figure.
