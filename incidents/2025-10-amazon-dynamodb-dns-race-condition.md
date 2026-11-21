---
title: "A race between two DNS Enactors emptied DynamoDB's us-east-1 endpoint and stalled EC2 for hours"
dek: "DynamoDB's DNS automation checked once that its plan was newer, then spent a long time applying it. Meanwhile another instance applied a newer plan and deleted old ones, including the one the slow instance had just written. The endpoint's DNS record ended up empty, and the automation couldn't repair it."
date: 2025-10-19
company: Amazon
kind: outage
topics: [dns, automation, software-bug, cascading-failure]
stack: [dynamodb, route53, ec2, nlb, lambda, aws]
impact: "From 11:48 PM PDT on 19 October to 2:20 PM PDT on 20 October 2025, us-east-1 saw DynamoDB API errors, failed EC2 launches and NLB connection errors, with knock-on impact to Lambda, ECS/EKS/Fargate, Connect, STS, IAM sign-in, Redshift and Support."
rule: "A check-then-act on shared state is only valid while nothing else can act in between. If your writer can stall, re-check at write time, and never let a cleanup job delete the record that is currently live."
postmortem: https://aws.amazon.com/message/101925/
sources: [https://aws.amazon.com/message/101925/]
---

# A race between two DNS Enactors emptied DynamoDB's us-east-1 endpoint and stalled EC2 for hours

At [11:48 PM PDT on 19 October 2025](https://aws.amazon.com/message/101925/), every system trying to reach DynamoDB in us-east-1 through its public endpoint, `dynamodb.us-east-1.amazonaws.com`, started getting DNS failures. That included customers and AWS's own internal services that depend on DynamoDB. The endpoint's DNS record had been left **empty**.

DynamoDB itself was back by [2:40 AM](https://aws.amazon.com/message/101925/). The rest of the region wasn't. AWS describes the whole event as running [from 11:48 PM PDT on October 19 to 2:20 PM PDT on October 20](https://aws.amazon.com/message/101925/), with three distinct periods of customer impact: DynamoDB API errors, then EC2 launch failures, then Network Load Balancer connection errors.

The root cause, in AWS's words, was ["a latent race condition in the DynamoDB DNS management system"](https://aws.amazon.com/message/101925/) that produced an incorrect empty DNS record, which the automation then failed to repair.

## What happened

All times PDT, from [AWS's summary](https://aws.amazon.com/message/101925/):

- **19 Oct, 11:48 PM.** DynamoDB's regional endpoint resolves to nothing. DynamoDB API errors begin. EC2's droplet management starts failing its state checks.
- **20 Oct, 12:38 AM.** Engineers identify DynamoDB's DNS state as the source.
- **1:15 AM.** Temporary mitigations let some internal services reach DynamoDB and repair key internal tooling.
- **2:25 AM.** All DNS information restored. Global table replicas caught up by 2:32.
- **2:25–2:40 AM.** Clients recover as cached DNS records expire. EC2 starts trying to re-establish leases with its physical hosts and falls into congestive collapse.
- **4:14 AM.** Engineers throttle work and selectively restart DWFM hosts.
- **5:28 AM.** Leases restored; new launches start succeeding, though many hit throttles. Network Manager starts working through a large backlog.
- **5:30 AM.** NLB connection errors begin.
- **6:21 AM.** Network propagation latency rises; new instances launch without working networking.
- **6:52 AM.** Monitoring detects NLB health check failures.
- **9:36 AM.** Engineers disable automatic NLB health check failover.
- **10:36 AM.** Network propagation back to normal.
- **11:23 AM.** Throttles start to be relaxed.
- **1:50 PM.** EC2 fully recovered. **2:09 PM.** NLB automatic failover re-enabled.

## What the engineers believed

The DNS management system had been [designed for resilience](https://aws.amazon.com/message/101925/), and its architecture shows it. It was split into two components for availability. Its writer ran redundantly in three Availability Zones. Writes went through Route 53 transactions so that concurrent writers couldn't produce a half-applied plan. And before applying a plan, a writer checked that the plan was newer than the one already applied.

That last check embodies the belief: **a writer that has confirmed its plan is the newest can safely apply it.** Under normal timing, applying a plan [completes rapidly](https://aws.amazon.com/message/101925/), so the confirmation is still true by the time the write lands. The design assumed the gap between check and write would stay small.

## What was actually going on

### Planner, Enactors and plan generations

AWS describes two components:

- The **DNS Planner** watches the health and capacity of DynamoDB's load balancers and periodically produces a new **DNS plan**: for each endpoint, a set of load balancers and weights. It produces a single regional plan covering all endpoints, which simplifies capacity management when capacity is shared, as with the public endpoint and the newer IPv6 endpoint.
- The **DNS Enactor** applies plans to Route 53. It is designed to have minimal dependencies so it can help recover the system in any scenario, and three independent copies run, one per AZ. Each looks for new plans and replaces the current plan for each endpoint using a Route 53 transaction.
- After applying a plan, an Enactor runs a **clean-up** process that deletes plans significantly older than the one it just applied.

DynamoDB maintains [hundreds of thousands of DNS records](https://aws.amazon.com/message/101925/) for its load balancer fleet in each region, so this automation is not optional.

### The race, step by step

Just before the event, [one DNS Enactor experienced unusually high delays](https://aws.amazon.com/message/101925/), repeatedly retrying updates that were blocked by another Enactor updating the same endpoints. Here is the sequence AWS describes:

1. **Enactor A** picks up a plan, checks once that it is newer than the applied plan (true at that moment), and starts working through endpoints slowly.
2. The **Planner** keeps running and produces many newer generations of plans.
3. **Enactor B** picks up one of the newest plans and races through every endpoint.
4. B finishes and runs **clean-up**, which identifies plans many generations older than the one it just applied.
5. At the same moment, A finally reaches the regional DynamoDB endpoint and applies its **much older plan**, overwriting B's newer one. A's freshness check is from step 1 and is now stale.
6. B's clean-up deletes A's old plan, which is **now the active plan for the regional endpoint**. Deleting it removes all IP addresses for the endpoint.
7. Because the active plan was deleted, the system is left in an inconsistent state that [prevented subsequent plan updates from being applied by any DNS Enactors](https://aws.amazon.com/message/101925/). Manual intervention is required.

```diagram
title: how the endpoint ended up empty
flow: Enactor A checks plan -> stalls on retries -> writes stale plan
flow!: Enactor B writes new -> cleans up old plans -> deletes live plan
note: A's newer-than check ran long before its write
```

*Background:* this is a textbook **time-of-check to time-of-use** race. Each safety mechanism was correct on its own terms. The Route 53 transaction made each endpoint update atomic. The freshness check was correct when made. The clean-up deleted only old plans. What none of them covered was the gap between A's check and A's write, and the fact that "old" and "currently applied" could be the same plan.

The final step is what turned a wrong record into an outage that needed humans: the automation that should have overwritten the bad state on the next plan generation could no longer apply plans at all.

### Why DynamoDB DNS took EC2 down for hours

DynamoDB was back by 2:40 AM. EC2 launches failed until mid-morning because of a second system with a quieter dependency on DynamoDB.

**DropletWorkflow Manager (DWFM)** manages the physical servers, which AWS calls droplets, that host EC2 instances. Each DWFM host keeps a **lease** on each droplet it manages and must complete a state check with it [every few minutes](https://aws.amazon.com/message/101925/). That process depends on DynamoDB. From 11:48 PM, the checks failed and leases slowly timed out. Running instances were fine, but a droplet without an active lease is not a candidate for new launches, so the EC2 API returned "insufficient capacity" errors.

When DynamoDB came back at 2:25 AM, DWFM tried to re-establish leases with the whole fleet at once. There were so many droplets that each attempt [took long enough that the work could not be completed before they timed out](https://aws.amazon.com/message/101925/). Timed-out work was queued for retry, adding to the load. AWS says DWFM had [entered a state of congestive collapse](https://aws.amazon.com/message/101925/), and that there was no established operational recovery procedure for it.

*Background:* congestive collapse is when a system spends all its capacity on work that times out before finishing, so goodput drops to zero even though the system is busy. Retrying timed-out work makes it worse. The usual escape is to shed load so some work can finish, which is what engineers did at 4:14 AM by throttling and restarting DWFM hosts to clear their queues.

### And then the load balancers

Recovered DWFM released a backlog of network configuration changes onto **Network Manager**, which propagates network state to new instances. It fell behind, so new instances launched [without the necessary network connectivity](https://aws.amazon.com/message/101925/).

NLB's health checker was bringing those new instances into service. Their networking wasn't ready, so health checks failed even though the nodes were healthy, then passed, then failed. Nodes flapped in and out of DNS. The flapping overloaded the health check subsystem, delaying checks and triggering **automatic AZ DNS failover**, which took capacity out of service for multi-AZ load balancers. At 9:36 AM engineers turned off automatic failover so all healthy nodes could serve.

That chain also hit Lambda, where NLB health check failures [triggered instance terminations](https://aws.amazon.com/message/101925/) that left internal systems under-scaled, and Amazon Connect, STS and Redshift. One detail stands out: for part of the night, Redshift customers [in all AWS Regions](https://aws.amazon.com/message/101925/) couldn't run queries with IAM user credentials, because of a Redshift defect that resolved user groups through an IAM API in us-east-1.

## How they fixed it

For DynamoDB, operators manually repaired the DNS state, with temporary mitigations at 1:15 AM unblocking internal tooling and full DNS restoration at 2:25 AM. For EC2, engineers throttled incoming work and restarted DWFM hosts, then reduced load on Network Manager, then gradually relaxed throttles. For NLB, they disabled automatic health-check failover until EC2 had recovered.

## What changed afterwards

From AWS's [summary](https://aws.amazon.com/message/101925/):

- **DynamoDB DNS Planner and DNS Enactor automation disabled worldwide.** Before re-enabling it, AWS will fix the race condition and add protections against applying incorrect DNS plans.
- **NLB:** a velocity control limiting how much capacity a single NLB can remove when health check failures cause AZ failover.
- **EC2:** a new test suite to exercise the DWFM recovery workflow at scale, and throttling in EC2's data propagation systems that rate-limits incoming work based on queue size.
- A continued review across all AWS services for ways to avoid impact and shorten recovery.

## The rule

A check-then-act is only as good as the time between the check and the act. If a writer can stall, the check has to happen atomically with the write, for example as a condition on the write itself, so a stale plan is rejected rather than applied. And a garbage collector must never be able to delete the thing that is currently live, however old it looks.

The second lesson is about recovery (interpretation): every system that maintains leases or caches against a dependency will try to rebuild them all at once when that dependency returns. If the rebuild can't finish inside its own timeout, it never finishes. Design and test the "everything comes back at once" path, because it runs exactly when you can least afford surprises.

## Sources

- [Amazon Web Services, "Summary of the Amazon DynamoDB Service Disruption in the Northern Virginia (US-EAST-1) Region", October 2025](https://aws.amazon.com/message/101925/): AWS's post-event summary, covering the DNS Planner/Enactor race, the DWFM congestive collapse, Network Manager and NLB health checks, impact on other services, and follow-up changes.
