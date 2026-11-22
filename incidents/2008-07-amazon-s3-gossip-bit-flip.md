---
title: "A single flipped bit in a few gossip messages took Amazon S3 down for most of a day"
dek: "S3 checksummed customer data everywhere but not the internal state its servers gossiped to each other. A handful of messages with one bit corrupted still parsed, spread through the fleet, and left servers doing almost nothing but gossiping."
belief: "Amazon S3 checksummed customer data but not internal gossip. One flipped bit spread and took S3 down."
date: 2008-07-20
company: Amazon
kind: outage
topics: [storage, cascading-failure]
stack: [s3, aws, gossip-protocol, md5]
impact: "From 8:40am PDT error rates climbed in all S3 datacenters; very few requests succeeded until the EU location recovered at 2:57pm and the US location at 4:02pm PDT."
detected_by: alert
rule: "Checksum every message that can change what a system believes, not just the data customers can see. Corruption that still parses is the kind that spreads."
postmortem: https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html
sources: [https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html]
---

# A single flipped bit in a few gossip messages took Amazon S3 down for most of a day

On Sunday, 20 July 2008, at [8:40am PDT](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html), error rates in every Amazon S3 datacenter began to climb quickly. Ten minutes later, AWS wrote, "very few requests were completing successfully." The EU location didn't complete customer requests again until 2:57pm, and the US location until 4:02pm.

The cause, as AWS explained in its post-event summary, was not a bad deploy, a power failure or a capacity problem. It was [a handful of messages that had a single bit corrupted](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html) in a way that left them still readable but wrong.

That detail is the whole story. Corruption that makes a message unreadable gets dropped. Corruption that leaves a message valid but false gets believed, acted on and passed along.

## What happened

AWS's summary gives the timeline ([source](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html)), all times PDT:

- **8:40am:** Error rates in all S3 datacenters begin to climb quickly and alarms go off.
- **8:50am:** Error rates are significantly elevated; very few requests complete successfully.
- **8:55am:** Multiple engineers are engaged. Alarms point at problems processing requests in multiple places across multiple datacenters. The team tries to restore health by reducing system load in several stages, which has no effect.
- **9:41am:** The team determines that S3 servers are having problems communicating with each other.
- **10:32am:** After exploring several options, the team decides to shut down all communication between S3 servers, shut down all request-processing components, clear the system's state and then reactivate.
- **11:05am:** All server-to-server communication is stopped, request processing is shut down, and the system state is cleared.
- **2:20pm:** Internal communication between all S3 servers is restored and request processing is reactivated in the US and EU concurrently.
- **2:57pm:** The EU location begins completing customer requests. It came back first because it has fewer servers. Rates are normal by 3:10pm.
- **4:02pm:** The US location begins completing customer requests. Rates are normal by 4:58pm.

