---
title: "Pakistan Telecom announced one /24 and pulled YouTube's traffic across the world"
dek: "A national ISP announced a more specific slice of YouTube's address space, its upstream passed it on, and routers everywhere obeyed the longest-prefix-match rule exactly as designed."
belief: "Pakistan Telecom set out to block YouTube. Its route leaked upstream and pulled YouTube's traffic worldwide."
date: 2008-02-24
company: Pakistan Telecom
kind: outage
topics: [bgp, networking]
stack: [bgp]
duration_min: 120
impact: "From 18:47 UTC on 24 February 2008, YouTube traffic was redirected to Pakistan on a global scale; the major events were over after about two hours."
rule: "Never accept or forward a route announcement you have not checked against who is allowed to originate it. Longest-prefix match will believe anyone."
postmortem: https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study
sources: [https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study]
---

# Pakistan Telecom announced one /24 and pulled YouTube's traffic across the world

On Sunday, 24 February 2008, YouTube traffic from around the world started flowing to Pakistan. Nobody had broken into YouTube and nothing in YouTube's network had failed. A single route announcement had told the Internet's routers that the best way to reach YouTube's web servers was through Pakistan Telecom, and the routers believed it.

The RIPE NCC, which runs a set of BGP route collectors called the Routing Information Service (RIS), reconstructed the event afterwards. According to its [case study](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study), Pakistan Telecom (AS17557) started an unauthorised announcement of the prefix 208.65.153.0/24, and one of its upstream providers, PCCW Global (AS3491), forwarded that announcement to the rest of the Internet. The result, in RIPE's words, was "the hijacking of YouTube traffic on a global scale."

The whole thing took [about two hours](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study) from start to finish. It is still one of the cleanest demonstrations of how BGP decides where packets go, and why that decision has no idea who actually owns an address.

## What happened

The RIPE case study gives a minute-level timeline, all in UTC ([source](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study)):

- **Before the event:** YouTube (AS36561) announces 208.65.152.0/22. The /24 that would later be hijacked was not announced on the Internet at all.
- **18:47:** Pakistan Telecom (AS17557) starts announcing 208.65.153.0/24. PCCW Global (AS3491) propagates it. Routers around the world accept it and YouTube traffic is redirected to Pakistan.
- **20:07:** YouTube starts announcing 208.65.153.0/24 itself. Pakistan Telecom continues to attract some of the traffic.
- **20:18:** YouTube starts announcing two /25s, 208.65.153.0/25 and 208.65.153.128/25.
- **20:51:** The announcements originated by Pakistan Telecom via PCCW are now seen with an extra 17557 prepended to the AS path.
- **21:01:** PCCW withdraws all prefixes originated by Pakistan Telecom, ending the hijack.

The spread was fast. RIPE notes that in BGPlay, its route-visualisation tool, the unauthorised route had reached [its largest extent within two minutes](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study) of the first announcement at 18:47. YouTube's countermeasures started about [80 minutes after](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study) the Pakistani announcement.

RIPE also notes a limit on what anyone can say about the impact: RIS sees BGP data from its peers, not routing for the whole Internet, so it is [not possible from this data](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study) to say how many sites had their YouTube traffic hijacked.

## What the engineers believed

The case study states the motive plainly: [Pakistan aimed to block the YouTube website](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study). youtube.com resolved to three addresses, 208.65.153.238, 208.65.153.251 and 208.65.153.253, all inside 208.65.153.0/24.

RIPE doesn't describe Pakistan Telecom's internal configuration, so what follows is interpretation. Announcing a more specific route for the addresses you want to block, and pointing it at nothing, is a common way to make traffic for those addresses disappear inside your own network. That is a reasonable local action. The hidden assumption is that the route stays local: that an announcement meant for your own routers will not leak to your upstream, and that if it does, your upstream will refuse it because you have no right to originate that prefix.

Both halves of that assumption failed. The announcement reached PCCW, and PCCW passed it on to the rest of the Internet.

## What was actually going on

To see why one announcement could pull traffic away from YouTube everywhere, you need two pieces of how Internet routing works. Both are standard BGP behaviour; nothing here was a bug.

### The Internet routes on prefixes, and anyone can announce one

The Internet is a set of autonomous systems (ASes), each identified by a number. ASes tell their neighbours, over BGP, which IP prefixes they can deliver traffic to. A neighbour that accepts the route adds its own AS number to the path and passes the route along to its own neighbours. That is how a route announced in one country ends up in routing tables on every continent within a minute or two.

