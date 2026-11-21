---
title: "Travis CI's cleanup job read only the newest 100 images and deleted the stable ones"
dek: "An image cleanup service deleted any GCE image missing from the catalog list it fetched. The list was capped at 100 names, newest first, so the oldest images, which were the stable ones every build used, looked unused and were permanently deleted."
date: 2016-08-09
company: Travis CI
kind: data-loss
topics: [automation, storage, software-bug]
stack: [gce, travis-ci, vm-images]
duration_min: 90
impact: "All stable VM images for GCE-based builds were permanently deleted. Builds were down for about 90 minutes, and the forced move to untested images broke builds for many users."
rule: "A deletion job must never infer 'unused' from a list it may have read only part of. Fail closed on incomplete data and protect what's in production explicitly."
postmortem: https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/
sources: [https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/, https://byu-se.github.io/idb/incidents/34.html]
---

# Travis CI's cleanup job read only the newest 100 images and deleted the stable ones

On [9 August 2016](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/), Travis CI's builds on Google Compute Engine stopped. This was more than downtime. Travis said it had ["permanently lost our VM images used for builds running on GCE."](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/)

Travis's own automation deleted them. A cleanup service whose job was to delete images that were no longer in use asked the image catalog which images were in use. It got back a list capped at 100 entries, sorted newest first, and the stable production images were the oldest. They weren't on the list, so the service deleted them.

Builds were running again in [about 90 minutes](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/), but only after switching to newer images that hadn't finished QA. The postmortem, published almost two months later by Konstantin Haase, says that switch was the main impact for users.

## What happened

Some background from the [postmortem](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/). Hosted Travis CI ran build jobs on three platforms: Docker containers on AWS EC2 (the default), macOS VMs on VMware vSphere, and Linux VMs on GCE. A build went to GCE if it needed `sudo` or wanted to use Docker inside the build.

Storage for VM images on GCE was limited. To keep from running out, Travis ran an automated cleanup service that deleted images ["that have been removed from our internal image catalog service."](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/) The postmortem adds: "You may already see where this is going."

Several conditions came together:

1. **Old stable images.** The last image update had been [nine months earlier](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/). Newer images existed and some early adopters were using them, but they hadn't been through full QA.
2. **Many new images.** Travis was building a better provisioning process, which ran on Travis CI itself. During that work it had been publishing [many more images than in the previous 5-6 months](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/).
3. **Cleanup re-enabled.** The cleanup service had been briefly turned off to troubleshoot a possible race condition. Then it was turned back on.
4. **A hard-coded limit.** The service had a default, hard-coded number of image names to fetch from the catalog, and it [was set to 100](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/).

When cleanup restarted, the 100 newest names didn't include the stable images, because they were the oldest. The service ["promptly started deleting the older images from GCE"](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/), and every stable image was irrecoverably deleted. Builds stopped immediately.

## What the engineers believed

The cleanup logic looks sound: anything in the catalog is in use, anything not in the catalog is garbage, so delete what's on GCE but not in the catalog. If "the catalog" means the complete catalog, that's correct.

The hidden assumption is that the list the service fetched *was* the complete catalog. When the limit of 100 was set, it presumably was. The postmortem doesn't say when or why 100 was chosen, but with only a handful of images published over months, a 100-entry page would have covered the whole catalog with plenty of room. The limit was a default nobody needed to think about, until the image count grew past it.

## What was actually going on

### Allowlist garbage collection is fail-open on missing data

There are two basic ways to write a cleanup job:

- **Denylist:** "Delete these specific items." If the list is incomplete, you delete too little. Missing data makes it fail safe.
- **Allowlist (keep-list):** "Delete everything except these items." If the keep-list is incomplete, you delete too much. Missing data makes it fail dangerous.

Travis's cleanup was the second kind. The catalog said what to keep, and everything else on GCE was a candidate for deletion. In that design, any way of under-reading the keep-list turns into deletion: a timeout, a page limit, a partial response, an empty result from an outage. The safety of the whole job depended on reading the keep-list completely, and nothing checked that it had.

### A page that silently looked like the whole set

The service asked for at most 100 names, sorted newest first. That's the API shape of one page of results. Nothing in the response said "and there are more." The code treated the first page as the full catalog.

As long as the catalog had fewer than 100 entries, page one *was* the full set, so the bug couldn't be seen. It only showed up once the image count passed the limit, and the extra images were exactly the ones the new provisioning work had been producing. Because the sort was newest first, the images cut off were the oldest. In this system, the oldest images were the most important: the stable ones the bulk of builds depended on. The IDB summary of the incident says the deleted images included ["the images used most"](https://byu-se.github.io/idb/incidents/34.html).

```diagram
title: what the cleanup service saw
flow: 100+ in catalog -> query: newest 100 -> stable images cut
flow!: image not in list -> treated as unused -> deleted for good
note: the hard-coded limit was 100
```

### The pause made it worse

This is interpretation, but the pause probably mattered. The IDB summary describes the sequence: while cleanup was off, the organization [began creating more images than before](https://byu-se.github.io/idb/incidents/34.html), including some not yet fully tested. So when cleanup came back on, it faced a catalog that had grown past its limit while it wasn't watching. The postmortem doesn't describe any dry-run step, any check of how much it was about to delete, or any confirmation before re-enabling.

### Why the images couldn't be rebuilt

Losing a build artifact is normally an inconvenience, because you rebuild it. Here Travis found that ["recreating images exactly as before was unachievable"](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/) because of how its provisioning worked when those images were built almost a year earlier. The images were the only copy of a state that no script could reproduce. The postmortem doesn't say whether any backup of them existed.

That turned a deletion into permanent data loss. It's the same failure as a hand-configured server whose only full description is the server itself.

## How they fixed it

Travis [rolled forward to the development images](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/) it had available. Builds were running about 90 minutes after the deletion, and in under two more hours Travis had cleared the backlog the outage created.

The fallout lasted much longer. The new images carried software nine months newer than the old ones. That helped some users and broke builds for many others. For example, the first version of the new VMs [shipped without docker-compose](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/), even though running Docker inside the VM was one of the main reasons users chose the GCE setup. Support email spiked. Travis paused feature development for more than a week and put every developer on customer support, apart from urgent fixes and image updates. The IDB summary describes the engineering team spending [more than a week fixing issues](https://byu-se.github.io/idb/incidents/34.html) that came up.

## What changed afterwards

Travis listed these measures in the [postmortem](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/):

- **Reproducible image provisioning**, so an exact image can be rebuilt if deleted. Travis found this faster than restoring from backup.
- **More frequent image updates**, since nine months between updates was what made the forced jump so painful.
- **Checks against deleting production images** in multiple places.
- **Automated tests for VM images**, checking that expected software is installed and set up.
- **Automatic cleanup disabled.** For now, no automatic image cleanup runs.
- **A unified image release process**, with better communication to users and a way to opt in to early updates.
- **A new on-call schedule** from 24 October with documented incident procedures, shaped heavily by this incident.

## The rule

If a job deletes things that aren't on a list, the job has to prove the list is complete before it deletes anything. Paginate to the end or fail. Check that the count you got matches the count the source reports. Refuse to run if the deletion set is bigger than a sane fraction of the total. And mark production resources as protected explicitly, so it isn't left to "it happens to be on the list."

The second lesson is about irreplaceable artifacts. If something can't be rebuilt from code, every deletion of it is permanent. Make important artifacts reproducible, or back them up, before any automated process is allowed to delete them.

## Sources

- [Travis CI, "The day we deleted our VM images", Konstantin Haase, 30 Sep 2016 (archived)](https://web.archive.org/web/20221220114914/https://blog.travis-ci.com/2016-09-30-the-day-we-deleted-our-vm-images/): Travis CI's official postmortem, covering the platform background, the cleanup service and its 100-name limit, recovery and countermeasures.
- [Incident Database (BYU), incident #34](https://byu-se.github.io/idb/incidents/34.html): a structured summary of the incident, including the sequence of cleanup being disabled while images were created, and the root cause as a query limit of 100.
