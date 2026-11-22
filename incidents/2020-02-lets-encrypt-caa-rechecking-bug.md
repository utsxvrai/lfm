---
title: "A Go loop variable made Let's Encrypt check one domain N times instead of N domains once"
dek: "Boulder converted a map of authorizations to protobufs by taking a pointer into the loop variable. Every entry ended up naming the same domain, so CAA rechecks covered one name per certificate and skipped the rest. About 3 million certificates were affected."
belief: "Let's Encrypt thought a CAA bug was cosmetic. It rechecked one domain per certificate and skipped the rest."
date: 2020-02-29
company: "Let's Encrypt"
kind: bug
topics: [software-bug, certificate, security]
stack: [go, boulder, protobuf, caa]
impact: "3,048,289 currently valid certificates were affected; Let's Encrypt planned to revoke about 3 million and in the end revoked about 1.7 million before the deadline."
detected_by: engineers
rule: "A test that only counts results proves nothing about their contents. Assert on every field of every item, and test with more than one."
postmortem: https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591
sources: [https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591, https://bugzilla.mozilla.org/show_bug.cgi?id=1619047]
---

# A Go loop variable made Let's Encrypt check one domain N times instead of N domains once

On 29 February 2020, Let's Encrypt found a bug in Boulder, the software that runs its certificate authority. When a certificate request contained several domain names that needed their CAA records rechecked, [Boulder "would pick one domain name and check it N times"](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591). The other names were never rechecked.

The CA [confirmed the bug at 03:08 UTC, halted issuance at 03:10, and deployed a fix at 05:22](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591). Then it had to deal with the certificates already issued. Its incident report to Mozilla counted [3,048,289 currently valid certificates affected, out of approximately 116 million active](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047). Industry rules required revoking them within days.

The cause was a single pointer, taken in a loop, in a function whose job was to convert one data structure into another.

## What happened

Some background on CAA. A domain owner can publish a DNS CAA record saying which certificate authorities may issue for that domain. A CA must check it. Let's Encrypt checks CAA when it validates that a subscriber controls a domain, but it [treats a validation as good for 30 days](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591). The Baseline Requirements say CAA must be checked [within 8 hours prior to issuance](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591), so any name validated more than 8 hours earlier has to be rechecked at issuance time.

The timeline from the [incident report](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047):

- **2019-04-24 16:40 UTC:** the bug is committed to Boulder behind a feature flag.
- **2019-08-23 01:19 UTC:** the `NewAuthorizationSchema` flag is enabled in production, triggering the bug for the first time.
- **2020-02-18:** a community member reports that rechecking CAA returned many identical error messages for a single hostname. Another suggests a more serious bug. Let's Encrypt checks its logs, concludes CAA was checked and the bug is only in error-message generation, and files a regular-priority issue.
- **2020-02-29 03:08 UTC:** while working on that fix, an engineer realizes the bug is in CAA checking itself.
- **03:10:** issuance disabled. **05:22:** fixed Boulder deployed, issuance re-enabled.

The first forum post, written hours after discovery, said the bug was [introduced on 2019-07-25](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591). The later incident report gives the commit and flag dates above. The forum date was labeled a "preliminary investigation", and the two sources don't agree.

## What the engineers believed

When the first report came in on 18 February, the symptom was odd error output: [multiple error messages for a single hostname](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047). The team looked at the logs, saw CAA lookups happening, and concluded the bug was cosmetic. That was a reasonable reading of the evidence: lookups were happening. What the logs didn't make obvious was that they were all for the same name.

The deeper belief was in the code itself. The function involved already handled Go's loop-variable problem for one variable, with a comment saying so. The report explains why the second case was missed: the reference was taken inside another function, and [since `authzPB` is freshly scoped with each iteration, "it's easy to assume it's not affected by the loop variable problem"](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047).

## What was actually going on

### The code

The report quotes the function that converts a map of domain name to authorization model into a protobuf message:

```go
func authz2ModelMapToPB(m map[string]authz2Model) (*sapb.Authorizations, error) {
	resp := &sapb.Authorizations{}
	for k, v := range m {
		// Make a copy of k because it will be reassigned with each loop.
		kCopy := k
		authzPB, err := modelToAuthzPB(&v)
		if err != nil {
			return nil, err
		}
		resp.Authz = append(resp.Authz, &sapb.Authorizations_MapElement{Domain: &kCopy, Authz: authzPB})
	}
	return resp, nil
}
```

And `modelToAuthzPB`, which builds the protobuf:

```go
pb := &corepb.Authorization{
	Id:             &id,
	Status:         &status,
	Identifier:     &am.IdentifierValue,
	RegistrationID: &am.RegistrationID,
	Expires:        &expires,
}
```

### Why that is wrong

*Background on Go:* before Go 1.22, `for k, v := range m` declared `k` and `v` **once**, and each iteration copied the next key and value into those same two variables. The address `&v` was the same on every iteration. Store that address, or the address of one of its fields, and by the end of the loop every stored pointer points into the same variable, which holds whatever the last iteration put there. (Go 1.22 changed this to a fresh variable per iteration. Boulder in 2020 ran under the old rules.)

The author saw this for `k` and copied it into `kCopy`. But `modelToAuthzPB(&v)` passed a pointer to `v`, and inside it `Identifier: &am.IdentifierValue` stored a pointer to a field *inside* `v`. The report spells out the result: a map whose keys were [the correct set of FQDNs, but whose contents all have the same IdentifierValue](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047).

`Expires` was safe because the function copied it into a local first (`expires := ...`). Only the fields taken by address were shared.

```diagram
title: one pointer, reused every iteration
flow: map a,b,c -> loop copies into v -> &v.IdentifierValue
flow!: entry a -> entry b, entry c -> all point at v = c
note: keys right, Identifier always the last domain
```

### Why the checks still looked fine

The broken map went over RPC to `boulder-ra`, the component that checks authorizations before issuance. The report walks through what the RA did with it:

- It checked that every needed name was present **using the map keys**, which were correct.
- It checked `Expires`, which was correct.
- When it decided a name needed a CAA recheck, it used the **`Identifier` field**, which was wrong. So [if multiple authorizations needed CAA rechecking, boulder-ra would recheck one FQDN but not the others](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047).

Every check passed except one, and that one passed against the wrong data. The visible symptom, many identical errors for one hostname, was the same name being checked N times.

What this allowed: a subscriber who validated a name at time X, when CAA allowed Let's Encrypt, could keep getting certificates for it [until X+30 days, even if someone later installed CAA records that prohibit issuance](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591), as long as that name wasn't the one picked for checking.

### Why the tests missed it

The commit came with a unit test that [exercises the broken code path with multiple authorizations but only checks "that there were the correct number"](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047), not their contents. A long-standing integration test for CAA rechecking also existed, but it [requests a certificate with only one FQDN](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047). With one name, "check one name N times" and "check N names once" are the same thing.

The report names two contributing causes: a conversion layer between native Go types and RPC structures, which the team had found to be a source of hard-to-find bugs before, and the proto2 library's reliance on pointer fields, which meant [taking references where it would be simpler, and more correct, to pass a field by value](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047).

## How they fixed it

The code fix was live [by 05:22 UTC the same morning](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591). The certificates took longer. Let's Encrypt announced it would revoke [approximately 2.6% of its active certificates, about 3 million](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591), with a compliance deadline of 2020-03-05 03:00 UTC, and asked subscribers to renew.

Subscribers replaced [more than 1.7 million affected certificates in less than 48 hours](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591). Even so, Let's Encrypt expected more than 1 million would still be in use at the deadline and decided [not to revoke those by the deadline](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591), noting that its 90-day certificates would leave the ecosystem quickly. Before the deadline it revoked 1,706,505 certificates it was confident had been replaced, plus [445 treated as highest priority because their CAA records forbade Let's Encrypt](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591) when the bug was found.

