---
title: "Wikipedia's datacenter overheated, and the DNS failover meant to save it broke resolution worldwide"
dek: "Servers in Wikimedia's European datacenter shut down from heat. Moving traffic to Florida meant changing DNS, the failover mechanism turned out to be broken, and resolvers that ignored the one-hour negative-cache TTL kept the outage going after it was fixed."
belief: "Wikimedia trusted its DNS failover. It was broken, and ISP resolvers kept the outage going after the fix."
date: 2010-03-24
company: Wikimedia
kind: outage
topics: [power-cooling, dns, cache]
stack: [dns]
impact: "DNS resolution of Wikimedia sites stopped working globally after a failover from the European datacenter to Florida; for many users the outage lasted longer than an hour because ISP resolvers did not honor the one-hour negative cache TTL."
rule: "Test your failover path as often as your normal path, and remember that a wrong DNS answer outlives the fix by however long resolvers decide to cache it."
postmortem: https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/
sources: [https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/]
---

# Wikipedia's datacenter overheated, and the DNS failover meant to save it broke resolution worldwide

On 24 March 2010, Wikipedia and the other Wikimedia sites disappeared for users around the world. The chain of events, as described the same day by Wikimedia's Mark Bergsma, started with heat. An [overheating problem in Wikimedia's European data center](https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/) made many servers turn themselves off to protect themselves.

That alone should have been a regional problem. Wikimedia had a standard, quick failover procedure for exactly this case: move European users to the Florida cluster by changing DNS entries. The failover ran. And then, Bergsma wrote, "it turned out that this failover mechanism was now broken, causing the [DNS resolution of Wikimedia sites to stop working globally](https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/)."

The breakage was fixed quickly. The outage wasn't, because of caching. Wikimedia first said it might take up to an hour for everyone to get access back, then had to post an update: for many people it was lasting longer, because [many ISPs' DNS resolvers did not honor the negative cache TTL](https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/) Wikimedia sent.

## What happened

The post is short and was updated during the day. Its sequence ([source](https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/)):

1. **Cooling failure.** Overheating in the European datacenter caused many servers to turn off to protect themselves. This affected access for all European users of Wikipedia and the other projects.
2. **Failover.** Wikimedia moved all user traffic to its Florida cluster using its standard quick failover procedure, which works by changing DNS entries.
3. **Global DNS failure.** Shortly after the switch, the failover mechanism turned out to be broken. DNS resolution of Wikimedia sites stopped working everywhere, not just in Europe.
4. **Quick fix, slow recovery.** The DNS problem was quickly resolved, but Wikimedia warned it could take up to an hour before access was restored for everyone, because of caching.
5. **Update: longer than an hour.** For many people it lasted longer. Many ISPs' resolvers did not honor the [negative cache TTL of one hour](https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/) and used a longer value instead. Wikimedia worked around it by renaming the affected DNS record.
6. **Update at 21:32 UTC.** The SSL gateway, secure.wikimedia.org, had been disabled due to overload issues, and was back up.

The post doesn't give start and end times for the main outage, the number of users affected, or what exactly was broken in the failover mechanism. This write-up doesn't fill those gaps.

## What the engineers believed

The design was sound in principle. Wikimedia had two sites, Europe and Florida, and a known procedure for moving traffic between them, described in the post as [a standard quick failover procedure](https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/). A datacenter going down was the scenario it was built for.

The belief underneath was that the failover procedure would work when it was needed. That belief is very common and very rarely tested under real conditions. Failover paths run only during emergencies, and the systems around them keep changing in between. The post's own wording is telling: the mechanism was "now broken." It had presumably worked at some earlier point. Something had changed since, and nothing had exercised the path to notice.

There was a second belief, about recovery: that once the DNS was fixed, the world would catch up within the TTL Wikimedia had published. Wikimedia's first estimate, [up to an hour](https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/), came straight from the one-hour negative cache TTL it sent. That turned out to be a promise only Wikimedia's servers were keeping.

## What was actually going on

### Failover by DNS

