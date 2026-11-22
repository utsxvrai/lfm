---
title: "A support ticket from a free Canvas account gave attackers a support rep's session, then the data"
dek: "Anyone could sign up for Canvas Free-for-Teacher and open a support ticket. A ticket carrying stored XSS ran in a customer-service rep's authenticated session, and the attacker used that session to pull usernames, emails, enrollments and messages through Canvas's APIs. A second XSS a week later defaced login pages during finals."
belief: "Instructure's free Canvas teacher accounts looked low-risk. One sent stored XSS in a support ticket that ran as staff."
date: 2026-04-29
company: Instructure
kind: security-breach
topics: [security, data-leak, auth]
stack: [canvas, xss]
impact: "Unauthorized access exposed usernames, email addresses, course names, enrollment information and messages; on 7 May Canvas was taken offline after login pages were defaced."
rule: "Never render untrusted customer content inside a staff tool whose session can reach every tenant. Free sign-up plus a support form is an anonymous path into your most privileged browser."
postmortem: https://instructure.com/incident_update
sources: [https://instructure.com/incident_update, https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response, https://techcrunch.com/2026/05/07/hackers-deface-school-login-pages-after-claiming-another-instructure-hack/, https://fsapartners.ed.gov/knowledge-center/library/electronic-announcements/2026-05-12/technology-security-alert-ongoing-cybersecurity-incident-involving-canvas-learning-management-system-updated-may-29-2026, https://scotthelme.co.uk/the-instructure-canvas-breach-2026-how-xss-in-a-support-ticket-compromised-275-million-students/]
---

# A support ticket from a free Canvas account gave attackers a support rep's session, then the data

On 29 April 2026, Instructure [detected unauthorized activity in Canvas](https://instructure.com/incident_update), the learning management system that many schools and universities run their courses on. The data involved, in Instructure's words, included ["usernames, email addresses, course names, enrollment information and messages"](https://instructure.com/incident_update). Instructure says core learning data (course content, submissions, credentials) was not compromised.

A week later, on 7 May, the same attacker got back in [through a second Canvas vulnerability](https://instructure.com/incident_update) and changed the pages some students and teachers saw after logging in. Instructure put Canvas into maintenance mode. For many institutions this was the end of the academic year. TechCrunch saw a ransom message from the cybercrime group ShinyHunters on [the Canvas login pages of three separate schools](https://techcrunch.com/2026/05/07/hackers-deface-school-login-pages-after-claiming-another-instructure-hack/), threatening to publish the stolen data on 12 May.

Instructure hasn't published a written root-cause report. The mechanism below comes from its incident page, its 18 May customer webinar as reported by [Phil Hill at On EdTech](https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response), and the US Department of Education's alert. The scale figures are the attacker's claims and are marked as such.

## What happened

- **22 April.** A Free-for-Teacher user submits a support ticket containing a stored cross-site scripting payload, described in the webinar as ["a linked file with hidden code"](https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response).
- **25 April.** A customer service representative opens the ticket. The code [executed in the rep's authenticated session](https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response).
- **28–30 April.** The attacker uses those elevated privileges to obtain data via Canvas's APIs ([On EdTech](https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response)).
- **29 April.** Instructure detects the activity and [immediately revoked the unauthorized party's access](https://instructure.com/incident_update), started an investigation and engaged outside forensic experts. Access was revoked by 30 April, per the webinar.
- **6 May.** Instructure tells customers Canvas is fully operational with no ongoing unauthorized activity, a message Hill says [did not hold up](https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response).
- **7 May.** A second stored XSS, this time in the Canvas discussion feature, is used to push a CSS file through the custom themes feature, putting the ransom note on [roughly 300 accounts](https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response). Instructure says monitoring added after the first attack [detected and disabled the second attack approximately 10 minutes after it began](https://instructure.com/incident_update). It took Canvas offline anyway until it could confirm the scope. Instructure says no additional data was accessed in this second attack.
- **8 May.** The CEO apologises for inconsistent communication and names [a vulnerability regarding support tickets in our Free for Teacher environment](https://instructure.com/incident_update). Free-for-Teacher is disabled.
- **9 May.** Canvas is [fully back online](https://instructure.com/incident_update).
- **11 May.** Instructure says it [reached an agreement with the unauthorized actor](https://instructure.com/incident_update): the data was returned, it received "shred logs", and it was told no customers would be extorted.
- **12 May.** The Department of Education's Federal Student Aid office issues a [technology security alert](https://fsapartners.ed.gov/knowledge-center/library/electronic-announcements/2026-05-12/technology-security-alert-ongoing-cybersecurity-incident-involving-canvas-learning-management-system-updated-may-29-2026) to schools.

How big was it? Instructure hasn't published a count of affected people. After the first breach, the attackers [claimed to have stolen data from almost 9,000 schools](https://techcrunch.com/2026/05/07/hackers-deface-school-login-pages-after-claiming-another-instructure-hack/), with files allegedly covering 231 million people (TechCrunch). Security researcher Scott Helme gives [8,809 institutions and roughly 275 million students](https://scotthelme.co.uk/the-instructure-canvas-breach-2026-how-xss-in-a-support-ticket-compromised-275-million-students/). These are claims and reported figures, not numbers Instructure has confirmed, and they don't agree.

## What the engineers believed

Instructure hasn't described its design reasoning. What follows is my interpretation of the assumptions the attack broke.

**Free accounts are low-risk.** Free-for-Teacher let anyone set up a Canvas course without an institution. The Department of Education describes it as [a no-cost Canvas account type commonly used outside enterprise-managed environments](https://fsapartners.ed.gov/knowledge-center/library/electronic-announcements/2026-05-12/technology-security-alert-ongoing-cybersecurity-incident-involving-canvas-learning-management-system-updated-may-29-2026). A free teacher account has access to its own course and nothing else, so the reasoning goes that letting the public create one is safe.

**A support ticket is just text for a human to read.** Support tooling exists so staff can see what customers send them. The working assumption is that sanitising the content keeps it inert when a rep opens it.

Each belief is fine alone. Together they break: the cheapest account on the platform could send content to the most privileged browsers in the company.

## What was actually going on

### Stored XSS in a privileged context

Cross-site scripting means getting your JavaScript to run on someone else's page, as them. "Stored" means the payload is saved, here in a ticket, and fires later when someone views it. The script then has whatever that viewer's session has.

The viewer here was a customer service representative. According to Hill's account of the webinar, the code ran in the rep's authenticated session and the attacker [used those elevated privileges to obtain data via Canvas's APIs](https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response). Instructure's own page says it remediated [the vulnerabilities and privilege escalation paths used](https://instructure.com/incident_update).

The attacker didn't need to break into a database. They waited for a rep's session to run their script, then used it to call the same APIs Canvas's own front end uses.

```diagram
title: from a free account to a support rep's session
flow!: free teacher account -> ticket with stored XSS -> rep opens ticket
flow!: script runs as rep -> calls Canvas APIs -> data exfiltrated
note: the payload sat from 22 to 25 April until a rep opened it
```

How far did a rep's session reach? Instructure hasn't said. Helme argues that a single rep's session leading to data from thousands of institutions is [difficult to explain any other way](https://scotthelme.co.uk/the-instructure-canvas-breach-2026-how-xss-in-a-support-ticket-compromised-275-million-students/) than cross-tenant reach, and flags that as his inference. One of Instructure's remediations points the same way. Hill lists [disabling OAuth token generation via JavaScript](https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response) and an Okta reauthentication framework for customer-account access. *My interpretation:* this suggests script running in a staff browser could mint API tokens, which a script stealing a session would want to do.

### The second XSS, and a feature used as designed

The 7 May attack used [a second cross-site scripting vulnerability — this one in the Canvas discussion feature](https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response), through a different code path. Hill quotes Instructure's CISO saying it "allowed the threat actor to sidestep our earlier fix." The defacement itself wasn't a bug. The attacker used Canvas's custom themes feature, which institutions use to brand their pages, to push a CSS file.

Instructure confirmed that the attacker used [one of our Free-For-Teacher accounts](https://instructure.com/incident_update) in both instances.

Hill's critique is about the gap between the two. Instructure did remediation work from 1 to 5 May with CrowdStrike already engaged, and a related XSS path survived it. His question is whether Instructure did [proper variant analysis](https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response), meaning a search for sibling bugs of the same class, or shipped a narrow patch.

## How they fixed it

Per Instructure's [incident page](https://instructure.com/incident_update) and Hill's [summary of the webinar](https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response):

- **Access and authentication:** more MFA checkpoints, disabling OAuth token generation via JavaScript, and an Okta reauthentication framework for customer-account access.
- **Web security:** the XSS fixes, consolidated sanitization, and wider WAF coverage. Hill quotes the CISO saying some XSS-blocking WAF rules "actually inhibit legitimate LTI tools", so the rollout is ongoing.
- **Detection:** CrowdStrike Falcon across the network, and behavioral alerting tied to the tactics seen.
- **Free-for-Teacher:** first disabled. In the webinar it was going to come back in a ["secure limited capacity"](https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response) with administrative and support functionality removed. By June the incident page said it had been [permanently discontinued](https://instructure.com/incident_update), with a replacement product planned for the fall.

For schools, Instructure recommended rotating Canvas integrations, LTI tools, SSO connectors and API keys, and reviewing logs for unusual access [especially between April 25, 2026, and May 8, 2026](https://fsapartners.ed.gov/knowledge-center/library/electronic-announcements/2026-05-12/technology-security-alert-ongoing-cybersecurity-incident-involving-canvas-learning-management-system-updated-may-29-2026) (FSA alert). The Department of Education used the incident to urge MFA everywhere, and the removal of unmanaged "teacher-created" or "free" accounts.

## What changed afterwards

Instructure's CEO acknowledged that its [initial response during this incident added to what was already a challenging situation](https://instructure.com/incident_update), and announced an advisory board on security and resilience. It spent months on forensic review, delivering institution-specific data packets to designated security contacts. The incident page's [29 September update](https://instructure.com/incident_update) says that review is complete and further updates will go directly to affected institutions. On 11 May Instructure said it intended to share more about the root cause and lessons learned. As of the pages read for this post, the webinar is the most detailed technical account available.

## The rule

The bug class here is ordinary. The damage came from where the bug was. A support inbox is a place where content from anyone gets rendered in front of staff whose sessions reach everyone. Combine that with self-service free sign-up, and an anonymous stranger has a reliable way to run code as one of your most privileged users. All they have to do is file a ticket and wait.

If your product has staff tools that display customer-supplied files, HTML or rich text, render that content on a separate, cookieless origin, keep staff sessions scoped as narrowly as the job allows, and require re-authentication before cross-tenant actions. And when you fix one XSS, go looking for its siblings before you tell customers it's over.

## Sources

- [Instructure, "Security Incident Update & FAQs"](https://instructure.com/incident_update): Instructure's official incident page, with CEO letters and status updates from 8 May to 29 September 2026, the incident overview, and Free-for-Teacher's discontinuation.
- [Phil Hill, "A Technical Deep Dive Is Not a Crisis Response", On EdTech, 19 May 2026](https://onedtech.philhillaa.com/p/a-technical-deep-dive-is-not-a-crisis-response): an account of Instructure's 18 May customer webinar, the only public source for the 22/25/28–30 April chain, the discussion-feature XSS and the remediation tiers, plus the author's critique.
- [Lorenzo Franceschi-Bicchierai and Zack Whittaker, "Hackers deface school login pages after claiming another Instructure hack", TechCrunch, 7 May 2026](https://techcrunch.com/2026/05/07/hackers-deface-school-login-pages-after-claiming-another-instructure-hack/): the defacement, Instructure's spokesperson statement, and ShinyHunters' scale claims.
- [Federal Student Aid, "Technology Security Alert – Ongoing Cybersecurity Incident Involving the Canvas Learning Management System", 12 May 2026 (updated 29 May)](https://fsapartners.ed.gov/knowledge-center/library/electronic-announcements/2026-05-12/technology-security-alert-ongoing-cybersecurity-incident-involving-canvas-learning-management-system-updated-may-29-2026): the US Department of Education alert, with data categories, the Free-For-Teacher explanation, and recommended actions for schools.
- [Scott Helme, "The Instructure Canvas Breach (2026): How XSS in a Support Ticket Compromised 275 Million Students", 15 June 2026](https://scotthelme.co.uk/the-instructure-canvas-breach-2026-how-xss-in-a-support-ticket-compromised-275-million-students/): a security researcher's analysis, which separates what Instructure confirmed from his own inferences about session scope.
