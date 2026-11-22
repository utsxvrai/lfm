---
title: "Windows Azure's leap-day bug: year + 1 produced February 29, 2013"
dek: "Azure's guest agent set certificate expiry by adding one to the year. On leap day that made a date that doesn't exist, VMs failed to start, and the platform decided the hardware was broken. A rushed fix then took networking away from seven clusters."
belief: "Azure assumed a year from today meant year + 1. Leap day made it February 29, 2013, and VMs failed."
date: 2012-02-29
company: Microsoft
kind: outage
topics: [time-handling, cascading-failure, deploy, certificate]
stack: [windows-azure, fabric-controller]
impact: "Windows Azure Compute and dependent services (ACS, Service Bus, SQL Azure Portal, Data Sync) were disrupted; service management was disabled worldwide for the first time."
detected_by: alert
rule: "Never do date arithmetic by editing fields. Use a calendar-aware library, and test every date path with February 29 and other edge dates."
postmortem: https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/
sources: [https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/]
---

# Windows Azure's leap-day bug: year + 1 produced February 29, 2013

At 4:00 PM Pacific on February 28, 2012, it became midnight UTC on February 29 (Microsoft's post writes "UST"). New virtual machines on Windows Azure stopped coming up. A few hours later Microsoft did something it had [never done before](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/): it switched off service management, meaning deploying, updating and scaling, in every cluster worldwide.

The root cause fits in one sentence from Microsoft's postmortem: the guest agent "[calculated the valid-to date by simply taking the current date and adding one to its year](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/)." On February 29, 2012, that gives February 29, 2013, which doesn't exist.

What makes this incident worth studying is everything that came after that line. A failure to create a certificate was read as a hardware fault. The platform's own healing moved the bug to healthy servers. Then, during recovery, a rushed fix disconnected every VM in seven clusters, including VMs that had been healthy all along. The [last all-clear came at 2:15 AM PST on March 1](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/).

## What happened

Microsoft's postmortem, by Bill Laing and the Windows Azure team, describes two phases.

**Phase one: the leap-day bug.** All times PST, from the post:

| Time | Event |
| --- | --- |
| Feb 28, 4:00 PM | Bug triggers as new VMs' guest agents try to create certificates |
| 5:15 PM | Clusters in the middle of an update hit the server "Human Investigate" threshold, [precisely 75 minutes](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/) after the trigger. Alarms stop the updates and page operations |
| 6:38 PM | Developers identify the bug |
| 6:55 PM | Service management disabled in all clusters worldwide |
| ~10:00 PM | Test and rollout plan for the fixed guest agent |
| 11:20 PM | Fixed code ready |
| Feb 29, 1:50 AM | Testing finished in a test cluster |
| 2:11 AM | First production cluster done. Fix pushed to all clusters |
| 5:23 AM | Service management restored to the majority of clusters |

**Phase two: seven half-updated clusters.** Seven clusters had just started rolling out new host and guest agent versions when the bug hit, so their servers ran a mix of old and new, and both versions had the bug. Microsoft decided to roll these back to the older host agent with a fixed guest agent, and pushed that to every server at once. At [2:47 AM](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/) the package went out. It contained a networking plugin that didn't work with the older host agent, and every VM in those clusters lost its network. That took down Access Control Service and Service Bus deployments hosted there, along with every application that depended on them. A corrected package was tested at 3:40 AM and pushed from 5:40 AM. The clusters were largely working again by 8:00 AM, followed by a day of manual repair.

## What the engineers believed

There are two beliefs here, one for each phase.

**Belief one, in the code: "one year from today" is today's date with the year increased by one.** For 1,460 days out of every 1,461 that's true, and it's the obvious way to write it. Microsoft's post calls the root cause "[incorrect manipulation of date/time values](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/)."

**Belief two, in the platform: if a clean VM's agent never reports in, the hardware is broken.** The post explains the reasoning. If a VM where no customer code has run times out three times in a row, the host agent concludes [a hardware problem must be the cause since the GA would otherwise have reported an error](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/). That makes sense: a software failure should produce an error message, and silence suggests the machine itself is gone. But the guest agent didn't report an error. It just terminated.

## What was actually going on

### Why a certificate was involved at all

Azure's Fabric Controller (FC) manages clusters of about 1,000 servers. Each server runs a **host agent** (HA). Each VM runs a **guest agent** (GA). The HA delivers application secrets, such as SSL certificates, to the GA. So that secrets are always encrypted in transit, the GA creates a "**transfer certificate**" when it starts and gives the HA the public key. Only the GA holds the private key.

A new transfer certificate is created whenever a VM is created: new deployments, scale-outs, OS updates, and "service healing," when the FC moves a VM off a server it thinks is unhealthy. The GA gives it [a one year validity range](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/), from midnight UTC of the current day to one year later.

### The date bug

As general background, the trap looks like this:

```js
// what the GA effectively did
const validTo = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()))
```

In JavaScript this silently rolls over to March 1. Many date APIs instead throw on an impossible date, or return an error, like the certificate-creation code here. Microsoft's post says the invalid date [caused the certificate creation to fail](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/). The correct approach is to let a calendar-aware library add an *interval*, "plus one year," and apply an explicit rule for February 29 (usually clamping to February 28).

### How the failure spread

The cascade, step by step, from the post:

1. The GA can't create its certificate, so it **terminates**. Creating the certificate is the first step before it connects to the HA.
2. The HA waits [25 minutes](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/) for the GA, then reinitializes the VM's OS and restarts it. The bug happens again.
3. After three timeouts in a row on a clean VM, the HA reports the **server** as faulty, and the FC puts it in the "Human Investigate" (HI) state.
4. The FC **service-heals** that server's VMs, moving them to other servers. There, new VMs create new transfer certificates, and the bug strikes again.
5. More servers enter HI. The bug spreads by way of the recovery mechanism.

```diagram
title: how a date bug looked like hardware failure
flow: GA cert fails -> GA exits silently -> 3 timeouts x 25 min
flow!: server marked HI -> VMs moved elsewhere -> same bug, new server
note: healing carried the bug to healthy machines
```

Microsoft had a guard for exactly this kind of spread. When too many servers in a cluster enter HI, the FC moves the [whole cluster to a similar HI state](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/), stopping updates and disabling automatic service healing. That breaker worked. In clusters in the middle of an update, where the rollout [ensured that the bug would be hit immediately](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/), it tripped at 5:15 PM, 75 minutes after the trigger: three timeouts of 25 minutes each. Its alarms are what paged the on-call engineers.

### Why the fix caused a second outage

The seven partially updated clusters needed a consistent set of components. Microsoft chose to roll them back to the older HA with a fixed GA. The team tested this on one server: the VMs started and appeared healthy. That test [had not included testing network connectivity](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/).

Normally, HA updates honor **Update Domains**, deployment availability constraints that limit how many of an application's instances can be updated at once, and the update takes many hours. Confident in the test, the team chose a "**blast**" update that updated every server at the same time. The package included the networking plugin written for the *newer* HA, which didn't work with the older one. A blast update has no partial state. Every VM in all seven clusters lost networking at once, including VMs that had survived the leap-day bug.

This is the most generally useful part of the incident. Under pressure, the team skipped two safety rails: the full-health test and the gradual rollout. Either one would have contained the mistake.

## How they fixed it

Phase one was fixed by building, testing and rolling out a corrected GA, then re-enabling service management cluster by cluster. Phase two needed a corrected HA package. This time the test [verified VM connectivity and other aspects of VM health](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/). It was blasted out from 5:40 AM. Servers left in corrupted states by the repeated transitions were restored and checked by hand through the rest of the day.

## What changed afterwards

Microsoft listed changes by area:

- **Testing:** better detection of time-related bugs, and code analysis tools enhanced to [detect this and similar classes of coding issues](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/). The code base had already been reviewed.
- **Fault isolation:** tell GA failures apart from hardware failures before they spread.
- **Graceful degradation:** finer-grained controls than turning off all of service management.
- **Fail fast:** the post says GA failures "[were not surfaced until 75 minutes after a long timeout](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/)." Classify errors so they fail fast and raise alerts.
- **Communication:** fix dashboard availability, add a summary view and more detailed updates, and use more channels.
- **Recovery:** better internal tooling, and recover dependencies such as ACS and Service Bus first.
- **Credit:** a 33% credit for all customers of Compute, Access Control, Service Bus and Caching for the affected billing months, whether or not they were impacted.

## The rule

Don't do date arithmetic by editing fields. "One year from now" is an interval for a calendar library to add, not `year + 1`, and February 29 belongs in every date test. Equally important: make components fail with a clear error, not silence. If a crash looks the same as a missing machine, your recovery system will treat a software bug as a hardware fault and carry it from server to server.

## Sources

- [Microsoft Azure Blog: "Summary of Windows Azure Service Disruption on Feb 29th, 2012" by Bill Laing (March 9, 2012)](https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/). Microsoft's root cause analysis: the transfer-certificate date bug, the HI cascade, the timelines of both phases, the networking-plugin incompatibility and the remediation list.
