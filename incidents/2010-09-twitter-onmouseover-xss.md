---
title: "Twitter's onMouseOver worm: a patched XSS bug came back with a site update"
dek: "JavaScript typed into a tweet ran in the browsers of people who hovered over it. Twitter had fixed the bug the month before, and an unrelated site update brought it back."
belief: "Twitter thought its XSS bug was fixed. An unrelated site update brought it back as a worm."
date: 2010-09-21
company: Twitter
kind: security-breach
topics: [security, software-bug, deploy]
stack: [javascript, html, web]
impact: "Exploit tweets on Twitter.com changed colors, opened pop-ups and made viewers retweet them without their knowledge; Twitter said account information was not compromised."
rule: "A fixed security bug needs a test that would fail if the bug came back. Otherwise the next refactor of that code path can quietly undo the fix."
postmortem: https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html
sources: [https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html]
---

# Twitter's onMouseOver worm: a patched XSS bug came back with a site update

On the morning of September 21, 2010, some tweets on Twitter.com started doing things tweets can't normally do. They changed color. Hovering over a link in them opened a pop-up box. Then some started retweeting themselves: anyone who moved the mouse over one sent it on to all of their own followers without knowing it.

Twitter says it [was notified of the exploit at 2:54 am PDT](https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html), about half an hour after it first appeared. The main issue was fixed [by 7:00 am PDT](https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html), and a smaller related issue in hovercards was fixed by 9:15 am PDT.

What makes this incident worth studying is one sentence in Twitter's write-up: "[We discovered and patched this issue last month.](https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html)" The bug had already been fixed. A later deploy brought it back.

## What happened

Twitter's post is short, and it is the only source here, so this account stays close to it.

The cause was [cross-site scripting (XSS)](https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html). In Twitter's words, "users submitted javascript code as plain text into a Tweet that could be executed in the browser of another user."

The order of events, as Twitter tells it:

1. A user noticed the hole and used it on Twitter.com.
2. Someone created an account whose tweets turned different colors and showed a pop-up when a reader hovered over a link in the tweet. That's where the "onMouseOver" name comes from.
3. Other users went further and [added code that caused people to retweet the original Tweet without their knowledge](https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html).

The exploit [affected Twitter.com only](https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html), not the mobile site or mobile apps. Twitter said most uses fell into "prank or promotional categories," that it was not aware of harm to computers or accounts, and that passwords did not need to be changed because account information was not compromised.

## What the engineers believed

Twitter believed the bug was gone, and with good reason: they had found it and patched it a month earlier. The post says the regression came from "[a recent site update (unrelated to new Twitter)](https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html)" that "unknowingly resurfaced it."

That is the assumption worth looking at: *once a security bug is fixed, it stays fixed.* Ordinary bugs tend to make themselves known when they return, because something breaks and someone notices. An escaping bug doesn't. Pages render fine and tests that check rendering still pass. Nothing looks wrong until someone writes a tweet designed to exploit it.

## What was actually going on

Twitter didn't publish the exact input or the code path, so what follows is the general mechanism of stored XSS. It is not a reconstruction of Twitter's code.

### Stored XSS in one paragraph

A tweet is untrusted text. When the server builds the HTML for a timeline, it pastes that text into a page that also holds the site's own markup and scripts. The browser can't tell which bytes came from Twitter's templates and which came from a user. It parses all of it as one document. If user text can close an attribute or open a tag, the user is now writing Twitter's HTML. If they can write an attribute like `onmouseover="..."`, they are writing Twitter's JavaScript, and it runs with full access to the logged-in viewer's session on twitter.com.

That's why the payload could retweet. The script ran on twitter.com, in the viewer's session, so any request it sent went out as the viewer. The browser's same-origin policy, which normally stops other sites from acting as you, gave it no protection, because the code was running on Twitter's own origin.

### Why "a link in a tweet" is a hard place to escape

Twitter's post says the exploit fired "[when someone moused over a link](https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html)." Links are a common place for this, and the reason is general.

Plain tweet text just needs HTML-escaping: turn `<`, `>`, `&`, `"` and `'` into entities and nothing the user types can become markup. But the site doesn't show tweets as plain text. It finds URLs in the text and wraps them in `<a href="...">` tags. That means:

