---
title: "Unpublishing left-pad broke thousands of npm builds, and a new 1.0.0 couldn't fix them"
dek: "During a dispute over a package name, an author unpublished kik and 272 other packages, including the tiny left-pad. Installs that depended on it failed across the dependency graph, and a replacement didn't help because babel and atom pulled in exactly version 0.0.3."
belief: "npm assumed old package versions would stay published. Unpublishing left-pad broke babel and atom installs."
date: 2016-03-22
company: npm
kind: outage
topics: [dependency, supply-chain]
stack: [npm, nodejs, javascript, semver]
impact: "Unpublishing kik and 272 other packages, including left-pad, impacted many thousands of projects, with hundreds of install failures per minute."
rule: "A registry that builds depend on can't allow a published version to disappear. Immutability has to be a property of the system, not a convention authors are trusted to keep."
postmortem: https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm
sources: [https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm]
---

# Unpublishing left-pad broke thousands of npm builds, and a new 1.0.0 couldn't fix them

Shortly after [2:30 PM Pacific on Tuesday, 22 March 2016](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm), npm, Inc. started seeing ["hundreds of failures per minute"](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm) on its registry. Projects were failing to install, and so were their dependents, and the dependents of those.

The missing package was `left-pad`, a module that pads the start of a string. Its author had just unpublished `kik` and [272 other packages](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm), left-pad among them. npm's postmortem says the disruption [impacted many thousands of projects](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm), and that dependency chains including babel and atom were affected.

No server failed. The registry worked exactly as designed: it let an author remove their package, and then it correctly told every client that the package didn't exist. The incident shows what happens when a public package registry, which in practice is shared infrastructure, lets published versions be deleted.

## What happened

