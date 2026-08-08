---
title: NoCheatCode
tagline: A LeetCode debugger that refuses to give you the answer — it only asks questions.
stack: [javascript, chrome-extension, supabase, razorpay]
status: shipped
year: 2026
featured: true
---

# NoCheatCode

A Chrome extension that sits next to a LeetCode problem and debugs it Socratically:
it will ask you what your loop invariant is, what happens on an empty input, why
you chose that data structure. It will not write the solution. That constraint is
the entire product — every other AI coding helper is optimising for the opposite.

Built as a full micro-SaaS rather than a toy: auth, voice input, usage metering,
Razorpay billing, and Supabase with row-level security so a user can only ever
read their own rows.

Deliberately plain vanilla JS with no build step. For a Manifest V3 extension the
bundler mostly buys you problems — content scripts, service workers and CSP all
behave more predictably when the file you wrote is the file that runs.
