---
title: "An attacker still inside Trivy's pipeline turned its version tags into a credential stealer"
dek: "After a February breach, Aqua Security rotated credentials, but not all at once. On March 19 someone used retained access to publish a malicious Trivy release and force-push almost every trivy-action and setup-trivy tag to code that read secrets out of CI runner memory, then ran the real scan so the job still went green."
date: 2026-03-19
company: Aqua Security
kind: security-breach
topics: [supply-chain, security, data-leak]
stack: [trivy, github-actions, docker-hub, goreleaser]
impact: "Trivy v0.69.4, 76 of 77 trivy-action tags and all 7 setup-trivy tags were replaced with credential-stealing code, and malicious v0.69.5 and v0.69.6 images were later pushed to Docker Hub."
rule: "A version tag is a pointer that anyone with push access can move. Pin to a commit or digest, and when you rotate credentials after a breach, revoke everything at once before issuing anything new."
postmortem: https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23
sources: [https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23, https://www.microsoft.com/en-us/security/blog/2026/03/24/detecting-investigating-defending-against-trivy-supply-chain-compromise/, https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/, https://www.wiz.io/blog/trivy-compromised-teampcp-supply-chain-attack]
---

# An attacker still inside Trivy's pipeline turned its version tags into a credential stealer

Trivy is Aqua Security's open-source vulnerability scanner. Lots of teams run it in CI on every build, usually through the `aquasecurity/trivy-action` or `aquasecurity/setup-trivy` GitHub Actions. On March 19, 2026, an attacker used compromised credentials to [publish a malicious Trivy v0.69.4, force-push 76 of 77 version tags in trivy-action and replace all 7 tags in setup-trivy](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23). On March 22, malicious v0.69.5 and v0.69.6 images followed on Docker Hub.

Pipelines that referenced those actions by tag picked up the attacker's code on their next run. The code read secrets out of the runner, sent them away encrypted, and then ran the real Trivy scan. Microsoft notes the workflow [completed successfully with expected output](https://www.microsoft.com/en-us/security/blog/2026/03/24/detecting-investigating-defending-against-trivy-supply-chain-compromise/), so nothing looked wrong to the people running it.

Aqua rated the advisory Critical and assigned it [CVE-2026-33634](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23). The odd thing about this one is that it wasn't the first breach. It happened because the first one wasn't fully cleaned up.

## What happened

Aqua's advisory lists four exposure windows, all UTC ([advisory](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23)):

| Component | Start | End | Duration (advisory) |
|---|---|---|---|
| trivy v0.69.4 | Mar 19, 18:22 | Mar 19, ~21:42 | ~3 hours |
| trivy-action | Mar 19, ~17:43 | Mar 20, ~05:40 | ~12 hours |
| setup-trivy | Mar 19, ~17:43 | Mar 19, ~21:44 | ~4 hours |
| Docker Hub v0.69.5 / v0.69.6 | Mar 22, 15:43 | Mar 23, ~01:40 | ~10 hours |

The sources don't agree on every detail:

- **Tag count.** Aqua and Microsoft say [76 of 77](https://www.microsoft.com/en-us/security/blog/2026/03/24/detecting-investigating-defending-against-trivy-supply-chain-compromise/) trivy-action tags were force-pushed. Wiz says [75 out of 76](https://www.wiz.io/blog/trivy-compromised-teampcp-supply-chain-attack).
- **Docker Hub timing.** Docker gives the affected pull window as [18:24 UTC on March 19 to 01:36 UTC on March 23](https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/), slightly different from Aqua's 18:22 and ~01:40. Wiz says the second wave of images went up at [~16:00 UTC](https://www.wiz.io/blog/trivy-compromised-teampcp-supply-chain-attack) on March 22, while Aqua says 15:43.
- **Repeat attempts.** Docker adds that on [March 20 at 03:26 UTC](https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/), the attackers re-pointed the `latest` image tag at malicious content again after Aqua's first cleanup.

Wiz attributes the attack to a group that [self-identifies as TeamPCP](https://www.wiz.io/blog/trivy-compromised-teampcp-supply-chain-attack). Microsoft later saw the same campaign hit [Checkmarx KICS (March 23) and LiteLLM (March 24)](https://www.microsoft.com/en-us/security/blog/2026/03/24/detecting-investigating-defending-against-trivy-supply-chain-compromise/).

## What the maintainers believed

After the first incident, Aqua believed that rotating credentials had shut the attacker out. The advisory explains why it hadn't:

> This incident is a continuation of the supply chain attack that began in late February 2026. Following the initial disclosure on March 1, credential rotation was performed but was not atomic (not all credentials were revoked simultaneously).

Aqua says the attacker [could have used a valid token to exfiltrate newly rotated secrets](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23) during the rotation window, which lasted a few days. Note the hedge: the advisory says this "could have allowed" the attacker to keep access. It doesn't claim to know for certain that's what happened. Wiz says the same thing more directly: the attack used [access retained following incomplete containment](https://www.wiz.io/blog/trivy-compromised-teampcp-supply-chain-attack) of the earlier incident.

Wiz also reports that the attacker had compromised the `aqua-bot` service account and stolen more of Aqua's credentials, [including GPG keys and credentials for Docker Hub, Twitter, and Slack](https://www.wiz.io/blog/trivy-compromised-teampcp-supply-chain-attack). That fits with Aqua's statement that the v0.69.5 and v0.69.6 images were pushed with [separately-compromised Docker Hub credentials (not via GitHub)](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23).

The second belief belonged to the users. A tag like `trivy-action@0.34.2` feels like a fixed version, something that means the same code tomorrow as today. It isn't.

## What was actually going on

### Tags are pointers you don't control

Microsoft puts it plainly: in Git, a tag maps to a commit, and [anyone with push access can reassign an existing tag](https://www.microsoft.com/en-us/security/blog/2026/03/24/detecting-investigating-defending-against-trivy-supply-chain-compromise/) to a different one. A workflow that says `uses: aquasecurity/trivy-action@0.34.2` asks GitHub "whatever commit that tag points to right now". Once the attacker force-pushed the tags, every pipeline using them ran the new code on its next execution, [with no visible change on GitHub](https://www.microsoft.com/en-us/security/blog/2026/03/24/detecting-investigating-defending-against-trivy-supply-chain-compromise/).

```diagram
title: same tag, different commit
flow: workflow @0.34.2 -> tag = real commit -> Trivy scan runs
flow!: tag force-pushed -> stealer runs first -> secrets exfiltrated
note: the workflow file never changed; the tag behind it did
```

Even SHA pinning wasn't always enough. Aqua notes that if you pinned trivy-action to a commit from before [2025-04-09](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23), you got a safe trivy-action that still pulled setup-trivy by tag, which was malicious during its exposure window. A pin protects only the thing you pinned, not the things it pulls in.

### What the stealer did

The payload ran inside `entrypoint.sh`, [before the legitimate Trivy scan](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23). According to the advisory and Wiz, it:

1. **Read the runner's memory.** It dumped the `Runner.Worker` process memory via `/proc/<pid>/mem` and, per Wiz, searched it for the pattern [`{"value":"<secret>","isSecret":true}`](https://www.wiz.io/blog/trivy-compromised-teampcp-supply-chain-attack).
2. **Swept the disk.** It checked [50+ filesystem paths](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23) for SSH keys, cloud credentials, Kubernetes tokens, Docker configs, `.env` files and crypto wallets. Microsoft saw it query cloud metadata endpoints for IAM credentials and try [`kubectl get secrets --all-namespaces`](https://www.microsoft.com/en-us/security/blog/2026/03/24/detecting-investigating-defending-against-trivy-supply-chain-compromise/).
3. **Encrypted and sent the haul.** It used AES-256-CBC with RSA-4096 hybrid encryption and posted the result to the typosquatted domain `scan.aquasecurtiy[.]org`. If that failed and a GitHub token was available, it fell back to creating a public `tpcp-docs` repository in the victim's account and uploading the data as a release asset.
4. **Ran the real scan.** After cleaning up its temporary files, it launched Trivy, so [the workflow completed successfully](https://www.microsoft.com/en-us/security/blog/2026/03/24/detecting-investigating-defending-against-trivy-supply-chain-compromise/).

*Background:* GitHub Actions masks secrets in logs, but the runner process has to hold the real values in memory to pass them to steps. Reading that process's memory skips the masking entirely. (This is my explanation; the sources describe the memory dump but not why masking doesn't help.)

The malicious v0.69.4 binary did something similar. Wiz also found that when it decided it was on a developer machine rather than in CI (`GITHUB_ACTIONS != "true"`), it installed a [persistent `sysmon.py` systemd unit](https://www.wiz.io/blog/trivy-compromised-teampcp-supply-chain-attack) that polled for further payloads.

### How the binary release got built

The attacker didn't need to change Trivy's main branch. According to [Aqua](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23), they:

1. Pushed a commit that swapped the `actions/checkout` reference for an imposter commit, which downloaded malicious Go source from a typosquatted domain during the build.
2. Added `--skip=validate` to goreleaser to bypass binary validation.
3. Tagged that commit `v0.69.4`, which triggered the normal release pipeline.

The output went out through every normal channel: GHCR, ECR Public, Docker Hub, deb and rpm packages, and get.trivy.dev. Docker points out that because the pushes used Aqua's own credentials, they were [indistinguishable from normal Aqua Security activity](https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/).

### What was protected, and why

Two features stopped the attacker. GitHub's immutable releases feature was [enabled March 3](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23), before Trivy v0.69.3 was published, so v0.69.3 couldn't be replaced. trivy-action 0.35.0 was protected the same way. Builds from source and the official Homebrew formula were also unaffected, because the malicious code never landed on the main branch.

## How they fixed it

Aqua removed the malicious artifacts and restored Docker Hub's `latest` tag to [0.69.3](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23). One cleanup step failed in an unexpected way. Because the attacker's force-push caused GitHub to treat the hijacked trivy-action tags as immutable releases, the original names [cannot be re-created](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23). Aqua republished them with a `v` prefix (`v0.0.1` to `v0.34.2`) pointing at the original commits, with three still not restored when the advisory was written. setup-trivy v0.2.6 was re-created clean; v0.2.0 to v0.2.5 were not restored.

Docker deleted the three malicious image digests between [22:20 UTC on March 19 and 01:26 UTC on March 23](https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/) and quarantined the content for investigation.

## What changed afterwards

For users, the advice from all four sources is the same:

- **Treat every secret reachable from an affected pipeline as exposed, and rotate it.**
- **Look for a `tpcp-docs` repository** in your GitHub organisation.
- **Pin Actions to full commit SHAs** and images to digests.

Docker adds that if you ran a compromised image with the Docker socket mounted, you should [treat the entire host as compromised](https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/).

Docker's write-up has the most quotable lessons. One is ["Mutable tags are not a security boundary."](https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/) Another points out that this was a scanner that couldn't be fixed by scanning: [no software bug was exploited](https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/), because the attack was in the publishing process, not the dependency graph. And on rotation: ["Secret rotation must be atomic."](https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/)

## The rule

After a breach, revoke every credential the attacker might hold at the same moment, and only then issue new ones. If you rotate one at a time, an attacker who still holds an unrotated token can read the new secrets as you create them.

And on the consuming side, a version tag is a request, not a guarantee. Pin to the immutable thing (a commit SHA or an image digest), and remember that a pin covers only what you pinned, not whatever that code pulls in at runtime (interpretation).

## Sources

- [Aqua Security, "Trivy ecosystem supply chain temporarily compromised", GHSA-69fq-xp46-6x23, 21 March 2026](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23): the official advisory, with exposure windows, root cause (non-atomic rotation), attack details, affected versions, remediation and IOCs.
- [Microsoft Defender Security Research, "Guidance for detecting, investigating, and defending against the Trivy supply chain compromise", 24 March 2026, with later updates](https://www.microsoft.com/en-us/security/blog/2026/03/24/detecting-investigating-defending-against-trivy-supply-chain-compromise/): how mutable tags were abused, the stealer's behaviour on runners, and the campaign's spread to other projects.
- [Docker, "Trivy supply chain compromise: What Docker Hub users should know"](https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/): Docker Hub timeline, deleted digests and lessons on mutable tags and atomic rotation.
- [Wiz Research, "Trivy Compromised: Everything You Need to Know about the Latest Supply Chain Attack"](https://www.wiz.io/blog/trivy-compromised-teampcp-supply-chain-attack): attribution, the aqua-bot service account compromise, payload stages and the developer-machine persistence.
