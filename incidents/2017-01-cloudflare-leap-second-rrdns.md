---
title: "The 2016 leap second made time go backwards inside Cloudflare's DNS"
dek: "A Go service measured resolver latency with time.Now(), which isn't monotonic. At midnight UTC a duration came out negative, a smoothed average went below zero, and rand.Int63n panicked."
date: 2017-01-01
company: Cloudflare
kind: outage
topics: [time-handling, dns, software-bug]
stack: [go, dns, rrdns]
impact: "At peak about 0.2% of DNS queries to Cloudflare were affected and less than 1% of all HTTP requests to Cloudflare encountered an error."
rule: "Never measure elapsed time with a wall clock: use a monotonic source and treat a negative duration as a bug to clamp."
postmortem: https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/
sources: [https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/]
---

# The 2016 leap second made time go backwards inside Cloudflare's DNS

At midnight UTC on New Year's Day 2017, a leap second was added to the world's clocks. Inside Cloudflare's custom DNS server, RRDNS, "a number went negative when it should always have been, at worst, zero" ([Cloudflare](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/)). A little later that negative number made RRDNS panic, and some DNS resolutions for Cloudflare-hosted sites failed.

The blast radius was small but real. Only customers using CNAME records were affected, and only on a small number of machines across Cloudflare's [102 data centers](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/). At peak, [approximately 0.2% of DNS queries](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/) to Cloudflare were affected and less than 1% of all HTTP requests hit an error. The timeline puts impact from [00:00 UTC to 06:45 UTC](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/).

This is a good example of a bug that sits in plain sight for years. The code was correct for every second that has ever existed, except the ones that get inserted.

## What happened

Cloudflare's customers tell it where their origin servers are in one of two ways: an A record with an IP address, or a CNAME that points to another hostname, for example a Heroku app. For CNAMEs, Cloudflare occasionally has to resolve that other hostname to an IP, using ordinary recursive DNS through internal resolvers that Cloudflare operates. Cloudflare runs several per data center for redundancy, and RRDNS chooses between them with a weighted selection that favours the best performers ([Cloudflare](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/)).

The bug was in that CNAME lookup path. During the leap second, some lookups recorded a negative value in the data structure tracking resolver performance. Later, the weighted selection code read that negative number and panicked. The panic was caught with Go's `recover`, so the process survived, but the lookup failed.

## What the engineers believed

Cloudflare names the belief directly: the root cause was "the belief that time cannot go backwards." Specifically, some code assumed that the difference between two times could never be less than zero ([Cloudflare](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/)).

That's a very reasonable thing to believe. If you read the clock, do some work, and read it again, the second reading feels like it has to be later. Almost all timing code in the world is written this way. It's also wrong whenever the clock you're reading is a *wall clock*.

## What was actually going on

### Wall clocks are not stopwatches

A computer exposes two kinds of time:

- **Wall-clock time** answers "what time is it?" It's meant to match UTC, so it gets *adjusted*: NTP corrections, manual changes, VM migrations, and leap seconds. Adjustments can move it backwards.
- **Monotonic time** answers "how much time has passed?" It counts from an arbitrary starting point, only ever moves forward, and has no meaning as a date.

A leap second inserts an extra second (23:59:60) at the end of a UTC day. Many systems implement it by repeating a second, so for a moment the wall clock reads a value it has already shown. Any duration computed as "wall clock now minus wall clock earlier" across that moment can come out up to a second smaller than the real elapsed time, and negative if the real elapsed time was under a second.

Per the post, RRDNS used Go's `time.Now()`, which doesn't guarantee monotonicity. At the time, Go didn't offer a monotonic time source; Cloudflare points to Go issue 12914 for that discussion ([Cloudflare](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/)).

### The code

This is the measurement code from the postmortem:

```go
// Update upstream sRTT on UDP queries, penalize it if it fails
if !start.IsZero() {
    rtt := time.Now().Sub(start)
    if success && rcode != dns.RcodeServerFailure {
        s.updateRTT(rtt)
    } else {
        // The penalty should be a multiple of actual timeout
        // as we don't know when the good message was supposed to arrive,
        // but it should not put server to backoff instantly
        s.updateRTT(TimeoutPenalty * s.timeout)
    }
}
```

