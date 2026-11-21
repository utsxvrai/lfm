---
title: "Reddit's Pi-Day outage: a renamed Kubernetes node label silently removed every Calico route reflector"
dek: "Upgrading Reddit's legacy Kubernetes cluster to 1.24 removed the 'master' node label. A years-old, uncommitted Calico route-reflector config selected nodes by that label, so the cluster's routing mesh lost all its reflectors and every route dropped."
date: 2023-03-14
company: Reddit
kind: outage
topics: [deploy, networking, rollback, backup]
stack: [kubernetes, calico, bgp, etcd, cri-o]
duration_min: 314
impact: "A 314-minute outage of Reddit on 14 March 2023, during US afternoon hours."
rule: "Configuration that nobody committed is configuration nobody will check before an upgrade; codify every selector and label dependency, and rehearse the rollback on the system that actually matters."
postmortem: https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/
sources: [https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/, https://web.archive.org/web/20260826130053/https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/]
---

# Reddit's Pi-Day outage: a renamed Kubernetes node label silently removed every Calico route reflector

On 14 March 2023, during the afternoon in the US, Reddit went down for [314 minutes](https://web.archive.org/web/20260826130053/https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/). Users saw an error page, or a home page with no posts, or nothing at all. The date was 3/14, so it became the Pi-Day outage.

The trigger was a planned Kubernetes upgrade, from 1.23 to 1.24, on one of the most important clusters Reddit runs: the one hosting the legacy part of its stack. About two minutes after the upgrade started, the site [came to a screeching halt](https://web.archive.org/web/20260826130053/https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/).

What makes this postmortem worth reading is the cause, which Reddit only found hours after the site was back: a single Kubernetes node label that the new version no longer applied, and a piece of network configuration that nobody on the team knew existed.

## What happened

From Reddit's [postmortem](https://web.archive.org/web/20260826130053/https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/), times UTC:

1. **Just after 19:00**: The engineer starts the upgrade. Everything looks fine for about 2 minutes. Then traffic collapses. The API server's logs explode at **19:04:49**, with log volume up 5x at that instant.
2. Responders are on the call by T+3 minutes. The affected cluster has **lost all metrics**. The only obvious symptom is DNS: lookups for Consul and in-cluster names fail, but public DNS resolves fine.
3. Reverting is "Plan A", but Kubernetes has no supported downgrade. Upgrades run schema and data migrations automatically, so going back means **restoring from backup**. Reddit's restore procedure had been tested in pilot clusters but never used on a production cluster, let alone this one, and was estimated in hours. They decide to try to fix forward.
4. About 30 minutes in there are still no clear leads. Another 30 minutes later, a subgroup of the Compute team forks off to prepare the restore. Others find that pods start and stop extremely slowly, images take minutes to pull, and **Calico**, the cluster's network plugin, is unhealthy. Restarting Calico components, rolling-restarting the control plane, and turning the whole control plane off and on don't help. Removing the Open Policy Agent admission webhook clears API timeouts, but not the outage.
5. After **more than two hours**, they decide to restore from backup. Terminating the worker nodes alone takes about 20 minutes.
6. The restore procedure was written for an end-of-life Kubernetes version and for Docker, not CRI-O, so it's rewritten live. Then AWS runs out of capacity for the control plane instance type. Then the new control plane nodes won't join, because the restore was done on a different node than the backup came from and the **TLS certificates don't match its hostname**. New certificates fix it.
7. Traffic is brought back in steps: 1%, then 5%, 10%, 20%, 35%, 55%, 80%, 100%, to avoid a thundering herd against cold caches and scaled-down services.

Then they went looking for the cause.

## What the engineers believed

Reddit tested upgrades properly. They ran against a dedicated set of test clusters first, then production clusters from [lowest criticality to highest](https://web.archive.org/web/20260826130053/https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/). By the time this cluster's turn came, 1.24 had gone through the rest of the fleet.

So the assumption was: **if the upgrade works on the other clusters, it works on this one.** And on the backup side: **we take a backup before every upgrade, so we can always go back.**

Both assumptions depended on the clusters being alike and the procedures being current. Reddit's own description of its clusters: ["We'd raised a set of pets, not managed a herd of cattle."](https://web.archive.org/web/20260826130053/https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/)

## What was actually going on

### How Calico distributes routes

Calico gives each node's pods routable IPs and tells every other node how to reach them. By default, as Reddit explains, every node peers directly with every other node in a full mesh and propagates its routes to all of them. (*Background:* Calico does this peering with BGP.) In a big cluster, Reddit says, the cost of all those connections "scales… poorly". (*Background:* with n nodes, a full mesh needs about n²/2 peerings.)

**Route reflectors** fix that. A few designated nodes peer with everything, and all other nodes peer only with the reflectors, which pass routes along. Reddit says Calico recommends them above about 100 nodes, and Reddit's cluster was well past that. On this cluster, Reddit had configured the **control plane nodes** as the reflectors, which makes sense in an autoscaled cluster where they're the only nodes that are always there.

The key consequence (our reading of how reflectors work, consistent with what Reddit saw): if a node has no reflector to peer with, it learns no routes to other nodes, and pod traffic between nodes has nowhere to go.

### The selector pointed at a label that disappeared

The route reflector config chose reflectors and peers with `nodeSelector` and `peerSelector` expressions targeting the label `node-role.kubernetes.io/master`. Reddit explains that in the 1.20 series, Kubernetes changed its terminology from "master" to "control-plane", and in 1.24 [removed references to "master", even from running clusters](https://web.archive.org/web/20260826130053/https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/).

So once the upgrade removed the old label, the selector that defined "which nodes are route reflectors" matched nothing. The logs show the moment: two seconds before everything broke, `calico-node` across the cluster began dropping routes to the first control plane node being upgraded, which was expected because it was going offline. What wasn't expected was that [all routes for all nodes began dropping as well](https://web.archive.org/web/20260826130053/https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/).

```diagram
title: a label rename removed the reflectors
flow: nodes label=master -> selector matches -> routes reflected
flow!: 1.24 drops label -> matches zero nodes -> all routes dropped
note: no error; the selector just matched zero nodes
```

Reddit's verdict: ["This is the cause of our outage. Kubernetes node labels."](https://web.archive.org/web/20260826130053/https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/)

A label selector that matches nothing isn't an error. It's a valid empty set. Nothing complained; the routing mesh simply had no hubs.

### Why tests didn't catch it, and why nobody suspected it

Two reasons, both from the postmortem:

- **Only the largest, most legacy clusters used route reflectors.** Upgrading the other clusters exercised the default full mesh, which doesn't depend on that label.
- **Nobody knew the config existed.** The reflectors were set up years earlier by the team that preceded the current Compute team, and everyone who knew about them had moved on. Part of Calico's route reflector configuration had to be fetched with Calico's own CLI, hand-edited and uploaded back, rather than managed through the normal Kubernetes API. Reddit hadn't built tooling for that, so the config was [committed nowhere](https://web.archive.org/web/20260826130053/https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/). One engineer happened to remember the feature during the postmortem and worked out that it was the cause.

There's also a reason the investigation was hard: the cluster's metrics are Kubernetes-native, so they died with its networking. The logging agent was low-level and survived, which is how they eventually found the Calico log lines in 3.9 billion log lines.

### Why the rollback was so risky

Kubernetes doesn't support downgrades, so rollback meant a control plane restore: terminate two control plane nodes, downgrade the third, restore data to it, then join new nodes. The procedure was prescriptive about which node to restore on; the backup procedure wasn't about which node to back up from. The restore ran on a different node from the backup, and because control plane hostnames were AWS defaults like `ip-10-1-0-42.ec2.internal`, the restored node's TLS certificates didn't match, so [new members couldn't connect to etcd](https://web.archive.org/web/20260826130053/https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/).

## How they fixed it

They rolled back by restoring the control plane from backup, regenerated certificates so the new control plane nodes could join, and ramped traffic back up in small steps, manually restarting some touchy legacy services. The restore had never been done on this cluster before, but it worked. They found the label cause only afterwards.

## What changed afterwards

Reddit describes the label as the proximate cause and **inconsistency** as the real one. Nearly every critical cluster was bespoke in some way. Its stated direction: standardize components across environments, add more pre-production clusters to test against, build tooling to manage whole-cluster lifecycles so clusters look alike and can be recreated, and ["codify everything that we can"](https://web.archive.org/web/20260826130053/https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/), documenting in detail where they can't. It also says the backup and restore process "must be improved" and that it intends to make cluster upgrades safe.

## The rule

Every label selector in your cluster is an implicit dependency on whoever applies that label. When an upgrade renames or removes a label, any selector on it silently matches nothing, and nothing errors. Keep all such configuration in version control so it can be searched before an upgrade, especially config managed through vendor CLIs. And a rollback you've only rehearsed on pilot clusters is a plan, not a capability: rehearse it on the cluster you'd actually need it for.

## Sources

- [Reddit Engineering, "You Broke Reddit: The Pi-Day Outage", r/RedditEng](https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/): the official postmortem. Primary source.
- [The same postmortem, archived](https://web.archive.org/web/20260826130053/https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/): the archived copy cited inline for every fact in this post.
