---
title: "Gmail's request routers protected themselves by refusing traffic, and took the web interface down"
dek: "A few overloaded routers told the system to stop sending them traffic. That traffic landed on the rest, which overloaded in turn, until nearly all of them were refusing work. Each router's self-protection added up to a collective collapse."
date: 2009-09-01
company: Google
kind: outage
topics: [capacity, cascading-failure]
stack: [gmail, request-routers, load-balancing]
duration_min: 100
impact: "Gmail's web interface had a widespread outage lasting about 100 minutes; IMAP/POP access and mail processing continued to work normally."
detected_by: alert
rule: "An overloaded server that refuses traffic hands its load to its neighbours. Under fleet-wide pressure, servers must degrade by getting slower, not by shifting load."
postmortem: https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html
sources: [https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html]
---

# Gmail's request routers protected themselves by refusing traffic, and took the web interface down

On September 1, 2009, Gmail's web interface had [a widespread outage lasting about 100 minutes](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html). People who opened Gmail in a browser couldn't reach their mail. People using IMAP or POP clients noticed nothing, and mail kept arriving and being processed normally the whole time.

Ben Treynor, Google's VP of Engineering and "Site Reliability Czar", wrote the explanation the same day. He opened with an apology and called the outage "[a Big Deal](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html)."

The post is short, but it describes one of the most common shapes of large outage clearly: a set of servers that each behaved sensibly on their own, and together turned a small overload into a total one.

## What happened

Treynor's account, in order ([source](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html)):

- **Morning, Pacific time:** Google took a small fraction of Gmail's servers offline for routine upgrades. On its own this was normal. Gmail's web interface runs in many locations, and when one location is offline, traffic goes to the others.
- **The hidden factor:** Google had slightly underestimated the load that some recent changes placed on the **request routers**, the servers that direct web queries to the right Gmail server. Treynor notes the irony that some of those changes were designed to improve availability.
- **About 12:30 pm Pacific:** A few request routers became overloaded and, in effect, told the rest of the system: "stop sending us traffic, we're too slow!"
- **Minutes later:** Their load moved to the remaining routers, a few more became overloaded, and within minutes nearly all the request routers were overloaded.
- **Effect:** Web requests couldn't be routed to a Gmail server, so the web interface was unreachable. IMAP/POP and mail processing were unaffected, because those requests don't use the same routers.

The team was [alerted to the failures within seconds](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html). Once they established that the core problem was insufficient capacity, they brought many more request routers online, spread traffic across them, and the web interface came back.

## What the engineers believed

Two reasonable beliefs were in play, and both were nearly right.

The first was about capacity. Taking a small fraction of servers offline for upgrades was something Google did ["all the time"](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html), and it was safe because the remaining capacity could absorb the traffic. That calculation depends on knowing how much load each request costs. The recent changes had made requests heavier for the routers than estimated, so the real headroom was smaller than the planned headroom. Treynor's word is "slightly": the estimate was only slightly off.

The second belief was built into the routers themselves: that an overloaded server should protect itself by telling the system to send traffic elsewhere. For a single unhealthy server in a healthy fleet, that is the correct behaviour. A server that's struggling sheds its load, healthy neighbours absorb it, and users never notice.

Both beliefs hold when one thing goes wrong. On September 1 the first belief failed slightly, and that turned the second one into the mechanism of the outage.

## What was actually going on

### Load shedding moves load, it doesn't remove it

When a request router says "stop sending me traffic", the traffic doesn't disappear. Users still want their mail. The load balancer sends those requests to the routers that are still accepting work.

As general background, here is what that does to the arithmetic. Suppose there are N routers sharing load evenly, each running at some fraction of its capacity. If one stops accepting traffic, the remaining N−1 each get a share of its load. If the fleet was running close to its limit, as it was here after the upgrades and the underestimated load, that extra share pushes the next weakest router over its limit. It sheds its load too, and now N−2 routers are carrying everything. Each step makes the next step more likely and the steps arrive faster, because each removal adds more load to fewer survivors.

That's exactly the sequence Treynor describes: a few routers overloaded, their load transferred to the rest, [a few more became overloaded](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html), and within minutes nearly all were. It's a positive feedback loop: the system's response to overload creates more overload.

```diagram
title: why self-protection spread
flow!: a few routers hot -> refuse traffic -> rest get more load
flow: a router is hot -> serves slower -> load stays put
note: shedding load is safe for one sick server, not for a fleet near its limit
```

### Why the end state is "nothing works"

The end state of this loop isn't "a bit slower." Once nearly all routers are refusing traffic, nearly no requests can be routed, so web users see a complete outage even though the Gmail servers behind the routers might be perfectly healthy. The routers were a chokepoint: every web request had to pass through one of them, and they had all taken themselves out.

This also explains why IMAP and POP were fine. Those requests [didn't use the same routers](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html). The mail system itself wasn't down. One shared front door was.

### Why it spread beyond one location

Treynor's post names two design gaps, and they map onto the two halves of the cascade.

The first is **failure isolation**. Google concluded that request routers [don't have sufficient failure isolation](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html): if there is a problem in one datacenter, it shouldn't affect servers in another. Load shedding across locations is exactly what lets a local problem become a global one. When routers in one place refuse traffic and the traffic is sent somewhere else, the overload travels with it.

The second is **graceful degradation**. Treynor writes that if many request routers are overloaded at once, they all should [just get slower instead of refusing to accept traffic](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html) and shifting their load. A router that gets slower keeps its share of the load. Users see sluggish responses, but the load doesn't move onto neighbours, so the problem doesn't spread. Slowness is bounded; cascading refusal isn't.

### Why "more capacity" was the fix

Once the loop is running, the only quick way out is to change the arithmetic. The team [brought a lot of additional request routers online](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html). Treynor points out that flexible capacity is one of the advantages of Google's architecture. With enough routers, the per-router load drops below the point where any of them sheds, the feedback loop has nothing to feed on, and traffic can be spread out again.

## How they fixed it

On the day: establish that the core problem was [insufficient available capacity](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html), bring a lot of additional request routers online, distribute traffic across them. The web interface came back.

## What changed afterwards

Treynor separated the follow-up actions into straightforward and subtle ([source](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html)):

- **Already done:** increasing request router capacity well beyond peak demand to provide headroom.
- **Subtler, over the following weeks:** giving request routers better failure isolation between datacenters, and making them degrade gracefully, getting slower under overload instead of refusing traffic and shifting load.

He added that Gmail remained [more than 99.9% available](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html) to all users.

The first fix restores the margin that the bad estimate had eaten. The second and third fix the actual mechanism. Headroom makes the cascade less likely to start. Isolation and graceful degradation stop it spreading if it does.

## The rule

Load shedding is a local optimisation. A server that refuses traffic protects itself by handing its work to its neighbours, which is right when one server is sick and the rest are healthy, and disastrous when the whole fleet is near its limit. Design overload behaviour for the fleet, not the single server: under broad pressure, get slower and keep your share, and keep failures contained to the location where they start.

## Sources

- [Gmail Blog, "More on today's Gmail issue" by Ben Treynor (September 1, 2009)](https://gmail.googleblog.com/2009/09/more-on-todays-gmail-issue.html). Google's postmortem: the upgrades, the underestimated router load, the cascade, the recovery and the follow-up actions.
