---
title: "CrowdStrike Channel File 291: 21 fields defined, 20 supplied, and a kernel driver read past the end"
dek: "A Falcon content update made the sensor's Content Interpreter compare against a 21st input that the sensor code never supplied. In a kernel driver, that out-of-bounds read crashed Windows hosts. The mismatch had existed since February; it took a non-wildcard value in field 21 to reach it."
date: 2024-07-19
company: CrowdStrike
kind: outage
topics: [config-change, deploy, software-bug]
stack: [windows, kernel-driver, crowdstrike-falcon, cpp]
impact: "Windows hosts running Falcon sensor 7.11 and above that were online between 04:09 and 05:27 UTC on 19 July 2024 and received the update crashed (BSOD); Mac and Linux hosts were not affected."
rule: "Data that drives code in a privileged process is code. Validate it against what the consumer actually provides, bounds-check at runtime, and roll it out in stages like any other deploy."
postmortem: https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf
sources: [https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf, https://www.crowdstrike.com/en-us/blog/falcon-content-update-preliminary-post-incident-report/]
---

# CrowdStrike Channel File 291: 21 fields defined, 20 supplied, and a kernel driver read past the end

On Friday 19 July 2024 at [04:09 UTC](https://www.crowdstrike.com/en-us/blog/falcon-content-update-preliminary-post-incident-report/), CrowdStrike released a routine content configuration update for its Falcon sensor on Windows. Its purpose was to gather telemetry on possible new threat techniques. Windows machines that received it crashed with a blue screen.

The affected systems were [Windows hosts running sensor version 7.11 and above that were online between 04:09 and 05:27 UTC and received the update](https://www.crowdstrike.com/en-us/blog/falcon-content-update-preliminary-post-incident-report/). Mac and Linux hosts were not affected. CrowdStrike reverted the defective content at [05:27 UTC](https://www.crowdstrike.com/en-us/blog/falcon-content-update-preliminary-post-incident-report/); machines that came online after that, or didn't connect during the window, were fine.

CrowdStrike's root cause analysis, published later, reports that as of [29 July at 5 p.m. PT, ~99% of Windows sensors were online](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf) compared with the week before, against a typical week-over-week variance of about 1%. Neither CrowdStrike document cited here gives a count of affected machines.

## What happened

From the [preliminary post-incident review](https://www.crowdstrike.com/en-us/blog/falcon-content-update-preliminary-post-incident-report/) and the [root cause analysis](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf):

- **28 February 2024.** Sensor 7.11 becomes generally available. It introduces a new **IPC Template Type** for detecting attacks that abuse named pipes and other Windows interprocess communication. Its content is delivered in **Channel File 291**.
- **5 March 2024.** The IPC Template Type passes a stress test. The first IPC Template Instance is released to production.
- **8–24 April 2024.** Three more IPC Template Instances are deployed and behave as expected.
- **19 July 2024, 04:09 UTC.** Two more IPC Template Instances are deployed. One of them uses a **non-wildcard matching criterion in the 21st input field**, for the first time. Sensors that receive it crash at the next IPC notification from the OS.
- **19 July 2024, 05:27 UTC.** The content is reverted.
- **24 July.** Preliminary PIR published. **6 August.** Root cause analysis published.

## What the engineers believed

CrowdStrike splits what it ships to sensors into two kinds, and the incident lives in the gap between them.

- **Sensor Content** ships with the sensor binary. It includes the Template Types, which are compiled into the sensor. It goes through the full release process: unit, integration, performance and stress testing, internal dogfooding, early adopters, then general availability. Customers can pin their fleet to the latest version or one or two versions behind.
- **Rapid Response Content** is delivered from the cloud at operational speed. CrowdStrike describes it as a [proprietary binary file that contains configuration data. It is not code or a kernel driver.](https://www.crowdstrike.com/en-us/blog/falcon-content-update-preliminary-post-incident-report/)

The belief is captured in that framing: this is configuration, not code. The code that interprets it had been tested and released months earlier. The Template Type had passed a stress test, and four instances had already gone out without trouble. The PIR says the July instances were deployed based on that testing, ["trust in the checks performed in the Content Validator, and previous successful IPC Template Instance deployments"](https://www.crowdstrike.com/en-us/blog/falcon-content-update-preliminary-post-incident-report/).

The PIR also says the Content Interpreter [is designed to gracefully handle exceptions from potentially problematic content](https://www.crowdstrike.com/en-us/blog/falcon-content-update-preliminary-post-incident-report/). That was the safety net people thought was there.

## What was actually going on

### Template Types, instances, and an interpreter in the kernel

The RCA explains the pieces. The **Content Interpreter** is part of the sensor's C++ code and tests input strings against regexes. A **Template Type** defines the fields available for a given kind of detection; a **Template Type Definitions file** says how many inputs each type uses. **Template Instances** are the actual matching criteria, written by detection engineers, bundled into channel files and checked by a **Content Validator** against the definitions file.

All of this runs inside `csagent.sys`, CrowdStrike's file system filter driver. The RCA explains that the driver [loads from an early phase of system boot](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf) so it can see malware that starts before user-mode processes.

*Background:* code running in the Windows kernel shares one address space with the operating system. A bad memory access in a user-mode process kills that process. A bad memory access in a kernel driver halts the whole machine with a bugcheck, the blue screen, because the kernel can't safely continue.

### Two sources of truth that disagreed

Here is the core of it, in the RCA's words: the IPC Template Type [defined 21 input parameter fields, but the integration code that invoked the Content Interpreter with Channel File 291's Template Instances supplied only 20 input values](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf).

So there were two descriptions of the same interface:

- the **definitions file** said 21 inputs, and the Content Validator checked instances against that;
- the **sensor code** built an array of 20 input pointers and handed it to the interpreter.

Nothing compared the two. The RCA's first finding is that [the number of fields in the IPC Template Type was not validated at sensor compile time](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf).

### Why it stayed hidden for five months

The mismatch only matters if something actually reads field 21. Until July, nothing did in a way that touched memory. The test channel file used for the 12 automated test cases, and the initial production instances, used a [regex wildcard matching criterion in the 21st field](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf). The RCA indicates that a wildcard never required the interpreter to inspect the 21st input, so the out-of-bounds read never ran.

On 19 July one instance put a real, non-wildcard value in field 21. The Content Validator approved it, because it [based its assessment on the expectation that the IPC Template Type would be provided with 21 inputs](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf). Against the definitions file, the content was valid.

```diagram
title: why field 21 crashed the kernel
flow: definitions file -> says 21 inputs -> validator approves
flow!: sensor code -> builds 20 pointers -> read index 20 -> BSOD
note: wildcards in field 21 never touched the missing slot
```

### The crash itself

The RCA walks through a crash dump. The bugcheck is `PAGE_FAULT_IN_NONPAGED_AREA` in `csagent.sys`, in a function the annotated listing calls `TemplateGetString`. At the moment of the fault, register `rax` holds the address of the 20-entry input pointer array and `r11` holds the index to fetch: [0x14, i.e., the 21st element](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf). Dumping 21 entries shows 20 valid pointers followed by a 21st value that points to invalid memory.

The code loads that value, checks it isn't NULL (it isn't, it's just garbage) and then reads through it. The page isn't mapped, and the machine bugchecks. The RCA's second finding names the missing guard: [a runtime array bounds check was missing](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf). It also states this was an out-of-bounds read and [not an arbitrary memory write issue](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf).

On the "graceful handling" point, the two documents fit together: the PIR says the out-of-bounds read triggered an exception that [could not be gracefully handled](https://www.crowdstrike.com/en-us/blog/falcon-content-update-preliminary-post-incident-report/). The crash dump's own text says the referenced invalid memory ["cannot be protected by try-except"](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf).

The trigger was ordinary: the driver registers for named-pipe creation notifications, combines that event with context, and evaluates it against Channel File 291's instances. Per the RCA, the crash came [at the next IPC notification from the operating system](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf) after the new channel file arrived.

### Why it reached everyone at once

The RCA's sixth finding is short: [Template Instances should have staged deployment](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf). Sensor releases had canaries, dogfooding and customer-selectable version pinning. Rapid Response Content didn't go through rings. The cautious rollout process existed for the part customers thought of as software, and not for the part described as configuration.

## How they fixed it

The immediate fix was to revert the content at 05:27 UTC, which protected machines that hadn't yet received it. For hosts that had, the RCA points to CrowdStrike's Remediation and Guidance Hub but doesn't describe the procedure, so neither does this post.

The code fixes, per the [RCA](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf):

- A **Sensor Content Compiler** patch validating the number of inputs a Template Type provides was developed on 19 July and went into production on 27 July. It also confirmed no other Template Type on any platform had a wrong count.
- **Bounds checking** was added to the Content Interpreter's input-retrieval function on 25 July, along with a check that the input array size matches what the content expects.
- The IPC Template Type was corrected to supply **21 inputs**.
- The two sensor fixes were being backported to all Windows sensors 7.11 and above in a hotfix due to be generally available by 9 August 2024.
- The Content Validator was changed to allow only wildcard criteria in the 21st field. A general check that instances don't match over more fields than the interpreter is given was due in production by 19 August 2024.

## What changed afterwards

Also from the RCA:

- **Testing:** automated tests with non-wildcard criteria for every field of every Template Type; fuzz testing of the Channel 291 Template Type, being extended to other handlers; every new Template Instance tested, not just the first.
- **Staged rollout:** Template Instances now go through canary testing and successive deployment rings with bake-in time and rollback.
- **Customer control:** customers can choose where and when Rapid Response Content is deployed, with release notes they can subscribe to.
- **Independent review:** two third-party software security vendors engaged to review the sensor code, plus an independent review of the end-to-end quality process.

## The rule

If data tells privileged code which memory to read, that data is part of the program. Every place the interface is described (definitions file, validator, sensor code) has to be checked against the others at build time, the reader has to bounds-check at runtime, and the data has to ship through canaries like code does. Here the slow, careful process with canaries and version pinning covered only the sensor binary, not the content that drove it.

A testing note (interpretation): a wildcard in a test fixture matches everything and checks nothing. If a field can hold a real value in production, at least one test needs to put a real value there.

## Sources

- [CrowdStrike, "External Technical Root Cause Analysis — Channel File 291", 6 August 2024 (PDF)](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf): the full RCA, covering the 21-vs-20 mismatch, the six findings and mitigations, kernel-driver background and the crash-dump walkthrough.
- [CrowdStrike, "Preliminary Post Incident Review (PIR): Content Configuration Update Impacting the Falcon Sensor and the Windows Operating System (BSOD)", 24 July 2024](https://www.crowdstrike.com/en-us/blog/falcon-content-update-preliminary-post-incident-report/): the preliminary review, covering the 04:09–05:27 UTC window, the Sensor Content vs Rapid Response Content split and the IPC Template Type timeline.
