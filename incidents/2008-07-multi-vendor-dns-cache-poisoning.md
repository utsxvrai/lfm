---
title: "A 16-bit ID and a fixed port: how most DNS resolvers could be poisoned in 2008"
dek: "A caching resolver trusts the first answer that matches its question. CERT's 2008 advisory showed that in many implementations the only secret in that match was a 16-bit number, and that attacks combining known weaknesses had become extremely effective."
date: 2008-07-08
company: Multiple vendors
kind: security-breach
topics: [dns, security, cache]
stack: [dns, udp, bind]
impact: "CERT VU#800113 (CVE-2008-1447): deficiencies in the DNS protocol and common implementations allowed attackers to insert forged records into caching resolvers, redirecting web, email and other traffic."
detected_by: third-party
rule: "If an unauthenticated protocol trusts the first reply that matches, make every part of the match unpredictable, and know how many bits of unpredictability you actually have."
postmortem: https://www.kb.cert.org/vuls/id/800113
sources: [https://www.kb.cert.org/vuls/id/800113]
---

# A 16-bit ID and a fixed port: how most DNS resolvers could be poisoned in 2008

On 8 July 2008, CERT/CC published Vulnerability Note VU#800113 under a plain title: "[Multiple DNS implementations vulnerable to cache poisoning](https://www.kb.cert.org/vuls/id/800113)." The note was unusual for two reasons. It was not about one product's bug: it was about deficiencies in the DNS protocol and in common implementations of it. And it had been coordinated across a long list of vendors in advance; vendor entries on the note show notifications going out as early as [April 21, 2008](https://www.kb.cert.org/vuls/id/800113).

The impact CERT described was simple and alarming. An attacker who successfully poisons a caching nameserver [can cause its clients to contact the wrong, possibly malicious hosts](https://www.kb.cert.org/vuls/id/800113), so "web traffic, email, and other important network data can be redirected to systems under the attacker's control."

None of the individual weaknesses were new. CERT says so directly: published articles already described inherent deficiencies in DNS and defects in implementations. What had changed was that [recent research into combining them](https://www.kb.cert.org/vuls/id/800113) had "yielded extremely effective exploitation techniques." CERT thanks Dan Kaminsky of IOActive for identifying the effectiveness and practicality of DNS cache poisoning.

## What happened

This is a vulnerability disclosure rather than a single outage, so the "incident" is the discovery that a large part of the Internet's resolver population was exploitable, and the coordinated patching that followed. The note carries CVE-2008-1447 and was revised many times afterwards as vendors reported status, with a last revision dated [2014-04-14](https://www.kb.cert.org/vuls/id/800113).

CERT lists three classes of weakness ([source](https://www.kb.cert.org/vuls/id/800113)):

1. **Insufficient transaction ID space.** The DNS transaction ID field is 16 bits. Correctly implemented and chosen with a strong random generator, an attacker needs on average 32,768 attempts to guess it. Some implementations used fewer bits or generated IDs with known randomness errors.
2. **Multiple outstanding requests.** Some resolvers, given several identical queries for the same record, sent several identical queries upstream. CERT notes this makes a "birthday attack" feasible, which significantly raises the attacker's chance of success.
3. **Fixed source port for queries.** Some implementations picked a port at startup and reused it for every outgoing query. Some used the traditional DNS server port, 53/udp, for all of them.

Caching resolvers were the main target, both open ones and those restricted to their own users. CERT adds that stub resolvers, the DNS client in an ordinary operating system, were at risk too.

## What the engineers believed

The working assumption behind many resolvers was that the transaction ID was the security boundary, and that it was enough. A forger has to guess the ID, has to get the forged packet in before the real answer arrives, and only gets a chance when the resolver actually has a query outstanding. That combination felt like a high bar. The source port, under that view, was an implementation detail: a socket the resolver opened once and kept using.

CERT's note is, in effect, a statement that this belief was wrong in two ways. The ID alone was [too small](https://www.kb.cert.org/vuls/id/800113) given the newer techniques, and the source port was not a detail but the main source of additional unpredictability available inside the protocol.

## What was actually going on

### How a resolver decides to trust an answer

DNS queries normally travel over UDP. There is no connection and no handshake. When a caching resolver needs an answer it does not have, it sends a UDP packet to an authoritative server and waits. When a packet comes back, the resolver has to decide whether it is the answer to its question.

As general background, the resolver checks that the reply matches what it sent: it came back to the right source port, it carries the same transaction ID, and it answers the same question. If those match, the resolver accepts it, caches it for the record's time-to-live and serves it to every client that asks. The real answer, arriving a few milliseconds later, no longer matches an outstanding query and is discarded.

UDP source addresses are trivially forged by anyone whose network does not filter spoofed traffic. So the only things a forger cannot simply copy are the values the resolver chose at random. If the source port is fixed, the only secret is the 16-bit ID.

### Why 16 bits is not enough

CERT's figure for a properly random 16-bit ID is [32,768 attempts on average](https://www.kb.cert.org/vuls/id/800113). That sounds like a lot of packets until you remember that sending tens of thousands of small UDP packets is cheap, and that an attacker does not need to win every race. They need to win once. Once a forged record is in the cache, every client of that resolver gets it until it expires.

CERT doesn't publish the details of the combined technique in the note. What it does say is that attacks against these weaknesses [all rely on an attacker's ability to predictably spoof traffic](https://www.kb.cert.org/vuls/id/800113), and that implementations which send multiple identical queries make it easier still, because each extra outstanding query is another ID the forgery might match.

```diagram
title: what a forger has to guess
flow!: fixed source port -> guess 16-bit ID -> forgery cached
flow: random source port -> guess ID and port -> real answer wins
note: port randomization adds roughly 16 more bits to guess
```

### What source port randomization buys

If the resolver picks a fresh random source port for every query, the forger has to guess both the port and the ID. CERT says randomized ports [gain approximately 16 additional bits](https://www.kb.cert.org/vuls/id/800113) of randomness. Not all 65,535 ports are usable, since low ports may be reserved and others already in use, but randomizing the available ones adds significant resilience. Doing the arithmetic, that turns an average of tens of thousands of guesses into something on the order of a billion or more, which is the difference between a practical attack and an impractical one.

CERT is careful about the limits. Without protocol changes such as DNSSEC, these mitigations [cannot completely prevent cache poisoning](https://www.kb.cert.org/vuls/id/800113). Properly implemented, they reduce an attacker's chances by several orders of magnitude.

### NAT can quietly undo the fix

One warning in the note is easy to miss and very practical. Routers, firewalls and proxies that do Port Address Translation rewrite source ports to track connections. A PAT device [can reduce or eliminate](https://www.kb.cert.org/vuls/id/800113) the improvement gained by patching DNS software. A resolver could be fully patched, carefully randomizing its ports, and sit behind a firewall that mapped every query back to a predictable sequence.

### Some had already fixed it

The vendor statements show the fix was not a new idea. CERT credits Daniel J. Bernstein with [the original idea and implementation](https://www.kb.cert.org/vuls/id/800113) of randomized source ports in a DNS resolver. The PowerDNS statement in the note says its Recursor had randomized source ports since version 3.0, released in April 2006, and also detected "near misses", replies with the wrong ID that signal a spoofing attempt in progress, and dropped the query. Its status in the note is "Not Affected."

## How they fixed it

CERT's first recommendation was to apply vendor patches, which [implement source port randomization](https://www.kb.cert.org/vuls/id/800113) in the nameserver. The note's vendor section links advisories from a long list of vendors; Apple's entry, for example, lists updates for Mac OS X, iPhone and iPod touch. CERT also told administrators to watch for patches to client operating systems, since stub resolvers needed port randomization too.

For anyone who could not patch immediately, CERT listed workarounds ([source](https://www.kb.cert.org/vuls/id/800113)):

- **Restrict access** to recursion so only authorized clients can ask the resolver to look things up.
- **Filter spoofed traffic** at network perimeters, citing RFC 2827, RFC 3704 and RFC 3013, because the attack depends on spoofing source addresses.
- **Run a local DNS cache** close to clients, on client systems and nearby servers.
- **Disable recursion** on any nameserver that answers untrusted systems.

## What changed afterwards

The note points implementers to IETF drafts on making DNS more resilient against forged answers and on port randomization in general, and to NIST SP 800-81 on secure DNS deployment ([source](https://www.kb.cert.org/vuls/id/800113)). The longer-term direction it names is DNSSEC, the protocol change that lets a resolver verify an answer cryptographically rather than by matching guessable numbers. Everything short of that, CERT says, makes attacks impractical rather than impossible.

## The rule

When a protocol has no authentication and accepts the first reply that matches, the match is the security. Count the bits in it honestly: every field a forger has to guess, and every component on the path, such as a NAT, that might make one of those fields predictable again. In 2008, many resolvers turned out to be relying on 16 bits, and a fixed port had quietly thrown away the other 16.

## Sources

- [CERT/CC Vulnerability Note VU#800113, "Multiple DNS implementations vulnerable to cache poisoning"](https://www.kb.cert.org/vuls/id/800113). The official advisory (released 2008-07-08, last revised 2014-04-14): description of the weaknesses, impact, mitigations, vendor statements and acknowledgements.
