---
title: "Cloudbleed: one missing p-- leaked private memory into Cloudflare's HTML responses"
dek: "A years-old Ragel parser bug let a pointer jump past the end of a buffer. It stayed harmless until a new parser changed how NGINX handed over the final buffer, and then cookies, tokens and POST bodies started appearing in other sites' pages."
date: 2017-02-17
company: Cloudflare
kind: security-breach
topics: [software-bug, data-leak, security]
stack: [nginx, ragel, c]
impact: "At the peak, about 1 in every 3,300,000 HTTP requests through Cloudflare potentially leaked memory; 770 unique URIs on 161 domains were found in search engine caches."
detected_by: third-party
rule: "Bounds checks must use >= not ==, and a latent bug in old code becomes live the moment you change what feeds it."
postmortem: https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/
sources: [https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/]
---

# Cloudbleed: one missing p-- leaked private memory into Cloudflare's HTML responses

Cloudflare's incident report, dated February 23, 2017, opens: "Last Friday, Tavis Ormandy from Google's Project Zero contacted Cloudflare to report a security problem with our edge servers" ([Cloudflare](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/)). He was seeing corrupted web pages come back from some HTTP requests that went through Cloudflare.

What he'd found was serious. In some unusual circumstances, Cloudflare's edge servers were reading past the end of a buffer and returning memory containing private data such as HTTP cookies, authentication tokens and HTTP POST bodies. Because the memory belonged to a shared proxy, a request to one site could return fragments of other, unrelated sites' traffic. Some of those pages had already been cached by search engines.

The rate was tiny. At the worst point, [around 1 in every 3,300,000 HTTP requests](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/) potentially leaked memory. But at Cloudflare's volume, and with search engines crawling and caching the results, a tiny rate was enough. Cloudflare says customer SSL private keys were not leaked, because TLS was terminated in a separate, isolated NGINX instance.

## What happened

Cloudflare rewrites HTML on the fly at its edge: rewriting `http://` links to `https://`, hiding content from bad bots, obfuscating email addresses, and more. For years this ran on an HTML parser written with **Ragel**, a tool that compiles state-machine descriptions into C. About a year before the incident, Cloudflare started replacing it with a new parser, **cf-html**, and migrated features over gradually. Both ran as NGINX filter modules that take buffers of HTML, modify them, and pass them to the next filter ([Cloudflare](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/)).

Three features turned out to be implicated, rolled out as follows:

| Date | Change |
| --- | --- |
| 2016-09-22 | Automatic HTTP Rewrites enabled (earliest possible leak) |
| 2017-01-30 | Server-Side Excludes migrated to new parser |
| 2017-02-13 | Email Obfuscation partially migrated to new parser |
| 2017-02-18 | Google reports problem; leak stopped |

