---
id: 1
title: "My browser agent died on a function name it never wrote"
dek: "esbuild bakes a __name helper into serialized function source. Inside the page, __name doesn't exist."
date: 2026-08-06
time_lost:
root_cause: leaky-abstraction
detected_by: manual-testing
stack: [typescript, esbuild, tsx, playwright, cdp]
rule: "A function you hand to another runtime is not the function you wrote. Ship a string you authored."
---

# #001 — My browser agent died on a function name it never wrote

I was building a browser agent that attaches to my already-logged-in Chrome over CDP and reads the
page. The step that tags every clickable element threw — inside the page, not in Node:

```
ReferenceError: __name is not defined
```

Nothing in my code is called `__name`. I never wrote it, never imported it, and grepping the repo
for it returned nothing.

## What I thought was wrong

I assumed the page was rejecting my injected code — a CSP rule, or an isolated world where my
helpers hadn't loaded. So I went looking at the target site's headers and at how CDP sets up
execution contexts. All of that was fine, which is what made it confusing: the error named a symbol
that existed nowhere in my source.

## What was actually wrong

`page.evaluate(fn)` does not send your function. It calls `fn.toString()` and ships the **source
text**, which the page then evaluates in its own global scope.

I was running TypeScript through `tsx`. To keep stack traces readable, esbuild rewrites function
expressions to attach a name — roughly:

```js
var collect = __name(function (max) { /* ... */ }, "collect")
```

`__name` is a helper esbuild defines once at the top of the **module**. `toString()` hands you the
function body — which calls `__name` — but not the helper that defines it. In the page, that
identifier has never existed.

The leak: `.toString()` returns the *compiled* source, not the source I wrote. My build step was
invisible to me right up until it crossed a runtime boundary.

## The fix

Stop handing it a function. Keep the collector as a raw JS string the compiler never touches, and
evaluate that:

```js
const SRC = `function (max) { /* plain JS — no TS syntax in here */ }`
await page.evaluate(`(${SRC})(${max})`)
```

Ugly, and unavoidable. The string is the only thing esbuild can't help me with.

## The rule

> A function you hand to another runtime is not the function you wrote — it's whatever your
> compiler left behind. If it has to cross the boundary, ship a string you authored.

Anything that stringifies a function and evaluates it elsewhere has this waiting: `page.evaluate`,
`new Worker(URL.createObjectURL(...))`, sandboxed `eval`, job queues that serialize handlers. The
compiler is invisible until it isn't.

What's the weirdest error you've debugged that named something you never wrote?
