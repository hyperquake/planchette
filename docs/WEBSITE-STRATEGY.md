# Planchette website strategy

Round one. August 2026. Prepared for Jeff Crouse, Hyperquake.

Planchette is a free tool from Hyperquake, closed source, living inside the
Hyperquake world rather than standing up a brand of its own. Everything below
follows from that.

## The decision this document makes

Build one page at `hyperquake.com/planchette` with a working simulator embedded
in it, publish the four docs already sitting in the repo, and do not launch
publicly until the macOS build is signed and notarized.

## What the site is for

Planchette is not a product hunting for users. It is proof, in working software,
that Hyperquake understands a category plenty of agencies pitch and few can
actually build. That reframes the whole site.

The primary job is to turn that proof into qualified conversations about
installation work. Adoption is the mechanism, not the goal. A designer at a
museum studio who spends an afternoon in Planchette has learned something about
Hyperquake that no case study can teach them.

The secondary job is ordinary and still valuable: give your own designers,
clients, and fabrication partners one canonical place to get the app and read
the rules for authoring against it.

## Who it is for, in order

**1. The practitioner.** A designer or creative technologist at an agency,
museum studio, exhibit fabricator, or experience shop. They download it. They
judge it in about ninety seconds. What they want to know: does it run, is it
honest about size and behaviour, and will it save them a trip to the shop floor
to test on the real table.

**2. The buyer.** A museum exhibit lead, brand experience lead, retail or trade
show marketer. They will never download it. They skim. What they take away:
these people have done this before, at a level of detail that is hard to fake.

**3. The channel.** Hardware vendors, AV integrators, and fabricators who sell
and install the tables. What they want: designers who can actually author for
the surfaces they sell.

Writing for the practitioner serves the buyer automatically, because nothing
convinces a buyer faster than watching you speak credibly to experts. The
reverse is not true: a page written for the buyer first is a page practitioners
bounce off in seconds. So write for the practitioner, structure for the buyer.

## The honest answer to "why is it free"

Free plus closed source raises a question, and a visitor who cannot answer it
assumes the worst. Answer it out loud, once, in plain language: Hyperquake
builds touch table installations, built this to design them, and is giving it
away because the work gets better when more people can design for these
surfaces.

That is the truth, it is on brand, and it costs nothing to say. Do not dress it
as generosity and do not hide the commercial logic.

One hard rule follows: **do not gate the download behind a form.** The moment
you ask for an email, "free" reads as a lead magnet and the practitioner leaves.
An optional way to hear about releases is fine. A wall is not.

## The strategic bet: the page should be the product

Planchette already runs standalone in a browser. Host and interface talk over
`postMessage`, the SDK is a static bundle, and the example interfaces are static
files. That means the landing page can embed a real, working simulator with a
puck on it.

No video. No screenshot. A visitor drags a puck and an interface responds, in
the page, before they have decided whether to trust you. Nobody else in this
category can do that, because every comparable tool is native only.

How it works in practice: an iframe of the host UI at reduced scale with one
example preloaded. `radial-atlas` reads best, since the puck does something
visibly spatial. Mouse-only interaction is fine; a single dragged puck is the
entire demo. On mobile, fall back to a short looping capture.

The cost is modest because the artifact already exists. The payoff is that the
trust problem is solved above the fold, which is the problem every other section
of the page would otherwise be working on.

## Message hierarchy for the hero

1. What it is, in one line. Something close to: design multi touch table
   interfaces without the table.
2. The claim that actually matters to a practitioner: laid out at the table's
   real resolution, pucks with TUIO semantics, and the same interface code that
   ships to the floor.
3. The proof: the live demo, immediately.
4. The action: download for macOS, download for Windows, read the docs.
5. The frame: a tool from Hyperquake, with the endorsement lockup.

## Page map, and what each section has to prove

| Section | Has to prove |
| --- | --- |
| Hero plus live demo | This is real and it works, without me installing anything |
| Three proof points | It is accurate about the physical table, not a toy |
| Examples | Someone has built non-trivial things with it |
| What it does not do | These people are honest, so the rest of the page is credible |
| Get it | It runs on my machine, and here is what I need |
| Docs | I can learn to author for it without asking anyone |
| Who made this, and why free | There is a real business here, and I know what it is |

