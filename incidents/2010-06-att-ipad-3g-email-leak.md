---
title: "AT&T's iPad 3G site handed out an email address to anyone who sent a device ID"
dek: "AT&T's site took a device identifier from the URL and returned the matching subscriber's email address. The identifier was guessable, so a script that counted through it collected about 120,000 addresses."
date: 2010-06
company: AT&T
kind: security-breach
topics: [security, data-leak, auth]
stack: [web, http]
impact: "Approximately 120,000 ICC-ID and email address pairs for iPad 3G customers were harvested between June 5 and June 9 2010."
rule: "An identifier is not a credential. If knowing a number is enough to get someone's data back, that number is a password, and it has to be treated like one."
postmortem: https://www.justice.gov/archive/usao/nj/Press/files/Auernheimer%2C%20Andrew%20Verdict%20News%20Release.html
sources: [https://www.justice.gov/archive/usao/nj/Press/files/Auernheimer%2C%20Andrew%20Verdict%20News%20Release.html, https://www.justice.gov/usao-nj/pr/new-york-man-sentenced-41-months-prison-hacking-att-s-servers]
---

# AT&T's iPad 3G site handed out an email address to anyone who sent a device ID

In early June 2010, a few months after the first iPad shipped, a script hit an AT&T web endpoint over and over again. Each request carried a number that looked like the SIM identifier of an iPad 3G. When the number belonged to a real customer, AT&T's server sent back that customer's email address.

According to the US Department of Justice, the script collected [approximately 120,000 ICC-ID/e-mail address pairings](https://www.justice.gov/archive/usao/nj/Press/files/Auernheimer%2C%20Andrew%20Verdict%20News%20Release.html) between June 5 and June 9, 2010. The list went to Gawker, which published it in redacted form. The DOJ release says the Gawker article named Diane Sawyer, Harvey Weinstein, Michael Bloomberg and Rahm Emanuel among the people whose addresses were exposed.

Nobody broke into a database here. Nobody cracked a password or got past a firewall. The server answered the question it was built to answer. The trouble was that it answered anyone who asked.

The only sources for this post are the DOJ's two press releases about the prosecution. AT&T's own account isn't among them, so this post covers only what the government's releases say about the system and the attack.

## What happened

Here is how the DOJ describes the setup. When someone subscribed to AT&T's 3G service for the iPad, they gave an email address, a billing address and a password. AT&T then [automatically linked the user's e-mail address to the ICC-ID](https://www.justice.gov/archive/usao/nj/Press/files/Auernheimer%2C%20Andrew%20Verdict%20News%20Release.html), the Integrated Circuit Card Identifier, which the release calls "a number unique to the user's iPad."

The link was there for convenience. In the DOJ's words, whenever the user visited AT&T's website, "the ICC-ID was recognized and the e-mail address was automatically populated for faster, user-friendly access to the site."

When an iPad 3G talked to the AT&T site, its ICC-ID [appeared in the URL in plain text](https://www.justice.gov/archive/usao/nj/Press/files/Auernheimer%2C%20Andrew%20Verdict%20News%20Release.html). People who saw this, and noticed that each ICC-ID mapped to an email address, wrote a script called the "iPad 3G Account Slurper." It [mimicked the behavior of an iPad 3G](https://www.justice.gov/archive/usao/nj/Press/files/Auernheimer%2C%20Andrew%20Verdict%20News%20Release.html) so the servers would treat it as a real device, and it guessed at ranges of ICC-IDs. A wrong guess returned nothing useful. A right guess returned an ICC-ID and email pair for a specific, identifiable customer.

The script ran for several days and took about 120,000 pairs. The people behind it, members of a group calling itself "Goatse Security," gave the data to Gawker. Two of them were prosecuted. Daniel Spitler pleaded guilty. Andrew Auernheimer was [convicted on November 20, 2012](https://www.justice.gov/archive/usao/nj/Press/files/Auernheimer%2C%20Andrew%20Verdict%20News%20Release.html) and later [sentenced to 41 months in prison](https://www.justice.gov/usao-nj/pr/new-york-man-sentenced-41-months-prison-hacking-att-s-servers), along with three years of supervised release and $73,162 in restitution.

## What the engineers believed

The DOJ releases don't say what AT&T's developers were thinking, so this section is interpretation. The design does make the assumption easy to see.

The feature was a pre-filled login form. Pre-filling a form feels harmless because it isn't login: the user still has to type their password. The email address shown on the page was only a hint for the person holding the iPad.

That reasoning holds as long as only the person holding the iPad can ask. The design quietly assumed that the ICC-ID in the request came from the device it identified. In other words, it treated where the identifier came from as proof of who was asking.

The DOJ release also says AT&T [kept the ICC-IDs and associated e-mail addresses confidential](https://www.justice.gov/archive/usao/nj/Press/files/Auernheimer%2C%20Andrew%20Verdict%20News%20Release.html). That is the second assumption: if the identifiers aren't published, nobody outside will have one. But the identifier was sent in the URL on every visit, and the script got real ones by guessing. Keeping a value out of public view does not stop people from guessing it.

## What was actually going on

### An identifier that worked like a key

There are two kinds of value a backend can receive in a request.

- **An identifier** says *which* thing you mean: `user_id=12345`, an order number, a device serial. It's fine for identifiers to be predictable, sequential and visible, because they don't grant anything.
- **A credential** proves *who you are* or *that you're allowed*: a password, a session token, a signed cookie, an API key. A credential has to be secret and impossible to guess, and the server checks it before doing anything on the caller's behalf.

AT&T's endpoint, as the DOJ describes it, took a value that was an identifier, the SIM card's ICC-ID, and returned personal data with no other check. That turned the identifier into a credential without anyone deciding it should be one. It also made it a weak credential, because it was never designed to be secret or random.

This class of bug is now usually called an *insecure direct object reference* (IDOR), or *broken object-level authorization*. The pattern is always the same: the server looks up a record using a key the client supplied and never asks whether this client is allowed to see that record.

### Why guessing works

ICC-IDs are not random tokens. As general background, SIM card identifiers are long numbers with fixed prefixes for the issuer, and cards from the same batch tend to sit close together in the number space. The DOJ release says only that the script was "[randomly guessing at ranges of ICC-IDs](https://www.justice.gov/archive/usao/nj/Press/files/Auernheimer%2C%20Andrew%20Verdict%20News%20Release.html)." The detail that matters is that guesses could be confined to *ranges*. If valid values cluster, a searcher doesn't need to cover the whole space, only the dense parts of it.

Compare that with a proper session token: 128 random bits from a cryptographic RNG. The chance that a random guess hits a live token is so small that guessing doesn't work as an attack. An identifier with structure has no such protection.

### Different answers are an oracle

The DOJ says a wrong guess "was met with no additional information" and a right guess returned an email address. From an attacker's point of view, that difference is the whole attack. The endpoint told the caller, for every guess, whether it had hit a real customer. Endpoints that work this way are called *oracles*, and they turn a large search into a loop with a reliable success signal.

The usual countermeasures, which come up again under what changed afterwards, are all ways to cut off that loop:

| Control | What it breaks |
| --- | --- |
| Require an authenticated session before returning account data | The identifier stops being enough on its own |
| Check that the session owns the record being requested | Stops the "any ID, any record" lookup |
| Rate-limit per client and alert on many distinct IDs from one source | Makes the search too slow and too noisy |
| Return nothing personal until after authentication | Removes the oracle |

```diagram
title: an identifier treated as a credential
flow: device sends ICC-ID -> server looks it up -> returns email
flow!: script guesses ID -> server looks it up -> returns email
note: the server can't tell the two apart
```

### Spoofing the client is easy

The DOJ notes that the script mimicked an iPad so AT&T's servers [would be deceived into granting the Account Slurper access](https://www.justice.gov/archive/usao/nj/Press/files/Auernheimer%2C%20Andrew%20Verdict%20News%20Release.html). For backend engineers, the lesson is that anything in an HTTP request can be set by whoever sends it. That includes the User-Agent, custom headers, query parameters and the URL itself. A check of the form "this looks like it came from our app" is not a security control. A client is trustworthy only if it holds a secret the server issued and can check.

## How it ended

The releases say very little about AT&T's technical response. They say that the automatic linking of email to ICC-ID was in place "[prior to mid-June 2010](https://www.justice.gov/archive/usao/nj/Press/files/Auernheimer%2C%20Andrew%20Verdict%20News%20Release.html)," which suggests it ended around then, but they don't describe the fix. The other events the releases record are legal: the chats in which the two discussed destroying evidence on June 10, 2010; Spitler's guilty plea; Auernheimer's conviction on both counts; and his sentencing.

## What changed afterwards

The sources don't describe any changes AT&T made to its systems, so this post doesn't list any.

The DOJ also quotes the US Attorney rejecting Auernheimer's defense that "[all he did was walk in through an unlocked door](https://www.justice.gov/usao-nj/pr/new-york-man-sentenced-41-months-prison-hacking-att-s-servers)." That framing was disputed in court and is a legal question, not an engineering one. For engineers, the takeaway doesn't depend on how the legal question comes out. An endpoint that returns personal data for any guessable identifier will be found and scripted against, whoever does it and whatever a court later decides about them.

## The rule

An identifier is not a credential. Before your server returns a record, ask two separate questions: *who is asking?* (authentication, with a secret the server can check) and *may they see this record?* (authorization, checked per object). If the only thing standing between a stranger and a customer's data is a number they could guess, and the server tells them when they've guessed right, the data is already public.

## Sources

- [US Attorney's Office, District of New Jersey: "New York man convicted of hacking AT&T's servers" (November 20, 2012)](https://www.justice.gov/archive/usao/nj/Press/files/Auernheimer%2C%20Andrew%20Verdict%20News%20Release.html). DOJ account of the ICC-ID lookup, the "Account Slurper" script, the June 5 to 9 2010 dates and the roughly 120,000 records.
- [US Attorney's Office, District of New Jersey: "New York man sentenced to 41 months in prison for hacking AT&T's servers" (March 18, 2013)](https://www.justice.gov/usao-nj/pr/new-york-man-sentenced-41-months-prison-hacking-att-s-servers). Sentencing release, which repeats the technical account and gives the sentence and restitution.
