---
title: "A sidecar that didn't scale and a retry loop in VS Code kept GitHub down for almost eight hours"
dek: "A new traffic peak hit GitHub's Central US datacenter. An Istio sidecar reached its concurrency limit and didn't autoscale, because the policy only watched the main service. Load balancers ran out of flow capacity and authentication failed across the site. Recovery was then slowed by a latent client retry bug that multiplied Copilot token traffic about tenfold."
belief: "GitHub thought autoscaling covered its services. An Istio sidecar hit its limit and never scaled."
date: 2026-08-17
company: GitHub
kind: outage
topics: [capacity, cascading-failure, auth, networking]
stack: [istio, haproxy, kubernetes, vs-code, copilot]
duration_min: 467
impact: "Elevated errors and latency across github.com, authentication, Issues, Pull Requests, APIs, Actions and Copilot; at peak about 20% of web/API requests and about 50% of archive and raw-content downloads failed."
detected_by: alert
rule: "Autoscale on the component that saturates first, which may be the sidecar rather than your service, and give every client a retry budget so a partial failure can't multiply its own load."
postmortem: https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/
sources: [https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/, https://www.githubstatus.com/incidents/zkxwbgr0cnmx, https://github.blog/news-insights/company-news/github-availability-report-august-2026/, https://www.infoworld.com/article/4210864/github-restores-services-after-nearly-8-hour-outage-disrupts-actions-apis-prs-and-copilot.html]
---

# A sidecar that didn't scale and a retry loop in VS Code kept GitHub down for almost eight hours

On August 17, 2026, GitHub had an outage that [lasted 7 hours and 47 minutes](https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/). It hit github.com, authentication, GitHub Actions, the APIs, pull requests, issues and Copilot. At its worst, web and API error rates were [approximately 20%](https://www.githubstatus.com/incidents/zkxwbgr0cnmx), archive and raw-content downloads failed about 50% of the time, and SAML/OIDC sign-in, SCIM and Team Sync were affected too.

GitHub's CTO, Vladimir Fedorov, opened the write-up with: ["If you were trying to ship software that day, we let you down."](https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/) It was GitHub's second significant incident that month, after an Actions failure on August 6.

There was no bad deploy. GitHub says the outage [was not caused by a code or configuration change](https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/). Traffic reached a new peak, and one small component in the request path didn't scale with it.

## What happened

From GitHub's [root cause analysis](https://www.githubstatus.com/incidents/zkxwbgr0cnmx) on its status page, all times UTC:

- **13:28.** Elevated errors and latency begin.
- **13:40.** First public status update: "investigating reports of impacted performance".
- **13:45.** Status page reports an approximate 20% error rate across Pull Requests, Issues and more.
- **14:31.** Copilot shows degraded availability.
- **16:36.** "We identified the problematic component and have taken corrective actions." Most services recover as Central US recovers.
- **~18:03.** Actions degraded until approximately this time.
- **19:13.** Authentication token retries partially disabled; improvement seen.
- **21:02.** Copilot Token Service fully recovered.
- **21:15.** Incident resolved.

GitHub's own numbers for the length of the incident vary by document. The CTO's post and the status-page RCA both say [7h 47m](https://www.githubstatus.com/incidents/zkxwbgr0cnmx) (13:28–21:15). GitHub's [August availability report](https://github.blog/news-insights/company-news/github-availability-report-august-2026/) lists it as starting at 13:40 and "lasting 7 hours and 35 minutes", and its impact summary gives a duration of "approximately 6 hours 44 minutes". The availability report also measures the peak differently: [56.07% of front-door requests](https://github.blog/news-insights/company-news/github-availability-report-august-2026/) to the affected services failed or were slow at the edge, about 29K organizations saw at least one failed or slow request, and there were roughly 4.8M failed or slow requests in total. No data was lost.

## What the engineers believed

Two reasonable beliefs failed.

**Autoscaling covers the service.** GitHub's services run behind a service mesh (Istio), which puts a sidecar proxy in each pod next to the application. The autoscaling policy watched the [host service](https://www.githubstatus.com/incidents/zkxwbgr0cnmx), meaning the application. If the application had headroom, the pod looked healthy and nothing scaled.

**Retries help.** Gateways and clients retried failed requests, which is the usual way to ride out brief errors. GitHub later described its gateway retry logic as ["optimistic"](https://www.githubstatus.com/incidents/zkxwbgr0cnmx).

## What was actually going on

### The sidecar was the bottleneck

The RCA says the [immediate cause](https://www.githubstatus.com/incidents/zkxwbgr0cnmx) was network saturation on load balancers in Central US due to a new traffic peak. The chain started with an Istio sidecar pod reaching its concurrency limit and failing to autoscale, because of "a misconfigured policy that watched host service but not sidecar limits".

*Background, interpretation:* a sidecar handles every request going in and out of the pod, and it has its own limits, such as concurrency, connections and CPU. If autoscaling only looks at the application's metrics, the sidecar can be saturated while the application is idle, because requests are queueing in front of it. From the autoscaler's point of view, everything is fine.

### Then the load balancers

As requests backed up, the failure spread. Eventually [four HAProxy nodes exhausted their flow limits](https://www.githubstatus.com/incidents/zkxwbgr0cnmx), which degraded the gateway authentication path. Authentication sits in front of almost everything, so the auth latency and failures showed up across many services routed through that datacenter. Optimistic retry logic then [overloaded internal load balancers](https://www.githubstatus.com/incidents/zkxwbgr0cnmx).

```diagram
title: how one sidecar became a site-wide outage
flow!: traffic peak -> sidecar at limit -> no autoscale
flow!: HAProxy flow limits -> auth path degrades -> retries add load
note: the autoscaler watched the app, not the proxy in front of it
```

The fix for this phase was blunt. Some failing traffic was moved from Central US to Northern Virginia, and [pausing HAProxy on those nodes simultaneously](https://www.githubstatus.com/incidents/zkxwbgr0cnmx) produced immediate, broad recovery. *Interpretation:* saturated nodes still in rotation keep accepting work they can't finish; taking them out lets the rest of the fleet serve.

### The retry storm in Copilot

Most of GitHub was back by 16:36. Copilot took until 21:02, and that is the second half of the story.

Delayed replies from a single internal endpoint triggered [a latent retry bug in VS Code](https://www.githubstatus.com/incidents/zkxwbgr0cnmx) that amplified traffic by approximately 10x. A failed token operation could generate many extra requests and enter a retry loop. Copilot Token Service traffic went from a normal [7–9K RPS to 70–100K RPS](https://www.githubstatus.com/incidents/zkxwbgr0cnmx). Every client retrying made the service slower, which made more clients retry.

*Interpretation:* this is why retry storms are so hard to recover from. The fix for the original problem works, but the system can't come back up, because the load it sees during recovery is ten times normal. The overload is now generated by the clients, and you don't control the clients: here they were copies of an editor running on developers' machines.

GitHub fixed the retry storm in Northern Virginia by [temporarily reducing gateway retry logic](https://www.githubstatus.com/incidents/zkxwbgr0cnmx) with a PR and by blocking inbound Copilot Token Service token requests at the load balancers with a 403, then ramping traffic back up gradually, site by site. Recovery was further complicated by [scraping attacks on codeload endpoints](https://www.githubstatus.com/incidents/zkxwbgr0cnmx).

### "Not a configuration change"

The CTO's post says neither August outage was caused by a code or configuration change; [both were capacity failures](https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/). The RCA, though, names a ["misconfigured policy"](https://www.githubstatus.com/incidents/zkxwbgr0cnmx) as the origin. *Interpretation:* these fit together if you read "change" as "something deployed that day". Nothing changed on August 17. A latent misconfiguration had been there all along and only mattered once traffic reached a new peak. That is arguably the more dangerous kind, because no change log will point to it.

## The context

The post is candid about the growth behind this. Since April, monthly commits had grown [from 1.4 billion to 2.9 billion](https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/). GitHub says it had added more than 3 million CPU cores and 120 petabytes of high-speed storage, and that Azure now served [roughly 58% of GitHub's platform load](https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/), up from 12% in May. "That growth explains the pressure on our systems, but it does not excuse these outages."

At the time, coverage could only describe symptoms. Writing just after the incident, [InfoWorld](https://www.infoworld.com/article/4210864/github-restores-services-after-nearly-8-hour-outage-disrupts-actions-apis-prs-and-copilot.html) noted that GitHub had yet to identify the "problematic component" or explain why its failure took out so many services together.

## What changed afterwards

From the [RCA](https://www.githubstatus.com/incidents/zkxwbgr0cnmx) and the [CTO's post](https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/):

- **Fix autoscaling policies** to account for service-mesh sidecar concurrency and capacity.
- **Audit Istio request, concurrency and scaling limits** across the affected services.
- **Consistent retry limits, retry budgets and variable timeouts** across service-to-service calls, and a review of retry and backoff behaviour across gateways and clients.
- **Fix the VS Code retry behaviour** that amplified Copilot token traffic.
- **Review lower-priority CPU and memory alerts** to find components that could fail during sudden traffic spikes.
- **Better load-balancer capacity monitoring and regional failover safeguards.**
- Longer term: isolate critical systems and remove shared dependencies between them.

## The rule

Scale on the thing that saturates first. In a service mesh, that may be the proxy, not your code, so make sure your autoscaler can see it. And treat retries as load: every client and gateway needs a budget, backoff and a ceiling, because during recovery the traffic you have to survive is the traffic your own clients generate.

## Sources

- [Vladimir Fedorov, "The August 17 outage, and the work ahead", GitHub blog, August 20, 2026](https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/): GitHub's CTO on the outage, its cause, growth context and commitments.
- [GitHub Status, "Incident with GitHub.com" (zkxwbgr0cnmx)](https://www.githubstatus.com/incidents/zkxwbgr0cnmx): the root cause analysis with the sidecar, HAProxy and retry details, plus the live status updates.
- [GitHub, "GitHub availability report: August 2026"](https://github.blog/news-insights/company-news/github-availability-report-august-2026/): GitHub's monthly report, with its own duration and impact figures.
- [InfoWorld, "GitHub restores services after nearly 8-hour outage disrupts Actions, APIs, PRs and Copilot"](https://www.infoworld.com/article/4210864/github-restores-services-after-nearly-8-hour-outage-disrupts-actions-apis-prs-and-copilot.html): coverage published the morning after (IST).
