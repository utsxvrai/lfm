---
title: "CircleCI: one stolen session cookie exposed every customer's CI secrets"
dek: "Malware on an engineer's laptop stole a 2FA-backed SSO session. The engineer could mint production access tokens, so the attacker reached CircleCI's databases and pulled encryption keys from a running process to unlock customers' stored secrets."
date: 2022-12-16
company: CircleCI
kind: security-breach
topics: [security, auth, data-leak]
stack: [sso, 2fa, github-oauth, environment-variables]
impact: "Customer environment variables, keys and tokens for third-party systems were exfiltrated on 22 December 2022; CircleCI told every customer to rotate stored secrets."
detected_by: customers
rule: "MFA protects the login, not the session it creates; anyone who can mint production credentials needs short sessions, step-up checks and device-bound tokens."
postmortem: https://circleci.com/blog/jan-4-2023-incident-report/
sources: [https://circleci.com/blog/jan-4-2023-incident-report/]
---

# CircleCI: one stolen session cookie exposed every customer's CI secrets

On 4 January 2023, CircleCI told its customers to rotate every secret they had stored on the platform: environment variables, API tokens, SSH keys, OAuth tokens. A week later it published an [incident report](https://circleci.com/blog/jan-4-2023-incident-report/) explaining why.

The intrusion began on [16 December 2022](https://circleci.com/blog/jan-4-2023-incident-report/), when malware landed on a CircleCI engineer's laptop. The malware didn't need the engineer's password or second factor. It stole a session that had already passed both. Six days later, the attacker exfiltrated customer secrets from CircleCI's production databases.

For a CI provider this is about as bad as it gets. A CI system holds the credentials its customers' pipelines use to deploy: cloud keys, registry tokens, signing keys. CircleCI's own advice was blunt: if you stored secrets on the platform in that period, ["assume they have been accessed"](https://circleci.com/blog/jan-4-2023-incident-report/).

## What happened

All times UTC, from CircleCI's [incident report](https://circleci.com/blog/jan-4-2023-incident-report/):

- **16 December 2022**: An engineer's laptop is compromised. The malware is **not detected by CircleCI's antivirus software**. It performs session cookie theft, letting the attacker impersonate the employee from a remote location.
- **19 December**: CircleCI has reason to believe the attacker performed reconnaissance.
- **22 December**: Exfiltration of data from a subset of databases and stores, including customer environment variables, tokens and keys. This is CircleCI's last record of unauthorized activity in production.
- **29 December**: A customer alerts CircleCI to **suspicious GitHub OAuth activity**.
- **30 December**: CircleCI learns that customer's GitHub OAuth token had been compromised.
- **31 December, 04:00**: Out of caution, CircleCI starts rotating all customers' GitHub OAuth tokens. Even with GitHub raising API rate limits, it takes time.
- **4 January 2023**: The investigation identifies the scope and the entry path. At 16:35 the compromised employee's access is shut off; at 18:30 production access is removed for nearly all employees; at 22:30 all potentially exposed production hosts are rotated.
- **5 January, 02:30**: Disclosure emails, blog post and support article go out.
- **5 to 7 January**: All Project API Tokens revoked (5 Jan, 03:26), Personal API Tokens created before 00:00 on 5 January revoked (6 Jan, 05:00), Bitbucket tokens rotated with Atlassian (6 Jan, 06:40 to 10:15), GitHub OAuth rotation completed (7 Jan, 07:30), and work begins with AWS to notify customers with potentially affected AWS tokens (7 Jan, 18:30).

At publication time, [fewer than 5 customers](https://circleci.com/blog/jan-4-2023-incident-report/) had told CircleCI of unauthorized access to third-party systems as a result.

## What the engineers believed

Two protections were in place, and both are what most companies rely on.

**SSO with 2FA.** The engineer's access was behind single sign-on with a second factor. A stolen password alone wouldn't get anyone in.

**Encryption at rest.** CircleCI says all the exfiltrated data [was encrypted at rest](https://circleci.com/blog/jan-4-2023-incident-report/). A stolen database dump would be ciphertext.

Both held for the threats they were designed for. Neither was designed for an attacker who is already *inside an authenticated session*, using the same privileges as a trusted engineer.

## What was actually going on

### MFA checks a login, and a cookie is what comes out of it

*Background:* when you sign in through SSO, the identity provider checks your password and second factor once. Then it hands your browser a session cookie (or a token) that says "this user is authenticated". Every later request presents that cookie, and the server trusts it until it expires. The cookie is a bearer credential: whoever holds it is treated as you. It isn't tied to your laptop's hardware or your network location unless the system adds that binding.

So malware that can read the browser's cookie store doesn't need to beat MFA. It waits until the user has done MFA, then copies the result. CircleCI describes exactly this: the malware stole ["a valid, 2FA-backed SSO session"](https://circleci.com/blog/jan-4-2023-incident-report/) and used it to impersonate the employee from elsewhere.

The report doesn't say how the malware reached the laptop. Among the indicators it lists for customers to search for are files named `PTX-Player.dmg` and `PTX.app` and the domain `potrax[.]com` ([CircleCI](https://circleci.com/blog/jan-4-2023-incident-report/)), but it doesn't describe the delivery.

### The session belonged to someone who could mint production credentials

A stolen session is as powerful as the person it belongs to. Here, the targeted employee ["had privileges to generate production access tokens"](https://circleci.com/blog/jan-4-2023-incident-report/) as part of their regular duties. That turned "impersonate one engineer" into "obtain fresh production credentials", and from there the attacker escalated into a subset of production systems and the databases holding customer secrets.

### Encrypted at rest, decrypted in memory

The data was encrypted at rest, but the attacker ["extracted encryption keys from a running process"](https://circleci.com/blog/jan-4-2023-incident-report/), which let them potentially decrypt it.

*Background:* this is the standing limitation of encryption at rest for data a service actively uses. A CI platform has to inject customers' secrets into builds, so some running process must be able to decrypt them on demand. That process holds the key, or a way to get it, in memory. Encryption at rest defends against a stolen disk or a leaked backup. It doesn't defend against someone with enough access to read the memory of the service that does the decrypting, because that's where the key has to be.

```diagram
title: three defenses, each bypassed in turn
flow: malware on laptop -> SSO cookie copied -> MFA skipped
flow!: engineer's access -> prod tokens -> databases
flow!: running process -> keys in memory -> secrets readable
note: each layer trusted the one before it
```

### Why a customer noticed first

The attacker's interest was in what the secrets unlocked elsewhere. The first visible signal was a customer seeing [suspicious GitHub OAuth activity](https://circleci.com/blog/jan-4-2023-incident-report/) on 29 December, a week after exfiltration. CircleCI notes that because third-party keys and tokens were taken, ["there is no way for us to know"](https://circleci.com/blog/jan-4-2023-incident-report/) whether they were used against those third-party systems. Only each customer's own logs could show that.

## How they fixed it

Containment, per the report: cut the compromised employee's access, removed production access from nearly all employees, rotated every potentially exposed production host, and revoked or rotated every class of customer token CircleCI controlled. Secrets CircleCI couldn't rotate itself, like customers' own cloud keys stored as environment variables, had to be rotated by customers. CircleCI said anything entered into the system [after 5 January 2023 could be considered secure](https://circleci.com/blog/jan-4-2023-incident-report/).

To help, it shipped a script to list secrets needing rotation, added SHA-256 signatures for checkout keys to match GitHub's UI, added an `updated_at` field to the Contexts API so customers could verify rotation, and made audit logs available on all plans.

To close the vector, it added MDM and antivirus detection for the malware's specific behaviors, restricted production access to a very small group, added [step-up authentication](https://circleci.com/blog/jan-4-2023-incident-report/) for those who kept it so that a stolen 2FA-backed SSO session alone wouldn't be enough, and added monitoring for the behavior patterns seen in the attack.

## What changed afterwards

CircleCI's stated plan: periodic automatic OAuth token rotation for all customers, a move from OAuth to GitHub apps for finer-grained permissions, a third-party review of its tooling configuration, "reducing session trust", more authentication factors, more regular access rotations, and making system permissions [more ephemeral](https://circleci.com/blog/jan-4-2023-incident-report/) so a stolen token is worth less. It also said it would make it easier for customers to adopt features like OIDC and IP ranges, which reduce the need to store long-lived cloud keys in the first place.

And it declined to blame the engineer: ["a security incident is a systems failure"](https://circleci.com/blog/jan-4-2023-incident-report/), with the organization responsible for layered safeguards.

## The rule

MFA proves who logged in; it says nothing about who holds the session afterwards. For anyone whose session can mint production credentials, shorten session lifetimes, require step-up authentication for privileged actions, and prefer credentials that expire in minutes over ones that last until someone remembers to rotate them. And if you're the customer, the best secret to have stored in a CI system is one that doesn't exist: OIDC-issued short-lived cloud credentials leave nothing long-lived to steal.

## Sources

- [CircleCI, "CircleCI incident report for January 4, 2023 security incident"](https://circleci.com/blog/jan-4-2023-incident-report/): the official incident report with the timeline, root cause, indicators of compromise and follow-up plan. Primary source for every fact in this post.
