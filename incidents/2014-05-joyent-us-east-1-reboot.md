---
title: "One mistyped command rebooted every server in Joyent's us-east-1"
dek: "An operator meant to reboot a handful of new servers and targeted the whole data center instead. The tool didn't object. Then every machine tried to PXE boot at the same moment."
belief: "Joyent's reboot tool had no 'are you sure?' check. An operator rebooted the whole data center by mistake."
date: 2014-05-27
company: Joyent
kind: outage
topics: [human-error, automation, capacity]
stack: [smartdatacenter, pxe, dhcp, tftp]
duration_min: 149
impact: "All us-east-1 API systems and customer instances rebooted at once. Instance downtime ranged from 20 to 149 minutes, and the API was down for 1 hour 17 minutes."
rule: "A tool that can act on every server must make you prove you meant every server. Design the blast radius into the command, not into the operator's typing."
postmortem: https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014
sources: [https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014]
---

# One mistyped command rebooted every server in Joyent's us-east-1

At [20:13 UTC on 27 May 2014](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014), every server in Joyent's us-east-1 data center rebooted at the same time. That included the API systems that run the cloud and every customer's instances.

Nothing had failed. No power event, no kernel bug, no attacker. According to [Joyent's postmortem](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014), an operator upgrading some new capacity mistyped the command meant to reboot a few new machines, and it "instead specified all servers in the data center."

Customer instances were down for [between 20 and 149 minutes](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014). The control-plane API took [1 hour and 17 minutes](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014) to come back. A one-word slip should never have that kind of reach. What makes this incident useful to study is how the rest of the system behaved once that slip got through.

## What happened

Joyent's data centers ran its SmartDataCenter (SDC) product, which manages all administrative services and the compute nodes that host customer instances. Every server ran a daemon that accepts [machine-generated requests for provisioning, upgrades and maintenance](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014). There was also tooling that could run commands remotely on one or more compute nodes. The postmortem says it was mostly used by automated processes, but humans could use it for specific operator needs.

An operator was using that tooling to update new capacity. The reboot command for the selected new systems was mistyped and targeted every server instead. The postmortem says the tool lacked enough input validation to stop this without extra steps or confirmation. It ["went ahead and issued a reboot command to every server in us-east-1 availability zone without delay."](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014)

Recovery came in three waves, according to the [postmortem](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014):

- **80% of customer instances** were back within 32 minutes.
- **Over 90%** were back within 59 minutes.
- **The slowest** took 149 minutes (about 2.5 hours).
- **The API** was available again and service fully restored by 21:30 UTC.

## What the engineers believed

The postmortem doesn't spell out what the operator thought at the moment of typing, but the design shows the assumptions built into the system.

The first assumption: the remote-execution tool was mostly driven by automation. Automation passes exact target lists, and it doesn't make typos. A tool built mainly for machine callers can reasonably skip "are you sure?" prompts. The trouble is that humans used it too, and nothing changed about the tool when a human was holding it.

The second assumption was about the control plane. It was designed to be [highly available within a single data center and to survive any two failures](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014). That is a strong guarantee against independent failures: a disk dies, a server panics, a rack loses a switch. It says nothing about every replica being turned off at once on purpose. That isn't two failures, it's all of them.

The third assumption was that booting is cheap. Servers boot over the network all the time, and the boot infrastructure handles it.

## What was actually going on

### The boot path

Joyent servers don't boot from local disk. They boot over the network with PXE. When a server powers on, its network card broadcasts a DHCP request, gets an address plus the location of a boot image, and downloads that image over TFTP. Joyent ran its own [DHCP/TFTP system to answer PXE boot requests](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014).

The boot service normally gets its state from the control plane. But the control plane runs on servers that also have to boot, so Joyent designed the DHCP/TFTP system to cache what it needs. As a result, existing capacity could [boot even when the control plane was not fully available](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014). That was good design, and it's a large part of why customer instances came back long before the API did.

### Thundering herd at the TFTP server

The postmortem says the boot infrastructure, like the rest of Joyent's infrastructure, [normally has throttles](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014) so it can't run away with a machine. In normal operation that's correct: a handful of servers reboot at any one time, and the throttle protects the boot server from hogging resources.

When every server in the data center reboots at once, every one of them asks for a boot image at once. The postmortem calls the result ["extremely high contention on the TFTP boot infrastructure."](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014) The throttle that protects the boot server in normal times now set the pace for the whole recovery. Joyent spotted that the throttles were slowing compute-node boots and removed them, which let [most customer instances come online over the following 20-30 minutes](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014).

This is the general shape of a thundering herd. Any resource sized for the steady rate of an event (boots, cache refills, reconnects) gets crushed when all of those events arrive together. Rate limits make it worse in a specific way: the limit stops the resource from being overloaded, but it turns a spike into a queue, and recovery takes as long as draining that queue.

```diagram
title: why recovery queued up
flow: normal day -> few PXE boots -> throttle is fine
flow!: all servers reboot -> TFTP contention -> throttle = queue
note: throttles removed, most instances back in 20-30 min
```

### The long tail: a 10% NIC bug

The servers still down well after that hit a separate, already-known problem. Some legacy hardware had a network card driver bug where getting a DHCP lease at boot [occasionally fails, about 10% of the time](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014). The fix was just to reboot those machines again, which operators did as they found them. Newer hardware used different cards, which kept the impact to a smaller number of nodes.

A 10% boot failure rate barely matters when servers reboot one at a time, because someone notices and reboots it again. When the whole fleet reboots, 10% of the legacy machines all fail together, and each one needs a person to find it.

### The API: designed not to come back by itself

The API took longest for a reason Joyent describes as partly intentional. The stateful parts of the control plane were built to tolerate failures of a minority of replicas. When the entire data center rebooted, all of them failed together, and they ["did not maintain enough history to bring themselves online"](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014).

This is how quorum systems behave. Losing a minority of replicas is fine, because the survivors still hold the truth and new members catch up from them. If every replica restarts, there are no survivors to agree with. Each node has to decide whether its own on-disk state is the latest. A system that guesses wrong comes up split-brain, with two sides each believing they're authoritative and accepting conflicting writes. Joyent chose the safe side: it would ["rather systems be unavailable than come up 'split brain' and suffer data loss."](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014) That meant operators had to recover those components by hand, which is the main reason the API took 1 hour 17 minutes.

## How they fixed it

During the incident, from the [postmortem](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014):

1. They removed the TFTP boot throttles once they saw these were slowing compute-node boots.
2. They rebooted again the legacy nodes that hit the DHCP lease bug, as they found them.
3. They recovered the stateful control-plane components by hand, then restored the API.

## What changed afterwards

Joyent listed three commitments:

- **Stricter tooling.** Input validation would be tightened so that the tooling would [not allow all servers and control plane servers to be rebooted simultaneously](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014). They would also reconsider which tools are needed so that "full power" tools aren't the only way to do routine tasks.
- **Unattended control-plane recovery.** Joyent would record state on each node so the control plane could recover from a simultaneous reboot of every node [without human intervention](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014), while accepting that it could not serve requests during a complete outage.
- **Moving off legacy hardware.** They would move customer instances off older platforms more aggressively, case by case with each customer.

The second item is the interesting one. Joyent didn't promise "this can't happen again." It promised that if it does happen, the system will come back on its own.

## The rule

Any tool that can act on every server needs its blast radius built into the interface. "All" should be hard to say by accident: a separate flag, an explicit count to confirm, or limits on how many hosts a single invocation can touch. That matters most when the tool was built for automation and humans borrowed it.

The second lesson is quieter. Write down which failures your redundancy actually covers. "Survives any two failures" is a claim about independent failures. A correlated event, like the same command on every host, the same power feed, or the same firmware, can take out all of the replicas at once. When that happens, recovery depends on your cold-start path, which you may never have exercised: the boot server's throttle, the 10% NIC bug, the quorum with nobody left to vote. Practise starting from cold before a typo forces you to.

## Sources

- [Joyent, "Postmortem for outage of us-east-1", 28 May 2014 (archived)](https://web.archive.org/web/20220406095752/https://www.joyent.com/blog/postmortem-for-outage-of-us-east-1-may-27-2014): Joyent's official postmortem, covering architecture, root cause, recovery timeline and next steps.
