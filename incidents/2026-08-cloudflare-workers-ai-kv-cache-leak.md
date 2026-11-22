---
title: "A too-small KV cache and an SGLang bug made Workers AI answer with other users' prompts"
dek: "Cloudflare launched GLM-5.3 with a context window bigger than its prefill KV-cache pool. In disaggregated mode, SGLang marked over-long prompts as rejected but still handed them to decode, which attended over cache pages that still held other customers' data."
belief: "Cloudflare expected Workers AI to error on prompts too big for the KV cache. It returned other users' data instead."
date: 2026-08-27
company: Cloudflare
kind: bug
topics: [data-leak, software-bug, config-change, security]
stack: [sglang, workers-ai, gpu, rdma, mooncake]
impact: "Between August 27 and September 9, 155 responses from the GLM-5.3 model on Workers AI contained data from other customers' requests."
detected_by: third-party
rule: "Never let an error path look like success: a request that was rejected must be retired everywhere, not just marked, and capacity limits must be checked against what you advertise."
postmortem: https://blog.cloudflare.com/kv-cache-exposure-remediation/
sources: [https://blog.cloudflare.com/kv-cache-exposure-remediation/]
---

# A too-small KV cache and an SGLang bug made Workers AI answer with other users' prompts

From August 27 to September 9, 2026, some customers of Cloudflare's GLM-5.3 model on Workers AI got back responses containing [data from other customers' requests](https://blog.cloudflare.com/kv-cache-exposure-remediation/) made to the same model shortly before. In total [155 responses](https://blog.cloudflare.com/kv-cache-exposure-remediation/) were affected, all to prompts longer than 681,280 tokens.

Cloudflare didn't find it itself. Security researcher Gadi Evron of Knostic reported it through Cloudflare's HackerOne program on [September 8](https://blog.cloudflare.com/kv-cache-exposure-remediation/). Cloudflare took the model offline the next day, fixed it and restored it the same day. It says it found [no evidence of deliberate exploitation](https://blog.cloudflare.com/kv-cache-exposure-remediation/): after excluding its own and the researcher's testing, the affected requests looked like ordinary long-context use.

This one isn't an outage. Nothing returned an error. That is the whole problem.

## What happened

All times UTC, from Cloudflare's [timeline](https://blog.cloudflare.com/kv-cache-exposure-remediation/):

- **Aug 27.** GLM-5.3 launches on Workers AI with a prefill KV pool smaller than its context window. The exposure is present from launch.
- **Sep 8, 23:11.** Report received via HackerOne.
- **Sep 9, 08:00.** Cloudflare starts verifying the report.
- **13:22.** Security incident declared. Product Security reproduces the leak with two independent accounts within 25 minutes.
- **14:00.** GLM-5.3 set to private; requests return HTTP 400.
- **14:35.** Root cause identified as the prefill pool being smaller than the context length. A canary prefill node with a larger pool is confirmed not susceptible.
- **14:52.** All prefill nodes rolled to the corrected configuration.
- **19:04.** Full deployment rebuilt with the corrected configuration plus a Cloudflare-written engine patch, validated against the researcher's reproduction script.
- **19:40.** Model restored to public.

The writeup was published on [October 26](https://blog.cloudflare.com/kv-cache-exposure-remediation/) as a coordinated disclosure with the researcher and RadixArk, the team behind SGLang.

## What the engineers believed

Cloudflare deployed GLM-5.3 with a [1,048,576-token context window](https://blog.cloudflare.com/kv-cache-exposure-remediation/), but the KV-cache pool on its prefill GPUs only had room for 681,280 tokens. The team knew. The pool size is printed in SGLang's startup log and exposed as a metric.

They believed it didn't matter, for two reasons. First, they [expected the engine to return an error](https://blog.cloudflare.com/kv-cache-exposure-remediation/) for any prompt it could not process. Second, their long-context tests passed: they saw successful HTTP status codes and a streaming body with no error frames. Cloudflare's own verdict: "we only validated HTTP response codes and engine performance at long contexts, without validating model output and coherence."

That is a very normal belief. If the engine can't hold a prompt, surely it says so.

## What was actually going on

### Background: how GLM-5.3 was served

Workers AI runs GLM-5.3 on [SGLang in disaggregated mode](https://blog.cloudflare.com/kv-cache-exposure-remediation/). A pool of **prefill** GPUs reads the prompt and builds the model's KV cache for it (the attention keys and values for every token). It then ships that cache over RDMA, via Mooncake, to a pool of **decode** GPUs, which generate the response by attending over it.

The KV cache in GPU memory is a shared pool of fixed-size pages. A request gets pages when admitted and gives them back when done. Pages are [not zeroed between requests](https://blog.cloudflare.com/kv-cache-exposure-remediation/); the next request simply overwrites them. Cloudflare says this is common among inference engines and needed for performance, but it makes the engine responsible for knowing exactly which pages a request has really written.

And the pool size isn't a setting. SGLang sizes it at startup from whatever GPU memory is left after loading the weights. The advertised context length is a separate setting. In Cloudflare's words, ["Nothing forces the two to agree"](https://blog.cloudflare.com/kv-cache-exposure-remediation/).

### The rejection that wasn't

When a prompt didn't fit the pool, SGLang's scheduler rejected it. The rejection path recorded the error for the client and swapped the prompt for a **one-token placeholder**, so the request could drain through the normal batch machinery without allocating real memory. On a single node this worked: the placeholder ran, the batch finished, the client got an error.

In disaggregated mode, the admission queues on both prefill and decode checked whether a request was *finished*, not whether it was *rejected*. A rejected request stored its rejection in a field called `to_finish`, not `finished_reason`, so `finished()` still returned `False`. The [postmortem](https://blog.cloudflare.com/kv-cache-exposure-remediation/) walks through what followed, using an 8-page prompt as the example:

1. The router told decode the prompt's length. Decode reserved **8 KV pages**.
2. Prefill admitted the rejected request, because it wasn't "finished".
3. Prefill ran a trivial forward pass on the one-token placeholder.
4. Prefill sent **one page** of KV to decode and signalled that the transfer was complete.
5. Decode accepted the handoff, with the same `finished()` check.
6. Decode generated, attending over all 8 reserved pages. Only the first had been written by this request. The other seven still held other users' prompts and partial generations.
7. The client got HTTP 200 instead of 400, with a coherent reply that contained other users' content.

```diagram
title: why decode read someone else's pages
flow: prompt fits pool -> prefill writes KV -> decode attends
flow!: prompt too long -> 1-token prefill -> stale pages read
note: the rejection was recorded but never acted on, and decode trusted "transfer complete"
```

Cloudflare points out the tells: `prompt_tokens` matched the long prompt, and the response arrived faster than a full prefill should take. Nothing in the status code or the stream looked wrong, which is why HTTP-level tests passed.

*Interpretation:* two systems held different views of one request. Decode believed "I reserved 8 pages and prefill says it's done, so 8 pages are mine". Prefill knew it had written one. Cloudflare's own description is that the two machines ["had inconsistent views of the state of that system"](https://blog.cloudflare.com/kv-cache-exposure-remediation/). Because pages aren't zeroed, the gap between those views was filled with whatever the previous tenant left behind.

This was deterministic, not a race: every request over the threshold behaved this way. The bug had been reported to SGLang by another user as [issue #30233 on July 6, 2026](https://blog.cloudflare.com/kv-cache-exposure-remediation/), which Cloudflare noticed only while investigating. A fix for a related failure path (#36988) had been merged on SGLang main on September 6 but not yet released.

GLM-5.3 was [the only affected model](https://blog.cloudflare.com/kv-cache-exposure-remediation/). Every other disaggregated Workers AI deployment had KV pools larger than its context length, so no valid request could reach the rejection path.

## How they fixed it

Cloudflare fixed both halves.

**The configuration.** It changed GLM-5.3's configuration to match GLM-5.2's, which freed enough GPU memory that the prefill KV pool now holds [about 2.04 million tokens](https://blog.cloudflare.com/kv-cache-exposure-remediation/), roughly twice the context length. A prompt that fits the context window now always fits the pool, so the rejection path can't be reached by a valid request.

**The engine.** Cloudflare didn't want to rely on pool size alone, since changes to quantization, tensor parallelism or CUDA graph sizes all move it. It patched SGLang so a request with a pending rejection is retired at the disaggregation admission queue, with its original error, before any bootstrap, allocation or KV transfer. It proposed this upstream as #38704, which also had decode check that the number of tokens transferred matches the number it reserved. SGLang maintainers merged #38935, which rejects these requests earlier following Cloudflare's approach. Cloudflare recommends all disaggregated SGLang operators run [v0.5.22 or later](https://blog.cloudflare.com/kv-cache-exposure-remediation/).

## What changed afterwards

From the [postmortem](https://blog.cloudflare.com/kv-cache-exposure-remediation/):

- **A deploy gate.** Every disaggregated deployment change now checks KV pool size against context length from the running engine, plus deferred release on both roles, bounded transfer batches, and the required patches.
- **Deferred release, extended.** Pages are held until transfers are confirmed drained, on both prefill and decode, for every failure type, not just aborts.
- **Load balancer change.** A client disconnect no longer aborts a request mid-transfer, which avoids the cross-node abort races in the same bug class.
- **Upstream work.** SGLang added per-transfer KV checksums (`--disaggregation-enable-kv-checksum`) and a KV canary for detecting corruption; zeroing pages on release is a draft proposal.
- **Longer term.** Page-level ownership tags checked before decode reads the cache, and formal verification of the RDMA KV transfer protocol.

Cloudflare had built a page-tag prototype over the summer, costing [under 1%](https://blog.cloudflare.com/kv-cache-exposure-remediation/) in throughput and tail latency in tests. It was tested on GLM-5.2 in mid-August but disabled shortly afterwards due to reliability issues, so it wasn't running when GLM-5.3 launched.

## The rule

Check the limits you advertise against the limits you actually have, from the running system, before you ship. Cloudflare's own first recommendation to other operators: "do not assume the engine will reject what does not fit."

And treat "rejected" as a state every component must honour, not a note on the request. If one side records an error and another side only checks `finished()`, the error path becomes a success path. When the memory behind it isn't zeroed, that success path returns someone else's data.

## Sources

- [Kevin Flansburg and Michelle Chen, "Cross-request KV cache exposure in the GLM-5.3 Workers AI model, and our remediation with SGLang", Cloudflare blog](https://blog.cloudflare.com/kv-cache-exposure-remediation/): Cloudflare's postmortem and coordinated disclosure, covering the pool-size misconfiguration, the SGLang disaggregated rejection bug, the timeline, remediation and upstream fixes.
