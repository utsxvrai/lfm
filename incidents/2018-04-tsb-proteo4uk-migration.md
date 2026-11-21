---
title: "TSB's migration to Proteo4UK broke digital banking because two 'identical' data centres weren't"
dek: "TSB moved its customers to a new core banking platform over one weekend in April 2018, with no way back. The load balancer and the session-security cluster were misconfigured across its two data centres, sessions kept landing in the wrong one, and the one test that would likely have caught it had been scoped down."
date: 2018-04-20
company: TSB
kind: outage
topics: [migration, config-change, capacity, dependency]
stack: [proteo4uk, openam, load-balancer]
impact: "TSB received 225,492 complaints and paid £32,705,762 in redress between 22 April 2018 and 7 April 2019, and did not return to business as usual until 10 December 2018; the FCA fined it £29.75 million."
rule: "Test in the topology you will run in production. If a test is scoped down to protect live traffic, record the risk that creates, and never treat 'both sites are configured the same' as a fact without checking it."
postmortem: https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf
sources: [https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf, https://www.tsb.co.uk/news-releases/slaughter-and-may/]
---

# TSB's migration to Proteo4UK broke digital banking because two 'identical' data centres weren't

Over the weekend of 20 to 22 April 2018, UK retail bank TSB ran its Main Migration Event (MME), moving most of its corporate systems, customer services and customer data from the platform it had inherited from Lloyds Banking Group onto a new platform called Proteo4UK. According to the Financial Conduct Authority's final notice, from an early point after go-live on 22 April, TSB ["encountered serious issues which significantly impacted the ability of some customers to access and use their account"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf).

The data migration itself worked. TSB says the final migration of customer data was completed [with every customer account transferred to the penny](https://www.tsb.co.uk/news-releases/slaughter-and-may/), and the FCA agrees ["the data migration itself was successful"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf). What failed was the platform serving that data. Internet and mobile banking failed, telephone banking was overwhelmed, branch systems crashed, and some customers could see other people's accounts. TSB [did not return to a business-as-usual position until 10 December 2018](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf).

Between 22 April 2018 and 7 April 2019, TSB received [225,492 complaints](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf), about 4.3% of its customer base, and paid £32,705,762 in redress. In December 2022 the FCA fined it [£29.75 million](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf), after a 30% settlement discount on £42.50 million.

## What happened

TSB was created by a divestment from Lloyds Banking Group in June 2014 and kept using Lloyds' IT platform under an outsourcing agreement. In July 2015 it was acquired by Sabadell, which planned to move it onto a UK version of Sabadell's Proteo platform. Sabadell's subsidiary SABIS would [design, build and test the Proteo4UK Platform](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf), migrate the data and operate the platform afterwards. SABIS relied on [85 third parties](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf) to deliver the systems.

The FCA's account of the first days, from its [final notice](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf):

- **Sunday 22 April, ~1pm.** MME authorised. Telephony and internet banking live by 6pm; the mobile app at 6.45pm. Problems were immediately apparent: intermittent service, failed logins, failed payments.
- **Sunday evening.** About 40 customers reported seeing other people's finances, typically relatives', after logging in. Digital banking was taken down at 7pm. It was later confirmed that [440 customers](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf) experienced this.
- **Monday 23 April, 2am.** Digital channels back, with limits. Part of the platform was ["consuming extremely large amounts of memory"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf), so TSB restricted new internet banking logins to protect the app. Of about 900,000 attempted logins that day, only about 10% of internet banking logins succeeded. 48% of mobile app payments and 59% of internet banking payments failed.
- **Monday, telephony.** 69,000 calls by 2pm. IVR configuration problems meant only about 25% of the planned telephone line capacity was available. Wait times were about 90 minutes with a 70% abandon rate.
- **Monday, branches.** The Proteo4UK branch application crashed, and chip and pin, voucher readers, printing and teller cash recyclers were unavailable.
- **Tuesday 24 April, 10am.** Digital channels taken down for fixes, expected back in an hour. They reopened at 3am Wednesday and stayed ["unstable and almost unusable"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf) until Thursday 26 April.

The FCA describes a cascade: digital failures pushed customers to the phone, and phone failures pushed them to branches that were already slow from their own IT problems.

## What the engineers believed

The FCA's notice points at a specific assumption. TSB planned to test end-to-end performance in both data centres in Active-Active configuration, in production, because it [did not have a pre-production environment](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf) that could take that load. Around the end of February 2018, after a Migration Testing Forum on 28 February, TSB accepted a SABIS counter-proposal to test in only one data centre. Running the test in both would have taken already-live services offline, for example [ATMs for approximately three to four hours](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf).

The reasoning was that if one data centre could handle the load, two would have twice the capacity. It rested on the belief that [the configuration in both data centres was symmetric](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf), based on assurances, on specialist suppliers having been engaged, on a third-party infrastructure review and on services such as ATMs and the public website already running from both data centres.

That belief turned out to be false, and the FCA found that the decision was made informally, outside the governance structure, not documented and not escalated. TSB ["considered the matter to be a purely technical decision"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf).

## What was actually going on

### How Active-Active was supposed to work

The FCA notice explains the design in some detail. In Active-Active mode, [both data centres run at the same time](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf) and a Global Load Balancer decides which one each request goes to. If one fails, its sessions move to the other, which has the capacity to run everything alone.

For digital banking, the intended path was:

1. The Global Load Balancer sends a customer to one data centre.
2. That data centre handles the customer ["in isolation"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf). A local load balancer picks an application instance; the request goes through the web front end and mobile gateway to the middleware.
3. The customer's credentials are validated by the session security component, **OpenAM**, which returns a security token protecting the session.
4. Subsequent transactions are routed back to the same data centre.

The key property is session affinity: once you log in at data centre A, you stay at A, because that's where your session lives.

### What actually happened

After MME, [customer sessions were not being kept on a single data centre](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf). A customer would log in at one data centre, and their next transaction would sometimes land at the other, where they had no session. The FCA gives two configuration errors:

- **Requests to OpenAM went to the wrong load balancer.** They were supposed to go to the local load balancer in the same data centre. Instead they went to the Global Load Balancer, which ["at times sent them to the 'wrong' data centre"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf). A figure in the notice adds that load balancer rules were configured in a way that caused the configuration itself to corrupt after balancing services across data centres.
- **OpenAM was configured in error as a cross-site cluster.** Per the figure, that meant all security tokens were synchronized in real time for each customer session across the two data centres. The FCA says this ["exacerbated the issues with session persistence"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf).

```diagram
title: where TSB's sessions went
flow: login -> data centre A -> session token at A
flow!: next request -> global balancer -> DC B: no session
note: OpenAM calls skipped the local balancer
```

Customers saw errors like ["your session has expired" or "your session is not valid"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf). Logins and payments failed. The FCA adds that the misconfiguration also compromised each data centre's ability to handle all digital volume alone, which is the whole point of Active-Active, and the ability to fail over completely if one data centre went down.

Background on why this shape of bug hides: with one user, or with all traffic in one data centre, session affinity never matters, because every request lands where the session is. It only appears when two sites are serving at once under real load and the balancer actually spreads requests. A single-data-centre performance test is structurally unable to see it. The FCA makes the same point: services ["may functionally work end-to-end with one user"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf) but not under load, and it concludes that if the Active-Active test had been done, ["it is likely that this issue would have been identified"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf).

### Nobody checked the config line by line

Why didn't anyone notice the two data centres differed? The FCA says that because of the scale and cost, and ["the low likelihood of identifying an error in a line of configuration in this way"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf), TSB didn't check or audit the configuration its fourth-party suppliers put in. It relied on an external consultant's review, expected to be done on a sample basis. And instead of design documentation, TSB had accepted configuration documents from SABIS, which the FCA notes could not verify that the infrastructure matched the design.

### Configuration was one cause of several

The FCA says the direct causes ["substantially related to issues with IT configuration, capacity and coding"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf). TSB's own statement names the data centre inconsistency as ["a key cause of the extent of disruption"](https://www.tsb.co.uk/news-releases/slaughter-and-may/), with additional coding and capacity issues, compounded by customer contact volumes that exceeded contingency resources. The memory exhaustion on 23 April and the IVR misconfiguration are examples of the other issues. The sources don't give their root causes.

### No way back

What made this a months-long incident instead of a bad weekend is that there was no rollback. Once TSB served notice to leave the Lloyds platform and migrated, there would be a very short window to stop the old platform being disabled. The FCA says that after MME it was ["technically speaking, essentially impossible to roll back"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf). Every problem had to be fixed forward, on a new platform, by an outsourced provider coordinating dozens of suppliers. The FCA found TSB had prepared for ["bumps in the road"](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf), but not for a multiple-incident scenario of this severity, and that in TSB's own view it would not have migrated had it considered an incident of this scale possible.

## How they fixed it

The sources describe the recovery only in outline. Fixes were deployed over the first week, and on 25 April TSB decided to [bring in third parties](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf) to help find and resolve performance issues. Overnight fixes before Thursday 26 April significantly improved access and performance. The digital channels largely stabilized by the end of the second week, with issues recurring later in May and defects continuing into June.

## What changed afterwards

TSB commissioned an independent review from the law firm Slaughter and May and published it. TSB says it has since [taken direct control of its IT operations](https://www.tsb.co.uk/news-releases/slaughter-and-may/), changed leadership and governance, and changed how incidents and critical suppliers are handled. The TSB Board also said there were aspects of the Slaughter and May report it did not agree with.

The two sources describe the bank slightly differently: TSB's statement refers to ["all five million customers"](https://www.tsb.co.uk/news-releases/slaughter-and-may/), the FCA to [approximately 5.2 million customers](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf) during the relevant period.
## The rule

A redundant setup is only as good as the test that runs it in its real shape. If the production design is two sites serving at once, the load test has to be two sites serving at once, because the failures that matter, like session affinity, only exist in that configuration. When you scope a test down to protect live traffic, write down what the smaller test can't see and decide who accepts that risk. And for any change you can't roll back, the bar for "ready" has to include a plan for the failure you think is unlikely.

## Sources

- [Financial Conduct Authority, Final Notice to TSB Bank plc (20 December 2022)](https://www.fca.org.uk/publication/final-notices/tsb-bank-plc-2022.pdf): the regulator's findings, including the incident timeline, customer impact, the Active-Active configuration issue, the testing decision, outsourcing failings and the £29.75m penalty.
- [TSB, "TSB Board publishes independent review of 2018 IT Migration"](https://www.tsb.co.uk/news-releases/slaughter-and-may/): TSB's statement on publishing the Slaughter and May review, with its own account of the technical causes and the changes made since.
