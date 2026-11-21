---
title: "Heartbleed: OpenSSL trusted a length field and echoed back 64k of its own memory"
dek: "The TLS heartbeat extension asks the peer to echo a payload back. OpenSSL believed the payload length the attacker claimed instead of the bytes it actually received, so every heartbeat could leak up to 64k of server memory, keys included."
date: 2014-04-07
company: OpenSSL
kind: security-breach
topics: [security, software-bug, data-leak]
stack: [openssl, tls, dtls, c]
impact: "OpenSSL 1.0.1 through 1.0.1f leaked up to 64k of process memory per heartbeat to any connected client or server (CVE-2014-0160)."
detected_by: third-party
rule: "Never trust a length field from the wire. Check it against the number of bytes you actually received before you read a single byte."
postmortem: https://www.openssl.org/news/secadv/20140407.txt
sources: [https://www.openssl.org/news/secadv/20140407.txt, https://heartbleed.com/, https://github.com/openssl/openssl/commit/96db9023b881d7cd9f379b0c154650d6c108e9a3, https://www.rfc-editor.org/rfc/rfc6520.txt]
---

# Heartbleed: OpenSSL trusted a length field and echoed back 64k of its own memory

On 7 April 2014 the OpenSSL project published a short advisory titled "TLS heartbeat read overrun". It was about a dozen lines long. The key sentence: "A missing bounds check in the handling of the TLS heartbeat extension can be used to reveal up to 64k of memory to a connected client or server" ([OpenSSL advisory](https://www.openssl.org/news/secadv/20140407.txt)).

That sentence covered a lot of the internet. The researchers who named the bug noted that Apache and nginx, both of which commonly use OpenSSL, together had a combined market share of [over 66% of active sites in Netcraft's April 2014 survey](https://heartbleed.com/). They described attacking their own services from outside "without leaving a trace" and recovering [X.509 private keys, user names and passwords, instant messages, emails and business documents](https://heartbleed.com/).

The fix was a few lines of C. To see why those lines mattered, you need to know what a heartbeat is and how OpenSSL answered one.

## What happened

The bug was in OpenSSL's implementation of the TLS/DTLS heartbeat extension, [RFC 6520](https://heartbleed.com/). The researchers say it was [introduced in December 2011 and shipped with OpenSSL 1.0.1 on 14 March 2012](https://heartbleed.com/). Affected versions were [1.0.1 through 1.0.1f, plus the 1.0.2-beta releases](https://www.openssl.org/news/secadv/20140407.txt). The 1.0.0 and 0.9.8 branches were [not vulnerable](https://heartbleed.com/), because they predate the heartbeat code.

Two parties found it independently. The advisory credits [Neel Mehta of Google Security](https://www.openssl.org/news/secadv/20140407.txt) as the discoverer. heartbleed.com says a team at Codenomicon also found it [on 3 April 2014](https://heartbleed.com/) while improving a feature in their security testing tools, and reported it to the Finnish national CERT (NCSC-FI). By heartbleed.com's own timeline, the OpenSSL advisory went out at [about 17:30 UTC on 7 April, and heartbleed.com at about 19:00 UTC](https://heartbleed.com/).

The bug had been in the vulnerable releases for [over two years](https://heartbleed.com/). Many operating systems had picked them up quickly, partly because 1.0.1 was the first OpenSSL release with TLS 1.1 and 1.2. The researchers list Debian Wheezy, Ubuntu 12.04.4 LTS, CentOS 6.5, Fedora 18, FreeBSD 10.0 and others as having shipped [potentially vulnerable versions](https://heartbleed.com/).

## What the engineers believed

A heartbeat is a keep-alive. One side sends a small message with some payload, and the other side has to echo that payload back. The RFC requires that the response carry ["an exact copy of the payload of the received HeartbeatRequest"](https://www.rfc-editor.org/rfc/rfc6520.txt).

The message is defined like this in [RFC 6520](https://www.rfc-editor.org/rfc/rfc6520.txt):

```
struct {
   HeartbeatMessageType type;
   uint16 payload_length;
   opaque payload[HeartbeatMessage.payload_length];
   opaque padding[padding_length];
} HeartbeatMessage;
```

The assumption built into the code was that a heartbeat message is honest about itself: if it says `payload_length` is N, then N bytes of payload follow. Usually that is true, because a well-behaved peer builds the message from its own buffer. The protocol spec did not assume this. It says that if the `payload_length` of a received message [is too large, the message "MUST be discarded silently"](https://www.rfc-editor.org/rfc/rfc6520.txt). The code was missing exactly that check.

## What was actually going on

There are two lengths in play, and the whole bug lives in the gap between them.

1. **The record length.** TLS delivers data in records. When OpenSSL has a record in hand, it knows how many bytes it actually received. In the code that is `s->s3->rrec.length`.
2. **The claimed payload length.** This is the two-byte `payload_length` field inside the heartbeat message. The sender writes whatever value it likes there.

Here is how the pre-fix `tls1_process_heartbeat` began, as shown in the [fix commit](https://github.com/openssl/openssl/commit/96db9023b881d7cd9f379b0c154650d6c108e9a3):

```c
/* Read type and payload length first */
hbtype = *p++;
n2s(p, payload);   /* read 2 bytes from the wire into `payload` */
pl = p;            /* pl points at where the payload should start */
```

Then, for a request, it allocated a response buffer sized from the claimed length, `OPENSSL_malloc(1 + 2 + payload + padding)`, and filled it. The code comment for that step reads "Enter response type, length and copy payload". The copy reads `payload` bytes starting at `pl`.

Nothing in that path compared `payload` with `rrec.length`. Suppose an attacker sends a heartbeat that says "my payload is 65,535 bytes" but includes only one byte. OpenSSL allocates a 65k response, starts copying at `pl`, copies the single real byte, then keeps going. Everything after it comes from whatever happens to sit next to the received record in the process's heap. All of it gets packed into the response and sent back over the wire.

`payload_length` is a `uint16`, so the largest value an attacker can claim is 65,535. That is where the advisory's "[up to 64k](https://www.openssl.org/news/secadv/20140407.txt)" comes from. It is a limit per heartbeat, not a total. As the researchers put it, the attacker can [keep reconnecting, or keep requesting 64-kilobyte chunks on a live connection](https://heartbleed.com/), until enough secrets show up.

```diagram
title: one heartbeat, two lengths
flow: record has 1 byte -> claims 65535 -> malloc 64k
flow!: copy 65535 bytes -> heap past record -> sent to attacker
note: the claimed length decides how much is read
```

Several properties made this worse than an ordinary over-read:

- **It happens before authentication.** A heartbeat request [can be sent and answered during the handshake](https://heartbleed.com/), before client certificate authentication. Requiring client certs did not help.
- **It can't be negotiated away.** The researchers say the vulnerable code is [activated regardless of the handshake negotiations](https://heartbleed.com/). The only fixes were upgrading or recompiling.
- **It cuts both ways.** Memory can leak [from server to client and from client to server](https://heartbleed.com/). A malicious server can read memory out of connecting clients.
- **It is invisible.** Exploitation does [not leave any trace of anything abnormal in the logs](https://heartbleed.com/). Content-based IDS rules don't work on encrypted traffic either. The researchers suggest comparing [request size with reply size](https://heartbleed.com/) instead, because a tiny request that gets a huge reply is the telltale sign.

What leaks is whatever OpenSSL's heap happens to hold. The researchers sorted it into four categories: primary key material (the server's private keys), secondary key material (user credentials), protected content, and collateral such as [memory addresses and stack canaries](https://heartbleed.com/). Losing private keys is the expensive case. An attacker who has them can [decrypt past and future traffic and impersonate the service](https://heartbleed.com/), unless the connection used Perfect Forward Secrecy, which [should protect past communications](https://heartbleed.com/).

The researchers are clear that this was [not a design flaw in the TLS specification](https://heartbleed.com/). It was an implementation mistake. The spec already said what to do with a message whose length doesn't add up.

## How they fixed it

The fix commit, written by Dr. Stephen Henson and crediting [Adam Langley and Bodo Moeller for preparing the fix](https://github.com/openssl/openssl/commit/96db9023b881d7cd9f379b0c154650d6c108e9a3), adds two checks before anything is read from the message:

```c
/* Read type and payload length first */
if (1 + 2 + 16 > s->s3->rrec.length)
    return 0; /* silently discard */
hbtype = *p++;
n2s(p, payload);
if (1 + 2 + payload + 16 > s->s3->rrec.length)
    return 0; /* silently discard per RFC 6520 sec. 4 */
pl = p;
```

The first check rejects any record too short to hold a type byte, a length field and the minimum 16 bytes of padding. The second is the real fix: if type + length + claimed payload + minimum padding is longer than the record that actually arrived, drop the message. The commit also caps the response size against `SSL3_RT_MAX_PLAIN_LENGTH`. It makes the same changes to both the TLS path (`ssl/t1_lib.c`) and the DTLS path (`ssl/d1_both.c`).

The advisory told users to [upgrade to OpenSSL 1.0.1g](https://www.openssl.org/news/secadv/20140407.txt). Anyone who couldn't upgrade straight away could recompile with `-DOPENSSL_NO_HEARTBEATS`, which removes the heartbeat code entirely.

Patching only stopped new leaks. Anything already leaked stayed leaked. The researchers' recovery steps for services were: patch, [revoke the compromised keys, and reissue and redistribute new ones](https://heartbleed.com/). After that, users change passwords, and all session keys and cookies should be treated as compromised. On whether anyone had exploited the bug before disclosure, their answer was ["We don't know."](https://heartbleed.com/)

## What changed afterwards

The sources here are the advisory, the commit and the researchers' Q&A. None of them describes later process changes inside the OpenSSL project, so this post doesn't either. The researchers' own closing advice was for the security community to find these mistakes sooner, and for people to [support and donate to the OpenSSL project](https://heartbleed.com/).

They also raise a deployment question. In their view, recovery might have gone better if the fixed release had also [disabled heartbeat temporarily](https://heartbleed.com/), since almost every TLS stack that answered heartbeats at the time was a vulnerable OpenSSL. If only unpatched servers still responded, scanning for them would have been easy. In the end, community-built detection tools made that unnecessary.

## The rule

Any length, count or offset that arrives from a peer is a claim, not a fact. Before you use it for an allocation, a copy or a loop bound, compare it with what you can verify yourself, which is how many bytes are actually in your buffer. The heartbeat RFC already said to discard messages whose length is too large. The missing line of code was the one that checked it.

This isn't only a C problem. Any parser that reads a length prefix and then reads that many bytes has the same shape: binary protocol decoders, custom framing over TCP, file-format readers. In a memory-safe language the result is usually an exception instead of a leak. The fix is the same either way: compare the claimed length with the real one first, then read.

## Sources

- [OpenSSL Security Advisory, 7 April 2014](https://www.openssl.org/news/secadv/20140407.txt): the official advisory for CVE-2014-0160, with affected versions, credits and the fix version.
- [heartbleed.com](https://heartbleed.com/): the Q&A published by the Codenomicon researchers who found the bug independently, covering impact, affected systems, recovery and the disclosure timeline.
- [OpenSSL commit 96db902, "Add heartbeat extension bounds check."](https://github.com/openssl/openssl/commit/96db9023b881d7cd9f379b0c154650d6c108e9a3): the actual fix, showing the code before and after.
- [RFC 6520, TLS/DTLS Heartbeat Extension](https://www.rfc-editor.org/rfc/rfc6520.txt): the protocol specification, including the message format and the rule to silently discard messages whose payload_length is too large.
