---
title: "A 1.35 Tbps memcached reflection attack knocked GitHub offline for minutes"
dek: "Attackers spoofed GitHub's address in tiny UDP requests to exposed memcached servers, which answered with huge responses. GitHub's own transit filled up, so it withdrew its BGP routes and re-announced them through Akamai to get the traffic scrubbed."
belief: "GitHub thought extra transit capacity would absorb DDoS attacks. Memcached amplification filled its pipes."
date: 2018-02-28
company: GitHub
kind: outage
topics: [ddos, networking, bgp]
stack: [memcached, udp, bgp, akamai]
impact: "GitHub.com was unavailable from 17:21 to 17:26 UTC and intermittently unavailable from 17:26 to 17:30 UTC on 28 February 2018."
detected_by: alert
rule: "Any UDP service that answers an unauthenticated small request with a large response is an attack amplifier. Never expose one to the internet, and if you are a target, have a scrubbing path you can switch to before your links fill."
postmortem: https://github.blog/2018-03-01-ddos-incident-report/
sources: [https://github.blog/2018-03-01-ddos-incident-report/, https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/]
---

# A 1.35 Tbps memcached reflection attack knocked GitHub offline for minutes

On Wednesday 28 February 2018, GitHub.com was [unavailable from 17:21 to 17:26 UTC and intermittently unavailable from 17:26 to 17:30 UTC](https://github.blog/2018-03-01-ddos-incident-report/) because of a distributed denial-of-service attack. GitHub stressed that ["at no point was the confidentiality or integrity of your data at risk"](https://github.blog/2018-03-01-ddos-incident-report/).

The outage itself was short. The attack was not small. It [peaked at 1.35Tbps via 126.9 million packets per second](https://github.blog/2018-03-01-ddos-incident-report/) and came from [over a thousand different autonomous systems across tens of thousands of unique endpoints](https://github.blog/2018-03-01-ddos-incident-report/). None of those endpoints belonged to the attacker. They were memcached servers, the in-memory cache that sits behind a huge number of web applications, that had been left reachable from the public internet with UDP enabled.

This is a story about two things: why a cache server can be turned into a traffic cannon, and what a site does when the attack is bigger than its own pipes.

## What happened

From [GitHub's incident report](https://github.blog/2018-03-01-ddos-incident-report/):

1. **17:21 UTC.** GitHub's network monitoring system detected an anomaly in the ratio of ingress to egress traffic and notified the on-call engineer and others in chat.
2. Inbound transit bandwidth at one of GitHub's facilities rose to [over 100Gbps](https://github.blog/2018-03-01-ddos-incident-report/). GitHub decided to move its traffic to Akamai, which could provide more edge network capacity.
3. **17:26 UTC.** A command run through GitHub's ChatOps tooling withdrew BGP announcements over its transit providers and announced AS36459 (GitHub's network) exclusively over its links to Akamai.
4. Routes reconverged over the next few minutes, and access control lists at Akamai's border mitigated the attack.
5. **17:30 UTC.** Transit bandwidth and load balancer response codes showed full recovery.
6. **17:34 UTC.** GitHub also withdrew its routes to internet exchanges, shifting [an additional 40Gbps](https://github.blog/2018-03-01-ddos-incident-report/) away from its edge.
7. A [second spike of 400Gbps](https://github.blog/2018-03-01-ddos-incident-report/) came a little after 18:00 UTC. By then the traffic was arriving at Akamai.

## What the engineers believed

GitHub had been preparing for volumetric attacks. The report says it had [more than doubled its transit capacity](https://github.blog/2018-03-01-ddos-incident-report/) over the previous year, which ["has allowed us to withstand certain volumetric attacks without impact to users"](https://github.blog/2018-03-01-ddos-incident-report/).

The model behind that investment is reasonable: if your pipes are bigger than the attack, the attack is absorbed and your filters drop the junk. That model holds as long as attackers' bandwidth grows at roughly the pace you add capacity. The report itself notes the limit: ["attacks like this sometimes require the help of partners with larger transit networks to provide blocking and filtering"](https://github.blog/2018-03-01-ddos-incident-report/).

What changed that week was the attacker's cost of bandwidth. A new amplification vector had just appeared, and it multiplied what an attacker could send by a factor no one was planning around.

## What was actually going on

### Reflection and amplification

Cloudflare had described the vector in a post published the same week, ["Memcrashed – Major amplification attacks from UDP port 11211"](https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/), which GitHub's report cites as background.

The general shape of an amplification attack, as [Cloudflare explains it](https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/): an attacker who can spoof IP addresses sends forged requests to a vulnerable UDP server. The server, not knowing the request is forged, sends its reply to the forged source address, which is the victim. When thousands of such servers reply at once, the victim's network is overwhelmed.

Two properties make this work. Background on both:

- **UDP has no handshake.** With TCP, a server won't send data until a three-way handshake completes, and a spoofed source can't complete it because the SYN-ACK goes to the real owner of the address. UDP has no such step. The server reads one datagram and replies to whatever source address is written in it.
- **The reply is bigger than the request.** If each byte the attacker sends produces many bytes toward the victim, the attacker's bandwidth is multiplied. That ratio is the amplification factor.

Memcached is a key-value cache. Clients `set` a value under a key and later `get` it. Memcached also spoke UDP, and as Cloudflare put it, ["the request can be tiny and the response huge (up to 1MB)"](https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/). The recipe Cloudflare describes is two steps: the attacker first stores a large payload on an exposed memcached server, then sends `get` requests for it with the victim's address as the source.

In Cloudflare's synthetic test, [15 bytes of request triggered 134KB of response](https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/), about 10,000x. In real attacks it had seen a 15-byte request produce a 750kB response, [a 51,200x amplification](https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/). GitHub's report gives the factor as ["up to 51,000"](https://github.blog/2018-03-01-ddos-incident-report/): for every byte the attacker sends, up to 51KB arrives at the target.

```diagram
title: memcached reflection
flow: attacker -> spoofed 15 B get -> open memcached
flow!: exposed memcached -> ~750 kB reply -> victim's links
note: UDP has no handshake, so the reply goes to the forged address
```

For comparison, Cloudflare mentions earlier amplification vectors it had handled, such as SSDP, which it had seen [reach 196Gbps](https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/). Memcached's ratio is what made a 1.35Tbps attack possible from a modest amount of attacker bandwidth.

### Why so many memcached servers were exposed

Cloudflare's post points at the default configuration at the time: ["By default memcached listens on INADDR_ANY and runs with UDP support ENABLED"](https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/). A server installed with defaults on a host with a public interface and no firewall will answer anyone on the internet. Cloudflare cited Shodan reporting [88,000 open memcached servers](https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/), and found most of the ones attacking it in large hosting providers.

None of those operators were attacking anyone. Each had a cache with an open port. That is why the GitHub attack came from "tens of thousands of unique endpoints": the attack traffic was coming from other people's misconfigured servers, all sending UDP from source port 11211.

### Why filtering on your own edge isn't enough

Background: a router can drop UDP packets from port 11211 trivially. The problem is where the drop happens. If 1.35Tbps is headed toward links that carry a fraction of that, the links are full before the packets reach any filter you control. Your firewall drops the junk, but the legitimate traffic was already lost upstream in the congested link. The only fix is to drop the traffic somewhere that has more capacity than the attack, which in practice means a provider with a very large edge.

That's what GitHub did. It used BGP, the protocol networks use to tell each other which IP ranges they can reach, to change where the internet sent traffic for GitHub's addresses. By withdrawing its announcements over its normal transit providers and announcing AS36459 [exclusively over its links to Akamai](https://github.blog/2018-03-01-ddos-incident-report/), GitHub made Akamai's network the only path to GitHub. Attack traffic then landed on Akamai's edge, where access control lists dropped it, and only clean traffic was passed on.

BGP changes are not instant. The report says routes ["reconverged in the next few minutes"](https://github.blog/2018-03-01-ddos-incident-report/), which is part of why the site was intermittently available between 17:26 and 17:30 rather than fixed the moment the command ran.

## How they fixed it

The fix was the route swing described above, run through ChatOps at 17:26 UTC, followed by the withdrawal of internet-exchange routes at 17:34 UTC. The report shows an Akamai graph of inbound traffic reaching Akamai's edge, including the [second 400Gbps spike after 18:00 UTC](https://github.blog/2018-03-01-ddos-incident-report/), which GitHub's users didn't feel because the traffic was already being absorbed upstream.

On the source side, Cloudflare's recommendations to operators were to start memcached with `--listen 127.0.0.1` to bind only to localhost and [`-U 0` to disable UDP completely](https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/), and to firewall memcached servers from the internet. Cloudflare later added an update that DigitalOcean, OVH, Linode and Amazon had [tackled the memcached problem](https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/) on their networks.

## What changed afterwards

GitHub's report focuses on reducing human involvement. It says GitHub was investigating ["the use of our monitoring infrastructure to automate enabling DDoS mitigation providers"](https://github.blog/2018-03-01-ddos-incident-report/) and would keep measuring response times with a goal of reducing mean time to recovery. It also said it would continue expanding its edge network.

The timeline shows why that matters. Detection was at 17:21 and the route change at 17:26. The report doesn't break down the time in between, but it covers a person noticing the alert, judging the traffic, deciding to move to Akamai and running the command. Automating the trigger takes that judgement step out of the critical path.

Cloudflare's post addressed the protocol designers rather than the victims. Its advice: if you build on UDP, ["you must always respond with strictly a smaller packet size then the request"](https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/), and don't ship an unauthenticated UDP protocol enabled by default. It also noted that as long as IP spoofing is possible on the internet, reflection attacks will keep happening.

## The rule

There are two lessons, one for each side of the attack.

If you run services: a UDP listener that answers an unauthenticated request with a larger response is a weapon waiting to be used against someone else. Bind internal services such as caches to private interfaces, turn off UDP where you don't use it, and firewall them from the internet. Defaults that listen on all interfaces are not safe defaults.

If you are the target: past a certain size, an attack can't be filtered on your own edge, because the links are full before your filters see the packets. Know in advance where you will send your traffic, have the BGP change ready to run, and ideally have monitoring that triggers it without waiting for a human.

## Sources

- [GitHub, "February 28th DDoS Incident Report"](https://github.blog/2018-03-01-ddos-incident-report/): GitHub's incident report with the timeline, attack size, detection, the BGP move to Akamai and next steps.
- [Cloudflare, "Memcrashed – Major amplification attacks from UDP port 11211"](https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/): the technical write-up of the memcached UDP amplification vector, cited by GitHub as background, with amplification measurements and mitigation advice.
