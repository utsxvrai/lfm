---
title: "A routine Slack deploy disconnected every user, and getting them back took two hours"
dek: "Slack's own summary is short: a routine internal deployment knocked all customers offline and left them unable to reconnect. Recovery meant adding hardware and rate-limiting reconnections so the returning crowd didn't knock it over again."
belief: "Slack expected a routine internal deploy to be invisible to users. It disconnected all of them."
date: 2017-10-31
company: Slack
kind: outage
topics: [deploy, capacity, cascading-failure]
stack: [slack]
impact: "Slack went down for all users at 3:50pm PST; all customers had reconnected by 6:00pm PST."
rule: "Every service with persistent clients needs a plan for all of them reconnecting at once: server-side admission control plus client backoff with jitter."
postmortem: https://status.slack.com/2017-10-31
sources: [https://status.slack.com/2017-10-31]
---

# A routine Slack deploy disconnected every user, and getting them back took two hours

On Tuesday, October 31, 2017, at [3:50pm PST](https://status.slack.com/2017-10-31), Slack went down for all users. Slack's posted summary put the cause in one sentence: a routine internal deployment of software to its servers "unfortunately caused all of our customers to become disconnected, and left them unable to reconnect" ([Slack](https://status.slack.com/2017-10-31)).

The status page listed login/SSO, connectivity, messaging, files and notifications among the features affected. By [6:00pm PST](https://status.slack.com/2017-10-31), Slack says, all customers had reconnected.

An honest note before going further: Slack's public record of this incident is a status page, not a detailed engineering postmortem. It doesn't say what the deployment changed, which component failed, or why clients couldn't reconnect. This post doesn't fill those gaps. What it can do is explain the one mechanism Slack *does* describe, the reconnection problem, because that's where most of the two hours went, and every team running persistent connections will meet it.

## What happened

Slack's status updates on the day, all PST ([Slack](https://status.slack.com/2017-10-31)):

| Time | Update (paraphrased) |
| --- | --- |
| 3:58 PM | Aware of connectivity issues, investigating |
| 4:39 PM | Apology; working to get users back into workspaces |
| 5:22 PM | Working on fixes to relieve the connection problems |
| 6:01 PM | Fixes showing positive results, "not out of the woods yet" |
| 6:35 PM | Tracking connections since the changes were deployed; believe all users should be able to access Slack |
| 6:45 PM | Summary posted: everything back up and running |

The summary describes the recovery in two moves: scaling up new hardware to handle the bulk of the requests, and using standard rate limits so users reconnected gradually, "to avoid further overloading the system when folks came back online" ([Slack](https://status.slack.com/2017-10-31)).

## What the engineers believed

Slack calls it a "routine internal deployment." That word is the belief. Routine deployments are the kind a team does all the time, with tested tooling, and they don't usually affect users. The status page doesn't say what checks the deploy went through or why they didn't catch the problem, so the assumption that failed can only be described at that level: the deploy was expected to be invisible to users, and instead it disconnected every one of them.

The second, quieter belief, again interpretation, is the one almost every connection-oriented service shares: *if clients drop, they'll just reconnect.* In steady state that's true. Clients drop and reconnect all the time, individually, spread across the day. The failure mode is when they all drop **at the same moment**.

## What was actually going on

From here on this is general background, not something Slack's status page states. It explains why "disconnected everyone" and "unable to reconnect" so often go together, and why Slack's fix took the form it did.

### Steady state vs. synchronized state

A chat client keeps a long-lived connection open to receive messages in real time. Setting up that connection is much more expensive than keeping it open. A typical reconnect authenticates the user, loads the current state of their workspace (channels, unread counts, presence, recent messages), and registers the connection with whatever routes messages to it. A server fleet is sized for the *steady-state* rate of new connections, which is a small fraction of the users online at any time.

Disconnect everyone at once and the arithmetic flips. Every client tries to reconnect in the same few seconds. Demand for that expensive startup work jumps from "a trickle" to "the whole user base", and the services behind it get overloaded.

### The reconnect loop

Then the retry behaviour takes over. A client whose reconnect times out tries again. If the servers are overloaded, most attempts time out, so most clients retry, so the overload continues. Work done for a connection that times out halfway is wasted, so the system can be fully busy and still make almost no progress. This is the **thundering herd**, and it can keep a service down long after the original bug is gone: the deploy can be rolled back and users still can't get in.

```diagram
title: why a fixed bug can stay down
flow: everyone disconnects -> everyone reconnects -> servers overload
flow!: reconnects time out -> clients retry -> overload persists
note: Slack added hardware and rate limits to break the loop
```

### Why Slack's two moves are the textbook ones

The two actions in Slack's summary map onto the two ways to break that loop:

- **Add capacity** (Slack's new hardware). This raises the ceiling so more of the herd gets through on each attempt.
- **Admission control** (Slack's standard rate limits). This lowers the arrival rate to something the servers can actually finish. Turning some clients away immediately is better than accepting all of them and timing out on every one. Clients that are rejected fast can wait and try again; clients that are accepted complete and stop adding load.

Slack's own wording names the risk directly: the rate limits were there to stop returning users from overloading the system again ([Slack](https://status.slack.com/2017-10-31)).

### The client side

The server can only do so much if clients retry on a fixed schedule. Standard practice (again, general background, not stated by Slack) is **exponential backoff with jitter**: each failed attempt waits longer than the last, plus a random component. The randomness matters more than the exponent. Without it, a million clients that disconnected at the same moment will all retry at 1s, 2s, 4s, 8s, together, and arrive in synchronized waves. With jitter, the herd spreads out into a steady stream.

## How they fixed it

Slack's statement is limited to what's above: identify the problem, scale up new hardware, and apply standard rate limits so users came back gradually. By [6:00pm PST](https://status.slack.com/2017-10-31) all customers had reconnected. The 6:35 PM update says Slack had been tracking connections since its changes were deployed, which suggests fixes were shipped during the incident, but the page doesn't describe them.

The status page doesn't say whether the original deployment was rolled back.

## What changed afterwards

Slack's public record doesn't list remediation items. The last status update says Slack would keep investigating and learning from the outage ([Slack](https://status.slack.com/2017-10-31)). This post doesn't guess what came of that.

What any team can take from it:

1. **Treat "mass disconnect" as a scenario to test, not a hypothetical.** If every client reconnects at once, does your fleet recover alone, or does someone have to step in? Load-test the reconnect path at full user count, not just at steady-state rates.
2. **Have admission control ready before you need it.** Slack could say "standard rate limits", meaning the mechanism already existed. A rate limiter you have to write during the incident adds an hour to it.
3. **Ship jittered backoff in every client**, and make sure the server can tell clients to slow down (for example with a retry-after hint) so you can control the herd from the server side without a client release.
4. **Deploys that touch connection handling deserve staged rollouts**, because their failure mode is synchronized across every user on the affected servers at once.

## The rule

Every service with persistent clients needs a plan for all of them reconnecting at once: server-side admission control plus client backoff with jitter.

## Sources

- [Slack System Status, October 31, 2017](https://status.slack.com/2017-10-31): Slack's official status-page history for the incident. It includes the timestamped updates and the post-incident summary, and is the source for the 3:50pm and 6:00pm PST times, the cause ("routine internal deployment"), and the recovery steps (new hardware, rate-limited reconnection).
