---
title: "Three bugs in Facebook’s “View As” put other people’s access tokens in the page HTML"
dek: "A view-only preview still showed a birthday-post composer, its video uploader minted a full mobile-app token, and that token belonged to the person being previewed. Attackers chained it from friend to friend and stole tokens for about 30 million accounts."
date: 2018-09-25
company: Meta
kind: security-breach
topics: [auth, security, data-leak, software-bug]
stack: [access-tokens, web]
impact: "Attackers stole access tokens for about 30 million Facebook accounts; Facebook reset tokens for almost 50 million affected accounts plus 40 million more as a precaution."
detected_by: engineers
rule: "An impersonation or preview mode must be enforced at the server, not by hiding buttons. Any code path that runs inside it must act as the viewer, never as the person being viewed, and must never mint credentials."
postmortem: https://about.fb.com/news/2018/09/security-update/
sources: [https://about.fb.com/news/2018/09/security-update/, https://about.fb.com/news/2018/10/update-on-security-issue/]
---

# Three bugs in Facebook’s “View As” put other people’s access tokens in the page HTML

On 28 September 2018 Facebook announced that its engineering team had discovered, on the afternoon of Tuesday 25 September, [a security issue affecting almost 50 million accounts](https://about.fb.com/news/2018/09/security-update/). Attackers had exploited a vulnerability in "View As", the feature that shows you what your own profile looks like to someone else, and used it to steal access tokens they could use to take over accounts.

Facebook reset tokens for the almost 50 million affected accounts and, as a precaution, [another 40 million accounts](https://about.fb.com/news/2018/09/security-update/) that had been subject to a View As look-up in the past year. About 90 million people had to log back in to Facebook and any apps that used Facebook Login.

Two weeks later, Facebook revised the number down: of the 50 million, [about 30 million actually had their tokens stolen](https://about.fb.com/news/2018/10/update-on-security-issue/). The vulnerability had existed [between July 2017 and September 2018](https://about.fb.com/news/2018/10/update-on-security-issue/).

No password was cracked and no server was broken into. Three ordinary bugs, each harmless on its own, combined so that a privacy feature handed you someone else's credentials.

## What happened

From Facebook's [first statement](https://about.fb.com/news/2018/09/security-update/), its [technical details](https://about.fb.com/news/2018/09/security-update/) and its [October update](https://about.fb.com/news/2018/10/update-on-security-issue/):

1. **July 2017.** Facebook shipped a new version of its video uploader. This change ["impacted 'View As'"](https://about.fb.com/news/2018/09/security-update/) and is where the vulnerability began.
2. **14 September 2018.** Facebook saw [an unusual spike of activity](https://about.fb.com/news/2018/10/update-on-security-issue/) and started an investigation.
3. **25 September 2018.** Facebook determined it was an attack and identified the vulnerability.
4. **Within two days**, per the October update, Facebook [closed the vulnerability, stopped the attack and reset access tokens](https://about.fb.com/news/2018/10/update-on-security-issue/) for people potentially exposed. It turned off View As and informed law enforcement.
5. **12 October 2018.** Facebook published its findings on scale: about 30 million tokens stolen, and what data was accessed.

## What the engineers believed

The design premise of View As is in Facebook's own description: it ["should be a view-only interface"](https://about.fb.com/news/2018/09/security-update/). You look at your own profile rendered with a friend's permissions, so you can check your privacy settings. Nothing in it should let you act.

As interpretation: features like this are often built by rendering the real page in a special mode and then removing or disabling the interactive parts. The assumption is that if every action is removed, the mode is safe. That works only if every component on the page knows it's in the mode, including components added later by other teams. The video uploader was changed a year after View As existed, and nobody connected the two.

## What was actually going on

### What an access token is

Facebook's explanation: access tokens are ["the equivalent of digital keys that keep people logged in to Facebook"](https://about.fb.com/news/2018/09/security-update/) so they don't have to re-enter their password every time.

Background: a token is a bearer credential. Whoever presents it is treated as the account it was issued for, with whatever permissions it carries. It doesn't need the password, and changing the password doesn't necessarily invalidate existing tokens. That's why Facebook's fix was to reset tokens, and why it said [there was no need for anyone to change their passwords](https://about.fb.com/news/2018/09/security-update/).

### The three bugs

Facebook's VP of Engineering for Security and Privacy, Pedro Canahuati, described [three distinct bugs](https://about.fb.com/news/2018/09/security-update/):

**Bug 1: an action survived in a view-only mode.** View As removed composers (the boxes for posting content), but not all of them. The version that lets people wish friends a happy birthday stayed, and View As ["incorrectly provided the opportunity to post a video"](https://about.fb.com/news/2018/09/security-update/).

**Bug 2: the uploader minted an over-powered token.** The new video uploader introduced in July 2017 ["incorrectly generated an access token that had the permissions of the Facebook mobile app"](https://about.fb.com/news/2018/09/security-update/). That is a token with broad rights, not one scoped to uploading a video.

**Bug 3: the token was for the wrong person.** When the uploader appeared inside View As, it generated the token ["not for you as the viewer, but for the user that you were looking up"](https://about.fb.com/news/2018/09/security-update/).

Put together: you open View As to see your profile as a friend sees it. The page still includes the birthday composer. The composer includes the video uploader. The uploader generates a mobile-app-level token for the friend. And that token ends up [in the HTML of the page](https://about.fb.com/news/2018/09/security-update/), where the attackers could extract it and log in as the friend.

```diagram
title: how View As leaked tokens
flow: View As as friend -> birthday composer -> video uploader
flow!: mints app token -> for the friend -> token in page HTML
note: three bugs, each harmless alone
```

As interpretation, bug 3 is the deepest one. Inside View As, the page renders with the identity of the person being looked up, which is the point of the feature: it's showing you what they would see. Any component that asks "who is the current user?" to decide whose token to create will get the wrong answer. A rendering context that deliberately borrows another identity is exactly where code that issues credentials must not run.

### Why one token became millions

A token for one friend lets you log in as that friend, and then use View As again, on their friends. Facebook says the attackers ["had to pivot from that account to others to steal more tokens"](https://about.fb.com/news/2018/09/security-update/).

The October update gives the mechanics. The attackers already controlled a set of accounts connected to Facebook friends. They used [an automated technique to move from account to account](https://about.fb.com/news/2018/10/update-on-security-issue/), stealing tokens for friends, then friends of friends, totaling about 400,000 people. That step also loaded those 400,000 people's profiles as they would see them, including timeline posts, friend lists, groups and the names of recent Messenger conversations. Message content wasn't exposed, with one exception for Page admins whose Page had received a message.

From a portion of those 400,000 people's friend lists, the attackers stole tokens for [about 30 million people](https://about.fb.com/news/2018/10/update-on-security-issue/). What they accessed varied:

| People | What attackers accessed |
|---|---|
| [15 million](https://about.fb.com/news/2018/10/update-on-security-issue/) | Name and contact details (phone, email or both) |
| [14 million](https://about.fb.com/news/2018/10/update-on-security-issue/) | The same, plus profile details such as username, gender, relationship status, religion, hometown, birthdate, device types, education, work, last 10 check-ins, people or Pages followed and the 15 most recent searches |
| [1 million](https://about.fb.com/news/2018/10/update-on-security-issue/) | No information accessed |

The social graph turned a per-account bug into a worm. Each stolen token exposed a new friend list, and each friend list was a new set of targets.

### The numbers changed

The two Facebook statements give different figures, and the difference is in what's being counted. The September statement counted [almost 50 million accounts](https://about.fb.com/news/2018/09/security-update/) whose tokens Facebook believed were affected and reset. The October update says ["fewer people were impacted than we originally thought"](https://about.fb.com/news/2018/10/update-on-security-issue/) and gives about 30 million whose tokens were actually stolen. The October update also says Facebook had [not ruled out smaller-scale attacks](https://about.fb.com/news/2018/10/update-on-security-issue/).

## How they fixed it

Facebook [fixed the vulnerability](https://about.fb.com/news/2018/09/security-update/), reset access tokens for the almost 50 million affected accounts and 40 million more that had been through a View As look-up in the past year, and turned off View As for a security review. People who logged back in saw a notification at the top of News Feed. In October, Facebook said it would send customized messages to the 30 million people affected explaining what [might have been accessed](https://about.fb.com/news/2018/10/update-on-security-issue/).

Facebook said the attack [did not include](https://about.fb.com/news/2018/10/update-on-security-issue/) Messenger, Messenger Kids, Instagram, WhatsApp, Oculus, Workplace, Pages, payments, third-party apps, or advertising or developer accounts. It was cooperating with the FBI, which asked Facebook not to discuss who may be behind the attack.

## What changed afterwards

The sources say little about engineering changes beyond the fix. One concrete outcome is in an update added to the September post: on [14 May 2019](https://about.fb.com/news/2018/09/security-update/), Facebook completed its security review and re-enabled only the version of View As that shows your profile to people who aren't your friends. That version had been unaffected and was more popular than "View as Specific Person", the mode that let you pick a particular friend. As interpretation, that's the mode that had to borrow a specific person's identity, and it's the one that didn't come back in that update.

## The rule

A preview or impersonation mode is a security boundary and has to be enforced on the server: requests made from inside it should be refused, not just hidden in the UI. Code that issues credentials should take the identity from the authenticated session, never from the rendering context, and should issue the narrowest token the task needs. And never put a bearer token in page HTML; anything in the page belongs to whoever can read the page.

## Sources

- [Facebook, "Security Update" (Guy Rosen, with Additional Technical Details by Pedro Canahuati)](https://about.fb.com/news/2018/09/security-update/): Facebook's 28 September 2018 announcement, the explanation of the three bugs, the token resets and the May 2019 update on View As.
- [Facebook, "An Update on the Security Issue" (Guy Rosen)](https://about.fb.com/news/2018/10/update-on-security-issue/): Facebook's 12 October 2018 update with detection dates, the attack technique, the revised 30 million figure and the data accessed.
