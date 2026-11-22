---
title: "Anyone could initialise Parity's shared wallet library, so someone did and then killed it"
dek: "Every Parity multi-sig wallet deployed after July 20, 2017 forwarded its logic to one shared library contract. That library had never been initialised, so a user made himself its owner, called its self-destruct, and froze 587 wallets."
belief: "Parity treated its shared multisig library as code, not a wallet. Anyone could take ownership and kill it."
date: 2017-11-06
company: Parity
kind: financial-loss
topics: [software-bug, security, dependency]
stack: [ethereum, solidity]
impact: "Funds in 587 wallets holding 513,774.16 Ether plus additional tokens were blocked."
detected_by: third-party
rule: "A shared component that holds no state of its own must still be locked down: initialise or disable everything an outsider could call on it directly."
postmortem: https://web.archive.org/web/20250817112739/https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7
sources: [https://web.archive.org/web/20250817112739/https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7]
---

# Anyone could initialise Parity's shared wallet library, so someone did and then killed it

On November 6, 2017, an anonymous user found a vulnerability in a "library" smart contract that every Parity multi-signature wallet deployed after July 20, 2017 depended on. Per Parity's postmortem, the user "made himself the 'owner' of the library contract" and then destroyed it ([Parity](https://web.archive.org/web/20250817112739/https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7)).

Nothing was stolen. Instead, funds were stuck: [587 wallets holding a total of 513,774.16 Ether](https://web.archive.org/web/20250817112739/https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7), plus other tokens, were blocked, because the code those wallets relied on to move money no longer existed. Shortly afterwards someone, "purportedly this same user", posted as "devops199" on Parity's GitHub (issue #6995), which is what prompted Parity's investigation.

Parity's ordinary single-key accounts and the Parity Wallet UI weren't affected. Only the multi-sig wallets built on the shared library were.

## What happened

The multi-sig code originally came from a "Foundation" wallet written and audited by the Ethereum Foundation's DEV team, Parity and others. Parity restructured it into two pieces ([Parity](https://web.archive.org/web/20250817112739/https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7)):

- a lightweight **stub** contract, deployed fresh each time a user creates a wallet
- a heavy **library** contract containing most of the wallet logic, deployed **once** and shared by every stub

After an attack on July 19, 2017 (a separate, earlier incident), Parity fixed and redeployed the library on July 20. To stay as close as possible to the audited original, it made few changes, so the library kept the same functionality as a regular wallet. That included needing initialisation, and it included the original self-destruct function meant for retiring a wallet.

In August, a GitHub contributor, "3esmit", suggested the library should call `initWallet` on itself when deployed. Parity treated it as a convenience improvement, committed it, and planned to ship it in a regular update ([Parity](https://web.archive.org/web/20250817112739/https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7)). The library already deployed on-chain stayed uninitialised.

On November 6, "devops199" initialised the July library, became its owner, and killed it.

The postmortem gives two different times. The opening says the vulnerability was found at 02:33:47 PM UTC; the later account says devops199 found the uninitialised owner at 03:25:21 PM UTC. Both are from the [same post](https://web.archive.org/web/20250817112739/https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7), which doesn't explain the difference.

## What the engineers believed

The library was thought of as *code*, not as a *wallet*. Each user's stub holds the funds and the owner list. The library is just shared logic that the stubs borrow. In that model, initialising the library itself seems pointless (it holds no money and has no users), so a suggestion to auto-initialise it reads like tidying up. That's how Parity described the 3esmit change: at the time it was "considered a convenience enhancement" ([Parity](https://web.archive.org/web/20250817112739/https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7)).

## What was actually going on

The postmortem stays high-level about the contract mechanics, so this section adds standard Ethereum background to explain why "uninitialised" and "self-destruct" combined so badly.

### How a stub borrows a library

On Ethereum, a contract can execute another contract's code *in its own context* using `delegatecall`. When a user's wallet stub delegates to the library, the library's code runs, but it reads and writes the **stub's** storage and spends the **stub's** balance. That's what makes the pattern efficient: one copy of the heavy logic on-chain, and many cheap stubs, each with its own owners and funds.

But the library is also a contract in its own right, at its own address, with its own (empty) storage. Anyone can send a transaction to it **directly**. When they do, the library's code runs against the *library's own* storage.

### What "uninitialised" meant

A wallet's initialisation function sets its owners, and functions like self-destruct are restricted to owners. In a stub, initialisation happens when the wallet is created. The library, deployed once as a plain contract, was never initialised. Its own owner list was empty, and its initialisation function was still callable.

So anyone who called the initialisation function **directly on the library** became the owner of the library, not of any user's wallet. Per Parity, devops199 found the uninitialised owner in the July contract and initialised it, which made them its owner ([Parity](https://web.archive.org/web/20250817112739/https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7)).

As the library's owner, the user could call its owner-only functions, including the kill function carried over from the original wallet.

```diagram
title: one library, 587 wallets
flow: wallet stub -> delegatecall -> library code runs
flow!: init on library -> owner of library -> kill library
note: after kill every stub delegates to empty code
```

### Why killing it froze everyone

Self-destruct removes a contract's code from the chain. In general EVM terms, a later call to an address with no code doesn't fail: it just does nothing. So every stub still holds its Ether, but every withdrawal now delegates to nothing. The funds aren't gone, but no code exists that can move them. Contracts on Ethereum can't be patched in place, which is why Parity's proposals to unfreeze the funds were at the protocol level.

This is a **shared-dependency blast radius**. Putting the logic in one place is good engineering for cost and consistency. It also means one bad state in that one place affects every dependent at once, with no way to roll back.

### Parity's own diagnosis

Parity names two ways the incident could have been avoided ([Parity](https://web.archive.org/web/20250817112739/https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7)):

1. Remove the kill functionality from the library. A rogue owner could then not have done anything destructive.
2. Initialise the library, either by deploying 3esmit's change or by manually initialising the July contract.

Either one would have been enough. Both stayed in place because the library was a nearly unmodified copy of a wallet, kept that way on purpose because the original had been audited.

## How they fixed it

There was no fix in the usual sense. Parity said it was working on Ethereum Improvement Proposals that could potentially unblock the funds and address blocked funds in general, but that "there is no timeline" and it would follow the community's EIP process ([Parity](https://web.archive.org/web/20250817112739/https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7)). It contacted affected users. The postmortem was published November 15, 2017.

## What changed afterwards

Parity listed the steps it was taking ([Parity](https://web.archive.org/web/20250817112739/https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7)):

- remove the ability to deploy multi-sig wallets from Parity Wallet until security and operations procedures are in place, while still supporting other multi-sig wallets considered secure
- commission another full-stack external security audit of sensitive code
- set up a dedicated operational-security team
- link all contract deployments to the code review process in its contracts repository, with a deployment checklist per contract and continuous monitoring that compares deployed contracts with the latest reviewed version
- support research into other smart-contract languages, formal verification, and vault-style multi-sig tooling, and extend its bug bounty

Parity also argues that more audits alone aren't the answer, and that the ecosystem needs procedures and tooling around deploying, monitoring and testing contracts.

Outside blockchains, the pattern is familiar to backend engineers:

1. **Shared infrastructure has an attack surface of its own.** An internal library service, a base container image, or a shared IAM role might "hold nothing", but if outsiders can call it directly, its own access control matters as much as that of the things that use it.
2. **"Copy the audited thing unchanged" can carry over dangerous features.** The kill switch made sense for a personal wallet and was a disaster for a shared library. Re-check every capability against the component's *new* role.
3. **Track what's deployed separately from what's merged.** The fix existed in the repo. The vulnerable version was the one on-chain. That's why Parity planned monitoring to compare deployed contracts with the reviewed code.

## The rule

A shared component that holds no state of its own must still be locked down: initialise or disable everything an outsider could call on it directly.

## Sources

- [A Postmortem on the Parity Multi-Sig Library Self-Destruct](https://web.archive.org/web/20250817112739/https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7): Parity Technologies' postmortem on its Medium blog, published November 15, 2017 (archive.org copy). It is the source for the dates, both UTC times, the 587 wallets and 513,774.16 Ether, the stub/library design, the 3esmit change, and Parity's remediation list.