Changing DNS is one of the simplest ways to move users between datacenters. Users reach Wikipedia by name, the name resolves to addresses, and if you change which addresses the name points to, new lookups go to the new site. No client changes, no special network setup.

The cost is that DNS is a distributed cache, not a switch. Every recursive resolver in the world, typically one per ISP or office network, caches answers for as long as the answer's time-to-live (TTL) says. A failover by DNS takes effect for each user only when their resolver's cached answer expires and it asks again. And if the failover publishes a wrong answer, that wrong answer gets cached in exactly the same way.

### Negative answers are cached too

This is the part that makes the incident instructive. As general DNS background: resolvers don't only cache successful answers. If an authoritative server answers "this name does not exist", or "this name has no records of that type", the resolver caches that negative answer too, so it doesn't have to keep asking about names that aren't there. How long it caches a negative answer is set by the zone, in a value usually called the negative cache TTL.

The post doesn't say what the broken failover published. But the fact that the negative cache TTL controlled the recovery tells us something. Interpreting from that: for at least some lookups, resolvers received a negative answer, an authoritative "nothing here", rather than a timeout. A timeout isn't cached, so it would have cleared as soon as the servers recovered. A negative answer is cached as a fact. Resolvers that got one during the broken window kept telling their users that Wikipedia's name didn't resolve, even after Wikimedia had fixed it.

### Why "up to an hour" became longer

Wikimedia sent a [negative cache TTL of one hour](https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/). A resolver that honors it would ask again within an hour and get the corrected answer. Many ISP resolvers, the post says, used a longer value instead.

That's the uncomfortable property of DNS caching: the TTL is a request, not a command. The owner of a name can say how long an answer should be kept, but the resolver is someone else's software, run by someone else, configured by someone else. Some resolvers raise TTLs they consider too low; some apply their own minimums or maximums. Once a wrong answer is in a resolver you don't run, you can't flush it.

```diagram
title: why the fix didn't reach users
flow!: failover breaks DNS -> cached "not found" -> kept past 1 hour
flow: rename the record -> name never cached -> fresh lookup works
note: you can't flush a resolver you don't run, but you can ask for a new name
```

### Why renaming the record worked

Wikimedia couldn't make ISPs drop their cached negative answers. So it [renamed the affected DNS record](https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/) to something else.

The post doesn't describe the record layout. As general background on why this works: large sites often make their public names aliases (CNAME records) for internal names that actually hold the addresses, which is what makes it possible to repoint traffic by editing one record. If the negative answer was cached for the internal name, then pointing the alias at a brand-new name sidesteps it. No resolver has ever cached anything for the new name, so the first lookup goes all the way to Wikimedia's authoritative servers and gets the correct answer. You can't invalidate someone else's cache, but you can stop asking it for the key it has wrong.

## How they fixed it

In three steps, as far as the post describes:

1. Fix the broken failover mechanism, which was [quickly resolved](https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/).
2. Wait out the negative-cache TTL for resolvers that honored it.
3. For resolvers that didn't, rename the affected DNS record so they had to perform a fresh lookup.

Separately, the SSL gateway, secure.wikimedia.org, which had been disabled due to overload, was [back up by 21:32 UTC](https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/).

## What changed afterwards

The post is a same-day status update, not a postmortem, and it doesn't list follow-up actions. It doesn't say what broke in the failover mechanism or what was done about the cooling problem. We don't have a source for either, so this post doesn't guess.

## The rule

A failover path that only runs during emergencies is untested code, and it will be broken in ways you find out about during the emergency. Exercise it regularly. And when the failover is a DNS change, treat every answer you publish, including "this name doesn't exist", as something that will be cached by resolvers you don't control for longer than you asked. Keep a plan for that ready: an alias you can point at a fresh name is one way out.

## Sources

- [Diff (Wikimedia blog archive), "Global Outage (cooling failure and DNS)" by Mark Bergsma (24 March 2010)](https://diff.wikimedia.org/2010/03/24/global-outage-cooling-failure-and-dns/). Wikimedia's same-day explanation with updates: the overheating, the broken DNS failover, the negative-cache TTL problem, the record rename and the SSL gateway.
