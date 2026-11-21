---
title: "NotPetya wiped Maersk's network, and its domain controllers survived only in Ghana"
dek: "Malware delivered through a Ukrainian accounting app spread across Maersk's flat global network with EternalBlue and stolen credentials. Domain controllers that replicated to each other turned out to be no backup when every one was wiped at once."
date: 2017-06-27
company: Maersk
kind: security-breach
topics: [security, backup, supply-chain]
stack: [windows, active-directory]
impact: "IT systems were down across multiple sites and business units; Maersk rebuilt 4,000 servers and 45,000 PCs and its chair estimated the cost at $250 million to $300 million."
rule: "Replication is not a backup: keep an offline copy of the systems you need to rebuild everything else, especially identity."
postmortem: https://web.archive.org/web/20261115062217/https://investor.maersk.com/news-releases/news-release-details/cyber-attack-update
sources: [https://web.archive.org/web/20261115062217/https://investor.maersk.com/news-releases/news-release-details/cyber-attack-update, https://www.wired.com/story/notpetya-cyberattack-ukraine-russia-code-crashed-the-world/]
---

# NotPetya wiped Maersk's network, and its domain controllers survived only in Ghana

On June 27, 2017, A.P. Møller-Maersk, the shipping and logistics group, confirmed it had "been hit as part of a global cyber attack named Petya", and that its IT systems were "down across multiple sites and select business units" ([Maersk](https://web.archive.org/web/20261115062217/https://investor.maersk.com/news-releases/news-release-details/cyber-attack-update)). Maersk Line's vessels could still manoeuvre and communicate, but APM Terminals, its port operator, was impacted in a number of ports.

Maersk's own statement is brief. Most of what's known about the inside of the recovery comes from Andy Greenberg's 2018 WIRED investigation, based on interviews with Maersk staff, customers and partners, most of whom spoke anonymously. This post relies on it and attributes it as such. Per WIRED, gates and cranes stopped at [17 of Maersk's 76 terminals](https://www.wired.com/story/notpetya-cyberattack-ukraine-russia-code-crashed-the-world/), new bookings couldn't be taken, and Maersk's chair later estimated the cost at between $250 million and $300 million.

The most instructive detail for engineers isn't the malware. It's that Maersk had backups of nearly every server, but no usable backup of the one layer needed to restore them.

## What happened

According to WIRED, NotPetya's entry point was M.E.Doc, a Ukrainian accounting package. Attackers had hijacked the update servers of its maker, Linkos Group, giving them a back door into machines running the software, and used it in June 2017 to release the malware. At Maersk, the foothold was a single computer in its Odessa office, where a finance executive had asked IT to install M.E.Doc ([WIRED](https://www.wired.com/story/notpetya-cyberattack-ukraine-russia-code-crashed-the-world/)).

At Maersk's Copenhagen headquarters, WIRED describes screens going black one after another, with messages saying the file system was being repaired or that files were encrypted and demanding [$300 worth of bitcoin](https://www.wired.com/story/notpetya-cyberattack-ukraine-russia-code-crashed-the-world/). Staff ran through hallways telling colleagues to disconnect their machines. Disconnecting Maersk's whole global network took IT more than two hours.

## What the engineers believed

The belief that failed is in the domain controllers. These are the Windows servers that hold the directory: who the users are, what machines exist, and who may access what. Without them, almost nothing else in a Windows enterprise can log in or be managed.

Per WIRED, Maersk's [150 or so domain controllers](https://www.wired.com/story/notpetya-cyberattack-ukraine-russia-code-crashed-the-world/) were set up to sync their data with each other, so in theory any one could serve as a backup for all the others. That's a reasonable design, and it's how directory services are built to survive the loss of a server or a site. WIRED's summary of the flaw: the strategy "hadn't accounted for one scenario: where every domain controller is wiped simultaneously."

## What was actually going on

### How NotPetya moved

WIRED describes two techniques working together:

- **EternalBlue**, an exploit for a Windows protocol vulnerability, which WIRED says came from the US National Security Agency and leaked earlier in 2017. It allows remote code execution on unpatched machines. Microsoft had released a patch before NotPetya launched.
- **Mimikatz**, a 2011 proof-of-concept tool by researcher Benjamin Delpy that extracts passwords left in Windows memory, so malware can log into *other* machines with the same credentials.

Delpy explains the combination in WIRED: infect unpatched machines, grab passwords from them, and use those to infect machines that *are* patched. Patching alone therefore wasn't enough. One unpatched machine, plus an administrator credential cached in memory somewhere, was a way into everything that credential could reach.

Some general background on why that's so damaging: in a Windows domain, admin accounts tend to log into many machines, and their credentials end up cached on each one. A worm that harvests credentials doesn't need a new exploit for every hop. It spreads along the paths administrators already use, and on a flat network that's everywhere.

And it wasn't really ransomware. WIRED reports NotPetya irreversibly encrypted machines' master boot records, the ransom screens were a ruse, and no decryption key existed. Recovery meant rebuilding, not decrypting.

### Why replication was the wrong kind of redundancy

Replication protects against a server *disappearing*. It does nothing against a server being *destroyed by something that also reaches every other replica*. Here every domain controller was on the same network as the infected machines, reachable with the same credentials. Whatever could wipe one could wipe all of them, and did.

```diagram
title: why 150 replicas made zero backups
flow: one DC fails -> others still serve -> rebuild from peers
flow!: worm reaches all DCs -> all wiped together -> nothing to restore
note: the Ghana DC survived only because it was offline
```

Recovery staff located backups of almost every individual server, from three to seven days before the attack, but no domain controller backup ([WIRED](https://www.wired.com/story/notpetya-cyberattack-ukraine-russia-code-crashed-the-world/)). Without the directory they couldn't recover anything else.

### The machine in Ghana

After calling hundreds of IT admins in data centers worldwide, they found one surviving domain controller, in a remote office in Ghana. A blackout had knocked it offline before NotPetya struck, and it had stayed disconnected ([WIRED](https://www.wired.com/story/notpetya-cyberattack-ukraine-russia-code-crashed-the-world/)). It survived by accident, as an offline copy.

The office's bandwidth was too low to send the several-hundred-gigabyte backup to the UK quickly, and none of the Ghana staff had a British visa. So one employee flew the hard drive to Nigeria and handed it to another, who flew it to Heathrow.

There's a warning sign in WIRED's reporting too. Maersk security staff said some servers were still running Windows 2000 until the attack. In 2016, a group of IT executives had pushed for a security redesign that flagged patching, outdated operating systems and, above all, insufficient network segmentation. It was approved and budgeted but, per WIRED's sources, never carried out, because it wasn't made a key performance indicator for the senior IT leaders responsible.

## How they fixed it

Maersk's recovery centre was in Maidenhead, England, run with Deloitte. WIRED reports up to 200 Deloitte staff alongside up to 400 Maersk personnel. All pre-attack equipment was confiscated to avoid reinfection, and staff bought new laptops and Wi-Fi hotspots from local electronics stores ([WIRED](https://www.wired.com/story/notpetya-cyberattack-ukraine-russia-code-crashed-the-world/)).

Once the Ghana backup arrived, core services could come back. Meanwhile, staff worked with whatever they had: paper documents taped to containers, and orders taken over personal Gmail, WhatsApp and Excel. It was several days before Maerskline.com took new bookings again, and more than a week before terminals worked with "any degree of normalcy" ([WIRED](https://www.wired.com/story/notpetya-cyberattack-ukraine-russia-code-crashed-the-world/)).

At Davos, chair Jim Hagemann Snabe said it took [10 days](https://www.wired.com/story/notpetya-cyberattack-ukraine-russia-code-crashed-the-world/) to rebuild the network of 4,000 servers and 45,000 PCs. WIRED notes full recovery took much longer, with some staff working for close to two months to rebuild Maersk's software setup. Snabe estimated the total cost at $250 million to $300 million. Most staff WIRED spoke to privately suspected that figure was too low.

## What changed afterwards

Per WIRED, after NotPetya nearly every security feature IT staff requested was approved almost immediately. Multifactor authentication was rolled out across the company, along with a long-delayed upgrade to Windows 10 ([WIRED](https://www.wired.com/story/notpetya-cyberattack-ukraine-russia-code-crashed-the-world/)). Maersk's own statement at the time said only that it had contained the issue and was working on a technical recovery plan with IT partners and cyber security agencies ([Maersk](https://web.archive.org/web/20261115062217/https://investor.maersk.com/news-releases/news-release-details/cyber-attack-update)).

For backend engineers the lessons apply well beyond Windows:

1. **Separate replicas from backups.** A replica follows the primary, including into deletion, corruption or encryption. A backup is something an attacker with your production credentials *can't* reach: offline, or immutable, in a separate account.
2. **Know your bootstrap dependencies.** Identity (Active Directory, your IdP, your secrets manager) is what everything else needs in order to come back. Its backup deserves its own drill.
3. **Segment so that one foothold isn't everything.** The 2016 proposal at Maersk named this exact risk.

## The rule

Replication is not a backup: keep an offline copy of the systems you need to rebuild everything else, especially identity.

## Sources

- [A.P. Møller - Mærsk A/S cyber attack update](https://web.archive.org/web/20261115062217/https://investor.maersk.com/news-releases/news-release-details/cyber-attack-update): Maersk's investor-relations statement from June 2017 (archive.org copy), confirming the Petya attack, systems down across sites, and APM Terminals impact.
- [The Untold Story of NotPetya, the Most Devastating Cyberattack in History (WIRED, Andy Greenberg, August 2018)](https://www.wired.com/story/notpetya-cyberattack-ukraine-russia-code-crashed-the-world/): investigative feature based on interviews with Maersk staff and others, the source for the M.E.Doc vector, EternalBlue and Mimikatz, the domain controller story, the Ghana recovery, the 4,000 servers and 45,000 PCs, and the cost estimate.
