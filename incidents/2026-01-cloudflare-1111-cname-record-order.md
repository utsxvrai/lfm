---
title: "A memory optimisation moved CNAMEs to the bottom of 1.1.1.1's answers and broke DNS clients"
dek: "To save an allocation, Cloudflare's resolver started appending cached CNAME records after the freshly resolved A/AAAA records instead of before them. Most clients didn't care. glibc's getaddrinfo did, and so did three models of Cisco switch, which went into reboot loops."
date: 2026-01-08
company: Cloudflare
kind: bug
topics: [dns, software-bug, deploy]
stack: [dns, 1.1.1.1, rust, glibc]
impact: "A routine update to 1.1.1.1 triggered a wave of DNS resolution failures for clients that expect CNAME records first, including glibc getaddrinfo; some Cisco switches using 1.1.1.1 went into reboot loops."
rule: "If you have never changed an observable behaviour, assume someone depends on it, and pin it with a test even when the spec doesn't require it."
postmortem: https://blog.cloudflare.com/cname-a-record-order-dns-standards/
sources: [https://blog.cloudflare.com/cname-a-record-order-dns-standards/, https://infoq.com/news/2026/02/cname-rfc-cloudflare-outage, https://www.ietf.org/archive/id/draft-jabley-dnsop-ordered-answer-section-00.txt]
---

# A memory optimisation moved CNAMEs to the bottom of 1.1.1.1's answers and broke DNS clients

On 8 January 2026, Cloudflare's public DNS resolver 1.1.1.1 started returning answers that some clients could not read. Cloudflare's postmortem describes it as [a routine update aimed at reducing memory usage](https://blog.cloudflare.com/cname-a-record-order-dns-standards/) that "accidentally triggered a wave of DNS resolution failures for users across the Internet".

Nothing was down. 1.1.1.1 kept answering, and the answers contained the right records. What changed was the **order** of those records. When a name was an alias (a CNAME), the resolver sometimes put the alias after the final IP address instead of before it. Linux machines using glibc's `getaddrinfo` treated those answers as empty. Three models of Cisco ethernet switch configured to use 1.1.1.1 went into [spontaneous reboot loops](https://blog.cloudflare.com/cname-a-record-order-dns-standards/).

It's a small bug with a long tail. The question it raised, whether DNS says CNAMEs must come first, turned out not to have a clean answer in a standard published in 1987.

## What happened

From the [postmortem's timeline](https://blog.cloudflare.com/cname-a-record-order-dns-standards/), all times UTC:

- **2025-12-02.** The record reordering is introduced into the 1.1.1.1 codebase.
- **2025-12-10.** The change is released to Cloudflare's testing environment.
- **2026-01-07 23:48.** A global release containing the change starts.
- **2026-01-08 17:40.** The release reaches 90% of servers.
- **18:19.** Incident declared.
- **18:27.** The release is reverted.
- **19:55.** Revert completed. Impact ends.

Two things stand out in that list. The change sat in the testing environment for weeks without anyone noticing. And the global release was already at 90% of servers before the incident was declared. The postmortem doesn't say how the problem was detected, and doesn't put a number on how many users or queries were affected, so neither does this post.

## What the engineers believed

The belief is in the code comments. The original merge code was annotated `// CNAMEs first` and `// Then A/AAAA records`. The new code was annotated `// CNAMEs last`. Whoever made the change knew the order was changing. The assumption was that it **didn't matter**.

That's a defensible reading of DNS. Cloudflare says [most modern software treats the order of records in DNS responses as irrelevant](https://blog.cloudflare.com/cname-a-record-order-dns-standards/). RFC 1034 says of record sets that "the order of RRs in a set is not significant", and its worked example says "the difference in ordering of the RRs in the answer section is not significant" (both quoted in the postmortem). If order isn't significant, a change that only reorders is a pure refactor.

Cloudflare also notes something about its own tests: it had originally implemented CNAMEs-first, but [did not have any tests asserting the behavior remains consistent](https://blog.cloudflare.com/cname-a-record-order-dns-standards/), because the RFC language was ambiguous. Nothing failed in CI because nothing was checking.

## What was actually going on

### How a resolver builds an answer from a partly expired cache

When you look up `www.example.com`, you may get a chain of aliases before you get an address. The postmortem's example:

```
www.example.com → cdn.example.com → server.cdn-provider.com → 198.51.100.1
```

A recursive resolver like 1.1.1.1 follows that chain for you and caches every step. Each record has its own TTL, so part of the chain can expire while the rest is still cached. Cloudflare calls this a [partially expired](https://blog.cloudflare.com/cname-a-record-order-dns-standards/) chain. Instead of resolving everything again, the resolver keeps the still-valid CNAMEs, resolves only the expired part (say the final A record), and merges the two into one response.

The merge is where the change happened. The old code, from the postmortem:

```rust
let mut answer_rrs = Vec::with_capacity(entry.answer.len() + self.records.len());
answer_rrs.extend_from_slice(&self.records); // CNAMEs first
answer_rrs.extend_from_slice(&entry.answer); // Then A/AAAA records
entry.answer = answer_rrs;
```

The new code, written [to save some memory allocations and copies](https://blog.cloudflare.com/cname-a-record-order-dns-standards/):

```rust
entry.answer.extend(self.records); // CNAMEs last
```

The new version skips allocating a fresh vector and copying both lists into it, which is a real saving on a resolver's hot path. But it appends the cached CNAME chain onto the end of the freshly resolved answer, so the address now comes first and the alias that explains it comes after.

### Why order mattered to some clients

A client receiving a CNAME chain has to follow it too, to work out that `www.example.com` really means `198.51.100.1`. One way to do that is to walk the answer section top to bottom, tracking the name you expect next:

1. Look for records for `www.example.com`.
2. See `www.example.com CNAME cdn.example.com`, so now expect `cdn.example.com`.
3. See `cdn.example.com A 198.51.100.1`, which matches. Done.

Reverse the order and the same loop fails. It sees `cdn.example.com A ...` first, discards it because it's still looking for `www.example.com`, then finds the CNAME, updates the expected name, and runs out of records. The answer is treated as empty.

```diagram
title: same records, different order
flow: www CNAME cdn -> cdn A 198.51.100.1 -> address found
flow!: cdn A 198.51.100.1 -> www CNAME cdn -> empty answer
note: a single pass that tracks the expected name only works top-down
```

That's what glibc does. The postmortem quotes `getanswer_r`, the code behind `getaddrinfo`: it loops over the answer records once, and on a CNAME it sets `expected_name` to the target. An address record is kept only if its owner name matches `expected_name` at that moment. glibc is the C library on most Linux systems, so this is the resolution path for a very large amount of software.

The Cisco switches failed differently. Cloudflare says the DNSC process in [three models of Cisco ethernet switches](https://blog.cloudflare.com/cname-a-record-order-dns-standards/) rebooted when it received a reordered response. Cisco published a service document on it, which the postmortem links. (I couldn't fetch it; Cisco's site refused automated access, so the switch details here come only from Cloudflare.)

Other clients were fine. systemd-resolved, for example, first [parses the records into an ordered set](https://blog.cloudflare.com/cname-a-record-order-dns-standards/) and can search the whole answer when following a CNAME, regardless of where it sits.

### What the RFC actually says

The interesting part of the postmortem is that the RFC doesn't settle the question. RFC 1034 section 4.3.1 says a recursive response is "the answer to the query, possibly preface[d] by one or more CNAME RRs". "Preface" suggests CNAMEs go first. But the RFC [does not use normative key words such as MUST and SHOULD](https://blog.cloudflare.com/cname-a-record-order-dns-standards/), because those were standardised in RFC 2119 in 1997, ten years later.

The "order is not significant" lines are about something narrower than they look. They apply to an **RRset**, the records sharing one name, type and class, such as two A records for the same host. A CNAME for `www` and an A record for `cdn` are different RRsets, and RFC 1034 doesn't say how different RRsets in the same section should be ordered relative to each other. Cloudflare also points out that even CNAMEs-first isn't enough for a sequential parser: if the chain itself is out of order (`cdn → server` listed before `www → cdn`), the same loop fails.

There's also a split between kinds of resolver. RFC 1034 section 5.2.2 says a resolver "simply restarts the query at the new name when it encounters a CNAME", which would make order irrelevant. But that section was written mostly with full recursive resolvers in mind. Stub resolvers like glibc's are simpler, and the postmortem notes that some [evidently don't implement](https://blog.cloudflare.com/cname-a-record-order-dns-standards/) the CNAME-restart logic.

My reading: both sides were following a reasonable interpretation. glibc relied on the "preface" wording and on every resolver it had ever met putting CNAMEs first. Cloudflare relied on "order is not significant". The bug lived in the gap between the two, and it stayed hidden for as long as every big resolver happened to behave the same way.

## How they fixed it

They reverted. The rollback started at [18:27 UTC and completed at 19:55](https://blog.cloudflare.com/cname-a-record-order-dns-standards/). There was nothing to repair on the client side, since the clients went back to receiving the order they had always received.

## What changed afterwards

Cloudflare decided the ambiguity should be resolved in favour of the clients. In its interpretation the RFCs don't require any particular order, but because some widely deployed clients rely on it and [might be updated infrequently, or never updated at all](https://blog.cloudflare.com/cname-a-record-order-dns-standards/), it will require CNAME records to appear in order before any other records. It says it does not intend to change the order again.

It also took the question to the IETF. J. Abley and Sebastiaan Neuteboom (the postmortem's author), listed with Cloudflare as affiliation, submitted an Internet-Draft, [Ordering of RRSets in DNS Message Sections](https://www.ietf.org/archive/id/draft-jabley-dnsop-ordered-answer-section-00.txt), dated 14 January 2026. It would update RFC 1034 and 1035 to say the answer section "MUST be considered to be an ordered set of RRSets", that new RRsets "MUST be appended" as the response is built, and that a receiver "MAY refuse to process" messages built differently. Other sections stay unordered. The abstract describes the aim as a clearer specification "consistent with deployed implementations", which is to say, write down what everyone already does.

The incident drew a lot of discussion. [InfoQ's write-up](https://infoq.com/news/2026/02/cname-rfc-cloudflare-outage) quotes a Hacker News commenter calling it "a great example of Hyrum's Law", the observation that with enough users, every observable behaviour of a system will be depended on by somebody, whatever the contract says.

## The rule

Hyrum's Law is the right frame. Cloudflare had originally implemented CNAMEs-first, and clients had only ever seen that order from it, so CNAMEs-first was part of its real interface, whatever RFC 1034 promised. A change that only reorders output is not a refactor when the output goes to millions of clients you don't control.

Two practical takeaways (my interpretation, not Cloudflare's wording):

- **Pin observable behaviour you never meant to promise.** Cloudflare had implemented CNAMEs-first and had no test asserting it. A one-line test on response order would have turned this memory optimisation into a failing build.
- **Test against the clients, not just the spec.** Running real stub resolvers (glibc, embedded network stacks) against a staging resolver catches what a spec-reading test can't, because the spec was the thing that was ambiguous.

## Sources

- [Sebastiaan Neuteboom, "What came first: the CNAME or the A record?", Cloudflare blog, 14 January 2026](https://blog.cloudflare.com/cname-a-record-order-dns-standards/): Cloudflare's postmortem, covering the timeline, the cache-merge code change, glibc's `getanswer_r`, the Cisco switch reboots, the RFC 1034 analysis and the decision to keep CNAMEs first.
- [Renato Losio, "How CNAME Ordering in RFC Specs Caused Cloudflare 1.1.1.1 Outage", InfoQ, 7 February 2026](https://infoq.com/news/2026/02/cname-rfc-cloudflare-outage): secondary summary, with community reaction including the Hyrum's Law comment.
- [J. Abley and S. Neuteboom, "Ordering of RRSets in DNS Message Sections", draft-jabley-dnsop-ordered-answer-section-00, IETF, 14 January 2026](https://www.ietf.org/archive/id/draft-jabley-dnsop-ordered-answer-section-00.txt): the Internet-Draft Cloudflare proposed after the incident.
