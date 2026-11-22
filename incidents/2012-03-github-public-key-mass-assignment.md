---
title: "One unchecked form field let a stranger push to the Rails repository on GitHub"
dek: "GitHub's public-key update form trusted every parameter it was sent. A user added his own SSH key to the rails organization and pushed a file to the project to prove it. The bug class is called mass assignment, and it lives in any framework that maps request bodies straight onto models."
belief: "GitHub's public-key form trusted every parameter sent. A user added their own SSH key to the Rails org."
date: 2012-03-04
company: GitHub
kind: security-breach
topics: [auth, security, software-bug]
stack: [rails, ruby, ssh]
impact: "A user added his public key to the rails organization and pushed a file to the project; three accounts were compromised in total."
rule: "Never let a request body decide which columns get written. Whitelist the fields a form is allowed to set, and derive ownership from the session, not from the payload."
postmortem: https://github.blog/2012-03-04-public-key-security-vulnerability-and-mitigation/
sources: [https://github.blog/2012-03-04-public-key-security-vulnerability-and-mitigation/, https://github.blog/news-insights/the-library/responsible-disclosure-policy/, https://github.com/rails/rails/issues/5228]
---

# One unchecked form field let a stranger push to the Rails repository on GitHub

On the morning of March 4, 2012, a new file appeared in the Ruby on Rails project on GitHub. It had been pushed by an outside user who, [at 8:49am Pacific Time](https://github.blog/2012-03-04-public-key-security-vulnerability-and-mitigation/), had used a flaw in GitHub's public-key update form to attach his own SSH key to the rails organization. Once the key was there, git happily accepted his pushes.

The target was not random. Three days earlier the same user had [opened an issue on rails/rails](https://github.com/rails/rails/issues/5228) arguing that "mass assignment" was a common vulnerability in Rails applications. GitHub's post says the pushed file was [a demonstration of the vulnerability](https://github.blog/2012-03-04-public-key-security-vulnerability-and-mitigation/).

GitHub's founder, Tom Preston-Werner, published a short post the same day. GitHub rolled out a fix [at 9:53am](https://github.blog/2012-03-04-public-key-security-vulnerability-and-mitigation/), about an hour after the exploit, and found that [three accounts had been compromised](https://github.blog/2012-03-04-public-key-security-vulnerability-and-mitigation/): rails and two others that looked like proofs of concept.

## What happened

The timeline from GitHub's two posts is short:

- **Three days before:** the user, @homakov, [opened an issue on rails/rails](https://github.blog/news-insights/the-library/responsible-disclosure-policy/) about how common mass-assignment bugs were.
- **Two days before:** he [responsibly disclosed a different vulnerability](https://github.blog/news-insights/the-library/responsible-disclosure-policy/) to GitHub, which GitHub fixed with him.
- **March 4, 8:49am PT:** he exploited a flaw in the public-key update form to [add his public key to the rails organization](https://github.blog/2012-03-04-public-key-security-vulnerability-and-mitigation/) and pushed a new file to the project.
- **Shortly after:** GitHub [removed the unauthorized key and suspended the user](https://github.blog/2012-03-04-public-key-security-vulnerability-and-mitigation/).
- **9:53am PT:** the fix went out and GitHub began investigating the impact using database and log analysis.

GitHub named the root cause plainly: ["a failure to properly check incoming form parameters, a problem known as the mass-assignment vulnerability."](https://github.blog/2012-03-04-public-key-security-vulnerability-and-mitigation/)

## What the engineers believed

GitHub's post doesn't describe the code, so this part is interpretation, but the general belief behind every mass-assignment bug is the same: **the form decides what the user can change.**

A "public key" settings page shows a title field and a key field. The developer writes a controller action that takes what the form submitted and saves it. In their head, the set of things a user can submit is the set of inputs on the page. The page has no "owner" input, so the owner cannot change.

That is a statement about the HTML, not about HTTP. A browser form is a suggestion. Anyone can send a POST with any field names they like, and the server receives a flat bag of key/value pairs with no record of which ones came from a rendered input.

## What was actually going on

### How mass assignment works in Rails

Rails, like most web frameworks, lets you build or update a database record from a hash in one call. Form fields named `public_key[title]` and `public_key[key]` arrive in the controller as a nested hash, `params[:public_key]`, and the idiomatic scaffolded code passes that whole hash to the model:

```ruby
key = PublicKey.find(params[:id])
key.update_attributes(params[:public_key])
```

`update_attributes` walks the hash and calls the setter for every key it finds. If the hash contains `title`, it sets `title`. If it also contains `user_id`, or any other column the model has, it sets that too. The method has no idea which keys the HTML form rendered. That is "mass assignment": many attributes assigned at once from untrusted input.

In March 2012, Rails 3 had a defense, but it was opt-in. A model could declare `attr_accessible :title, :key` to whitelist assignable attributes, or `attr_protected` to blacklist some. A model with neither declaration accepted everything. Homakov's [issue on rails/rails](https://github.com/rails/rails/issues/5228) made exactly this point: in his experience many developers did not write `attr_accessible`, so an attacker could "just add an http field in params". His example was an update request carrying an extra `user_id` field set to the attacker's own id, which would hand ownership of someone else's record to the attacker.

### Why an SSH key is the worst record to get wrong

On GitHub, a public key is the credential for git over SSH. When you run `git push`, the SSH server receives your key, looks up which account that key belongs to, and then checks whether *that account* has write access to the repository. The key record is effectively a row that says "whoever holds the private half of this key is account X."

So a bug that lets a user set the owner of a key record is not a data-integrity bug. It is an authentication bypass. GitHub's post doesn't name the parameter that was abused, but the outcome it describes, [his key added to the rails organization](https://github.blog/2012-03-04-public-key-security-vulnerability-and-mitigation/), means the server let the request decide which account the key belonged to. From that point, every push signed with that key was, as far as git authorization was concerned, a push by rails.

```diagram
title: who owns the key?
flow: form: title, key -> owner from session -> key is yours
flow!: POST + owner field -> mass assignment -> key is rails's
note: the server trusted a field the form never rendered
```

### Why it is so easy to ship

Nothing about this bug looks wrong in a code review of the controller. `update_attributes(params[:public_key])` was the framework's own scaffolding pattern. The vulnerable part is an *absence*: a missing whitelist on the model, possibly in a different file from the controller. Tests written against the real form will never send the extra field, so they pass. The only way to see the hole is to ask, for every write endpoint, "what happens if the request contains a column name I didn't expect?"

This is also why the bug class outlived Rails 3. Any API that deserializes a JSON body straight into an ORM model, `Object.assign(user, req.body)` or `Model.update(req.body)`, has the same shape. The framework convenience that saves you from listing fields is exactly what lets an attacker add one.

## How they fixed it

GitHub's immediate response, per the [same-day post](https://github.blog/2012-03-04-public-key-security-vulnerability-and-mitigation/):

1. Removed the unauthorized key and suspended the user.
2. Shipped a fix for the form at 9:53am PT.
3. Ran database and log analysis to find every account affected, landing on three.
4. Started a full audit of the GitHub codebase to look for other instances of mass assignment.

The post also promised external security audits beyond GitHub's normal schedule.

The suspension became its own story. In a [follow-up post](https://github.blog/news-insights/the-library/responsible-disclosure-policy/), Preston-Werner explained that the account had been suspended under the Terms of Service because this exploit was used without responsible disclosure. After reviewing his activity and finding no malicious intent, GitHub reinstated it.

## What changed afterwards

GitHub [added a "Responsible Disclosure of Security Vulnerabilities" section](https://github.blog/news-insights/the-library/responsible-disclosure-policy/) to its security policy, acknowledging that it had not been clear enough about how researchers should report problems. The codebase-wide audit for mass assignment was, at the time of the first post, [still ongoing](https://github.blog/2012-03-04-public-key-security-vulnerability-and-mitigation/), with a stated goal of a strategy to prevent this class of bug in the future.

The sources here don't cover what Rails itself changed in response, so that's left out. The general lesson for any stack is to make the safe path the default: list the fields a write endpoint accepts, and reject or ignore everything else.

In practice that means:

- **Whitelist per endpoint, not per model.** The fields a user may set on "edit my key" are not the fields an admin may set. Pick them at the call site (`permit(:title, :key)`, a validation schema, a DTO) so the reviewer sees them next to the write.
- **Never take ownership from the payload.** `user_id`, `org_id`, `account_id` and role fields should come from the authenticated session, and the payload version should be dropped.
- **Treat credential tables as auth code.** Anything that maps a secret to an identity (SSH keys, API tokens, OAuth grants) deserves its own review checklist.
- **Test with hostile requests.** A test that posts an extra `user_id` field and asserts it was ignored is a few lines long and would have caught this.

## The rule

The HTML form is not your API. Your API is whatever an HTTP client can send. Decide on the server which fields each write is allowed to touch, and take identity and ownership from the session, never from the request body.

## Sources

- [GitHub Blog: Public Key Security Vulnerability and Mitigation (March 4, 2012)](https://github.blog/2012-03-04-public-key-security-vulnerability-and-mitigation/): the official account by Tom Preston-Werner, with times, root cause and response.
- [GitHub Blog: Responsible Disclosure Policy](https://github.blog/news-insights/the-library/responsible-disclosure-policy/): follow-up on the account suspension, the earlier disclosure, and the policy change.
- [rails/rails issue #5228](https://github.com/rails/rails/issues/5228): the mass-assignment issue the user opened three days earlier, with his description of the attack pattern.
