---
title: "20,000 spaces and a trim regex took Stack Overflow down for 34 minutes"
dek: "A post with about 20,000 consecutive whitespace characters made a harmless-looking trailing-whitespace regex do quadratic work on every home page view. The home page was also the load balancer's health check, so every server was pulled from rotation."
belief: "Stack Exchange's trailing-whitespace regex looked linear. 20,000 spaces made it quadratic and took the site down."
date: 2016-07-20
company: Stack Exchange
kind: outage
topics: [regex, software-bug, cascading-failure]
stack: [regex, load-balancer]
duration_min: 34
impact: "A 34-minute outage of Stack Overflow and the Stack Exchange network starting at 14:44 UTC."
rule: "Any regex that runs on user input needs a known worst case. If a backtracking engine can be made to do quadratic work, it eventually will. Use plain string code or a linear-time engine instead."
postmortem: https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016
sources: [https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016]
---

# 20,000 spaces and a trim regex took Stack Overflow down for 34 minutes

On 20 July 2016, Stack Exchange had a [34-minute outage starting at 14:44 UTC](https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016). Stack Overflow was unreachable for the duration.

There was no attack, no bad deploy and no failed database. Somebody had submitted a post with a code comment followed by about [20,000 consecutive whitespace characters](https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016). The post showed up on the home page. A regular expression meant to trim whitespace from the ends of lines ran on it every time anyone loaded the home page, and each of those runs did hundreds of millions of steps.

The postmortem breaks down the 34 minutes as [10 minutes to identify the cause, 14 minutes to write the fix and 10 minutes to roll it out](https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016) until Stack Overflow was available again.

## What happened

From the [postmortem](https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016):

1. A malformed post contained about 20,000 consecutive whitespace characters on a comment line that began `-- play happy sound for player to enjoy`. The postmortem adds: "For us, the sound was not happy."
2. The post appeared in the home page list, so the expensive regex ran **on every home page view**.
3. CPU on the web servers spiked and the home page stopped responding quickly enough.
4. The home page was **the load balancer's health check**. When it got slow, the load balancer took the servers out of rotation, and the whole site went down.
5. Engineers found the cause, replaced the regex with a substring function and rolled out the fix.

## What the engineers believed

The regex was:

```
^[\s‌]+|[\s‌]+$
```

It trims Unicode whitespace (plus `‌`, the zero-width non-joiner) from the start and end of a line. That's a common job, and a regex is a common way to do it. The postmortem simplifies it to `\s+$` and notes it ["to a human looks easy ('all the spaces at the end of the string')"](https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016).

The natural assumption is that this is a linear scan: walk the string and drop the spaces at the end. That's how a person would do it, and it's what the regex appears to say. On ordinary text, with a few trailing spaces or none, it is fast. The assumption only breaks on a long run of whitespace that **isn't** at the end.

Separately, the health-check design assumed that if the home page is slow, the server is unhealthy. Most of the time that's a reasonable proxy.

## What was actually going on

### How a backtracking engine runs `\s+$`

Most regex engines in mainstream languages are backtracking engines. Given a pattern without a leading anchor, they try a match at position 0. If that fails, they try position 1, then position 2, and so on through the string. At each starting position they explore the pattern greedily and back up when something fails to match.

Take a string with 20,000 spaces followed by one non-space character, like `x`, and run `\s+$` on it:

- **Start at position 0.** `\s+` greedily consumes all 20,000 spaces. Then `$` has to match end-of-string, but the next character is `x`, so it fails. The engine backtracks and tries `\s+` with fewer spaces, and `$` fails each time. The attempt from position 0 fails.
- **Start at position 1.** The same thing happens over 19,999 spaces.
- **Start at position 2.** 19,998 spaces.
- …and so on, down to 1.

The postmortem describes this the same way: after the 20,000th space there's a character that isn't a space or the end of the string, so the engine ["backtracks, and tries matching \s+$ starting from the second space, checking 19,999 characters"](https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016), then the third, and so on. It counts the work as 20,000 + 19,999 + 19,998 + … + 1 character-class checks and gives the figure as [199,990,000](https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016). (The exact sum of 1 to 20,000 is 200,010,000. Either way, about two hundred million checks per page view.)

That's **O(n²)** in the length of the whitespace run. The postmortem is careful to say it is ["not classic catastrophic backtracking"](https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016), which is exponential and caused by nested quantifiers such as `(a+)+`. Quadratic is still enough. Double the whitespace and the cost goes up four times. At 20,000 characters, one regex call takes long enough to matter, and the home page made that call on every request.

```diagram
title: why \s+$ is quadratic
flow: 20k spaces + "x" -> start at 0 -> 20k checks, fail
flow!: start at 1, 2, 3 -> 20k + 19,999 + ... -> ~200M checks
note: each start position rescans the rest of the run
```

The fact that the whitespace was **not** at the end matters. If those 20,000 spaces had been at the end of the string, `\s+$` would match from position 0 on the first attempt and stop. The worst case needs a long run of whitespace followed by something else. The comment line in the post was exactly that shape.

### Why one slow page took down the whole site

A slow home page alone would have meant a slow home page. What turned it into a site-wide outage was the health check.

The load balancer checked each web server's health by requesting the home page. Once the home page was slow, every server failed its check, and the load balancer [took the servers out of rotation](https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016). Every server served the same home page with the same post, so they all failed at the same time.

Stack Exchange's own assessment: ["we believe everything but the home page would have been accessible if it wasn't for the the health check"](https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016). In other words, the servers could still serve other pages. The health check was measuring the one page that was broken and treating that as the state of the whole server.

This is a common mistake. A health check that renders a real, data-dependent page is checking the *data* as well as the *server*. When the data is bad, every server fails together, and the load balancer, which is meant to route around failures, routes around everything.

## How they fixed it

The postmortem says ["This regular expression has been replaced with a substring function."](https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016) It doesn't show the code. The general idea of a substring-based trim is: scan inward from each end while the character is whitespace, then take the substring between the two positions. Each character is looked at at most once, so the cost is linear however the whitespace is arranged.

## What changed afterwards

The postmortem lists three follow-up actions:

- **Audit regular expressions and the post validation workflow** for similar issues.
- **Add a control to the load balancer to disable the health check**, since everything except the home page would likely have stayed up without it.
- **Write a "what to do during an outage" checklist**, because the StackStatus Twitter notification [went out later than they would have liked](https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016).

## The rule

Treat every regex that runs on user input as code with a worst-case cost, and know what that cost is. A backtracking engine on an unanchored pattern with a greedy quantifier and a failing tail (`\s+$`, `.*foo`, `(\w+\s?)+$`) can be pushed into quadratic or worse behavior by input shaped the right way, and an open internet will eventually send that shape. For simple jobs like trimming, splitting or prefix checks, plain string functions are clearer and linear. For real pattern matching on untrusted input, a linear-time engine such as RE2, or a hard limit on input length or match time, puts a ceiling on the damage. (Those options are general practice. The postmortem itself only mentions the substring replacement.)

Separately: health checks should check the process, not the content. A dedicated lightweight endpoint that confirms the process is alive and its essential dependencies respond won't fail just because one piece of user content is pathological. And when one bad input can make *every* server fail its check at once, the load balancer will take the whole site out of rotation.

## Sources

- [Stack Exchange, "Outage Postmortem - July 20, 2016", stackstatus.net (archived)](https://web.archive.org/web/20160720211156/http://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016): the official postmortem, covering the timeline, the regex, the backtracking analysis, the health-check cascade and the follow-up actions.
