---
title: "A signed SolarWinds Orion update carried the SUNBURST backdoor"
dek: "Attackers with access to SolarWinds' build process slipped a backdoor into a legitimately signed Orion DLL. Customers installed it through normal updates, and it waited about two weeks before quietly calling home over DNS in traffic made to look like Orion's own."
date: 2020-12-13
company: SolarWinds
kind: security-breach
topics: [supply-chain, security]
stack: [solarwinds-orion, dotnet, dns, windows]
impact: "Trojanized Orion updates signed between March and May 2020 gave the actor access to government, consulting, technology, telecom and extractive organizations; CISA ordered federal civilian agencies to disconnect or power down affected Orion servers."
detected_by: third-party
rule: "A valid signature proves who built a binary, not what went into it. Treat privileged monitoring tools as part of your attack surface and limit what they can reach."
postmortem: https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise
sources: [https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise, https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor]
---

# A signed SolarWinds Orion update carried the SUNBURST backdoor

On 13 December 2020, FireEye (now Mandiant) published its analysis of [a supply chain attack trojanizing SolarWinds Orion business software updates](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor). That same day, the US Cybersecurity and Infrastructure Security Agency issued Emergency Directive 21-01, ordering federal civilian agencies to [immediately disconnect or power down](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise) Orion servers running affected versions.

Orion is IT monitoring and management software. CISA noted that compromising it [permits an attacker to gain access to network traffic management systems](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise), and that Orion was widely used to monitor traffic on major federal networks. CISA said exploitation of these products ["poses an unacceptable risk"](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise) to federal agencies.

What made the attack so effective was its delivery. The backdoor wasn't exploited into Orion. It came in through Orion's own signed updates, downloaded from SolarWinds' own site.

## What happened

From the Mandiant analysis:

- A component, `SolarWinds.Orion.Core.BusinessLayer.dll`, was [digitally signed by SolarWinds](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor) and contained a backdoor. Mandiant named it SUNBURST.
- Multiple trojanized updates were [digitally signed from March to May 2020](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor) and posted to the SolarWinds updates website. The DLL Mandiant examined was signed on March 24, 2020.
- The campaign [may have begun as early as Spring 2020](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor). Victims included government, consulting, technology, telecom and extractive organizations in North America, Europe, Asia and the Middle East.
- After getting in, the actor (tracked as UNC2452) moved laterally and stole data, preferring legitimate credentials and remote access over malware.

The directive ([ED 21-01](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise)) required agencies to image memory and disks if they could, disconnect or power down Orion versions 2019.4 through 2020.2.1 HF1, block traffic to and from those hosts, and report by noon Eastern on 14 December whether they had the DLL with hash `b91ce2fa41029f6955bff20079468448`.

## What the engineers believed

Every organization that installed the update made the decision software security tells you to make: get updates from the vendor's official site, check the signature, apply patches promptly. The update came [from SolarWinds' own download site](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor) and carried SolarWinds' valid signature.

The assumption is that a valid vendor signature means the code is what the vendor meant to ship. The signature only proves the binary came out of the vendor's signing process. CISA says the adversary had ["longstanding, covert access to the build process that SolarWinds uses for Orion"](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise). Anything injected before signing gets signed too.

Neither source explains how the attacker got into the build process or how the code was inserted. This post doesn't speculate.

## What was actually going on

### Hidden inside a real component

The backdoor wasn't a separate file. Inside the legitimate DLL, a class called `OrionImprovementBusinessLayer` implemented [an HTTP-based backdoor](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor). It was called from an unrelated routine in the Inventory Manager plugin, so it ran whenever Orion loaded that plugin. Orion's own host process, `SolarWinds.BusinessLayerHost.exe`, loaded it the normal way.

### Patience as evasion

Before doing anything, SUNBURST ran a series of checks. Per Mandiant:

1. Its process name had to hash to a specific value, which matches `solarwinds.businesslayerhost`. Run it in a sandbox under another name and it does nothing.
2. The DLL's file write time had to be [at least 12 to 14 days](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor) in the past, with the threshold chosen randomly. Freshly installed systems under close watch saw nothing.
3. The machine had to be joined to a domain.
4. Hashed lists of processes, services and drivers were checked against blocklists of [forensic and anti-virus tools](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor). If one was found, it stopped and tried again later. Some blocklisted services were disabled through the registry.
5. It checked that `api.solarwinds.com` resolved, to confirm it had network access.

### DNS as the first channel