All from [Cloudflare's report](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/). The heaviest impact was the four days from February 13, because Email Obfuscation, which ran both parsers, was the most widely used of the three.

## What the engineers believed

The engineers building cf-html worried about security a lot. They had spent hours checking it for security problems ([Cloudflare](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/)). The working assumption was that the risk sat in the *new* code, and the old parser, stable in production for years, was the known-good baseline.

That was backwards. cf-html had no bug. The bug had been in the Ragel parser for many years, and no memory had leaked only because of the way NGINX's internal buffers were used. Adding cf-html changed that buffering. In Cloudflare's account, the latent security problem was in the ancient software, and it only showed up during the migration away from it.

## What was actually going on

### The pointer and the end check

Ragel-generated C walks the input with a pointer `p`, with `pe` pointing one past the end of the buffer. The generated loop checks whether it has reached the end with **equality**: `p == pe`. That's fine as long as `p` moves one byte at a time. If anything moves `p` two steps at once while at `pe - 1`, it jumps *over* `pe`, the equality check never fires, and the parser keeps reading whatever memory comes next.

Cloudflare: "Had the check been done using >= instead of == jumping over the buffer end would have been caught" ([Cloudflare](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/)). The equality check was generated by Ragel, but the bug that moved the pointer was in Cloudflare's Ragel code, not in Ragel.

### The missing fhold

This is the rule for parsing an attribute inside a `<script>` tag:

```
script_consume_attr := ((unquoted_attr_char)* :>> (space|'/'|'>'))
>{ ddctx("script consume_attr"); }
@{ fhold; fgoto script_tag_parse; }
$lerr{ dd("script consume_attr failed");
       fgoto script_consume_attr; };
```

The success path (`@{ }`) does `fhold` before jumping. `fhold` is equivalent to `p--`, stepping back so the character that ended the match gets parsed again by the next state. The error path (`$lerr{ }`) jumps without `fhold`. If that error path runs when `p` is already at the end of the buffer, the jump's normal `p++` moves it to `pe + 1`, past the end check, and the parser keeps reading into neighbouring heap memory. Adding `fhold` to the error handler fixes it ([Cloudflare](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/)).

The trigger was HTML that ended with a broken tag. Cloudflare's statistics suggested such broken tags at the end of a page occurred on [about 0.06% of websites](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/).

### Why it was harmless for years: `last_buf`

The `$lerr` error path only runs when the parser knows it's on the **last** buffer. If more data might come, an unfinished attribute isn't an error yet, since it might finish in the next buffer. The entry function sets this up:

```c
u_char *pe = ctx->buf->last;
u_char *eof = ctx->buf->last_buf ? pe : NULL;
```

With only the old parser in the chain, the final buffer that held data arrived with `last_buf = 0`, followed by a separate *empty* buffer with `last_buf = 1`, and the parser isn't called on empty buffers. So `eof` was always `NULL` for real data, `$lerr` never ran at end of input, and the missing `fhold` was never reached.

With cf-html also in the chain, the final data buffer arrived with `last_buf = 1`. Now `eof == pe`, the error path ran on truncated tags at the end of a page, and the pointer jumped past the end ([Cloudflare](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/)).

```diagram
title: same bug, different buffer chain
flow: old parser only -> last_buf = 0 on data -> lerr never runs
flow!: old + cf-html -> last_buf = 1 on data -> p jumps past pe
note: cf-html was correct; it changed what the old code saw
```

Cloudflare describes it as a change in the "internal feng shui" of the buffers passed between NGINX filter modules. Leaking also needed the final buffer to be under 4k (larger overruns crashed NGINX instead), and a customer with a feature combination that put both parsers on the request.

### What leaked

The overrun read from the heap of the NGINX-based HTTP process. That heap held pieces of other in-flight requests: headers, POST data "perhaps containing passwords", API JSON, URI parameters, cookies, API keys and OAuth tokens. It also held a private key Cloudflare used to encrypt connections between its own machines, and a small number of internal authentication secrets ([Cloudflare](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/)). Process separation is why SSL keys were safe: TLS, image recompression and caching ran in processes with separate heaps.

## How they fixed it

Every Cloudflare feature has a "global kill" flag. A note on dates: the report's text says the contact came "last Friday", which is February 17. Its timeline, which doesn't state a timezone, puts the first contact at 2017-02-18 00:11. From that timeline (dates and times as listed in the report, 2017-02-18):

- 00:11, Tavis Ormandy tweets asking for a Cloudflare contact
- 00:32, Cloudflare receives details of the bug from Google
- 01:19, Email Obfuscation disabled worldwide, which stopped almost all leaks
- 04:24, Automatic HTTPS Rewrites disabled worldwide
- 07:22, kill switch for the cf-html parser deployed worldwide

Server-Side Excludes predated the global-kill system, so Cloudflare had to add a kill switch and ship a patch, which took roughly three hours. The initial mitigation came [47 minutes](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/) after receiving details, and the global fix was complete in under 7 hours. A further fix was deployed globally on 2017-02-20 and the three features were re-enabled on 2017-02-21.

Cloudflare then added explicit bounds checks to every pointer access in the generated code, logging `"email filter tried to access char past EOF"` instead of reading on, to measure how often the condition fired. It also delayed public disclosure until search engines had purged cached leaked pages: with help from Google, Yahoo, Bing and others, it found [770 unique URIs covering 161 unique domains](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/). Cloudflare says it found no evidence of malicious exploitation.

## What changed afterwards

The infosec team began fuzzing the generated parser code, other engineers built test cases from malformed pages found in the wild, and a team reviewed the generated C by hand. Beyond this parser, Cloudflare started a project to fuzz older software for other potential security problems ([Cloudflare](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/)).

Two lessons carry over to code that has nothing to do with C:

1. **Write boundary checks defensively.** `>=` costs nothing over `==`, and it holds up even if something steps the cursor further than you expected.
2. **A migration changes the environment the old code runs in.** Running old and new side by side is the usual safe approach, but the old code is now getting inputs it never got before. Review and fuzz the old side of the seam as hard as the new one.

## The rule

Bounds checks must use >= not ==, and a latent bug in old code becomes live the moment you change what feeds it.

## Sources

- [Incident report on memory leak caused by Cloudflare parser bug](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/): Cloudflare's incident report, dated February 23, 2017. It is the source for the code excerpts, the buffer analysis, the rollout dates, the timeline, the 1-in-3,300,000 rate and the 770 URI / 161 domain counts.