AWS noted that it [hadn't encountered server-to-server communication issues of this scale before](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html), and that this was why diagnosis and recovery took time.

## What the engineers believed

The summary is candid about where checksums were and weren't. S3 used [MD5 checksums throughout the system](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html) to prevent, detect and recover from corruption during receipt, storage and retrieval of customers' objects. But, AWS wrote, "we didn't have the same protection in place to detect whether this particular internal state information had been corrupted."

That's a reasonable place to have ended up. Customer data is the product, and corruption there is the obvious nightmare, so that's where integrity checks go first. Internal state messages between your own servers, on your own network, feel like a lower-risk channel. The implicit belief is that if a control message is damaged in transit, it will either fail to parse or be harmless.

The first response on the day reflects a different, also reasonable, belief: that the errors were a load problem. The team [reduced system load in several stages](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html), and it had no impact.

## What was actually going on

### What gossip is for

S3 used a gossip protocol to [spread server state information quickly throughout the system](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html), which lets it route around failed or unreachable servers.

In general terms, a gossip protocol works like rumour-spreading. There is no central registry of which servers are alive. Instead, each server keeps its own view of the cluster, and when two servers talk they exchange views and merge them. A fact learned by one server reaches every server in a small number of rounds, because each round roughly doubles the number of servers that know it. That is exactly why gossip is popular for membership and failure detection in large fleets: it is fast, has no single point of failure, and keeps working as servers come and go.

S3 had one more property that turned out to matter. AWS explained that when one server connects to another while processing a customer's request, [it starts by gossiping about the system state](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html), and only after the gossip completes does it send the information for the customer request. Gossip was in the request path.

### What one bit did

A few messages had one bit flipped. They were still well-formed, so receiving servers accepted them and merged the incorrect state into their own view. From there the gossip protocol did what it was designed to do: it spread that state to everyone, quickly.

The summary describes the result: [a large number of servers spending almost all of their time gossiping](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html), and a disproportionate number failing while gossiping. Because every request began with a gossip exchange, servers stuck in gossip could not get to the customer's request. Hence the errors in every datacenter at once.

AWS doesn't say exactly which field was corrupted. One of its follow-up actions was a change to [how S3 gossips about failed servers](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html) to reduce the amount of gossip. Reading between the lines, and this is interpretation, the corrupted state plausibly concerned server failures, and the reaction to it generated more gossip, which kept servers busy and failing, which generated more gossip.

```diagram
title: why the corruption spread
flow!: one bit flips -> message still parses -> bad state gossiped
flow: checksum on state -> mismatch found -> message rejected
note: S3 had checksums on customer objects, not on internal state
```

### Why reducing load didn't help, and the whole fleet had to stop

Reducing load treats the symptom, servers too busy to serve, and the cause wasn't load from customers. The servers were busy talking to each other about state that was wrong.

The fix AWS chose explains a lot about gossip. The team [shut down all communication between S3 servers](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html) and cleared the system's state before restarting. The summary doesn't spell out why partial measures wouldn't do, but the mechanism suggests it: in an epidemic-style protocol, any server that still holds the bad state will hand it to the next server it talks to. Restarting servers one at a time just lets them be reinfected by their neighbours. The only way to be sure the bad state is gone is to stop everyone talking, clear everyone's state, and let correct state rebuild from scratch.

That rebuild is why recovery took hours after the shutdown at 11:05am. Internal communication was back at 2:20pm, but request processing came back gradually. The EU, [with fewer servers](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html), recovered almost an hour before the US.

## How they fixed it

On the day, the fix was the full stop described above: stop all server-to-server communication, shut down request processing, clear the system's state, restore communication, and reactivate request processing in both regions.

## What changed afterwards

AWS listed four actions ([source](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html)):

1. Changes that significantly reduce the time needed to completely restore system-wide state and restart request processing. The recovery procedure itself was the slow part, so they made it faster.
2. A change to how S3 gossips about failed servers that reduces the amount of gossip and helps prevent the behaviour seen that day.
3. Additional monitoring and alarming on gossip rates and failures. On the day, alarms pointed at request processing everywhere; it took an hour to see that the problem was servers failing to communicate.
4. Checksums to proactively detect corruption of system state messages, so such messages can be logged and rejected.

The fourth item is the direct fix. A corrupted state message becomes a rejected message instead of a believed one.

## The rule

Integrity checks belong on every message that can change what a system believes, not only on the data your customers can see. Internal control traffic is often more dangerous to corrupt than user data, because it is replicated by design: a gossip protocol is built to make one server's beliefs everyone's beliefs as fast as possible. If the belief is wrong and still parses, the protocol will spread it faithfully. Checksum it, and reject what fails.

## Sources

- [Amazon S3 Availability Event: July 20, 2008, AWS Service Health Dashboard (via the Internet Archive)](https://web.archive.org/web/2008/http://status.aws.amazon.com/s3-20080720.html). AWS's post-event summary: timeline, the gossip-protocol explanation, the single-bit corruption, and the four follow-up actions.