Once the checks passed, SUNBURST used a domain generation algorithm to build subdomains of `avsvmcloud[.]com`. Mandiant says the subdomains encode a victim ID and [a reversible encoding of the victim's local machine domain name](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor).

That's the clever part. Each infected server announced which organization it was in **just by making a DNS lookup**. The attacker's DNS server could then decide how to answer:

- An **A record** in certain IP ranges told the malware to stop permanently, or controlled its behavior in other ways.
- A **CNAME** pointed it at a command-and-control server for the next stage.

Mandiant notes the attacker [likely utilizes the DGA subdomain to vary the DNS response](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor) as a way to pick targets. So most infected organizations could be told to go quiet, and a chosen few got the next stage.

```diagram
title: how SUNBURST picked its targets
flow: signed update -> dormant 12-14 days -> DNS lookup names org
flow!: CNAME answer -> HTTP C2 -> hands-on intrusion
note: an A record in set ranges told it to stop
```

### C2 that looked like Orion

The HTTP traffic was made to look like the [Orion Improvement Program (OIP) protocol](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor). Outbound data was split across JSON "steps" fields, compressed and XOR-encoded. Commands from the server were spread across strings disguised as GUIDs and hex values in what looked like .NET assembly XML. Reconnaissance results were stored in Orion's own plugin configuration file. The commands it accepted, called "Jobs", could [transfer and execute files, profile the system, reboot the machine, and disable system services](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor).

### Why the monitoring server was the perfect host

*Background:* network monitoring tools are trusted to talk to everything they monitor, often with stored administrator or SNMP credentials, and they make outbound connections as part of normal operation. That's why CISA's directive told agencies to treat [all hosts monitored by the SolarWinds Orion monitoring software as compromised](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise) and to reset all credentials used by or stored in it.

### The two sources describe the affected versions differently

The original directive covered [versions 2019.4 through 2020.2.1 HF1](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise). CISA's later supplemental guidance narrowed the backdoored builds to five: 2019.4 HF5, 2020.2 RC1, 2020.2 RC2, 2020.2 and 2020.2 HF1. Mandiant's initial post recommended upgrading to 2020.2.1 HF1, following SolarWinds' advice at the time. CISA later required [at least version 2020.2.1 HF2](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise), which the NSA had examined and verified removes the malicious code.

## How they fixed it

For federal agencies, the first step was isolation: disconnect, block internet traffic to and from Orion hosts, remove attacker accounts and persistence. Rebuilding was allowed only after forensic work had placed the network in [a category](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise). Category 2 meant only initial beaconing, and Category 3 meant evidence of follow-on activity. Category 3 hosts had to stay disconnected pending consultation with CISA.

Mandiant also advised against simply patching an infected box, because it [could potentially overwrite forensic evidence as well as leave any additional backdoors](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor). It recommended building new systems instead. It published detection signatures on GitHub.

## What changed afterwards

CISA's later guidance let agencies run Orion again only under conditions: deny all traffic outside the network management enclave, keep cloud instances monitoring only their own cloud, don't give on-premises instances cloud identity accounts, and accept the residual risk. CISA warned that because the attacker knew SolarWinds' development practices and code, it was [in a strong position to identify any potential (and as yet unknown) vulnerabilities](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise) in Orion.

On attribution, CISA's page was updated on April 15, 2021 to say the US Government [attributes this activity to the Russian Foreign Intelligence Service (SVR)](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise). Mandiant [later merged UNC2452 into APT29](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor). CISA has since [closed the directive](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise).

## The rule

A signature tells you which build pipeline produced a binary. It says nothing about whether that pipeline was compromised. For tools that run with broad access, such as monitoring, management and CI agents, assume a vendor update could one day be hostile and limit the damage ahead of time: deny their outbound internet access except to known endpoints, give them least-privilege credentials, and watch their DNS. CISA's first hunting instruction was to look for [new external DNS domains to which a small number of agency hosts (e.g., SolarWinds systems) have had connections](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise).

## Sources

- [CISA, "ED 21-01: Mitigate SolarWinds Orion Code Compromise"](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise): the emergency directive and its supplemental guidance, with required actions, affected versions, the build-process statement, operating conditions and the SVR attribution update.
- [Mandiant (FireEye), "Highly Evasive Attacker Leverages SolarWinds Supply Chain to Compromise Multiple Global Victims With SUNBURST Backdoor"](https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor): the technical analysis of SUNBURST, covering the signed DLL, dormancy, DGA and DNS behavior, C2 protocol, post-compromise techniques and mitigations.
