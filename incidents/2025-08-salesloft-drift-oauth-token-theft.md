---
title: "Stolen Salesloft Drift OAuth tokens let UNC6395 export data from Salesforce instances"
dek: "A threat actor used OAuth tokens belonging to the Salesloft Drift integration to query and export customer Salesforce data, then searched it for AWS keys, passwords and Snowflake tokens. The tokens were legitimate, so logins and MFA never came into it."
belief: "Salesforce customers trusted MFA to guard their CRM. Stolen Salesloft Drift OAuth tokens bypassed it."
date: 2025-08-08
company: Salesloft
kind: security-breach
topics: [auth, supply-chain, data-leak, security]
stack: [oauth, salesforce, soql, google-workspace]
impact: "From as early as 8 August through at least 18 August 2025, UNC6395 systematically exported large volumes of data from numerous corporate Salesforce instances via compromised Salesloft Drift OAuth tokens."
rule: "An integration's OAuth token is a standing credential with the integration's full scope and none of your login controls. Scope it narrowly, pin it to known IPs, and keep secrets out of the systems it can read."
postmortem: https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift
sources: [https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift]
---

# Stolen Salesloft Drift OAuth tokens let UNC6395 export data from Salesforce instances

On [27 August 2025](https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift), Google Threat Intelligence Group (GTIG) warned of a widespread data theft campaign by an actor it tracks as **UNC6395**. Beginning [as early as 8 August 2025 through at least 18 August 2025](https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift), the actor targeted Salesforce customer instances using compromised OAuth tokens associated with **Salesloft Drift**, a third-party application that integrates with Salesforce.

The actor [systematically exported large volumes of data from numerous corporate Salesforce instances](https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift). GTIG's assessment is that the main goal wasn't the CRM data itself but what was hidden in it: the actor searched exfiltrated data for secrets such as AWS access keys, passwords and Snowflake-related access tokens that could open other systems.

GTIG states clearly that the issue [does not stem from a vulnerability within the core Salesforce platform](https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift). The attacker didn't break Salesforce. It used the access customers had granted to Drift.

## What happened

From GTIG's [advisory and its 28 August update](https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift):

- **8 August 2025 (as early as).** UNC6395 begins using compromised Drift OAuth tokens against Salesforce instances.
- **9 August.** The actor uses compromised tokens for the separate **"Drift Email"** integration to access email from a very small number of Google Workspace accounts, those specifically configured to integrate with Salesloft Drift.
- **18 August (at least through).** Salesforce data theft continues.
- **20 August.** Salesloft, with Salesforce, revokes **all active access and refresh tokens** for the Drift application. Salesforce removes Drift from the AppExchange pending investigation.
- **27 August.** GTIG publishes its advisory. GTIG, Salesforce and Salesloft have notified affected organizations.
- **28 August.** GTIG updates the advisory: the compromise is **not limited to the Salesforce integration**. It advises all Salesloft Drift customers to treat [any and all authentication tokens stored in or connected to the Drift platform as potentially compromised](https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift). Google revokes the Drift Email OAuth tokens and disables the Workspace–Drift integration. Salesloft engages Mandiant.

GTIG's advisory doesn't say how UNC6395 obtained the Drift tokens in the first place, and this post doesn't speculate.

## What customers believed

Connecting a SaaS tool to Salesforce is routine. An admin clicks through an OAuth consent screen, the tool gets a token, and from then on it syncs data in the background. The mental model is that **the integration is a feature of the vendor's product**, and the security of the CRM is still governed by the CRM's own controls: SSO, MFA, password policy, login monitoring.

Salesloft's initial assessment, as GTIG reports it, also shaped the early picture: based on data at the time, [customers that do not integrate with Salesforce are not impacted](https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift). The next day's update widened that to every token connected to Drift.

## What was actually going on

### What an OAuth token actually is

*Background:* OAuth lets a user or admin grant a third-party application access to their account without giving it a password. The application gets an **access token**, usually short-lived, and often a **refresh token**, longer-lived, that it can exchange for new access tokens. The application stores these tokens on its own infrastructure so it can keep working when nobody is logged in.

Three consequences follow, and all three matter here:

1. **Tokens bypass interactive login.** MFA, SSO and password policies apply when a human logs in. A token was issued after that step; presenting it doesn't repeat it.
2. **Tokens carry the integration's scope.** Whatever the app was allowed to read, anyone holding the token can read.
3. **Tokens live where the vendor keeps them.** If the vendor's storage is compromised, every customer's token is compromised at once. That fits GTIG's 28 August advice to treat all tokens connected to Drift as compromised, not just Salesforce ones.

