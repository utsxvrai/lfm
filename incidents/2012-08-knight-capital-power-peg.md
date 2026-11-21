---
title: "Knight Capital lost $460 million in 45 minutes because one of eight servers missed a deploy"
dek: "New code reused an old flag. Seven servers read it as the new feature. The eighth still had 'Power Peg' code, unused since 2003, that read it as 'keep buying', and nothing downstream could stop it."
date: 2012-08-01
company: Knight Capital
kind: financial-loss
topics: [deploy, human-error, rollback, monitoring]
stack: [smars, order-router]
duration_min: 45
impact: "212 parent orders produced over 4 million executions in 154 stocks for more than 397 million shares; Knight lost over $460 million."
rule: "Never repurpose a flag while the code that used to read it can still run anywhere. Delete dead code, verify every server got the deploy, and put a hard limit on what a system can send."
postmortem: https://www.sec.gov/litigation/admin/2013/34-70694.pdf
sources: [https://www.sec.gov/litigation/admin/2013/34-70694.pdf]
---

# Knight Capital lost $460 million in 45 minutes because one of eight servers missed a deploy

On the morning of August 1, 2012, Knight Capital's automated equity router, SMARS, received 212 ordinary retail orders. Over [roughly 45 minutes](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) it turned them into millions of child orders, producing [more than 4 million executions in 154 stocks for more than 397 million shares](https://www.sec.gov/litigation/admin/2013/34-70694.pdf).

By the time it stopped, Knight held an unintended [net long position of about $3.5 billion in 80 stocks and a net short position of about $3.15 billion in 74 stocks](https://www.sec.gov/litigation/admin/2013/34-70694.pdf). Unwinding them cost [over $460 million](https://www.sec.gov/litigation/admin/2013/34-70694.pdf). For context, Knight's trading was [roughly ten percent of all trading in listed U.S. equities](https://www.sec.gov/litigation/admin/2013/34-70694.pdf).

The detailed account comes from the SEC's October 2013 order against Knight, which Knight settled without admitting or denying the findings. The story it tells is mostly about deployment, dead code, and a reused boolean.

## What happened

From the [SEC order](https://www.sec.gov/litigation/admin/2013/34-70694.pdf):

- **Background:** NYSE's Retail Liquidity Program (RLP) was due to start on August 1. Knight wrote new RLP code for SMARS, its high-speed router that splits incoming "parent" orders into "child" orders sent to exchanges.
- **From July 27:** Knight deployed the RLP code to SMARS in stages, a few servers per day. A technician did not copy the new code to one of the eight servers. No second person reviewed the deployment, and there was no written procedure requiring one.
- **August 1, from about 8:01am ET:** pre-market RLP orders made an internal system send automated emails referencing SMARS and the error ["Power Peg disabled."](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) Ninety-seven of them went out before the 9:30 open. They weren't designed as alerts and nobody acted on them.
- **At the open:** RLP orders carrying the repurposed flag reached the eighth server, which started sending child orders without stopping.
- **During the response:** engineers uninstalled the new RLP code from the seven good servers. That made it worse.
- **About 45 minutes in:** Knight stopped sending the orders.

## What the engineers believed

There are two beliefs here, and both are sensible on their own.

**Belief one: the deploy went out.** Knight was rolling out to a fleet of eight servers over several days. Seven worked. Without a check that compares each server against the expected build, "we ran the deploy" and "every server is on the new code" feel like the same fact. The SEC notes [no one realized](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) the eighth server still had the old code.

**Belief two: the old flag is safe to reuse.** The RLP code [repurposed a flag that formerly activated "Power Peg"](https://www.sec.gov/litigation/admin/2013/34-70694.pdf), a feature Knight had stopped using in 2003. The plan was to delete Power Peg as part of the same change, so when the flag was "yes" the new RLP logic would run instead. If Power Peg is gone, reusing its flag costs nothing.

Both beliefs depend on the deploy being complete. On the one server where it wasn't, the reused flag did exactly what it had always done.

## What was actually going on

### How Power Peg was supposed to stop

SMARS takes a parent order (say, buy 1,000 shares) and sends child orders to the market until the parent is filled. In Power Peg's original design, a **cumulative quantity function** counted executed shares as child orders filled and [told the code to stop](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) once the parent was complete. That counter was the loop's exit condition.

In **2005**, two years after Power Peg was retired, Knight [moved the cumulative-quantity tracking to an earlier point](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) in the SMARS code. Power Peg was not retested afterwards. It stayed present and callable, but its exit condition no longer lived where it expected it.

So by 2012, Power Peg was dead code with a broken stop condition, still wired to a flag.

### What the eighth server did

```diagram
title: one flag, two meanings
flow: RLP order, flag on -> servers 1-7: RLP -> handled correctly
flow!: RLP order, flag on -> server 8: Power Peg -> endless orders
note: the eighth server never got the deploy
```

When RLP orders arrived on August 1, the seven updated servers [processed them correctly](https://www.sec.gov/litigation/admin/2013/34-70694.pdf). On the eighth, the flag woke up Power Peg. Because the cumulative quantity check had been moved, the server sent child orders ["continuously ... in rapid sequence"](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) for each parent order, regardless of how many shares had already been filled. Another part of Knight's system knew the parents were filled, but that information [wasn't passed to SMARS](https://www.sec.gov/litigation/admin/2013/34-70694.pdf).

In loop terms, this is a `while` whose exit condition had been moved out from under it years earlier, running at the speed of an electronic market.

### Why nothing downstream stopped it

A runaway loop is survivable if something outside the loop has a limit. The SEC order goes through Knight's limits one by one:

- **No output check on SMARS.** Knight had no control to [compare orders leaving SMARS with those that entered it](https://www.sec.gov/litigation/admin/2013/34-70694.pdf), and no procedure to halt SMARS when it behaved abnormally.
- **A price collar that didn't apply.** A control capped child-order prices at 9.5% from the national best bid or offer. It wouldn't block orders while prices moved less than that, and it [didn't apply](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) to the 212 orders, which were meant for the opening auction.
- **A position limit with no teeth.** Unmatched executions piled up in an internal account (the "33 Account") with a $2 million gross position limit. That limit [wasn't linked to any automated control](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) that could block new orders.
- **Monitoring by eye.** Knight's main risk tool, PMON, was post-execution, relied entirely on humans watching it, raised no automated alerts, didn't show limits, and [lagged during high volume](https://www.sec.gov/litigation/admin/2013/34-70694.pdf). Senior staff saw the 33 Account growing at the open but couldn't quickly tell what was causing it.

Each of these is a place where a runaway loop could have hit a wall. None of them was a wall.

### Why the "rollback" made it worse

With no incident-response procedure, Knight's technology team [debugged in production while SMARS kept trading](https://www.sec.gov/litigation/admin/2013/34-70694.pdf). One attempt was to uninstall the new RLP code from the seven good servers. That put those servers back to the old build, which still contained Power Peg. Incoming orders with the repurposed flag then [activated Power Peg on those servers too](https://www.sec.gov/litigation/admin/2013/34-70694.pdf).

This is the deadliest detail in the story. The reflex "roll back to the last known good version" assumes the old version is good. Here, the old version was the one with the bomb in it. The flag's meaning had changed, and only the new code understood the new meaning. Rolling back code without rolling back the *inputs* that changed alongside it isn't a rollback.

### The 97 emails

The ["Power Peg disabled"](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) emails from 8:01am were caused by the deployment failure. The SEC calls them a potential opportunity to find and fix the problem before the open. But they weren't designed as alerts, and staff generally didn't read them. A signal that goes to a mailbox nobody watches is not monitoring.

## How they fixed it

The SEC order doesn't detail exactly how the orders were stopped, only that Knight stopped sending them after about 45 minutes. It does describe the outcome: price swings in many affected stocks, with Knight's executions [more than 20% of volume in 75 of them](https://www.sec.gov/litigation/admin/2013/34-70694.pdf), plus net capital problems and violations of Regulation SHO.

## What changed afterwards

In October 2013 the SEC found Knight had violated the market access rule (Rule 15c3-5). Among the findings were the lack of [controls to ensure orderly deployment of new code or to prevent activation of code no longer intended for use](https://www.sec.gov/litigation/admin/2013/34-70694.pdf). Knight agreed to pay a [$12 million civil penalty](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) and to hire an independent consultant to review its controls.

The order also points out that Knight had a warning before: in October 2011, test data left in a system after a disaster-recovery test was used for live quotes, costing [nearly $7.5 million](https://www.sec.gov/litigation/admin/2013/34-70694.pdf). Knight fixed that specific system but didn't broadly ask whether any system could flood the market with erroneous orders.

For a backend engineer the takeaways are concrete:

- **Verify deploys per host.** After a rollout, query every instance for its build version and fail loudly on any mismatch.
- **Don't reuse flags, enum values or message fields.** Add a new one. Old readers can't misread a value they've never seen.
- **Delete dead code instead of disabling it.** Code that's "unused but callable" is a liability that changes behaviour the moment some input reaches it.
- **Put limits outside the loop.** A circuit breaker that compares output to input, or a hard cap on order count or exposure, catches bugs you didn't think of.

## The rule

A flag is a contract between a writer and every reader that might still exist. If you change what a value means, assume some server, some old build, some rollback target still reads it the old way, and make sure it can't. Then put a hard, automated limit downstream so that even a loop you didn't know existed can only do bounded damage.

## Sources

- [SEC Release No. 70694: Order Instituting Administrative and Cease-and-Desist Proceedings, In the Matter of Knight Capital Americas LLC (October 16, 2013)](https://www.sec.gov/litigation/admin/2013/34-70694.pdf): the regulator's findings, including the deployment failure, Power Peg history, controls, incident response and penalty.
