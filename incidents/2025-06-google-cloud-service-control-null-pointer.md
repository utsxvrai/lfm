---
title: "A policy row with blank fields crash-looped Google Cloud's Service Control in every region"
dek: "Google shipped new quota-check code to Service Control region by region, but the code only ran once a matching policy existed, and it had no error handling and no feature flag. When such a policy arrived it replicated globally within seconds, hit a null pointer and crashed Service Control in every region at once."
date: 2025-06-12
company: Google
kind: outage
topics: [config-change, software-bug, replication, cascading-failure]
stack: [service-control, spanner, google-cloud]
duration_min: 180
impact: "Google Cloud, Google Workspace and Google Security Operations products returned increased 503 errors on external API requests globally; Google's mini report gives the duration as 3 hours."
rule: "A staged binary rollout protects you only if the new code actually runs during the rollout. Gate new code paths behind a flag, and never let globally replicated data reach every region before it has been validated in one."
postmortem: https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW
sources: [https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW]
---

# A policy row with blank fields crash-looped Google Cloud's Service Control in every region

On 12 June 2025, [Google Cloud, Google Workspace and Google Security Operations products](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) started returning 503 errors on external API requests, worldwide. Customers had intermittent API and console access problems across a long list of services, including IAM, Cloud Storage, BigQuery, Cloud Run and Cloud Monitoring. Google says [existing streaming and IaaS resources were not impacted](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW): running VMs kept running, but calls to Google's APIs failed.

Google's mini incident report gives the [incident start as 10:49 PDT, all regions except us-central1 mitigated by 12:48, and the end at 13:49, with a duration of 3 hours](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW). The full report puts the triggering change at [~10:45am PDT](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW), a few minutes before the start time the mini report uses. The incident page header gives yet another window, [10:51 to 18:18 PDT](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW); the later end time presumably covers residual product impact, but the page doesn't say.

The cause was a single bad policy row that reached code which had been deployed, but never executed, since late May.

## What happened

From Google's [incident report](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW):

- **29 May 2025.** A new feature is added to **Service Control** for additional quota policy checks. The binary goes through Google's region-by-region rollout. The new code path is never exercised during the rollout, because it only runs when a particular kind of policy exists. The change ships with a "red-button" to turn off that policy-serving path. It does **not** have error handling for bad data and is **not** behind a feature flag.
- **12 June, ~10:45 PDT.** A policy change is inserted into the regional Spanner tables that Service Control reads. Because quota management is global, the data is **replicated globally within seconds**. The policy contains unintended blank fields.
- **Seconds later, everywhere.** Each regional Service Control reads the policy from its regional datastore, hits the new code path, dereferences a null pointer and crashes. The binaries go into a **crash loop** in every region.
- **Within 2 minutes.** SRE is triaging.
- **Within 10 minutes.** Root cause identified; the red-button is being put in place.
- **~25 minutes.** The red-button is ready to roll out.
- **Within 40 minutes.** The red-button rollout completes. Smaller regions start to recover first.
- **us-central1.** Restarting Service Control tasks overload the Spanner table they depend on. Full recovery there takes [up to ~2h 40 mins](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW).

## What the engineers believed

Google's binary rollout process is region by region, and the Service Control change went through it. The natural belief after a clean staged rollout is that **the new code has been tested in production**: if it were going to crash, it would have crashed in the first region and been stopped there.

That belief was false because rollout and execution were separate events. The report is explicit that [the code path that failed was never exercised during this rollout due to needing a policy change that would trigger the code](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW). The rollout showed only that the new binary didn't crash on existing data.

There was also a safety net in mind: the red-button. It worked as designed, but a kill switch only shortens an outage after it has started. It doesn't stop one from starting.

## What was actually going on

### Service Control sits in front of every API call

Google describes Service Control as the core binary of the policy check system behind Google and Google Cloud APIs. It is a [regional service with a regional datastore](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) for quota and policy information, and it is responsible for ensuring each API request is authorized and passes checks like quota. That puts it on the request path of essentially every API call. If Service Control can't answer, the API can't serve, which is why so many unrelated products failed together.

### Regional binary, global data

The architecture was regional in one dimension and global in another:

- The **binary** was deployed regionally and rolled out region by region.
- The **data** it reads, quota and policy metadata, is [replicated almost instantly globally](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW), because quota management is global.

*Background:* staged rollouts limit blast radius by changing one region at a time. That only works if the thing changing is actually confined to a region. Here, the dangerous change was the data, not the binary, and the data went everywhere at once. Every region had already been "safely" upgraded to a binary with the latent bug, and they all received the trigger within seconds of each other.

```diagram
title: why a staged rollout didn't help
flow: new binary -> region by region -> new path never runs
flow!: bad policy row -> global in seconds -> null pointer, all regions
note: the rollout tested the binary; the data was never staged
```

### No flag, no error handling

The report names two missing guards, and they cover different things:

- **No error handling.** When the new code read a policy with blank fields, it hit a null pointer and the binary crashed. Google's words: ["Without the appropriate error handling, the null pointer caused the binary to crash."](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) A crash in a policy check is fail-closed: no answer means the request is rejected.
- **No feature flag.** Google uses feature flags to enable features gradually [region by region per project, starting with internal projects](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW). Had the new path been flagged, it would have run first on a few internal projects, and Google says [the issue would have been caught in staging](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW).

Either one would likely have turned a global outage into something much smaller. Error handling would have survived the bad row; a flag would have limited where the new code could see it.

### The two reports describe the trigger differently

The mini report, posted the same evening, said the issue came from ["an invalid automated quota update to our API management system"](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW). The full report says ["a policy change was inserted into the regional Spanner tables"](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) containing unintended blank fields. The full report doesn't say whether the change was automated or manual, though Google's response included freezing ["manual policy pushes"](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW).

### Recovery caused a second overload

Once the red-button was in, Service Control tasks restarted. In large regions such as us-central1, the restarts created a [herd effect on the underlying infrastructure](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW), the Spanner table, and overloaded it. The report says Service Control [did not have the appropriate randomized exponential backoff](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW).

*Background:* when thousands of tasks restart at the same moment, they all try to load state from the same backend at the same moment. Without jitter, their retries also line up, so every retry wave is as large as the first. Randomized exponential backoff spreads them out so the backend can catch up.

### The status page was down too

Google posted its first incident report about [~1h after the crashes began](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW), because the Cloud Service Health infrastructure was itself affected by the outage. Some customers whose monitoring ran on Google Cloud also lost it, leaving them without a signal that anything was wrong.

## How they fixed it

The red-button disabled the failing policy-serving path, and within 40 minutes of the start it was rolled out everywhere. Smaller regions recovered first. In us-central1, Google [throttled task creation](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) to reduce load on the Spanner table and routed traffic to multi-regional databases. The mini report adds that several products had moderate residual effects, such as backlogs, for up to an hour after mitigation.

## What changed afterwards

Google froze all changes to the Service Control stack and manual policy pushes until the system was remediated, and committed to:

- **Modularize Service Control** so functionality is isolated and **fails open**: if a check fails, API requests can still be served.
- **Audit all systems that consume globally replicated data**, so that even global data is propagated incrementally with time to validate and detect issues.
- **Require feature flags**, disabled by default, for all changes to critical binaries.
- **Improve static analysis and testing** to handle errors correctly.
- **Audit for randomized exponential backoff.**
- **Improve external communications**, and keep monitoring and communication infrastructure working even when Google Cloud is down.

## The rule

A staged rollout only protects you if the new code actually runs during the stages. If a code path waits for data to wake it up, then the data push is the real deploy, and it needs the same protection: a feature flag that limits who can reach the path, error handling that survives malformed input, and replication that goes one region at a time. Separately, anything that restarts in bulk needs jittered backoff, or recovery becomes a second outage.

On fail-open versus fail-closed (interpretation): for a quota or policy check, failing closed sounds safe, but when the checker is on every request path, failing closed on a bug makes that bug global. Google's own remediation moves Service Control toward failing open for exactly this reason.

## Sources

- [Google Cloud Service Health, "Multiple GCP products are experiencing Service issues." incident page, June 2025](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW): contains both Google's full incident report (Service Control, the 29 May change, the 12 June policy change, recovery and remediations) and the earlier mini incident report (times, 3-hour duration, affected products).