`rtt` is negative whenever `time.Now()` returns something earlier than `start`. Cloudflare explains why that was likely rather than theoretical: its internal resolvers are tuned to answer in a few milliseconds, so if time steps back a second during a lookup, the "measured" round trip is about minus one second.

### Smoothing turned one bad sample into a bad state

One negative sample by itself wouldn't have mattered. RRDNS keeps a **smoothed** RTT (the `sRTT` in the comment), a running average built from many measurements, so that one slow or fast reply doesn't swing the choice of resolver. Cloudflare writes that a single measurement wouldn't make RRDNS think a resolver worked in negative time, but that after a few measurements the smoothed value would eventually become negative ([Cloudflare](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/)).

This is the subtle part. Smoothing is meant to *protect* against outliers, but an average of normal-sized positives (a few milliseconds) and a few huge negatives (about minus a second) is dominated by the negatives. Once that state was stored, it stayed bad on every later query until the average recovered, not just for the one second when the clock stepped back.

### The panic

The bad average then reached the weighted random selection, which passes the resolver time values to Go's `rand.Int63n()`. That function panics if its argument is negative. That's where the RRDNS panics came from ([Cloudflare](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/)).

```diagram
title: one second backwards, hours of errors
flow: time.Now() steps back -> rtt is negative -> sRTT goes negative
flow!: weighted select -> rand.Int63n(neg) -> panic
note: the stored average outlives the leap second
```

Notice how far the cause is from the failure. The clock event is in timing code. The bad value sits in a performance-tracking structure. The crash happens in a random-number call in selection logic, which is a perfectly reasonable place to assume a weight is non-negative. No single function was obviously wrong when read on its own.

## How they fixed it

Cloudflare's patch made RRDNS forget its current upstream performance data and normalise again whenever time skipped backwards. That stops negative numbers reaching server selection. The fix stops negative values being recorded in server selection, and restarting all the RRDNS servers cleared any stored bad state ([Cloudflare](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/)).

The rollout followed a canary-first pattern. From the published timeline (all UTC, 2017-01-01):

| Time | Event |
| --- | --- |
| 00:00 | Impact starts |
| 00:10 | Escalated to engineers |
| 00:34 | Issue confirmed |
| 00:55 | Mitigation deployed to one canary node and confirmed |
| 01:03 | Mitigation deployed to canary data center and confirmed |
| 01:23 | Fix deployed in most impacted data center |
| 01:45 | Fix being deployed to major data centers |
| 01:48 | Fix being deployed everywhere |
| 02:50 | Fix rolled out to most of the affected data centers |
| 06:45 | Impact ends |

All rows from [Cloudflare's timeline](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/). The post's summary says the most affected machines were patched in [90 minutes](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/), with locations ordered by error count so the worst were fixed first.

## What changed afterwards

Cloudflare said it was inspecting all its code for any other uses of time intervals that a leap second could break ([Cloudflare](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/)). It also gives the general precaution: with a non-monotonic clock, always check whether the difference between two timestamps is negative, because if it is, you can't know the real elapsed time until the clock stops rewinding.

Some general background beyond the postmortem: later Go releases changed `time.Now()` to carry a monotonic clock reading, used by `Sub` when both values have one. The same trap still exists in any language whose "now" is the wall clock. In Node, that means `Date.now()` versus `performance.now()` or `process.hrtime.bigint()`. In Python, `time.time()` versus `time.monotonic()`. In Java, `System.currentTimeMillis()` versus `System.nanoTime()`.

Two habits fall out of this incident:

1. **Measure durations with a monotonic clock**, always. Wall-clock time is for timestamps people read.
2. **Validate at the boundary where the assumption lives.** The weighted selector assumed non-negative weights. A clamp or assertion right there would have turned a panic into a slightly wrong choice of resolver.

## The rule

Never measure elapsed time with a wall clock: use a monotonic source and treat a negative duration as a bug to clamp.

## Sources

- [How and why the leap second affected Cloudflare DNS](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/): Cloudflare's postmortem, published January 1, 2017. It is the source for the code excerpt, the timeline, the impact percentages, and the description of RRDNS, smoothing and `rand.Int63n`.
