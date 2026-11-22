---
title: "A failed transaction left a dirty journal in Base's sequencer and halted the chain twice"
dek: "When an invalid transaction failed inside Base's block builder, the EVM journal of accounts and storage slots it had touched was not cleared. The next, valid transaction was charged gas against that stale state, the sequencer sealed a block no validator could reproduce, and the chain stopped for 116 minutes. A second bug in the restart path made it happen again the next day."
belief: "Base assumed a failed transaction left no trace. A stale EVM journal mispriced the next one and halted the chain."
date: 2026-06-25
company: Base
kind: outage
topics: [software-bug]
stack: [evm, revm, rust, ethereum, layer-2]
duration_min: 116
impact: "Base mainnet produced no new blocks for 116 minutes on June 25 and 20 minutes on June 26; transactions submitted during the halt were rejected once the txpool filled."
detected_by: alert
rule: "When an operation fails, roll back every piece of state it touched, including the bookkeeping state that only affects pricing; anything a deterministic replica recomputes must start clean every time."
postmortem: https://base.org/blog/postmortem-june-25th-block-production-outage
sources: [https://base.org/blog/postmortem-june-25th-block-production-outage, https://github.com/base/base/pull/3806, https://github.com/base/base/pull/3805, https://eips.ethereum.org/EIPS/eip-2929, https://cointelegraph.com/news/base-post-mortem-reveals-sequencer-bug-behind-back-to-back-outages, https://crypto.news/base-says-same-sequencer-bug-caused-june-25-and-26-outages/]
---

# A failed transaction left a dirty journal in Base's sequencer and halted the chain twice

On June 25, 2026, Base, the Ethereum layer-2 network built by Coinbase, stopped producing blocks. The outage began at 11:47am EDT and [lasted 116 minutes](https://base.org/blog/postmortem-june-25th-block-production-outage). The next day it happened again: a second halt started at 11:28am EDT and [lasted 20 minutes](https://base.org/blog/postmortem-june-25th-block-production-outage).

While the chain was stopped, nothing new landed onchain. Transactions piled up in the mempool until the txpool grew [larger than what it could store](https://base.org/blog/postmortem-june-25th-block-production-outage) and started rejecting new submissions, so anyone calling `eth_sendRawTransaction` got errors. Base says the integrity of the chain was not compromised and [all funds were safe](https://base.org/blog/postmortem-june-25th-block-production-outage).

The cause is a small, very general bug: an error path that didn't clean up after itself. In most systems that leaks a bit of memory or a wrong counter. In a blockchain, where every validator re-executes every block and must reach the exact same result, it stopped the network.

## What happened

All times from Base's [postmortem](https://base.org/blog/postmortem-june-25th-block-production-outage), in UTC:

- **15:47:13.** While building block 47806543, the sequencer receives an invalid transaction. It fails during execution, as it should, but the error handling doesn't clear the in-memory state journal, leaving it "dirty".
- **15:47:13.** Within the same 2-second window, a valid transaction executes against the dirty journal and produces an incorrect receipts root. The sequencer seals and distributes the block.
- **15:47:13.** Validators re-execute the block, compute a different receipts root and reject it. The chain halts at block 47806542.
- **15:49.** Automated monitoring detects the stall and fires an alert.
- **15:52.** War room established; engineers pinpoint the bad block hash within 3 minutes of the alert.
- **15:53.** Public status page updated.
- **16:55.** Root cause determined; work on the fix begins.
- **17:20.** The EVM state journal patch is deployed to internal nodes.
- **17:51.** Block production resumes. Downstream node operators are told to restart stuck nodes.
- **17:58.** Ecosystem-wide syncing verified.

The second halt, on June 26, is described only briefly: it was [similar in root cause](https://base.org/blog/postmortem-june-25th-block-production-outage), started at 11:28am EDT and lasted 20 minutes. The postmortem gives no separate timeline for it.

## What the engineers believed

The assumption baked into the block builder was that a transaction which fails validation leaves no trace. It is excluded from the block, so as far as the chain is concerned it never happened, and the next transaction starts from the same state it would have seen if the bad one had never arrived.

That is the right model for the *ledger*: balances, storage values, nonces. The postmortem says the failed transaction behaved [as expected](https://base.org/blog/postmortem-june-25th-block-production-outage) in that sense. What the builder missed is that the EVM also keeps *bookkeeping* state during execution, and that bookkeeping changes how much gas the next transaction is charged.

## What was actually going on

### The journal and warm/cold access

*Background, from the Ethereum spec rather than Base's postmortem:* since [EIP-2929](https://eips.ethereum.org/EIPS/eip-2929), the gas cost of touching an account or storage slot depends on whether it has already been touched in the current transaction. The EVM keeps an `accessed_addresses` set and an `accessed_storage_keys` set. A first ("cold") account access costs [2600 gas](https://eips.ethereum.org/EIPS/eip-2929), a cold storage read costs [2100](https://eips.ethereum.org/EIPS/eip-2929), and any repeat ("warm") access costs [100](https://eips.ethereum.org/EIPS/eip-2929). The spec says those sets are initialized fresh [when a transaction execution begins](https://eips.ethereum.org/EIPS/eip-2929).

In Base's execution client, that per-transaction record lives in what the postmortem calls the journal: the state that [contained the accounts and storage slots that had been accessed](https://base.org/blog/postmortem-june-25th-block-production-outage).

### The bug

The invalid transaction got far enough to touch some accounts and slots, then failed. The error path [erroneously did not clear](https://base.org/blog/postmortem-june-25th-block-production-outage) the journal. The next transaction was valid, and it ran with those accounts and slots already marked as accessed. Anything it touched that overlapped would be charged as warm instead of cold, so the transaction had [a mismatch in the amount of gas charged](https://base.org/blog/postmortem-june-25th-block-production-outage).

The fix, in [PR #3806](https://github.com/base/base/pull/3806) titled "fix: discard journal after tx validation errors", is essentially one call added to the error branch of the EVM handler: `evm.ctx().journal_mut().discard_tx()`. The PR's description says it [discards the EVM journal after non-deposit transaction validation errors](https://github.com/base/base/pull/3806) and adds regression tests for "warm state cleanup". The rest of the diff is regression tests built around a pre-warmed account and a small probe contract.

### Why that halts a chain

Different gas used means different receipts, which means a different receipts root in the block header. The sequencer sealed and distributed the block with its own numbers. Validators then re-executed it. Because they [do not run the excluded invalid transaction](https://base.org/blog/postmortem-june-25th-block-production-outage), they started the valid one with a clean journal, got a different receipts root, and rejected the block.

```diagram
title: why validators rejected the block
flow!: bad tx warms slots -> journal not cleared -> next tx priced warm
flow: validator replays -> skips bad tx -> clean journal
note: same block, two receipts roots; the sequencer's could not be reproduced
```

Base runs a single sequencer, which [Cointelegraph notes](https://cointelegraph.com/news/base-post-mortem-reveals-sequencer-bug-behind-back-to-back-outages) means a critical bug in it is enough to halt the network. Once the only block producer has published a block that nobody else accepts, there is no next block: the sequencer and validators [could not progress past the invalid block](https://base.org/blog/postmortem-june-25th-block-production-outage) until sequencing was restored.

*Interpretation:* this is a nice example of why "fail safe" in a replicated state machine means "fail identically". The sequencer did nothing exotic. It just carried a little state from one transaction into the next, state that the replicas, by design, never saw. Any divergence between the leader's execution and a replay, however small, becomes a consensus failure.

## How they fixed it

The outage was ended by [patching the sequencers](https://base.org/blog/postmortem-june-25th-block-production-outage) so that the journal state was properly updated during execution.

It took longer than it should have. Base's sequencers run in an active/passive cluster and do consensus-layer sync rather than execution sync like validator nodes. A [race condition in the engine reset feature](https://base.org/blog/postmortem-june-25th-block-production-outage) prevented the restarted sequencers from catching up to the tip of the chain. That was a separate bug, and it had to be fixed in the middle of the incident.

The public fix for it, [PR #3805](https://github.com/base/base/pull/3805) ("fix: keep initial reset future alive across admin queries"), shows the shape of that race. The sequencer's startup loop used a `select!` over three things: cancellation, admin API queries, and the engine reset call. Each time an admin query arrived first, the in-flight reset future was dropped. The PR keeps the [in-flight reset future alive across admin queries](https://github.com/base/base/pull/3805) so the engine's reset response receiver isn't dropped. *Interpretation:* during an incident, operators are exactly the people sending admin queries, so the recovery path was most fragile at the moment it was needed.

Validators also needed manual help: the incident [required validator nodes to be restarted](https://base.org/blog/postmortem-june-25th-block-production-outage) to continue syncing, and node operators were told to restart stuck nodes.

## The second halt

What exactly caused the June 26 halt is worded in two ways in the postmortem. The overview says the root cause of both outages [was the same](https://base.org/blog/postmortem-june-25th-block-production-outage), and the closing note calls the second one "similar in root cause". The mitigation section says [it is because of this second issue](https://base.org/blog/postmortem-june-25th-block-production-outage), the engine-reset race, that the incident occurred again the following day.

Coverage picked different halves. [Crypto.news](https://crypto.news/base-says-same-sequencer-bug-caused-june-25-and-26-outages/) headlined that the same sequencer bug caused both outages; [Cointelegraph](https://cointelegraph.com/news/base-post-mortem-reveals-sequencer-bug-behind-back-to-back-outages) wrote that the race condition after the reset caused the second outage. Base doesn't give a June 26 timeline, so I can't tell you more precisely how the two bugs combined that day.

## What changed afterwards

From the [postmortem](https://base.org/blog/postmortem-june-25th-block-production-outage):

- **Harden protocol fuzz testing and load-testing harnesses** to more easily find adversarial transaction patterns that could expose bugs like this one.
- **Operational and monitoring improvements.**
- **Graceful recovery in base-consensus**, so validator nodes don't have to be restarted to resume syncing after this kind of failure.

It wasn't the network's first sequencer-related stop: [Cointelegraph reports](https://cointelegraph.com/news/base-post-mortem-reveals-sequencer-bug-behind-back-to-back-outages) Base stopped producing blocks for 17 minutes in September 2024 and for around 30 minutes in August 2025.

## The rule

Error paths are where state leaks. When an operation fails, roll back everything it touched, not just the data you think of as "the result". That includes caches, access lists, counters and anything else that changes how the *next* operation behaves. In a system where replicas re-execute your work and must agree byte for byte, "the next request got a slightly different price" is not a minor bug. It's a fork.

And test the restart path under the same conditions as the incident. Here the recovery code had its own race, and it showed up when it was needed most.

## Sources

- [Base Engineering Team, "Postmortem: June 25th Block Production Outage", Base blog, June 27, 2026](https://base.org/blog/postmortem-june-25th-block-production-outage): the primary source; root cause, impact, mitigation, engine-reset race, follow-ups and timeline.
- [base/base PR #3806, "fix: discard journal after tx validation errors"](https://github.com/base/base/pull/3806): the journal fix and regression tests.
- [base/base PR #3805, "fix: keep initial reset future alive across admin queries"](https://github.com/base/base/pull/3805): the fix for the sequencer engine-reset race, linked from the postmortem.
- [EIP-2929: Gas cost increases for state access opcodes](https://eips.ethereum.org/EIPS/eip-2929): background on warm/cold access sets and their gas costs.
- [Cointelegraph, "Sequencer Bug Caused Two Base Network Outages in a Week"](https://cointelegraph.com/news/base-post-mortem-reveals-sequencer-bug-behind-back-to-back-outages): coverage; single-sequencer context and Base's earlier outages.
- [crypto.news, "Base says same sequencer bug caused June 25 and 26 outages"](https://crypto.news/base-says-same-sequencer-bug-caused-june-25-and-26-outages/): coverage of the postmortem.