According to [npm's postmortem](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm), which was posted on 23 March 2016:

- **Before the outage.** Azer Koçulu and the company Kik had corresponded over the package name `kik` and couldn't agree. A Kik representative asked npm to help. Applying its package name dispute resolution policy, npm concluded the name should be maintained by Kik and told both parties.
- **The unpublish.** With no warning to developers of dependent projects, Azer unpublished his `kik` package and [272 other packages](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm). One of them was `left-pad`.
- **Shortly after 2:30 PM.** npm sees hundreds of failures per minute as dependent projects request the now-missing package.
- **Within ten minutes.** Cameron Westland publishes a functionally identical `left-pad` as version 1.0.0. That's allowed because left-pad is open source and npm lets anyone take an abandoned name as long as they don't reuse old version numbers.
- **Errors continue.** Many failures don't stop, because dependency chains including babel and atom pull left-pad in through `line-numbers`, which ["explicitly requested 0.0.3"](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm).
- **4:05 PM.** npm announces it will republish the original 0.0.3. Normally that's impossible, so it restores it from a backup.
- **4:55 PM.** The republish is complete.

The other 272 modules were [adopted by other community members in a similar time](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm), either as forks of the originals or as placeholder packages to stop someone malicious from publishing under those names.

## What the engineers believed

npm's dispute policy was built on a sensible assumption: changing who owns a name doesn't touch existing versions. As the postmortem puts it, ["Transferring ownership of a package's name doesn't remove current versions of the package. Dependents can still retrieve and install it. Nothing breaks."](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm) Under the policy, the new owner publishes with a breaking version number, and anyone using the old package keeps getting it.

That's true as long as the old versions stay published. The policy assumed they would. The registry didn't require it. Unpublishing was possible ["for historical reasons"](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm). npm says the community and npm's importance had both grown past the point where that was safe.

## What was actually going on

### A package is a node in a graph

When you run `npm install`, npm resolves your direct dependencies, then theirs, and so on until it has a full tree. Every node in that tree has to be fetched from the registry. If even one node returns "not found", the install fails, even if that node is a ten-line utility buried five levels deep that you've never heard of.

That's how one small module could break so much. Most people affected had never chosen to depend on left-pad. They depended on babel or atom, and something in that tree depended on `line-numbers`, which depended on `left-pad`. npm describes the failures as moving outward: dependent projects, ["and their dependents, and their dependents…"](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm) all failing when requesting the unpublished package.

### Why the 1.0.0 republish didn't help

This is the part of the incident with the most to teach. Ten minutes after the unpublish, the name `left-pad` existed again with working code. Most installs still failed.

npm dependencies are declared as **semver ranges**. A package can ask for `^1.0.0` (any 1.x), `~0.0.3` (patch updates only), or an exact version such as `0.0.3`. The resolver has to find a published version that satisfies the range. A replacement only helps a consumer whose range includes the replacement's version number.

`line-numbers` asked for exactly [0.0.3](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm). Cameron's release was 1.0.0, and npm doesn't allow anyone to reuse an old version number for a name, since that's what stops a new owner from slipping different code under a version people already trust. So no one could publish a new 0.0.3, and 1.0.0 fell outside the range. The resolver correctly found no version that matched. Even a `^0.0.3` range wouldn't have accepted 1.0.0, because a caret range on a 0.0.x version only matches that exact patch version. Either way, the only fix for those consumers was the original 0.0.3 bytes.

```diagram
title: why a new left-pad didn't help
flow: babel/atom -> line-numbers -> left-pad 0.0.3
flow!: 0.0.3 unpublished -> 1.0.0 out of range -> install fails
note: only the original 0.0.3 could satisfy it
```

The rule against reusing version numbers is a security feature: a version number should always mean the same bytes. In this case the same rule blocked the quick fix. That's why npm had to take the step it calls ["unprecedented"](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm): restoring 0.0.3 from backup, after conferring with Cameron, who by then held the name.

### The name-squatting risk

Once a widely used package is fully unpublished, its name is free. Anyone can register it and publish a new version that falls inside consumers' ranges. If `line-numbers` had depended on `^1.0.0` instead, an attacker could have published 1.0.1 with malicious code, and every babel install would have pulled it in. The community members who quickly adopted the other 272 names and published placeholders were guarding against exactly this. npm says it was [working to transfer those names to its direct control](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm), with their permission.

## How they fixed it

1. **Community replacement.** Cameron Westland published a functionally identical left-pad 1.0.0 within ten minutes. That fixed consumers whose ranges allowed it.
2. **Restoring 0.0.3 from backup.** npm announced at 4:05 PM and completed at 4:55 PM a republish of the original version that `line-numbers` pinned.
3. **The other 272 names.** Community members adopted them with forks or placeholders.

## What changed afterwards

npm listed three changes in the [postmortem](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm):

1. **Harder to unpublish versions others depend on.** Unpublishing a version would become harder if it would break other packages. Technical details were still being worked out when the post was written.
2. **Harder to hijack abandoned names.** If a package with known dependents is fully unpublished, npm would replace it with a placeholder package so the name can't be taken immediately. The name could still be obtained through npm support.
3. **Internal policy updates** to help npm's team stay in sync and handle community conflict.

npm stood by its dispute decision, saying it was based on its policy and not a legal matter. Its position was that ["It was abrupt unpublishing, not our resolution policy, that led to yesterday's disruptions."](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm) It also admitted it took too long to publish its update.

## The rule

If builds depend on an artifact store, published artifacts have to be immutable. That means they can't be deleted as well as not overwritten. Allowing deletion keeps every build hostage to every author's mood. The registry can enforce this. A convention can't.

For consumers, the defense is not to rely on the public registry being available at build time. A lockfile pins *which* version you get, but you still have to download it. A private mirror or a vendored cache of your dependency tree means a package disappearing upstream becomes an alert instead of an outage. Also check how deep your tree goes. Most of the people who broke that afternoon had never typed `npm install left-pad`.

## Sources

- [npm, Inc., "kik, left-pad, and npm", npm blog, 23 Mar 2016](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm): npm's official postmortem, covering the name dispute, the unpublish of kik and 272 other packages, the timeline, the 0.0.3 pinning problem, the republish from backup and planned policy changes.
