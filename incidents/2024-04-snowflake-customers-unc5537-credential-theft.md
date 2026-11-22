---
title: "Old infostealer passwords and no MFA let UNC5537 empty Snowflake customer accounts"
dek: "Nobody broke into Snowflake. A financially motivated group logged into customer accounts with usernames and passwords stolen by infostealer malware, some dating back to 2020, on accounts with no MFA and no network allow list, then used Snowflake's own staging commands to export the data."
belief: "Snowflake customers thought old, unabused passwords were safe. Stolen logins with no MFA exported their data."
date: 2024-04
company: Snowflake
kind: security-breach
topics: [auth, security, data-leak]
stack: [snowflake, sql, jdbc]
impact: "Mandiant and Snowflake notified approximately 165 potentially exposed organizations whose Snowflake customer instances were targeted with stolen credentials."
detected_by: third-party
rule: "A password that has ever been on an untrusted machine is a public password. Accounts that can read everything need a second factor and a network boundary, not just a secret."
postmortem: https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion
sources: [https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion]
---

# Old infostealer passwords and no MFA let UNC5537 empty Snowflake customer accounts

In April 2024, Mandiant received [threat intelligence on database records](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion) that turned out to come from a company's Snowflake instance. Mandiant notified the company, which hired Mandiant to investigate. The answer was unglamorous: someone had logged in with a username and password stolen earlier by infostealer malware, and at the time of the compromise the account [did not have multi-factor authentication enabled](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion).

That first case was one of many. Mandiant tracks the actor as **UNC5537**, a financially motivated group that was [systematically compromising Snowflake customer instances using stolen customer credentials](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion), advertising the data for sale on cybercrime forums and trying to extort victims. By the time of Mandiant's report on 10 June 2024, Mandiant and Snowflake had notified [approximately 165 potentially exposed organizations](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion).

