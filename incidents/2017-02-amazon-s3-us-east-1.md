---
title: "A mistyped input to a capacity-removal command took S3 offline in us-east-1"
dek: "Debugging a slow billing system, an S3 engineer ran a playbook command with one wrong input and removed the servers behind S3's index and placement subsystems. Restarting them took hours, because nobody had done a full restart at that scale for years."
date: 2017-02-28
company: Amazon
kind: outage
topics: [human-error, capacity, cascading-failure, dependency]
stack: [s3, aws, ec2, ebs, lambda]
impact: "S3 in US-EAST-1 could not serve requests while its index and placement subsystems restarted, which also hit EC2 launches, EBS volumes restored from S3 snapshots, Lambda and the S3 console."
rule: "Operational tools must refuse to take a system below its minimum safe capacity, and the restart path you never exercise is the one that will be slow when you need it."
postmortem: https://aws.amazon.com/message/41926/
sources: [https://aws.amazon.com/message/41926/]
---

# A mistyped input to a capacity-removal command took S3 offline in us-east-1

On the morning of February 28, 2017, Amazon S3 in the Northern Virginia region (US-EAST-1) stopped serving requests. Starting at [9:37AM PST](https://aws.amazon.com/message/41926/), S3 couldn't handle GET, LIST, PUT or DELETE until its core subsystems restarted, which took until early afternoon.

Because many other AWS services store their data in S3, the outage spread. AWS lists the S3 console, EC2 new instance launches, EBS volumes that needed data from an S3 snapshot, and AWS Lambda as affected while the S3 APIs were unavailable ([AWS](https://aws.amazon.com/message/41926/)). Even AWS's own status page couldn't show it: until [11:37AM PST](https://aws.amazon.com/message/41926/), AWS couldn't update individual services on the Service Health Dashboard, because the dashboard's admin console depended on S3.

The trigger was one wrong input to a routine command. The reason a routine command could do this much damage, and the reason recovery was slow, is the useful part.

## What happened

The S3 team was debugging the S3 billing system, which was progressing more slowly than expected. At 9:37AM PST, an authorised S3 team member, following an established playbook, ran a command meant to remove a small number of servers from one of the S3 subsystems used by the billing process ([AWS](https://aws.amazon.com/message/41926/)). One input was entered incorrectly, and a much larger set of servers was removed.

Those servers supported two other S3 subsystems:

- **The index subsystem** manages the metadata and location of every S3 object in the region. Every GET, LIST, PUT and DELETE needs it.
- **The placement subsystem** allocates storage for new objects during PUTs, and needs a working index subsystem to operate.

With a significant part of their capacity gone, both subsystems needed a full restart, and S3 couldn't serve requests until they were back ([AWS](https://aws.amazon.com/message/41926/)).

## What the engineers believed

Two reasonable beliefs failed together.

**Removing capacity is safe.** AWS says S3's subsystems are designed to tolerate the removal or failure of significant capacity with little or no customer impact, and removing and replacing capacity is one of its core operational processes, used since S3 launched ([AWS](https://aws.amazon.com/message/41926/)). The engineer was using an established playbook. This was normal work done the normal way.

**A restart is a known quantity.** If a subsystem does have to restart, you expect the time it took last time. But AWS writes that "we have not completely restarted the index subsystem or the placement subsystem in our larger regions for many years." In those years, S3 had grown enormously.

## What was actually going on

### The tool had no floor

The command did exactly what it was told. Nothing in the tool compared what was being removed with what the subsystem *needed* to keep running. AWS's own summary: "the tool used allowed too much capacity to be removed too quickly" ([AWS](https://aws.amazon.com/message/41926/)).

A general way to see it: any tool that changes fleet size takes a target set and an action. The dangerous version validates only that the input is well-formed. The safe version also checks the *resulting state*: after this action, will each affected subsystem still be above its minimum capacity? If not, the tool refuses, whatever the operator typed. That's the safeguard AWS added afterwards.

### Recovery time grows with the system

A metadata service like the S3 index holds the mapping from every object key to where its bytes live. AWS says restarting it involves running safety checks to validate the integrity of the metadata, and that this, with the rest of the restart, took longer than expected because of S3's growth ([AWS](https://aws.amazon.com/message/41926/)).

That's the trap with rarely used recovery paths. Day-to-day operations (adding and removing a few servers, replacing failed hardware) are exercised all the time, so they stay fast and well understood. A *full* restart only happens in a disaster, so nobody measures it, and its cost quietly grows with the data. When it's finally needed, it's slow at exactly the worst moment.

### Dependencies turned one subsystem into many services

The order of recovery followed the dependencies:

```diagram
title: why PUT came back last
flow: wrong input -> index servers gone -> GET LIST DELETE down
flow!: placement needs index -> waits for index -> PUT down longest
note: EC2 EBS Lambda and the status page sat on top of S3
```

The index subsystem restarted first. By [12:26PM PST](https://aws.amazon.com/message/41926/) it had enough capacity to start serving GET, LIST and DELETE, and by 1:18PM PST those APIs were working normally. The placement subsystem could only start recovering once the index was working, and finished at [1:54PM PST](https://aws.amazon.com/message/41926/). At that point S3 was operating normally. Other AWS services that had built up backlogs during the outage needed more time to fully recover.

The Service Health Dashboard detail is a small version of the same lesson. The tool you use to communicate about an outage shouldn't depend on the thing that's down. AWS used its Twitter account (@AWSCloud) and banner text on the dashboard until it could update individual services.

## How they fixed it

During the incident there was no shortcut. The fix *was* the restart: the index subsystem restarted and validated its metadata, then placement. The postmortem doesn't mention any attempt to put the removed servers back. It describes the subsystems requiring "a full restart" once a significant part of their capacity was gone ([AWS](https://aws.amazon.com/message/41926/)).

## What changed afterwards

AWS listed concrete changes ([AWS](https://aws.amazon.com/message/41926/)):

- **The capacity tool was changed** to remove capacity more slowly, with safeguards that stop capacity from being removed if it would take any subsystem below its minimum required capacity level. AWS says this will stop an incorrect input from causing a similar event.
- **Other operational tools were audited** for similar safety checks.
- **Faster recovery for key subsystems.** AWS describes partitioning services into small units it calls *cells*, so that engineers can assess and fully test recovery even for the largest services. S3 had already been moving parts of the service into smaller cells. Further partitioning of the index subsystem, planned for later that year, was moved up to start immediately.
- **The Service Health Dashboard's admin console** was changed to run across multiple AWS regions.

The cell idea answers the "full restart nobody has done for years" problem directly. If a subsystem is split into many smaller independent cells, restarting one cell is routine and can be practised. A global restart becomes many small restarts, each one of a known size.

For backend engineers, the takeaways scale down well:

1. **Put guardrails in destructive tools, not just in playbooks.** Validate the end state ("at least N healthy replicas remain") rather than only the input. Rate-limit removals so a mistake is visible before it finishes.
2. **Time your cold starts.** If a cache warm-up, index rebuild or full service restart has never been timed at today's data size, you don't know your recovery time.
3. **Keep status and incident tooling off the failure domain** it reports on.

## The rule

Operational tools must refuse to take a system below its minimum safe capacity, and the restart path you never exercise is the one that will be slow when you need it.

## Sources

- [Summary of the Amazon S3 Service Disruption in the Northern Virginia (US-EAST-1) Region](https://aws.amazon.com/message/41926/): AWS's official post-event summary. It is the source for all times (PST), the description of the index and placement subsystems, the affected services, the Service Health Dashboard dependency, and the list of changes.
