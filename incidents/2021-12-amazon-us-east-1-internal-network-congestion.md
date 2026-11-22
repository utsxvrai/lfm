---
title: "An automated scaling job set off a retry storm that choked AWS's internal network in us-east-1"
dek: "AWS runs its monitoring, internal DNS and parts of the EC2 control plane on a separate internal network, joined to the main network by a set of devices. A routine capacity-scaling job triggered a latent bug that stopped clients from backing off, their retries saturated those devices, and the operators lost the monitoring they needed to see it."
belief: "AWS thought its internal clients backed off under congestion. A latent bug stopped them, choking us-east-1."
date: 2021-12-07
company: Amazon
kind: outage
topics: [automation, networking, cascading-failure, monitoring]
stack: [aws, ec2, nat, dns, api-gateway]
impact: "Control-plane APIs for EC2, ELB, Route 53, STS, API Gateway, Fargate and others in us-east-1 saw errors and latency from 7:30 AM PST; network devices fully recovered at 2:22 PM PST."
rule: "Back-off logic is load-bearing infrastructure: test it under the exact failure it exists for, and keep your monitoring off the path it monitors."
postmortem: https://aws.amazon.com/message/12721/
sources: [https://aws.amazon.com/message/12721/]
---

# An automated scaling job set off a retry storm that choked AWS's internal network in us-east-1

On 7 December 2021, AWS's Northern Virginia region (us-east-1) had a long service disruption. Running EC2 instances [were unaffected](https://aws.amazon.com/message/12721/), and S3 and DynamoDB kept serving customers. But the APIs used to launch, manage and authenticate against AWS resources returned errors and slow responses from the morning into the afternoon, Pacific time. AWS's own Service Health Dashboard and support case system were affected too.

The trigger was not a human mistake or a hardware failure. At 7:30 AM PST, [an automated activity to scale capacity](https://aws.amazon.com/message/12721/) of one AWS service triggered "an unexpected behavior from a large number of clients" on AWS's internal network. Those clients flooded the devices connecting the internal network to the main AWS network, and the congestion fed itself.

The shape of this one is worth learning: a retry storm on a choke point, with the operators' monitoring behind the same choke point.

## What happened

AWS's [summary](https://aws.amazon.com/message/12721/), all times PST:

- **7:30 AM:** The automated scaling activity triggers a large surge of connection activity from clients inside the internal network, overwhelming the networking devices between the internal and main networks.
- **7:33 AM:** EC2 APIs for launching and describing instances start showing elevated errors and latency. Support case creation is impaired from the same time.
- Operators lose real-time monitoring data and work from logs. They identify elevated internal DNS errors and start moving internal DNS traffic off the congested paths.
- **8:22 AM:** AWS is able to update the Service Health Dashboard.
- **9:28 AM:** Internal DNS work complete; DNS errors fully recover. Some services improve, but congestion remains.
- **12:35 PM:** Operators disable EventBridge event delivery to reduce load on the affected devices.
- **1:34 PM:** Congestion significantly improved.
- **2:22 PM:** All network devices fully recovered. Console access fully restored.
- **2:40 PM:** EC2 instance launches recover.
- **Later:** STS fully recovers at 4:28 PM, API Gateway largely at 4:37 PM, Fargate API errors return to normal from 5:00 PM, EventBridge delivery latency back to normal at 6:40 PM.

Among the [services affected](https://aws.amazon.com/message/12721/): EC2 APIs (and so anything that needs new instances, such as RDS, EMR and WorkSpaces), ELB provisioning, Route 53 APIs (from 7:30 AM to 2:30 PM, though DNS queries themselves kept working), Console logins, STS for OIDC federation, CloudWatch, VPC endpoints for S3 and DynamoDB, API Gateway, EventBridge, ECS/EKS/Fargate and Amazon Connect.

## What the engineers believed

The design rested on two reasonable beliefs.

**"Our clients back off under congestion."** AWS says its networking clients [have well tested request back-off behaviors](https://aws.amazon.com/message/12721/) designed to let systems recover from exactly this kind of congestion. Back-off is the standard defence against retry storms. If it works, a surge produces a spike and then subsides.

**"The internal network connection has plenty of headroom."** AWS connects the internal network with [multiple geographically isolated networking devices](https://aws.amazon.com/message/12721/) and scales its capacity significantly for high availability. A single scaling activity shouldn't be able to saturate it.

The first belief was wrong. A [latent issue](https://aws.amazon.com/message/12721/) prevented the clients from backing off adequately. The code path had been in production for many years, and the scaling activity triggered "a previously unobserved behavior". Once back-off failed, the headroom didn't matter.

## What was actually going on

### Two networks and a narrow bridge

AWS describes two networks. The **main AWS network** runs most AWS services and all customer applications. A separate **internal network** hosts foundational services: [monitoring, internal DNS, authorization services, and parts of the EC2 control plane](https://aws.amazon.com/message/12721/). Networking devices between them provide routing and network address translation so that services on one can talk to the other.

That makes those devices a bridge that a lot of critical traffic has to cross. Customer workloads on the main network don't cross it, which is why running instances, S3 and DynamoDB were fine. Anything that needed a control-plane operation, authorization or monitoring data did.

### How a retry storm sustains itself

*(Background.)* Retries are a positive feedback loop. When a request fails or is slow, a client retries. If many clients do that against a shared bottleneck, the retries add load, which causes more failures, which cause more retries. Good back-off (waiting longer after each failure, with randomness so clients don't retry in sync) is what breaks the loop. Without it, the system can stay stuck long after the original trigger is gone.

AWS describes exactly this loop. The surge delayed communication between the networks; [these delays increased latency and errors for services communicating between these networks, resulting in even more connection attempts and retries](https://aws.amazon.com/message/12721/). The result was "persistent congestion".

The network address translation role of the devices matters too *(background)*: NAT devices typically keep per-connection state, so a surge of new connections, rather than just more bytes, is what tends to exhaust them. AWS's word is ["connection activity"](https://aws.amazon.com/message/12721/), which fits that picture, but the summary doesn't say which resource on the devices ran out.

```diagram
title: why the congestion didn't clear
flow: scaling job -> client surge -> bridge devices busy
flow!: errors and delay -> no back-off retries -> more load
note: a latent bug turned off the brake
```

### Blind while fixing it

The congestion [immediately impacted the availability of real-time monitoring data](https://aws.amazon.com/message/12721/) for AWS's own operations teams, because monitoring lives on the internal network. Operators had to work from logs. Even after the DNS fix at 9:28 AM, "monitoring data was still not visible".

AWS gives three reasons remediation was slow: limited monitoring; internal deployment systems, which also run on the internal network, being impaired; and a deliberate choice to move carefully because many services and customer applications on the main network were still working.

The same dependency showed up in communication. The congestion impaired the Service Health Dashboard tooling from [failing over to our standby region](https://aws.amazon.com/message/12721/), and the Support Contact Center relies on the internal network.

### Knock-on damage after recovery

Some services stayed broken after the network recovered, because recovery itself needed the control plane. API Gateway servers that had lost contact with the internal network got into a state where they had to be replaced, and the automated replacement process [was not possible until the EC2 APIs began recovering](https://aws.amazon.com/message/12721/). Fargate then faced a backlog of containers to start and returned Insufficient Capacity Errors while pools were refilled. EventBridge worked through a backlog of events until 6:40 PM.

## How they fixed it

Operators applied a set of [remediation actions](https://aws.amazon.com/message/12721/) to reduce congestion:

- Moving internal DNS traffic away from the congested paths (done by 9:28 AM).
- Identifying the top sources of traffic and isolating them to dedicated network devices.
- Disabling some heavy network traffic services, including EventBridge event delivery from 12:35 PM to 2:35 PM.
- Bringing additional networking capacity online.

Congestion significantly improved by 1:34 PM, and the devices fully recovered by 2:22 PM.

## What changed afterwards

From AWS's [summary](https://aws.amazon.com/message/12721/):

- **The scaling activities were disabled** immediately and won't resume until all remediations are deployed.
- **A fix for the client back-off bug**, expected to deploy over the following two weeks.
- **Additional network configuration** to protect the networking devices even in a similar congestion event.
- **API Gateway** mitigations so its servers stay healthy when the internal network is unavailable, and a faster recycling process.
- **Communications:** a new Service Health Dashboard expected "early next year", and a support system architecture that runs across multiple regions.

AWS also acknowledged that putting updates in a single global banner on the dashboard made it hard for some customers to find information.

## The rule

Back-off isn't a nice-to-have, it's what keeps a transient spike from becoming an outage, so test it under the exact failure it exists to handle, not just in unit tests. A code path that's never been exercised in anger, even one that's been in production for years, should be treated as untested. And map your choke points: if monitoring, deployment, DNS and the status page all depend on the same bridge, the first thing a congestion event takes away is your ability to see and fix it. Keep at least one way to observe and change the system that doesn't cross the path it's observing.

## Sources

- [AWS, "Summary of the AWS Service Event in the Northern Virginia (US-EAST-1) Region" (10 December 2021)](https://aws.amazon.com/message/12721/): AWS's official post-event summary, covering the internal network architecture, the scaling trigger, the back-off bug, the timeline, per-service impact and the follow-up actions.
