---
title: "Zune 30GB players stopped working on the last day of a leap year"
dek: "A clock driver in Microsoft's 2006 Zune 30GB mishandled December 31, 2008, the 366th day of the year. The official fix was to wait for January 1 and let the battery run flat."
date: 2008-12-31
company: Microsoft
kind: bug
topics: [time-handling, software-bug]
stack: [zune, firmware, clock-driver]
impact: "A widespread issue hit 2006-model Zune 30GB devices on December 31, 2008; Microsoft said it would resolve itself as the date moved to January 1, 2009."
detected_by: customers
rule: "Any code that turns a day count into a date must be tested on the last day of a leap year, because that is the one day the 365 rule is wrong."
postmortem: https://learn.microsoft.com/en-us/archive/blogs/mthree/advisory-30gb-zune-issues-noted-today-related-to-time-and-the-leap-year
sources: [https://learn.microsoft.com/en-us/archive/blogs/mthree/advisory-30gb-zune-issues-noted-today-related-to-time-and-the-leap-year, https://web.archive.org/web/20090101141416/http://zuneinsider.com/archive/2008/12/31/30gb-zune-issues-official-update.aspx, https://web.archive.org/web/20090102032647/http://zuneinsider.com/archive/2008/12/31/30-gb-zune-issue-update.aspx]
---

# Zune 30GB players stopped working on the last day of a leap year

On the morning of December 31, 2008, Microsoft's Zune team learned from customers that something was wrong. In the words of the official update, [Microsoft was alerted by customers](https://learn.microsoft.com/en-us/archive/blogs/mthree/advisory-30gb-zune-issues-noted-today-related-to-time-and-the-leap-year) to "a widespread issue affecting our 2006 model Zune 30GB devices," a large number of which were still in active use.

The cause was found quickly: [a bug in the internal clock driver](https://learn.microsoft.com/en-us/archive/blogs/mthree/advisory-30gb-zune-issues-noted-today-related-to-time-and-the-leap-year) related to the way the device handles a leap year. 2008 was a leap year, so December 31 was its 366th day. The driver, Microsoft said, caused the device to improperly handle the last day of a leap year.

The fix was unusual. There was no patch and no firmware update. Microsoft told owners to wait: the problem would [resolve itself as the date moved to January 1, 2009](https://learn.microsoft.com/en-us/archive/blogs/mthree/advisory-30gb-zune-issues-noted-today-related-to-time-and-the-leap-year).

## What happened

The Zune team's first post on its Zune Insider blog that morning was short: they had been [made aware of a widespread issue](https://web.archive.org/web/20090102032647/http://zuneinsider.com/archive/2008/12/31/30-gb-zune-issue-update.aspx) facing owners of Zune 30 devices and had a technical team working to isolate it.

Microsoft's official statements don't describe what users saw. The comments under that first post do, and they are customer reports rather than Microsoft's words. Owners described players [locked up on the Zune logo or loading screen](https://web.archive.org/web/20090102032647/http://zuneinsider.com/archive/2008/12/31/30-gb-zune-issue-update.aspx) for hours, not responding to anything, with some saying it happened whether or not they had recently synced to a PC. Several asked the obvious question: how do you deliver an update to a device that can't boot?

Later that day, at 2:08 PM by the blog's timestamp, Paul Davidson of the Zune team posted an official update, which Microsoft's "mthree" blog republished in an [advisory on time and the leap year](https://learn.microsoft.com/en-us/archive/blogs/mthree/advisory-30gb-zune-issues-noted-today-related-to-time-and-the-leap-year). It identified the clock driver bug, gave the self-resolution timeline and answered a short Q&A. The [Zune Insider version](https://web.archive.org/web/20090101141416/http://zuneinsider.com/archive/2008/12/31/30gb-zune-issues-official-update.aspx) of the same update adds that the bug was in a driver for a part used only in the Zune 30.

The scope was narrow. The Zune service was unaffected, as were the [Zune 80, 120 and flash models](https://learn.microsoft.com/en-us/archive/blogs/mthree/advisory-30gb-zune-issues-noted-today-related-to-time-and-the-leap-year). Asked how many devices were affected and how many were sold, the Zune Insider update answered only that [all 30GB devices are potentially affected](https://web.archive.org/web/20090101141416/http://zuneinsider.com/archive/2008/12/31/30gb-zune-issues-official-update.aspx). It gives no count, so neither does this post.

## What the engineers believed

The sources don't describe the driver team's assumptions, so this section is about the general trap rather than this team's specific reasoning.

Calendar code is usually written and tested around the cases people think of: an ordinary day, the end of a month, the end of a year, February 29. Each of those has a clear test. The 366th day of a leap year is different. It is not February 29, which most leap-year tests target, and it is not the year boundary, which happens one day later. It's an ordinary-looking date that exists only once every four years, in a part of the year when nobody is thinking about leap days.

The 30GB Zune was a 2006 model. Before December 31, 2008, it had never lived through a December 31 of a leap year. The bug had been sitting in every device since it shipped, waiting for the one date that would trigger it.

## What was actually going on

### The day-count problem

Many embedded clocks don't store a calendar date. They count: seconds, or days, since some fixed starting point. Whenever the device needs a human date, a driver converts that count into a year, a month and a day.

The basic conversion for the year looks simple. Start from the base year and subtract whole years from the day count until what's left fits inside one year. Ordinary years take 365 days; leap years take 366. Whatever remains is the day of the current year.

The trap is the comparison. On every day of a normal year, and on days 1 to 365 of a leap year, an off-by-one in the boundary check is invisible: the subtraction still lands in the right place. Only on day 366 of a leap year does the choice between "greater than" and "greater than or equal to" decide anything.

### An illustration of how day 366 can hang a loop

Microsoft did not publish the Zune driver code, and nothing below should be read as the actual driver. It is a generic example of how this class of bug produces a device that stops responding rather than one that shows the wrong date:

```c
/* Illustrative only. Not the Zune driver. */
while (days > 365) {
    if (is_leap_year(year)) {
        if (days > 366) {
            days -= 366;
            year += 1;
        }
        /* days == 366: nothing changes, loop runs again forever */
    } else {
        days -= 365;
        year += 1;
    }
}
```

On day 366 of a leap year, `days > 365` is true, the year is a leap year, and `days > 366` is false. Neither `days` nor `year` changes, so the loop condition is still true and the code spins forever. If that loop runs during startup, the device never finishes booting. If it runs in a clock interrupt, nothing else gets to run. On every other day of every year, the same code works perfectly.

```diagram
title: why only one day breaks it
flow: day 1 to 365 -> subtract a year -> loop ends
flow!: day 366, leap year -> nothing subtracted -> loop never ends
note: an illustration of the bug class; Microsoft did not publish the driver
```

### Why waiting fixed it

Microsoft's answer to "why did this happen on December 31" was that the driver caused the device to [improperly handle the last day of a leap year](https://learn.microsoft.com/en-us/archive/blogs/mthree/advisory-30gb-zune-issues-noted-today-related-to-time-and-the-leap-year). That is consistent with a bug that only triggers on day 366: once the date becomes January 1, 2009, the count is day 1 of a non-leap year and the conversion works again.

That's why the instructions were about time and power rather than software. Microsoft said the internal clock would [automatically reset at noon GMT on January 1](https://learn.microsoft.com/en-us/archive/blogs/mthree/advisory-30gb-zune-issues-noted-today-related-to-time-and-the-leap-year). After that, owners should let the battery run fully out of power so the unit could restart successfully, then recharge it and turn it back on. Microsoft doesn't explain the choice of noon GMT; one plausible reading is that at noon GMT on January 1 it is January 1 in every time zone.

A device stuck in its own startup can't be reached by a software update, so a forced power cycle after the date had moved on was the only fix available.

## How they fixed it

The fix on the day was to wait for the date to change and power-cycle the device. There was one more cleanup step: Zune Pass subscribers [might need to sync with a PC](https://learn.microsoft.com/en-us/archive/blogs/mthree/advisory-30gb-zune-issues-noted-today-related-to-time-and-the-leap-year) to refresh the rights to subscription content they had downloaded.

## What changed afterwards

Commenters immediately asked the obvious follow-up: would the same thing happen again on December 31, 2012? The Zune Insider Q&A had already answered it. To "Will you update the firmware before the next leap year (2012)?" the answer was ["Yes."](https://web.archive.org/web/20090101141416/http://zuneinsider.com/archive/2008/12/31/30gb-zune-issues-official-update.aspx) The sources here don't say when that update shipped or what it changed, so this post doesn't either.

## The rule

Code that converts a count of days or seconds into a calendar date has a small number of boundary days where a wrong comparison stops being invisible. The last day of a leap year is one of them. Put December 31 of a leap year in the test suite next to February 29, and when a device clock can be set, actually set it there and boot.

## Sources

- [Microsoft, "Advisory: 30GB Zune issues noted today, related to time and the leap year" (December 31, 2008)](https://learn.microsoft.com/en-us/archive/blogs/mthree/advisory-30gb-zune-issues-noted-today-related-to-time-and-the-leap-year). Microsoft blog post republishing the Zune team's official update: cause, affected models, self-resolution timeline and recovery steps.
- [Zune Insider, "30gb zune issues -- official update" by Paul Davidson (December 31, 2008, via the Internet Archive)](https://web.archive.org/web/20090101141416/http://zuneinsider.com/archive/2008/12/31/30gb-zune-issues-official-update.aspx). The Zune team's original official update, including the Q&A noting the driver was for a part used only in the Zune 30.
- [Zune Insider, "30 GB Zune Issue Update" by Paul Davidson (December 31, 2008, via the Internet Archive)](https://web.archive.org/web/20090102032647/http://zuneinsider.com/archive/2008/12/31/30-gb-zune-issue-update.aspx). The Zune team's first acknowledgement that morning, with customer comments describing devices locked on the loading screen.
