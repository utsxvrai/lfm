---
title: "One duplicated line of C turned off TLS signature checks on iPhones and Macs"
dek: "Apple's SecureTransport had two `goto fail;` lines in a row. The second one wasn't attached to any if-statement, so the handshake signature check always jumped to the exit with a success code. Any network attacker could impersonate any HTTPS site."
belief: "Apple's TLS code looked like it checked every step. A duplicated goto fail skipped signature verification."
date: 2014-02-21
company: Apple
kind: bug
topics: [security, certificate, software-bug]
stack: [c, tls, securetransport, ios, os-x]
impact: "SecureTransport on iOS before 7.0.6 and OS X before 10.9.2 never failed ServerKeyExchange signature verification, so a server didn't have to prove it held its certificate's private key."
rule: "Code that says 'no' is the code that most needs tests that expect 'no'. Feed your security checks bad inputs and assert they fail."
postmortem: https://www.imperialviolet.org/2014/02/22/applebug.html
sources: [https://www.imperialviolet.org/2014/02/22/applebug.html]
---

# One duplicated line of C turned off TLS signature checks on iPhones and Macs

In February 2014, Apple pushed what the ImperialViolet blog called ["a rather spooky security update for iOS"](https://www.imperialviolet.org/2014/02/22/applebug.html): it suggested something was badly wrong with SSL/TLS but gave no details. By the time the post was written the next day, the cause had been found in Apple's published source code. It was a single duplicated line.

```c
if ((err = SSLHashSHA1.update(&hashCtx, &signedParams)) != 0)
    goto fail;
    goto fail;
```

That second `goto fail;` meant iOS and OS X apps using Apple's TLS library would accept a server's handshake without checking it was signed by the certificate's key. A correct certificate chain plus a handshake signed by [the wrong private key, or not signed at all](https://www.imperialviolet.org/2014/02/22/applebug.html), would be accepted.

The post, published on February 22, 2014, says Apple's iOS update came out ["yesterday"](https://www.imperialviolet.org/2014/02/22/applebug.html), and its update notes that [iOS 6.1.6 was released](https://www.imperialviolet.org/2014/02/22/applebug.html) the same day for older devices. The author tested that both iOS 7.0.6 and OS X 10.9.2 fixed the issue. It's one of the most-cited bugs in security engineering, because it's so small, so readable, and so complete in its damage.

## What happened

From the [ImperialViolet analysis](https://www.imperialviolet.org/2014/02/22/applebug.html):

- Apple shipped a security update for iOS without technical details. Its cause was quickly identified, publicly, from Apple's source.
- The bug is in `SSLVerifySignedServerKeyExchange` in **SecureTransport**, Apple's TLS library.
- It affected iOS from some point before 7.0.6 (confirmed on 7.0.4) and OS X before 10.9.2 (confirmed on 10.9.1). The post's update notes that it appears to have been introduced in OS X 10.9 and was present in at least some iOS 6 versions.
- It affected anything using SecureTransport, which was most software on those platforms, but not Chrome or Firefox, which used NSS. The post notes that system software update mechanisms might be using SecureTransport, so not using Safari didn't make you safe.
- The author set up a test site on port **1266**, matching the CVE number, that sent valid certificates but signed the handshake with a different key. If it loaded, you were vulnerable.

## What the engineers believed

The function's structure is a common C idiom, and it encodes a reasonable belief: **if every step checks its error and jumps to cleanup on failure, then reaching the end means everything succeeded.**

```c
OSStatus err;
...
if ((err = step1()) != 0) goto fail;
if ((err = step2()) != 0) goto fail;
if ((err = step3()) != 0) goto fail;
...
fail:
    cleanup();
    return err;
```

`err` holds the result. Any failure jumps to `fail:` with a non-zero `err`. Success falls through every check and returns `0`. It's a clean pattern for a language without exceptions or destructors.

The second belief is visual. The duplicated line is indented exactly like the line above it. Reading the code, your eye groups both `goto fail;` lines under the `if`. They look like one block.

## What was actually going on

### C doesn't care about indentation

In C, an `if` without braces controls exactly **one** statement. The first `goto fail;` belongs to the `if`. The second is a separate statement that runs every time. As the post puts it, the second one, ["despite the indentation, isn't conditional at all."](https://www.imperialviolet.org/2014/02/22/applebug.html)

```c
if ((err = SSLHashSHA1.update(&hashCtx, &serverRandom)) != 0)
    goto fail;
if ((err = SSLHashSHA1.update(&hashCtx, &signedParams)) != 0)
    goto fail;
    goto fail;                                      /* always runs */
if ((err = SSLHashSHA1.final(&hashCtx, &hashOut)) != 0)
    goto fail;
... /* the actual signature check happens down here */
fail:
    ...
    return err;
```

### Why "fail" returned success

This is the part that makes the bug so complete. The unconditional jump happens *right after* a hash update that succeeded. So when control reaches `fail:`, `err` holds that step's result: `0`. The function then returns `0`, which every caller reads as "signature verified."

The cleanup label is named `fail`, but it's really just "exit." Its meaning comes from the value of `err`, and the bug arrived at the exit with a success value. Everything after it, including the hash finalization and the actual signature verification, became dead code. Per the post, ["the signature verification will never fail."](https://www.imperialviolet.org/2014/02/22/applebug.html)

```diagram
title: where err was when the jump happened
flow: hash ok -> verify signature -> return result
flow!: hash ok, err=0 -> goto fail (always) -> return 0 = verified
note: the exit path inherited a success code
```

### What the skipped check was protecting

In TLS 1.0 to 1.1 with DHE or ECDHE cipher suites, the server sends a **ServerKeyExchange** message carrying its ephemeral key for this connection, plus a signature over it made with the private key from its certificate. The post explains the importance: the server is saying ["here's the ephemeral key and here's a signature, from my certificate, so you know that it's from me."](https://www.imperialviolet.org/2014/02/22/applebug.html)

The certificate chain alone proves nothing about who you're talking to. Certificates are public; anyone can send one. Possession of the matching private key is what proves identity, and this signature is that proof in these cipher suites. Skip it and:

1. An attacker on the network (public Wi-Fi, a compromised router) intercepts a connection to, say, a bank.
2. It forwards the bank's real, valid certificate chain.
3. It sends its own ephemeral key, signed with any key or none.
4. The client verifies the chain (fine, it's real), skips the signature check (bug), and completes the handshake with the attacker.

The attacker now reads and modifies the "encrypted" traffic. The post also explains why common defences didn't help: certificate pinning wouldn't stop it, because the chain really is correct, and the attacker [chooses the cipher suite](https://www.imperialviolet.org/2014/02/22/applebug.html), so servers not using DHE/ECDHE were no protection. TLS 1.2 used a different verification function and wasn't affected, but the attacker could pick any version the client would accept.

### Why nothing caught it

The post walks through what could have stopped it:

- **Compiler warnings.** Everything after the jump is unreachable, but neither GCC 4.8.2 nor Clang 3.3 warned with `-Wall`. Clang had `-Wunreachable-code`, which would have, but it [wasn't in `-Wall`](https://www.imperialviolet.org/2014/02/22/applebug.html).
- **Coding style.** Mandatory braces around if-bodies might have helped, but the author isn't convinced, since you can mis-indent with braces too.
- **Tests.** A test could have caught it, but it's hard: you need a separate TLS implementation that can send deliberately invalid handshakes. The author mentions that Chromium used a patched TLSLite for this kind of thing.
- **Code review.** The author believed review of each change as it lands would catch this kind of slip.

The deeper issue is one of asymmetric testing. Every normal TLS connection exercised this function, and with a legitimate server the correct answer is "signature valid." The broken code also said "signature valid." **A check that always returns success passes every test that only uses good inputs.** The only test that can detect it is one that sends a bad signature and expects failure.

## How they fixed it

Apple released iOS 7.0.6 and iOS 6.1.6, and OS X 10.9.2, which the author confirmed fixed the issue on the test site. The post mentions two client-side workarounds that would have avoided the vulnerable path: enabling only TLS 1.2 (preferred), or only plain RSA cipher suites, which have no ServerKeyExchange message.

## What changed afterwards

The only source used for this post is the ImperialViolet analysis, which doesn't cover Apple's internal process changes, so none are described here. The engineering lessons it draws are general and still apply:

- **Turn on unreachable-code warnings** (`-Wunreachable-code` in Clang) and treat them as errors in security code.
- **Use braces** for every conditional body, or a formatter that makes indentation follow the real structure.
- **Write negative tests.** For every verifier (signature, MAC, token, password, permission check), test that a bad input is rejected.
- **Review every change.** The author's view was that per-change review by attentive colleagues would have caught it.

## The rule

A security check that is never shown a bad input has never been tested. For every function whose job is to say "no", write the test that expects "no", because the bug that makes it always say "yes" passes everything else.

## Sources

- [ImperialViolet: Apple's SSL/TLS bug (February 22, 2014)](https://www.imperialviolet.org/2014/02/22/applebug.html): technical analysis of the duplicated `goto fail`, its impact, affected versions and workarounds.
