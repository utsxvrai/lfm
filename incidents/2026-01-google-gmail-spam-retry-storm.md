---
title: "A brief backend failure set off a retry storm that left Gmail's spam checks failing for 4 hours 53 minutes"
dek: "A component in Gmail's mail-processing pipeline failed temporarily. The retry mechanism built to ride out exactly that kind of blip generated so much traffic that it overloaded the spam-checking systems. Promotions landed in Primary, spam warnings appeared on mail from known senders, and messages were delayed."
date: 2026-01-24
company: Google
kind: outage
topics: [cascading-failure, capacity, dependency]
stack: [gmail]
duration_min: 293
impact: "For 4 hours and 53 minutes, Gmail had high failure rates in spam checking: users saw 'not scanned for spam' banners, promotional and social mail landed unlabelled, and some delivery was delayed by up to about 10 minutes."
detected_by: alert
rule: "Retries are load. Budget them, cap them at the top of the stack, and make sure a temporary failure can't turn into a sustained multiple of normal traffic."
postmortem: https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ
sources: [https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ, https://techcrunch.com/2026/01/24/gmail-is-having-issues-with-spam-and-misclassification/, https://9to5google.com/2026/01/24/gmail-promotional-filter-broken/]
---

# A brief backend failure set off a retry storm that left Gmail's spam checks failing for 4 hours 53 minutes

On Saturday morning, 24 January 2026, Gmail inboxes started looking wrong. Mail that normally lands in Promotions, Social or Updates showed up in Primary. Messages from known senders carried a spam warning. TechCrunch's Anthony Ha wrote that his [Primary inbox was filled with messages](https://techcrunch.com/2026/01/24/gmail-is-having-issues-with-spam-and-misclassification/) that would normally go to the other tabs, and quoted users complaining that Gmail's filters seemed "suddenly completely busted". 9to5Google, whose own staff saw it, reported that [no new emails seemed to have been filtered](https://9to5google.com/2026/01/24/gmail-promotional-filter-broken/) into the Promotions and Updates tabs since the problem began.

The banner users saw, as quoted in [Google's incident report](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ), read: "Be careful with this message. Gmail hasn't scanned this message for spam, unverified senders, or harmful software."

Google's report says Gmail experienced high failure rates in spam checking [for 4 hours and 53 minutes](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ), from 05:02 to 09:55 US/Pacific. The cause wasn't the spam system itself. It was the way the rest of the pipeline responded when something underneath it briefly failed.

## What happened

From Google's [incident report and status updates](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ), times in US/Pacific on 24 January:

- **05:02.** Impact begins: spam checking starts failing at a high rate.
- **05:12.** Google engineers are alerted by automated monitoring and begin investigating. They find high error rates and latency across the classification pipeline.
- **16:34 UTC** (the dashboard's own timestamp). First public status update listed on the dashboard, warning users about the "not scanned" banner.
- **09:55.** Issue resolved for most users.

The public updates through the rest of Saturday still said "We are experiencing an issue". The update saying the classification problem was resolved "as of" 09:55 was posted at 01:28 UTC on 25 January. It added that [misclassified spam warnings may persist](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ) on messages received before the fix. Google published a preliminary report on 30 January and the final one on 6 February.

## What the engineers believed

The report is unusually direct about the assumption that failed. A retry mechanism was [designed to handle such transient failures](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ). That's the standard belief behind every retry loop: if a call fails because of a blip, trying again a moment later will succeed, and the user never notices.

That belief is usually right. For one request against a briefly unhealthy dependency, a retry is the correct move. The trouble is that it was true of each request individually and false for the system as a whole.

## What was actually going on

Google's root cause, in its own words: an overload of Gmail's spam checking systems, ["triggered by a temporary failure in a backend service. This led to a cascading failure due to excessive retries."](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ)

The report breaks it into three steps:

- **Trigger.** A backend component in Gmail's mail processing pipeline, responsible for analysing incoming messages, had a temporary problem.
- **Cause.** "While the initial error was temporary, the system's response to it caused the impact." The retry mechanism generated a ["massive and sustained volume of retry traffic"](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ), and this retry storm overwhelmed the capacity of multiple backend systems for several hours.
- **Effect.** Overloaded spam-checking services meant not all incoming mail was fully classified, and some mail was delayed. To protect users from possibly malicious content, Gmail showed the warning banner on affected messages.

The two reports describe the trigger slightly differently. The [preliminary report](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ) says the component "demonstrated increased latency"; the final report says it had "a temporary error". Neither names the component or says what went wrong with it.

```diagram
title: how a blip became an outage
flow: backend blips -> requests fail -> retry succeeds
flow!: backend blips -> retries multiply -> spam checks overload -> mail unclassified
note: each retry is reasonable on its own; together they are a new load spike
```

*Background (not from Google's report):* a retry storm works like this. Normal traffic is N requests per second. A dependency slows down or errors, so each caller retries, maybe several times, maybe at several layers of the stack. Now the struggling dependency is getting several times N, exactly when it has the least capacity to spare. If the extra load keeps it unhealthy, the retries never stop failing, and the system settles into an overloaded state even after the original trigger has gone away. That's what "sustained" means in Google's description. The fix has to remove load, because the cause is no longer there to fix.

Gmail's design choice when classification failed is worth noting. It didn't hold mail until spam checks recovered, and it didn't silently deliver unchecked mail. It delivered with a warning banner. Google says there were [no instances of lost emails](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ) during the incident. The visible cost was the inbox chaos: no category labels, so promotional mail landed in Primary.

## How they fixed it

Google's [mitigations](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ) fall into three groups:

- **More capacity.** Resources were increased for the spam classification services and related components, including a "significant, emergency increase of resources" for a backend service responsible for abuse detection.
- **Less load.** Engineers temporarily disabled certain non-essential functionality to free up headroom. The preliminary report adds that they deployed an emergency configuration disabling a specific message analysis feature, expected to lower the error rate.
- **Fewer retries.** The team changed the retry logic in the mail delivery system. The preliminary report says this meant reducing the number of retries and adding emergency rate limiting for retries, ["applied at the top of the stack"](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ), which helped shed load quickly so backend services could recover.

The last point is the one that matters. Adding capacity to a service caught in a retry storm helps only if capacity grows faster than the retries do. Cutting the retries at the top of the stack removes the multiplier at its source.

## What changed afterwards

Google's [action items](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ):

- **Enhanced emergency controls**, including temporary manual traffic-tuning overrides for faster recovery.
- **Criticality-aware load shedding** across the spam system, so it protects itself under overload instead of failing everything equally.
- **Tuned message delivery retries**, so the delivery system doesn't overwhelm downstream services.
- **Improved deadline propagation**, so service deadlines are correctly passed down and honoured across the spam classification stack.
- **Reshaped processing tasks**, with more memory and compute per anti-abuse system to absorb spikes.

Deadline propagation is the subtle one *(my interpretation; Google doesn't explain it)*. If a caller has already given up on a request, any work done further down the stack for that request is wasted, and during an overload that wasted work competes with requests that could still succeed. Passing the deadline down lets each layer drop work nobody is waiting for.

## A note on the numbers

The reports aren't fully consistent on delays. The final report says delays were [up to 10 minutes or less](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ), and elsewhere "generally up to 10 minutes". The preliminary report says delays were "majorly between 5 to 10 minutes". Google gives no count of affected users or messages, so this post doesn't either.

## The rule

Every retry is a bet that the next attempt will find the dependency healthier than the last one. When the dependency is overloaded, retries make that bet less likely to pay off. Budget retries per request and per service, cap them where the traffic enters the system, and make sure you can turn them down in an emergency. Google's fix, rate limiting retries at the top of the stack, is the control that should exist before the incident, not one built during it.

## Sources

- [Google Workspace Status Dashboard, Gmail incident of 24 January 2026](https://www.google.com/appsstatus/dashboard/incidents/NNnDkY9CJ36annsfytjQ): Google's status updates, preliminary incident report (30 January 2026) and final incident report (6 February 2026), covering root cause, timeline, mitigations and action items.
- [Anthony Ha, "Google says it's fixed Gmail issues with spam and misclassification", TechCrunch, 24 January 2026](https://techcrunch.com/2026/01/24/gmail-is-having-issues-with-spam-and-misclassification/): contemporaneous report of user-visible symptoms.
- [Andrew Romero, "Gmail's automatic filters were broken, but Google says it's been fixed", 9to5Google, 24–25 January 2026](https://9to5google.com/2026/01/24/gmail-promotional-filter-broken/): contemporaneous report on the Promotions and Updates filters failing.