The important sentence in the report is about what did **not** happen. Mandiant found [no evidence that the access stemmed from a breach of Snowflake's enterprise environment](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion). Every incident it responded to in this campaign was traced back to compromised customer credentials.

## What happened

From [Mandiant's report](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion):

- **April 2024.** Mandiant gets intelligence on leaked database records, notifies the victim and investigates. Root cause: infostealer-stolen credentials, no MFA.
- **22 May 2024.** With additional intelligence pointing to a broader campaign, Mandiant contacts Snowflake and begins notifying potential victims through its Victim Notification Program.
- **30 May 2024.** Snowflake publishes detection and hardening guidance for its customers.
- **10 June 2024.** Mandiant publishes its report. By then, about 165 potentially exposed organizations have been notified, and Mandiant and Snowflake are running a joint investigation and coordinating with law enforcement.
- **17 June 2024.** Mandiant adds a Snowflake threat hunting guide.

Mandiant had been tracking UNC5537 as a distinct cluster [since May 2024](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion) and assessed with moderate confidence that it comprises members based in North America, collaborating with an additional member in Turkey.

## What the victims believed

The comfortable belief was that a cloud data warehouse is protected by the cloud provider's security, and that a username and password are a reasonable way to log in to it. Snowflake's own infrastructure wasn't breached, so in a narrow sense the first part was true. But the login door was the customer's, and it was guarded by only one thing.

A second belief, implicit in how the credentials were managed: **an old password is a safe password if nobody has abused it yet.** Mandiant found that credentials in infostealer output were [still valid, in some cases years after they were stolen](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion), and that in many cases they hadn't been rotated for [as long as four years](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion).

## What was actually going on

### The three missing controls

Mandiant attributes the campaign's success to [three primary factors](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion):

1. **No MFA.** Successful authentication required only a valid username and password.
2. **No rotation.** Credentials found in infostealer logs still worked, sometimes years later.
3. **No network allow lists.** The affected instances accepted logins from anywhere, not just trusted locations.

Any one of those, present, would likely have stopped a login with a stolen password from a VPN exit node. All three were absent on the affected accounts.

```diagram
title: why a 2020 password still worked in 2024
flow: infostealer on laptop -> creds in stealer logs -> never rotated
flow!: login from VPN IP -> no MFA, no allow list -> full data export
note: Snowflake itself was not breached; each control was optional
```

### Where the passwords came from

*Background:* infostealer malware runs on an infected computer and harvests saved browser passwords, session cookies and similar secrets, then uploads them. The resulting "logs" are traded and sold in bulk.

Mandiant names the families involved: [VIDAR, RISEPRO, REDLINE, RACOON STEALER, LUMMA and METASTEALER](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion). These ran on [non-Snowflake owned systems](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion). The earliest infection tied to a credential the actor used dated to [November 2020](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion), and Mandiant found [hundreds of customer Snowflake credentials](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion) exposed by infostealers since then. According to Mandiant and Snowflake's analysis, [at least 79.7% of the accounts](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion) the actor used had prior credential exposure.

The contractor angle is worth dwelling on. In several investigations, the infostealer infection happened on [contractor systems that were also used for personal activities, including gaming and downloads of pirated software](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion). Mandiant's point is structural: a contractor's laptop is often used to access several client organizations, often with admin-level privileges. One infected laptop can therefore hand over the keys to many companies at once, and none of those companies controls or monitors the device.

### What the attacker did once logged in

Initial access often came through Snowflake's web UI (Snowsight) or its CLI (SnowSQL) [running on Windows Server 2022](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion). Mandiant also found a custom attacker utility it tracks as **FROSTBITE**, in .NET and Java versions using Snowflake's own drivers, which ran SQL recon such as listing users, current roles, current IPs, session IDs and organization names. The actor also used the commercial database tool DBeaver Ultimate.

The exfiltration used nothing but documented Snowflake features. Mandiant lists the sequence:

- `SHOW TABLES` to list every database and table.
- `SELECT * FROM ...` to pull individual tables of interest.
- `LIST` to enumerate existing stages.
- `CREATE TEMPORARY STAGE` to make a staging area. Mandiant notes that a temporary stage is [deleted once the creator's session ends](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion).
- `COPY INTO @stage FROM (SELECT * FROM ...)` with `COMPRESSION=GZIP`, to dump tables into compressed CSV files in the stage.
- `GET @stage file:///...` to download the files to the attacker's machine.

*Background:* stages are Snowflake's mechanism for bulk loading and unloading files, and `COPY INTO` plus `GET` is the normal way to export a table. That is the uncomfortable part. Nothing here is an exploit. Once an attacker holds a valid password for an account with read access, a data warehouse is built to let that user export a lot of data quickly. The temporary stage then cleans up after itself.

Mandiant says UNC5537 mostly connected through [Mullvad or Private Internet Access VPN IP addresses](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion), used VPS systems from the Moldovan provider ALEXHOST SRL when exfiltrating, and stored stolen data on several VPS providers and on MEGA. Our inference, not Mandiant's statement: an allow list limited to corporate IP ranges would have refused those VPN logins outright.

### Not novel, and that's the point

Mandiant is direct about this: the campaign is ["not the result of any particularly novel or sophisticated tool, technique, or procedure"](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion). Its broad impact came from the size of the infostealer marketplace and missed opportunities to secure credentials. Mandiant also notes that stolen credentials were the [fourth most notable initial intrusion vector in 2023](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion), with 10% of intrusions starting that way.

## How it was handled

Per the report, Mandiant notified victims through its Victim Notification Program, Snowflake's Customer Support worked directly with affected customers, and the two companies ran a joint investigation while coordinating with law enforcement. Snowflake published detection and hardening guidance on 30 May, and Mandiant later released a threat hunting guide with queries for spotting malicious activity in Snowflake instances. It notes that default retention of the relevant views allows hunting across [the past 365 days](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion). The report also lists indicators of compromise, including the client application IDs the actor's tools presented.

## What changed afterwards

Mandiant's report doesn't describe platform changes; it ends with recommendations. It calls for [credential monitoring, the universal enforcement of MFA and secure authentication, limiting traffic to trusted locations for crown jewels, and alerting on abnormal access attempts](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion), and points to Snowflake's hardening guide. It also predicts the same pattern will be turned on [other SaaS platforms](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion).

## The rule

Treat any credential that has touched an unmanaged machine as already leaked. For systems that hold your most valuable data, a password alone is not access control: require a second factor, restrict where logins can come from, rotate long-lived secrets, and alert on logins from new client types and VPN ranges. Each of those is cheap compared to discovering your tables listed for sale.

A practical note for backend engineers (interpretation, not from the report): service accounts and contractor accounts are the ones most likely to be exempt from MFA "because it's a script" or "because they're external". Those exemptions are exactly what an attacker with a stolen-password list goes looking for.

## Sources

- [Mandiant, "UNC5537 Targets Snowflake Customer Instances for Data Theft and Extortion", Google Cloud Threat Intelligence blog, 10 June 2024 (updated 17 June)](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion): Mandiant's investigation report, covering the timeline, credential sources, contributing factors, attacker tooling, exfiltration commands, infrastructure and recommendations.