BGP itself has no built-in check that the AS originating a prefix is the one that holds it. Protection comes from operators filtering what they accept, especially from their customers. If a transit provider only accepts the prefixes each customer is registered to hold, a customer's mistake stops at the first hop. If it doesn't, the mistake travels as far as any honest route would.

### Longest prefix match beats everything else

When a router has several routes that cover a destination address, it uses the most specific one: the route with the longest prefix. This happens before any of BGP's path-selection rules come into play.

YouTube announced a /22, which covers 208.65.152.0 to 208.65.155.255. Pakistan Telecom announced a /24, which covers only 208.65.153.0 to 208.65.153.255. A router holding both routes, asked where to send a packet for 208.65.153.238, does not compare AS paths or ask which origin is legitimate. The /24 is more specific, so the /24 wins. The /22 stays in the table and is still used for the rest of YouTube's block, but the addresses that mattered now pointed at Pakistan.

```diagram
title: why a /24 beats a /22
flow!: AS17557 /24 -> PCCW passes it on -> more specific wins
flow: YouTube two /25s -> more specific still -> traffic returns
note: routers pick the longest match before they compare AS paths
```

This is why the hijack worked even though YouTube's own route never went away. RIPE notes that YouTube's connectivity for its /22 [almost didn't change](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study) during the event. The correct route was there the whole time. It was simply less specific.

### Why YouTube's first countermeasure only half worked

At 20:07 YouTube started announcing the same /24. Now routers had two routes of identical length, and the tie had to be broken by BGP's policy rules. As RIPE puts it, rules [such as preferring the shortest AS path](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study) decide which is chosen. Networks that were topologically closer to Pakistan Telecom kept choosing the bogus route, so Pakistan Telecom continued to attract some of YouTube's traffic.

RIPE's own peer, AS3333, shows the shape of this. From 18:47 to 20:52 it saw 208.65.153.0/24 originated by AS17557 through two paths, 3333 6320 3549 3491 17557 and 3333 12859 3491 17557. From 20:52 it saw the prefix originated by YouTube via 3333 3356 3549 36561 ([source](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study)). Both of the bogus paths go through 3491, PCCW: the single point where the leak could have been stopped.

### Fighting specificity with specificity

At 20:18 YouTube announced two /25s that together cover the same /24. Because of the longest-prefix-match rule, RIPE says, [every router that receives these announcements will send the traffic to YouTube](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study).

The catch is "that receives these announcements." RIPE's data shows the /22 seen by 112 RIS peers, the /24 by 105, and the /25 by [only 21](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study). The report doesn't say why. The usual reason, and this is general operational background rather than something RIPE states, is that many networks drop announcements more specific than /24 to keep global routing tables from growing without limit. So the strongest weapon a victim has, out-announcing the attacker with more specific routes, only reaches part of the Internet.

At 20:51 the bogus announcements were seen with another 17557 prepended, making the AS path longer, which [means more routers prefer the YouTube-originated route](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study). RIPE doesn't say who added the prepend.

## How they fixed it

The hijack ended when the network that propagated it stopped propagating it. At 21:01 UTC PCCW Global [withdrew all prefixes originated by Pakistan Telecom](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study). RIPE notes that PCCW did not fully disconnect AS17557: prefixes originated by other Pakistani ASes were still announced through it. RIS recorded the last unauthorised announcement at 21:01:22 UTC.

YouTube's own announcements of the /24 and the /25s narrowed the damage before that, but they couldn't end it everywhere. The fix that worked was at PCCW, one hop from the source.

## What changed afterwards

The RIPE case study is an analysis, not a remediation report, and it doesn't list changes made by PCCW or Pakistan Telecom. Its summary makes the general point that unauthorised announcements like this [can be prevented from spreading](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study) by appropriate routing configuration by AS operators, and points to the RIPE Routing Registry as the place to record who may originate what. It also notes that the RIPE community was then discussing digital certificates for Internet number resources, intended to further enhance routing configuration. (That work became what is now called RPKI, which lets a network check that an origin AS is authorised for a prefix; this is background, not part of the 2008 report.)

The lesson for anyone running a network is the one in that summary: the filter that matters is the one at the edge where a customer's routes enter your network.

## The rule

BGP will route the Internet's traffic toward whoever announces the most specific prefix, and it does not ask whether that announcer owns it. The only protection is filtering: accept from each neighbour only the prefixes it is registered to originate, and never forward anything else. A blocking rule meant for one country became a global outage because one upstream didn't apply that check.

## Sources

- [RIPE NCC, "YouTube Hijacking: A RIPE NCC RIS case study"](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study). Technical reconstruction of the event from RIPE's Routing Information Service: timeline, prefixes, AS paths, visibility counts and summary.
