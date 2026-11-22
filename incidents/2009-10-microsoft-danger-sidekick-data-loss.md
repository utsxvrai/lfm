---
title: "Sidekick users lost their contacts when Danger's core database and its backup failed together"
dek: "T-Mobile Sidekick data lived in Microsoft-Danger's service. A system failure hit the core database and the backup at once, phones lost personal data, and recovery meant rebuilding the system component by component over more than two weeks."
belief: "Microsoft-Danger counted on a backup of the Sidekick database. The database and the backup failed together."
date: 2009-10-02
company: Microsoft
kind: data-loss
topics: [backup, database]
stack: [sidekick, danger]
impact: "Danger services were interrupted from October 2, 2009; a minority of Sidekick users lost personal data such as contacts, calendar, notes and photos, and contact restoration began October 20."
rule: "A backup that can fail with the primary is not a backup. Verify that each backup can actually be restored, and keep it somewhere the primary's failure can't reach."
postmortem: https://news.microsoft.com/source/2009/10/13/microsoft-statement-on-platform-stability-issues-for-sidekick-customers/
sources: [https://news.microsoft.com/source/2009/10/13/microsoft-statement-on-platform-stability-issues-for-sidekick-customers/, https://web.archive.org/web/20091017094050/http://www.microsoft.com/presspass/press/2009/oct09/10-15sidekick.mspx, https://web.archive.org/web/20091022073008/http://www.microsoft.com/presspass/press/2009/oct09/10-18sidekickupdate.mspx, https://web.archive.org/web/20091023002027/http://www.microsoft.com/presspass/press/2009/oct09/10-20sidekick.mspx]
---

# Sidekick users lost their contacts when Danger's core database and its backup failed together

On Friday, October 2, 2009, the services behind the T-Mobile Sidekick [were interrupted](https://news.microsoft.com/source/2009/10/13/microsoft-statement-on-platform-stability-issues-for-sidekick-customers/). The services were run by Microsoft-Danger, and Sidekick phones depended on them. For more than a week, Microsoft-Danger, T-Mobile and partners worked to restore service and, in Microsoft's words, to "recover Sidekick customers' valuable personal data."

The second half of that sentence is the incident. Some Sidekick users found that their contacts, calendars, notes and photos were gone from their phones. By October 13, Microsoft and T-Mobile were offering a [$100 customer appreciation card](https://news.microsoft.com/source/2009/10/13/microsoft-statement-on-platform-stability-issues-for-sidekick-customers/) to customers who had experienced "a significant and permanent loss of personal content."

Two days later Microsoft announced that it had [recovered most, if not all](https://web.archive.org/web/20091017094050/http://www.microsoft.com/presspass/press/2009/oct09/10-15sidekick.mspx) of the affected data, and gave the cause in one sentence: a system failure that created data loss "in the core database and the back-up."

## What happened

Microsoft published a series of short statements. Taken together, they give this timeline:

- **Friday, October 2:** Danger services are [interrupted](https://news.microsoft.com/source/2009/10/13/microsoft-statement-on-platform-stability-issues-for-sidekick-customers/).
- **The weekend before October 13:** Microsoft-Danger restores services to [virtually every customer](https://news.microsoft.com/source/2009/10/13/microsoft-statement-on-platform-stability-issues-for-sidekick-customers/) (the October 13 statement says "this past weekend").
- **October 13:** Microsoft says recent efforts indicate that [recovering some lost content may now be possible](https://news.microsoft.com/source/2009/10/13/microsoft-statement-on-platform-stability-issues-for-sidekick-customers/). T-Mobile announces the $100 card for customers with significant and permanent loss, on top of a free month of data service already given.
- **October 15:** Roz Ho, Corporate Vice President, Premium Mobile Experiences at Microsoft, says the company has [recovered most, if not all](https://web.archive.org/web/20091017094050/http://www.microsoft.com/presspass/press/2009/oct09/10-15sidekick.mspx) customer data for affected users, that data loss affected a minority of users, and names the cause.
- **October 18:** Restoration is still being tested. Microsoft hopes to [begin restoring personal contacts that week](https://web.archive.org/web/20091022073008/http://www.microsoft.com/presspass/press/2009/oct09/10-18sidekickupdate.mspx), with photographs, notes, to-do lists, marketplace data and high scores to follow.
- **October 20:** The first phase opens. A recovery tool on the My T-Mobile website lets users [view the contacts they had as of October 1](https://web.archive.org/web/20091023002027/http://www.microsoft.com/presspass/press/2009/oct09/10-20sidekick.mspx) and restore them to their Sidekick.

### The statements changed as the picture changed

These sources are a live record, and they shift. On October 13 the language was cautious: recovery "may now be possible", and T-Mobile was compensating people for *permanent* loss. On October 15 Microsoft said it had recovered most, if not all, of the data, and that it now believed the loss [affected a minority of Sidekick users](https://web.archive.org/web/20091017094050/http://www.microsoft.com/presspass/press/2009/oct09/10-15sidekick.mspx). None of the statements give a count of affected users.

## What the engineers believed

None of the statements describe the design of Danger's storage, so this section is about the belief that the outcome reveals.

Every system that holds user data has, somewhere in its design, a sentence like: "if the database fails, we restore from backup." That sentence is the reason the primary database is allowed to be a single important thing. It is also usually tested less than anything else in the system, because restoring from backup is what you do on the worst day, and most days are not that day.

Microsoft's own description of the cause, data loss [in the core database and the back-up](https://web.archive.org/web/20091017094050/http://www.microsoft.com/presspass/press/2009/oct09/10-15sidekick.mspx), says that sentence was not true for Sidekick in October 2009. The backup did not survive the failure it existed to survive.

## What was actually going on

### The phone was not where the data lived

Microsoft's statements imply a design detail that explains why a server problem became a loss on people's phones. The restoration effort was needed for customers [who lost data from their Sidekick devices](https://web.archive.org/web/20091022073008/http://www.microsoft.com/presspass/press/2009/oct09/10-18sidekickupdate.mspx), and the recovery tool, run from the My T-Mobile website rather than the phone, showed users the contacts they had "on your device as of October 1".

Reading those together, and this is interpretation, the authoritative copy of a Sidekick user's personal data was held by the Danger service, and the phone kept a synchronised copy. That's a common and generally sensible model. Users can lose or replace their phone and their data follows them. The service is the source of truth; the device is a view.

The cost of that model is that the device trusts the service. If the service's copy is lost or damaged, a phone that synchronises with it can end up losing its own copy too. A phone that held its own independent copy would have been unaffected by a server failure. A phone that mirrors the server mirrors the server's loss.

```diagram
title: why a server failure emptied phones
flow!: server copy lost -> phones sync to it -> data gone on phone
flow: backup survives -> restore server copy -> phones sync back
note: the service was the source of truth; the phone mirrored it
```

### Why "the database and the backup" is the important phrase

The 15 October statement doesn't say how one failure reached both. Here is general background on how that usually happens, which is not a claim about Danger's specific setup.

A backup protects you from a failure only if that failure can't reach it. Backups fail together with the primary in a few common ways:

- **Shared infrastructure.** The backup lives on the same storage system, or is managed by the same process, as the primary. A failure in that layer takes out both.
- **Replicated damage.** The backup is a copy that is kept continuously in sync, so corruption in the primary is faithfully copied into it. Replication protects against a machine dying, not against bad data.
- **Unverified backups.** The backup job has been "succeeding" for months, but nobody has restored from it, and when it's needed it turns out to be incomplete or unreadable.

Microsoft's follow-up action points at the last of these. It said it had initiated a more resilient backup process [to ensure that the integrity of our database backups is maintained](https://web.archive.org/web/20091017094050/http://www.microsoft.com/presspass/press/2009/oct09/10-15sidekick.mspx). Integrity is the operative word: the problem being fixed was not only whether backups existed, but whether they were intact.

### Why recovery took weeks, not hours

If a clean backup had existed, recovery would have been a restore. Instead, Microsoft said it [rebuilt the system component by component, recovering data along the way](https://web.archive.org/web/20091017094050/http://www.microsoft.com/presspass/press/2009/oct09/10-15sidekick.mspx), and that this careful process took a significant amount of time but was needed to preserve data integrity.

The restore itself had its own problem: users had kept living. Between October 1 and the restore, many had re-entered contacts by hand. Simply overwriting the phone with the October 1 data would have thrown away those new entries. The October 20 tool handled this explicitly: users who had recreated contacts could [keep both sets, merge them, or keep only what was on the device](https://web.archive.org/web/20091023002027/http://www.microsoft.com/presspass/press/2009/oct09/10-20sidekick.mspx). Any restore that lands after users have started writing again is a merge problem, not a copy.

## How they fixed it

In three stages, according to Microsoft's statements:

1. **Restore service.** By the weekend before October 13, services were back for [virtually every customer](https://news.microsoft.com/source/2009/10/13/microsoft-statement-on-platform-stability-issues-for-sidekick-customers/).
2. **Recover the data.** Rebuild the system component by component, recovering data along the way, then validate the data and the restoration plan [before restoring anything](https://web.archive.org/web/20091017094050/http://www.microsoft.com/presspass/press/2009/oct09/10-15sidekick.mspx).
3. **Restore to devices in phases.** Personal contacts first, through a self-service tool, from [October 20](https://web.archive.org/web/20091023002027/http://www.microsoft.com/presspass/press/2009/oct09/10-20sidekick.mspx); photographs, notes, to-do lists, marketplace data and high scores afterwards.

## What changed afterwards

Roz Ho's statement lists two changes: changes to [improve the overall stability of the Sidekick service](https://web.archive.org/web/20091017094050/http://www.microsoft.com/presspass/press/2009/oct09/10-15sidekick.mspx), and a more resilient backup process to maintain the integrity of database backups. Neither is described in more detail, and there is no fuller technical postmortem among these sources.

## The rule

A backup is only a backup if two things are true: the failure you're protecting against can't reach it, and you have proved you can restore from it. Keep backups on separate infrastructure, keep point-in-time copies rather than only live replicas, and run restores on a schedule. If your clients mirror your server, remember that a server-side loss is also a client-side loss, and plan the restore as a merge with whatever users did in the meantime.

## Sources

- [Microsoft, "Microsoft Statement on Platform Stability Issues for Sidekick Customers" (October 13, 2009)](https://news.microsoft.com/source/2009/10/13/microsoft-statement-on-platform-stability-issues-for-sidekick-customers/). Service interruption date, service restoration, the $100 appreciation card and the first signs that recovery might be possible.
- [Microsoft, "Microsoft Confirms Data Recovery for Sidekick Users" by Roz Ho (October 15, 2009, via the Internet Archive)](https://web.archive.org/web/20091017094050/http://www.microsoft.com/presspass/press/2009/oct09/10-15sidekick.mspx). The cause (data loss in the core database and the back-up), the component-by-component rebuild, scope, and follow-up changes.
- [Microsoft, "Microsoft Update on Sidekick Data Restoration: October 18, 2009" (via the Internet Archive)](https://web.archive.org/web/20091022073008/http://www.microsoft.com/presspass/press/2009/oct09/10-18sidekickupdate.mspx). Restoration ordering: contacts first, other content after.
- [Microsoft, "Microsoft Update on Sidekick Data Restoration: October 20, 2009" (via the Internet Archive)](https://web.archive.org/web/20091023002027/http://www.microsoft.com/presspass/press/2009/oct09/10-20sidekick.mspx). The contact recovery tool on My T-Mobile and its keep/merge options.
