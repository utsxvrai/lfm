---
title: "A power blip rebooted a quarter of GitHub's servers, and the app wouldn't start without Redis"
dek: "A brief power disruption rebooted one hardware class, and a firmware bug kept those machines from seeing their own disks. That took down whole Redis clusters, and the application had quietly come to need Redis just to boot."
belief: "GitHub spread Redis across racks. After a power cut one hardware class didn't come back, and the app needed Redis."
date: 2016-01-28
company: GitHub
kind: outage
topics: [power-cooling, hardware, dependency, cascading-failure]
stack: [redis, haproxy, chatops]
duration_min: 126
impact: "GitHub was unavailable for two hours and six minutes. Slightly over 25% of servers and several network devices rebooted."
detected_by: alert
rule: "Your processes must be able to start when their dependencies are down. A dependency in the boot path turns a partial outage into a total one."
postmortem: https://github.blog/2016-02-03-january-28th-incident-report/
sources: [https://github.blog/2016-02-03-january-28th-incident-report/]
---

# A power blip rebooted a quarter of GitHub's servers, and the app wouldn't start without Redis

At [00:23 UTC on Thursday, 28 January 2016](https://github.blog/2016-02-03-january-28th-incident-report/) (4:23pm Pacific on Wednesday), GitHub's primary data center had a brief disruption in the systems that supply power to its servers. [Slightly over 25% of servers and several network devices rebooted](https://github.blog/2016-02-03-january-28th-incident-report/).

GitHub then showed its unicorn page, an HTTP 503, to everyone. It stayed that way for [two hours and six minutes](https://github.blog/2016-02-03-january-28th-incident-report/).

The load balancers were fine, and so were most of the frontend application servers. The power came back. The outage lasted two hours because of two hidden facts that only surfaced when the power flickered: a firmware bug in one hardware class, and a dependency that the application had added to its own startup path without anyone intending it.

## What happened

From [GitHub's incident report](https://github.blog/2016-02-03-january-28th-incident-report/):

- **00:23 UTC.** Power disruption. About a quarter of servers reboot. Alerts go to multiple on-call engineers. The application starts returning 503s, because the load balancers and many frontends are up but the systems they depend on aren't.
- **00:32 UTC.** status.github.com is set to red, eight minutes after the site went down. GitHub called that delay ["unacceptably long"](https://github.blog/2016-02-03-january-28th-incident-report/). Part of the delay came from many ChatOps systems being on servers that had rebooted.
- **Early response.** Alerts for unreachable servers, exceptions about Redis connectivity and more connection attempts all looked like a network problem. The team spent time raising DDoS defenses and checking network health. A DDoS turned out not to be the cause.
- **Diagnosis.** Uptime data showed some servers had been up only a few minutes, while network equipment showed it hadn't rebooted at all. All the servers still offline were one hardware class. The servers that rebooted cleanly were a different class.
- **The second problem.** Application processes on healthy servers weren't starting. Logs showed they were failing because the Redis clusters were offline.
- **Recovery.** One group worked with on-site technicians to get the failed hardware booting. Another rebuilt the affected Redis clusters on other hardware. Once Redis was back, application processes started, HAProxy put them back in the pool, and the maintenance page came down. That was two hours and six minutes after the outage began.

## What the engineers believed

There were two beliefs, and both were reasonable.

**First: the Redis clusters were redundant.** Their members were deliberately spread across racks. If a rack loses power or a top-of-rack switch dies, the cluster survives. That's the standard defense against correlated failure, and it's what you'd do.

**Second: the application could tolerate losing a backend.** Most mature web apps treat their caches and queues as "nice to have" while running. If Redis is slow, a feature degrades, but the site stays up. GitHub's report shows that nobody had noticed the app now *required* Redis to start up at all. The report puts it this way: ["We had inadvertently added a hard dependency on our Redis cluster being available within the boot path of our application code."](https://github.blog/2016-02-03-january-28th-incident-report/)

## What was actually going on

### Failure domain one: hardware class, not rack

Spreading replicas across racks protects you from failures that follow the physical layout: power to a rack, a switch, a row's cooling. It doesn't protect you from failures that follow something else that all the replicas share.

Here the shared trait was the hardware model. The servers that didn't come back [all shared the same hardware class](https://github.blog/2016-02-03-january-28th-incident-report/) and were [spread across many racks and rows](https://github.blog/2016-02-03-january-28th-incident-report/). Several Redis clusters lost every member at once, even though those members were in different racks, because they were all the same kind of machine.

The reason those machines didn't come back was a firmware problem. Remote console screenshots showed boot failures because [the physical drives were no longer recognized](https://github.blog/2016-02-03-january-28th-incident-report/). The report later calls it a known firmware issue. Engineers had to work with facility technicians to bring the servers up [from a cold state by draining the flea power](https://github.blog/2016-02-03-january-28th-incident-report/) so the disks would show up again. (Flea power is the leftover charge held in a machine's components after it loses mains power. Draining it forces a true cold start instead of a warm one.) The report doesn't say why the disks only disappeared when the power flickered.

The general lesson: your failure domains are every property your replicas have in common. Rack and power feed are obvious. Hardware model, firmware version, kernel build and config push are less obvious, and they can take out every replica at once just as surely.

### Failure domain two: the boot path

Losing Redis should have degraded GitHub. It took GitHub down because of where the dependency lived in the code.

There's a big difference between a dependency used **at request time** and one used **at boot time**:

- **Request-time dependency.** The process starts, binds its port, passes its health check and serves traffic. When a request needs Redis and Redis is down, that request fails or degrades. Other requests keep working.
- **Boot-time dependency.** Something in startup, such as an initializer or a connection that must succeed, or a warm-up step, needs Redis. If Redis is down, the process crashes or never becomes ready. The health check fails, the load balancer has nothing to send traffic to, and **every** request fails, including ones that never touch Redis.

GitHub's frontend servers were mostly unaffected by the power event. But the processes on them were restarting, and [processes were failing to start because the Redis clusters were offline](https://github.blog/2016-02-03-january-28th-incident-report/). Healthy machines couldn't serve because a dependency they rarely needed was missing at the one moment they checked for it.

```diagram
title: why healthy servers stayed dark
flow: power blip -> one hw class down -> Redis clusters gone
flow!: app process boots -> needs Redis -> no backends
note: disks unseen until flea power drained
```

### Failure domain three: the recovery tooling

Recovery itself had dependencies. Many ChatOps systems were on rebooted servers, which caused ["some amount of confusion and delay"](https://github.blog/2016-02-03-january-28th-incident-report/) at the start of the response. Rebuilding Redis on spare hardware was slowed because [a number of crucial internal systems were on the offline hardware](https://github.blog/2016-02-03-january-28th-incident-report/), which made provisioning new servers harder. The tools needed to recover the system were partly down along with it.

### The misleading symptoms

The first signals were unreachable servers, Redis connection exceptions and more connection attempts, which together pointed to the network. The team raised DDoS defenses first. GitHub says this was quick and routine and didn't distract from other work. The real clue came from comparing uptimes: servers with fresh uptimes next to network gear without them meant power, not network.

## How they fixed it

Two parallel workstreams, per the [report](https://github.blog/2016-02-03-january-28th-incident-report/):

1. **Hardware.** Engineers and on-site technicians brought the failed servers back from a cold state by draining flea power so the disks would be visible.
2. **Redis.** Another group rebuilt the affected Redis clusters on alternate hardware and restored their data onto standby equipment.

With Redis back up, application processes started and passed their health checks, and HAProxy added them back to the pool. After checking the site worked, GitHub removed the maintenance page and moved to status yellow. The following hours went into confirming there was no data loss, and GitHub says code, issues, pull requests and other critical data remained safe.

## What changed afterwards

GitHub listed these changes in the [report](https://github.blog/2016-02-03-january-28th-incident-report/):

- **Firmware.** Updating the firmware across the fleet, and having tooling open issues automatically when new firmware is released so changelogs get reviewed against their environment.
- **Boot without dependencies.** Updating the test suite to ensure application processes start even when certain external systems are unavailable, and improving circuit breakers so features degrade gracefully when backends are down. GitHub says there's a minimum set of required dependencies, but it would be more aggressive about shortening that list.
- **Internal systems as critical as production.** Reviewing availability requirements for internal systems such as server provisioning: if they're needed to recover from an outage, ["they must be as reliable as the system being recovered."](https://github.blog/2016-02-03-january-28th-incident-report/)
- **People and process.** Better cross-team communication, predefined escalation strategies for all-hands incidents, and clearer messaging to users during an event.

## The rule

Write a test that starts your service with each dependency unavailable, and assert that it boots, passes its health check and serves whatever doesn't need that dependency. It's the only reliable way to catch a boot-path dependency, because they get added by accident: an eager connection in an initializer, a cache warm-up, a feature-flag client that blocks until its first fetch.

Next, list your failure domains by what replicas *have in common*, not just by where they sit. Spreading across racks protects against power and switch failures. It does nothing if every replica is the same hardware class with the same firmware bug. And whatever you need to *recover*, like chat, provisioning and runbooks, has to survive the outage you're recovering from.

## Sources

- [GitHub, "January 28th Incident Report", 3 Feb 2016](https://github.blog/2016-02-03-january-28th-incident-report/): GitHub's official postmortem, covering the power event, hardware-class failure, Redis boot dependency, recovery timeline and planned changes.
