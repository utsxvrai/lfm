---
title: "A credential Klue handed out for a 2022 pilot was never revoked, and it unlocked customers' Salesforce data"
dek: "Klue stores OAuth tokens that connect its Battlecards product to customers' Salesforce, HubSpot, Gong, Slack and other tools. An attacker used a legacy integration credential, which Klue says it gave a third party for a limited pilot in 2022, to reach Klue's backend, take those tokens, and pull CRM data from customer environments in bulk."
belief: "Klue customers trusted its Salesforce OAuth access. A long-disused credential let attackers steal the tokens."
date: 2026-06-12
company: Klue
kind: security-breach
topics: [supply-chain, auth, data-leak]
stack: [oauth, salesforce]
impact: "Customer OAuth tokens for Salesforce, HubSpot, Gong, Slack and other platforms were stolen and used to exfiltrate CRM data; more than a dozen organizations confirmed impact and faced extortion."
rule: "Every credential you issue needs an owner and an expiry. A pilot's credential that outlives the pilot becomes an unwatched way into everything it can reach."
postmortem: https://www.finra.org/rules-guidance/guidance/cybersecurity-alert-klue-oauth-breach-and-salesforce-data-exfiltration
sources: [https://www.finra.org/rules-guidance/guidance/cybersecurity-alert-klue-oauth-breach-and-salesforce-data-exfiltration, https://techcrunch.com/2026/06/23/klue-says-hackers-stole-credential-from-2022-that-led-to-customer-data-breaches/, https://bleepingcomputer.com/news/security/klue-oauth-breach-victim-list-grows-as-icarus-hackers-claim-attack, https://techcrunch.com/2026/06/22/klue-hack-results-in-data-breach-at-several-cybersecurity-firms/, https://www.huntress.com/blog/klue-breach-investigation, https://reliaquest.com/blog/threat-spotlight-integration-abused-in-crm-data-theft/]
---

# A credential Klue handed out for a 2022 pilot was never revoked, and it unlocked customers' Salesforce data

Klue is a competitive-intelligence platform. Its "Battlecards" product connects to the tools sales teams already use, and to do that it holds OAuth tokens for its customers' accounts on [Salesforce, HubSpot, SharePoint, Zoom, Gong, Chorus, Clari, Google Drive, and Slack](https://www.finra.org/rules-guidance/guidance/cybersecurity-alert-klue-oauth-breach-and-salesforce-data-exfiltration).

On 12 June 2026, Klue [detected a security breach](https://www.finra.org/rules-guidance/guidance/cybersecurity-alert-klue-oauth-breach-and-salesforce-data-exfiltration). An attacker had reached Klue's backend, stolen those customer tokens, and used them to pull data out of customers' CRMs. FINRA's alert to its member firms says [more than a dozen organizations have confirmed impact](https://www.finra.org/rules-guidance/guidance/cybersecurity-alert-klue-oauth-breach-and-salesforce-data-exfiltration), including LastPass, HackerOne, Snyk, Tanium and others. The group behind it, which calls itself Icarus, then [sent extortion emails](https://www.finra.org/rules-guidance/guidance/cybersecurity-alert-klue-oauth-breach-and-salesforce-data-exfiltration) and listed victims on a Tor leak site.

Klue hasn't published a technical postmortem. This post relies on FINRA's alert, Klue's statements as quoted by the press, and write-ups from two security firms. It's shorter than most posts here because that's all the sources support.

## What happened

- **11 June.** Huntress, one of the affected companies, says Klue's compromise [began on June 11](https://www.huntress.com/blog/klue-breach-investigation) with anomalous behavior in a system that connects to customers' tools.
- **12 June.** Klue identifies [unauthorized activity affecting a portion of Klue's integration infrastructure](https://bleepingcomputer.com/news/security/klue-oauth-breach-victim-list-grows-as-icarus-hackers-claim-attack) (CEO statement, via BleepingComputer).
- **13 June.** Per Huntress, Klue sends customers a [general alert](https://www.huntress.com/blog/klue-breach-investigation) that does not say which customers were impacted.
- **16 June.** Extortion emails reach Huntress staff: ["Your data has been downloaded…You have 48 hours to communicate with us."](https://www.huntress.com/blog/klue-breach-investigation)
- **By 19 June.** Klue publicly confirms the incident in a [statement published that week](https://bleepingcomputer.com/news/security/klue-oauth-breach-victim-list-grows-as-icarus-hackers-claim-attack). TechCrunch notes the blog post carried a ["noindex"](https://techcrunch.com/2026/06/22/klue-hack-results-in-data-breach-at-several-cybersecurity-firms/) tag, so search engines would not list it.
- **19–22 June.** Icarus claims the breach on its leak site ([BleepingComputer](https://bleepingcomputer.com/news/security/klue-oauth-breach-victim-list-grows-as-icarus-hackers-claim-attack)). More victims disclose.
- **23 June.** Klue tells TechCrunch the credential [was originally provided to a third-party in 2022, for a limited pilot](https://techcrunch.com/2026/06/23/klue-says-hackers-stole-credential-from-2022-that-led-to-customer-data-breaches/).

Sources differ on the start date. Klue and FINRA use 12 June, the day Klue detected it. Huntress says the compromise began on 11 June.

## What the engineers believed

Klue hasn't explained how the credential was managed, so this section is my interpretation of what the sources imply.

A pilot is temporary by definition. Huntress says the credential was [originally created by Klue for them to prototype a third-party integration](https://www.huntress.com/blog/klue-breach-investigation), and calls it [a long-disused but still active credential](https://www.huntress.com/blog/klue-breach-investigation). The pilot ended, and the working assumption was presumably that the access ended with it. It didn't. The credential stayed valid for years, and nobody was watching it, because nothing was supposed to be using it.

Klue's customers had their own belief: that granting Klue OAuth access was low-risk, because Klue only needed to read what Battlecards displays. OAuth grants are only as safe as the place the tokens are stored.

## What was actually going on

### A credential nobody remembered

Klue's CEO described the entry point as [a compromised legacy credential associated with an integration service](https://bleepingcomputer.com/news/security/klue-oauth-breach-victim-list-grows-as-icarus-hackers-claim-attack). FINRA calls it [a compromised service-account credential](https://www.finra.org/rules-guidance/guidance/cybersecurity-alert-klue-oauth-breach-and-salesforce-data-exfiltration). Huntress calls it [long-disused but still active](https://www.huntress.com/blog/klue-breach-investigation).

Several important details are missing. When TechCrunch asked, Klue [would not explain the purpose of the pilot](https://techcrunch.com/2026/06/23/klue-says-hackers-stole-credential-from-2022-that-led-to-customer-data-breaches/), how long it ran, or which third party had the credential. It didn't say why the credential wasn't revoked, what kind of credential it was, or whether it was stolen from the third party or from Klue. So nobody outside Klue knows yet how the attacker got the credential, only that it still worked.

### From one credential to many customers' tokens

The credential got the attacker into Klue's backend. From there, per FINRA, they [stole customer OAuth2 tokens](https://www.finra.org/rules-guidance/guidance/cybersecurity-alert-klue-oauth-breach-and-salesforce-data-exfiltration) used to integrate Battlecards with third-party platforms.

*Background:* an OAuth token is a pre-authorized key. The customer's admin approved Klue's access once, and the resulting token, especially a long-lived refresh token, lets whoever holds it call the customer's Salesforce API as "the Klue integration" without any password or MFA prompt. A vendor that integrates with many customers' CRMs is therefore holding many customers' keys in one place. Klue's backend was that place.

```diagram
title: one forgotten credential, many customers
flow!: 2022 pilot credential -> Klue backend -> customer OAuth tokens
flow!: stolen tokens -> Salesforce REST API -> bulk CRM export
note: no customer password or MFA was involved after the first step
```

### Exfiltration that looked like the integration

With the tokens, the attacker went straight to the customers' Salesforce instances and [exfiltrated CRM data in bulk using automated Python scripts](https://www.finra.org/rules-guidance/guidance/cybersecurity-alert-klue-oauth-breach-and-salesforce-data-exfiltration). ReliaQuest, which watched it happen in environments it monitors, describes the pattern. The attacker authenticated through Klue integration service accounts, generated OAuth tokens, enumerated Salesforce's object catalog, then paged through the query endpoint [for almost 24 hours](https://reliaquest.com/blog/threat-spotlight-integration-abused-in-crm-data-theft/). In one environment there was a burst of nearly a thousand queries in 15 minutes. In another, exfiltration ran for 6 hours.

Why didn't anyone notice sooner? ReliaQuest's explanation is that integrations are non-human identities [monitored far less closely than employee accounts](https://reliaquest.com/blog/threat-spotlight-integration-abused-in-crm-data-theft/). Traffic from "the Klue integration" is expected traffic.

The data taken, according to FINRA, included [business contact information, support case data, and business intelligence reports](https://www.finra.org/rules-guidance/guidance/cybersecurity-alert-klue-oauth-breach-and-salesforce-data-exfiltration). Klue says there is [no evidence that customer content stored directly within the Klue platform was impacted](https://bleepingcomputer.com/news/security/klue-oauth-breach-victim-list-grows-as-icarus-hackers-claim-attack).

## How they fixed it

Klue says it [immediately revoked affected credentials and tokens](https://bleepingcomputer.com/news/security/klue-oauth-breach-victim-list-grows-as-icarus-hackers-claim-attack), removed unauthorized code, disabled impacted integrations, notified law enforcement and brought in CrowdStrike. Salesforce and Gong [disabled the Klue Battlecards integration](https://www.finra.org/rules-guidance/guidance/cybersecurity-alert-klue-oauth-breach-and-salesforce-data-exfiltration) on their side.

FINRA's advice to firms: find out whether you or your critical vendors use Klue, hunt Salesforce and SaaS logs for unusual REST API activity and high-volume automated queries, revoke and rotate Klue-related OAuth tokens, and terminate active sessions. ReliaQuest adds that [revoking the refresh token, not just resetting a password](https://reliaquest.com/blog/threat-spotlight-integration-abused-in-crm-data-theft/), is what cuts off persistent access.

## What changed afterwards

Klue told TechCrunch it is [conducting a comprehensive review of credential management, vendor-access controls, monitoring capabilities, and deployment security processes](https://techcrunch.com/2026/06/23/klue-says-hackers-stole-credential-from-2022-that-led-to-customer-data-breaches/), and gave no further details. No public postmortem had been published in the sources read for this post.

## The rule

The credential that did this wasn't clever. It was left over. Pilots, proofs of concept and vendor trials all create access that is meant to be temporary, and nothing makes it so unless someone builds that in: an expiry date on the credential, an owner who is asked to renew it, and an alert when a credential that hasn't been used in months suddenly is.

The second lesson is for everyone who clicks "Allow" on an OAuth integration. That grant puts a key to your CRM in someone else's infrastructure, next to the keys of all their other customers. Scope it to what the integration actually needs, restrict it to known IP ranges where the platform allows, and watch its API volume as closely as a privileged employee's.

## Sources

- [FINRA, "Cybersecurity Alert: Klue OAuth Breach and Salesforce Data Exfiltration"](https://www.finra.org/rules-guidance/guidance/cybersecurity-alert-klue-oauth-breach-and-salesforce-data-exfiltration): the regulator's alert to member firms, covering the 12 June detection, the service-account credential, the stolen OAuth tokens, the platforms involved, affected organizations and recommendations.
- [Zack Whittaker, "Klue says hackers stole credential from 2022 that led to customer data breaches", TechCrunch, 23 June 2026](https://techcrunch.com/2026/06/23/klue-says-hackers-stole-credential-from-2022-that-led-to-customer-data-breaches/): Klue's statement that the credential was given to a third party in 2022 for a limited pilot, and what Klue declined to say.
- [Zack Whittaker, "Klue hack results in data breach at several cybersecurity firms", TechCrunch, 22 June 2026](https://techcrunch.com/2026/06/22/klue-hack-results-in-data-breach-at-several-cybersecurity-firms/): early coverage, including the "noindex" disclosure post and Klue's response.
- [Lawrence Abrams, "Klue OAuth breach victim list grows as Icarus hackers claim attack", BleepingComputer, 19 June 2026](https://bleepingcomputer.com/news/security/klue-oauth-breach-victim-list-grows-as-icarus-hackers-claim-attack): quotes from Klue CEO Jason Smith's statement, Klue's response steps, and Icarus's claim.
- [Huntress, "Cybercrime Breaches Klue: Salesforce Data Impacted for Many Victims, including Huntress", 18 June 2026](https://www.huntress.com/blog/klue-breach-investigation): an affected company's investigation, with the 11 June start, the 13 June customer alert and the extortion emails.
- [ReliaQuest, "Klue Integration Abused in Salesforce Data Theft"](https://reliaquest.com/blog/threat-spotlight-integration-abused-in-crm-data-theft/): observed attacker behaviour in Salesforce, including query volumes, durations and the Python-urllib tooling.
