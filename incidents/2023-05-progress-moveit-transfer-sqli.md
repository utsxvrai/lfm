---
title: "MOVEit Transfer: a SQL injection zero-day let CL0P plant a web shell and drain file-transfer servers"
dek: "CL0P exploited an unauthenticated SQL injection in Progress MOVEit Transfer to install the LEMURLOOT web shell on internet-facing servers, then used it to pull files, Azure storage keys and database records, and to create admin accounts that survived a web server rebuild."
date: 2023-05-27
company: Progress
kind: security-breach
topics: [security, data-leak, software-bug, database]
stack: [moveit-transfer, asp-net, sql-server, mysql, azure-sql]
impact: "Internet-facing MOVEit Transfer servers were infected with a web shell used to steal data from their underlying databases, in a campaign the FBI and CISA expected to become widespread."
rule: "An internet-facing app that builds SQL from request data is one string-concatenation away from handing out its database; parameterize every query and treat the database itself as a place an attacker can persist."
postmortem: https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a
sources: [https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a, https://nvd.nist.gov/vuln/detail/CVE-2023-34362]
---

# MOVEit Transfer: a SQL injection zero-day let CL0P plant a web shell and drain file-transfer servers

According to a joint FBI and CISA advisory, beginning on [27 May 2023](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a) the CL0P ransomware gang, also known as TA505, started exploiting a previously unknown SQL injection vulnerability in Progress Software's MOVEit Transfer. MOVEit Transfer is a managed file transfer product: organizations use it to move files to and from partners, usually through a web application exposed to the internet.

The vulnerability, CVE-2023-34362, let an **unauthenticated** attacker reach MOVEit Transfer's database. CL0P used it to install a web shell, named LEMURLOOT by the advisory, on internet-facing servers, and then used the web shell to [steal data from the underlying MOVEit Transfer databases](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a).

This post explains the mechanism, which is old and well understood. What's instructive is how much damage one injectable query does in a product whose whole job is to hold other people's files.

## What happened

From the [CISA advisory AA23-158A](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a), released 7 June 2023, and the [NVD record](https://nvd.nist.gov/vuln/detail/CVE-2023-34362):

1. **From 27 May 2023**, per open source information cited by the advisory, CL0P exploits a SQL injection zero-day in the MOVEit Transfer web application.
2. The exploit is used to **install a web shell** on MOVEit Transfer web applications. It was first seen named `human2.aspx`, to masquerade as the legitimate `human.aspx` that ships with the product.
3. The web shell is used to read files, query the database, pull Azure storage settings and keys, and create or delete admin accounts.
4. Progress announces the vulnerability with guidance on affected versions, upgrades and patching. CISA adds it to the **Known Exploited Vulnerabilities catalog on 2 June 2023**.
5. On 7 June, the FBI and CISA publish a joint advisory with indicators of compromise and detection rules, warning that given the ["speed and ease"](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a) of exploitation, they expect widespread exploitation of unpatched systems.

The NVD entry lists affected versions as those before 2021.0.6, 2021.1.4, 2022.0.4, 2022.1.5 and 2023.0.1, and says [all earlier versions are affected too](https://nvd.nist.gov/vuln/detail/CVE-2023-34362), including older unsupported ones. It notes exploitation of unpatched systems can occur over HTTP or HTTPS.

The advisory places this in a pattern. TA505 had run similar zero-day campaigns against Accellion File Transfer Appliance devices in 2020 and 2021 and against Fortra GoAnywhere MFT in early 2023, where the group claimed to have hit [approximately 130 victims over 10 days](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a).

## What the engineers believed

The sources don't describe Progress's internal design decisions, so this section is about the general assumption, labeled as such.

A file transfer product sits on the internet edge by necessity: partners have to reach it. The usual mental model is that authentication protects it. Files are behind logins, admin features are behind admin logins, and an anonymous visitor can reach only a login page and a few public endpoints.

SQL injection breaks that model, because the database doesn't know about the login page. If any request path, even an unauthenticated one, builds a query from attacker-controlled input, the attacker talks to the database with the application's own privileges. The NVD description confirms that's what was possible here: an **unauthenticated attacker** could gain access to the database, infer its structure and contents, and [execute SQL statements that alter or delete database elements](https://nvd.nist.gov/vuln/detail/CVE-2023-34362).

## What was actually going on

### SQL injection in one paragraph

*Background:* SQL injection happens when an application builds a SQL statement by concatenating strings that include user input. If the input contains SQL syntax, such as a quote that closes a string literal followed by more SQL, the database parses the attacker's text as part of the statement. The fix has been known for decades: parameterized queries, where the statement and the values are sent separately so values can never be parsed as SQL. The vulnerability class is CWE-89, which is how [NVD classifies CVE-2023-34362](https://nvd.nist.gov/vuln/detail/CVE-2023-34362).

The public sources used here don't identify which request parameter or code path was injectable, so this post doesn't guess.

### From database access to a web shell

Reading the database is bad. Running code on the server is worse. The advisory says the SQL injection [was used to install](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a) LEMURLOOT, a web shell written in C#. It doesn't spell out the steps from injection to file write, so neither does this post.

Once installed, LEMURLOOT works like this, per the advisory:

- On installation it **generates a random 36-character password**.
- It waits for HTTP requests with a header named `X-siLock-Comment` whose value equals that password. Requests without it get nothing unusual.
- Authenticated requests can then make it:
  - retrieve Azure system settings, Azure Blob Storage account, key and container;
  - enumerate the underlying SQL database;
  - fetch a file from the MOVEit Transfer system by name;
  - **create a new administrator account** with `LoginName` and `RealName` set to "Health Check Service", or delete such an account.
- It returns responses gzip-compressed.

It imports MOVEit's own libraries (`MOVEit.DMZ.ClassLib`, `MOVEit.DMZ.Application.Files`, `MOVEit.DMZ.Application.Users`) to use the product's own code paths for files and users. In other words, it doesn't need to understand MOVEit's storage format; it asks MOVEit.

```diagram
title: from one query to persistent access
flow: unauth request -> SQL injection -> database access
flow!: web shell -> files + Azure keys -> stolen data
flow!: admin row in DB -> survives rebuild -> back door
note: the database is part of the attack surface
```

### Why rebuilding the server isn't enough

The most useful line in the advisory for engineers is a short one: ["If a victim rebuilds the web server but leaves the database intact, the CL0P user accounts will still exist"](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a) and can be used for persistent access.

That follows from where the backdoor lives. The web shell is a file on the web server; delete it, or rebuild the server from a clean image, and it's gone. But the "Health Check Service" admin accounts are **rows in the application's database**. A clean web server connected to the same database will happily authenticate them. The usual incident-response instinct, "nuke the box and redeploy", cleans the compute and leaves the persistence intact.

The advisory gives a query to audit for active administrative accounts and says to verify only intended ones exist:

```sql
SELECT * FROM [<database name>].[dbo].[users] WHERE Permission=30 AND Status='active' and Deleted='0'
```

## How they fixed it

The sources available here record the fix at the level of "patch": Progress issued guidance on [affected versions, software upgrades and patching](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a), and NVD lists the fixed releases (2021.0.6, 2021.1.4, 2022.0.4, 2022.1.5 and 2023.0.1). For organizations that had been hit, the advisory supplies YARA rules for the web shell and its compiled DLLs, file hashes, the `human2.aspx` filename, the `X-siLock-Comment` header as an indicator, and the database query above.

## What changed afterwards

The advisory's mitigations are general hygiene rather than MOVEit-specific: maintain an asset inventory, grant admin privileges only when necessary and use application allowlisting, monitor network ports and services, and [patch regularly](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a). It also notes CL0P's shift, in campaigns since 2021, toward relying mostly on **data exfiltration rather than encryption**, which matches this campaign: the goal was the files on the transfer servers.

## The rule

Every query that touches request data must be parameterized, including on unauthenticated endpoints, because SQL injection runs with the application's database privileges no matter what the login page says. And when you respond to a compromise, remember that the database is part of the system an attacker can modify: check for accounts, settings and stored credentials they may have added before you declare a rebuilt server clean.

## Sources

- [CISA and FBI, "#StopRansomware: CL0P Ransomware Gang Exploits CVE-2023-34362 MOVEit Vulnerability", AA23-158A, 7 June 2023](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a): the joint advisory covering the campaign, the LEMURLOOT web shell, indicators and mitigations. Primary source.
- [NIST NVD, CVE-2023-34362](https://nvd.nist.gov/vuln/detail/CVE-2023-34362): the vulnerability record with the description, affected and fixed versions and CWE-89 classification.
