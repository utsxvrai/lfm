---
title: "The 2010 Flash Crash: a sell algorithm that watched volume, not price"
dek: "A $4.1 billion sell program was set to trade 9% of the previous minute's volume, regardless of price. When high-frequency traders started passing contracts back and forth, volume spiked, the algorithm sold faster, and liquidity in the E-Mini fell to under 1% of its morning level."
date: 2010-05-06
company: US markets
kind: financial-loss
topics: [automation, cascading-failure]
stack: [e-mini, cme, spy, algorithmic-trading]
impact: "Major US equity indices fell a further 5-6% in minutes and rebounded; over 20,000 trades across more than 300 securities executed 60% or more away from their 2:40 p.m. prices and were later broken."
rule: "Never let an automated system use a signal it can inflate as its throttle. Volume is not liquidity, and an algorithm that ignores price can sell into a market that has stopped buying."
postmortem: https://www.sec.gov/news/studies/2010/marketevents-report.pdf
sources: [https://www.sec.gov/news/studies/2010/marketevents-report.pdf]
---

# The 2010 Flash Crash: a sell algorithm that watched volume, not price

On the afternoon of May 6, 2010, the US stock market fell off a cliff and climbed back up in minutes. According to the joint report by the staffs of the CFTC and the SEC, major equity indices that were already down over 4% for the day [plummeted a further 5-6% in a matter of minutes](https://www.sec.gov/news/studies/2010/marketevents-report.pdf) before rebounding almost as quickly.

Inside that drop, individual securities did stranger things. Over [20,000 trades across more than 300 securities](https://www.sec.gov/news/studies/2010/marketevents-report.pdf) executed at prices more than 60% away from their values moments before. Some traded at a penny or less; some at as much as $100,000. By the end of the day the major indices had recovered to close about 3% down.

The report, published [September 30, 2010](https://www.sec.gov/news/studies/2010/marketevents-report.pdf), is a regulator's document about markets, but its core is an engineering failure that will be familiar to anyone who has built an autoscaler or a rate controller: an automated system steering by a signal that its own environment could inflate.

## What happened

May 6 was already a bad day. The report describes unsettling news about the European debt crisis, a sharp fall in the Euro from about 1 p.m., and by 2:30 p.m. the S&P 500 volatility index up 22.5% from the open and the Dow down about 2.5% ([source](https://www.sec.gov/news/studies/2010/marketevents-report.pdf)). Buy-side liquidity in the E-Mini S&P 500 futures contract had fallen from nearly $6 billion in the early morning to $2.65 billion, a 55% decline.

Then, in the report's timeline ([source](https://www.sec.gov/news/studies/2010/marketevents-report.pdf)), with times as the report gives them:

- **2:32 p.m.** A large fundamental trader, described as a mutual fund complex, starts a program to sell [75,000 E-Mini contracts, valued at about $4.1 billion](https://www.sec.gov/news/studies/2010/marketevents-report.pdf), as a hedge on an existing equity position. It uses an automated execution algorithm.
- **2:32 to 2:41 p.m.** High-frequency traders (HFTs) and other intermediaries absorb the early sell orders and build a net long position of about 3,300 contracts. Cross-market arbitrageurs buy E-Minis and sell SPY or individual stocks, carrying the pressure into equity markets.
- **2:41 to 2:44 p.m.** HFTs aggressively sell about 2,000 contracts to cut their positions. The E-Mini falls about 3% in four minutes.
- **2:45:13 to 2:45:27 p.m.** HFTs trade over 27,000 contracts, about 49% of all volume, while buying only about 200 contracts net. Buy-side depth falls to about $58 million, under 1% of the morning level. The E-Mini drops another 1.7% in 15 seconds to its intraday low.
- **2:45:28 p.m.** The CME's Stop Logic Functionality pauses E-Mini trading for five seconds. When trading resumes at 2:45:33, prices stabilise and start to recover.
- **About 2:45 to 3:00 p.m.** A second liquidity crisis hits individual stocks, with trades at absurd prices.
- **About 2:51 p.m.** The sell algorithm finishes, having sold into a rising market for its last six minutes.

## What the engineers believed

The report frames the seller's choice clearly. A large trader can use an intermediary, enter orders by hand, or use an algorithm that considers [price, time or volume](https://www.sec.gov/news/studies/2010/marketevents-report.pdf). This trader chose an algorithm programmed to target an execution rate of 9% of the trading volume over the previous minute, "but without regard to price or time."

The reasoning behind a volume-participation strategy is sound in normal conditions. If you only ever trade a fixed fraction of what everyone else is trading, you'll never dominate the market, and your selling will scale up when the market is busy and can absorb it, and down when it is quiet. Volume is being used as a proxy for "how much the market can take right now."

The same trader had done a sale of this size before. That time it used a mix of manual trading and several algorithms that took price, time and volume into account, and it took [more than 5 hours](https://www.sec.gov/news/studies/2010/marketevents-report.pdf) to sell the first 75,000 contracts. On May 6, with a volume-only algorithm in an already stressed market, the program ran in [just 20 minutes](https://www.sec.gov/news/studies/2010/marketevents-report.pdf).

## What was actually going on

### Volume can be generated without anyone absorbing anything

The proxy only works if volume means "buyers taking the other side." On May 6 it stopped meaning that.

HFTs, by the report's account, typically trade a very large number of contracts but don't accumulate an inventory beyond [three to four thousand contracts](https://www.sec.gov/news/studies/2010/marketevents-report.pdf) in either direction. Once they had absorbed the early selling and reached that range, they started selling to reduce it. And with too little demand from fundamental buyers or arbitrageurs, HFTs began buying and reselling contracts among themselves, which the report calls a "hot-potato" volume effect: the same positions passed rapidly back and forth.

That trading produces enormous volume and almost no net buying. In the 14 seconds from 2:45:13, HFTs traded over 27,000 contracts while adding only about 200 contracts net ([source](https://www.sec.gov/news/studies/2010/marketevents-report.pdf)).

### The feedback loop

Put the two together. The sell algorithm set its pace from the last minute's volume. Volume rose, so it sold more. The report says it responded to the increased volume by increasing the rate at which it fed orders into the market, [even though orders it had already sent were arguably not yet fully absorbed](https://www.sec.gov/news/studies/2010/marketevents-report.pdf). More selling pushed prices down, more hot-potato trading followed, volume rose again, and the algorithm sold faster again.

```diagram
title: why the algorithm sped up into the crash
flow!: hot-potato trading -> volume jumps -> algo sells faster
flow: CME 5-second pause -> buyers return -> prices recover
note: volume was rising because liquidity was vanishing, not because buyers arrived
```

The signal the algorithm used to measure the market's capacity was being inflated by the very stress the algorithm was adding to. The report's lesson puts it plainly: "especially in times of significant volatility, high trading volume is not necessarily a reliable indicator of market liquidity."

The numbers show the result. From 2:32 to 2:45, the algorithm sold about [35,000 contracts, about $1.9 billion](https://www.sec.gov/news/studies/2010/marketevents-report.pdf). Over the same period all fundamental sellers sold more than 80,000 contracts net while fundamental buyers bought about 50,000, a net imbalance of 30,000 contracts. By 2:45:28, fewer than 1,050 contracts of buy orders were resting in the E-Mini, under 1% of the depth at the start of the day.

Because the algorithm ignored price, nothing in it reacted to the falling price. A human, or an algorithm with a price limit, would have slowed down as the market fell. This one sped up.

### A five-second pause broke the loop

What stopped the E-Mini decline was not a human decision. At 2:45:28 the CME's Stop Logic Functionality triggered, pausing trading for [five seconds](https://www.sec.gov/news/studies/2010/marketevents-report.pdf) to prevent a cascade of further declines. In that time sell-side pressure was partly relieved and buy-side interest increased, and when trading resumed prices stabilised. The report describes pausing as an effective way to give participants time to reassess and for algorithms to reset their parameters.

The algorithm, meanwhile, kept going. Between 2:45 and 2:51 it sold the remaining [40,000 or so contracts, about $2.2 billion](https://www.sec.gov/news/studies/2010/marketevents-report.pdf), into a rising market.

### The second crash: everyone's safety switch at once

Around 2:45 a separate crisis started in individual stocks. Many liquidity providers' automated systems had built-in pauses that stop trading when prices move beyond preset thresholds. Those pauses [triggered in reaction to the sudden declines](https://www.sec.gov/news/studies/2010/marketevents-report.pdf). Each firm then had to decide whether to resume: was the data wrong, were risk limits hit, would trades be broken later? Some widened quotes, some reduced liquidity, and a significant number withdrew completely.

Each of those pauses is a sensible local safety mechanism. The report's lesson is about what happens when they all fire together: a liquidity crisis can develop if [many participants withdraw at the same time](https://www.sec.gov/news/studies/2010/marketevents-report.pdf). With buyers gone, market sell orders, including many retail stop-loss orders, executed against "stub quotes": placeholder quotes far from the market that market makers post to meet their obligation to quote both sides even when not actively trading. That is how shares traded at a penny.

## How they fixed it

On the day, the E-Mini recovered after the five-second pause, and by about 3:00 p.m. most securities had [reverted to prices reflecting true consensus values](https://www.sec.gov/news/studies/2010/marketevents-report.pdf). After the close, the exchanges and FINRA agreed to break all trades executed 60% or more away from their 2:40 p.m. prices under their "clearly erroneous" trade rules.

## What changed afterwards

The report lists changes made or under consideration by September 2010 ([source](https://www.sec.gov/news/studies/2010/marketevents-report.pdf)):

- **Single-stock circuit breakers.** A pilot that pauses trading in a security across US markets for five minutes if it moves 10% in five minutes. Approved for S&P 500 stocks on June 10, expanded to Russell 1000 stocks and certain ETFs on September 10, in effect as a pilot through December 10, 2010.
- **Clearer trade-break rules.** Objective thresholds for which trades get broken, because participants said uncertainty about trade breaks affected their willingness to provide liquidity.
- **Under consideration:** a limit up/limit down mechanism that would prevent trades outside set bands, recalibration of market-wide circuit breakers (none triggered on May 6), and work on market data integrity.

## The rule

An automated system needs a throttle based on what it's actually trying to protect, not on a proxy that the environment can inflate. Here the algorithm's throttle was volume, the thing it actually needed was buyers, and under stress those two separated. Build in the signal that matters (price, in this case), a hard limit, and a pause. In the E-Mini, a five-second halt was what broke the loop.

## Sources

- [CFTC and SEC staff, "Findings Regarding the Market Events of May 6, 2010" (September 30, 2010)](https://www.sec.gov/news/studies/2010/marketevents-report.pdf). The joint regulator report: timeline, the sell algorithm's design, HFT and hot-potato trading, liquidity figures, the Stop Logic pause, stub quotes, broken trades and the follow-up circuit breaker and trade-break changes.
