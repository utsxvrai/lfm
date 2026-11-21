---
title: "Uber's 2022 breach: a bought password and a 2FA prompt someone finally accepted"
dek: "An attacker likely bought an Uber contractor's corporate password, then kept triggering two-factor approval requests until the contractor approved one. From that foothold they reached other accounts, G-Suite, Slack and Uber's HackerOne dashboard."
date: 2022-09-15
company: Uber
kind: security-breach
topics: [security, auth]
stack: [mfa, g-suite, slack, opendns, hackerone]
impact: "An attacker gained access to several internal Uber systems, downloaded some internal Slack messages and finance-tool data, and posted to a company-wide Slack channel; Uber said public-facing services stayed up."
rule: "A push-approval second factor is only as strong as the person tapping Approve; when the password is already stolen, a prompt with no context can be won by persistence."
postmortem: https://web.archive.org/web/20260304000835/https://www.uber.com/newsroom/security-update
sources: [https://web.archive.org/web/20260304000835/https://www.uber.com/newsroom/security-update, https://www.uber.com/newsroom/security-update/]
---

# Uber's 2022 breach: a bought password and a 2FA prompt someone finally accepted

On the evening of 15 September 2022, Uber posted a short statement: [it was responding to a cybersecurity incident](https://web.archive.org/web/20260304000835/https://www.uber.com/newsroom/security-update) and was in touch with law enforcement. Many Uber employees already knew something was wrong. The attacker had posted a message to a company-wide Slack channel and reconfigured Uber's OpenDNS so that [some internal sites showed employees a graphic image](https://web.archive.org/web/20260304000835/https://www.uber.com/newsroom/security-update).

Four days later, Uber published how it happened. No exploit chain, no zero-day. A contractor's password had probably been bought on the dark web, and the contractor's second factor, a login approval request, was eventually approved.

Uber's public statement is short, and this post sticks to it. It is still worth studying, because the technique is cheap, repeatable, and works against a very common MFA setup.

## What happened

From Uber's [19 September update](https://web.archive.org/web/20260304000835/https://www.uber.com/newsroom/security-update):

1. An Uber EXT contractor's personal device had been infected with malware, exposing their credentials. Uber says it is likely the attacker **purchased the contractor's Uber corporate password on the dark web**.
2. The attacker repeatedly tried to log in to the contractor's Uber account. Each attempt sent the contractor a **two-factor login approval request**, which at first blocked access.
3. Eventually the contractor accepted one, and the attacker was in.
4. From there the attacker accessed several other employee accounts, which ultimately gave them elevated permissions to a number of tools, including **G-Suite and Slack**.
5. They posted to a company-wide Slack channel and changed Uber's OpenDNS configuration to show a graphic image on some internal sites.

What the attacker reached, per Uber: several internal systems; some internal Slack messages, which appear to have been downloaded; information from an internal tool the finance team uses to manage some invoices; and Uber's dashboard at HackerOne, where security researchers report vulnerabilities. Uber said any bug reports the attacker could see [had been remediated](https://web.archive.org/web/20260304000835/https://www.uber.com/newsroom/security-update).

What Uber said it had *not* seen: access to the production systems that power its apps, to user accounts, or to the databases holding sensitive user data such as credit card numbers, bank account information or trip history. It found no changes to its codebase and no access to customer data in its cloud providers' storage, giving AWS S3 as the example. Uber attributed the attack to a group [affiliated with Lapsus$](https://web.archive.org/web/20260304000835/https://www.uber.com/newsroom/security-update).

## What the engineers believed

The design assumption here is the one behind most corporate MFA: **a stolen password alone isn't enough**. The attacker also needs the second factor, and the second factor is a device in the employee's pocket.

That assumption did its job at first. Uber's own wording is that the approval request "initially blocked access". The attacker had a valid password and still couldn't log in.

The weaker, implicit assumption is that a person who receives a login approval they didn't initiate will deny it, every time. That one failed.

## What was actually going on

### What a push approval actually proves

*Background, not from Uber's statement:* push-based MFA works like this. You submit a username and password. If they're correct, the identity provider sends a notification to your enrolled phone asking "Is this you signing in?" Tapping Approve completes the login for **whoever submitted the password**, wherever they are.

So the second factor proves the phone's owner tapped Approve. It does not prove the phone's owner is the person logging in. The cryptographic link between "the device that approved" and "the browser that gets the session" isn't there; the human is the link. If the approval screen carries little context (no location, no code to match), the human has little to judge with.

That's why the order of events matters. Once the password is known, the attacker controls *when* prompts are sent and *how many*. Each attempt costs them nothing. Each prompt costs the target attention: a notification at an odd hour, then another, then another. Uber's statement doesn't say how many requests were sent, over what period, or whether the attacker contacted the contractor through any other channel. It says only that the contractor eventually accepted one. The general pattern, sending approvals until someone gives in by mistake, fatigue, or a belief that approving will make it stop, is widely called **MFA fatigue** or **push bombing**. That label is background; Uber doesn't use it.

```diagram
title: why a stolen password beat push MFA
flow: password + login -> push to phone -> owner denies
flow!: repeated logins -> push after push -> one approve
note: the attacker chooses when and how often to ask
```

### Where the password came from

The first link was outside Uber entirely: malware on the contractor's **personal device** exposed their Uber corporate credentials. Uber didn't control that device, couldn't monitor it, and wouldn't necessarily know it had been infected. Credentials stolen this way are commonly resold. Uber says it is "likely" the attacker bought the password; it doesn't say it confirmed the purchase.

This is why contractors and personal devices are a recurring weak point: they have real access, and the security of the endpoint where that access is used is outside the company's view.

### From one account to many

The step from one contractor account to "elevated permissions" in G-Suite and Slack is the least explained part. Uber says only that the attacker "accessed several other employee accounts", which ultimately led to elevated permissions. It doesn't say how those other accounts were reached. Any mechanism you've read about elsewhere isn't in this source, so it's left out here.

What the statement does show is the blast radius of a single interactive login inside a company. Internal tools like chat, document storage, finance tooling, DNS filtering configuration and the vulnerability-report dashboard are all reachable from the inside, and many are behind the same SSO. Uber's response list, below, reads as an inventory of that radius: accounts, internal tools, service keys, the codebase.

## How they fixed it

Uber says its [existing security monitoring processes](https://web.archive.org/web/20260304000835/https://www.uber.com/newsroom/security-update) allowed teams to quickly identify the issue. Its priorities were to cut off access, make sure user data was secure and services weren't affected, and then investigate scope.

The actions it listed:

- Identified compromised or potentially compromised employee accounts and either **blocked their access or required a password reset**.
- **Disabled many affected or potentially affected internal tools.**
- **Rotated keys** to many internal services, "effectively resetting access".
- **Locked down the codebase**, preventing any new code changes.
- Required employees to **re-authenticate** when access to internal tools was restored, and said it was strengthening its MFA policies.
- Added more monitoring of the internal environment.

Uber said public-facing Uber, Uber Eats and Uber Freight services stayed operational throughout. Taking down internal tools minimally affected customer support, which was [back to normal by 19 September](https://web.archive.org/web/20260304000835/https://www.uber.com/newsroom/security-update). The internal tools taken down as a precaution started [coming back online on the morning of 16 September](https://web.archive.org/web/20260304000835/https://www.uber.com/newsroom/security-update).

## What changed afterwards

Uber's statement is a progress update, not a closed postmortem. It says the investigation was ongoing, that it was working with several digital forensics firms and coordinating with the FBI and US Department of Justice, and that it would ["continue to strengthen our policies, practices, and technology"](https://web.archive.org/web/20260304000835/https://www.uber.com/newsroom/security-update). The only concrete control change it names is "further strengthening our multi-factor authentication (MFA) policies", without saying what the new policy is.

*Background, not from Uber:* the standard countermeasures to push fatigue are well known. **Number matching** shows a code on the login screen that must be typed into the phone, so a blind tap can't approve someone else's login. **Rate-limiting and alerting** on repeated denied or ignored prompts turns a fatigue attack into a signal. **Phishing-resistant factors** such as FIDO2/WebAuthn security keys bind the approval to the origin and the device doing the login, so there's no remote prompt to approve at all.

## The rule

Assume passwords leak, including through devices you don't manage. Then ask what your second factor actually checks. If the answer is "a person tapped Approve", the attacker can try again until they get one, at a time of their choosing. Bind the second factor to the login (number matching or hardware keys), alert on bursts of unanswered prompts, and treat contractor access as production access, because to an attacker it is the same thing.

## Sources

- [Uber Newsroom, "Security update" (archived)](https://web.archive.org/web/20260304000835/https://www.uber.com/newsroom/security-update): Uber's official statement with updates from 15, 16 and 19 September 2022. Primary source for every fact in this post.
- [Uber Newsroom, "Security update" (original URL)](https://www.uber.com/newsroom/security-update/): the same statement at its original address, which returned 406 to automated fetches.
