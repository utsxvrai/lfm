---
title: "Square went down overnight when a firewall change and a DNS upgrade overloaded its internal DNS"
dek: "A small host-firewall policy change expanded into a huge ruleset on every node. Combined with a DNS service upgrade, it knocked over Square's internal DNS servers; once node caches expired, services couldn't find each other, and the tools needed to fix it depended on the same DNS."
belief: "Square's small firewall policy change looked unrelated to DNS. It knocked over internal DNS."
date: 2023-09-07
company: Square
kind: outage
topics: [dns, config-change, cascading-failure, dependency]
stack: [dns, host-firewall, microservices]
impact: "Square products and services were unavailable from 1:54 PM ET on 7 September 2023; systems began recovering at 2:05 AM ET and payment services were restored by 5:19 AM ET on 8 September."
rule: "Your DNS, your deploy pipeline and your access tooling must not depend on each other in a loop; keep the recovery path on infrastructure the outage can't reach."
postmortem: https://developer.squareup.com/blog/incident-summary-2023-09-07/
sources: [https://developer.squareup.com/blog/incident-summary-2023-09-07/]
---

# Square went down overnight when a firewall change and a DNS upgrade overloaded its internal DNS

At [1:54 PM ET on 7 September 2023](https://developer.squareup.com/blog/incident-summary-2023-09-07/), Square's products and services became unavailable. Sellers who rely on Square to take card payments couldn't, unless their devices supported offline mode. Square Online websites stayed up, but [couldn't process payments](https://developer.squareup.com/blog/incident-summary-2023-09-07/).

Recovery didn't start until 2:05 AM ET the next day. Merchants got payment services back by 5:19 AM ET on 8 September, and offline payments were fully processed by 1:57 PM ET.

Square's root cause analysis is short, but its shape is a classic: a core dependency, internal DNS, failed in a way that also broke the tools engineers needed to repair it. Square ruled out a cyberattack and said there was [no evidence of a data breach or loss](https://developer.squareup.com/blog/incident-summary-2023-09-07/).

## What happened

Square's [incident summary](https://developer.squareup.com/blog/incident-summary-2023-09-07/) describes two changes that combined: "an unrelated change to our host-based firewalls combined with a DNS service upgrade caused unexpected load on our internal DNS servers and caused them to fail." Its timeline, all ET:

- **7 September, 11:04 AM**: A host-based firewall rule change is deployed to enable region communication, increasing the size of the on-node firewall ruleset.
- **1:54 PM**: Square products and services become unavailable.
- **2:02 PM**: Engineers are notified of infrastructure issues. Incident response begins with a DNS investigation.
- **2:47 PM**: Incident posted on issquareup.com.
- **2:52 PM**: Work begins to recover internal access and tooling.
- **3:56 PM**: Network traffic to the DNS servers is shed; manual work starts on bringing up new DNS servers.
- **6:00 PM**: DNS capacity increased, but it doesn't help. Manual deployment of networking changes starts, to re-enable authorization and access services.
- **6:29 PM**: Internal access services recover, so engineers can work in parallel on authorization and control plane services.
- **7:00 PM**: Manual deployment of networking changes to all data centers begins.
- **8:36 PM**: Square's deployment pipeline recovers.
- **10:06 PM**: DNS servers rebuilt.
- **11:52 PM**: A new configuration based on the **reverted ruleset** is built and pushed to DNS hosts.
- **8 September, 12:06 AM**: Some DNS hosts healthy; more internal tooling recovers. **12:55 AM**: All DNS servers healthy.
- **1:30 AM**: Partial recovery of service-to-service connectivity and edge routing.
- **2:05 AM**: Some Square systems begin to recover. **2:40 AM**: Payment traffic fully recovered.
- **4:18 AM**: Most products and services recovered. **5:19 AM**: Incident resolved.

The summary doesn't say when the DNS service upgrade was deployed or what it changed.

## What the engineers believed

Square's write-up doesn't describe what the team expected, so this is the general assumption implied by the setup, labeled as interpretation.

The firewall policy change was small and was described as "unrelated" to DNS. It was pushed by a central service that uses an [accelerated rollout strategy](https://developer.squareup.com/blog/incident-summary-2023-09-07/) to adapt quickly to environment changes. A small, unrelated policy change rolled out fast is normal practice in many shops: firewall policy feels like configuration, not code, and a few new rules shouldn't affect a service on another layer.

Separately, the recovery plan for any outage assumes engineers can reach their tools: access systems, the control plane and the deploy pipeline.

## What was actually going on

### A small policy, a large ruleset

Square's host firewall is managed centrally. The central service pushes **policies** to nodes, and each node **expands the policy into firewall rules**. In this case, ["a small policy change expanded to a much larger ruleset"](https://developer.squareup.com/blog/incident-summary-2023-09-07/). The large ruleset caused node instability, and combined with DNS's traffic pattern, DNS started failing requests.

*Background:* policy-to-rules expansion is common in host firewalls. A policy like "allow service group A to talk to service group B" becomes concrete rules for every address or port combination involved, so its size grows with the product of the groups, not the length of the policy. Many host firewalls evaluate rules in order for packets that don't match an existing connection, so a much larger ruleset can cost more per packet. DNS, typically lots of small UDP queries from many clients, is exactly the kind of traffic that pays that cost often. Square's summary doesn't specify the firewall technology or why DNS was the service that broke, so this explanation is background, not Square's stated mechanism.

### Caches hide the failure, then expire together

Square's services use DNS and mesh-based routing to find their dependencies. Without DNS, ["Square products, internal tools, and services cannot communicate"](https://developer.squareup.com/blog/incident-summary-2023-09-07/). There was a buffer: nodes cache DNS answers. Square says that once those node-based caches expired, services could no longer reach their dependencies and external requests failed.

*Background:* every cached DNS answer has a TTL. While it's valid, the client doesn't need the server. So when DNS servers fail, nothing visibly breaks at first. As entries expire, lookups start failing, gradually or all at once depending on how TTLs line up. A cache buys time, but if the servers aren't back before the TTLs run out, the outage arrives anyway, and it can be hard to tie it to a change made earlier.

```diagram
title: why DNS failure took everything with it
flow: DNS fails -> caches still valid -> services ok
flow!: caches expire -> lookups fail -> calls fail
flow!: tools need DNS -> manual rebuild -> hours of outage
note: the repair path shared the broken dependency
```

The timeline shows a gap between the firewall change at 11:04 AM and the outage at 1:54 PM. Square's summary doesn't explain the gap. Cache expiry, the DNS upgrade's timing, or a gradual rollout could each account for some of it; the source doesn't say which.

### The repair tools were behind the same outage

This is what turned a DNS failure into an overnight outage. Square says ["many services used for troubleshooting and recovery were also impacted"](https://developer.squareup.com/blog/incident-summary-2023-09-07/), which extended the outage. The timeline shows the order engineers had to rebuild in: first internal access and tooling (2:52 PM), then manually deployed networking changes to get authorization and access services back (6:00 to 6:29 PM), then the deployment pipeline (8:36 PM), and only then the DNS rebuild and the reverted ruleset (10:06 to 11:52 PM).

Adding DNS capacity at 6:00 PM didn't help, which fits a problem in the nodes' firewall ruleset rather than in DNS server capacity. The fix that worked was configuration built from the reverted ruleset.

## How they fixed it

Square shed traffic to its DNS servers, manually deployed networking changes to recover access and authorization services and then all data centers, rebuilt its DNS servers, and pushed new configuration based on the **reverted firewall ruleset**. DNS was fully healthy by 12:55 AM, after which service-to-service connectivity, edge routing and payments recovered. Additional DNS capacity was added at 6:59 AM.

Offline payments taken by sellers during the outage were [deliberately deferred](https://developer.squareup.com/blog/incident-summary-2023-09-07/) for a number of hours as a precaution, with background processing starting at 9:52 AM.

## What changed afterwards

Square's listed remediations, per the [summary](https://developer.squareup.com/blog/incident-summary-2023-09-07/):

- **Move DNS to isolated infrastructure.**
- **Add monitoring and optimizations** for critical networking infrastructure.
- **Reduce dependencies between deploy and platform infrastructure** where feasible.
- Expand support for, and communication about, **Offline Mode**.

Square also acknowledged that the situation was made worse by its communication frequency and delayed support responses.

## The rule

Look for loops in your dependency graph: DNS depends on hosts whose firewall is pushed by a service that depends on DNS; your deploy pipeline depends on the platform it deploys. When the shared dependency fails, every loop turns into a manual rebuild. Isolate DNS from the changes that can break it, measure what a policy expands into before you push it fast, and keep a recovery path that works without the systems you might be recovering.

## Sources

- [Square, "Incident Summary: 2023-09-07", Square Developer blog, 15 September 2023](https://developer.squareup.com/blog/incident-summary-2023-09-07/): the official incident summary with the timeline, root cause and remediation. Primary source for every incident fact in this post.
