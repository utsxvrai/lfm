---
title: "A storm took out one AWS datacenter, and a shared queue stretched the pain across us-east-1"
dek: "Generators in one facility failed to deliver stable voltage, so a single Availability Zone lost power. The bigger story was recovery: an unseen ELB bug flooded the control plane's single regional queue just as every customer tried to move traffic elsewhere."
belief: "AWS thought one Availability Zone could fail in isolation. An ELB bug flooded the region's control plane."
date: 2012-06-29
company: Amazon
kind: outage
topics: [power-cooling, cascading-failure, capacity, software-bug]
stack: [aws, ec2, ebs, elb, rds]
impact: "Approximately 7% of EC2 instances in US-East-1 lost power; EC2 and EBS control planes failed region-wide from 8:04pm to 9:10pm PDT."
rule: "Your failover path runs through the control plane. Make sure the control plane can't be starved by the same event it's supposed to help you escape."
postmortem: https://aws.amazon.com/message/67457/
sources: [https://aws.amazon.com/message/67457/]
---

# A storm took out one AWS datacenter, and a shared queue stretched the pain across us-east-1

On the night of Friday, June 29, 2012, a severe electrical storm swept through Northern Virginia, home of AWS's US-East-1 region. Most of AWS's datacenters there rode through the utility power fluctuations exactly as designed. One did not. Its generators started but would not deliver stable voltage, the batteries ran dry, and servers in that facility [began losing power at 8:04pm PDT](https://aws.amazon.com/message/67457/).

That facility held [approximately 7% of the EC2 instances in the region](https://aws.amazon.com/message/67457/), a single-digit percentage of resources. Multi-AZ architectures exist precisely for this. But many customers who tried to fail over found the tools for failing over were themselves broken: launches failed region-wide for over an hour, and the load balancer control plane fell further and further behind.

AWS's postmortem describes two kinds of impact. One is easy to reason about: machines without power are down. The other is the interesting one, and it's the subject of this post: **the control planes that let customers react to a zone failure degraded across the whole region.**

## What happened

From the [AWS summary](https://aws.amazon.com/message/67457/), all times PDT:

- Weather warnings had already led AWS to cancel all change activity in the region and call in extra staff.
- **7:24pm:** a large voltage spike hit switching equipment in two datacenters serving one Availability Zone. Both transferred to generators. In one, the transfer worked. In the other, each generator independently failed to provide stable voltage, so servers ran on UPS. Utility power came back shortly after and the facility moved back to it.
- **7:57pm:** utility power failed again. Again that one facility could not transfer to generator power.
- **8:04pm:** the UPS units were depleted and servers began losing power.
- **8:14pm:** generator power was stabilized, UPSs restarted, and power started to come back. By **8:24pm** every rack had power.
- **8:04pm to 9:10pm:** customers could not launch EC2 instances, create EBS volumes or attach volumes [in any Availability Zone in the region](https://aws.amazon.com/message/67457/).
- **11:15pm to just after midnight:** most affected instances came back online.
- **12:25am:** most EBS servers were up. By **2:45am**, [90% of outstanding volumes](https://aws.amazon.com/message/67457/) had been handed back to customers.

## What the engineers believed

The design assumption, stated clearly in AWS's own explanation, is that Availability Zones are ["engineered to isolate failure from each other"](https://aws.amazon.com/message/67457/). Lose a zone, and the others keep running. Customers built on that: spread instances across zones, put a multi-AZ load balancer in front, and when one zone dies you launch replacements in another and register them with the load balancer.

That plan quietly assumes two things. First, that the API you call to launch and register is available. Second, that it is *fast*, because everyone else in the region is about to call it at the same time.

The data plane held up: [instances in other zones kept running](https://aws.amazon.com/message/67457/). It was the second assumption, about the control plane, that broke.

## What was actually going on

### Data plane vs control plane

Every AWS service has two halves. The **data plane** is the thing doing the work: a running instance, a volume serving reads and writes, a load balancer forwarding packets. The **control plane** is the API that creates, changes and deletes those things. AWS's summary notes that control planes ["aren't required for the ongoing use of resources"](https://aws.amazon.com/message/67457/). Running things keep running. But the control plane is the only way to *change* anything, and an outage is exactly when you need to.

### EC2 and EBS: a datastore that chose safety over availability

The EC2 and EBS APIs store their metadata in datastores replicated across multiple Availability Zones. When the primary copy lost power, the system, by design, [flipped to read-only mode in the other zones](https://aws.amazon.com/message/67457/) until power returned or engineers decided it was safe to promote another copy. That is a deliberate trade: rather than risk two primaries and corrupt metadata, stop accepting writes. AWS says the blockers forced a manual assessment and a hand-managed failover, which is why launches were down until 9:10pm.

This is the classic consistency-versus-availability choice. Automatically promoting a replica is fast but risky if the old primary might come back with writes the new one never saw. Freezing writes is safe but makes the whole region's control plane depend on one zone's power.

### ELB: one queue for the whole region

Elastic Load Balancers live in individual zones. A multi-AZ ELB has one endpoint per zone, each with its own IP, behind a single DNS name. When an ELB node fails, the ELB control plane takes its IP out of the DNS answer so clients stop going there. The same control plane handles scaling ELBs and adding or removing back-end instances. [All of that ran through a shared queue for the whole region](https://aws.amazon.com/message/67457/).

Here's the sequence AWS describes:

1. As the zone failed, the control plane started shifting traffic away from load balancers in it. That's the normal path.
2. When power returned, a large number of ELBs came up in a state that hit a bug AWS ["hadn't seen before"](https://aws.amazon.com/message/67457/). The bug made the control plane try to scale those ELBs to larger instance sizes, which created a sudden flood of requests.
3. At the same moment, customers were launching replacement EC2 instances in healthy zones and asking for them to be added to their load balancers.
4. All of it went into the same queue. The queue backed up, and requests started taking a very long time.

```diagram
title: one queue, three kinds of work
flow: AZ fails -> shift queued -> bad IP leaves DNS
flow!: bug scales ELBs -> one queue backs up -> traffic shift waits
note: the urgent work sat behind the bulk work
```

The effect on clients depended on DNS behaviour. A multi-AZ ELB returns several IPs. Many browsers try the next IP if the first fails. But AWS notes that ["many clients, especially game consoles and other consumer electronics, only use one IP address"](https://aws.amazon.com/message/67457/). For those clients, a DNS answer that still included the dead zone's IP meant failure until the backlogged traffic shift was processed and they re-queried DNS.

This is the general shape of the problem: a **FIFO queue has no notion of urgency.** A time-critical "stop sending users to the dead zone" is stuck behind thousands of "scale this ELB" and "register this instance" requests that could have waited minutes. Nothing failed outright. Everything just got slower in the one place where slowness mattered most.

### RDS: a failover bug from April

Most Multi-AZ RDS instances promoted their standby almost instantly. A small number didn't, because of a [software bug introduced in April](https://aws.amazon.com/message/67457/) in how storage failures were handled. It only showed up under a particular sequence of communication failures, which the mix of shutdown orders that night produced. A failsafe then required manual intervention. Most of these were finished by 11:00pm.

### The generators

The generators and switchgear were the same brand, installed in late 2010 and early 2011, and had [passed a full-load test on May 12](https://aws.amazon.com/message/67457/). Once brought online manually that night, they ran for just over 30 hours. AWS's response treats the problem as the switching logic's timing and tolerance for voltage quality rather than the generators themselves, but the postmortem doesn't give a final root cause for why each generator failed to stabilise.

## How they fixed it

During the event, engineers stabilized generator power manually, restarted UPSs, and worked through the boot and EBS recovery backlog. EBS deliberately brought volumes that had in-flight writes back in an [impaired state with I/O paused](https://aws.amazon.com/message/67457/), so customers could check consistency before resuming, rather than hand back possibly corrupt disks.

## What changed afterwards

AWS's listed actions, from the [summary](https://aws.amazon.com/message/67457/):

- **Power:** give generators longer to stabilize before the switchgear judges them, widen the power quality tolerances, and add 24x7 onsite engineering staff so a manual transfer can happen before UPSs run out. The generators would be repaired and recertified, or replaced.
- **EC2 boot:** remove a bottleneck in the server boot process that slowed recovery.
- **EC2/EBS control plane:** remove the blockers that forced manual failover of the metadata datastore, and make the flip automatic.
- **ELB:** split processing into multiple queues so time-sensitive work like traffic shifts gets processed quickly, and build a backup DNS re-weighting that can move all ELB traffic away from a zone *without contacting the control plane*.
- **RDS:** roll out a mitigation for the Multi-AZ failover bug.

That last ELB item is the deepest lesson. The emergency path was rebuilt so it no longer depends on the system that gets overloaded during emergencies.

## The rule

Zone isolation protects your data plane, not your recovery. Your failover path almost always goes through a regional control plane, and that control plane's worst day is the same day as yours. Give urgent operations their own lane, and keep at least one way to drain a failed zone that doesn't depend on the API everyone else is hammering.

## Sources

- [AWS: Summary of the AWS Service Event in the US East Region (July 2, 2012)](https://aws.amazon.com/message/67457/): the official postmortem covering power, EC2, EBS, ELB and RDS.
