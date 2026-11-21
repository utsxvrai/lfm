---
title: "DynamoDB's membership requests outgrew their timeout, and retries kept them that way"
dek: "Global Secondary Indexes quietly made storage servers' membership lists bigger until answering them took nearly as long as the timeout. A brief network blip sent many requests at once, they timed out, and the retries kept the metadata service overloaded for hours."
date: 2015-09-20
company: Amazon
kind: outage
topics: [capacity, cascading-failure, monitoring, dependency]
stack: [dynamodb, aws, sqs, cloudwatch]
impact: "DynamoDB error rates in US-East stabilized at about 55% from 2:37am PDT, with knock-on failures in SQS, EC2 Auto Scaling, CloudWatch and the AWS Console, until recovery at 7:10am PDT."
rule: "Monitor how close your slowest requests are to their timeout. A system running just under its timeout falls over the moment load rises, and retries keep it down."
postmortem: https://aws.amazon.com/message/5467D2/
sources: [https://aws.amazon.com/message/5467D2/]
---

# DynamoDB's membership requests outgrew their timeout, and retries kept them that way

Early on Sunday, 20 September 2015, Amazon DynamoDB in the US-East region started failing requests. By [2:37am PDT](https://aws.amazon.com/message/5467D2/) the error rate had climbed "far beyond any level experienced in the last 3 years" and settled at about [55%](https://aws.amazon.com/message/5467D2/). It stayed there until a little after 7am.

DynamoDB isn't only a customer-facing database. AWS's own services keep state in it. Over the same morning, SQS returned elevated errors, EC2 Auto Scaling APIs failed, CloudWatch lost metrics, and some people couldn't log in to the AWS Console. All of this is in [AWS's summary of the event](https://aws.amazon.com/message/5467D2/).

The trigger was a brief network disruption, the kind DynamoDB normally handles without anyone noticing. This time it didn't, because a popular new feature had been slowly using up a safety margin that nobody was measuring.

## What happened

At [2:19am PDT](https://aws.amazon.com/message/5467D2/) a brief network disruption hit a portion of DynamoDB's storage servers. Those servers did what they always do after a disruption: they asked the internal metadata service which partitions they were supposed to own.

Some of those answers took longer than the storage servers were willing to wait. Servers that couldn't get their membership took themselves out of service and retried. The retries added load to the metadata service. That slowed its responses to *healthy* servers doing routine check-ins, which then timed out too and took themselves out as well. The [summary](https://aws.amazon.com/message/5467D2/) notes that even servers that had renewed successfully were failing their next renewal and dropping back to unavailable.

Engineers tried to add capacity to the metadata service, but it was too overloaded to accept the administrative requests needed to do that. At [5:06am PDT](https://aws.amazon.com/message/5467D2/) they paused requests to the metadata service altogether. Retry traffic fell, the service recovered enough to accept the capacity change, and they then turned requests back on gradually. At [7:10am PDT](https://aws.amazon.com/message/5467D2/) DynamoDB error rates were low enough for most customers and dependent AWS services to resume normal operations.

## What the engineers believed

The membership protocol was built for exactly this kind of event. A network disruption hits some storage servers, they re-check their membership, process any updates and go back to serving. As AWS put it, this kind of disruption is ["handled seamlessly and without change to the performance of DynamoDB."](https://aws.amazon.com/message/5467D2/)

The assumption underneath: a membership response is small and fast, and stays that way. The time limit storage servers gave the metadata service was set with that in mind. Nobody was tracking the size of membership lists. AWS says plainly: ["We did not have detailed enough monitoring for this dimension (membership size)."](https://aws.amazon.com/message/5467D2/)

## What was actually going on

### Partitions, memberships and the metadata service

A DynamoDB table is split into partitions, and those partitions are spread over many storage servers for latency and durability. The set of partitions a given server is responsible for is its **membership**, and the internal metadata service manages it ([AWS](https://aws.amazon.com/message/5467D2/)).

Storage servers check in periodically to confirm their membership. They also ask after a network disruption and on startup. To answer, the metadata service fetches the list of partitions and related information from its own store, bundles it into a message and sends it back. If the response doesn't arrive in time, the storage server [retries and temporarily disqualifies itself](https://aws.amazon.com/message/5467D2/) from serving requests.

That self-disqualification is a sensible safety rule. A server that isn't sure what it owns shouldn't answer for it. But it also connects metadata-service latency directly to customer-facing availability.

### How GSIs inflated the membership

In the months before the incident, customers had been [rapidly adopting Global Secondary Indexes](https://aws.amazon.com/message/5467D2/). A GSI lets you query a table by a different key. Because GSIs are global, each one has its own partitions on storage servers. A table with several GSIs could see its contribution to membership lists ["quickly double or triple"](https://aws.amazon.com/message/5467D2/). Customers with very large tables adopted GSIs heavily, so the partitions-per-table ratio rose sharply. So did the size of some storage servers' membership lists, and with it the time the metadata service needed to build each response.

No single change caused the outage. The workload drifted, and the cost of one kind of request grew with it. AWS says processing time for some membership requests ["began to approach the retrieval time allowance by storage servers"](https://aws.amazon.com/message/5467D2/). The system was running just under its own timeout and nobody could see it.

### Why a small blip became a spiral

When a system is that close to its timeout, a small rise in load is enough to push it over:

1. The network disruption made many storage servers ask for membership **at the same time**.
2. Several of those were large lists. Processing them together slowed the metadata service down, and responses [exceeded the allotted time limit](https://aws.amazon.com/message/5467D2/).
3. Servers whose requests timed out marked themselves unavailable and **retried**. All the work done on the timed-out request was wasted, and the retry asked for it again.
4. The extra load slowed responses for servers that had never been affected by the disruption. Their routine renewals started timing out, and they joined the retry pool too.

Once this starts, it keeps itself going. The original disruption is long over, but retries generate enough load to keep latency above the timeout, which generates more retries. The metadata service ends up spending its capacity on answers that nobody waits around to receive. That's why the error rate settled at around 55% instead of recovering. It's also why adding capacity didn't work at first: the administrative requests to add it were stuck in the same overloaded service.

```diagram
title: the membership retry spiral
flow: blip -> many servers ask -> slow big replies
flow!: past timeout -> quits and retries -> more load
note: retries kept latency above the limit
```

### Pausing traffic to break the loop

The fix ran against instinct: send the overloaded service *less* traffic, not more capacity. Pausing requests at 5:06am stopped the retries, which [relieved much of the load](https://aws.amazon.com/message/5467D2/). With the pressure off, the metadata service could finally accept the request to add significant capacity. Then engineers turned requests back on, returned storage servers to the customer request path, and let normal load come back.

### The blast radius: AWS services built on DynamoDB

Several AWS services keep internal state in DynamoDB tables, and each failed in its own way ([AWS](https://aws.amazon.com/message/5467D2/)):

- **SQS** keeps queue metadata in DynamoDB and caches it. The cache is refreshed often, so once DynamoDB finished disabling traffic at 5:45am PDT, SQS couldn't refresh it and error rates rose significantly. No queue data was lost.
- **EC2 Auto Scaling** stores group and launch configurations in DynamoDB. Its APIs had significantly increased faults from 2:15am to 7:10am PDT. A backlog of scaling activities then took until 10:52am PDT to clear.
- **CloudWatch** uses a DynamoDB table to tag incoming EC2 metrics with Auto Scaling group membership. EC2 metrics were intermittently available from 2:35am to 5:45am PDT, and `PutMetricData` error rates were significantly elevated from about 5:51am to 7:10am. Full recovery came at 7:29am PDT.
- **AWS Console** logins were slow from 5:45am to 7:10am PDT. Login made an API call that relied on DynamoDB. That call didn't need to succeed for login to proceed, but it had ["a very long timeout"](https://aws.amazon.com/message/5467D2/) and blocked progress for tens of seconds. A shorter timeout was already in testing but hadn't been rolled out.

The Console case is a smaller version of the main incident. A non-essential call had a timeout set for the normal case, and when its dependency got slow, the whole login path waited on it.

## How they fixed it

From the [summary](https://aws.amazon.com/message/5467D2/):

1. Several attempts to add capacity to the metadata service failed because of the load.
2. At 5:06am PDT they paused requests to the metadata service to stop the retry load.
3. They added significant capacity while requests were paused.
4. They turned requests back on, put storage servers back in the request path and restored normal load. By 7:10am PDT, error rates were low enough for most customers.

A low error rate of [0.15%-0.25%](https://aws.amazon.com/message/5467D2/) remained afterwards. AWS initially treated it as cleanup. On Monday it found that one metadata partition still wasn't taking its full traffic, and that the low *overall* rate was hiding disproportionately high error rates for a small number of customers. AWS says it should have posted to the status dashboard sooner.

## What changed afterwards

For DynamoDB, AWS committed to ([AWS](https://aws.amazon.com/message/5467D2/)):

- **More metadata-service capacity**, already significantly increased.
- **Monitoring of performance dimensions such as membership size**, so capacity can be planned ahead.
- **Lower request rate, longer allowance.** Storage nodes would request membership less often, and the metadata service would get more time to process queries.
- **Segmentation.** Longer term, many instances of the metadata service, each serving only part of the storage fleet, to contain future failures.

Dependent services made their own changes. SQS would keep send and receive working without prolonged access to its metadata table. Auto Scaling would add parallelism and prune superseded activities. CloudWatch would require cache refreshes for fewer metrics. The Console would ship the shorter timeout.

## The rule

Track latency against the timeout, not just raw latency. A request that normally takes 80% of its timeout looks healthy on every dashboard until load rises by 25%. Then it fails all at once, and retries make sure it keeps failing. Whatever drives the cost of a request (list size, fan-out, payload) should be a metric with an alert, especially when a new feature can grow it without anyone shipping a change.

When an overloaded service is stuck in a retry loop, adding capacity often can't get through. Shedding load usually comes first. Build a way to pause or throttle callers before you need it, and make sure your own control-plane operations don't have to wait in the same queue as the traffic that's overloading it.

## Sources

- [AWS, "Summary of the Amazon DynamoDB Service Disruption and Related Impacts in the US-East Region"](https://aws.amazon.com/message/5467D2/): AWS's official postmortem, covering the membership mechanism, the GSI growth, the timeline, the impact on SQS, Auto Scaling, CloudWatch and the Console, and the corrective actions.
