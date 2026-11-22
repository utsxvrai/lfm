---
title: "Shellshock: bash ran whatever followed a function in an environment variable"
dek: "To pass shell functions to child processes, bash stored them in environment variables and evaluated them at startup. It kept evaluating past the end of the function, and CGI copies HTTP headers straight into environment variables."
belief: "Bash assumed function-like env vars came from bash itself. CGI put HTTP headers there, and bash ran them."
date: 2014-09-24
company: GNU
kind: security-breach
topics: [security, software-bug]
stack: [bash, cgi, apache, openssh]
impact: "CVE-2014-6271: remote code execution through bash, exploitable over the network in many common configurations including CGI scripts and OpenSSH forced commands."
detected_by: third-party
rule: "Never feed untrusted data to a general-purpose evaluator and hope it only does the narrow thing you wanted. Parse exactly the shape you expect and reject the rest."
postmortem: https://seclists.org/oss-sec/2014/q3/649
sources: [https://seclists.org/oss-sec/2014/q3/649, https://seclists.org/oss-sec/2014/q3/650, https://seclists.org/oss-sec/2014/q3/651, https://seclists.org/oss-sec/2014/q3/655, https://seclists.org/oss-sec/2014/q3/656, http://ftp.gnu.org/pub/gnu/bash/bash-4.3-patches/bash43-025]
---

# Shellshock: bash ran whatever followed a function in an environment variable

On 24 September 2014, Florian Weimer posted a four-sentence message to the oss-security mailing list. Stephane Chazelas had found a bug in how bash processes environment variables: ["trailing code in function definitions was executed, independent of the variable name."](https://seclists.org/oss-sec/2014/q3/649) The next sentence is what made it an emergency: ["In many common configurations, this vulnerability is exploitable over the network."](https://seclists.org/oss-sec/2014/q3/649)

The bug is CVE-2014-6271, widely known as Shellshock. Bash is the default shell on a huge number of Unix systems. Web servers start it, SSH starts it, and so do the `system()` calls in many scripting languages. Any of those that put attacker-controlled text into an environment variable before starting bash would run the attacker's commands.

This post walks through how a feature for passing functions to child processes turned into remote code execution.

## What happened

According to a later message in the same thread, Debian and other GNU/Linux vendors had pre-notified selected parties under embargo, with public disclosure [scheduled for Wednesday, 2014-09-24 14:00 UTC](https://seclists.org/oss-sec/2014/q3/650). Vendors received patches in advance. Network-filtering vendors were told about the issue but asked not to distribute IDS/IPS signatures yet. Weimer then posted the full text of that pre-notification to the list, because, as he wrote, someone had already published [large parts of it as a news article](https://seclists.org/oss-sec/2014/q3/650).

Upstream patches from the bash maintainer, Chet Ramey, were listed in that same message, covering [every release series from bash 3.0 to 4.3](https://seclists.org/oss-sec/2014/q3/650). Ramey later described them as covering ["all bash versions back 15 years or so"](https://seclists.org/oss-sec/2014/q3/655).

Within hours, people on the list confirmed more ways to exploit it. Solar Designer showed it working [through OpenSSH via `SSH_ORIGINAL_COMMAND`](https://seclists.org/oss-sec/2014/q3/651), even for an account restricted to a forced command.

## What the engineers believed

The underlying feature is old and reasonable. Bash lets you `export -f` a function so that child bash processes can use it. Environment variables are the only channel that reliably passes from a parent process to a child across `exec`, so bash used them.

The pre-notification describes the encoding. Bash used ["an environment variable named by the function name, and a function definition starting with '() {'"](https://seclists.org/oss-sec/2014/q3/650) as its value. When a new bash process starts, it scans its environment. If a value starts with `() {`, bash treats it as an exported function and defines it.

The assumption behind this: every variable that looks like a function was put there by another bash process exporting a function. That held for a long time. Then the web started copying request data into environment variables, and the assumption stopped matching reality.

## What was actually going on

### Bug one: the importer ran a full evaluator

The easiest way to turn `myfunc='() { echo hi; }'` back into a function is to rebuild the source text `myfunc () { echo hi; }` and hand it to bash's own parser and executor. Running that defines the function, which is what you want.

But a general-purpose evaluator does more than define functions. It runs every command in the string. The pre-notification puts it directly: ["bash does not stop after processing the function definition; it continues to parse and execute shell commands following the function definition."](https://seclists.org/oss-sec/2014/q3/650) Its example:

```
VAR=() { ignored; }; /bin/id
```

This runs `/bin/id` as soon as bash imports its environment, before any script has even started. The pre-notification notes that the process is in a "slightly undefined state" at that point and bash might crash afterwards, but ["the damage has already happened"](https://seclists.org/oss-sec/2014/q3/650).

The upstream patch shows where the problem was. Patch `bash43-025` adds two new flags to the string-evaluation routine, `SEVAL_FUNCDEF` ("only allow function definitions") and `SEVAL_ONECMD` ("only allow a single command"), and adds both to the call in `variables.c` that imports a function from the environment, `parse_and_execute (temp_string, name, SEVAL_NONINT|SEVAL_NOHIST)` ([bash43-025](http://ftp.gnu.org/pub/gnu/bash/bash-4.3-patches/bash43-025)). So before the patch, importing a function meant evaluating the string with the full evaluator, and it would run anything.

### Bug two: the variable name didn't matter

If bash had only imported variables that it had clearly exported itself, the attack surface would have been small. Instead, *any* variable whose value began with `() {` was treated as a function, whatever its name. Weimer called this out explicitly: an environment variable ["with an arbitrary name can be used as a carrier"](https://seclists.org/oss-sec/2014/q3/650), and that is what made network exploitation possible.

### The bridge: CGI turns HTTP into environment variables

CGI is one of the oldest ways to run dynamic web content. The web server receives a request, puts the request details into environment variables, and execs a script. The pre-notification explains that the CGI specification [maps all parts of the request to environment variables](https://seclists.org/oss-sec/2014/q3/650). With Apache httpd, an attacker could put the magic string in:

- the `Host` header, which becomes `REMOTE_HOST`
- any custom header value, so `Custom: ...` becomes `HTTP_CUSTOM`
- the protocol string, which becomes `SERVER_PROTOCOL`

Other CGI implementations might also expose the request method, the path or the query string.

Now put the pieces together. The attacker sends `User-Agent: () { :; }; <command>`. The web server copies it into `HTTP_USER_AGENT`. The CGI program is a bash script, or it calls bash somewhere along the way. Bash starts, scans its environment, sees a value starting with `() {`, evaluates it, and runs the command. The script never gets to execute a line of its own.

```diagram
title: how a header becomes a command
flow: HTTP header -> CGI env var -> bash starts
flow!: value starts "() {" -> full evaluator -> trailing cmd runs
note: the variable name is irrelevant
```

### Bash runs in more places than you'd expect

You didn't need to write a bash CGI script to be exposed. Another message in the thread pointed out that on Linux systems where `/bin/sh` is a symlink to bash, [any `popen()` / `system()` call from languages like PHP](https://seclists.org/oss-sec/2014/q3/656) is a concern, because the `HTTP_*` variables are still in the environment. Both of those calls run commands through `/bin/sh`.

OpenSSH was the other main vector, through [AcceptEnv variables, TERM or SSH_ORIGINAL_COMMAND](https://seclists.org/oss-sec/2014/q3/650). Solar Designer's demonstration used an account whose authorized key was limited to a forced command. Connecting with `'() { ignored; }; /usr/bin/id'` as the requested command [ran `id` anyway](https://seclists.org/oss-sec/2014/q3/651). He noted that unsetting the variable from inside the forced command doesn't help: "we'd need to unset the variable before starting bash, not from bash." By then bash has already imported its environment.

## How they fixed it

There was no good workaround. When someone on the list asked about mitigations, Chet Ramey agreed ["there is not a good workaround"](https://seclists.org/oss-sec/2014/q3/655) and said the best path was to apply the published patches as quickly as possible.

The patch report describes the bug as: "Under certain circumstances, bash will execute user code while processing the environment for exported function definitions" ([bash43-025](http://ftp.gnu.org/pub/gnu/bash/bash-4.3-patches/bash43-025)). With the new flags, the evaluator still runs on the imported string, but it now refuses anything that isn't a function definition and stops after one command. If the parsed command isn't a function definition, it emits the warning "ignoring function definition attempt" and bails out.

Note what kind of fix this is. The evaluator still runs on untrusted input. It just runs in a narrower mode. The sources here don't cover what happened after this first patch, so this post doesn't either.

## What changed afterwards

The sources for this post are the disclosure thread and the first upstream patch. They don't document longer-term changes to how bash imports functions, so this post doesn't describe any. What the thread does make clear is how disclosure ran: an embargo with a set time, patches to vendors ahead of time, a heads-up to network-filtering vendors, and then full public details on oss-security when a partial leak forced the issue ([oss-sec](https://seclists.org/oss-sec/2014/q3/650)).

## The rule

The bug wasn't really a missing check. It was a design choice: reuse the full interpreter to deserialize a value. "Parse this text as code" is the easiest way to load a structure written in your own language, and it's dangerous whenever the text might not have come from you. The pattern shows up a lot: `eval` on JSON-ish strings, YAML loaders that build arbitrary objects, template engines that evaluate expressions, `pickle` on network input.

There's a second lesson about trust boundaries that move. The function-export encoding was designed when environment variables came from a parent bash process. CGI later made them carry text from strangers on the internet, and nobody revisited the old assumption. When a new caller starts feeding your input from a less trusted place, every parser downstream is now exposed to that input.

## Sources

- [oss-security, "CVE-2014-6271: remote code execution through bash", Florian Weimer, 24 Sep 2014](https://seclists.org/oss-sec/2014/q3/649): the public announcement.
- [oss-security, Florian Weimer follow-up](https://seclists.org/oss-sec/2014/q3/650): the upstream patch links and the full pre-notification text, with the technical explanation, the disclosure schedule and the CGI/OpenSSH attack vectors.
- [oss-security, Solar Designer follow-up](https://seclists.org/oss-sec/2014/q3/651): exploitation through OpenSSH `SSH_ORIGINAL_COMMAND` with a forced command.
- [oss-security, Chet Ramey reply](https://seclists.org/oss-sec/2014/q3/655): the bash maintainer confirming there is no good workaround besides patching.
- [oss-security, follow-up on popen()/system()](https://seclists.org/oss-sec/2014/q3/656): exposure through `/bin/sh` symlinked to bash.
- [GNU bash patch bash43-025](http://ftp.gnu.org/pub/gnu/bash/bash-4.3-patches/bash43-025): the upstream fix for bash 4.3, with its bug description and the new `SEVAL_FUNCDEF` / `SEVAL_ONECMD` flags.
