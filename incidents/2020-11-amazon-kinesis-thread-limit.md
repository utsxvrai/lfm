---
title: "Adding servers to Kinesis pushed every server past its OS thread limit"
dek: "Each Kinesis front-end server kept one OS thread per peer in the fleet. A small capacity addition pushed every server over an operating-system thread limit, shard-map caches stopped building, and Cognito, CloudWatch, Lambda and EventBridge went down with Kinesis."
date: 2020-11-25
company: Amazon
kind: outage
topics: [capacity, cascading-failure, dependency]
stack: [kinesis, cognito, cloudwatch, lambda, linux]
impact: "Kinesis in us-east-1 had elevated errors from the first alarms at 5:15 AM PST until it fully returned to normal at 10:23 PM PST; Cognito, CloudWatch, Lambda, EventBridge, ECS and EKS were also affected."
detected_by: alert
rule: "If each node holds a resource per peer, total usage grows with the square of fleet size. Know where that curve hits a hard limit before you add capacity, and alarm well below it."
postmortem: https://aws.amazon.com/message/11201/
sources: [https://aws.amazon.com/message/11201/]
---

# Adding servers to Kinesis pushed every server past its OS thread limit

On 25 November 2020, Amazon Kinesis in the Northern Virginia (us-east-1) region failed from early morning until late at night, Pacific time. The trigger was [a relatively small addition of capacity](https://aws.amazon.com/message/11201/) to the Kinesis front-end fleet, between 2:44 AM and 3:47 AM PST. The first alarms fired at 5:15 AM. Kinesis was [fully returned to normal at 10:23 PM PST](https://aws.amazon.com/message/11201/).

Kinesis isn't only a customer product. Other AWS services use it internally, so Cognito logins failed, CloudWatch metrics and alarms went blank, Lambda invocations errored, and EventBridge, ECS and EKS were degraded. AWS couldn't update its own status page at first, because the tool it uses to post there runs on Cognito.

AWS is careful to call the capacity addition the trigger and ["not root cause"](https://aws.amazon.com/message/11201/). The root cause was a design where each server's resource use grew with the size of the whole fleet.

## What happened

Kinesis has [a large number of "back-end" cell-clusters](https://aws.amazon.com/message/11201/) that store and process stream shards, and a "front-end" fleet that handles authentication, throttling and routing each request to the right back-end cluster. To route, each front-end server keeps a cache called the **shard-map**: which back-end cluster owns which shard.

The timeline from the [AWS summary](https://aws.amazon.com/message/11201/) (all PST):

- **2:44 to 3:47 AM:** new capacity added to the front-end fleet.
- **5:15 AM:** first alarms for errors putting and getting Kinesis records. CloudWatch and EventBridge errors start the same minute.
- **Morning:** the new capacity is a suspect, but many errors look unrelated to it. As a precaution, the team starts removing it.
- **7:51 AM:** root cause narrowed to a couple of candidates, all needing a full restart of the front-end fleet. The leading candidate is memory pressure.
- **9:39 AM:** root cause confirmed: an operating-system thread limit, not memory.
- **10:07 AM:** first restarted front-end servers take traffic.
- **From noon:** error rate steadily dropping.
- **10:23 PM:** Kinesis fully back to normal.

## What the engineers believed

Adding servers to a fleet is supposed to add headroom. It's the first thing you reach for when load is high and usually the safest change you can make. This addition was small.

During the incident, the team's leading theory was [an issue that seemed to be creating memory pressure](https://aws.amazon.com/message/11201/). That's a reasonable guess for a fleet whose caches suddenly stop working. The diagnosis was slowed because [errors in all aspects of the various calls](https://aws.amazon.com/message/11201/) made it hard to tell side-effects from the cause.

## What was actually going on

### One thread per peer

Each front-end server builds its shard-map from three inputs: a membership microservice, configuration in DynamoDB, and [continuous processing of messages from other Kinesis front-end servers](https://aws.amazon.com/message/11201/). For that last part, AWS says, each front-end server [creates operating system threads for each of the other servers in the front-end fleet](https://aws.amazon.com/message/11201/).

So with N servers in the fleet, each server runs about N−1 threads just for peer communication, and the fleet as a whole runs about N×(N−1). Add k servers and **every existing server** needs k more threads. The new servers each need N+k−1. AWS states the proportionality directly: [the total threads each server must maintain is directly proportional to the number of servers in the fleet](https://aws.amazon.com/message/11201/).

*Background:* operating systems cap the number of threads, through per-user process limits, a system-wide maximum, and the memory each thread's stack needs. AWS doesn't say which limit was hit, only that it was ["the maximum number of threads allowed by an operating system configuration"](https://aws.amazon.com/message/11201/).

```diagram
title: why a small addition broke every server
flow: N servers -> N-1 threads each -> under OS limit
flow!: N + k servers -> N+k-1 threads each -> over limit on all
note: one fleet-wide number, checked on every host
```

That's what makes this failure so wide. The limit wasn't hit by one unlucky server. Every server's thread count is the same function of fleet size, so all of them crossed the limit together.

### A slow fuse

New members aren't discovered instantly. AWS says [it takes up to an hour](https://aws.amazon.com/message/11201/) for an existing front-end server to learn of new participants. AWS doesn't connect the two explicitly, but that lag fits the gap between the capacity addition finishing at 3:47 AM and the first alarms at 5:15. Existing servers kept discovering the new peers and creating threads until they hit the ceiling.

### What hitting the limit did

The process didn't crash cleanly. AWS writes that [cache construction was failing to complete and front-end servers were ending up with useless shard-maps](https://aws.amazon.com/message/11201/), leaving them unable to route to the back-end clusters. A front-end server with a broken shard-map is still up and accepting requests. It just can't do anything with them.

### Why recovery was slow

A fix needed a restart of every front-end server, and the fleet [is composed of many thousands of servers](https://aws.amazon.com/message/11201/). Restarting fast wasn't possible: building the shard-map competes for the same resources as serving requests, so servers brought back too quickly would be slow, [could be deemed unhealthy and removed from the fleet](https://aws.amazon.com/message/11201/), and set recovery back. AWS could only add servers [at the rate of a few hundred per hour](https://aws.amazon.com/message/11201/).

The team also didn't want to raise the OS thread limit without testing. Since the new capacity had already been removed, they reasoned the thread count would fit under the existing limit, and restarted with that.

To speed restarts, they changed the bootstrap to read directly from the authoritative metadata store instead of [from front-end server neighbors](https://aws.amazon.com/message/11201/).

### How it spread

| Service | Why Kinesis hurt it, per AWS |
| --- | --- |
| Cognito | Streams API access data to Kinesis as best effort with a local buffer; a latent bug made webservers block on full buffers, so users couldn't authenticate. Normal by 2:18 PM. |
| CloudWatch | Uses Kinesis to process metrics and logs; most metrics weren't processed and alarms went to `INSUFFICIENT_DATA`. Full recovery 10:31 PM. |
| Lambda | Invocations publish metrics to CloudWatch; buffered metrics caused memory contention on hosts. Mitigated 10:36 AM. |
| EventBridge, ECS, EKS | EventBridge delayed events; ECS and EKS use it for cluster workflows. Mostly resolved by 4:15 PM. |
| AutoScaling | Reactive policies depend on CloudWatch metrics; delayed until 5:47 PM. |

Cognito is the instructive one. The Kinesis dependency was [designed to be best effort](https://aws.amazon.com/message/11201/), but a prolonged outage exposed a bug that made the best-effort path block the main one.

## How they fixed it

They removed the new capacity, confirmed the thread-limit cause, and restarted the front-end fleet gradually from 10:07 AM. Cognito shipped a change to reduce its Kinesis dependency (deploying from 10:15 AM), and Lambda engineers relieved host memory contention.

## What changed afterwards

For Kinesis, [AWS committed to](https://aws.amazon.com/message/11201/):

- **Larger servers, fewer of them.** Fewer servers means fewer peer threads on each one. This attacks the N directly.
- **Fine-grained alarms on thread consumption.**
- **Testing a higher OS thread limit** for more safety margin.
- **Faster cold starts**, and moving the front-end cache to a dedicated fleet.
- **A separate, partitioned front-end fleet** for large AWS services such as CloudWatch.
- **Cellularizing the front-end**, as the back-end already was, to keep each cell [within a previously tested and operated range](https://aws.amazon.com/message/11201/). This work was already under way but unfinished.

Cognito's webservers were changed to [sustain Kinesis API errors without exhausting their buffers](https://aws.amazon.com/message/11201/). CloudWatch began keeping 3 hours of metric data in a local store. AWS also retrained support staff on the backup tool for posting to the Service Health Dashboard.

## The rule

Any design where each node holds something per peer (threads, connections, sockets, heartbeats) has a resource cost that grows with fleet size on every node at once. Write down the hard limit that curve runs into, alarm on the per-node count long before it, and treat "add capacity" as a change that can cross that limit. Cells are the structural fix: cap N per cell, and the per-node cost stays inside a range you've already tested.

## Sources

- [AWS, "Summary of the Amazon Kinesis Event in the Northern Virginia (US-EAST-1) Region"](https://aws.amazon.com/message/11201/): the official postmortem with the front-end architecture, thread-per-peer design, timeline, impact on dependent services and remediation.
