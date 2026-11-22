---
title: "A config change woke a dormant bug and Google Cloud's load balancers returned 502s for 32 minutes"
dek: "A feature that was compiled into Google Front End but not yet in service had a crash bug. A production configuration change triggered it intermittently, second-tier GFEs restarted over and over, and the capacity lost to restarts became 502s for customers."
belief: "Google Cloud treated a not-yet-enabled load balancer feature as inert. A config change made it crash: 502s."
date: 2018-07-17
company: Google
kind: outage
topics: [config-change, software-bug, capacity]
stack: [gcp, load-balancer, google-front-end]
duration_min: 32
impact: "Google Cloud HTTP(S) Load Balancers returned 502s on 33% to 87% of requests from 12:17 to 12:49 PDT; App Engine, Cloud Functions, Stackdriver's web UI and Dialogflow were affected."
detected_by: alert
rule: "Code that is shipped but not in service is still running code. Gate it off by default, make sure no config path can reach it before it has been tested, and keep a single view of recent config changes so a revert is the first thing you try."
postmortem: https://status.cloud.google.com/incident/cloud-networking/18012
sources: [https://status.cloud.google.com/incident/cloud-networking/18012]
---

# A config change woke a dormant bug and Google Cloud's load balancers returned 502s for 32 minutes

On Tuesday 17 July 2018, customers using Google Cloud App Engine, the HTTP(S) Load Balancer or the TCP/SSL Proxy Load Balancers saw [error rates between 33% and 87% for 32 minutes](https://status.cloud.google.com/incident/cloud-networking/18012). The errors were either HTTP 502 responses or connection resets.

Because the Global Load Balancer sits in front of a lot of Google's own products, the impact went past customer load balancers. Google lists [App Engine application serving, Google Cloud Functions, Stackdriver's web UI, Dialogflow and the Cloud Support Portal/API](https://status.cloud.google.com/incident/cloud-networking/18012) as affected for the duration. Cloud CDN cache hits [dropped 70%](https://status.cloud.google.com/incident/cloud-networking/18012). Kubernetes Engine services exposed through the Ingress resource returned 502s.

The cause was a bug in code that wasn't supposed to be running yet, reached by a configuration change rather than a deploy.

## What happened

From [Google's incident report](https://status.cloud.google.com/incident/cloud-networking/18012), all times US/Pacific:

| Time (PDT) | Event |
|---|---|
| 12:17 | HTTP(S) Load Balancers begin returning 502s for some requests. |
| 12:19 | Automated monitoring alerts Google's engineering team. |
| 12:44 | Team identifies the probable root cause and deploys a fix: the configuration change is reverted and affected GFEs stop restarting. |
| 12:49 | Fix becomes effective; the 502 rate returns to normal quickly. |
| 12:55 | Serving fully recovered, after several minutes of degraded latency while traffic returned and caches warmed. |

The status page's own updates differ slightly on the end. The update posted at 13:19 on the day said the issue was [resolved for all affected users as of 13:05](https://status.cloud.google.com/incident/cloud-networking/18012). The detailed analysis published on 18 July says serving fully recovered by 12:55, and the page header lists the incident as ending at 12:55.

Not everything was affected. Applications that used direct VM access or [Network Load Balancing were not affected](https://status.cloud.google.com/incident/cloud-networking/18012). That's a useful clue to where the failure lived: in the proxying layer, not in the network or the backends.

## What the engineers believed

The report describes the state of the code at the time. The GFE team was adding features to improve security and performance, and these features ["had been introduced into the second layer GFE code base but not yet put into service"](https://status.cloud.google.com/incident/cloud-networking/18012).

The working assumption behind that state is common and usually sound: a feature that is shipped in the binary but switched off is inert. Teams do this deliberately. It decouples deploying code from enabling it, so the binary can roll out slowly while the feature waits for its own launch.

The bug had also passed the normal gates. It ["had not been detected in either of testing and initial rollout"](https://status.cloud.google.com/incident/cloud-networking/18012). So the binary had been through testing and a production rollout and looked healthy, because the code path that crashed was not being exercised.

## What was actually going on

### Two tiers of Google Front Ends

Google's Global Load Balancers are built on a [two-tiered architecture of Google Front Ends (GFE)](https://status.cloud.google.com/incident/cloud-networking/18012). The first tier answers requests as close to the user as possible, which keeps connection setup fast. Those GFEs then route requests to a second tier of GFEs located close to the service the request is for. The design lets users connect with low latency anywhere in the world while the request crosses Google's own network to reach a backend in whatever region it lives.

The bug was in the second tier. Every request through the HTTP(S) or TCP/SSL proxy load balancers has to pass through a second-tier GFE to reach a backend, so trouble there shows up for every customer behind those products, in every region.

### A config change reached the dormant code

[From the report](https://status.cloud.google.com/incident/cloud-networking/18012): ["a configuration change in the production environment triggered the bug intermittently, which caused affected GFEs to repeatedly restart"](https://status.cloud.google.com/incident/cloud-networking/18012).

The report doesn't describe the configuration change or the feature in more detail. The general shape is familiar, though, so here is the background. A large proxy fleet takes its behavior from two inputs: the binary and the configuration pushed to it. Config pushes are often faster and less heavily staged than binary rollouts because they are seen as data, not code. But the binary decides what the config can do. If a code path exists in the binary, some combination of configuration can reach it. A feature "not in service" is protected only by whatever check keeps it off, and the report's first follow-up item (adding safeguards to disable features not yet in service) suggests that check wasn't strong enough here.

### Why restarts became 502s

A crashing process doesn't take away all capacity at once, but it takes away a lot more than the moment of the crash. The report says ["since restarts are not instantaneous, the available second layer GFE capacity was reduced"](https://status.cloud.google.com/incident/cloud-networking/18012).

Background on why: when a proxy process crashes, every in-flight request and connection on it is dropped. The process then has to start, load its configuration, warm up and be marked healthy again before it takes new traffic. If the trigger is still there, it crashes again soon after. In a crash loop, each task spends a large share of its time not serving. The rest of the fleet absorbs its traffic and runs short of capacity.

The report gives both outcomes. Some requests ["were interrupted (leading to connection resets)"](https://status.cloud.google.com/incident/cloud-networking/18012), meaning they were on a GFE when it went down. Others were ["denied due to a temporary lack of capacity while the GFEs were coming back online"](https://status.cloud.google.com/incident/cloud-networking/18012). For an HTTP load balancer, a 502 Bad Gateway is the standard response when the proxy couldn't get a valid response from the next hop, which is what a first-tier GFE sees when the second tier is dropping its connections. For the TCP/SSL proxy load balancers, which don't speak HTTP to the client, the report says connections [would have been reset after connections to backends failed](https://status.cloud.google.com/incident/cloud-networking/18012).

The intermittency explains the range of 33% to 87%. The bug didn't fire on every request, so at any moment some GFEs were up and serving and others were restarting, and the error rate moved with that mix.

```diagram
title: from a config push to 502s
flow: config change -> dormant feature -> GFE crash
flow!: GFE restarts -> less tier-2 room -> 502s and resets
note: the trigger stayed in place, so the GFEs kept crashing
```

### Why the CDN hit rate dropped too

The 70% drop in Cloud CDN cache hits is a knock-on effect. The report gives two reasons: fewer references to Cloud CDN URLs from services behind the load balancers, and ["an inability to validate stale cache entries or insert new content on cache misses"](https://status.cloud.google.com/incident/cloud-networking/18012). A CDN that can't reach the origin can't refresh what it has or fetch what it lacks, so its hit rate falls with the origin path.

## How they fixed it

Engineers were alerted within [3 minutes](https://status.cloud.google.com/incident/cloud-networking/18012) and started investigating. At 12:44 PDT they found the root cause and [reverted the configuration change](https://status.cloud.google.com/incident/cloud-networking/18012). With the trigger gone, the GFEs stopped restarting, returned to service and traffic went back to normal. Note that the fix was a config revert, not a code change: the bug was still in the binary, but nothing was calling it.

## What changed afterwards

Google listed [four changes](https://status.cloud.google.com/incident/cloud-networking/18012):

1. Additional safeguards to disable features not yet in service.
2. Harder testing for the GFE stack, to reduce the risk of a latent bug in production binaries that could cause a task to restart.
3. More isolation between different shards of GFE pools, to reduce the scope of failures.
4. A consolidated dashboard of all configuration changes for GFE pools, so engineers can more quickly observe, correlate and identify problematic changes.

The fourth item is worth reading next to the timeline. The alert fired at 12:19, shortly after the errors began at 12:17; the cause wasn't identified and reverted until 12:44. The report doesn't say what slowed diagnosis, but a dashboard that correlates recent config changes with symptoms targets exactly that step.

## The rule

Dormant code is live code. If a feature is in the binary, something can reach it, and a configuration push is the most likely thing to do so. Keep unreleased features off by a check that configuration alone can't flip by accident, test them as if they were already running, and stage config changes with the same care as binaries. When something breaks fleet-wide, make "what config changed in the last hour?" a question someone can answer from one screen, because a revert is often the fastest fix there is.

## Sources

- [Google Cloud Status Dashboard, "Google Cloud Networking Incident #18012"](https://status.cloud.google.com/incident/cloud-networking/18012): Google's incident page, including the live updates from 17 July 2018 and the detailed analysis posted on 18 July with impact, root cause and remediation.
