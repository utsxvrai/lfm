---
title: "Stolen Heroku and Travis CI OAuth tokens let an attacker clone private GitHub repos, including npm's"
dek: "An attacker got into a Heroku database and downloaded the GitHub OAuth tokens Heroku stored for its customers. Each token was a working credential into someone's GitHub account, so the attacker listed organizations, picked targets and cloned private repositories. GitHub spotted it when one of those repos yielded an AWS key used against npm."
belief: "Heroku kept GitHub OAuth tokens in its database. Stolen from there, they opened customers' private repos."
date: 2022-04-07
company: Heroku
kind: security-breach
topics: [security, auth, supply-chain, data-leak]
stack: [oauth, github, heroku, travis-ci, npm, aws]
impact: "Stolen OAuth tokens issued to Heroku and Travis CI were used to download private repositories from dozens of organizations, including npm."
detected_by: third-party
rule: "A stored OAuth token is a live password to someone else's system: scope it narrowly, keep it somewhere an application breach can't reach, and know how you'd revoke all of them at once."
postmortem: https://www.heroku.com/blog/april-2022-incident-review
sources: [https://www.heroku.com/blog/april-2022-incident-review, https://github.blog/2022-04-15-security-alert-stolen-oauth-user-tokens/, https://blog.heroku.com/april-2022-incident-review]
---

# Stolen Heroku and Travis CI OAuth tokens let an attacker clone private GitHub repos, including npm's

On 12 April 2022, GitHub's security team found someone accessing npm's production infrastructure with a compromised AWS API key. Tracing it back, GitHub found an attack campaign: an attacker had [abused stolen OAuth user tokens issued to two third-party OAuth integrators, Heroku and Travis-CI, to download data from dozens of organizations, including npm](https://github.blog/2022-04-15-security-alert-stolen-oauth-user-tokens/).

GitHub itself wasn't breached. The tokens came from the companies GitHub had issued them to. Heroku later established that on 7 April [a threat actor obtained access to a Heroku database and downloaded stored customer GitHub integration OAuth tokens](https://www.heroku.com/blog/april-2022-incident-review).

This post focuses on the Heroku side, which has the fullest public investigation, and on the mechanism that makes this class of breach so effective: an integration that stores tokens for many users is a vault of other people's keys.

## What happened

From [Heroku's incident review](https://www.heroku.com/blog/april-2022-incident-review) and [GitHub's security alert](https://github.blog/2022-04-15-security-alert-stolen-oauth-user-tokens/):

- **Initial access (date not stated):** The attacker gained initial access to Heroku using a compromised token for a Heroku **machine account**. Heroku determined the attacker got that token from an archived private GitHub repository containing Heroku source code, which the attacker accessed [via a third-party integration with that repository](https://www.heroku.com/blog/april-2022-incident-review). Heroku says it was unable to definitively confirm which integration.
- **7 April:** The attacker downloaded stored customer GitHub OAuth tokens from a Heroku database. The same day, they also downloaded data from another database storing pipeline-level config vars for Review Apps and Heroku CI.
- **8 April:** According to GitHub, the attacker began enumerating metadata about customer repositories using the tokens.
- **9 April:** The attacker downloaded a subset of Heroku's own private GitHub repositories, containing some Heroku source code. Per GitHub, they also cloned private repositories belonging to a small number of Heroku customers.
- **12 April:** GitHub detected unauthorized access to npm's infrastructure using a compromised AWS API key. GitHub believes that key was obtained when the attacker [downloaded a set of private npm repositories using a stolen OAuth token](https://github.blog/2022-04-15-security-alert-stolen-oauth-user-tokens/).
- **13 April:** GitHub notified Heroku. Within three hours, Heroku disabled the identified compromised user's OAuth token and GitHub account. GitHub says it disclosed its findings to Heroku and Travis CI on 13 and 14 April.
- **14 April:** Heroku engaged a third-party incident response partner. Heroku reports no evidence of the attacker accessing Heroku systems after this date.
- **15 April:** Heroku notified customers, revoked all existing Heroku Dashboard GitHub integration tokens and prevented new ones being created. GitHub published its alert.
- **5 May:** Heroku reset customer passwords after finding the attacker had exfiltrated the database of usernames and hashed, salted passwords.
- **16 to 18 May:** Heroku detected the config-var theft and privately notified affected customers.

GitHub listed the affected OAuth apps: [four Heroku Dashboard apps and Travis CI](https://github.blog/2022-04-15-security-alert-stolen-oauth-user-tokens/). This write-up doesn't cover how the Travis CI tokens were obtained; neither source used here describes it.

## What the engineers believed

**"Tokens are safer than passwords."** That's the premise of OAuth, and it's true in the important ways: the user never gives their GitHub password to Heroku, and the token can be revoked without changing the password. But to do its job, the integration has to **store** a usable token for every user who connects. The safety of every one of those GitHub accounts then rests on the security of the integrator's database.

**"Credentials in a private repository are private."** The attacker's initial foothold was a machine-account token found in an [archived private GitHub repository](https://www.heroku.com/blog/april-2022-incident-review). A private repo is only as private as every person and integration that can read it.

## What was actually going on

### What an OAuth integration token is

*(Background.)* When you click "Connect to GitHub" on a service like Heroku, GitHub asks you to authorise that app with some set of permissions (scopes). GitHub then issues the app an access token tied to your account. The app stores it and presents it on each API call to act as you, within those scopes. Anyone else holding that token can do the same; the GitHub API can't tell the attacker from Heroku.

GitHub notes that it [does not store the tokens in their original, usable formats](https://github.blog/2022-04-15-security-alert-stolen-oauth-user-tokens/), which is why it concluded the tokens weren't stolen from GitHub. The integrators, by contrast, need the usable form to make API calls.

### The attack pattern

GitHub's [27 April update](https://github.blog/2022-04-15-security-alert-stolen-oauth-user-tokens/) describes what the attacker did with each stolen token:

1. Authenticated to the GitHub API with tokens issued to Heroku and Travis CI.
2. For most token holders, listed all the user's organizations.
3. Selectively chose targets based on those organizations.
4. Listed private repositories for accounts of interest.
5. Cloned some of those repositories.

GitHub's reading is that the listing was there to pick targets, and that the attacks were ["highly targeted"](https://github.blog/2022-04-15-security-alert-stolen-oauth-user-tokens/). It also observed that the attacker may have been [mining the downloaded private repository contents](https://github.blog/2022-04-15-security-alert-stolen-oauth-user-tokens/) for secrets to pivot into other infrastructure.

```diagram
title: from one database to many orgs
flow: token in a repo -> Heroku database -> OAuth tokens
flow!: list orgs -> clone private repos -> secrets in code
note: each hop used a credential found at the last one
```

### Why it compounds

Look at the chain. A credential in a repository gave access to Heroku. Heroku held credentials for many customers' GitHub accounts. Those accounts held private repositories. At least one of those repositories (npm's) held an AWS key, which GitHub detected being used against npm's production infrastructure. Each step was a stored secret that unlocked the next.

GitHub's assessment of npm: the attacker had unauthorized access to and downloaded npm's private repositories, and had potential access to npm packages in S3. GitHub's assessment at the time was that the attacker [did not modify any packages or gain access to any user account data or credentials](https://github.blog/2022-04-15-security-alert-stolen-oauth-user-tokens/).

## How they fixed it

**Heroku** disabled the compromised account's token and GitHub account within three hours of notification, then [revoked all existing tokens](https://www.heroku.com/blog/april-2022-incident-review) from the Heroku Dashboard GitHub integration and stopped new ones being created. It put a production moratorium in place, rotated credentials of other critical accounts, re-encrypted data, disabled internal automation, added threat detection and shut down non-essential systems. It reset customer passwords on 5 May because not every customer had MFA and passwords might be reused, even though they were hashed and salted.

Heroku acknowledged that cutting off the GitHub integration and rotating credentials [impacted our customers](https://www.heroku.com/blog/april-2022-incident-review).

**GitHub** revoked tokens tied to its own and npm's use of the affected apps, asked Heroku and Travis CI to revoke all user tokens for the apps, and directly notified affected users. By 27 April it was sending the [final expected notifications](https://github.blog/2022-04-15-security-alert-stolen-oauth-user-tokens/).

## What changed afterwards

Heroku said it was reviewing its third-party integrations and removing those not aligned with its security standards. It also said it intended to explore with GitHub [RFC-8705 based mutual TLS and private key protection for OAuth](https://www.heroku.com/blog/april-2022-incident-review), and closer parity with the GitHub App model, which gives more modular access to connected repositories. *(Background: RFC 8705 binds tokens to a client certificate, so a stolen token alone isn't enough to use it.)*

Heroku's advice to customers: don't reuse passwords, enable MFA, and review any integration connected to your GitHub repositories. GitHub's: regularly review and prune authorised OAuth applications and check audit logs.

## The rule

When your service stores OAuth tokens for other systems, you're holding live credentials to your users' accounts elsewhere, so treat that store as more sensitive than your own passwords. Ask for the narrowest scopes that work, prefer per-repository or app-style grants over broad user tokens, consider sender-constrained tokens so possession alone isn't enough, isolate the token store from the rest of the application, and have a tested way to revoke every token at once. And assume anything committed to a repository, even a private or archived one, will eventually be read by someone you didn't intend.

## Sources

- [Heroku, "April 2022 Incident Review" (Bob Wise, last updated 14 June 2022)](https://www.heroku.com/blog/april-2022-incident-review): Heroku's investigation summary, covering initial access, the token and config-var theft, the timeline, containment and follow-up.
- [GitHub, "Security alert: Attack campaign involving stolen OAuth user tokens issued to two third-party integrators" (Mike Hanley, 15 April 2022, updated 27 April)](https://github.blog/2022-04-15-security-alert-stolen-oauth-user-tokens/): GitHub's detection via npm, the affected apps, the attacker's pattern of activity and the impact on npm.
- [Heroku blog, same incident review](https://blog.heroku.com/april-2022-incident-review): the original blog URL for Heroku's review.
