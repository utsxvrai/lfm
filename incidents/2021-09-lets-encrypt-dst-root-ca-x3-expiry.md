---
title: "Let's Encrypt's old root expired on schedule and old clients stopped trusting it"
dek: "The DST Root CA X3 cross-sign that made Let's Encrypt trusted everywhere expired exactly as planned on 30 September 2021. Devices that never learned the newer ISRG Root X1 started failing, and OpenSSL 1.0.x clients could fail even when they did trust it, because of how they built the certificate chain."
date: 2021-09-30
company: Let's Encrypt
kind: bug
topics: [certificate, time-handling, dependency]
stack: [tls, x509, openssl, android, acme]
impact: "Older devices that don't trust ISRG Root X1 started getting certificate warnings on sites using Let's Encrypt certificates; OpenSSL 1.0.x clients could reject the default chain even with ISRG Root X1 trusted."
rule: "An expiry you announced a year in advance still breaks every client you can't update. Inventory your clients' trust stores and TLS libraries before the date, not after."
postmortem: https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/
sources: [https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/, https://letsencrypt.org/2020/12/21/extending-android-compatibility, https://community.letsencrypt.org/t/openssl-client-compatibility-changes-for-let-s-encrypt-certificates/143816]
---

# Let's Encrypt's old root expired on schedule and old clients stopped trusting it

This incident is unusual: nothing broke unexpectedly on the server side. On 30 September 2021, a certificate expired on exactly the date printed in it. Let's Encrypt had announced it, documented it and prepared for it. Its update on the day reads: ["As planned, the DST Root CA X3 cross-sign has expired, and we're now using our own ISRG Root X1 for trust on almost all devices."](https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/)

For a typical website, Let's Encrypt said, [you won't notice a difference](https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/). The problems were all on the client side: devices whose trust stores never got updated, and software linked against old versions of OpenSSL. Let's Encrypt's warning was that anyone who provides [an API or have to support IoT devices](https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/) might need to pay closer attention.

It's worth understanding because the mechanism catches backend engineers more than browser users. Your server's certificate can be valid, and an HTTP client in your own fleet can still refuse it.

## What happened

Let's Encrypt's [explanation](https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/) of the setup:

- Let's Encrypt has its own root certificate, **ISRG Root X1**. Modern browsers and devices trust Let's Encrypt certificates because they ship ISRG Root X1 in their root list.
- When Let's Encrypt started, its root wasn't in anyone's trust store yet. So it got a **cross-signature** from an older, already-trusted root, **IdenTrust's DST Root CA X3**. That made Let's Encrypt certificates trusted by almost every device immediately.
- Some older devices will never trust ISRG Root X1 because they no longer get software updates. Let's Encrypt gives the iPhone 4 and HTC Dream as examples.
- **DST Root CA X3 expired on 30 September 2021.** From then on, devices that don't trust ISRG Root X1 [start getting certificate warnings](https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/) on Let's Encrypt sites.

There were two exceptions in opposite directions. Older Android devices kept working, through a special arrangement described below. And clients using **OpenSSL 1.0.x** could fail [even when they trust ISRG Root X1](https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/), because of the very chain designed to keep Android working.

Let's Encrypt's page doesn't give a count of affected devices or services, so none is given here.

## What the engineers believed

The reasonable mental model for most operators, and the one this incident punished, is: **"If my certificate is valid and the client trusts my root, the connection works."**

That model treats certificate validation as a yes-or-no question about a single fixed chain. In reality, the server sends a bundle of certificates, the client has its own list of trust anchors, and the client's TLS library has to **build** a path from the leaf certificate to one of those anchors. Different libraries build that path differently. Two clients with the same trust store can reach different answers for the same server.

A second belief was that an expiry is a single date. For browsers and up-to-date operating systems, it was a non-event. For embedded devices and old server-side stacks, it was a hard break on that date with no fix short of updating the client.

## What was actually going on

### The chain Let's Encrypt served

From December 2020, Let's Encrypt [described](https://letsencrypt.org/2020/12/21/extending-android-compatibility) the planned change to its default chain:

- Before: `Subscriber Certificate <- R3 <- DST Root CA X3`
- After: `Subscriber Certificate <- R3 <- ISRG Root X1 <- DST Root CA X3`

In the new default chain, the server sends a version of ISRG Root X1 that is **signed by DST Root CA X3** as an intermediate. A client can stop at ISRG Root X1 if it trusts it, or continue to DST Root CA X3 if that's what it trusts.

### Why old Android kept working after the expiry

