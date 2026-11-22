---
title: "A Vercel employee's AI tool was breached, and the attacker walked through its OAuth grant into Vercel"
dek: "Context.ai, a third-party AI app an employee had connected to their Google Workspace account, was compromised. The attacker used it to take over the employee's Google account, then their Vercel account, then moved through internal systems and read customers' environment variables that weren't marked sensitive."
belief: "Vercel trusted an AI app's OAuth access to an employee's Google account. Its breach reached customer env vars."
date: 2026-04-19
company: Vercel
kind: security-breach
topics: [supply-chain, auth, data-leak, security]
stack: [vercel, google-workspace, oauth, environment-variables]
impact: "An attacker enumerated and decrypted a limited subset of customers' non-sensitive environment variables; Vercel asked those customers to rotate credentials."
rule: "A third-party app connected through OAuth acts as the user who connected it. Inventory those grants, and store secrets so even your own staff's accounts can't read them back."
postmortem: https://vercel.com/kb/bulletin/vercel-april-2026-security-incident
sources: [https://vercel.com/kb/bulletin/vercel-april-2026-security-incident, https://techcrunch.com/2026/04/20/app-host-vercel-confirms-security-incident-says-customer-data-was-stolen-via-breach-at-context-ai/, https://techcrunch.com/2026/04/23/vercel-says-some-of-its-customers-data-was-stolen-prior-to-its-recent-hack/]
---

# A Vercel employee's AI tool was breached, and the attacker walked through its OAuth grant into Vercel

On April 19, 2026, Vercel opened a security bulletin saying it had identified [unauthorized access to certain internal Vercel systems](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident). The first update, at [11:04 AM PST](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident), was an indicator of compromise for other companies to check. It wasn't a Vercel IP or domain. It was the client ID of a Google Workspace OAuth app.

Vercel's conclusion was that the attack didn't start at Vercel. It started at [Context.ai, a third-party AI tool used by a Vercel employee](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident). Vercel said the attacker got as far as customers' environment variables, the place where apps on Vercel keep API keys and database passwords.

Vercel [closed the incident on October 16, 2026](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident). Its public account is short, and this post is correspondingly short.

## What happened

Vercel's description of the chain ([bulletin](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident)):

1. Context.ai was compromised.
2. The attacker used that access to take over the employee's individual Vercel Google Workspace account.
3. That gave them access to the employee's Vercel account.
4. From there they pivoted into a Vercel environment, moved through systems, and ["enumerate[d] and decrypt[ed] non-sensitive environment variables"](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident).

Context.ai's Google Workspace OAuth app, Vercel says, was the subject of a broader compromise, [potentially affecting its hundreds of users across many organizations](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident). TechCrunch reported that Context AI confirmed on its website it [had a breach in March](https://techcrunch.com/2026/04/20/app-host-vercel-confirms-security-incident-says-customer-data-was-stolen-via-breach-at-context-ai/) involving its consumer Office Suite app, and that the attackers ["likely compromised OAuth tokens for some of our consumer users."](https://techcrunch.com/2026/04/20/app-host-vercel-confirms-security-incident-says-customer-data-was-stolen-via-breach-at-context-ai/)

The bulletin's update log, all PST ([bulletin](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident)):

- **April 19, 11:04 AM.** Published the OAuth app IOC.
- **April 19, 6:01 PM.** Published the origin of the attack.
- **April 20.** Clarified what counts as compromised credentials; confirmed npm packages were not compromised.
- **April 22 and 23.** Published, then clarified, further findings.
- **October 16, 10:19 AM.** All remediation complete; incident closed.

## What the engineers believed

The bulletin doesn't spell out the assumption, so this section is interpretation. Two reasonable beliefs failed.

**First, that a third-party app on an employee's account is that employee's business.** People connect AI assistants to Gmail, Drive and Calendar all the time. Each one gets an OAuth grant: a token that lets the vendor's servers act as that user, within the scopes granted, without the user's password or second factor. If the vendor is breached, so are its tokens. TechCrunch's first report describes exactly that: the employee [connected it to their corporate account](https://techcrunch.com/2026/04/20/app-host-vercel-confirms-security-incident-says-customer-data-was-stolen-via-breach-at-context-ai/), and the hackers used that OAuth connection to take over the employee's Google account.

**Second, that values stored encrypted are safe.** Vercel encrypts environment variables. But the ones not marked "sensitive" are, in Vercel's words, [those that decrypt to plaintext](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident): the platform can read them back to authorised users, the dashboard and the API. So anyone who becomes an authorised user can too.

## What was actually going on

### The pivot from Google to Vercel

The bulletin says taking over the Workspace account ["enabled them to gain access to that employee's Vercel account"](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident). It doesn't say how. A likely reading is that the Vercel login was tied to the Google identity (single sign-on), or that the Google account held something, like email, that could be used to get into Vercel. That's my interpretation, not Vercel's statement. Either way, the identity provider was the real perimeter, and a third-party app had a key to it.

```diagram
title: an OAuth grant as a back door
flow: employee -> connects AI app -> holds OAuth token
flow!: app breached -> Google account -> Vercel account
flow!: internal systems -> read env vars -> customer secrets
note: each hop reuses an identity already granted
```

### Enumeration at API speed

Vercel describes the attacker as highly sophisticated, based on ["their operational velocity and in-depth understanding of Vercel's product API surface"](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident). CEO Guillermo Rauch, quoted by TechCrunch, said the logs showed ["rapid and comprehensive API usage, with a focus on enumeration of non-sensitive environment variables"](https://techcrunch.com/2026/04/23/vercel-says-some-of-its-customers-data-was-stolen-prior-to-its-recent-hack/). He pointed to early signs of malware that compromises computers ["in search of valuable tokens like keys to Vercel accounts and other providers."](https://techcrunch.com/2026/04/23/vercel-says-some-of-its-customers-data-was-stolen-prior-to-its-recent-hack/)

TechCrunch also cites security researchers who reported that a Context AI employee's computer was [infected with infostealer malware](https://techcrunch.com/2026/04/23/vercel-says-some-of-its-customers-data-was-stolen-prior-to-its-recent-hack/), allegedly after looking up game cheats. Neither Vercel's bulletin nor Context AI, as reported, confirms that as the root cause.

### "Sensitive" was opt-in

Vercel already had a feature for this, sensitive environment variables, and the bulletin tells customers to [use them so secret values are protected from being read in the future](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident). The variables that leaked were the ones nobody had marked. A security property that depends on someone ticking a box will be missing exactly where people didn't think about it (interpretation).

### The scope changed, and so did the wording

The impacted set grew. Vercel first found [a limited subset of customers](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident) and told them to rotate credentials. A broader log review later found [a small number of additional accounts](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident) compromised in the same incident.

It also found other compromised accounts, and here the two versions differ:

- **TechCrunch's April 23 quote of the bulletin.** Vercel had uncovered accounts ["with evidence of prior compromise that is independent of and predates this incident"](https://techcrunch.com/2026/04/23/vercel-says-some-of-its-customers-data-was-stolen-prior-to-its-recent-hack/).
- **The bulletin's current wording.** Those compromises ["appear to be separate from the April 2026 incident"](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident), do not appear to have originated on Vercel systems, and are not evidence of an earlier Vercel security incident. The word "predates" no longer appears.

## How they fixed it

Vercel contacted affected customers and recommended immediate credential rotation. It engaged Google Mandiant and other security firms, notified law enforcement, and confirmed with GitHub, Microsoft, npm and Socket that [no npm packages published by Vercel have been compromised](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident).

For customers, the [bulletin](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident) says:

- **Rotate every environment variable that wasn't marked sensitive**, and do it before deleting any project, because deleting a project doesn't revoke a leaked key.
- **Turn on MFA.**
- **Review activity logs and recent deployments.**
- **Set Deployment Protection to at least Standard** and rotate its tokens.

## What changed afterwards

Vercel listed product changes: [better environment variable management, with stronger defaults](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident), a team-wide overview of environment variables, and an easier-to-use activity log.

## The rule

Every OAuth app your people connect to the corporate identity provider is a vendor with a standing key to that identity. Keep an inventory, restrict which apps can be granted, and treat a vendor breach as a breach of every account that granted it access.

And store secrets so the platform can't hand them back in plaintext, not even to a legitimate-looking session. Then a stolen session gets you configuration, not credentials (interpretation).

## Sources

- [Vercel, "Vercel April 2026 security incident", security bulletin, last updated 16 October 2026](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident): the official account, with attack chain, impacted customers, OAuth IOC, recommendations, product changes and update log.
- [TechCrunch, "App host Vercel confirms security incident, says customer data was stolen via breach at Context AI", 20 April 2026](https://techcrunch.com/2026/04/20/app-host-vercel-confirms-security-incident-says-customer-data-was-stolen-via-breach-at-context-ai/): how the OAuth connection was abused, and Context AI's statement about a March breach and compromised OAuth tokens.
- [TechCrunch, "Vercel says some of its customers' data was stolen prior to its recent hack", 23 April 2026](https://techcrunch.com/2026/04/23/vercel-says-some-of-its-customers-data-was-stolen-prior-to-its-recent-hack/): the expanded scope, Guillermo Rauch's description of the attacker's API usage, and the earlier "predates" wording.
