---
title: "A storage update emptied Gmail inboxes, and tape backups brought them back"
dek: "A bug in a storage software update deleted copies of mail for 0.02% of Gmail users across Google's replicated copies. The copy that survived was the offline one, on tape."
date: 2011-02-27
company: Google
kind: data-loss
topics: [storage, replication, backup, deploy]
stack: [gmail, tape]
impact: "0.02% of Gmail users temporarily lost access to their email; mail sent to them during the incident window was likely bounced."
rule: "Replication protects you from losing a machine, not from bad software. You need a copy that the software writing your data cannot reach."
postmortem: https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html
sources: [https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html]
---

# A storage update emptied Gmail inboxes, and tape backups brought them back

On February 27, 2011, some Gmail users logged in and found their accounts empty. Google's post the next day opens with that scene: "[Imagine the sinking feeling of logging in to your Gmail account and finding it empty.](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html)"

It affected [0.02% of Gmail users](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html). That's a tiny fraction, but Gmail is very large. Google's post doesn't give an absolute number, so this one doesn't either. The cause was a storage software update with a bug that deleted copies of mail. Google keeps multiple copies in multiple data centers, and the bug affected several of them.

The data was recovered because Google kept one more copy that the bug could not reach: tapes, sitting offline. Restoring from tape took days, not milliseconds. But in Google's words, "[email was never lost](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html)."

## What happened

Google's account, from the post by Ben Treynor, VP Engineering and "Site Reliability Czar":

- Google [released a storage software update that introduced the unexpected bug](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html). It caused 0.02% of users to temporarily lose access to their email.
- "[Some copies of mail were deleted](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html)." The post explains that "in some rare instances software bugs can affect several copies of the data. That's what happened here."
- When the problem was found, Google [immediately stopped the deployment of the new software and reverted to the old version](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html).
- For affected users, mail sent to them [between 6:00 PM PST on February 27 and 2:00 PM PST on February 28](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html) was likely not delivered, and the senders would have received a non-delivery notification.

Recovery took several days, according to the updates appended to the post:

| When (PST) | Status |
| --- | --- |
| Feb 28 | Access restored for "many" affected users. The team had been working [over the last 30 hours](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html) |
| Mar 1, 12:20 PM | Data for the [remaining 0.012% of affected users](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html) restored from tape and being processed; moving it into mailboxes was to start in 2 hours |
| Mar 2, 10:55 PM | Gmail [back to normal for the vast majority](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html) of affected people |

## What the engineers believed

The post sets up the expected objection itself: "[how could this happen if we have multiple copies of your data, in multiple data centers?](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html)"

That question is the belief this incident tests: **more replicas means more safety.** Users believe it, and most engineers do too, because replication is how we survive disks failing, machines dying and data centers losing power. Google ran mail with copies in multiple data centers precisely so that losing any one copy would be invisible.

But replication guards against *independent* failures. A disk dying in one data center tells you nothing about a disk in another. A software bug isn't independent. It's the same code running everywhere.

## What was actually going on

Google didn't publish the bug's details here. It promised a detailed incident report on the Apps Status Dashboard, which isn't among the sources for this post. So the mechanism below is general background on why replicated storage can lose data, not a claim about Google's code.

### Replicas share a writer

In a replicated store, every copy is kept in sync by the same software. That's the point: if the primary applies a write, the replicas apply it too. The system can't tell a write you meant from one you didn't. Replication copies *correct* changes and *incorrect* changes with the same speed and reliability.

So a bug in the storage layer that deletes or overwrites data has two ways to reach several copies:

1. **It's replicated.** The bug produces a delete on one replica, and replication dutifully applies that delete everywhere.
2. **It's deployed everywhere.** The buggy software runs on every replica and makes the same mistake independently on each.

Either way, replica count doesn't help. Google's post says a storage *software update* introduced the bug, and that it affected "several copies of the data," which fits the shape of the second path, though the post doesn't say which path, or whether both applied.

```diagram
title: what each kind of copy protects against
flow: disk/machine dies -> other replicas fine -> no user impact
flow!: storage bug ships -> replicas share code -> copies deleted
flow: offline tape -> bug can't reach it -> mail restored
note: replicas share software; the tape didn't
```

### Why the deploy was the blast radius

Note the order of recovery steps in the post: first *stop the deployment*, then *revert*. That suggests the update was still rolling out when the problem was found. Google doesn't spell this out. Rolling out storage software in stages is what kept the affected population to 0.02% rather than everyone. A staged rollout limits how many users a bug can reach. It doesn't stop the bug from doing damage to the users it does reach. Only a copy outside the rollout's reach can repair that.

### Why tape

Treynor's explanation is short and exact: "[Since the tapes are offline, they're protected from such software bugs.](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html)"

That's the property that matters, not the medium. A tape in a library is:

- **Not running your storage software.** No deploy reaches it.
- **Not a replication target.** No delete propagates to it.
- **Hard to change by accident.** Overwriting it means a deliberate restore-and-rewrite cycle, not an API call.

The cost is time. Google said restoring from tape "[takes longer than transferring your requests to another data center](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html), which is why it's taken us hours to get the email back instead of milliseconds." The updates show the long tail: data for the last 0.012% came off tape on March 1, then had to be processed and loaded back into mailboxes, and "[accounts with more mail will take more time](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html)." Restoring a large mailbox is a bulk data job, and it can't happen in one request.

### The difference between replication and backup

| | Replica | Offline backup |
| --- | --- | --- |
| Protects against | Hardware loss, data-center loss | Software bugs, operator error, bad deploys, corruption |
| Speed of failover | Milliseconds to seconds | Hours to days |
| Shares code with production | Yes | No |
| Gets your mistakes copied to it | Yes, immediately | Only at the next backup |

You need both. Replication alone is fast and fragile against logic errors. Backups alone are slow but survive almost anything. The Gmail incident is the case where only one of the two did its job.

## How they fixed it

Google [stopped the rollout and reverted](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html) to the previous storage software, which stopped new damage. Then it restored the deleted mail. Many users got access back by February 28. The remaining group, 0.012% of all users, was restored from tape, and by March 2 Gmail was "[back to normal for the vast majority](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html)." Google set up a temporary support alias for anyone still affected.

## What changed afterwards

The post doesn't list changes. It promises "[a detailed incident report](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html)" on the Apps Status Dashboard with the corrective actions. That report isn't among this post's sources, so the specific changes Google made are left out here.

## The rule

Count your copies by what can kill them, not by how many there are. Every replica that runs the same software and receives the same writes counts as one copy against a software bug. Keep at least one copy that your production code and your deploys cannot reach, and practice restoring it. You will only need it on the day every other copy is wrong.

## Sources

- [Official Gmail Blog: "Gmail back soon for everyone" by Ben Treynor (February 28, 2011, with updates on March 1 and March 2)](https://gmail.googleblog.com/2011/02/gmail-back-soon-for-everyone.html). Google's statement: the 0.02% figure, the storage software update bug, the rollback, tape restoration, the mail delivery window and recovery updates.
