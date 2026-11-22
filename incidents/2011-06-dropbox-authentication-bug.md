---
title: "A Dropbox code update let some accounts be accessed without the right password"
dek: "A code update broke Dropbox's authentication check. From 1:54pm to 5:46pm Pacific, logins could succeed without the correct password, and the only fix for sessions already open was to end all of them."
belief: "A Dropbox code update broke a login check. Accounts could be opened without the right password."
date: 2011-06-19
company: Dropbox
kind: security-breach
topics: [auth, deploy, security, software-bug]
stack: [web]
impact: "Fewer than a hundred accounts were likely compromised; Dropbox said no account settings or files were modified in them."
rule: "Authentication has to fail closed and be tested negatively: every deploy should prove that a wrong password is still rejected, not only that a right one is accepted."
postmortem: https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/
sources: [https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/, https://web.archive.org/web/2011/http://blog.dropbox.com/index.php/yesterdays-authentication-bug/]
---

# A Dropbox code update let some accounts be accessed without the right password

On June 19, 2011, Dropbox shipped a code update at [1:54pm Pacific time](https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/). It contained a bug in the authentication mechanism. For the next few hours, some people could log into a Dropbox account without the correct password.

Dropbox found the problem at 5:41pm and had a fix live at [5:46pm](https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/). As a precaution, it ended every logged-in session. In a later update it said that, according to its records, [fewer than a hundred](https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/) users' accounts had likely been compromised, and that no settings or files had been changed in them.

Dropbox's public write-up is short, and it never says what the bug was. So this post does two separate things. It reports exactly what Dropbox said. And it explains, clearly labeled as general background, the ways a password check can end up failing *open* and why that's the worst way for it to fail.

## What happened

The post, signed by [Arash Ferdowsi](https://web.archive.org/web/2011/http://blog.dropbox.com/index.php/yesterdays-authentication-bug/) and dated June 20, 2011, plus its updates:

| When (as the post labels it) | What |
| --- | --- |
| June 19, 1:54pm | Code update deployed. It introduced a bug "[affecting our authentication mechanism](https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/)" |
| June 19, 5:41pm | Bug discovered |
| June 19, 5:46pm | Fix live. All logged-in sessions ended |
| Mon 10:46pm | Update: reviewing logs, aiming to notify users who logged in during the window |
| Tue 2:49am | Update: accounts that logged in during the window [emailed with activity details](https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/) |
| Fri 1:59pm | Update: emails sent to users whose accounts were likely compromised. Fewer than a hundred. No settings or files modified |

The post says [much less than 1 percent](https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/) of users logged in during the window, "some of whom could have logged into an account without the correct password."

Ferdowsi's own judgment is the line most worth quoting: "[This should never have happened.](https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/)"

## What the engineers believed

Dropbox doesn't describe its pre-deploy checks, so this section is interpretation. The incident itself shows what someone assumed: that a change touching, or near, the login path was safe to ship. Some test or review had to pass for the update to go out, and whatever it checked, it didn't check that a *wrong* password was still rejected.

That gap is common, and it's built into how most of us test. A login test usually says: create a user, log in with the right password, assert success. That test passes whether the check is correct or missing. Logging in with the correct password works either way. A broken password check doesn't break anything a normal user would notice, and every real user still gets in. The only people who see a difference are the ones typing the *wrong* password, and they don't file bug reports.

That explains the shape of the timeline. A bug that makes logins *fail* gets reported in minutes. A bug that makes logins *succeed too often* is invisible to normal monitoring. Dropbox's went unnoticed from the [1:54pm deploy until 5:41pm](https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/).

## What was actually going on

Dropbox hasn't published the cause. What follows is a catalog of the general ways authentication code fails open. It is not a claim about which one Dropbox hit.

### Shape 1: the check that returns the wrong thing on error

```js
async function checkPassword (user, password) {
  try {
    return await verifyHash(user.passwordHash, password)
  } catch (err) {
    log(err)
    // falls through: returns undefined
  }
}

if (await checkPassword(user, pw) === false) reject()
```

`undefined` is not `false`, so an error inside the check lets the login through. The fix is to make success the only explicit path, so that every other outcome is a rejection:

```js
if ((await checkPassword(user, pw)) !== true) reject()
```

### Shape 2: a flag or default changed

Login code often has escape hatches: an "authentication disabled" flag for local development, a test-mode bypass, an admin "log in as user" feature. If a deploy flips a default, or ships a config where the dev flag is on, the bypass is now in production. Nothing about the password logic itself changed, so a diff review of the auth code finds nothing.

### Shape 3: a refactor that drops the comparison

A refactor that moves the password check into middleware, or splits one function into two, can leave a path where the comparison never runs: an early `return` on a new code branch, or a route that's no longer covered by the middleware. Each piece looks right when you review it alone.

### Why it's worse than an outage

All three shapes share one property: **the system keeps working.** Uptime checks pass. Error rates don't move. Login success rate, if anything, goes *up*. Every signal operations teams normally watch reports "healthy" while the property that matters most is gone.

```diagram
title: what each test sees when the check fails open
flow: right password -> login succeeds -> test passes
flow!: wrong password -> login succeeds -> nobody asserted this
note: only a negative test can catch a fail-open bug
```

### Why ending every session was required

Once a session token has been issued, the password isn't checked again; the token *is* the authentication from then on. So fixing the password check at 5:46pm closed the door for new logins but did nothing about sessions already opened through it. Dropbox [ended all logged in sessions](https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/), forcing everyone to authenticate again under the fixed code. That's the only safe move when you can't tell which sessions were legitimate. It's also a reason to make sure you *can* revoke all sessions centrally and quickly, which isn't a given with long-lived self-contained tokens.

## How they fixed it

From the post: Dropbox [made a fix live at 5:46pm, after discovering the bug at 5:41pm](https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/), ended all sessions, and then went through logs to find accounts that might have been improperly accessed. Users who had logged in during the window were emailed with activity details. Those whose accounts were likely compromised got a separate email, and according to Dropbox's records there were fewer than a hundred of them.

## What changed afterwards

The post commits only in general terms: "[We are scrutinizing our controls and we will be implementing additional safeguards to prevent this from happening again.](https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/)" The sources don't say what those safeguards were, so this post doesn't name any.

What the incident argues for, as interpretation:

- **Negative tests as deploy gates.** Before and after every deploy, a synthetic check logs in with a wrong password and fails the deploy if it succeeds.
- **Monitor the reject rate.** A login system normally rejects some share of attempts. If failed logins suddenly drop to near zero, alert on it.
- **Fail closed in code.** Authentication functions return an explicit allow. Errors, nulls and exceptions all mean deny.
- **Fast global session revocation**, rehearsed before you need it.

## The rule

Authentication bugs that let people in don't page anyone, because no real user is harmed in a way they'd notice. So test the "no" path as hard as the "yes" path: on every deploy, assert that a wrong password is rejected, and alert when the system stops rejecting logins. An auth check that only ever gets tested with the right password hasn't really been tested.

## Sources

- [Dropbox Blog: "Yesterday's Authentication Bug" (June 20, 2011, with updates), via the Internet Archive, 2012 snapshot](https://web.archive.org/web/20121221113726/https://blog.dropbox.com/2011/06/yesterdays-authentication-bug/). Dropbox's statement: deploy and fix times, the session reset, notification updates and the "fewer than a hundred" figure.
- [Dropbox Blog: same post, via the Internet Archive, 2011 snapshot](https://web.archive.org/web/2011/http://blog.dropbox.com/index.php/yesterdays-authentication-bug/). Earlier copy that shows the author (Arash Ferdowsi) and the June 20, 2011 posting date.
