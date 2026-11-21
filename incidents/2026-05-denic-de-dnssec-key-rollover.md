---
title: "A key rollover that made three keys instead of one broke DNSSEC for all of .de"
dek: "DENIC's in-house rollover agent was supposed to generate one signing key and load it into every HSM. Instead it generated a different key per HSM, all with the same key tag. Only one of them was published, so only about a third of the zone's signatures could be validated, and validating resolvers stopped resolving .de names for about three hours."
date: 2026-05-05
company: DENIC
kind: outage
topics: [dns, software-bug, monitoring]
stack: [dnssec, knot, hsm]
duration_min: 180
impact: "Access to .de domains was significantly restricted for approximately three hours because validating resolvers rejected the zone's signatures."
rule: "If production runs N copies of something, test with N > 1. Bugs in replication logic cannot show up in an environment with one replica."
postmortem: https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/
sources: [https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/, https://blog.denic.de/en/analysis-of-the-dns-outage-on-5-may-2026/, https://blog.cloudflare.com/de-tld-outage-dnssec/]
---

# A key rollover that made three keys instead of one broke DNSSEC for all of .de

On the evening of 5 May 2026, `.de` names started failing to resolve for a large share of the internet. DENIC, the registry for Germany's country-code top-level domain, was doing a routine DNSSEC key rollover. During it, the `.de` zone started carrying signatures that resolvers could not verify. DENIC says access to `.de` domains was [significantly restricted for approximately three hours](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/).

Cloudflare, which runs the public resolver 1.1.1.1, puts the start at [roughly 19:30 UTC](https://blog.cloudflare.com/de-tld-outage-dnssec/). It calls `.de` one of the largest TLDs on the internet, and says an outage at that level of the DNS hierarchy [has the potential to make millions of domains unreachable](https://blog.cloudflare.com/de-tld-outage-dnssec/).

What makes this one worth studying is that DNSSEC itself did not fail. The cryptography worked exactly as designed. A piece of in-house software made three keys when it should have made one, and the only environment that could have caught that had one HSM.

## What happened

The timeline below combines DENIC's two posts with Cloudflare's view from the resolver side.

- **April 2026.** DENIC puts into operation the [third generation of its DNSSEC signing system](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/) since it introduced DNSSEC in 2011. The system had been tested in advance and externally audited.
- **5 May, ~19:30 UTC.** During a scheduled zone signing key (ZSK) rollover, `.de` starts publishing signatures that fail validation ([Cloudflare](https://blog.cloudflare.com/de-tld-outage-dnssec/)). Validating resolvers begin returning SERVFAIL.
- **Over the next three hours.** On 1.1.1.1, SERVFAILs [climbed steadily over the following three hours](https://blog.cloudflare.com/de-tld-outage-dnssec/) as cached records expired and had to be fetched fresh.
- **Within an hour.** According to Cloudflare, resolver operators across the internet [independently applied Negative Trust Anchors within an hour](https://blog.cloudflare.com/de-tld-outage-dnssec/), turning off validation for `.de`. DENIC also thanks [some operators of large resolvers](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/) for doing this.
- **22:17 UTC.** Cloudflare's mitigation is live, [ending impact for 1.1.1.1](https://blog.cloudflare.com/de-tld-outage-dnssec/).
- **Night of 5 May.** DENIC says normal operations were [fully restored during the night](https://blog.denic.de/en/analysis-of-the-dns-outage-on-5-may-2026/). Neither DENIC post gives an exact recovery time.
- **8 May, 11 May, 11 June.** DENIC publishes an [initial analysis](https://blog.denic.de/en/analysis-of-the-dns-outage-on-5-may-2026/), an addendum correcting it, and a [final report](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/).

## What the engineers believed

The rollover agent's job, in DENIC's words, is to [generate key material and load it into all connected HSMs](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/). The design assumption is in that sentence: one key, many HSMs. A hardware security module keeps the private key inside the hardware, and DENIC's signing system uses [several HSMs, distributed across two data centres](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/) that are separated geographically and in their networks. Several HSMs means any of them can sign, and because they all hold the same key, any signature they produce matches the one public key in the zone.

The rest of the pipeline was built on that assumption. When the new key was ready, the logic that publishes it picked one HSM's key, [assuming all were equal](https://blog.denic.de/en/analysis-of-the-dns-outage-on-5-may-2026/), and wrote it into the zone as the DNSKEY record. Then all the HSMs carried on signing.

There was a second, quieter belief: that the test runs and a "cold" parallel operation before commissioning had exercised the code. They had, but in a test environment that DENIC says [consists of a single HSM at a single location](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/).

## What was actually going on

### The bug

DENIC's final report describes the defect directly. Instead of generating a single key pair and loading it into every HSM, the faulty code [generated a separate key pair for each connected HSM and loaded it into exactly one of them](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/).

That gave three different keys. All three [contained the same identifiers, including the key tag 33834](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/). DENIC's first analysis on 8 May described this as three key pairs generated for the same key tag. Its addendum of 11 May made the point explicit: [there was no keytag collision involved](https://blog.denic.de/en/analysis-of-the-dns-outage-on-5-may-2026/). It wasn't two unrelated keys that happened to share a tag. It was three keys with different contents that the software had labelled identically.

Only one of the three ended up in the zone's DNSKEY record. All three HSMs kept signing. So only signatures made by the HSM holding the published key could be validated, which DENIC estimates as [only about a third of all signatures](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/).

```diagram
title: one key tag, three different keys
flow: one key pair -> loaded into all HSMs -> every RRSIG verifies
flow!: one key per HSM -> one DNSKEY published -> ~1/3 of RRSIGs verify
note: all three keys carried key tag 33834
```

### Why a broken signature on the TLD breaks unsigned domains too

Cloudflare's post explains the chain of trust. The root zone's key is built into resolvers. A parent zone vouches for a child zone with a DS record, which is a hash of the child's key. To validate `example.de`, a resolver checks that the root trusts `.de` and that `.de` trusts `example.de`. As Cloudflare puts it, [a break anywhere in that chain causes validation to fail for everything below it](https://blog.cloudflare.com/de-tld-outage-dnssec/).

You might expect that domains which never turned on DNSSEC would be fine. They weren't, and DENIC explains why. Most answers from a TLD are referrals: "I don't have `example.de`, ask these nameservers." For an unsigned child, the TLD also has to prove that there is *no* DS record for it, otherwise an attacker could strip DNSSEC off a signed domain by deleting its DS. That proof is an NSEC3 record, and it is signed. When the signatures over NSEC3 records failed, validating resolvers classified the delegation as ["bogus"](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/). So [even second-level domains for which DNSSEC is not used at all could not be resolved](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/). Resolvers that don't validate served `.de` without issue.

### Why it flickered

The `.de` zone changes all the time as registrations come in, and every change bumps the serial in the SOA record, which then has to be re-signed. Depending on which HSM signed the latest SOA, it was [partly valid and partly invalid](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/) over the course of the incident. *My interpretation:* this is the same pattern as any load-balanced bug where one replica in N is good. Some checks pass and some don't, which makes the problem harder to recognise than a clean failure.

### Why the monitoring didn't stop it

DENIC can't validate a whole zone file before publishing, because the zone is too large and is updated incrementally. Individual versions [are not available as complete zone files](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/). Instead it runs three different continuously running checking and validation tools against production, looking for things like missing or non-validatable signatures.

They worked. DENIC says [these systems detected the errors as intended](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/), but the notifications were not processed correctly, so nobody intervened in time. The report doesn't say what went wrong with the notifications.

### Why testing didn't catch it

This is the core of the incident. The faulty code came in [during the implementation of improvements](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/), and the existing test scenarios did not cover this case. The bug only appears when more than one HSM is connected. With one HSM, "generate one key per HSM" and "generate one key and copy it to every HSM" do the same thing. So the test runs and the cold parallel run could not have shown the difference.

DENIC also rules things out: [no signs of compromise or attacks](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/), no malfunction in the Knot name server, no malfunction in the HSMs, no classic key-tag collision.

## How it was contained

There are two halves here: what the registry did and what the resolvers did.

DENIC's posts don't give a step-by-step of its own fix, only that operations were fully restored during the night. Its [follow-up measures](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/) include an accelerated procedure to provide a valid zone backup more quickly in an emergency, which suggests recovery took longer than it wanted. That is my reading, not something DENIC says.

On the resolver side, Cloudflare describes two mechanisms that cushioned the impact.

**Serve stale.** 1.1.1.1 implements [RFC 8767](https://blog.cloudflare.com/de-tld-outage-dnssec/), which allows a resolver to keep serving an expired cached record when it can't get a fresh one. Records cached before 19:30 UTC kept working. That's why Cloudflare's SERVFAIL rate climbed gradually instead of jumping. Each domain failed only once its cache entry was too old.

**Negative Trust Anchors.** [RFC 7646](https://blog.cloudflare.com/de-tld-outage-dnssec/) lets a resolver treat a specific zone as unsigned, and Cloudflare notes that the RFC names TLD misconfiguration as the primary use case. Cloudflare's resolver has no native NTA mechanism, so it used an existing override rule to mark `.de` as insecure, on 1.1.1.1 and on its internal resolver for CDN origin lookups. It was explicit about the trade-off: without validation, `.de` is open to genuine spoofing for that period. One line from its incident room: ["There is no user of 1.1.1.1 resolving a .de name right now who would prefer a SERVFAIL over an unvalidated response."](https://blog.cloudflare.com/de-tld-outage-dnssec/)

Cloudflare also found a bug of its own. Some resolvers returned Extended DNS Error 6, "DNSSEC Bogus", pointing at the bad signature with keytag 33834. 1.1.1.1 returned EDE 22, "No Reachable Authority", because the bogus-signature code [is never inserted into the response](https://blog.cloudflare.com/de-tld-outage-dnssec/). Anyone debugging through 1.1.1.1 was told it was a connectivity problem when it was really a signature problem. Cloudflare says it will fix this.

## What changed afterwards

From DENIC's [final report](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/):

- **Code review.** Improvements to the code review process have already been implemented.
- **Enhanced alerting.** More alerts and metrics, including on the output of the continuously running validation tools, which had caught the problem.
- **Accelerated switchover.** A faster procedure for putting a valid zone backup in place.
- **Partial validation before deployment.** Some validation of the zone before it is published, as a substitute for the full-zone check that isn't possible.
- **No more ZSK rollovers for now.** Further rollovers are suspended until the development process is hardened and the test environment gives higher test coverage.
- **External review.** An external security and process analysis.

The incident response process and outage communication are also being reviewed.

## The rule

The bug lived in the difference between "one" and "many", and the test environment only had one. That's a general trap. Replication code, fan-out code, and anything that runs "for each node" behave identically for N = 1 whether they are right or wrong. If production has three HSMs, two data centres or five replicas, the test rig needs at least two of each, or the most important property of the code is never exercised.

The second lesson is about detection. DENIC had three independent validators watching production, and all three saw the problem. A monitor that fires into a channel nobody acts on gives you the cost of monitoring and none of the benefit. For anything that can take down a whole TLD, the alert path should be tested end to end, not just the check.

## Sources

- [DENIC, "Final Report: DNS Outage of 5 May 2026", 11 June 2026](https://blog.denic.de/en/final-report-dns-outage-of-5-may-2026/): DENIC's final postmortem, covering the rollover agent bug, the single-HSM test environment, NSEC3 impact, the unprocessed alerts, ruled-out causes and follow-up measures.
- [DENIC, "Analysis of the DNS outage on 5 May 2026", 8 May 2026 with 11 May addendum](https://blog.denic.de/en/analysis-of-the-dns-outage-on-5-may-2026/): the initial analysis, including the addendum clarifying that there was no key-tag collision and that one key was picked "assuming all were equal".
- [Cloudflare, "When DNSSEC goes wrong: how we responded to the .de TLD outage"](https://blog.cloudflare.com/de-tld-outage-dnssec/): the resolver-side view, with the 19:30 UTC start, serve stale, the Negative Trust Anchor at 22:17 UTC, and the EDE reporting bug in 1.1.1.1.
