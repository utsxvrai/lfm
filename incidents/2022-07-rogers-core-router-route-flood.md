---
title: "Rogers deleted a route filter during cleanup and 900,000 routes crashed its core, cutting 12 million Canadians off"
dek: "As part of a phased core-network upgrade, staff removed an Access Control List policy filter from distribution routers. Without it, one router pushed over 900,000 routes into core routers that normally saw about 10,000, and the core routers, with no overload limit configured, crashed within minutes. Wireless, wireline and 9-1-1 shared that core."
date: 2022-07-08
company: Rogers
kind: outage
topics: [config-change, networking, capacity, human-error]
stack: [ip-core, routers, acl]
impact: "More than 12 million customers lost wireless and wireline services, including 9-1-1 calling, from 4:58 EDT on 8 July to 7:00 EDT on 9 July 2022 as services were gradually restored."
rule: "Every router that accepts routes needs a hard limit on how many it will take, and a change that removes a filter is never low-risk just because the previous phases went fine."
postmortem: https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm
sources: [https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm, https://crtc.gc.ca/eng/publications/reports/xona2024.htm]
---

# Rogers deleted a route filter during cleanup and 900,000 routes crashed its core, cutting 12 million Canadians off

In the early morning of 8 July 2022, Rogers Communications lost its IP core network. Canada's telecom regulator, the CRTC, later published an independent assessment. It says the outage lasted [from 4:58 EDT on 8 July 2022 to 7:00 EDT on 9 July 2022 as services were gradually restored](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm).

[More than 12 million customers](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm) lost wireless and wireline service: mobile, home internet, business connectivity, and institutions that provide critical services such as Interac e-Transfer and electronic payments. And because it was the core that failed, [9-1-1 calling](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm) stopped working too.

The trigger was a configuration cleanup. The reason it took down everything was a missing safety limit on the routers at the center of the network.

## What happened

From the [CRTC assessment's executive summary](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm):

- Rogers' wireless and wireline networks **share a common IP core network**, which aggregates and routes traffic internally and to the internet.
- In the weeks before 8 July, Rogers was carrying out a **seven-phase upgrade** of that core. The outage happened during phase six.
- In that phase, Rogers staff removed an **Access Control List policy filter** from the configuration of the **distribution routers**, [in an effort to clean up the configuration files](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm).
- That released a flood of IP routing information into the **core routers**, which exceeded their capacity to process it. The core routers [crashed within minutes](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm) of the filter being removed.
- With the core down, user traffic couldn't be routed. Mobile, home phone, internet, business wireline and 9-1-1 stopped working.

The assessment notes that Rogers [could not pinpoint the root cause for about 14 hours](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm) from the start of the outage.

## What the engineers believed

**"This phase is low risk."** Rogers had initially rated the seven-phase process as "High" risk. But as earlier phases completed without problems, [the risk assessment algorithm downgraded the risk level for the sixth phase](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm) to "Low". A Low rating meant no extra scrutiny, no higher-level approvals, and no lab testing for this change.

That's a reasonable-sounding heuristic: a project whose steps keep succeeding is probably being run well. But it rated the **project's track record**, not the **change itself**. The CRTC assessment says downgrading to Low for changing an ACL filter in a routing policy [contravenes industry norms](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm), which call for high scrutiny and lab testing for such changes.

**"The filter is cruft."** The change was framed as cleanup. The filter that was removed was the thing that [prevented IP route flooding](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm). The change management process, including audits of change parameters, didn't flag it.

## What was actually going on

### Distribution, core, and what the filter did

*(Background, using the report's definitions.)* In a carrier IP network, **distribution routers** sit between the access layer, which connects end users, and the **core**, which aggregates all the traffic. Routers learn where to send packets by exchanging routes with each other. The core routers keep a table of those routes and use it to forward every packet.

The report defines an Access Control List policy filter as [a table that provides the rules on how the router ought to manage the packet traffic](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm). In this case, the filter on the distribution routers limited which routing information they passed up to the core.

The numbers, from the report's footnote, quoting Rogers: about **10,000 routes** are advertised into the core router when the filter is present. When it was removed, [a single distribution router released over 900,000 route data into the core routers](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm).

*(Background.)* Routers keep routes in memory and recompute best paths when routes change. A sudden flood forces a huge amount of processing and memory use at once. On hardware sized for the normal load, that can exhaust resources and crash the routing process or the whole router.

```diagram
title: the filter was the limit
flow: distribution router -> ACL filter -> ~10,000 routes
flow!: filter removed -> 900,000+ routes -> core routers crash
note: core had no maximum-routes limit to stop it
```

### The missing second line of defense

The CRTC assessment is direct about this. The outage [exposed the absence of overload protection on the core network routers](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm). Had the core routers been configured with an overload limit, the maximum acceptable amount of routing data, the failure ["could have been prevented"](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm).

*(Background.)* Many router platforms support a maximum-prefix or route-limit setting per session: if a neighbor sends more routes than the limit, the router drops that session or stops accepting routes, instead of trying to absorb them. It turns "neighbor misbehaves" into "one session down" instead of "router down".

So the network relied on one control (the filter at the edge of the core) with no backstop in the core itself. Removing the one control removed all protection.

### Why everything went down together

The CRTC says the outage was [not the result of a design flaw](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm) in the core architecture, which is typical for a Tier 1 provider. But because wireless and wireline share the same core, the scope was extreme: ["a catastrophic loss of all services"](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm). The report calls this converged design a common choice that balances cost against performance.

On 9-1-1, the report recommends Rogers test emergency roaming to other carriers for precisely the scenario seen that day, [wherein the radio network was up and the core network was down](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm).

### Why it took so long to recover

The assessment gives several reasons:

- **Management access depended on the core.** Rogers' management network relied on the IP core. When the core failed, remote staff couldn't reach it, and the network operations centre had no backup connectivity from another provider. Rogers had to [dispatch staff to remote sites](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm) to physically access routers.
- **Staff couldn't talk to each other.** They used Rogers' own mobile and internet service. Rogers had to send SIM cards from other mobile operators to its remote sites.
- **Missing information.** Staff didn't initially have the error logs from the failed routers.
- **Too many changes in one window.** Rogers had made [multiple configuration changes during the maintenance window](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm), so it was hard to decide which change ticket to roll back.

The last two led to misdiagnosing the root cause in the first hours. Once the cause was found, the report says restoration proceeded methodically.

## How they fixed it

The executive summary doesn't detail the overnight recovery beyond saying services were gradually restored after the root cause was found. It doesn't say exactly how the filter was restored or the routers recovered, so that's not described here.

## What changed afterwards

[Rogers' measures](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm), as assessed by the CRTC:

- **Safeguards on the core routers** to prevent flooding of IP routing data.
- **A separate physical and logical management network**, plus backup connectivity from third-party providers to the NOC and critical remote sites.
- **Separate IP cores for wireless and wireline**, announced but still a work in progress at the time of the report.
- **Change management:** a new risk assessment algorithm, automation, more lab testing, better collaboration between operations and engineering.
- **Incident management:** better guidelines, alarm prioritization, automated rollbacks, and backup communications from third parties for response staff.

The CRTC judged these measures [satisfactory](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm), and recommended more, including testing emergency roaming, telling customers how to reach 9-1-1 during an outage, and sharing root causes with the wider operator community.

## The rule

Never let one filter be the only thing between a router and a flood. Put hard limits on what every router will accept, so a mistake upstream costs a session, not the core. Rate a change's risk by what it touches (removing a routing filter is high-risk on any day), not by how well the previous phases went. Keep the number of changes in one maintenance window small enough that you can tell which one to roll back. And keep your management network, and your staff's phones, off the network you might have to rescue.

## Sources

- [CRTC, "Assessment of Rogers Networks for Resiliency and Reliability Following the 8 July 2022 Outage – Executive Summary" (archived copy)](https://web.archive.org/web/20261111032635/https://crtc.gc.ca/eng/publications/reports/xona2024.htm): the regulator's independent assessment, covering the root cause, the 10,000 vs 900,000 routes figure, the risk downgrade, recovery obstacles, Rogers' measures and recommendations. All citations above link to this archived copy.
- [CRTC, same report (original URL)](https://crtc.gc.ca/eng/publications/reports/xona2024.htm): the original location; it returned a browser security check to automated requests when this post was written.
