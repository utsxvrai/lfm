---
title: "An empty query parameter told Cloudflare's cleanup job to delete every BYOIP prefix"
dek: "A new automated sub-task asked the Addressing API for prefixes pending deletion with `?pending_delete` and no value. The server only took the 'pending' branch when the value was non-empty, so it returned all BYOIP prefixes, and the task began deleting them. About 1,100 prefixes were withdrawn from the Internet, and about 300 needed a global config push to restore."
date: 2026-02-20
company: Cloudflare
kind: outage
topics: [automation, bgp, software-bug, rollback]
stack: [bgp, byoip, addressing-api]
impact: "About 1,100 of Cloudflare's 4,306 BYOIP prefixes were withdrawn via BGP, making some customers' services unreachable; the last were restored at 23:03 UTC."
rule: "An API parameter that means 'narrow this' must never fall back to 'everything' when it's empty, and a job that deletes must have a ceiling on how much it deletes before a human looks."
postmortem: https://blog.cloudflare.com/cloudflare-outage-february-20-2026/
sources: [https://blog.cloudflare.com/cloudflare-outage-february-20-2026/, https://www.cloudflarestatus.com/incidents/kwy3dt82bwbt, https://laravel.com/blog/laravel-cloud-incident-report-february-20-2026]
---

# An empty query parameter told Cloudflare's cleanup job to delete every BYOIP prefix

On 20 February 2026, a subset of Cloudflare customers who use its Bring Your Own IP (BYOIP) service saw [their routes to the Internet withdrawn via BGP](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/). Their own IP ranges, which Cloudflare announces on their behalf, stopped being announced. Their applications were still running, but nothing could reach them. Connections timed out.

About [1,100 prefixes were withdrawn](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/) before Cloudflare stopped it, a quarter of all BYOIP prefixes it advertises. The website for Cloudflare's own resolver, one.one.one.one, returned HTTP 403 errors (the 1.1.1.1 resolver itself, including DNS over HTTPS, was not affected). Cloudflare says plainly: ["We let you down today."](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/)

The cause was one line of client code and one `if` in the server, which disagreed about what an empty query parameter means.

## What happened

From the [postmortem's timeline](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/), all times UTC:

- **5 Feb 21:53.** The broken sub-process is merged into the code base.
- **20 Feb 17:46.** An Addressing API release containing it completes.
- **17:56.** The sub-process begins executing. Prefixes start being withdrawn. **Impact starts.**
- **18:13.** Cloudflare engaged for failures on one.one.one.one.
- **18:18.** Internal incident declared.
- **18:21.** The Addressing API team is paged.
- **18:46.** An engineer terminates the sub-process and disables regular execution.
- **19:11.** Mitigation begins.
- **19:19.** Customers start re-advertising their prefixes from the dashboard.
- **19:44.** Engineers begin database recovery for removed prefixes.
- **20:30.** A release restores withdrawn prefixes that still have their service bindings.
- **21:08.** A global machine configuration rollout begins for the rest.
- **23:03.** That rollout completes. **Impact ends.**

### How long did it last?

The postmortem says the total duration was [6 hours and 7 minutes](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/). Its own times don't quite add up to that. The intro gives the start as 17:48 UTC, while the timeline marks impact starting at 17:56. By my own arithmetic, either start to the 23:03 end is a little over five hours, not six. The post also says Cloudflare reverted many advertisement changes "around 20:20 UTC", where the timeline says 20:30. I don't know which figures are right, so this post gives the timestamps and doesn't state a duration.

Outside views differ again. [Cloudflare's status page](https://www.cloudflarestatus.com/incidents/kwy3dt82bwbt) shows the incident from 18:45 to 23:50 UTC, the time it was opened publicly to the time it was marked resolved. [Laravel Cloud](https://laravel.com/blog/laravel-cloud-incident-report-february-20-2026), one affected customer, measured its own impact as about 3 hours and 15 minutes, 18:42 to 21:57 UTC.

## What the engineers believed

This change was meant to make things **safer**. Removing a BYOIP prefix from Cloudflare was a regular customer request still [done manually](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/), and Cloudflare considers manual actions close to production risky. Under its "Code Orange: Fail Small" programme, which pushes all changes toward safe, automated, health-mediated deployment, the team automated it: a regularly running sub-task that checks for BYOIP prefixes that should be removed, then removes them.

The task's author believed that asking the API for `/v1/prefixes?pending_delete` returns the prefixes pending deletion. That's how the parameter reads, and it's how a lot of APIs treat a bare flag: present means true.

Testing supported that belief, as far as it went. Cloudflare says testing and code review [focused on the BYOIP self-service API journey](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/) and passed. What wasn't tested was a task-runner changing user data on its own, with no explicit input. Staging data and mock data didn't expose it either.

## What was actually going on

### The client

From the postmortem, the cleanup sub-task's query:

```go
resp, err := d.doRequest(ctx, http.MethodGet, `/v1/prefixes?pending_delete`, nil)
```

The parameter is there, with no value.

### The server

And the API handler:

```go
if v := req.URL.Query().Get("pending_delete"); v != "" {
    // ignore other behavior and fetch pending objects from the ip_prefixes_deleted table
    prefixes, err := c.RO().IPPrefixes().FetchPrefixesPendingDeletion(ctx)
    ...
    api.Render(ctx, w, http.StatusOK, renderIPPrefixAPIResponse(prefixes, nil))
    return
}
```

`Query().Get("pending_delete")` returns the parameter's value as a string. For `?pending_delete` with nothing after it, that's the empty string `""`, exactly what you'd get if the parameter were absent. So `v != ""` is false, the "pending" branch is skipped, and the handler carries on to its normal behaviour. Per Cloudflare, the server [interprets this as a request for all BYOIP prefixes](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/).

*Background:* the snippets look like Go's standard `net/url` API, where `Query().Get` returns `""` both for a missing key and for a key with no value. If you need to tell them apart, you have to check `Has` or look in the map directly. The postmortem doesn't name the language; this is my reading of the code.

### The sub-task trusted the answer

The sub-task then treated everything it got back as queued for deletion. It [began systematically deleting all BYOIP prefixes](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/) and their dependent objects, including **service bindings**, the records that attach a product like Magic Transit, Spectrum or CDN to a prefix, until someone noticed and an engineer shut it down.

```diagram
title: one missing value, two meanings
flow: ?pending_delete=x -> pending branch -> pending prefixes only
flow!: ?pending_delete -> Get() returns "" -> all BYOIP prefixes -> deletion begins
note: the server read "no value" as "no filter"
```

Two things limited the damage. The change was applied [iteratively and not instantaneously](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/) across BYOIP customers, and it was stopped at 18:46 after [1,100 of the 4,306](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/) BYOIP prefixes had been withdrawn. Cloudflare first got engaged through failures on one.one.one.one, its own resolver's website.

### Why the Addressing API made this fast

The Addressing API is the authoritative record of which addresses exist on Cloudflare's network, and [any change to that dataset is immediately reflected](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/) at the edge. A deletion in the database becomes a BGP withdrawal almost straight away. There's no staged rollout between "row deleted" and "prefix gone from the Internet". Cloudflare says it's working to change that as part of Code Orange.

### What customers saw

When a prefix is withdrawn, connections to it go into what Cloudflare calls **BGP path hunting**: traffic moves between networks looking for a route to the destination until the connection times out. Per the postmortem's breakdown, CDN and Magic Transit addresses on BYOIP weren't reachable, Spectrum apps couldn't proxy traffic, and Dedicated Egress customers couldn't send traffic out to their destinations.

Laravel Cloud's report shows what that looks like for a customer. Its applications, databases and infrastructure [were fully operational](https://laravel.com/blog/laravel-cloud-incident-report-february-20-2026), but users couldn't reach them because the network path no longer existed. Its monitoring caught it at 18:42, before Cloudflare's status page did.

## How they fixed it

Recovery was slow because prefixes ended up in three different states, each needing a different fix, according to the [postmortem](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/):

1. **Prefix withdrawn, bindings intact.** Most customers. They could go to the dashboard and re-advertise. Cloudflare published that guidance at 19:19 UTC, and around 800 prefixes were restored by Cloudflare reverting advertisement changes.
2. **Prefix withdrawn, some bindings removed.** Partial recovery: some prefixes could be toggled back, others couldn't.
3. **Prefix withdrawn, all bindings removed.** These couldn't be re-advertised from the dashboard because no product was bound to them anymore. About [300 prefixes](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/) needed a global configuration update to reapply service bindings to every machine on the edge. That finished at 23:03.

Laravel Cloud was in the third group. When it tried to re-advertise from the dashboard, the option was unavailable and its prefixes were [locked in a "Withdrawn" state](https://laravel.com/blog/laravel-cloud-incident-report-february-20-2026) that only Cloudflare could unlock. Cloudflare's status page said from its 20:35 UTC update that it was aware [some customers were unable to reload their IPs](https://www.cloudflarestatus.com/incidents/kwy3dt82bwbt) through the dashboard. Laravel's own timeline puts that acknowledgement at 20:50.

The deeper reason recovery took hours: Cloudflare had no quick way to say "put the addressing state back how it was before the change". It is building a system to roll out operational state snapshots through health-mediated deployments, so a bad state can be quickly rolled back, but [that system is not in Production today](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/). Without it, engineers had to recover from database snapshots and work out the difference between desired and actual state by hand.

## What changed afterwards

[Cloudflare's remediation plan](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/):

- **API schema standardisation.** The `pending_delete` flag was interpreted as a string, which made it hard for client and server to agree on its value. A stricter schema should make a malformed call detectable.
- **Separate operational state from configured state.** Customer configuration and operational actions share one authoritative database. Cloudflare will snapshot the data being applied to production and roll it out like any other change, gated by health metrics, so a bad database state can be reverted near-instantly for one customer or all. The trade-off it accepts: during an outage, customers may be temporarily blocked from making API changes, but their traffic keeps flowing.
- **A circuit breaker on large withdrawals.** Monitoring will detect changes happening too fast or too broadly, such as rapid prefix withdrawals or deletions, and stop snapshot deployment when that happens.

## The rule

There are two bugs here, and either one alone would have been harmless.

The API one: a parameter meant to **narrow** a query fell through to **no filter** when it was empty. A filter that silently means "everything" when it's missing or blank is a dangerous default for any endpoint whose results feed something destructive. Make it an explicit boolean, reject the request if it's malformed, or return nothing, never everything.

The job one (my interpretation): a delete job believed its input without checking it. A cleanup task that suddenly finds a quarter of all customer prefixes "pending deletion" is seeing a number far outside anything normal. A simple ceiling, refusing to delete more than a handful per run without a human, would have turned this into an alert. That's essentially the circuit breaker Cloudflare is now building.

The irony (my word, not Cloudflare's) is that this was a reliability project. Replacing a risky manual process with automation was the right call. The automation needed the same limits on blast radius that the programme was created to enforce.

## Sources

- [David Tuber and Dzevad Trumic, "Cloudflare outage on February 20, 2026", Cloudflare blog, 21 February 2026](https://blog.cloudflare.com/cloudflare-outage-february-20-2026/): Cloudflare's postmortem, with impact figures, the `pending_delete` client and server code, the testing gap, the recovery states, the timeline and remediation plans.
- [Cloudflare Status, "Cloudflare is investigating connectivity issues", 20 February 2026](https://www.cloudflarestatus.com/incidents/kwy3dt82bwbt): Cloudflare's public status updates during the incident.
- [Laravel, "Laravel Cloud Incident Report: February 20, 2026"](https://laravel.com/blog/laravel-cloud-incident-report-february-20-2026): an affected customer's incident report, including its prefixes being locked in a "Withdrawn" state.