That 445 doesn't match the incident report, which counted [443 hostnames whose CAA currently rejects Let's Encrypt](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047). One figure counts certificates and the other hostnames, so they may not be measuring the same thing. The sources don't reconcile them.

## What changed afterwards

The incident report committed to [six follow-ups](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047): a better unit test for the order path, a direct unit test of `modelToAuthzPB`, automated log verification of CAA behavior, a review for other loop-iterator bugs, an evaluation of static analysis tools, and an upgrade to proto3. Later updates on the bug say the review found no other loop-iterator bugs, and that the team would add `staticcheck` to CI even though [it "would not have caught this particular bug"](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047). The integration test was changed to use multiple names, and the team [confirmed it catches the bug on earlier versions](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047).

## The rule

When a function returns a collection, test it with at least two distinct items and assert on the contents of each one, not just how many there are. Copy-paste-the-pointer bugs, shared buffers and aliasing all make every item identical, and a count check can't see that. A security check that runs against a field nobody verified is only checking something, not necessarily the right thing.

## Sources

- [Let's Encrypt, "2020.02.29 CAA Rechecking Bug", community forum](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591): the initial disclosure with times, plus follow-up posts on the revocation plan, the decision not to revoke all certificates, and revocation counts.
- [Mozilla Bugzilla 1619047, Let's Encrypt incident report](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047): the full report to root programs, with the timeline, affected counts, the Go code, why tests missed it and remediation items with later status updates.
