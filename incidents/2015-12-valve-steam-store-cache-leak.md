---
title: "A Christmas DDoS fix made Steam's CDN cache logged-in users' pages and serve them to strangers"
dek: "To absorb a 2000% traffic spike, Valve's caching partner rolled out more aggressive cache rules. The second set cached responses for authenticated users, and for 90 minutes the Steam Store served one person's account page to another."
belief: "Valve's fix for a Steam traffic spike was more caching. The new rules served one user's account page to another."
date: 2015-12-25
company: Valve
kind: security-breach
topics: [cache, config-change, data-leak, ddos]
stack: [steam, cdn, http-cache]
impact: "Between 11:50 and 13:20 PST, store page requests for about 34k users, which contained sensitive personal information, may have been returned and seen by other users."
rule: "Personalized responses must be uncacheable by default and stay that way, so that an emergency rule change at the edge can't turn them into shared content."
postmortem: https://store.steampowered.com/news/19852
sources: [https://store.steampowered.com/news/19852]
---

# A Christmas DDoS fix made Steam's CDN cache logged-in users' pages and serve them to strangers

On Christmas Day 2015, people browsing the Steam Store started seeing pages that weren't theirs. Some only saw the store front page in the wrong language. Others opened their account page and found somebody else's: a stranger's billing address, purchase history and email address.

Valve's statement, published on [30 December 2015](https://store.steampowered.com/news/19852), put the window at [11:50 to 13:20 PST](https://store.steampowered.com/news/19852). During that time, store page requests for ["about 34k users, which contained sensitive personal information, may have been returned and seen by other users."](https://store.steampowered.com/news/19852)

Nobody broke in and nothing was stolen from a database. The data leaked because a cache did exactly what it was told to do. The instruction came from an emergency change made during a denial-of-service attack.

## What happened

Early on Christmas morning, Pacific time, the Steam Store was hit by a DoS attack that [stopped store pages from being served](https://store.steampowered.com/news/19852). Valve says attacks on Steam happen regularly and usually don't affect users. This one was large: traffic to the store rose [2000% over the average traffic during the Steam Sale](https://store.steampowered.com/news/19852).

Valve uses a web caching partner, a CDN, in front of the Steam Store. In response to the attack, ["caching rules managed by a Steam web caching partner were deployed"](https://store.steampowered.com/news/19852). The goal was to reduce load on Steam's own store servers while still routing legitimate users.

The attack came in a second wave, and a second caching configuration was deployed. According to Valve, that configuration ["incorrectly cached web traffic for authenticated users"](https://store.steampowered.com/news/19852). From then on, some users got Store responses that had been generated for somebody else.

Once the error was found, Valve shut down the Steam Store and deployed a new caching configuration. The store stayed down until Valve had [reviewed all caching configurations](https://store.steampowered.com/news/19852) and had confirmation that the new configuration was on all partner servers and every cached copy on the edge servers had been purged.

## What the engineers believed

Valve's statement doesn't describe the reasoning behind the second configuration, so the assumptions below are interpretation. They are the usual reasoning behind any emergency caching change.

During a flood, the origin is the bottleneck. Every request the CDN answers from cache is one the origin doesn't have to handle. So the natural move is to cache more: more paths, longer lifetimes, fewer requests passed through. The first wave's rules seem to have done that safely.

The assumption that broke: the new rules would only affect content that is the same for everyone. Store pages, game pages and images are all safe to share. Account pages and checkout pages are not. Nothing in the rule itself made that distinction obvious.

## What was actually going on

### How a shared cache decides what's "the same"

A CDN edge stores a response under a **cache key**, and serves that stored copy to any later request with the same key. By default the key is roughly the method plus the URL, sometimes with a few headers. It normally doesn't include the cookie that identifies who's logged in. If it did, every user would get a separate cache entry and the cache would barely help.

That works for public pages, because `/app/12345` looks the same to everyone. It's a disaster for personalized pages. `/account/` is the same URL for every user, but its content depends entirely on who's asking. If the edge caches the first user's response under the key `GET /account/`, it serves that user's page to the next person who asks.

Ordinary HTTP has several ways to stop this. The origin can mark a response as `Cache-Control: private` or `no-store`. The cache can be told to vary on the session cookie. Or the CDN can be configured to bypass the cache for any request that carries a session cookie. Valve's statement doesn't say which of these Steam relied on or what exactly the second configuration changed. All it says is that the configuration ["incorrectly cached web traffic for authenticated users"](https://store.steampowered.com/news/19852). Whatever had been keeping authenticated traffic out of the cache, that configuration overrode it.

```diagram
title: one cache key, many users
flow: A GETs /account -> origin renders A -> edge stores it
flow!: B GETs /account -> same cache key -> B sees A's page
note: cache key had no notion of who was asking
```

### Why the symptoms varied

Valve says what people saw [ranged from the front page in the wrong language to another user's account page](https://store.steampowered.com/news/19852). That fits a cache key that ignored per-user context. The front page depends on the language preference, so a cached copy carries whichever language the first requester had. An account page depends on identity, so a cached copy carries that person's personal data. Same bug, different damage depending on how personal the page was.

It also explains Valve's reassurance: if you didn't open a page with your personal information, such as your account page or a checkout page, during that window, then [your information couldn't have been shown to anyone else](https://store.steampowered.com/news/19852). Only responses that were actually generated for you could have ended up in the cache.

### What leaked and what didn't

Depending on the page, cached responses included [a billing address, the last four digits of a Steam Guard phone number, purchase history, the last two digits of a credit card number and/or an email address](https://store.steampowered.com/news/19852). Valve says they did not include full card numbers, passwords, or enough data to log in as another user or complete a transaction as them.

That boundary is worth noticing. Cached responses are static HTML. A cache leak exposes whatever the page displayed, but it doesn't hand over the session itself. If session cookies had been in the cached responses, for example from a `Set-Cookie` header on a cached reply, the damage would have been account takeover. Valve says no unauthorized actions were possible beyond viewing cached page information ([Valve](https://store.steampowered.com/news/19852)).

### The pressure that made it likely

This is interpretation, but the conditions are typical. The change was made during an active attack, on Christmas, by a partner managing the rules, after a first change had apparently worked. Emergency edge rules tend to be written quickly, deployed globally in one go, and validated mainly by asking "did origin load drop?" That check passes immediately for a rule that caches too much, because caching other people's account pages takes load off the origin too.

## How they fixed it

From [Valve's statement](https://store.steampowered.com/news/19852):

1. They shut down the Steam Store once the error was identified.
2. They deployed a new caching configuration.
3. They kept the store down until all caching configurations had been reviewed, the new configuration was confirmed on all partner servers, and all cached data on the edge servers had been purged.

The purge matters. Fixing the rule stops new bad entries from being created, but entries already cached keep being served until they expire or are purged.

## What changed afterwards

Valve said it would keep working with its caching partner to [identify the users whose information was served to others](https://store.steampowered.com/news/19852) and contact them, and to improve the process used to set caching rules. It said that because no unauthorized actions were possible on accounts, users didn't need to do anything. The statement doesn't describe the specific process changes.

## The rule

Make personal responses uncacheable at the origin, every time: `Cache-Control: private, no-store` on anything rendered for a logged-in user. Don't rely on edge configuration alone to keep them private. Edge rules get changed under pressure, by different people, sometimes at another company. A header that the origin sets on every personal response still protects you when someone at the edge writes a broad "cache everything" rule in the middle of an attack on Christmas Day.

Second: when you validate an emergency cache change, test it while logged in as two different users. Load metrics will always say an over-broad rule is working. Only a test that compares what two people see will catch it.

## Sources

- [Valve, "Update on Christmas Issues", Steam news, 30 Dec 2015](https://store.steampowered.com/news/19852): Valve's official statement, covering the DoS attack, the caching configuration error, the affected window and user count, what data was exposed, and the remediation.