- Part of the user's text goes into an **attribute value** (`href`), where the characters that matter are different. An unescaped `"` ends the attribute.
- The code that decides "this is a URL" runs on *raw* text, before escaping, or on *escaped* text, after it. Each order has its own edge cases.
- The final string is built from pieces: some user-controlled, some template, some escaped, some not. It's easy to escape the pieces correctly one at a time and still get the assembly wrong.

Here's a toy example of the class of bug. Suppose a linkifier matches `http://\S+` and drops the match into `<a href="$match">`. A tweet containing `http://x.com/"onmouseover="alert(1)` produces `<a href="http://x.com/" onmouseover="alert(1)">`. Escape the whole string first, then linkify, and the `"` becomes `&quot;`, which is safe. Linkify first and escape only the link text, and it isn't. Two orderings that look equivalent behave differently.

```diagram
title: one quote character in a URL
flow: tweet text -> escape then linkify -> inert link
flow!: tweet text -> linkify then escape -> attribute breaks out
note: same input, different order of operations
```

### How a fix gets undone

The details of the "recent site update" aren't public. In general, though, an escaping fix lives in one place in the code: one call to an escape function, at one stage of one pipeline. Common ways it gets lost:

- Someone **rewrites the formatter**, for example a new linkifier or a new template, and the replacement doesn't have the fix.
- An **old branch gets merged**, or an older copy of a helper gets reinstated.
- A **second rendering path** is added, a different view or widget, that calls the formatting code without going through the patched function.

Twitter's post hints at the last pattern without proving it: after the main fix, there was "[a more minor but related issue tied to hovercards](https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html)" that needed a separate fix two hours later. When the same untrusted string is rendered in more than one place, each place is its own chance to get the escaping wrong.

### Why the retweet part matters

Showing a pop-up is a prank. Making the viewer repost the payload makes it spread on its own. Each infected tweet put the exploit in front of the infected user's followers, and each of them who hovered passed it on. A stored XSS on a social feed spreads without any further action by the attacker, because the feed delivers the payload for them. That's why a hole like this needs a fix within hours, not in the next release.

## How they fixed it

Twitter says it "[immediately went to work](https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html)" after being notified at 2:54 am PDT. The primary issue was solved by 7:00 am, and the related hovercard issue by 9:15 am. The post doesn't describe the code change.

For users, Twitter said strange retweets left by the exploit might still show up in timelines, and that there was [no need to change passwords](https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html).

## What changed afterwards

The post commits only to a general direction: being focused "[not only ... on quickly resolving exploits when they surface but also on identifying possible vulnerabilities beforehand](https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html)." It doesn't list specific process or code changes, so this post doesn't make any up.

Here is what the pattern calls for in general, labeled as interpretation:

- **Turn the original exploit into a regression test.** The payload from the first report is the best possible test case. If it runs in CI against every rendering path, the "site update" that resurfaced the bug fails the build instead of reaching production.
- **Escape by default, at output.** Use templates that escape everything unless a value is explicitly marked as safe. Then forgetting to escape becomes impossible rather than likely.
- **Contextual escaping.** HTML body text, attribute values, URLs and JavaScript strings each need different encoding. Use helpers built for each context instead of one `escape()` for all of them.
- **Defense in depth in the browser.** A Content Security Policy that blocks inline event handlers would make an `onmouseover=` attribute inert even if it got into the page. (CSP was still new in 2010. It's standard today.)

## The rule

A security fix that isn't backed by a test is held in place only by people remembering it. Every security bug you close should leave behind a failing-then-passing test built from the actual payload, run against every place that renders that kind of data. Otherwise a later refactor of that code path can bring the bug back, and nobody will notice until someone exploits it.

## Sources

- [Twitter Blog: "All about the 'onMouseOver' incident" (September 21, 2010), via the Internet Archive](https://web.archive.org/web/2010/http://blog.twitter.com/2010/09/all-about-onmouseover-incident.html). Twitter's own write-up: the timeline, the XSS cause, the note that the bug was patched the month before and resurfaced with a site update, and the scope of impact.
