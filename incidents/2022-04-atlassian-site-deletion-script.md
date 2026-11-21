---
title: "Atlassian ran a cleanup script with site IDs instead of app IDs and deleted 883 customer sites"
dek: "A script meant to remove a retired app was handed the IDs of whole cloud sites. The deletion API accepted either kind of ID and did whatever the ID pointed to. Backups were fine; restoring hundreds of multi-product sites into shared, live infrastructure took up to 14 days."
date: 2022-04-05
company: Atlassian
kind: data-loss
topics: [human-error, automation, backup]
stack: [jira, confluence, aws, multi-tenant]
impact: "883 sites (775 customers) deleted between 07:38 and 08:01 UTC on 5 April 2022; some were down for up to 14 days, with all restored by 18 April."
detected_by: customers
rule: "Destructive APIs should demand the type of thing they destroy and default to soft delete; and you haven't tested disaster recovery until you've restored at the scale of your worst plausible mistake."
postmortem: https://www.atlassian.com/engineering/post-incident-review-april-2022-outage
sources: [https://www.atlassian.com/engineering/post-incident-review-april-2022-outage]
---

# Atlassian ran a cleanup script with site IDs instead of app IDs and deleted 883 customer sites

On Tuesday 5 April 2022, starting at 07:38 UTC, [775 Atlassian customers lost access to their Atlassian products](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage): Jira, Confluence, Atlassian Access, Opsgenie and Statuspage. For some, the outage lasted [up to 14 days](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage). The first customers came back on 8 April and the last on 18 April.

Nobody attacked anything, and the backups worked. Atlassian says [no customer lost more than five minutes of data](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage). What happened was that a routine cleanup script deleted entire customer sites between 07:38 and 08:01 UTC, and putting them all back took until 18 April.

Two mechanisms are worth understanding: an API that let one kind of ID silently stand in for another, and why restoring a few hundred tenants in a multi-tenant system is so much harder than restoring one.

## What happened

From Atlassian's [post-incident review](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage):

In 2021, Atlassian completed the integration of a standalone app called "Insight – Asset Management" into Jira Service Management. The standalone app had to be deleted from customer sites that had it installed. Engineers used an existing script and process.

- The **first production run** covered 30 sites and worked. Those IDs had been gathered before the mix-up and were correct app IDs.
- For the **second run**, the requesting team supplied the IDs of the **entire cloud sites** where the app was installed, instead of the app IDs.
- The script ran from **07:38 to 08:01 UTC** on 5 April against [883 sites](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage), deleting them sequentially.
- **07:46:** The first support ticket came from an affected customer. Atlassian's [internal monitoring did not detect an issue](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage) because the sites were deleted through a standard workflow.
- **08:17:** Major incident process triggered; escalated to Critical at 08:24.
- **08:53:** The team linked the support ticket to the script run.
- **12:38:** Highest severity assigned once the complexity of restoration was clear.

Initially Atlassian estimated about 400 affected customers. The final count, by Atlassian's official customer definition, was [775 customers](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage). Some customer contact information had also been deleted, so affected customers couldn't file support tickets the normal way.

## What the engineers believed

**"The script is safe because it's been used before and the change was reviewed."** The script followed Atlassian's standard peer review, but that review [focused on which endpoint was being called and how](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage). It didn't check whether the IDs in the input referred to apps or to sites. It was also tested in staging, but that [would not have detected](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage) the wrong IDs, because those IDs didn't exist in staging.

**"The first run worked, so the second will."** The first run of 30 sites succeeded cleanly. The second run used the same script with a different input list, and the input was the thing that was wrong.

**"We can restore from backup."** Atlassian could. It had immutable backups with 30-day retention and point-in-time recovery. But its capabilities were built for infrastructure failure, data corruption, single-service events or [single-site deletions](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage). It could not select a large set of sites and restore all their interconnected products at once.

## What was actually going on

### An API that trusted the ID

The deletion API [accepted both site and app identifiers and assumed the input was correct](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage). Pass a site ID and it deletes a site; pass an app ID and it deletes an app. There was no signal to confirm which kind of deletion was intended.

*(Background.)* This is a classic weakly-typed-ID hazard. When different entity types share an ID format and an endpoint dispatches on whatever the ID resolves to, a mix-up doesn't fail. It does a different, valid, and possibly much bigger operation. Nothing at the type level distinguishes "delete this app from this site" from "delete this site".

```diagram
title: one endpoint, two blast radii
flow: app ID -> delete endpoint -> app removed
flow!: site ID -> delete endpoint -> whole site removed
note: the API never asked which one you meant
```

And it was a hard delete. The data was gone from production immediately, so the only way back was the backups.

### Why a "site" is hard to put back

Atlassian's architecture section explains why restoration was slow. A **site** is a container for the products a customer has licensed, for example Jira and Confluence at `<name>.atlassian.net`. A site isn't stored in one place. Its data is spread across [multiple physical and logical locations](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage): metadata and configuration, identity (users, groups, permissions), product databases, media, and third-party apps.

And the stores are **multi-tenant**: each shard holds many customers' data. The deleted data was [only a portion of data stores that are continuing to be used by other customers](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage). So Atlassian couldn't just roll a database back to before the script ran; that would have rolled back every other customer on it. It had to extract each affected customer's pieces from backups and put them back into live stores, across many services, in a consistent way.

### Two restoration approaches

**Restoration 1** created a new site for each deleted one and then restored every downstream product, service and data store into it. That took [approximately 70 individual steps](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage), mostly sequential. New sites came with new identifiers such as `cloudId`, and those IDs are embedded in data records all over the system, including in third-party apps, so everything had to be remapped. Once optimised, it took about 48 hours per batch and restored 53% of affected users across 112 sites.

**Restoration 2**, proposed on 9 April because Restoration 1 would have taken three weeks for everyone, **un-deleted** the records instead and reused the original identifiers. That removed [over half of the steps](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage), including coordinating with every third-party app vendor for each site, and allowed more parallelism. It took about 12 hours per site and restored about 47% of affected users across 771 sites.

### The data that was lost

Atlassian restored main data stores to a point [five minutes prior to the deletion](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage), so data loss was capped there and Atlassian met its RPO of one hour. It missed its RTO. For 57 customers restored early, some Confluence and Insight databases were restored to an earlier point than that, because of inconsistent policies and manual retrieval of backup snapshots; Atlassian says it recovered the remaining data and worked with those customers.

## How they fixed it

Beyond the two restoration approaches, Atlassian [froze code changes](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage) across engineering from 8 April to avoid any change interfering with recovery, and tracked every site's restoration in a dedicated Jira project. The incident leaders met every three hours.

## What changed afterwards

Atlassian lists [four learnings](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage):

1. **Universal soft deletes.** Deleting customer data and metadata that hasn't gone through soft delete will be globally prevented. Soft deletes get staged rollouts (internal sites first) and a tested rollback plan.
2. **Automated multi-site, multi-product restoration** as part of the DR program, with regular DR exercises that restore all products for a large set of sites.
3. **A large-scale incident process**, with playbooks and tooling for incidents with hundreds of people working in parallel.
4. **Better communications**, including backups of key customer contacts and a way for customers without a valid URL or Atlassian ID to reach support.

## The rule

A destructive operation should make the caller say exactly what kind of thing they're destroying, and refuse if the ID doesn't match. Default to soft delete with a retention period, so a mistake costs an un-delete, not a restore. Test changes against inputs that exist (staging can't catch a wrong ID that doesn't exist there), and review the data a script will run on, not just its code. Finally, size disaster recovery to your plausible mistakes, not just your infrastructure failures: in a multi-tenant system, restoring hundreds of tenants into live, shared stores is its own engineering project, and you want to have built it before you need it.

## Sources

- [Atlassian, "Post-Incident Review on the Atlassian April 2022 outage" (29 April 2022)](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage): Atlassian's full post-incident review, covering the architecture, the deletion script, the timeline, both restoration approaches, data loss, communications and the four learnings.
