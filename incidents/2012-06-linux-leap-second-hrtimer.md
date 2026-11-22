---
title: "The 2012 leap second put Linux timers one second in the future and pinned CPUs worldwide"
dek: "When the kernel inserted the leap second it stepped the system clock back but never told the high-resolution timer code. Every timer set for less than a second fired immediately, re-armed, and fired again. Java and MySQL hosts sat at full CPU until someone set the date."
belief: "Linux leap seconds were thought to be boring. In 2012 the kernel's timers fired nonstop and pinned CPUs."
date: 2012-06-30
company: Linux kernel
kind: bug
topics: [time-handling, software-bug]
stack: [linux, hrtimer, mysql, java, ntp]
impact: "Linux servers showed abrupt, sustained load spikes after the June 30 leap second; Mozilla saw MySQL and Java servers spike in CPU."
rule: "Code paths that run once every few years are untested code paths. Simulate the rare event on purpose before the calendar does it for you."
postmortem: https://lwn.net/Articles/504744/
sources: [https://lwn.net/Articles/504744/, https://web.archive.org/web/2012/http://blog.mozilla.org/it/2012/06/30/mysql-and-the-leap-second-high-cpu-and-the-fix/]
---

# The 2012 leap second put Linux timers one second in the future and pinned CPUs worldwide

At midnight UTC between June 30 and July 1, 2012, the world's clocks gained an extra second: 23:59:60. Within moments, Linux servers in many places started burning CPU for no visible reason. LWN described the symptom as ["abrupt and sustained load spikes"](https://lwn.net/Articles/504744/) on affected machines.

Mozilla's IT team saw it on their MySQL and Java servers. Their graphs show [CPU spiking at 17:00 Pacific, which is midnight UTC](https://web.archive.org/web/2012/http://blog.mozilla.org/it/2012/06/30/mysql-and-the-leap-second-high-cpu-and-the-fix/). Nothing unusual was running. Restarting MySQL or Java didn't help. Rebooting did, and so, oddly, did running `date` to set the clock to the time it already was.

The bug was in the kernel, and it was tracked down thanks to a determined effort by John Stultz. LWN's Jonathan Corbet wrote it up in [a short, precise article](https://lwn.net/Articles/504744/) that is the main source for this post. It's a good example of how two pieces of code can each be correct and still break each other when they disagree about what time it is.

## What happened

- **June 30, 2012, 23:59:60 UTC:** the kernel inserted the leap second, logging the familiar [`Clock: inserting leap second 23:59:60 UTC`](https://lwn.net/Articles/504744/).
- **Immediately after:** on affected machines, processes that used short timers started spinning. At Mozilla, MySQL and Java hosts spiked in CPU [starting at 17:00 Pacific](https://web.archive.org/web/2012/http://blog.mozilla.org/it/2012/06/30/mysql-and-the-leap-second-high-cpu-and-the-fix/). The same post notes that staff's personal Minecraft servers were hit too.
- **Around 19:35 Pacific:** Mozilla [fixed it](https://web.archive.org/web/2012/http://blog.mozilla.org/it/2012/06/30/mysql-and-the-leap-second-high-cpu-and-the-fix/) by stopping ntpd and setting the date, pushed to every machine with Puppet.
- **By July 2:** the root cause had been found and a kernel patch proposed, [per LWN](https://lwn.net/Articles/504744/).

## What the engineers believed

From the operators' side, the belief was simple and mostly true: leap seconds are handled by the kernel and NTP, and they're boring. The kernel's code for them was, in LWN's words, ["quite old and works pretty much as advertised."](https://lwn.net/Articles/504744/) There had been a leap second at the end of 2008 and the world kept turning.

So when CPUs spiked, the natural reading was "something in the application is busy." That's why Mozilla's note that restarting MySQL or Java ["does NOT fix the problem"](https://web.archive.org/web/2012/http://blog.mozilla.org/it/2012/06/30/mysql-and-the-leap-second-high-cpu-and-the-fix/) is such a useful clue. If killing the busy process and starting a fresh one doesn't help, the process isn't the thing that's broken. Its environment is.

Inside the kernel, the assumption was more specific: **any change to the system time goes through a path that also updates the timer subsystem.** That had been true. For the leap-second path, it stopped being true in 2007.

## What was actually going on

### Two views of "now"

The kernel keeps wall-clock time in a `timespec`: [seconds and nanoseconds since the epoch](https://lwn.net/Articles/504744/). That count is defined to *not* include leap seconds. So when a leap second is inserted, the kernel has to correct it by hand, by stepping the system clock back one second at the end of the leap second. 23:59:59 effectively happens twice.

The high-resolution timer subsystem, hrtimers, doesn't read that system time directly. It keeps its own internal time bases, stored as **offsets** from the system time, and these bases are [per-CPU](https://lwn.net/Articles/504744/). One base backs the realtime clock (which should follow wall-clock changes) and another the monotonic clock (which only moves forward). The offsets let the timer code turn system time into each CPU's view of realtime quickly.

Offsets are only correct as long as someone updates them when the thing they're offset from moves. That someone is a function called `clock_was_set()`. As LWN puts it, as long as every system time change is followed by a call to it, ["all will be well."](https://lwn.net/Articles/504744/)

### The missing call

The leap-second code stepped the system clock back and **did not call `clock_was_set()`**. The call had been [removed in 2007](https://lwn.net/Articles/504744/). So after the leap second:

- System time had gone back one second.
- The hrtimer offsets hadn't changed, so the timer subsystem's idea of realtime was now **one second ahead** of the system.

Every realtime timer therefore expired one second earlier than requested. For a timer set an hour out, that's harmless. For any timer set for **less than one second** in the future, its deadline was already in the past by the timer subsystem's clock, so it [expired immediately](https://lwn.net/Articles/504744/).

### How "early" becomes "100% CPU"

Lots of server software sleeps in short intervals: wait up to 100ms for a lock, a condition variable, a socket, then wake and check again. These are usually loops. The timer fires early, the code sees nothing to do, arms another short timer, which also fires immediately, and so on. LWN describes it exactly: recurring timers ["will be re-set immediately after expiration, at which point they will immediately expire again"](https://lwn.net/Articles/504744/), and that loop was the load spike.

```diagram
title: why a 100ms sleep became a busy loop
flow: arm timer +100ms -> wait 100ms -> wake, check, re-arm
flow!: arm timer +100ms -> hrtimer is 1s ahead -> fires now, re-arm
note: any timer under one second expired the moment it was set
```

Neither LWN nor Mozilla's post says which specific timers MySQL and the JVM were spinning on, so that detail is left out here. What the sources agree on is the shape: a busy loop in user space, caused by a kernel-level clock disagreement.

### Why the fixes worked

This explains every observation from the Mozilla post:

- **Restarting the application didn't help** because the broken state was in the kernel's hrtimer offsets. A new process got the same early-firing timers.
- **Rebooting helped** because it rebuilt all kernel state from scratch.
- **Setting the date helped.** Mozilla's script ran ``date -s "`date`"``, setting the clock to its current value. The sources don't spell out the kernel path, but the explanation that fits LWN's account is that an explicit settime is an ordinary time change that *does* end in `clock_was_set()`. Setting the clock re-synced the hrtimer offsets, even though the time itself barely moved. A commenter on the Mozilla post confirmed by testing that ["the entire fix is the call to clock_settime via 'date'"](https://web.archive.org/web/2012/http://blog.mozilla.org/it/2012/06/30/mysql-and-the-leap-second-high-cpu-and-the-fix/); stopping NTP wasn't required.

## How they fixed it

The operational fix was to set the date (or reboot) on every affected host. Mozilla's version was a guarded shell script, [pushed through Puppet](https://web.archive.org/web/2012/http://blog.mozilla.org/it/2012/06/30/mysql-and-the-leap-second-high-cpu-and-the-fix/), that stopped ntpd, set the date, and touched a marker file so it ran only once per machine.

The kernel fix was to put the `clock_was_set()` call back in the leap-second path. It wasn't a one-line revert. Because each CPU has its own timer bases, the work has to run on every CPU, and that [can't be done in atomic context](https://lwn.net/Articles/504744/), which is where the leap-second code runs. Stultz's patch detects that case and defers the work to a workqueue.

## What changed afterwards

LWN's analysis of why this slipped through is the real lesson. Before June 30, 2012, the previous leap second was at the end of 2008, which left [three and a half years](https://lwn.net/Articles/504744/) in which the code could break unnoticed. There was no regularly run regression test for hrtimers across a leap-second adjustment. LWN expected distributors with support obligations to start testing before future leap seconds, and noted the longer-term ideas of abolishing leap seconds or keeping kernel time in TAI, which has no leap seconds.

## The rule

A code path that runs once every few years is not "battle-tested", it's untested. If your system depends on a rare event (leap seconds, DST changes, year rollovers, certificate expiry, failover) then fake that event in a test environment on a schedule. And when two subsystems cache derived views of the same value, every write to the source must invalidate the derived copies. That invalidation call is exactly the kind of line that disappears in a refactor.

## Sources

- [LWN.net: Leaping seconds and looping servers (Jonathan Corbet, July 2, 2012)](https://lwn.net/Articles/504744/): technical analysis of the hrtimer / `clock_was_set()` bug and its fix.
- [Mozilla IT blog: MySQL and the Leap Second, High CPU and the Fix (June 30, 2012), via Internet Archive](https://web.archive.org/web/2012/http://blog.mozilla.org/it/2012/06/30/mysql-and-the-leap-second-high-cpu-and-the-fix/): first-hand operator account with timings, symptoms, the workaround script and reader comments.
