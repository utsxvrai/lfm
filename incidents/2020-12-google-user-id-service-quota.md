---
title: "A quota system read zero usage and shrank Google's login database until sign-in failed"
dek: "During a quota-system migration, a leftover piece of the old system reported the User ID Service's usage as zero. When a grace period ran out, automation cut its storage quota, the Paxos leader could no longer write, reads went stale, and every Google sign-in failed for 47 minutes."
date: 2020-12-14
company: Google
kind: outage
topics: [automation, capacity, auth, migration]
stack: [paxos, oauth, quota-system]
duration_min: 47
impact: "For 47 minutes, credential issuance and account metadata lookups failed for all Google user accounts, causing 5xx errors on virtually all authenticated traffic across Google Cloud and Google Workspace."
detected_by: alert
rule: "Automation that acts on a metric must treat an impossible value, like zero usage for a live service, as a broken input and refuse to act."
postmortem: https://status.cloud.google.com/incident/zall/20013
sources: [https://status.cloud.google.com/incident/zall/20013]
---

# A quota system read zero usage and shrank Google's login database until sign-in failed

On Monday, 14 December 2020, [for a duration of 47 minutes](https://status.cloud.google.com/incident/zall/20013), Google services that required a Google account sign-in stopped working. From 03:46 to 04:33 US/Pacific, Google says, [credential issuance and account metadata lookups for all Google user accounts failed](https://status.cloud.google.com/incident/zall/20013). Google couldn't verify that requests were authenticated, so it served 5xx errors on virtually all authenticated traffic.

That took out authenticated Google Workspace apps ([all of them were down](https://status.cloud.google.com/incident/zall/20013) for the duration) and the control planes of most Google Cloud products. Users who hadn't already signed in to the Cloud Console couldn't. Google's support tooling was hit too, so Google couldn't post to its status dashboards until 05:34, after the impact had ended.

Nothing in the authentication path itself broke. A quota system, partway through a migration, decided the authentication database was using no resources and gave it fewer.

## What happened

The [incident report](https://status.cloud.google.com/incident/zall/20013) describes the chain:

1. **October 2020.** As part of an ongoing migration to a new quota system, the User ID Service was registered with the new system. **Parts of the previous quota system were left in place**, and they incorrectly reported the service's usage as **0**.
2. **A grace period** on enforcing quota restrictions delayed any effect.
3. **14 December.** The grace period expired. Automated quota systems lowered the quota for the User ID Service based on the reported usage of zero.
4. The account database's quota was reduced, which **prevented the Paxos leader from writing**.
5. Shortly after, most read operations became **outdated**, and the service rejected them, so authentication lookups failed.

Response times, all US/Pacific:

| Time | Event |
| --- | --- |
| 03:43 | Automated capacity alerts |
| 03:46 | Errors from the User ID Service begin |
| 03:48 | Engineers paged, [within one minute of customer impact](https://status.cloud.google.com/incident/zall/20013) |
| 04:08 | Root cause and a potential fix identified |
| 04:22 | Quota enforcement disabled in one datacenter |
| 04:27 | Same mitigation applied to all datacenters |
| 04:33 | Error rates back to normal |

## What the engineers believed

Quota automation exists so nobody has to hand-tune resource limits for thousands of services. It had safety checks. The report lists the protections that should have caught a bad change, and why [at the time, they did not cover the scenario of zero reported load for a single service](https://status.cloud.google.com/incident/zall/20013):

- A check against **quota changes affecting many users** didn't fire, because only a single group was targeted.
- A check against **lowering quota below usage** didn't fire, because usage was reported as zero.
- A check against **excessive quota reductions to storage systems** didn't fire, because no alert fired during the grace period.
- A check against **low quota** didn't fire, because the difference between usage and quota exceeded the protection limit.

Every guard was written in terms of reported usage. When the usage number itself was wrong, each guard compared a correct quota against a false zero and approved the cut. The safety checks assumed their input was reliable.

## What was actually going on

### Why a quota cut became an authentication outage

The User ID Service [maintains a unique identifier for every account and handles authentication credentials for OAuth tokens and cookies](https://status.cloud.google.com/incident/zall/20013). Its data lives in a distributed database that uses Paxos to coordinate updates. And, importantly: ["For security reasons, this service will reject requests when it detects outdated data."](https://status.cloud.google.com/incident/zall/20013)

*Background on leader-based replication:* in a Paxos-style replicated database, writes go through an elected leader. Replicas serve reads, and a replica knows how fresh its data is by how recently it applied updates from the leader. Systems that care about correctness define a staleness bound: if a replica can't confirm it's caught up within some window, its reads are treated as outdated. Many such systems also write periodically even when idle (heartbeats, lease renewals) so replicas can keep confirming they're current. Google's report doesn't describe these internals. This is the general pattern.

Put that together with the report:

```diagram
title: from a zero to a global sign-in outage
flow: old quota system -> reports usage = 0 -> quota cut
flow!: leader can't write -> reads go stale -> auth rejected
note: stale data is refused on purpose, for security
```

The Paxos leader couldn't write because its storage quota was too low. With no writes, the replicas' view of the data stopped advancing, and [shortly after, the majority of read operations became outdated](https://status.cloud.google.com/incident/zall/20013). The service, by design, refuses outdated data rather than risk authenticating against stale credentials. So a capacity problem in storage showed up as an authentication failure everywhere.

That "reject when stale" rule is the right security choice. A login system that accepts stale data could, for example, honor a revoked session. But it turns any write outage into a read outage within a short window.

### Why the grace period hid it

The bad registration happened in October. The grace period meant nothing visibly changed until December, so there was no immediate signal tying the migration change to the outage. The report notes that [no alert fired during the grace period](https://status.cloud.google.com/incident/zall/20013), which was itself one reason a safety check didn't trigger. A grace period is meant to give time to catch mistakes. Without monitoring during it, it just delays the failure.

### Not everything recovered at 04:33

Most services recovered on their own once the quota was restored, but some had longer tails, per the [report](https://status.cloud.google.com/incident/zall/20013):

- **Gmail:** some users saw errors for up to an hour after recovery due to caching of errors from identity services.
- **Google Calendar and Workspace Admin Console:** errors until 05:21 due to a traffic spike after recovery.
- **Cloud Storage:** about 15% of requests were affected during the outage. Under 1% of clients finalizing resumable uploads started during the window were left with uploads that couldn't be finalized, even though GCS returned a retryable error.
- **Networking control plane:** elevated errors until 05:21.

### The report was corrected about service accounts

The original summary said [Cloud Service accounts used by GCP workloads were not impacted and continued to function](https://status.cloud.google.com/incident/zall/20013). A correction posted on the same page says that after further research, [some operations with Cloud service accounts experienced elevated error rates](https://status.cloud.google.com/incident/zall/20013) on requests to `www.googleapis.com` or `oauth2.googleapis.com`, with impact varying by service and account. The correction also widens the scope to say all services requiring sign-in via a Google Account were affected.

## How they fixed it

The mitigation was to **turn off quota enforcement**, first in one datacenter at 04:22 to confirm it worked, then everywhere at 04:27. With quota no longer limiting it, the Paxos leader could write, replicas caught up, and authentication worked again by 04:33.

## What changed afterwards

Google committed to [five changes](https://status.cloud.google.com/incident/zall/20013):

1. Review quota management automation **to prevent fast implementation of global changes**.
2. Improve monitoring and alerting to catch incorrect configurations sooner.
3. Make tools and procedures for external communication reliable during outages that affect internal tools.
4. Improve **write failure resilience** in the User ID Service database.
5. Make GCP services limit impact on the data plane during User ID Service failures.

## The rule

When automation acts on a measured value, check the measurement before acting on it. Zero usage for a service that handles every Google login is impossible, and a guard that treats it as a real reading will approve whatever follows. Add a check that rejects inputs that can't be true (zero, missing, a sudden drop to nothing) and requires a human for those cases.

And during a migration, decide which system is the source of truth for every number, and turn off the old one's reporting rather than leaving parts of it running.

## Sources

- [Google Cloud, "Google Cloud Infrastructure Components Incident #20013"](https://status.cloud.google.com/incident/zall/20013): the official incident report, with the quota-migration root cause, the safety-check gaps, the Paxos write failure, the timeline, per-product impact, the later correction on service accounts and the remediation list.
