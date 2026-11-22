---
title: "Phone calls about the VPN gave attackers Twitter's account-takeover tools"
dek: "Attackers posing as IT support sent employees to a lookalike VPN login page, replayed the credentials live and got them to approve the push MFA prompt. From inside, they found the people with admin tools and took over 130 accounts, including Obama's, Musk's and Apple's."
belief: "Twitter thought push MFA protected its admin tools. After phone pretexts, employees approved the attackers' logins."
date: 2020-07-15
company: Twitter
kind: security-breach
topics: [security, auth, human-error]
stack: [vpn, mfa, internal-tools]
impact: "Attackers targeted 130 accounts, tweeted from 45, accessed the DM inbox of 36 and downloaded the data of 7; NYDFS says they stole over $118,000 in bitcoin."
rule: "MFA that a human can approve on someone else's behalf isn't phishing-resistant. Bind authentication to the real origin with hardware keys, and put powerful admin tools behind more than one person."
postmortem: https://web.archive.org/web/20240427232430/https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident
sources: [https://web.archive.org/web/20240427232430/https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident, https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident, https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report]
---

# Phone calls about the VPN gave attackers Twitter's account-takeover tools

On the afternoon of 15 July 2020, verified Twitter accounts started tweeting the same offer: send bitcoin and get double back. The accounts belonged to [Barack Obama, Kim Kardashian West, Jeff Bezos, Elon Musk](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report), Joe Biden, Bill Gates, Apple, Uber and several cryptocurrency companies. New York's Department of Financial Services (NYDFS), which later investigated, wrote that ["for several hours Twitter seemed unable to stop the hack."](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report)

Twitter's own count: the attackers [targeted 130 Twitter accounts, ultimately Tweeting from 45, accessing the DM inbox of 36, and downloading the Twitter Data of 7](https://web.archive.org/web/20240427232430/https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident). NYDFS puts the haul at [over $118,000 worth of bitcoin](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report).

None of it took malware. NYDFS stresses that the attack involved ["no malware, no exploits, and no backdoors"](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report). It took phone calls, a lookalike website, and employees who tapped "approve".

## What happened

NYDFS describes [three phases in roughly 24 hours](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report):

1. **Afternoon of 14 July.** One or more attackers called Twitter employees claiming to be from the IT help desk, responding to a reported VPN problem. They directed the employee to a phishing site that looked like Twitter's VPN login, on a similarly named domain. As the employee typed their credentials, the attackers entered them into the real site, which sent an MFA prompt to the employee's phone. [Some of the employees approved it](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report).
2. **Reconnaissance.** The first compromised employee [did not have access to the account tools](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report). The attackers used that access to read Twitter's intranet, learn how internal applications worked, and identify who had the tools. Twitter's account matches: the access let them ["gain information about our processes"](https://web.archive.org/web/20240427232430/https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident), which let them target employees who did have it.
3. **15 July, early hours to late morning.** With account-tool access, the attackers took over and sold short "OG" usernames. [Between approximately 3 a.m. and 10 a.m.](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report) they discussed the sales in chat. Just before 2 p.m. they tweeted screenshots of the internal tool from hijacked accounts.
4. **15 July, afternoon.** Crypto accounts first (Binance at about 3:18 p.m.), then [between 4:17 p.m. and 6:05 p.m.](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report) the high-profile verified accounts.

NYDFS reports times without a time zone. The sources don't say which one.

Twitter [became aware of the attack](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report) when employees reported suspicious logins and phone calls that morning. Its incident response team was investigating them when the crypto takeovers began.

## What the engineers believed

Twitter had controls in place. Access to the support tools was, in its words, ["strictly limited and is only granted for valid business reasons"](https://web.archive.org/web/20240427232430/https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident). Employees had MFA. The VPN was the gate to the internal network.

The assumption underneath: a password plus a second factor on the employee's phone means the person logging in is the employee. Against a credential stuffer or someone with a leaked password list, that's true. It is not true against an attacker who is talking to the employee *while* they log in.

The other assumption was about how many people needed the tools. NYDFS found that [over 1,000 Twitter employees still had access to them](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report) for support, content review and rule enforcement. With that many, the attackers only needed to fool a few of them.

## What was actually going on

### A real-time phishing relay beats push MFA

The attack chain was a live man-in-the-middle with a person in the loop:

```diagram
title: why push MFA didn't stop it
flow: employee -> fake VPN page -> attacker types creds
flow!: real VPN login -> push to phone -> employee approves
note: the second factor confirmed the attacker's login
```

*Background, not from the sources:* a push or code-based second factor proves that the person holding the phone agreed to a login. It doesn't prove *which* login, or that the request came from the site the user thinks it did. An attacker who relays the password in real time triggers a legitimate prompt, and a user who has just been told "IT is fixing your VPN" expects one.

NYDFS draws the same line. Twitter used [application-based MFA, which sent a request to the employee's phone](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report), and the attackers got past it by convincing employees to approve. A physical security key ["would have stopped the Hackers"](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report).

*Background:* FIDO/WebAuthn keys work differently. The browser includes the site's origin in what the key signs. A key registered for the real VPN domain will not produce a valid response for the lookalike, and the user can't override that by saying yes.

### Remote work made the pretext believable

Twitter moved to remote work in March 2020. NYDFS says the ramp-up strained the infrastructure and [employees had frequent problems with the VPN connections](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report). A call from "IT" about the VPN wasn't strange. It was routine. NYDFS also found that Twitter [did not implement any significant compensating controls after March 2020](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report) for the new remote-work risk, and that it had had no chief information security officer since December 2019.

### One tool, any account

The support tools could change an account's email address, reset passwords, and turn MFA on or off ([NYDFS describes their functions](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report)). That's what support needs. It also means anyone with the tool can take over any account, and tool access was guarded only by employee login. For 45 accounts, Twitter says the attackers [initiated a password reset, logged in, and sent Tweets](https://web.archive.org/web/20240427232430/https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident). The tools also showed [email addresses and phone numbers](https://web.archive.org/web/20240427232430/https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident) to their users. Passwords weren't visible because they aren't stored in plain text.

### The numbers moved as the investigation went on

Twitter's 17 July update said that for ["up to eight"](https://web.archive.org/web/20240427232430/https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident) accounts, the attackers downloaded data through the "Your Twitter Data" tool. Its 30 July update and the NYDFS report both say [seven](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report). NYDFS adds that the attackers requested data for another 52 accounts that was never downloaded.

## How they fixed it

In the moment, Twitter used blunt tools. It [restricted functionality for many accounts](https://web.archive.org/web/20240427232430/https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident), stopping them from tweeting or changing passwords, and locked accounts with a recent password change. NYDFS says that applied to accounts whose password changed [within 30 days](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report). The National Weather Service couldn't tweet a tornado advisory, and NYDFS's own account was unavailable for several hours. Twitter's first public statement came at about 5:45 p.m. At 8:41 p.m. it said most accounts could tweet again.

Internally it [secured and revoked access to internal systems](https://web.archive.org/web/20240427232430/https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident). NYDFS reports that every employee, starting with the CEO, had to [change their password on a video call in front of a supervisor](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report).

## What changed afterwards

Twitter said it had [significantly limited access to internal tools](https://web.archive.org/web/20240427232430/https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident), which slowed account support and developer applications, and that it would run more phishing exercises. NYDFS reported that Twitter was [implementing hardware MFA in place of application-based MFA](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report) and hired a new CISO in late September 2020.

NYDFS's recommendations go beyond Twitter: access only to the extent a job needs, regular recertification, stricter authentication for high-risk tools, and for critical actions possibly [approval by a second employee before the action can be taken](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report). It also argued for a dedicated cybersecurity regulator for systemically important social media companies.

## The rule

If your second factor is a prompt a human can approve, a phisher on the phone can get it approved. For anything that guards internal admin access, use origin-bound authentication such as hardware security keys, which won't sign for the wrong site whatever the user is told.

And treat "can take over any account" as a capability that needs more than one key. Fewer people with access, a second approver for high-impact actions on high-profile accounts, and alerts on unusual use all mean that fooling one employee isn't enough.

## Sources

- [Twitter, "An update on our security incident" (archived)](https://web.archive.org/web/20240427232430/https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident): Twitter's official statements of 17 July and 30 July 2020, with account counts, the social engineering description and immediate response.
- [Twitter, "An update on our security incident" (original URL)](https://blog.twitter.com/en_us/topics/company/2020/an-update-on-our-security-incident): the original location of the same post; it refused automated fetches, so this article cites the archived copy above.
- [New York State Department of Financial Services, "Report on Investigation of Twitter's July 15, 2020 Cybersecurity Incident" (archived)](https://web.archive.org/web/20260525215944/https://www.dfs.ny.gov/Twitter_Report): regulator's report with the phishing mechanics, timeline, MFA analysis, access-control findings and recommendations.
