---
title: "DigiNotar: a breached certificate authority signed a *.google.com cert used to spy on Iran"
dek: "An intruder got from an outdated public web server to the CA servers and issued 531 known rogue certificates. One of them, for *.google.com, was used against about 300,000 IP addresses, almost all in Iran, and the CA's revocation checks reported it as valid."
date: 2011-06-17
company: DigiNotar
kind: security-breach
topics: [certificate, security, monitoring]
stack: [pki, tls, ocsp, hsm, dotnetnuke]
impact: "OCSP logs show 298,140 unique IP addresses, 95% from Iran, checked the rogue *.google.com certificate during the MITM attack; DigiNotar was declared bankrupt on September 20, 2011."
rule: "A certificate authority's logs and its revocation service have to be able to answer 'what did we issue?' from records an attacker on the CA server cannot rewrite."
postmortem: https://zoek.officielebekendmakingen.nl/blg-191225.pdf
sources: [https://zoek.officielebekendmakingen.nl/blg-191225.pdf, https://www.sec.gov/Archives/edgar/data/1044777/000119312511241796/dex992.htm]
---

# DigiNotar: a breached certificate authority signed a *.google.com cert used to spy on Iran

In late August 2011, a Gmail user who was a customer of the Iranian ISP ParsOnline [posted on a Google support forum](https://zoek.officielebekendmakingen.nl/blg-191225.pdf) about a certificate warning Google Chrome had shown him. The certificate claimed to be for `*.google.com`. It was signed by DigiNotar, a Dutch certificate authority that browsers trusted, and DigiNotar had no record of issuing it.

That certificate was one of at least [531 rogue certificates](https://zoek.officielebekendmakingen.nl/blg-191225.pdf) issued after an intruder took over every one of DigiNotar's CA servers in the summer of 2011. It had been used in a man-in-the-middle attack on [approximately 300,000 users that were almost exclusively located in the Islamic Republic of Iran](https://zoek.officielebekendmakingen.nl/blg-191225.pdf), according to the investigation by Fox-IT for the Dutch government. Google traffic from those users could be intercepted or redirected, which potentially exposed their messages and Google credentials.

Within days, most browser makers revoked their trust in DigiNotar, an operational director acting on behalf of the Dutch state was appointed, and on [September 20, 2011 the Court of Haarlem declared DigiNotar B.V. bankrupt](https://zoek.officielebekendmakingen.nl/blg-191225.pdf).

## What happened

The timeline below is from Fox-IT's final report ("Black Tulip," August 2012):

| Date (2011) | Event |
| --- | --- |
| June 17 | Intruder [first breaches web servers](https://zoek.officielebekendmakingen.nl/blg-191225.pdf) in DigiNotar's external DMZ, which ran an outdated DotNetNuke with known vulnerabilities |
| June 17–29 | Intruder moves into the Office-net segment |
| July 1 | Intruder reaches Secure-net, the segment holding the CA servers, by tunneling through other compromised systems |
| July 2 | First attempts to sign rogue certificates |
| July 10 | [First rogue certificate successfully issued](https://zoek.officielebekendmakingen.nl/blg-191225.pdf). The `*.google.com` cert's validity begins that day |
| July 19 | A routine check finds certificates with no back-office record. DigiNotar revokes them |
| July 21, 27, 29 | More rogue certificates found and revoked. By the end of July, DigiNotar believes the breach is contained |
| July 30 | First OCSP request for the rogue `*.google.com` cert |
| Aug 28 | An Iranian Gmail user posts details of a Chrome warning about the cert on a Google support forum |
| Aug 29 | DigiNotar revokes the `*.google.com` cert at [19:09:05 CEST](https://zoek.officielebekendmakingen.nl/blg-191225.pdf) |
| Aug 30 | Fox-IT engaged |
| Sept 1 | OCSP responder switched to answer "revoked" for any unknown serial number |
| Sept 3 | Dutch government publicly revokes trust in DigiNotar |
| Sept 20 | DigiNotar declared bankrupt |

The sources differ slightly on when the attack became public. The final report's timeline has the forum post on August 28. Fox-IT's interim report from September 2011 says it [became public knowledge on the evening of Monday August 29th](https://www.sec.gov/Archives/edgar/data/1044777/000119312511241796/dex992.htm).

## What the engineers believed

The final report says it plainly: "[At the end of July, DigiNotar was convinced that the breach of its infrastructure was under control and that the damage had been repaired.](https://zoek.officielebekendmakingen.nl/blg-191225.pdf)"

That belief seemed reasonable. DigiNotar had found the rogue certificates, revoked them, brought in an outside security firm and added monitoring. According to the interim report, that firm's July 27 report found that the attackers had obtained [administrative rights to the outside webservers, the CA server "Relaties-CA" and also to "Public-CA"](https://www.sec.gov/Archives/edgar/data/1044777/000119312511241796/dex992.htm). DigiNotar revoked 128 certificates on July 19, 129 more on July 21 and 75 more on July 27.

Behind "the damage had been repaired" was a quieter assumption: that **DigiNotar's own records could list every certificate it had issued.** Its cleanup was a diff: compare what the CA servers had signed with what the back office had approved, and revoke whatever doesn't match. That only works if the CA servers' records are complete and honest. But those were the machines the intruder controlled.

## What was actually going on

### What a CA's signature means

A TLS certificate is a statement, "this public key belongs to `*.google.com`," signed by a certificate authority. Browsers ship with a list of trusted root CAs. Any certificate that chains up to one of them is accepted for *any* domain. Google was not a DigiNotar customer. That didn't matter. In 2011, any trusted CA could issue a certificate for any name, and browsers would accept it.

So the signing key of a single CA is effectively a key to every HTTPS site on the internet. DigiNotar kept its CA private keys in a netHSM, a hardware security module, in a physically highly-secured room. The report explains that issuing rogue certificates required "[the abuse of an active corresponding private key in the netHSM](https://zoek.officielebekendmakingen.nl/blg-191225.pdf)," and the logs showed CRLs being signed automatically, which meant the keys were active. In general, an HSM is built to stop a key being copied out. It can't tell a legitimate signing request from one sent by an intruder logged into the CA server.

### How they got in

The path, per the report, was a textbook lateral movement:

1. **Public web servers** ran an outdated DotNetNuke with [known security vulnerabilities](https://zoek.officielebekendmakingen.nl/blg-191225.pdf). That was the way in.
2. **The segments weren't really isolated.** DigiNotar had 24 internal network segments, but the zones "[were not strictly described or enforced](https://zoek.officielebekendmakingen.nl/blg-191225.pdf) and the firewall contained many rules that specified exceptions."
3. **Credentials.** The investigators found password-cracking tools. One administrator's cached password hash "[could easily be brute forced](https://zoek.officielebekendmakingen.nl/blg-191225.pdf)," which indicates a weak password.
4. **Tunnels** let the intruder reach the CA servers, which had no direct internet connection, and open Remote Desktop sessions on them.

```diagram
title: from a web CMS to the signing key
flow: outdated CMS -> office network -> CA servers -> HSM signs
note: the HSM protected the key, not the decision to use it
```

### Why the cleanup missed the one that mattered

This is the core lesson. The rogue `*.google.com` certificate's serial number [was not found in the CA system's records](https://www.sec.gov/Archives/edgar/data/1044777/000119312511241796/dex992.htm). The final report says the logging service for the CA software ran on the same compromised servers, that the intruder had full administrative rights, and that database records [were deleted or otherwise manipulated](https://zoek.officielebekendmakingen.nl/blg-191225.pdf). Its conclusion: suspicious log entries can be used for inconclusive observations, but "the absence of suspicious entries cannot be used to infer that no unauthorized actions took place."

DigiNotar's July cleanup found the rogue certificates its records *could* see. The Google certificate wasn't among them, so it stayed valid.

### Why revocation checks said "good"

Browsers check whether a certificate has been revoked by asking the CA's OCSP responder about its serial number. The responder answers "good," "revoked," or "unknown." The interim report describes the problem: if a serial number "[is presented to the OCSP-responder and no record of this serial is found, the normal OCSP-responder answer would be 'good'](https://www.sec.gov/Archives/edgar/data/1044777/000119312511241796/dex992.htm)."

In other words, the responder worked from a **blacklist**. It reported "revoked" only for serials it knew had been revoked. A certificate the CA had no record of was, by default, fine. From July 30 to August 29, DigiNotar's responder told browsers the `*.google.com` certificate was valid [654,313 times, to 298,140 unique IP addresses](https://zoek.officielebekendmakingen.nl/blg-191225.pdf).

Those same logs turned out to be the best evidence of the attack's reach. Fox-IT found that [95% of those IP addresses were in Iran](https://zoek.officielebekendmakingen.nl/blg-191225.pdf), spread across 143 autonomous systems, and that the unique-IP count was still growing when the certificate was revoked. The report notes that IP counts are only a rough approximation of users, and that old browsers such as IE6 made no OCSP requests at all.

### What caught it

Not DigiNotar. The final report says the certificate came to light "[because of an additional check on the validity of the used certificate that was performed by Google Chrome](https://zoek.officielebekendmakingen.nl/blg-191225.pdf)." The report doesn't describe that check. As general background, Chrome at the time shipped with built-in expectations about which keys Google's own domains should use (public-key pinning), independent of which CA signed them. However that check worked, it caught a certificate that was valid by every ordinary PKI rule and was still the wrong one.

## How they fixed it

- **Revoke the known cert.** The rogue Google cert's serial wasn't in DigiNotar's system, so to revoke it, [another certificate was created with the same serial number](https://zoek.officielebekendmakingen.nl/blg-191225.pdf) and revoked on August 29.
- **Flip OCSP from a blacklist to a whitelist.** On Fox-IT's advice, from September 1 the responder answered "revoked" for [any serial number that did not match the back office's records](https://zoek.officielebekendmakingen.nl/blg-191225.pdf). That revoked every unknown rogue certificate at once.
- **Monitoring.** Fox-IT put a network sensor on DigiNotar's network to watch for continued intrusion and for use of known rogue serials.

None of that could restore trust. The final report found that *all* CA servers had been compromised, including the one that issued qualified and Dutch government (PKIoverheid) certificates. Since rogue certificates "[may not be distinguishable from legitimate certificates](https://zoek.officielebekendmakingen.nl/blg-191225.pdf)," it was no longer possible to rely on any certificate those CAs had issued.

## What changed afterwards

The consequences listed in the report's timeline: on September 3 the Dutch state revoked its trust and most browser makers followed; on September 14 the Dutch telecom regulator OPTA ended DigiNotar's registration as a qualified-certificate provider; DigiNotar filed for bankruptcy on September 19 and was declared bankrupt the next day; all qualified and PKIoverheid certificates were revoked on September 28.

Fox-IT's report also gives general recommendations, such as patching all systems regularly, but explicitly leaves broader conclusions about PKI to the reader.

## The rule

If a system's job is to say what it has done, its records can't live on the machine that does it. Send audit logs to a separate, append-only store the operating host can't rewrite. Make "unknown" mean "no" wherever security depends on it: a revocation service that says "good" for serials it has never heard of fails open, and here the attacker knew it.

## Sources

- [Fox-IT: "Black Tulip: Report of the investigation into the DigiNotar Certificate Authority breach" (August 13, 2012), for the Dutch Ministry of the Interior and Kingdom Relations](https://zoek.officielebekendmakingen.nl/blg-191225.pdf). The final forensic report: intrusion path, the 531 rogue certificates, OCSP analysis of the MITM attack, remediation and the post-disclosure timeline.
- [Fox-IT: "DigiNotar Certificate Authority breach 'Operation Black Tulip'" interim report dated September 5, 2011, as filed with the SEC as Exhibit 99.2](https://www.sec.gov/Archives/edgar/data/1044777/000119312511241796/dex992.htm). Early findings: July revocation counts, the missing serial number, and how the OCSP responder treated unknown serials.