```diagram
title: why MFA didn't matter
flow: admin consents -> Drift stores token -> Drift syncs CRM
flow!: token stolen -> attacker calls API -> bulk export
note: the login step (and its MFA) happened once, long before
```

### What the actor ran

GTIG shows the queries. UNC6395 first sized up each instance with counts:

```sql
SELECT COUNT() FROM Account;
SELECT COUNT() FROM Opportunity;
SELECT COUNT() FROM User;
SELECT COUNT() FROM Case;
```

It then pulled data from objects including Cases, Accounts, Users and Opportunities. The examples include a query for active users' names, emails, titles, phone numbers and last login dates, and a Case query with `LIMIT 10000`. These are ordinary SOQL queries, the same kind an integration makes all day.

GTIG's IOCs include User-Agent strings such as `Salesforce-Multi-Org-Fetcher/1.0` and `Salesforce-CLI/1.0`, which it labels malicious, and IP addresses at DigitalOcean, AWS and many Tor exit nodes. GTIG also notes the actor [demonstrated operational security awareness by deleting query jobs](https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift), but that logs were not affected, so organizations could still find evidence of what was read.

### Why the CRM was a credential store

The most instructive detail is the motive. GTIG assesses the actor's [primary intent](https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift) was to harvest credentials. Support cases and account notes are free text. (Interpretation: over the years, people paste things into them, such as keys or passwords shared while troubleshooting.) GTIG's recommended searches are telling: `AKIA` for long-term AWS access key IDs, `snowflakecomputing.com`, `password`, `secret`, `key`, and organization-specific VPN or SSO login URLs.

That turns a CRM breach into a stepping stone. Data stolen through one integration contained the keys to systems that had nothing to do with Salesforce or Drift. (This is interpretation of GTIG's stated motive; the advisory doesn't report specific downstream compromises.)

## How it was contained

The decisive action was on the token side: on 20 August Salesloft and Salesforce [revoked all active access and refresh tokens with the Drift application](https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift), and Salesforce pulled Drift from AppExchange. Revoking tokens at the authorization server is the one move that works regardless of where the stolen copies are.

On the Google side, Google identified the affected Workspace users, revoked the Drift Email tokens and disabled the integration. GTIG says there was [no compromise of Google Workspace or Alphabet itself](https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift), and that the actor could not have reached any accounts on a customer's Workspace domain other than those configured to integrate with Drift.

## What changed afterwards

GTIG's advisory ends with recommendations rather than a description of changes at Salesloft. For affected organizations, it recommends:

- **Investigate:** review all integrations connected to the Drift instance; search for the listed IPs and User-Agents (and Tor exit nodes generally); review Salesforce Event Monitoring for the Drift connection user, authentication activity from the Drift Connected App, and `UniqueQuery` events that log executed SOQL.
- **Hunt for secrets** in Salesforce objects, using searches like the ones above and tools such as Trufflehog.
- **Revoke and rotate** API keys, credentials and tokens for Drift-connected integrations, rotate any discovered secrets, reset passwords, and shorten Salesforce session timeouts.
- **Harden access:** restrict Connected App scopes to the minimum and avoid full access; set the Connected App's IP Relaxation policy to "Enforce IP restrictions"; define login IP ranges; and remove the "API Enabled" permission from profiles, granting it only through a permission set.

## The rule

Every OAuth integration is a standing credential that lives on someone else's servers, with the integration's full scope and none of your login controls. Give it the narrowest scope that works, pin it to the vendor's known IP ranges where the platform allows, know how to revoke it in one step, and log what it queries.

And keep secrets out of systems that integrations can read (interpretation, informed by GTIG's secret-hunting advice). A support ticket is not a password manager. If a key ever gets pasted into a CRM, rotate it, because you can't know which third party will eventually be holding a token that can read it.

## Sources

- [Google Threat Intelligence Group and Mandiant (Austin Larsen, Matt Lin, Tyler McLellan, Omar ElAhdan), "Widespread Data Theft Targets Salesforce Instances via Salesloft Drift", Google Cloud Threat Intelligence blog, 27 August 2025, updated 28 August](https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift): GTIG's advisory, covering the campaign window, token revocation, the Drift Email update, the actor's queries and motive, IOCs and recommendations.
