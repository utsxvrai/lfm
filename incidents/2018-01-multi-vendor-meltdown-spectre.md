---
title: "Meltdown and Spectre: CPUs leaked privileged memory through work they were going to throw away"
dek: "Modern processors execute ahead of bounds checks and permission checks, then discard the results if they guessed wrong. Project Zero and academic teams showed the discarded work still leaves footprints in the cache, and that timing those footprints reads memory across security boundaries."
belief: "CPU designers assumed speculative execution had no visible effects. It leaked memory through the cache."
date: 2018-01-03
company: Multiple vendors
kind: security-breach
topics: [hardware, security, data-leak]
stack: [cpu, linux-kernel, ebpf, kvm]
impact: "Variants affected many modern processors from Intel, AMD and ARM; proofs of concept read Linux kernel memory from user space and host kernel memory from a KVM guest."
rule: "Architectural rollback is not erasure. If secret-dependent work can happen speculatively, assume its side effects on shared hardware state can be measured, and put real isolation, not just a permission check, between trust domains."
postmortem: https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html
sources: [https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html, https://meltdownattack.com/]
---

# Meltdown and Spectre: CPUs leaked privileged memory through work they were going to throw away

On 3 January 2018, Jann Horn of Google Project Zero published a post titled ["Reading privileged memory with a side-channel"](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html). Its first sentence: Project Zero had discovered that CPU data cache timing ["can be abused to efficiently leak information out of mis-speculated execution"](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html), leading at worst to arbitrary virtual memory reads across local security boundaries.

Variants of the issue [affected many modern processors, including certain processors by Intel, AMD and ARM](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html). Project Zero had reported it to the three vendors on [2017-06-01](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html). Independent teams found the same problems and published under two names: **Spectre** for variants 1 and 2, and **Meltdown** for variant 3. The researchers' site summed it up: Meltdown ["breaks the most fundamental isolation between user applications and the operating system"](https://meltdownattack.com/), and Spectre ["breaks the isolation between different applications"](https://meltdownattack.com/).

This wasn't an outage or a breach of one company. It was a flaw in an assumption almost every processor made, and every system running on those processors inherited it. Whether it had been exploited in the wild, the researchers' answer was: ["We don't know."](https://meltdownattack.com/)

## What happened

Three variants, per [Project Zero](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html):

| Variant | Name | CVE | Public name |
|---|---|---|---|
| 1 | Bounds check bypass | CVE-2017-5753 | Spectre |
| 2 | Branch target injection | CVE-2017-5715 | Spectre |
| 3 | Rogue data cache load | CVE-2017-5754 | Meltdown |

Project Zero built proofs of concept for each, as listed in [its post](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html):

- **Variant 1** with normal user privileges under a modern Linux kernel with a distro-standard config could read arbitrarily within a 4GiB range of kernel virtual memory on an Intel Haswell Xeon, at about [2000 bytes per second after around 4 seconds of startup](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html). It also worked on an AMD PRO CPU if the kernel's eBPF JIT was enabled (not the default).
- **Variant 2**, with root inside a KVM guest on the Haswell Xeon and a specific Debian host kernel, could read **host** kernel memory at around [1500 bytes per second](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html), after 10 to 30 minutes of setup on a 64GiB machine.
- **Variant 3** with normal user privileges could read kernel memory on the Haswell Xeon under a precondition Project Zero believed was that the target memory was already in the L1D cache.

Project Zero's initial June report didn't include variant 3. The team had discussed direct reads of kernel memory but [thought it unlikely](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html) to work, then tested and reported it later.

Meltdown was independently found by three teams: Jann Horn; Werner Haas and Thomas Prescher of Cyberus Technology; and Daniel Gruss, Moritz Lipp, Stefan Mangard and Michael Schwarz of Graz University of Technology. Spectre was independently found by Jann Horn and by [Paul Kocher with collaborators](https://meltdownattack.com/).

## What the engineers believed

The belief here is one that hardware designers and software engineers shared for decades: **speculative execution has no visible effects.**

Background: a modern CPU doesn't wait to find out which way a branch goes. It predicts, keeps executing down the predicted path, and if the prediction was wrong, throws the results away. Project Zero's glossary states the guarantee: if speculation was wrong, ["the CPU can discard the resulting state without architectural effects"](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html). Instructions don't *retire*, meaning commit their register and memory writes, until the CPU knows they're on the correct path.

Software was built on that guarantee. A bounds check like `if (i < len) x = a[i]` was considered safe because, architecturally, the out-of-bounds read never happens. Kernel memory mapped into every process's address space was considered safe because the page tables marked it supervisor-only, and any user-mode read would fault.

Both were true at the architectural level. Neither was true at the level of the cache.

## What was actually going on

### The side channel: the cache remembers

Background: reading memory that is only in main memory is slow. Project Zero notes that loading uncached data ["will typically take over 100 cycles"](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html). A cached line comes back much faster. That difference is measurable from ordinary code with a timer.

When the CPU discards mis-speculated work, it restores registers. It doesn't un-load cache lines that speculative loads brought in. That's the leak: if speculative code touches a memory location whose *address* depends on a secret, the secret is encoded in which line is now cached, and an attacker can find it by timing reads.

### Variant 1: bounds check bypass

Project Zero's example (paraphrased from [its code sample](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html)):

```c
if (untrusted_offset < arr1->length) {          // the check
  unsigned char value = arr1->data[untrusted_offset];
  unsigned long index2 = ((value & 1) * 0x100) + 0x200;
  if (index2 < arr2->length) {
    unsigned char value2 = arr2->data[index2];    // secret-dependent load
  }
}
```

Suppose `arr1->length` isn't cached, so the check takes a while to resolve, and the branch predictor guesses "true". The CPU speculatively reads `arr1->data[untrusted_offset]` with an out-of-bounds offset, picks a slot in `arr2` based on one bit of that value, and loads that slot into L1. Then the length arrives, the CPU sees the check failed, and discards everything. But the cache line for `arr2->data[0x200]` or `arr2->data[0x300]` stays cached. By timing reads of both, the attacker learns ["whether arr1->data[untrusted_offset_from_caller]&1 is 0 or 1"](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html). Repeat for every bit.

```diagram
title: variant 1 in one picture
flow: slow bounds check -> guess: in bounds -> out-of-bounds read
flow!: secret picks line -> line stays cached -> timing leaks it
note: registers are rolled back; the cache is not
```

The attacker needs that code pattern to run inside the target with an out-of-bounds index. Project Zero said it had [not identified any existing exploitable instances](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html) in existing code. Instead it brought its own: the Linux kernel lets unprivileged users submit eBPF bytecode, which the kernel verifies and then interprets or JIT-compiles to run in kernel context. That let the PoC write the vulnerable pattern into the kernel itself.

### Variant 2: branch target injection

For indirect branches, where the target address is loaded from memory, the CPU predicts the target using history. Prior research had shown code in separate security contexts can influence each other's branch prediction. Project Zero's hypothesis was that it could be used to [redirect execution of code in the victim context](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html). The attacker trains the predictor so that, when the victim's indirect branch is waiting on a slow target load, the CPU speculatively jumps to code of the attacker's choosing in the victim, which then leaks data through the cache. The time window is typically [over 100 cycles](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html). This is how the PoC crossed from a KVM guest into the host kernel.

### Variant 3: rogue data cache load (Meltdown)

Meltdown doesn't need to steer kernel code at all. A user program reads a kernel address directly. That read will fault. Project Zero's explanation of why it still leaks: the permission check ["might not be on the critical path"](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html) for reading data into a register, because putting it there would hurt performance. The read can make the data available to following instructions immediately and check permission asynchronously, flagging an exception for when the instruction retires. Before that happens, dependent instructions have already used the value to touch a cache line.

Project Zero adds that the read can be placed behind a mispredicted branch so it never actually faults. The post also cautions that it contains ["a lot of speculation about hardware internals based on observed behavior"](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html), which may not match what processors actually do.

Which chips Meltdown affected was not settled at disclosure. The researchers' site said every Intel processor implementing out-of-order execution was potentially affected, that they had [only verified Meltdown on Intel](https://meltdownattack.com/), that it was unclear whether AMD processors were affected, and that according to ARM some of its processors were.

## How it was fixed

There was no single fix, because the root cause is how CPUs are designed. The [researchers' site](https://meltdownattack.com/) listed patches against Meltdown for Linux (KPTI, formerly KAISER), Windows and OS X, and work to harden software against Spectre, including an LLVM patch, MSVC changes and ARM's speculation barrier header. It said Spectre is ["harder to exploit than Meltdown, but it is also harder to mitigate"](https://meltdownattack.com/).

Background on KPTI, since it's the Meltdown fix most engineers met: Meltdown works because kernel memory is mapped in the user process's page tables, only guarded by a permission bit. Kernel page-table isolation gives user mode a separate set of page tables in which most kernel memory simply isn't mapped. There's nothing for a speculative read to reach. The cost is that every system call and interrupt has to switch page tables. The Literature section of Project Zero's post links the [KAISER paper](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html) by Gruss and others on this approach.

Project Zero left mitigation design to the vendors, saying they were ["in a much better position than we are to design and evaluate mitigations"](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html).

## What changed afterwards

The sources here are the disclosure itself, so they don't cover what happened in later years. The vendor statements in Project Zero's post show how the vendors framed it at the time. Intel said susceptibility ["is not limited to Intel processors, nor does it mean that a processor is working outside its intended functional specification"](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html). ARM said speculation ["despite working as intended"](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html) could be combined with cache timing to leak information, and recommended its software mitigations. Both statements say the same thing: the hardware did what it was specified to do. The specification was the problem.

Project Zero also listed open research directions, including whether variant 1 attacks are practical against [JavaScript engines](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html). For a backend engineer, the implication is that any system running untrusted code in the same process or on the same core as secrets, whether a JIT, a sandbox or a shared host, is in scope.

## The rule

A security boundary that is only a check, whether a bounds check or a page permission bit, can be raced by a processor that executes ahead of the check. Speculative work is rolled back architecturally but leaves traces in shared state like caches, and timing reads those traces. Where trust domains share hardware, isolate them for real: separate address spaces, separate processes, and where it matters, separate cores or machines. And patch the kernel and the compiler, because most of the practical defense lives there.

## Sources

- [Jann Horn, "Reading privileged memory with a side-channel", Google Project Zero](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html): the Project Zero disclosure with the three variants, proofs of concept, technical explanation and vendor statements.
- [Meltdown and Spectre (meltdownattack.com)](https://meltdownattack.com/): the researchers' site for both attacks, with the discoverer lists, affected systems, CVE mapping and available patches.
