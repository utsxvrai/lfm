---
title: "Skype went down for 24 hours when slow server replies crashed the users' PCs that ran its network"
dek: "Slow responses from overloaded offline-messaging servers crashed one Windows client version. Some of those clients were supernodes, the users' machines that held Skype's peer-to-peer network together, and the rest of the supernodes went down under the extra load."
belief: "Skype expected its P2P network to absorb client crashes. One buggy version took down the supernodes."
date: 2010-12-22
company: Skype
kind: outage
topics: [software-bug, cascading-failure, capacity, networking]
stack: [p2p, windows]
duration_min: 1440
impact: "Skype functionality was unavailable to many users for approximately 24 hours, from December 22 0800 PST to December 23 0800 PST."
rule: "When clients are part of your infrastructure, a client bug is an infrastructure bug, and a server that answers slowly has to be treated as a likely input to every client version still out there."
postmortem: https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html
sources: [https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html]
---

# Skype went down for 24 hours when slow server replies crashed the users' PCs that ran its network

Three days before Christmas 2010, Skype stopped working for a large share of its users. The failure lasted [approximately 24 hours, from December 22, 0800 PST to December 23, 0800 PST](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html), according to the postmortem by Skype's CIO.

Most outages start in a company's own infrastructure. This one began on Skype's servers and spread through its users' computers, because in 2010 those computers *were* a large part of Skype's infrastructure. Skype ran on a peer-to-peer network. Some ordinary users' machines were promoted to "supernodes" that acted as directories and connection brokers for everyone else. When a client bug crashed a quarter of them, the network had to run on the rest, and they couldn't carry it.

To restore service, Skype ended up running [several thousand](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html) of its own supernode instances on its own hardware.

## What happened

From Skype's postmortem:

1. On Wednesday, December 22, a cluster of support servers [responsible for offline instant messaging became overloaded](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html). Some clients got delayed responses from them.
2. One Windows client version, 5.0.0.152, [did not properly process the delayed responses](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html) and crashed. The newer 5.0.0.156, older 4.0 versions, and the Mac, iPhone, TV and enterprise clients were not affected by this first problem. (The post writes the version both as "5.0.0152" and "5.0.0.152.")
3. [Around 50% of all Skype users](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html) were on 5.0.0.152, and the crashes took down about 40% of those clients, which is about 20% of all clients. Those clients included [25–30% of the publicly available supernodes](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html).
4. Skype disabled the overloaded servers and stopped clients from sending requests to them, but by then many supernodes had already gone down.
5. Users restarted their crashed clients, all of which reconnected at once. That happened just before the [usual daily peak at 1000 PST](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html), and supernode traffic reached [about 100 times](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html) what's normal for that time of day.
6. Supernodes protect themselves by shutting down when operating parameters go outside expected ranges. Skype believes the extra load pushed some of them past those limits. Each one that shut down added load to the others, a [positive feedback loop](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html) that led to near-complete failure a few hours after the trigger.

## What the engineers believed

The postmortem itself asks the question that frames this section: "[If approximately 20% of total Skype clients failed, why was there a much bigger disruption to Skype functionality?](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html)"

Losing a fifth of the clients sounds survivable. A network made of users' computers is built to expect constant churn: machines sleep, laptops close, connections drop. Skype says outright that it expected *some* load increase when supernodes fail: "[While we expect this kind of increase in the instance of a failure...](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html)"

The assumption underneath is that **failures in a P2P network are independent and spread out**: random machines leave at random times, and the network has slack to absorb that. That holds for ordinary churn. It didn't hold here, because the failures were *correlated*. Every machine running the same build hit the same bug at the same moment, triggered by the same slow server. And the users who crashed didn't leave quietly. They restarted and reconnected immediately, at the busiest time of day.

## What was actually going on

### What a supernode does

Skype's post describes a supernode as a node that "[takes on additional responsibilities](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html)": it acts like a directory, helps set up connections between other clients, and forms local clusters of typically several hundred peers per supernode. In other words, supernodes were Skype's distributed control plane, hosted for free on users' PCs.

