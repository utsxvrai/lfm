---
title: "A misconfigured firewall handed out cloud credentials and leaked Capital One's credit applications"
dek: "Commands sent through a misconfigured web application firewall made a server fetch the credentials of its own role, and that role could list and copy more than 700 storage buckets. The data sat in a GitHub gist for months before a stranger emailed the bank."
belief: "Capital One's firewall was meant to keep attackers out. A misconfiguration handed out its cloud credentials."
date: 2019-07-19
company: Capital One
kind: security-breach
topics: [security, data-leak, auth]
stack: [s3, waf, cloud-credentials]
impact: "Capital One says the incident affected about 100 million people in the United States and about 6 million in Canada."
detected_by: third-party
rule: "Every credential a server can fetch for itself is reachable by anyone who can make that server send a request. Scope the role to what the server actually does, and alert when it does something else."
postmortem: https://www.capitalone.com/digital/facts2019/
sources: [https://www.capitalone.com/digital/facts2019/, https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download, https://web.archive.org/web/20191221120615/https://www.justice.gov/usao-wdwa/pr/seattle-tech-worker-arrested-data-theft-involving-large-financial-services-company, https://www.occ.gov/news-issuances/news-releases/2020/nr-occ-2020-101.html]
---

# A misconfigured firewall handed out cloud credentials and leaked Capital One's credit applications

On 19 July 2019, Capital One [determined that "an outside individual gained unauthorized access"](https://www.capitalone.com/digital/facts2019/) to personal information about its credit card customers and applicants. The access itself had happened months earlier, [on March 22 and 23, 2019](https://www.capitalone.com/digital/facts2019/).

The bank's own count is that the event [affected approximately 100 million individuals in the United States and approximately 6 million in Canada](https://www.capitalone.com/digital/facts2019/). The largest category was [credit card application data from 2005 through early 2019](https://www.capitalone.com/digital/facts2019/): names, addresses, phone numbers, email addresses, dates of birth and self-reported income. It also included [about 140,000 Social Security numbers and about 80,000 linked bank account numbers](https://www.capitalone.com/digital/facts2019/) of US customers, and [approximately 1 million Social Insurance Numbers](https://www.capitalone.com/digital/facts2019/) of Canadian customers.

There was no zero-day and no stolen password. According to the FBI's criminal complaint, a [firewall misconfiguration "permitted commands to reach and be executed by" a server](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download). One of those commands got the server's own cloud credentials. Those credentials could list and copy the bank's storage buckets.

## What happened

Capital One's public page is short on mechanics. Most of the technical detail comes from the [criminal complaint](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download) filed on 29 July 2019, which in turn relies on what Capital One told the FBI. The complaint never names the cloud provider. It calls it "the Cloud Computing Company", though the tipster's email was titled "Leaked s3 data".

1. **12 March 2019.** An IP address belonging to a VPN provider [attempted to access Capital One's data](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download).
2. **22 March 2019.** An account called `*****-WAF-Role` (the complaint redacts the prefix) was used to run a "List Buckets" command several times from what the agent believed were TOR exit nodes. The same role then ran a "Sync" command [a number of times](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download) to copy data, including files with credit card application data.
3. **21 April 2019.** Another List Buckets command ran. A file posted to a GitHub gist with the same timestamp contained the server's IP address, the three commands, and [a list of more than 700 folders or buckets](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download).
4. **17 July 2019.** Someone who had seen the gist emailed Capital One's responsible-disclosure address: ["There appears to be some leaked s3 data of yours in someone's github / gist"](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download).
5. **19 July 2019.** After its own investigation, Capital One [determined there had been an intrusion and contacted the FBI](https://web.archive.org/web/20191221120615/https://www.justice.gov/usao-wdwa/pr/seattle-tech-worker-arrested-data-theft-involving-large-financial-services-company).
6. **29 July 2019.** The FBI searched the suspect's home and [seized storage devices containing a copy of the data](https://web.archive.org/web/20191221120615/https://www.justice.gov/usao-wdwa/pr/seattle-tech-worker-arrested-data-theft-involving-large-financial-services-company).

So the bank found out about a March breach in July, and it found out from a stranger. Capital One's FAQ says the [configuration vulnerability was reported by an external security researcher through its Responsible Disclosure Program on July 17](https://www.capitalone.com/digital/facts2019/).

## What the engineers believed

None of the sources describes Capital One's internal reasoning, so this section is interpretation.

A web application firewall sits in front of applications and filters inbound requests. It is easy to think of it as part of the perimeter, the thing that keeps attackers out. A WAF also has to run somewhere, and in a cloud it runs on a server that has an identity of its own. That identity, the `*****-WAF-Role` in the complaint, could list buckets and copy data out of them.

The reasonable-sounding assumptions are: the WAF is a security device, so its configuration is safe; the role it runs under is internal, so nobody outside can use it; and if the role is ever misused, someone will notice. The complaint shows each of these was wrong here. Capital One told the FBI that the role [does not, "in the ordinary course of business," invoke the List Buckets command](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download). The role had permission to do something it never needed to do, and the first time it did that, nothing stopped it and nobody noticed.

## What was actually going on

### Servers in a cloud carry their own credentials

*Background, not from the sources:* in the major public clouds, a virtual machine can be given a role. Software on the machine gets temporary credentials for that role by asking a metadata endpoint that only the machine itself can reach. This is good practice compared with long-lived keys in config files, because the credentials rotate and nobody has to copy secrets around.

The consequence is that **anyone who can make the machine send an HTTP request of their choosing can ask for those credentials.** If a proxy, a WAF or an image fetcher on that machine will forward a request to an attacker-chosen address, the attacker can point it at the metadata endpoint and read back the credentials. That class of bug is usually called server-side request forgery (SSRF).

The complaint doesn't use the term SSRF or mention a metadata endpoint. What it says is consistent with that pattern: commands could [reach and be executed by](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download) the server because of a firewall misconfiguration, and the first command in the gist ["obtained security credentials for an account known as *****-WAF-Role"](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download).

### The three commands

The complaint describes what was in the gist:

| Command | What it did, per the complaint |
| --- | --- |
| 1 | Obtained security credentials for `*****-WAF-Role` |
| 2 ("List Buckets") | Used those credentials to list the names of buckets in Capital One's storage |
| 3 ("Sync") | Used those credentials to copy data from every bucket the role could read |

Capital One [tested the commands and confirmed they worked](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download), and that the 700-plus names in the file matched its real buckets.

```diagram
title: from a WAF request to the buckets
flow: outside request -> misconfigured WAF -> server runs it
flow!: get role creds -> list 700+ buckets -> sync data out
note: the WAF's own identity could read the data
```

### Why the blast radius was so large

The firewall bug gave the attacker the role. The role's permissions decided how much data walked out. A WAF needs to read its rules and write its logs. Nothing in the sources explains why its role could list hundreds of buckets and read credit card applications. That gap between what a component does and what its identity is allowed to do is what turned one misconfiguration into 100 million records.

Some fields were protected. Capital One told the FBI that [Social Security numbers in the applications had been tokenized or encrypted, but names, addresses, dates of birth and credit history had not](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download). Field-level tokenization limited the worst of it. It didn't help with everything else in the row.

### The numbers in the two sources differ

The complaint, written days after discovery, cites [approximately 120,000 Social Security numbers and approximately 77,000 bank account numbers](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download). Capital One's page says [about 140,000 and about 80,000](https://www.capitalone.com/digital/facts2019/). Capital One's analysis also kept going: in January 2021 it found [approximately 4,700 more US customers or applicants whose Social Security numbers were in the stolen files](https://www.capitalone.com/digital/facts2019/) but had not been identified before.

### Why nobody noticed until July

The role ran an unusual command, from TOR exit nodes and a VPN provider, on 22 March. The complaint says Capital One's logs recorded all of it. Logging isn't the same as detection. The sources don't describe any alert firing. What actually triggered the investigation was the attacker's own post, which a third party spotted and reported.

## How they fixed it

Capital One says it ["immediately fixed the issue and promptly began working with federal law enforcement"](https://www.capitalone.com/digital/facts2019/). It doesn't describe the technical fix.

The suspect was arrested on 29 July and [charged with computer fraud and abuse](https://web.archive.org/web/20191221120615/https://www.justice.gov/usao-wdwa/pr/seattle-tech-worker-arrested-data-theft-involving-large-financial-services-company). The complaint says her online resume listed [work at the Cloud Computing Company in 2015-16](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download). Capital One says the government believes [the data has been recovered and there is no evidence it was used for fraud or shared](https://www.capitalone.com/digital/facts2019/).

## What changed afterwards

In August 2020 the Office of the Comptroller of the Currency assessed an [$80 million civil money penalty](https://www.occ.gov/news-issuances/news-releases/2020/nr-occ-2020-101.html). The regulator's reason wasn't the specific firewall rule. It cited the bank's ["failure to establish effective risk assessment processes prior to migrating significant information technology operations to the public cloud environment"](https://www.occ.gov/news-issuances/news-releases/2020/nr-occ-2020-101.html) and its failure to fix those deficiencies in time.

Capital One also reached a [class action settlement that a federal court preliminarily approved on February 7, 2022](https://www.capitalone.com/digital/facts2019/), and notified affected customers by mail.

## The rule

A server's identity is part of its attack surface. Anything that can make the server send a request can probably get its credentials, so the question that matters is: *if someone gets this role, what can they reach?* For a WAF, the answer should be "its rules and its logs". Here it was hundreds of buckets of customer data.

Two habits follow (general practice, not from the sources). Give each role only the permissions its component uses, and review that from the data side too: who can read this bucket? And alert on behavior a role has never shown before. Capital One's logs already showed a WAF role listing buckets from TOR, but nobody found out until a stranger sent an email in July.

## Sources

- [Capital One, "Information on the Capital One cyber incident"](https://www.capitalone.com/digital/facts2019/): the company's official statement and FAQ, with dates, affected counts, data types, how it learned of the issue and later updates.
- [United States v. Paige A. Thompson, criminal complaint, W.D. Wash., 29 July 2019 (archived DOJ copy)](https://web.archive.org/web/20200102024643/https://www.justice.gov/usao-wdwa/press-release/file/1188626/download): FBI affidavit describing the misconfigured firewall, the `*****-WAF-Role` credentials, the List Buckets and Sync commands and the log timeline.
- [US Attorney's Office, W.D. Wash., "Seattle Tech Worker Arrested for Data Theft Involving Large Financial Services Company" (archived)](https://web.archive.org/web/20191221120615/https://www.justice.gov/usao-wdwa/pr/seattle-tech-worker-arrested-data-theft-involving-large-financial-services-company): DOJ press release summarizing the complaint and the arrest.
- [OCC, "OCC Assesses $80 Million Civil Money Penalty Against Capital One", 6 August 2020](https://www.occ.gov/news-issuances/news-releases/2020/nr-occ-2020-101.html): the regulator's penalty and its stated reasons.
