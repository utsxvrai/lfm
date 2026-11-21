---
title: "A bug in a config generator took Gmail, Calendar and Docs down for 25 minutes"
dek: "An internal system that writes configuration for other systems produced a bad config, and it rolled out to live services over 15 minutes. The services did exactly what the config told them: ignore users' requests for their data."
date: 2014-01-24
company: Google
kind: outage
topics: [config-change, software-bug, automation]
stack: [gmail, google-calendar, google-docs]
duration_min: 25
impact: "Most users of logged-in Google services like Gmail, Google+, Calendar and Documents couldn't access them for about 25 minutes; about 10% of users for up to 30 minutes longer."
detected_by: alert
rule: "Generated config is code. Validate it before it ships, and roll it out in stages that can be stopped."
postmortem: https://googleblog.blogspot.com/2014/01/todays-outage-for-several-google.html
sources: [https://googleblog.blogspot.com/2014/01/todays-outage-for-several-google.html]
---

# A bug in a config generator took Gmail, Calendar and Docs down for 25 minutes

On January 24, 2014, most people who tried to use Google's logged-in services, including Gmail, Google+, Calendar and Documents, found they couldn't. For most users it lasted [approximately 25 minutes](https://googleblog.blogspot.com/2014/01/todays-outage-for-several-google.html). For [about 10 percent of users](https://googleblog.blogspot.com/2014/01/todays-outage-for-several-google.html), the problem lasted up to 30 minutes longer.

Google's explanation, posted the same day by Ben Treynor, VP of Engineering, is short. A system whose job is to produce configuration for other systems hit a software bug and produced a bad one. That config was rolled out to live services, which then ignored users' requests for their own data.

The postmortem doesn't say what the bad configuration contained or which system generated it. What it does give is a precise timeline and a clear failure pattern that shows up in nearly every large system: **the thing that broke wasn't a service, it was the input to all of them.**

## What happened

From [Google's post](https://googleblog.blogspot.com/2014/01/todays-outage-for-several-google.html), all times PST:

- **10:55 a.m.:** an internal system that generates configurations hit a software bug and generated an incorrect configuration.
- **Over the next 15 minutes:** the incorrect configuration was sent to live services. It caused users' requests for their data to be ignored, and the services generated errors.
- **11:02 a.m.:** users began seeing errors. Internal monitoring alerted Google's Site Reliability team at the same time.
- **11:14 a.m.:** while engineers were still debugging, the same generator, having automatically cleared the original error, produced a new, correct configuration and began sending it. Errors subsided rapidly.
- **11:30 a.m.:** the correct configuration was live everywhere and almost all users' service was restored.

## What the engineers believed

The post doesn't describe anyone's expectations, so this section is about the general design belief rather than a person's.

Configuration generators exist because hand-written config doesn't scale. At Google's size, which services run where, which backends serve which users, and how requests are routed are computed by programs from higher-level descriptions. The implicit belief behind such systems is that **the generator is infrastructure, and its output can be trusted the way a compiler's output is trusted.** People review the inputs and the generator's code. The output is assumed to be a faithful translation.

There's also a second, quieter belief: that the services consuming config will notice if it's nonsense. In practice, a well-formed config that says something harmful (route nothing here, serve no one) looks just as valid to the consumer as a correct one.

## What was actually going on

### Why generated config is a single point of failure

Picture the architecture the post implies. One system produces configuration. Many live services consume it. When the producer emits something wrong, every consumer acts on it, at roughly the same time, with no independent check of its own.

That's why one bug touched Gmail, Google+, Calendar and Docs together. It wasn't four outages. It was one bad artifact delivered to many services. Shared config is a dependency every service has, even though it doesn't show up as a network call in anyone's architecture diagram.

```diagram
title: one generator, many consumers
flow: generator -> valid config -> users served
flow!: generator bug -> bad config to all -> requests ignored
note: the services were healthy; their instructions weren't
```

### Why the config was "valid" enough to ship

The post says the bad configuration [caused users' requests for their data to be ignored](https://googleblog.blogspot.com/2014/01/todays-outage-for-several-google.html). It doesn't say how, so the following is interpretation. For a config to be accepted and acted on, it had to be syntactically correct and pass whatever checks existed. The failure was semantic: the config was well-formed but described a world where user requests shouldn't be handled. This is the hard class of config bug. A missing field or a parse error is easy to catch. A config that is perfectly legal and simply says the wrong thing is caught only by checks that understand what "reasonable" looks like. Google's own follow-up, which adds input validation so a bad generated config ["will not result in service disruption"](https://googleblog.blogspot.com/2014/01/todays-outage-for-several-google.html), suggests such checks were missing or incomplete.

### What the 15-minute rollout did and didn't do

The incorrect configuration was sent out [over the next 15 minutes](https://googleblog.blogspot.com/2014/01/todays-outage-for-several-google.html). That means the push wasn't instantaneous; it spread. A staged rollout is supposed to be a safety net: ship to a small slice, watch, and stop if things go wrong. But staging only helps if something watches each stage and has authority to halt it. Here, users started seeing errors at 11:02, seven minutes into the rollout, and the rollout continued. The post doesn't say whether the rollout had automated health gates. The timeline suggests the spread wasn't stopped before it completed.

### Why it fixed itself

The recovery is the oddest part. Engineers were still debugging when the generator ["having automatically cleared the original error"](https://googleblog.blogspot.com/2014/01/todays-outage-for-several-google.html) produced a correct config at 11:14 and began sending it. The post doesn't explain what the error condition was or why it cleared. The likely reading is that the generator runs continuously or periodically, and whatever transient condition triggered the bug was gone on the next run.

That self-healing cut the outage short, but it's not a recovery plan. It means the time to fix depended on when the generator happened to run cleanly again, not on anyone's action. Google's response focuses on that gap too: one of its two goals was ["speeding up recovery when a problem does occur."](https://googleblog.blogspot.com/2014/01/todays-outage-for-several-google.html)

### Why 10% of users took longer

The post says the good config was live everywhere by 11:30 a.m. and the 10% of users with longer impact were affected for up to 30 minutes more. It doesn't explain the split. A reasonable assumption is that the rollout of the corrected config was staged as well, so some users were served by parts of the fleet that got the fix later. That's interpretation, not something the post states.

## How they fixed it

Strictly, nobody fixed this incident by hand. The generator produced a correct config on its own at 11:14, and its rollout finished by 11:30. Engineers were debugging in parallel, alerted by internal monitoring at 11:02.

## What changed afterwards

Google listed [three steps](https://googleblog.blogspot.com/2014/01/todays-outage-for-several-google.html) for the following days:

1. **Fix the bug** in the configuration generator, and audit all other critical configuration generation systems for a similar bug.
2. **Add input validation checks for configurations**, so a bad generated config in the future won't cause service disruption.
3. **Add targeted monitoring** to detect and diagnose the cause of service failure more quickly.

The second item is the one with the widest reach. It moves the defense from "the generator must never be wrong" to "the system must survive the generator being wrong." Concrete versions for any team:

- **Validate semantics, not just syntax.** Compare a new config to the current one. If it drops most backends, removes most routes, or changes far more than a typical push, refuse it and alert.
- **Stage and gate rollouts.** Ship generated config to a small fraction of the fleet first, compare error rates, and halt automatically on regression.
- **Make last-known-good sticky.** A consumer that receives a config it can't sensibly use should keep the previous one and complain, rather than apply it.
- **Know your shared inputs.** Map which services consume which generated configs, so a single generator's blast radius is a known number.

## The rule

A config generator is a compiler whose output deploys itself to production. Test its output like code, roll it out in stages that can stop on their own, and make sure every consumer can refuse a config that looks wildly different from the last one.

## Sources

- [Google Official Blog: Today's outage for several Google services (Ben Treynor, January 24, 2014)](https://googleblog.blogspot.com/2014/01/todays-outage-for-several-google.html): Google's postmortem with timeline and follow-up steps.
