---
title: "Half a second of extra SSH login time exposed the xz-utils backdoor"
dek: "Upstream xz 5.6.0 and 5.6.1 shipped release tarballs that built a backdoor into liblzma. Through a distro patch, liblzma was loaded into sshd, where the backdoor hijacked RSA_public_decrypt before the linker locked the table down. It was found because SSH logins got slower."
belief: "Distros trusted xz release tarballs to be the project's source. They built an SSH backdoor into liblzma."
date: 2024-03-29
company: xz-utils
kind: security-breach
topics: [supply-chain, security, dependency]
stack: [xz, liblzma, openssh, systemd, glibc, autotools]
impact: "The upstream xz repository and release tarballs for 5.6.0 and 5.6.1 were backdoored, with injected code that intercepted sshd's RSA signature verification on affected x86-64 Linux builds."
detected_by: third-party
rule: "What you build must be what you reviewed. Release tarballs that differ from the repository, and test fixtures that are really binaries, are places for code to hide."
postmortem: https://www.openwall.com/lists/oss-security/2024/03/29/4
sources: [https://www.openwall.com/lists/oss-security/2024/03/29/4]
---

# Half a second of extra SSH login time exposed the xz-utils backdoor

On 29 March 2024, Andres Freund posted to the oss-security mailing list under the subject ["backdoor in upstream xz/liblzma leading to ssh server compromise"](https://www.openwall.com/lists/oss-security/2024/03/29/4). His opening was blunt: ["The upstream xz repository and the xz tarballs have been backdoored."](https://www.openwall.com/lists/oss-security/2024/03/29/4)

He hadn't been hunting for malware. Over the previous weeks he had noticed [odd symptoms on Debian sid installations](https://www.openwall.com/lists/oss-security/2024/03/29/4): SSH logins taking a lot of CPU, and valgrind errors around liblzma. A failed login to a nonexistent user that used to take [0.299 seconds of wall time now took 0.807](https://www.openwall.com/lists/oss-security/2024/03/29/4). Chasing that half second led to the backdoor.

The affected versions were [xz 5.6.0 and 5.6.1](https://www.openwall.com/lists/oss-security/2024/03/29/4). Freund noted that, luckily, they [had not yet been widely integrated by Linux distributions](https://www.openwall.com/lists/oss-security/2024/03/29/4), and where they had, mostly in pre-release versions. Red Hat assigned the issue [CVE-2024-3094](https://www.openwall.com/lists/oss-security/2024/03/29/4).

This post is built on that one disclosure email. It was written on the day of discovery, and Freund is explicit that he is ["*not* a security researcher, nor a reverse engineer"](https://www.openwall.com/lists/oss-security/2024/03/29/4) and that much of the analysis is from observation. What follows is what that email established.

## What happened

From the [disclosure](https://www.openwall.com/lists/oss-security/2024/03/29/4):

1. Two obfuscated files containing the bulk of the exploit were committed to the xz repository as test files: `tests/files/bad-3-corrupt_lzma2.xz` and `tests/files/good-large_compressed.lzma`. They were not used by any tests in 5.6.0.
2. The release tarballs for 5.6.0 and 5.6.1 contained a modified `m4/build-to-host.m4`. That line is **not** in the upstream source of build-to-host, and xz's git repository doesn't use build-to-host at all. GitHub's auto-generated "source code" archives, built straight from the repository, did not contain it.
3. During `configure`, the modified m4 injects an obfuscated script that, if conditions match, rewrites the liblzma Makefile so the build extracts and runs code hidden in the test files. The result is an object file with the backdoor linked into liblzma.
4. The injected code caused valgrind errors and crashes in some configurations because the stack layout differed from what it expected. Commits in 5.6.1 tried to work around those issues, and the exploit code was then adjusted.
5. Freund concluded that, given the activity over several weeks, the committer was either directly involved or their system was severely compromised, and that the second explanation looked less likely because they had [communicated on various lists about the "fixes"](https://www.openwall.com/lists/oss-security/2024/03/29/4).

## What everyone believed

The ecosystem's working assumption, and it is a reasonable one, is that a release tarball from a project's maintainers is the project's source code, packaged. Distributions build from those tarballs. Reviewers read the repository. Nobody routinely diffs the two.

A second assumption: **sshd doesn't use a compression library, so a compression library can't attack sshd.** Freund confirms the first half: ["openssh does not directly use liblzma."](https://www.openwall.com/lists/oss-security/2024/03/29/4) But Debian and several other distributions patch OpenSSH to support systemd notification, and libsystemd depends on lzma. So on those systems, liblzma is loaded into every sshd process.

And a third: binary files under `tests/` are inert test data. Compressed test fixtures are normal for a compression library. Nobody expects them to contain a build-time payload.

## What was actually going on

### Stage one: the build system

Autotools projects ship a generated `configure` script in their release tarballs, and that script is assembled from m4 macros. *Background:* because the tarball contains generated files that don't exist in git, the tarball is a different artifact from the repository, and it is the one most distributions actually build.

That is where the attacker put the trigger. The tampered `build-to-host.m4` injected a script at the end of `configure`. That script checked whether to act. Per the disclosure, it targets only [x86-64 Linux, built with gcc and the GNU linker, as part of a Debian or RPM package build](https://www.openwall.com/lists/oss-security/2024/03/29/4). Freund suspects the last condition was [aimed at making it harder for investigators to reproduce](https://www.openwall.com/lists/oss-security/2024/03/29/4). He also noted the backdoor likely only works on glibc systems.

If the checks passed, the Makefile was modified to run a pipeline that pulled data out of `bad-3-corrupt_lzma2.xz`, swapped characters with `tr`, decompressed it with `xz -d` and piped the result to `/bin/bash`. That stage in turn extracted more from `good-large_compressed.lzma`. Each stage looks like ordinary shell plumbing operating on a test file.

### Stage two: the dynamic linker

Here is where it gets clever, and where some background on how Linux loads shared libraries helps.

*Background:* glibc supports **IFUNC** resolvers, functions that run at load time to pick the best implementation of a symbol for the current CPU. liblzma uses them to choose a CRC implementation. Calls from a program into a shared library go through the **GOT/PLT**, a table of function pointers the dynamic linker fills in. With **RELRO**, that table is remapped read-only once resolution is done, precisely so that nobody can overwrite those pointers later.

The disclosure describes how the backdoor used each of these:

- It **replaced the IFUNC resolvers** `crc32_resolve()` and `crc64_resolve()`. sshd is built with `-Wl,-z,now`, so all symbols are resolved at startup, which means the resolvers run early, inside sshd. Freund notes that with `LD_BIND_NOT=1` the backdoor did not appear to work.
- On the second invocation, `crc64_resolve()` gathered information from the dynamic linker, program arguments and environment, ran environment checks, and then **parsed symbol tables in memory**. Freund calls this ["the quite slow step that made me look into the issue"](https://www.openwall.com/lists/oss-security/2024/03/29/4).
- liblzma's symbols are resolved before those of many other libraries and the main sshd binary. To reach symbols that weren't loaded yet, the backdoor **installed an audit hook into the dynamic linker**, waited for `RSA_public_decrypt` in sshd's PLT to be resolved, and then pointed that entry at its own code. That was possible because the GOT had not yet been remapped read-only. After that, the hook was uninstalled.

```diagram
title: how liblzma reached sshd's RSA check
flow: sshd -> libsystemd (patch) -> liblzma loaded
flow!: IFUNC resolver -> audit hook -> RSA_public_decrypt
note: the GOT entry is rewritten before RELRO makes it read-only
```

The effect: during a public-key login, sshd's `ssh_rsa_verify` calls `RSA_public_decrypt`, which now lands in liblzma's backdoor. Freund's trace shows the backdoor then calling back into libcrypto, [presumably to perform normal authentication](https://www.openwall.com/lists/oss-security/2024/03/29/4). He had not yet worked out what the code checks for to allow unauthorized access, but since it runs before authentication, he wrote that it ["seems likely to allow some form of access or other form of remote code execution"](https://www.openwall.com/lists/oss-security/2024/03/29/4).

### Hiding from analysis

The backdoor was picky about when it ran. Freund observed that it required: `TERM` unset, `argv[0]` equal to `/usr/sbin/sshd`, `LD_DEBUG` and `LD_PROFILE` unset, and `LANG` set. Some debugging environments such as `rr` appeared to be detected, and plain gdb sometimes. Starting sshd outside systemd initially [didn't show the slowdown](https://www.openwall.com/lists/oss-security/2024/03/29/4).

Those conditions describe exactly how sshd runs when systemd starts it, and almost never how a developer runs it in a terminal. Setting `TERM=foo` made `sshd -h` take [about 0.01s instead of about 0.5s](https://www.openwall.com/lists/oss-security/2024/03/29/4) on Freund's system.

### Why it was noticed at all

The backdoor's symbol-table walk cost CPU every time sshd started. (Background: sshd re-executes itself for each incoming connection, so that cost is paid per login.) The crash fixes in 5.6.1 show the code had already been [causing valgrind errors and crashes in some configurations](https://www.openwall.com/lists/oss-security/2024/03/29/4). Those two side effects, a performance regression and memory-checker noise, are what Freund saw. He used `perf record -e intel_pt//ub` to find where execution diverged with the backdoor active, then gdb to stop just before the divergence.

## How it was handled

Freund's disclosure lays out the reporting path:

- Because the problem appeared to involve upstream, he did not file an upstream bug.
- He first thought it was Debian-specific and sent a preliminary report to Debian security, then reported it to the `distros` list. A distribution notified CISA.
- Red Hat assigned CVE-2024-3094.
- He attached the de-obfuscated script, the injected object file (first extracted in isolation by Florian Weimer), and a detection script by Vegard Nossum to check whether the local ssh binary is likely vulnerable.

His advice: ["I'd upgrade any potentially vulnerable system ASAP."](https://www.openwall.com/lists/oss-security/2024/03/29/4)

## What changed afterwards

The disclosure is a first-day report and doesn't describe the longer-term response by xz, distributions or OpenSSH, so this post doesn't either. What the email does make clear is where the gaps were:

- The trigger lived **only in the release tarball**. Anyone reviewing the git history would not have seen it.
- The payload lived in **binary test fixtures** that no test used.
- The route into sshd went through a **distribution patch** linking libsystemd, not through anything in OpenSSH upstream.
- The checks were tuned so the backdoor only ran under **production conditions** (systemd, package builds), not developer ones.

## The rule

Build from what you reviewed. If release artifacts can differ from the repository, someone must check that the difference is only the generated files you expect. Treat opaque binaries in a source tree, including "test data", as code, because a build step can turn them into code. And remember that your attack surface includes every library loaded into your process, including the ones a distro patch pulled in.

There's a second, quieter lesson for operators (interpretation, not from the email): an unexplained performance regression in a security-critical path is worth chasing. The backdoor was found because someone refused to ignore half a second.

## Sources

- [Andres Freund, "backdoor in upstream xz/liblzma leading to ssh server compromise", oss-security mailing list, 29 March 2024](https://www.openwall.com/lists/oss-security/2024/03/29/4): the original public disclosure, covering the tarball and repository components, targeting conditions, the dynamic-linker hijack of RSA_public_decrypt, observed timings and the reporting path.
