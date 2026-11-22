---
title: "Attackers got Adobe to sign their malware without ever touching Adobe's private key"
dek: "Adobe's signing keys sat in hardware security modules, behind mutually authenticated TLS and IP allow-lists. None of that mattered once attackers controlled a build server that was allowed to ask for signatures. Adobe had to revoke the certificate."
belief: "Adobe thought HSMs kept its code signing key safe. A compromised build server got malware signed anyway."
date: 2012-09-27
company: Adobe
kind: security-breach
topics: [security, supply-chain, certificate, auth]
stack: [code-signing, hsm, pki, windows]
impact: "Two malicious utilities were signed with a valid Adobe code signing certificate; Adobe revoked the certificate for all code signed after July 10, 2012."
rule: "An HSM protects the key, not the decision to sign. Whoever can request a signature can effectively use your key, so treat every signing client as if it were the key."
postmortem: http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html
sources: [http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html, https://web.archive.org/web/20121115161025/http://blogs.adobe.com/conversations/2012/09/adobe-to-revoke-code-signing-certificate.html]
---

# Attackers got Adobe to sign their malware without ever touching Adobe's private key

On September 27, 2012, Adobe announced that it had received [two malicious utilities that appeared to be digitally signed using a valid Adobe code signing certificate](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html). The signatures were real. Any Windows machine checking them would have seen software from Adobe.

Adobe's investigation found the signatures had been produced by Adobe's own signing service, at the request of a [compromised build server](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html). The private key never left its hardware security module. It didn't need to.

Adobe [announced plans to revoke the certificate](https://web.archive.org/web/20121115161025/http://blogs.adobe.com/conversations/2012/09/adobe-to-revoke-code-signing-certificate.html) on October 4, 2012, for all software signed after July 10, 2012, and to re-sign its legitimate software with a new certificate. It's a clean example of a principle that keeps coming back in supply-chain attacks: protecting a key and protecting the *use* of a key are different problems.

## What happened

From the ASSET (Adobe Secure Software Engineering Team) post by Brad Arkin and the [companion announcement](https://web.archive.org/web/20121115161025/http://blogs.adobe.com/conversations/2012/09/adobe-to-revoke-code-signing-certificate.html):

- Adobe received two malicious utilities signed with its certificate. The discovery was [isolated to a single source](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html).
- Once the signatures were verified, Adobe [decommissioned its code signing infrastructure](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html) "within minutes" of the initial triage and started a forensic investigation.
- The investigation found a compromised build server with access to the signing service, malware on that server, and forensic evidence linking it to the signing of the two utilities.
- Adobe shared the samples with security vendors through the Microsoft Active Protection Program (MAPP).
- Revocation was scheduled for [1:15 pm PDT on Thursday, October 4, 2012](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html), via the certificate revocation list published by VeriSign.

The two utilities were **pwdump7 v7.1**, a tool that extracts password hashes from Windows, and **myGeeksmail.dll**, which Adobe believed was a malicious ISAPI filter (an extension that runs inside Microsoft's IIS web server). Adobe said tools like these are used in highly targeted attacks ["for privilege escalation and lateral movement"](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html) after a machine is already compromised.

## What the engineers believed

Adobe's signing setup was built around protecting the key, and on paper it was strong. Per the [ASSET post](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html):

- Private keys were stored in **Hardware Security Modules** in physically secure facilities.
- Every entity allowed to request signatures was provisioned through an established procedure that verified its identity and that its release engineering environment met assurance criteria.
- Signing requests went over **mutually authenticated TLS** and were honoured only from the **originally provisioned IP address**.

The implicit belief: if the key can't be stolen and only vetted, authenticated machines can ask for signatures, then only Adobe software gets signed.

## What was actually going on

### What code signing actually proves

A code signature is the publisher's private key vouching for a hash of the binary. Windows checks the signature against the publisher's certificate, chains that up to a trusted root, and shows "Verified publisher: Adobe Systems." The user, the OS and antivirus software all treat that as meaning *Adobe intended to ship this file*.

But the signature doesn't prove intent. It proves that **something with access to the private key, or to a service holding it, signed this hash.** The meaning of "Adobe intended this" comes entirely from the process in front of the key.

### What an HSM does and doesn't protect

An HSM is a tamper-resistant device that holds private keys and performs operations with them without ever exporting them. Its guarantee is strong and narrow: the key can't be copied out. Adobe [confirmed](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html) the key was not extracted.

What an HSM can't do is judge whether the bytes it's asked to sign are legitimate. It signs whatever an authorized caller sends. So the real security boundary is not the HSM but the set of **authorized callers**, and every machine in that set is effectively a key holder.

```diagram
title: where the trust boundary actually was
flow: release build -> build server asks -> HSM signs
flow!: attacker's tool -> hacked build box -> HSM signs
note: mutual TLS + IP allow-list authenticate the machine, not the file
```

### The compromised build server

Adobe's account is specific about the weak link:

- A build server that [needed signing access as part of the build process](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html) was configured below Adobe's corporate standard for build servers. The provisioning process didn't catch that.
- The server had no PKI rights other than the ability to make code signing requests. That was enough.
- Adobe believed attackers first got a foothold on a different Adobe machine, then used standard APT techniques to reach the build server, and from there requested signatures ["via the standard protocol used for valid Adobe software."](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html)

Look at what each control checked. Mutual TLS proved the request came from the provisioned build server. The IP check proved the same. Both were true. The attacker didn't bypass the controls; they *became* the thing the controls trusted. Nothing in the pipeline checked whether the file being signed was something Adobe had built.

### Why revocation is so expensive

Once a signing certificate is known to have signed malware, you can't make those specific signatures invalid without revoking the certificate itself, and revocation can be scoped by date. Adobe revoked it for everything [signed after July 10, 2012](https://web.archive.org/web/20121115161025/http://blogs.adobe.com/conversations/2012/09/adobe-to-revoke-code-signing-certificate.html), which meant every legitimate Adobe binary signed after that date also lost its valid signature and had to be re-signed with a new certificate. The post doesn't say why July 10 was chosen.

The blast radius covered the Windows platform and three Adobe AIR applications (Adobe Muse, Adobe Story, and Acrobat.com desktop services) that run on both Windows and Mac. Adobe also tested and advised against a workaround: moving the certificate to Windows' Untrusted Certificate Store [didn't stop the malicious utilities from running](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html) but did break legitimate Adobe software.

### What the attackers did not get

The build server used a dedicated account with access to [the source of only one product](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html), and none of Adobe's widely deployed runtimes such as Flash Player, Reader, Shockwave or AIR. Adobe reviewed every commit to that repository and found no changes made by the build account, and had no evidence that source code was stolen. Least privilege on source access worked here. Least privilege on signing didn't, because signing was the one privilege the build server needed.

## How they fixed it

- **Stop signing.** Adobe took its signing infrastructure offline within minutes of triage.
- **Interim service.** A clean-room interim signing service was built to re-sign affected components and keep regular releases going. It added an [offline human verification](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html) step to ensure every file scheduled for signing was valid Adobe software.
- **Revoke and re-sign.** Revoke the certificate for post-July 10 signatures and ship updates re-signed with a new certificate.
- **Help defenders.** Share samples and MD5 hashes with security vendors via MAPP, and suggest that admins block the files by hash using a Software Restriction Policy.

## What changed afterwards

Adobe said it was [designing and deploying a new, permanent signing solution](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html), investigating why provisioning failed to catch the build server's deficiencies, and planning to share lessons with the industry on certificate revocation. The sources reviewed here don't describe the final design, so it's left out.

The interim fix points at the general lesson: the signing service had to start checking **what** it signs, not just **who** is asking. Practical versions of that for any team that signs artifacts or release tokens:

- Sign only artifacts produced by a known pipeline run, with the request tied to a commit and build record that a second system can check.
- Keep signing-capable machines to the same or higher standard as the key itself, and re-audit them, not just at provisioning.
- Log every signature with the artifact hash, and alert on anything signed that doesn't match a release.
- Scope certificates narrowly, so revoking one doesn't take everything with it.

## The rule

An HSM guarantees that nobody can steal your key. It does not guarantee that nobody can *use* it. The effective owner of a signing key is every system allowed to ask for a signature, so give the signing service a way to check what it's signing, and guard each requester like the key itself.

## Sources

- [Adobe ASSET Blog: Inappropriate Use of Adobe Code Signing Certificate (Brad Arkin, September 27, 2012), via Internet Archive](http://web.archive.org/web/20131207144321/http://blogs.adobe.com/asset/2012/09/inappropriate-use-of-adobe-code-signing-certificate.html): technical account of the signing infrastructure, the compromised build server and the response.
- [Adobe Featured Blogs: Adobe to Revoke Code Signing Certificate (September 27, 2012), via Internet Archive](https://web.archive.org/web/20121115161025/http://blogs.adobe.com/conversations/2012/09/adobe-to-revoke-code-signing-certificate.html): customer-facing announcement of the revocation and its scope.
