---
title: "Equifax: an unpatched Struts portal and an expired certificate that blinded monitoring"
dek: "Attackers came in through a known Apache Struts flaw in a 1970s-era dispute portal and spent 76 days querying 48 databases. The device meant to inspect that traffic had been passing it through uninspected since its SSL certificate expired."
belief: "Equifax thought it had dealt with the Struts flaw. Its scans missed the portal, and an expired cert blinded its IDS."
date: 2017-05-13
company: Equifax
kind: security-breach
topics: [security, certificate, monitoring, data-leak]
stack: [apache-struts, ssl]
impact: "Personal information of 148 million people (per the House report; GAO says at least 145.5 million) was taken from Equifax databases."
detected_by: engineers
rule: "A security control that fails open must alert loudly when it does, and certificate expiry is an outage you can see coming years in advance."
postmortem: https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf
sources: [https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf, https://web.archive.org/web/20181013161433/https://www.gao.gov/products/GAO-18-559]
---

# Equifax: an unpatched Struts portal and an expired certificate that blinded monitoring

On September 7, 2017, Equifax, one of the large US consumer reporting agencies, announced a cybersecurity incident affecting [143 million consumers](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf). According to the US House Committee on Oversight and Government Reform's staff report, that number later grew to 148 million, which the report puts at nearly half the US population and 56 percent of American adults. The GAO's report on the breach gives a figure of [at least 145.5 million individuals](https://web.archive.org/web/20181013161433/https://www.gao.gov/products/GAO-18-559). The two sources' numbers differ, and both are given here.

The attack itself began on [May 13, 2017 and lasted 76 days](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf). The House report calls the breach "entirely preventable."

Two engineering failures sit at the centre: a patch that was ordered but never applied to the system that needed it, and a monitoring device that had stopped monitoring without anyone noticing. Neither is exotic. That's why it's worth studying.

## What happened

On March 7, 2017, a critical vulnerability in Apache Struts (CVE-2017-5638) was publicly disclosed. The House report says it let attackers use file uploads to trigger remote code execution. The next day, US-CERT alerted Equifax. On March 9, Equifax's Global Threat and Vulnerability Management (GTVM) team emailed [approximately 430 individuals](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf) and distribution lists telling anyone running Apache Struts to patch within 48 hours ([House report](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf)).

The vulnerable system was ACIS, the Automated Consumer Interview System, an internet-facing portal where consumers dispute errors in their credit files. Equifax originally built it in the 1970s and it ran on a complex legacy stack in a data center in Alpharetta, Georgia. ACIS was never patched.

On May 13, attackers got in through the Struts flaw on ACIS's application servers, getting past the firewalls in front of its web servers. They installed web shells (about 30 unique ones in total), found a mounted file share with a configuration file holding unencrypted application credentials, and used those credentials to reach [48 unrelated databases](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf) outside ACIS. They ran about 9,000 queries, found personal data 265 times, compressed the results into a web-accessible directory and pulled them out with `wget` ([House report](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf)).

On July 29, Equifax replaced an expired certificate on a traffic-inspection device and almost immediately saw suspicious traffic. On July 30 it took ACIS offline, and the attack ended.

## What the engineers believed

Equifax's security team believed it had dealt with the Struts flaw. It had good reasons:

- The patch notice went out within a day of the US-CERT alert, with a 48-hour deadline.
- An open-source component scan found no vulnerable Struts. Interim CSO Russ Ayres later said the scan missed it because it ran on the root directory, not the subdirectory where Apache Struts was listed ([House report](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf)).
- On March 15, a McAfee scanner with a new signature checked [958 external-facing IP addresses](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf) twice and found nothing.
- A Snort rule to detect Struts exploitation attempts was installed on the intrusion detection and prevention systems on March 14.

So there was a patch order, two clean scans, and an IDS rule watching for the exploit. On paper that's defence in depth. In practice, both scanners missed ACIS, and the IDS couldn't see ACIS's traffic.

## What was actually going on

### Why the IDS was blind

ACIS traffic was encrypted with TLS. An intrusion detection system can't match signatures against ciphertext, so Equifax put an **SSL Visibility (SSLV) appliance** in front of the IDS/IPS. It decrypted traffic to and from ACIS for inspection before passing it on. To decrypt, it needs a valid certificate for the domain it's inspecting ([House report](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf)).

The certificate on the SSLV appliance for the ACIS domain `ai.equifax.com` expired on January 31, 2016. Then the critical detail: "The default setting for this device allowed web traffic to continue through to the ACIS system, even when the SSL certificate was expired" ([House report](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf)). The traffic kept flowing, but it was no longer decrypted, so the IDS and IPS behind the appliance saw only encrypted bytes.

```diagram
title: what the expired cert changed
flow: internet -> SSLV decrypts -> IDS sees plaintext
flow!: cert expired -> SSLV passes through -> IDS sees ciphertext
note: the site kept working, so nothing looked broken
```

This is a **fail-open** design. Fail-open is often the right call for availability, since a security appliance that blocks all traffic when its certificate expires turns paperwork into an outage. But fail-open is only safe if the failure is *visible*. Here nothing broke for users, so no one noticed. The Snort rule installed on March 14 was sitting on an IDS that couldn't read the ACIS traffic it was meant to inspect.

The House report says this left Equifax without visibility into ACIS traffic for nineteen months. The sources disagree on the length: a footnote notes that GAO reported the certificate as expired for ten months, but that documents given to the Committee show the January 31, 2016 expiry date ([House report](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf)). The report also says Equifax had allowed at least 324 of its SSL certificates to expire at the time of the breach, 79 of them for devices monitoring highly business-critical domains.

### Why one portal reached 48 databases

ACIS needed access to only three databases to do its job. But it wasn't segmented off from other, unrelated databases, and the credentials in the config file worked against 48 of them ([House report](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf)). Ayres said storing credentials that way was against Equifax policy. Mandiant also told the Committee that file integrity monitoring could have detected the web shells being created, and Equifax didn't have it enabled on ACIS.

Each failure was survivable by itself. Together they gave the attackers a path all the way through: an unpatched entry point, write access to the server, plaintext credentials, a flat network, and no one watching.

### How it was found

At 9:00 pm on July 29, Equifax's Countermeasures team uploaded [67 new SSL certificates](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf) to the SSLV appliance in Alpharetta. Almost at once they saw a suspicious request from an IP address in China, with responses over 10 megabytes that may have contained image files related to credit investigations. Searching packet captures showed that IP had been contacting ACIS since July 25. Equifax couldn't tell what the actor did before July 29 because of the expired SSL certificate ([House report](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf)).

## How they fixed it

On July 30, Equifax found vulnerabilities in the ACIS code and more suspicious traffic, from a second IP address, and shut down the ACIS web portal for emergency maintenance, which ended the attack. On August 2 it hired Mandiant for forensics and contacted outside counsel and the FBI ([House report](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf)).

## What changed afterwards

Mandiant's report made eleven remedial recommendations ([House report](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf)), which map almost one-to-one onto the failures above. They include: improve vulnerability scanning and patch management; reduce sensitive data kept in backend databases; tighten access to critical databases; improve network segmentation between internet-facing systems and backend data; speed up file integrity monitoring on application and web servers; add more logging; deploy privileged account management; and improve visibility into encrypted traffic by deploying more inline decryption.

GAO adds that federal customers of Equifax, including the IRS, SSA and USPS, ran their own security assessments and changed their contracts. In the IRS's case, one contract was terminated ([GAO](https://web.archive.org/web/20181013161433/https://www.gao.gov/products/GAO-18-559)).

For a backend engineer, the transferable lessons:

1. **Inventory beats scanning.** Two scanners missed the vulnerable component, one because it looked in the wrong directory. Knowing which services ship which library versions, from build manifests or SBOMs, finds what a scan of a running system can miss.
2. **Monitor your monitors.** A control that fails open needs a heartbeat: alert when the IDS sees no decrypted traffic from a segment that should have it, and track certificate expiry like any other dated dependency.
3. **Credentials and network reach should match the job.** An app that needs three databases shouldn't be able to log into 48.

## The rule

A security control that fails open must alert loudly when it does, and certificate expiry is an outage you can see coming years in advance.

## Sources

- [The Equifax Data Breach (House Committee on Oversight and Government Reform, Majority Staff Report, December 2018)](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf): the primary source for the timeline, attack mechanics, SSLV appliance and certificate details, scanner failures, Mandiant recommendations, and the 143 to 148 million figures.
- [GAO-18-559, Data Protection: Actions Taken by Equifax and Federal Agencies in Response to the 2017 Breach](https://web.archive.org/web/20181013161433/https://www.gao.gov/products/GAO-18-559): GAO product page summarising its report, published August 30, 2018 (archive.org copy). It is the source for the "at least 145.5 million" figure and federal agencies' responses.
