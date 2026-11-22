---
title: "One router command made every router in Microsoft's WAN recompute its routes"
dek: "An engineer adding capacity in Madrid ran a command to purge the IGP database. On that router model it didn't stay local: it told every router in the WAN to recompute its topology, and Azure and Microsoft 365 lost connectivity in waves."
belief: "Microsoft thought its engineer was touching one router. One command made every WAN router recompute routes."
date: 2023-01-25
company: Microsoft
kind: outage
topics: [networking, config-change, human-error, bgp]
stack: [igp, bgp, wan, azure, microsoft-365]
impact: "Network latency and timeouts reaching Azure and Microsoft 365 worldwide from 07:08 UTC, with most Microsoft 365 services recovered by 12:43 UTC."
detected_by: alert
rule: "Limiting a change to one device doesn't limit its blast radius when that device speaks a protocol that floods state to every peer; gate commands by their protocol-level effect, per vendor."
postmortem: https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf
sources: [https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf, https://www.theregister.com/2023/01/30/wan_router_ip_address_change/]
---

# One router command made every router in Microsoft's WAN recompute its routes

On the morning of 25 January 2023 (UTC), customers started seeing latency and timeouts connecting to Azure and Microsoft 365. Teams, Exchange Online, SharePoint, OneDrive, Graph, Power BI, Intune and the Microsoft 365 admin portal were all affected, according to Microsoft's [post-incident report for Microsoft 365 (MO502273)](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf). The worst of it landed on users in Asia Pacific and EMEA, where it was the working day.

Nothing had crashed. A network engineer was adding capacity to Microsoft's global wide area network in Madrid. One step changed a router's IP address, and the command used made **every router in the WAN** recompute its adjacency and forwarding tables at once. While they recomputed, they couldn't forward packets correctly.

Microsoft's report puts the incident window at [07:08 to 12:43 UTC](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf). The Register, quoting Microsoft's earlier Azure status postmortem, gives the start as [07:05 UTC and full mitigation at 12:42](https://www.theregister.com/2023/01/30/wan_router_ip_address_change/). The small differences are between Microsoft's Azure and Microsoft 365 write-ups; both agree on the shape.

## What happened

From the [Microsoft 365 PIR](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf), all times UTC:

- **07:08**: The engineer runs the operation on the first new Madrid router. Impact starts.
- **07:11**: Monitoring alerts on a potential networking issue. Engineers start by reviewing DNS configuration. (The Register reports Azure's detection time as [07:12, seven minutes after onset](https://www.theregister.com/2023/01/30/wan_router_ip_address_change/).)
- **07:27**: Incident published on the Service Health Dashboard and status.office.com.
- **07:38**: SharePoint and OneDrive fail off Azure Front Door routing to see if it helps. It doesn't.
- **07:40**: Monitoring confirms the problem is in the Microsoft WAN, not DNS.
- **33 minutes after the first change**: The **same operation is run on the second Madrid router**, causing a second wave.
- Azure reverts a recently deployed IPv6 change as a precaution; it later turns out to be unrelated.
- **08:20**: Source identified. Automated recovery had already started just after 08:10.
- **09:00 to 09:35**: Most network devices recover; the WAN self-recovers and stabilizes. Teams recovers at 09:40, SharePoint and OneDrive at 09:50.
- **10:11**: Further region-specific packet loss found in India.
- **12:43**: Most services recovered and packet loss back to normal. Residual Outlook on the web and Exchange ActiveSync impact continues under a separate incident until [03:50 UTC on 26 January](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf).

SharePoint and OneDrive saw about a [10% reduction in requests worldwide](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf) compared with the previous week during 07:08 to 09:50, and users who could reach those services saw errors in three separate waves.

## What the engineers believed

Microsoft had several layers of protection, and the report describes them:

- A four-step standard operating procedure: test in an emulator, test in a lab, a "Safe-Fly Review" documenting both with roll-out and roll-back plans, then **Safe-Deployment, which allows access to only one device at a time** ([PIR](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf)).
- A real-time AAA system that must approve every command on every router, with a **block list of commands that have global impact**.

So the working belief was: "I'm touching one router, through a gate that blocks dangerous commands. The worst I can do is break this router."

Both protections were sound in principle. Both had a gap exactly where this command fell.

## What was actually going on

### How a link-state IGP keeps every router in sync

*Background:* inside a large network, routers use an Interior Gateway Protocol (IGP) to learn the internal topology. The common ones, OSPF and IS-IS, are link-state protocols. Each router describes its own links and floods that description to every other router in the domain. Every router ends up with the same copy of the whole topology, the link-state database, and runs a shortest-path calculation over it to build its forwarding table.

The useful property is that everyone agrees. The dangerous property is that a change anywhere is propagated everywhere by design. A message telling routers to discard and rebuild their view of the topology doesn't stay on one box; flooding carries it to the whole domain, and while each router rebuilds, its forwarding can be wrong or incomplete.

Microsoft's report describes exactly that outcome. The SOP had been changed to add **a command to purge the IGP database**. On routers from two of Microsoft's vendors, that command only affects the local router. On the third vendor's routers, it [executes across all IGP-joined routers](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf), ordering them all to recompute their topology databases.

### One device at a time is not one blast radius at a time

The "one device at a time" rule limits which device an engineer can log in to. It doesn't limit what that device says to its neighbors. Microsoft's report states it directly: even though the engineer had access to a single router, ["it was still connected to the rest of the Microsoft WAN via the IGP protocol"](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf).

```diagram
title: why one router took down the WAN
flow: purge, vendor A/B -> local router only -> local blip
flow!: purge, vendor C -> flooded via IGP -> WAN-wide recompute
note: same command, different scope by vendor
```

The report describes two cascading effects. First, routers across the global network recomputed IP connectivity for the entire internal network. Second, because of that, BGP routers began to re-advertise and re-validate the prefixes Microsoft receives from the internet. Given the size of the network, it took [approximately 1 hour and 40 minutes](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf) to restore connectivity to every prefix.

The Register adds a detail from Azure's version: the WAN problem paused automated systems that maintain network health, including the one that expels unhealthy devices and the traffic-engineering system. Some paths kept seeing packet loss from 09:35 [until those systems were manually restarted](https://www.theregister.com/2023/01/30/wan_router_ip_address_change/), which completed at 12:43.

### Why the block list didn't catch it

The AAA block list is a list of commands per router model that are known to have global impact. This command's global default behavior on the router platform being changed ["was not discovered during the high-impact commands evaluation for this router model"](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf), so it wasn't on the list. A command that's harmless on two vendors' hardware and destructive on a third is exactly what a per-model list has to get right, and here it didn't.

### Why the procedure didn't catch it

The SOP had been changed shortly before the scheduled work, to fix problems from earlier runs. Microsoft says ["our process was not followed"](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf): the changed SOP wasn't re-tested and didn't include proper post-checks. The emulator and lab steps exist precisely to find a vendor-specific behavior like this one.

### Why there were two waves

Monitoring alerted on-call engineers within 5 minutes. But the engineer making the change wasn't told, again because of the unqualified SOP. So they ran the same operation on the second Madrid router [33 minutes after the first](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf), and the whole WAN went through it again.

## How they fixed it

Mostly, the network fixed itself. By the time engineers identified the source at 08:20, automated recovery had already begun, and the WAN self-recovered by 09:35. The longer tail was cleanup: two routers that [couldn't recover automatically](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf), paused health systems that needed a manual restart, region-specific packet loss, and Microsoft 365 services that needed application pools restarted. Exchange Online's residual impact came from a race condition between BitLocker and a Shared Cache service on front-end machines after restarts.

## What changed afterwards

Microsoft's networking actions, per the [PIR](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf):

- **Audit and block similar commands** with widespread impact across all three vendors for all WAN router roles.
- **Real-time visibility** of approved-automated, approved-break-glass and unqualified device activity, so on-call engineers can see who is changing what.
- Mandatory operational training and attestation of following SOPs.
- A Change Advisory Board review of all SOPs still pending qualification.

Microsoft 365 also listed changes to keep unhealthy front ends out of rotation and to make SharePoint and Teams monitoring detect regional and service-wide issues instead of firing a flood of per-farm and per-feature alerts.

## The rule

Access controls scoped to "one device" don't scope the effect of a change when that device runs a protocol whose job is to tell every peer what changed. Classify commands by what they do to the protocol, verify that classification per vendor and per model, and block anything with domain-wide scope by default. And when a change is linked to an active alert, the person making the next change needs to know before they run it again.

## Sources

- [Microsoft, "Post Incident Report for Microsoft 365, MO502273", 6 February 2023 (third-party mirror on msxfaq.de)](https://www.msxfaq.de/cloud/marketing/mo502273_postincidentreport.pdf): Microsoft's official customer-ready PIR with the timeline, root cause and next steps. Primary source.
- [The Register, "WAN router IP address change blamed for global Microsoft 365 outage", 30 January 2023](https://www.theregister.com/2023/01/30/wan_router_ip_address_change/): news report quoting Microsoft's preliminary Azure postmortem, including the 07:05 start time and the paused health-maintenance systems.
