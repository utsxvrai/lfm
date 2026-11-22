---
title: "Storm-0558: a stolen 2016 consumer signing key opened enterprise Exchange Online mailboxes"
dek: "Attackers forged authentication tokens with a Microsoft consumer (MSA) signing key that should have been retired. Exchange Online accepted them for enterprise accounts because its token validation checked the signature but not which kind of key had signed it."
belief: "Microsoft assumed its token library fully checked signing keys. A consumer key opened enterprise mailboxes."
date: 2023-05-15
company: Microsoft
kind: security-breach
topics: [security, auth, data-leak]
stack: [exchange-online, azure-ad, microsoft-account, openid-connect]
impact: "Email accounts at 22 enterprise organizations and 503 related personal accounts were accessed, per the CSRB, including about 60,000 emails taken from the US State Department alone."
detected_by: customers
rule: "Verifying a token's signature is not the same as verifying who it was meant for; check issuer and key scope explicitly, and give every signing key an owner, an age limit and an alarm."
postmortem: https://www.microsoft.com/en-us/msrc/blog/2023/07/microsoft-mitigates-china-based-threat-actor-storm-0558-targeting-of-customer-email
sources: [https://www.microsoft.com/en-us/msrc/blog/2023/07/microsoft-mitigates-china-based-threat-actor-storm-0558-targeting-of-customer-email, https://www.microsoft.com/en-us/msrc/blog/2023/09/results-of-major-technical-investigations-for-storm-0558-key-acquisition, https://www.cisa.gov/resources-tools/resources/CSRB-Review-Summer-2023-MEO-Intrusion, https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf]
---

# Storm-0558: a stolen 2016 consumer signing key opened enterprise Exchange Online mailboxes

Starting on [15 May 2023](https://www.microsoft.com/en-us/msrc/blog/2023/07/microsoft-mitigates-china-based-threat-actor-storm-0558-targeting-of-customer-email), a threat actor Microsoft tracks as Storm-0558 read the email of government agencies and other organizations through Outlook Web Access in Exchange Online and through Outlook.com. They didn't phish passwords or break MFA. They signed their own authentication tokens with a Microsoft signing key, and Microsoft's mail systems accepted them.

The US Cyber Safety Review Board (CSRB) later counted [22 enterprise organizations and 503 related personal accounts](https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf), including the mailboxes of the US Commerce Secretary, the US Ambassador to China and a member of Congress. The attacker downloaded [approximately 60,000 emails from the State Department alone](https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf). Microsoft's own July 2023 count was ["approximately 25 organizations"](https://www.microsoft.com/en-us/msrc/blog/2023/07/microsoft-mitigates-china-based-threat-actor-storm-0558-targeting-of-customer-email) plus related consumer accounts.

Microsoft didn't find it. A customer did. The CSRB's conclusion was that the intrusion ["was preventable and should never have occurred"](https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf).

## What happened

- **15 May 2023**: Storm-0558 [gains access to email accounts](https://www.microsoft.com/en-us/msrc/blog/2023/07/microsoft-mitigates-china-based-threat-actor-storm-0558-targeting-of-customer-email) using forged tokens.
- **15 to 16 June**: The State Department's security operations center detects anomalies in mailbox access. A custom alert rule it had built, nicknamed **"Big Yellow Taxi"**, fires on data from the `MailItemsAccessed` log. On 16 June, State contacts Microsoft ([CSRB](https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf)). Microsoft's blog dates it as ["customer reported information on June 16"](https://www.microsoft.com/en-us/msrc/blog/2023/07/microsoft-mitigates-china-based-threat-actor-storm-0558-targeting-of-customer-email).
- **16 to 26 June**: Microsoft investigates, initially assuming ordinary vectors like compromised devices or stolen credentials.
- **26 June**: Microsoft finds the attacker was using tokens signed by a **Microsoft consumer (MSA) signing key issued in 2016**, which should only ever have worked for consumer services and was supposed to have been retired ([CSRB](https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf)).
- **By 27 June**: Microsoft believes it has the technique and clears caching data in downstream systems to invalidate credentials derived from the key. The attacker almost immediately switches to phishing the same mailboxes, which Microsoft took as a sign the mitigation worked.
- **11 July**: Microsoft publishes its [first account](https://www.microsoft.com/en-us/msrc/blog/2023/07/microsoft-mitigates-china-based-threat-actor-storm-0558-targeting-of-customer-email).
- **6 September**: Microsoft publishes its [key-acquisition findings](https://www.microsoft.com/en-us/msrc/blog/2023/09/results-of-major-technical-investigations-for-storm-0558-key-acquisition), later corrected in an addendum.

## What the engineers believed

Microsoft runs two identity systems. The consumer one, Microsoft account (MSA), signs tokens for things like Outlook.com. The enterprise one, Azure AD (now Entra ID), signs tokens for organizational accounts. Microsoft's July post states the intended rule: MSA keys and Azure AD keys ["are issued and managed from separate systems and should only be valid for their respective systems"](https://www.microsoft.com/en-us/msrc/blog/2023/07/microsoft-mitigates-china-based-threat-actor-storm-0558-targeting-of-customer-email).

The engineers building the mail system believed the validation library enforced that rule. Microsoft's September post says so directly: ["Developers in the mail system incorrectly assumed libraries performed complete validation"](https://www.microsoft.com/en-us/msrc/blog/2023/09/results-of-major-technical-investigations-for-storm-0558-key-acquisition) and didn't add the issuer and scope check themselves.

## What was actually going on

### How token signing and validation work

*Background:* in OpenID Connect, an identity provider signs tokens with a private key and publishes the matching public keys at a metadata endpoint. A service receiving a token fetches that key list, checks that the token's signature verifies against one of the listed keys, and then checks claims such as the issuer and audience. The signature proves *some trusted key* signed it. Only the claim and key-scope checks prove the token was issued by the right authority for *this kind of account*.

### The common endpoint and the missing check

In September 2018, to support apps that work with both consumer and enterprise accounts, Microsoft introduced a [common key metadata publishing endpoint](https://www.microsoft.com/en-us/msrc/blog/2023/09/results-of-major-technical-investigations-for-storm-0558-key-acquisition) listing keys for both systems. It updated documentation to explain the key scope validation callers now had to do, which key is valid for enterprise and which for consumer accounts. But the helper libraries it provided validated signatures cryptographically and **did not perform that scope check automatically**. The mail system moved to the common endpoint in 2022.

Put together: the mail system pulled a key list that included consumer keys, checked that the token's signature matched a key on the list, and stopped there. So it would ["accept a request for enterprise email using a security token signed with the consumer key"](https://www.microsoft.com/en-us/msrc/blog/2023/09/results-of-major-technical-investigations-for-storm-0558-key-acquisition). The CSRB's summary of the result: combined with the stolen key, the flaw let Storm-0558 gain ["full access to essentially any Exchange Online account anywhere in the world"](https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf).

```diagram
title: why a consumer key opened enterprise mail
flow: enterprise token -> sig ok + scope ok -> mailbox
flow!: forged MSA token -> sig ok, no scope -> mailbox
note: one key list held both kinds of keys
```

### A key that should have been gone

The key itself was old. The CSRB reports that the consumer MSA system never got the automated key rotation the enterprise system had. Microsoft rotated consumer keys infrequently and by hand, then [stopped rotating entirely in 2021](https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf) after a major cloud outage linked to the manual process, and had no alert on the age of active signing keys. The 2016 key was meant to be retired in March 2021, but that was delayed.

One small good thing came from that. Because the key was officially inactive, Microsoft's identity system wasn't signing anything with it, so [every token signed by that key was the attacker's](https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf). That made hunting easy once the key was known.

### How the key was stolen: the sources disagree

This is where the record changed over time.

Microsoft's **September 2023** post said a consumer signing system crashed in April 2021 and the crash dump, because of a race condition, contained the signing key. The dump was moved from the isolated production network into a debugging environment on the corporate network, credential scanning missed the key, and Storm-0558 later compromised an engineer's corporate account with access to that environment. Microsoft called this ["the most probable mechanism"](https://www.microsoft.com/en-us/msrc/blog/2023/09/results-of-major-technical-investigations-for-storm-0558-key-acquisition), while noting it had no logs proving the exfiltration because of log retention.

Microsoft's **March 2024 addendum** to the same post walks parts of that back: ["we have not found a crash dump containing the impacted key material"](https://www.microsoft.com/en-us/msrc/blog/2023/09/results-of-major-technical-investigations-for-storm-0558-key-acquisition), and the race condition affected whether a dump could leave the secure environment, not whether the key could be in it. Its leading hypothesis became, more generally, that operational errors let key material leave the signing environment and be accessed via a compromised engineering account.

The **CSRB** says flatly that Microsoft [does not know how or when Storm-0558 obtained the key](https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf). It notes Microsoft told the Board in November 2023 that the September statements were inaccurate, and that the public correction came months later.

### Why a customer found it

State caught it because it had bought a higher license tier (G5) that included `MailItemsAccessed` logging, and built its own detection on top. The CSRB notes that log [wasn't accessible without that premium service](https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf), and few other victims had it.

## How they fixed it

Per Microsoft's [July post](https://www.microsoft.com/en-us/msrc/blog/2023/07/microsoft-mitigates-china-based-threat-actor-storm-0558-targeting-of-customer-email): it blocked tokens signed with the acquired key in OWA, replaced the key, and blocked tokens issued with it for impacted consumer customers. It also shipped changes to the `Microsoft.IdentityModel` and `Microsoft.Identity.Web` libraries to help customers' own apps validate tokens correctly.

## What changed afterwards

Microsoft's [September post](https://www.microsoft.com/en-us/msrc/blog/2023/09/results-of-major-technical-investigations-for-storm-0558-key-acquisition) lists: fixing the race condition, better detection of key material in crash dumps, better credential scanning in the debugging environment, and libraries that perform key scope validation automatically. The CSRB went further, concluding Microsoft's security culture ["was inadequate and requires an overhaul"](https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf), and issued recommendations for cloud providers.

## The rule

A signature check answers "did a key I trust sign this?", not "is this token valid here?". When one key list serves several trust domains, every validator must check issuer and key scope, and that check belongs in the library by default, not in documentation. And signing keys are the most valuable secrets you have: rotate them automatically, alarm on their age, and know at all times where their material can exist.

## Sources

- [MSRC, "Microsoft mitigates China-based threat actor Storm-0558 targeting of customer email", 11 July 2023](https://www.microsoft.com/en-us/msrc/blog/2023/07/microsoft-mitigates-china-based-threat-actor-storm-0558-targeting-of-customer-email): Microsoft's initial official statement. Primary source.
- [MSRC, "Results of Major Technical Investigations for Storm-0558 Key Acquisition", 6 September 2023, with March 2024 addendum](https://www.microsoft.com/en-us/msrc/blog/2023/09/results-of-major-technical-investigations-for-storm-0558-key-acquisition): Microsoft's root-cause findings on the key theft and validation flaw, and its later corrections.
- [CISA, "Cyber Safety Review Board Report on Summer 2023 Microsoft Online Exchange Incident"](https://www.cisa.gov/resources-tools/resources/CSRB-Review-Summer-2023-MEO-Intrusion): landing page for the CSRB review.
- [CSRB, "Review of the Summer 2023 Microsoft Exchange Online Intrusion" (PDF)](https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf): the full independent review, source of the victim counts, timeline, detection story and key-rotation history.