The arithmetic follows from that. If each supernode serves several hundred peers and a quarter of the supernodes go down, the peers they served have to find new ones. If that load spread evenly, which is simple arithmetic and not a figure from Skype, the remaining three-quarters would each carry about a third more than usual. And as the post notes, a restarted supernode [takes some time](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html) before it's available to the network again, so the lost capacity doesn't come back right away.

### Three things on top of each other

The 100× traffic figure only makes sense as several effects stacked together:

- **Orphaned peers.** Clients whose supernode vanished looked for another.
- **Restart storm.** A large share of users were restarting crashed clients, and each restart is a full reconnect with login, presence and contact sync, not a quiet reattach.
- **Peak hour.** It happened just before the daily peak, when normal load was already at its highest.

```diagram
title: how 20% of clients took down the network
flow: slow server replies -> v5.0.0.152 crashes -> 25-30% supernodes
flow!: survivors overloaded -> self-protect stop -> even more load
note: each supernode that shut itself down added load to the others
```

### Why self-protection made it worse

The final step is the hardest one to see coming. Supernodes had a [built-in mechanism to protect themselves](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html) and the user's machine when parameters went outside expected ranges. On any one PC, that's the right design: Skype shouldn't take over someone's laptop because the network is busy.

But every supernode had the same thresholds, and every one was getting more load. So each one that backed off pushed its share onto its neighbors, which made them more likely to cross their own thresholds. A sensible local rule became a global cascade. The same thing happens to a server fleet when every node's health check trips at the same load. As each node leaves the pool, the remaining ones get closer to their limits.

### Why "slow" crashed the client

Skype didn't publish the code-level bug, only that delayed responses "[were not properly processed](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html)" by that build. The general lesson is about test coverage. Most client testing uses servers that are healthy, or that fail cleanly by refusing the connection or returning an error. A server that's *alive but slow* exercises different code paths: timeouts firing while a response is still arriving, responses landing after the client has moved to another state, or replies arriving out of order. These paths seldom run in development and rarely in beta. Skype notes that the v5 release went through "[months of Beta testing with hundreds of thousands of users](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html)." They mostly show up when the backend is overloaded, which is exactly when you can least afford the client misbehaving.

## How they fixed it

Skype couldn't get users' PCs to come back as supernodes any faster, so it added supernodes of its own. The team [introduced hundreds of instances of the Skype software](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html) as dedicated supernodes, nicknamed "mega-supernodes."

That wasn't enough at first. By late Wednesday night PST, only [about 15–20%](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html) of user connections were recovering and supernode load was still unusually high, so the team added [several thousand more mega-supernodes](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html) overnight. Most users could connect normally by early morning on December 23. To get the capacity, Skype borrowed resources normally used for Group Video Calling, and returned them in time to restore that feature before Christmas. By Friday, [several tens of thousands of supernodes](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html) were supporting the network, and Skype withdrew most of the mega-supernodes while keeping some running over the holidays.

## What changed afterwards

Skype's postmortem lists four commitments:

- **Hotfixes and auto-update.** A fix for the 5.0 bug [had been provided prior to the incident](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html), but half the user base was still on the affected build. Skype said it would review how it delivers automatic updates "so that we can help keep everyone on the latest Skype software."
- **Detection and recovery.** Find ways to detect problems sooner and recover faster.
- **Testing.** Review testing processes, even though v5 had gone through long internal and beta testing.
- **Capacity.** Keep reviewing and investing in the capacity and resilience of core systems.

The auto-update point is the sharpest lesson. The fix existed before the outage. What failed was getting it onto the machines that needed it. When your infrastructure runs on clients you don't control, you are only as safe as the oldest build in the field.

## The rule

If your clients do infrastructure work, treat a client release like a server deploy: gradual rollout, the ability to roll it back, and a way to force upgrades. Test them against servers that are slow, not only against servers that are down. And watch out for self-protection rules that every node shares. When every node has the same threshold and the same load, those rules can trip together and become the cascade instead of stopping it.

## Sources

- [Skype Big Blog: "CIO update: Post-mortem on the Skype outage" (December 2010), via the Internet Archive](https://web.archive.org/web/2011/http://blogs.skype.com/en/2010/12/cio_update.html). Skype's postmortem: the offline-IM server overload, the 5.0.0.152 crash, supernode loss figures, the 100× load, mega-supernode recovery and follow-up commitments.