IdenTrust agreed to issue a [3-year cross-sign](https://letsencrypt.org/2020/12/21/extending-android-compatibility) for ISRG Root X1 from DST Root CA X3, valid beyond DST Root CA X3's own expiry. Let's Encrypt explains why that works: root stores contain "trust anchors" rather than certificates as such, standards let implementations decide whether to use fields on trust anchors, and ["Android has intentionally chosen not to use the notAfter field of trust anchors."](https://letsencrypt.org/2020/12/21/extending-android-compatibility)

So for an old Android phone that only trusts DST Root CA X3, the chain is: leaf, R3, ISRG Root X1 (signed by DST Root CA X3), then the DST Root CA X3 anchor, whose expiry Android doesn't check. It keeps working. Let's Encrypt stresses that [this exception only works for Android](https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/).

### Why OpenSSL 1.0.x broke even with the right root

This is the counterintuitive part. Take a client running OpenSSL 1.0.x that **does** have ISRG Root X1 in its trust store. It's presented with the long chain. A valid path exists: leaf, R3, ISRG Root X1, which is trusted. The client should accept it.

It doesn't. Let's Encrypt's January 2021 announcement explains that [older versions of OpenSSL will reject a certificate chain that includes a signature by an expired root, even if OpenSSL could validate the chain by ignoring that certificate](https://community.letsencrypt.org/t/openssl-client-compatibility-changes-for-let-s-encrypt-certificates/143816). The affected range is OpenSSL 1.0.0 through 1.0.2, and the behavior [was fixed over 4 years ago with the release of OpenSSL 1.1.0](https://community.letsencrypt.org/t/openssl-client-compatibility-changes-for-let-s-encrypt-certificates/143816).

*(Background.)* The distinction is between **path verifying** and **path building**. A simple verifier follows the chain the server sent, link by link, toward the end, and fails if any link fails. A path builder treats the sent certificates as a pool and searches for any valid route to a trust anchor, stopping as soon as it reaches one. OpenSSL 1.0.x behaved like the former in this case: it followed the chain through the DST-signed ISRG Root X1 toward the expired DST root and rejected it, instead of stopping at the ISRG Root X1 it already trusted.

```diagram
title: same chain, two answers
flow: leaf -> R3 -> ISRG X1 (trusted) -> accept
flow!: leaf -> R3 -> ISRG X1 via DST -> DST expired -> reject
note: OpenSSL 1.0.x walked past the anchor it trusted
```

Let's Encrypt also notes that [LibreSSL and GnuTLS](https://community.letsencrypt.org/t/openssl-client-compatibility-changes-for-let-s-encrypt-certificates/143816) have similar issues, while the platform verifiers on Windows and macOS and browsers in general don't. And it points out it wasn't the first: [the expiration of a long-lived Sectigo root certificate](https://community.letsencrypt.org/t/openssl-client-compatibility-changes-for-let-s-encrypt-certificates/143816) the previous year had disrupted IoT devices and software depending on the same versions of OpenSSL.

So Let's Encrypt faced a real trade-off. The long chain keeps old Android working and breaks OpenSSL 1.0.x. The short chain (`R3` signed by ISRG Root X1 only) works for OpenSSL 1.0.x clients that trust ISRG Root X1 and breaks Android older than 7.1.1. It chose the long chain by default, as [the chain that does the most good for the most people](https://community.letsencrypt.org/t/openssl-client-compatibility-changes-for-let-s-encrypt-certificates/143816), and kept the short chain available as an alternate for ACME clients that support selecting it.

## How they fixed it

There was nothing to fix on the expiry date itself. The work was done in advance, and the remaining fixes had to happen on clients.

Let's Encrypt's guidance for API and IoT operators was [two things](https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/): every client must trust ISRG Root X1, not just DST Root CA X3; and clients using OpenSSL must be on 1.1.0 or later.

For operators who couldn't upgrade their OpenSSL clients and didn't need old Android, the option was to [configure your ACME client to use a short chain](https://community.letsencrypt.org/t/openssl-client-compatibility-changes-for-let-s-encrypt-certificates/143816) that works for OpenSSL. Let's Encrypt still says that ISRG Root X1 must be in the trust store of OpenSSL clients either way.

For ACME client developers, the [December 2020 post](https://letsencrypt.org/2020/12/21/extending-android-compatibility) asked them to use the intermediate certificate provided by the ACME API at the end of issuance, and not obtain intermediates any other way, such as hardcoding them, reusing ones on disk or fetching from AIA URLs.

## What changed afterwards

The Android cross-sign was always temporary. In February 2024, Let's Encrypt [added a note to the page](https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/) that the Android compatibility cross-sign was close to expiring, with a further change coming over the course of 2024.

## The rule

A server certificate is only as valid as the oldest client that has to accept it. Before a planned root or intermediate change, inventory the clients you don't control directly (IoT devices, partner integrations, old language runtimes, base images with old OpenSSL) and test them against the exact chain you will serve. Don't assume "trusts the root" means "accepts the chain": libraries build paths differently, and some will walk past a trust anchor they hold onto an expired certificate. And never hardcode intermediates. Take the chain your CA gives you, so it can change it when it needs to.

## Sources

- [Let's Encrypt, "DST Root CA X3 Expiration (September 2021)"](https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/): the official explanation of the expiry, the affected clients, the Android exception, the OpenSSL 1.0.x caveat, and the 30 September 2021 and February 2024 updates.
- [Let's Encrypt, "Extending Android Device Compatibility for Let's Encrypt Certificates" (21 December 2020)](https://letsencrypt.org/2020/12/21/extending-android-compatibility): the IdenTrust cross-sign that extends past DST Root CA X3's expiry, why Android accepts it, and the new default chain.
- [Let's Encrypt community forum, "OpenSSL Client Compatibility Changes for Let's Encrypt Certificates" (January 2021)](https://community.letsencrypt.org/t/openssl-client-compatibility-changes-for-let-s-encrypt-certificates/143816): the official announcement explaining why OpenSSL 1.0.x rejects the long chain, the affected libraries, and the alternate short chain.
