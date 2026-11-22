---
title: "LastPass: a dev-environment breach became a theft of every customer's vault backup"
dek: "Source code and secrets stolen in August 2022 told an attacker which engineer to target next. That engineer held the keys to LastPass's cloud backups, and the backups held encrypted copies of customer vaults."
belief: "LastPass thought its dev environment was walled off from production. A breach there led to stolen vault backups."
date: 2022-08
company: LastPass
kind: security-breach
topics: [security, data-leak, backup, auth]
stack: [cloud-storage, pbkdf2, aes-256]
impact: "An attacker copied customer account metadata and a backup of customer vault data, with sensitive fields encrypted under keys derived from each user's master password."
detected_by: engineers
rule: "Encryption at rest protects data only from people who can't reach the keys; if one identity can fetch both the ciphertext and its decryption keys, plan for that identity being stolen."
postmortem: https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident
sources: [https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident, https://blog.lastpass.com/posts/notice-of-recent-security-incident, https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/]
---

# LastPass: a dev-environment breach became a theft of every customer's vault backup

On 25 August 2022, LastPass told customers it had detected [unusual activity in its development environment two weeks earlier](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident). Someone had used a single compromised developer account to take portions of source code and proprietary technical information. LastPass said no customer data or vaults were involved, because the development environment held none.

That was true, and it turned out not to matter much. On 22 December 2022, LastPass disclosed that an attacker had used [information from the August incident](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident) to target another employee, obtain credentials and keys, and copy data out of a cloud storage environment holding backups of production data. Among what was copied was a backup of customer vault data.

The two incidents are a lesson in how a "contained" breach can still be the first half of a much worse one. LastPass's own later summary puts it plainly: it had declared the first incident closed, but [later learned that information stolen in it was used to identify targets and start the second](https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/).

## What happened

Assembled from LastPass's [rolling notice](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident) and its [March 2023 update](https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/):

1. **August 2022, incident 1.** A software engineer's corporate laptop was compromised. The September 2022 update says the method of the initial endpoint compromise was inconclusive, but the attacker used persistent access to [impersonate the developer once the developer had authenticated with multi-factor authentication](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident). The activity was confined to a four-day period, and LastPass's security team detected and contained it.
2. What was taken: [14 of 200 software repositories](https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/), internal scripts from those repositories that contained LastPass secrets and certificates, and internal documentation describing how the development environment worked.
3. **Incident 2.** The attacker targeted a senior DevOps engineer by [exploiting vulnerable third-party software](https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/) to deliver malware and bypass existing controls. The prize was "DevOps secrets": restricted secrets used to access LastPass's cloud-based backup storage.
4. With the [cloud storage access key and the "dual storage container decryption keys"](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident), the attacker copied backups. LastPass said it had seen [no threat-actor activity after 26 October 2022](https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/).
5. LastPass first announced the cloud-storage incident on [30 November 2022](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident), describing "unusual activity within a third-party cloud storage service" shared with its affiliate GoTo, and gave the details on 22 December.

The stolen backups included, per LastPass: basic customer account information and metadata (company names, end-user names, billing addresses, email addresses, telephone numbers, and the IP addresses customers used to reach the service); a [backup of customer vault data](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident); system configuration data, API secrets and third-party integration secrets; and a backup of the LastPass MFA/Federation database. That last one was encrypted, but [the separately stored decryption key was among the secrets stolen](https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/) in the second incident.

## What the engineers believed

The August notices lean on two separations, and both are reasonable designs.

**The development environment is walled off from production.** LastPass wrote that its development environment was [physically separated from production, had no direct connectivity to it, and contained no customer data or vaults](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident). Developers couldn't push code to production; only a separate Build Release team could. So a breach there could leak code, but not data.

**The vault is zero-knowledge.** Sensitive vault fields are encrypted on the client with a key derived from the user's master password, which [LastPass never knows or stores](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident). So even a stolen vault is unreadable.

Both beliefs held in a narrow sense. What they missed is that the development environment contained *knowledge*, including secrets, and that a vault backup being unreadable today is different from it being safe.

## What was actually going on

### A dev environment is a map

The first incident didn't need to reach production to be dangerous. The repositories' internal scripts [contained LastPass secrets and certificates](https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/), and the internal documentation described how things worked. LastPass says this information was used to identify targets for the second incident. An attacker who reads your code and runbooks learns which systems exist, where the valuable data is, which roles have access to it, and therefore whose machine to attack next.

That is the interpretive core of this incident: network separation between dev and prod limits where an attacker can *connect*, but not what they can *learn*.

### The backups were guarded by keys a small set of people held

LastPass's production services ran from on-premises data centers, with [cloud storage used for backups and regional data residency](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident). The cloud storage was physically separate from production, so the backups sat outside the controls protecting the live systems.

The backups were encrypted. But encryption at rest only moves the question to key custody. Here, the same set of DevOps secrets gave both the storage access key and the decryption keys for the storage containers. One compromised engineer was enough to reach both, which is exactly the situation the second set of keys was presumably meant to prevent. (That last point is interpretation; LastPass doesn't explain why the keys were held together.) The MFA/Federation database shows the same shape: encrypted, with its decryption key stored separately, and that key [also in the stolen secrets](https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/).

```diagram
title: from source code to vault backups
flow: dev laptop -> dev repos + secrets -> target chosen
flow!: DevOps engineer -> storage + dec keys -> vault backups
note: incident 1 picked the target for incident 2
```

### What "zero-knowledge" does and doesn't protect

*Background, not from the sources:* in a zero-knowledge password manager, the client derives an encryption key from the master password with a slow key-derivation function (here PBKDF2), and only ciphertext is sent to the server. The server can't decrypt it. But anyone who obtains a copy of the ciphertext can attempt **offline** guessing: try a candidate password, run the KDF, see if the result decrypts. There's no login rate limit offline, and the attacker can take as long as they like. The KDF's iteration count is the only throttle, because it sets the cost of each guess.

LastPass's notice matches this. It warns the attacker [may use brute force to guess master passwords](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident), and points to its defaults: a twelve-character minimum master password since 2018 and 100,100 PBKDF2 iterations. For users on those defaults it claimed guessing "would take millions of years". For users whose master password didn't follow the defaults, it said the number of guesses needed would be significantly reduced, and suggested they consider changing the passwords stored in their vault. The notice also tells users to check the current PBKDF2 iteration count on their own account, which implies the count could differ between accounts; it doesn't say how many accounts were below the default.

Two more limits of zero-knowledge show up in the data list. First, the vault format contains [unencrypted data such as website URLs](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident) alongside encrypted fields. So a stolen vault reveals which sites a user has accounts on even if it is never cracked. Second, the account metadata (names, emails, phone numbers, IP addresses) wasn't vault data at all; LastPass warned that it could be used for [phishing and credential-stuffing](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident).

And the clock runs differently for a stolen backup. A live system can be patched and its keys rotated. A copy of ciphertext taken in 2022 stays encrypted under whatever master password and iteration count it had at that moment; changing your master password afterward doesn't re-encrypt the attacker's copy. (Background reasoning, not a claim from the sources.)

## How they fixed it

After incident 1, LastPass [decommissioned the development environment entirely and rebuilt it from scratch](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident), replaced and hardened developer machines, and rotated relevant cleartext secrets and exposed certificates. It also brought in Mandiant.

After incident 2, it said it was [rotating all relevant credentials and certificates](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident), analyzing every account with suspicious activity in the cloud storage service, adding safeguards there, and supplementing endpoint security with a managed detection and response vendor. It had already notified [less than 3% of Business customers](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident) to recommend specific actions. The March 2023 update adds that it [analyzed and changed privileged access controls](https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/) and applied new policies to its cloud storage.

## What changed afterwards

The March 2023 update says LastPass reviewed its security policies to [restrict access and privilege](https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/), began expanding encryption within its application and backup infrastructure, and published separate security bulletins for consumer and business customers. The CEO also accepted criticism about communication: "I accept the criticism and take full responsibility," he wrote, acknowledging customers' frustration that the company hadn't communicated [more immediately, clearly and comprehensively](https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/).

LastPass also said the attacker's identity and motivation [remained unknown](https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/), with no contact, demands, or credible signs of the data being sold at that time.

## The rule

Treat a breach of a "non-sensitive" environment as reconnaissance for the next one, and rotate everything it could have taught the attacker, not just what it could reach. And when you encrypt backups, check who can obtain *both* the storage credentials and the decryption keys. If the answer is one person's workstation, the encryption is a speed bump for that one person's attacker. Split custody across people and systems, keep backup keys out of the same secret store as backup access, and assume any ciphertext that leaves your control will be attacked offline for years.

## Sources

- [LastPass, "Notice of Recent Security Incident" (archived)](https://web.archive.org/web/20261110041732/https://blog.lastpass.com/posts/notice-of-recent-security-incident): the official rolling notice, with the 25 August, 15 September, 30 November and 22 December 2022 updates. Primary source.
- [LastPass, "Notice of Recent Security Incident" (original URL)](https://blog.lastpass.com/posts/notice-of-recent-security-incident): the same notice at its original address, which returned 403 to automated fetches.
- [LastPass, "Security Incident Update and Recommended Actions", March 2023 (archived)](https://web.archive.org/web/20240110093635/https://blog.lastpass.com/2023/03/security-incident-update-recommended-actions/): the follow-up summary of both incidents, the data accessed, and remediation.