The limits section is the one every competitor omits and the one that earns the
most trust. It is also the cheapest to write: it is a hardware simulator, so say
what it does not simulate.

## Domain

**Canonical: `hyperquake.com/planchette`.** It borrows the domain authority you
already have, keeps the tool inside the parent brand where the business value
sits, creates no second site to maintain and no second SEO footprint to build,
and lands the buyer audience already inside Hyperquake's world.

**Register `planchette.design` and redirect it** with a 301 to the canonical
path. It is memorable in conversation, it belongs in the app's About panel, it
is cheap, and registering it stops someone else from taking a name you have now
cleared. As of the availability check, `.design`, `.app`, `.io`, `.dev`,
`.studio` and `.tools` were all unregistered.

Do not build two sites. Mirroring splits your SEO and doubles the maintenance
for no strategic gain.

## Docs

Publish what the repo already has, largely unchanged in substance: the authoring
rules for interface designers, the protocol and event API, the workspace
introduction, and distribution notes. Four documents, two audiences, already
written.

Two disciplines matter. Version the docs with releases and put the version
number on the page, because a designer three releases behind needs to know which
rules apply to them. And generate the pages from the repo markdown rather than
adopting a docs platform; four files do not justify a toolchain.

There is a small, exactly qualified search opportunity here. Terms like TUIO
simulator, multitouch table software, and touch table prototyping have low
volume and almost no wasted traffic. The protocol page is the one that will
rank, because it is the only page on the internet a person searching that phrase
actually wants.

## Proof assets to produce

- The embedded live demo. Highest value item on the list by a wide margin.
- A twenty to thirty second screen capture, no narration, for mobile fallback
  and social.
- The three example interfaces in the repo, as a small gallery with one line
  each about what it demonstrates.
- One photograph of a real table running a Hyperquake installation, if the
  client rights allow. This single image is what converts the buyer.
- Tested system requirements. Not guessed.

## Measurement

Count downloads by platform, docs pageviews, whether visitors actually touched
the demo puck, and inbound inquiries that mention Planchette. The last one is
the only one that matters, so make sure the contact route from this page is
tagged well enough that attribution survives to the first meeting.

Do not count email signups you did not need, and do not report downloads as if
they were leads.

## Risks and dependencies

**1. Code signing. This is the blocker.** The mac builds are ad-hoc signed
today, which is correct for internal use and wrong for a public download.
Gatekeeper tells a stranger the app is damaged, which is a terrible first
impression and sends people hunting for a corrupt download that does not exist.
Get a Developer ID, notarize, staple. Windows needs the same treatment or
SmartScreen flags every download. Do not launch publicly before this is done.

**2. Support posture.** Free tools generate mail. Decide the posture now and
state it in one line: no SLA, no roadmap promises, bug reports welcome at an
address someone reads.

**3. Trademark.** The field was clear in classes 9 and 42 when we checked, with
the only live US registration being a bar in New Orleans in class 43. If
Planchette becomes a public product name, file before the launch publicity, not
after.

**4. Hardware claims.** Say TUIO aligned, not compatible with a named vendor's
tables, until the socket bridge exists and has been tested on that hardware.
Claiming compatibility you have not verified is the kind of statement that ages
badly and invites a letter.

**5. Source expectations.** Practitioners will ask for the source. Have a real
answer ready, and do not imply an open source release is coming if it is not.

**6. Drift.** Site copy describing behaviour the current release does not have
is worse than no copy. Anchor claims to releases.

## What round one is not

Not a blog. Not a newsletter. Not a community forum. Not pricing. Not a
Windows-first story if only the mac build is signed. One page that is true beats
five pages that are aspirational.

## Sequence

1. Signing and notarization. Blocking, so start it first.
2. Landing page with the live demo, plus the four docs published.
3. Soft launch to Hyperquake's own network and clients. Fix what breaks.
4. Practitioner channels: creative coding communities, TouchDesigner circles,
   museum technology networks, LinkedIn.
5. Channel conversations with hardware vendors and integrators, once there is a
   real page to point at.
6. Round two, shaped by what people actually asked for rather than what we
   guessed they would.
