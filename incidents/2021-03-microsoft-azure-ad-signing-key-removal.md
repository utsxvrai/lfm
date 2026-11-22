---
title: "Azure AD's key-cleanup automation removed a signing key it was told to keep"
dek: "An automated job that removes unused signing keys ignored a 'retain' flag and dropped a key Azure AD still used. Apps refreshed the published key metadata, stopped trusting tokens signed with that key, and sign-in to Teams, Exchange, Azure and more failed. Rolling back was fast; getting every app's cache to notice took until the next morning."
belief: "Azure AD's key cleanup was supposed to honor a 'retain' flag. It removed a signing key still in use."
date: 2021-03-15
company: Microsoft
kind: outage
topics: [auth, automation, cache]
stack: [azure-ad, openid-connect, jwt]
impact: "Between about 19:00 UTC on March 15 and 09:25 UTC on March 16, 2021, customers could hit authentication errors in any Microsoft or third-party app that relies on Azure AD."
detected_by: alert
rule: "Never remove a signing key that tokens in circulation still depend on, and remember that consumers cache your key set; rolling back the source doesn't roll back their caches."
postmortem: https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf
sources: [https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf, https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf, https://www.theregister.com/2021/03/15/microsoft_azure_outage/]
---

# Azure AD's key-cleanup automation removed a signing key it was told to keep

On the evening of 15 March 2021 (UTC), people couldn't sign in to Microsoft services. Microsoft's preliminary root-cause analysis says that [between 19:00 UTC (approx) on March 15, 2021, and 09:25 UTC on March 16, 2021](https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf), customers could see errors authenticating to any Microsoft or third-party application that relies on Azure Active Directory. The Register listed reports of [Microsoft Teams, Office and/or Dynamics, Xbox Live, and the Azure Portal](https://www.theregister.com/2021/03/15/microsoft_azure_outage/) failing, with readers adding Exchange Online, Intune and Azure Kubernetes Service.

According to the RCA, the failure was in the public list of keys that every app uses to verify Azure AD's tokens. An automated cleanup job removed one key from that list. It had been marked to be kept, and the job ignored the mark.

## What happened

From Microsoft's [preliminary RCA (tracking ID LN01-P8Z)](https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf):

1. Azure AD signs tokens with keys that rotate. As part of standard security hygiene, **an automated system, on a time-based schedule, removes keys that are no longer in use**.
2. **Over the previous few weeks**, one key had been marked "retain" for longer than normal to support a complex cross-cloud migration.
3. A bug in the automation **ignored that "retain" state** and removed the key.
4. **At 19:00 UTC** the public key metadata changed. Apps picked up the new metadata and stopped trusting tokens signed with the removed key. Users could no longer get into those apps.
5. Service telemetry caught the problem and automatically engaged the engineering team. The key removal was identified as the cause, and **the key metadata was rolled back at 21:05 UTC**.
6. Apps then had to notice the rollback. Major apps recovered, but a subset of Azure Storage resources kept failing on cached metadata. Microsoft pushed an update to invalidate those caches, and mitigation was declared at **09:25 UTC on 16 March**.

The Register's live report puts the start at [approximately 1915 UTC](https://www.theregister.com/2021/03/15/microsoft_azure_outage/), quoting Microsoft's status page at the time. The later RCA says 19:00 (approximately). At 21:11 UTC, Microsoft said it was rolling back a change to an authentication system and expected that to take about 15 minutes. Shortly after, it said [the process to roll back the change is taking longer than expected](https://www.theregister.com/2021/03/15/microsoft_azure_outage/).

## What the engineers believed

The design looks careful. Rotating keys and removing old ones is good practice: a key that's gone can't be abused. Automating it on a schedule removes the human error of forgetting. And there was an escape hatch: when a key needed to live longer, someone could mark it "retain", and someone did, for a migration.

The belief was that the "retain" flag would be respected. It's the kind of flag you set once and stop thinking about, because the automation is supposed to check it. Microsoft says that [this exposed a bug](https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf) where the automation incorrectly ignored it. A key kept longer than normal meant the job was finally running in a state that bug could act on.

## What was actually going on

### How apps verify Azure AD tokens

*Background on OpenID Connect, which the RCA names:* when you sign in, the identity provider issues a token, typically a JWT, signed with one of its private keys. The token's header names which key (`kid`). The app receiving the token doesn't call the identity provider to check it. Instead it fetches the provider's **published metadata**, a discovery document that points to a key set (JWKS) listing the current public keys, and verifies the signature locally. Apps cache that key set and refresh it periodically, or when they see a `kid` they don't recognize.

This design is why sign-in scales: validation is local, with no round trip per request. It also means **the published key set is a global dependency for every app**. Remove a key from it, and every token signed with that key becomes unverifiable everywhere, as soon as each app refreshes its cache.

Microsoft's RCA describes that exactly: signing-key metadata [is published by Azure AD to a global location](https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf), and once it changed, apps "began to pick up the new metadata and stopped trusting tokens/assertions signed with the key that was removed."

```diagram
title: one key removed, every app rejects
flow: Azure AD signs token -> app fetches key set -> signature checks out
flow!: cleanup drops key -> apps refresh cache -> token rejected
note: the token was valid; the app could no longer verify it
```

### Why the outage outlasted the fix

Rolling back the metadata at 21:05 fixed the source. It didn't fix the copies. The RCA says [applications need to pick up the rolled back metadata and refresh their caches](https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf), and time to recovery varied with how each server implementation handles caching.

*Background:* the cache made things worse in both directions. On the way in, apps refreshed at different times, so the outage spread unevenly. On the way out, an app that had cached the bad key set might keep it until its next scheduled refresh, unless something forced it. That's what happened with part of Azure Storage. Microsoft had to [push an update to invalidate these entries and force a refresh](https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf), and that's why mitigation wasn't declared until 09:25 the next morning.

### Why the backup didn't help

After a similar incident in September 2020, Microsoft had been rolling out an Azure AD backup authentication system. The RCA says it [provided coverage for token issuance but did not provide coverage for token validation](https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf), because validation depended on the affected metadata endpoint. Issuing tokens was never the problem. Getting apps to accept them was.

### The same class of failure, twice

The RCA notes that the [previous Azure AD incident on September 28th, 2020](https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf) and this one are in the same class of risks. After September, Microsoft had promised more protection in the backend Safe Deployment Process (SDP), the system that stages changes. The first phase protected **adding** a new key. **Removing** a key was in the second phase, [scheduled to be finished by mid-year](https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf). The RCA doesn't spell it out, but the implication is that the removal reached the global metadata without the staged protections that adding a key already had.

## How they fixed it

Microsoft rolled back the key metadata to its prior state at 21:05 UTC, then forced cache invalidation for the Storage resources that still held stale metadata. Azure Admin Portal, Teams, Exchange, Key Vault, SharePoint and other major apps [recovered](https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf) as their caches refreshed.

## What changed afterwards

From the RCA's next steps:

- **Additional safeguards on the key removal process,** in place until SDP phase two is done.
- **Finish SDP phase two,** which covers key removal. Microsoft's initial analysis says it would have [prevented the type of outage that happened today](https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf) as well as the September 2020 one.
- A full RCA to follow. This post is based on the preliminary one, which is all the sources contain.

## The rule

Key rotation has a dangerous half and a safe half. Adding a key to a published set is safe, because nothing depends on it yet. Removing one is dangerous, because every cached copy of the key set and every token signed with that key depends on it. Gate removal behind an explicit check that nothing still signs with the key, stage it like any other risky deploy, and plan rollback around consumers' caches, not just your own source of truth. A "do not delete" flag only helps if the deletion code is tested against it.

## Sources

- [Microsoft, "Preliminary RCA - Authentication errors across multiple Microsoft services (Tracking ID LN01-P8Z)" (archived)](https://web.archive.org/web/20220705145902/https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf): Microsoft's preliminary root-cause analysis, with the impact window, the "retain" bug in key-removal automation, metadata caching, mitigation times, the backup-auth gap and next steps.
- [Same RCA, DocumentCloud original](https://s3.documentcloud.org/documents/20515443/authentication-errors-across-multiple-microsoft-services-tracking-id-ln01-p8z.pdf): the original location of the PDF above; it blocked automated fetches, so this post cites the archived copy.
- [The Register, "Microsoft customers locked out of Teams, Office, Xbox, Dynamics – and Azure Active Directory breakdown blamed", 15 March 2021](https://www.theregister.com/2021/03/15/microsoft_azure_outage/): same-day coverage quoting Microsoft's status updates, including the 19:15 UTC start and the slow rollback.
