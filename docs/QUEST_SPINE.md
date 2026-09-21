# The quest spine: why you are a CEO, and what the journey is

**Design only (AB#584, ISP-21). Nothing here is built. The Board signs this off on AB#584 before any implementation
item is opened against it.**

The Board, 2026-09-20: *"I think I'd like the whole game to be quest driven... Friendly popups that guide you along the
way with like a story as to WHY you're becoming a CEO and like the journey."*

This document answers the five questions on AB#584:

1. Who the player is, and why the ISA licensed them.
2. The first act, beat by beat.
3. Quests as data.
4. Quests and the milestone ladder.
5. Guidance that stays friendly without becoming noise.

It then covers the anticipation requirement from Depth Critique #426 (epic 5), prior art, what writing it turned up in
the build, and the implementation order it proposes.

The worked example is [`quest-spine/act-1.example.json`](quest-spine/act-1.example.json), and its schema is
[`quest-spine/quest.schema.json`](quest-spine/quest.schema.json). `tests/schema/quest-spine.test.js` checks that the
example fits the schema. It also checks that every route, research id, station, lease body, contract, tab, metric and
timer the example names exists in the build. A beat cannot quietly depend on something that isn't there, which is how
the milestone ladder broke (#424).

**What it was written against.**
- `main` at b45dbf3.
- The resolved ISP-16 (#579, Builder #2's !156, stacked on !153 for #585), which the first act starts from.
- Three open pull requests the design assumes will land: !143 (standing buy orders on a fresh install), !146 (contract
  rewards reach the balance) and !157 (Levels 6 to 10 reachable).

Where a beat needs one of those, the table says so.

---

## 1. Who the player is, and why the ISA licensed them

**The player is the registered CEO of a corporation chartered in 2147.** That is all the build already says: the
settlement licence in the inbox (`public/scripts/liaison.js welcomeLetter`) tells the player the corporation "has been
assessed and approved under the provisions of the Interstellar Settlement Protocol (Earth Assembly Act, 2147)". LORE.md
sets the tone this has to keep: *"There are no chosen ones... You are not saving anything. You are building
something."* So the player is not special, and the story should not pretend otherwise.

**Why them, and why now: the 2147 Charter Round.** This is proposed lore, for the Board to accept or change.
- The Protocol is revised about every eleven years at the Revised Settlement Conference (LORE.md). The 2147 revision,
  the Earth Assembly Act the licence cites, opened a **Charter Round**.
- The eleven registered corporate blocs that signed the treaty hold most Sol leases, and many sit idle: a lease is
  cheaper to hold than to work. Meanwhile the ISA's construction depots wait on material, which the Bureau's
  requisitions in `MISSION_TEMPLATES` already describe: "a shortfall of nickel across ISA-administered construction
  depots", "station expansion projects require titanium".
- The Round licenses small, new corporations that commit to **production**, and assigns each one a Bureau coordinator
  who is measured on whether her charters deliver.

The player was licensed because they applied and passed assessment, not because they were chosen. What they have
been given is a probationary charter and a coordinator with requisitions she needs filled.

**What the player wants.** This is left to the player, deliberately. They typed a CEO name and a corporation name; the
game uses both (`{{ceoName}}`, `{{corpName}}`) and never tells them why they wanted this. A management game's player
supplies their own ambition, and inventing one for them is the "chosen one" move the lore rules out.

**What the coordinator wants.** This is the return reason. AB#584 puts it plainly: *"A character who is waiting on
something does"* bring a player back. The coordinator's record at the Bureau rides on her charters delivering. She has
a requisition that has been open for eleven days. She is not warm, because her bio in `MISSION_AGENTS` is precise,
procedural and unsentimental, but she is invested. When the player delivers, she remembers:
`corp.agentReputation[agentId].completedCount` already counts it. The story's spine is the Charter Round review:
*production, delivery, trade*, then confirmation. That maps directly onto the ladder's first three levels (section 4).

**The narrator is a role, not a name.** Every quest file names its speaker as a role (`"narrator": "coordinator"`). The
client resolves the role to a character through one registry: today `ASSIGNED_COORDINATOR` in
`public/scripts/liaison.js` (#585), which the welcome letter and walkthrough already read. Quest text never names her.
It uses `{{speaker.name}}` and `{{speaker.title}}`, and the test fails if "Voss", "Elara" or "Aria" appears in quest
data. If the Board changes the guide, one file changes.

---

## 2. The first act, beat by beat

The walkthrough (ISP-16, `public/scripts/walkthrough.js` on !156) ends at its `handoff` step, on the Overview: *"Once
your corporation is established, come and see me on Deck 7. I have a Silicate Requisition Order — Batch 4-7A that
needs an operator who delivers on schedule."* It names the contract in `handoffContractId: "ms-log-001"`, and
`FIRST_CONTRACT_ID` in `server/gameState.js` guarantees a corporation with no contracts is offered it. Act 1 picks up
that sentence.

**Act 1 opens** when the walkthrough is finished (`playerProfile.walkthroughCompleted`) **or** the corporation reaches
Level 1, whichever comes first. The second condition is for the player who declined the walkthrough: the build records
a decline only in the browser (`markWalkthroughOfferSeen`, localStorage), so the server cannot see it. Recording it on
the server is implementation item 1.

**It closes** at Corporation Level 3, the "charter confirmed" beat, and hands over to Act 2.

Money, from the build:
- A new corporation has 250,000 credits.
- The office is 1,000 a day (7,000 for the minimum 7 days, `rent-office`). A hire is 2,000 plus 150 a day of payroll.
- The Earth lease is 20,000 and the Mars lease 25,000 (`data/systems.json`). A Basic Extractor Yard is 50,000
  (`build-extractor`).
- A cycle costs `max(600, 16 × throughput)` an hour to run, and 35% of one hour to start (`start-mining`).
- Basic Extraction Analytics is 2,000 and 2 hours (`data/research.json`).

Act 1's purchases (office, ten hires, two leases, one yard, one research) come to 124,000 before cycle costs, so every step is affordable on the starting balance.

| # | Beat | What the coordinator asks | Done when (condition) | Uses in the build | Pending outcome the player can see |
|---|---|---|---|---|---|
| 1 | **Established** | An office on the station and five on the payroll: "The Charter Round is judged on production." | `level ≥ 1` | `rent-office`, `hire`; Level 1 in `data/milestones.json` | none; this is the first half-hour |
| 2 | **Deck 7** | Take the requisition that has been open eleven days. | `missionActive:ms-log-001` | `accept-mission`; `MISSION_TEMPLATES` ms-log-001; the guaranteed first offering (!156) | none |
| 3 | **A claim and a yard** | An Earth claim, and a Basic Extractor Yard on it. | `miningLease:Earth`, `building:Basic Extractor Yard` | `purchase-lease`, `lease/:leaseId/build-extractor`; Earth `leaseCost` | none |
| 4 | **Production** | Start a cycle; you choose the throughput, and the operating cost is yours: "I would rather you delivered late than went insolvent on my contract." | `extractorsRunning ≥ 1` | `lease/:leaseId/start-mining` | **The cycle's end** (`extractor.endsAt`), with silicates accruing at Earth Station Prime |
| 5 | **While it runs** | Queue Basic Extraction Analytics: 2 hours, +10% on every yard. | `techQueued:` or `unlockedTech:tt-basic-extraction` | `queue-rnd`; `data/research.json` | **Analytics completes** (+10% extraction), and the cycle's end |
| 6 | **Delivery** | Bring 400 silicates to the Bureau. The card shows **n / 400** from Earth Station Prime stock. | `missionCompleted:ms-log-001` | `complete-mission`; its quota; reward to the balance (!146) | **The cycle's end** ("the last of the 400 units"). At 40 t/h the quota takes 10 hours, at 250 t/h under 2, so for most players this is the first thing they come back for |
| 7 | **Trade** | "A corporation that only delivers to the ISA is a contractor." Sell 300 on the Exchange. | `stat:silicateSoldOnExchange ≥ 300` | `market/npc-orders/:orderId/sell`; Level 3 in `milestones.json`; standing orders on first boot (!143) | **The Bureau posts new requisitions** (`contracts.nextRefreshAt`, every 2 hours) |
| 8 | **Mars** | "The Charter Round counts production on Mars." Travel to the Mars Orbital Dock, hire to ten (five per lease), and file a Mars claim. | `miningLease:Mars`, `level ≥ 2` | `hire`, `travel`, `purchase-lease`; `mars-orbital-dock`; Level 2 | **Arrival at Mars** (`travel.arrivesAt`, 15 minutes in production) |
| 9 | **Confirmation** | Level 3 on record, then she files. | `level ≥ 3` | Level 3 in `milestones.json` | **Analytics completes**, if not already done |

**Letters.** Beats 6 and 9 send an inbox letter from the coordinator, through the message store that already carries
the licence and player mail. Beat 6 is *"Requisition 4-7A: delivery confirmed"*; beat 9 is *"Charter Round 2147:
confirmation of {{corpName}}"*. The letters are the permanent record the player can reread; the popups are not.

**The Mars beat bridges a gap the audit found.** The ladder's Level 2 asks for a Mars lease, and the walkthrough, rightly
for a new player, points at the Earth lease: the Earth station only offers Earth, and the Overview's "Go to Station" for
Mars leads nowhere (#1061, filed by the first-session audit). Beat 8 is where the story does that work: it gives a reason
to go to Mars and shows how to get there. It does not fix #1061's link, which stays that bug's job.

**Skipping what is already done.** Beats 1, 3, 5, 7, 8 and 9 carry `skipIfAlreadyMet`. A player who did those things
before being asked, from the walkthrough or on their own, is never asked for them. The step completes silently, with no
brief and no popup.

**Act 1's handoff: the "what now?".** When Act 1 closes, the Overview's objective card shows three things:
- The Level 4 requirements, from `milestones.json`.
- When the Bureau's next requisitions post.
- When the running cycles end.

Act 2 opens on the same card. The player is never left with a finished sequence and a blank screen (section 8).

---

## 3. Quests as data

An **act** is one JSON file (`quest.schema.json`). Once built, the files live in `data/quests/act-<n>.json`; today the
one example is in `docs/` so that nothing loads it. Each act has:

- `narrator`: a speaker **role** (`coordinator`), resolved by the client from one registry. Steps may override it with
  `speaker`.
- `ladder: { from, to }`: the span of the milestone ladder the act walks. The last step's objective is `level ≥ to`,
  and the test enforces it.
- `opensWhen`: conditions, of which any one opens the act.
- `steps[]`, each with:
  - `brief`: a title and text, shown once when the step opens.
  - `objective`: a label for the objective card, and conditions (`all` or `any`).
  - `progress`: optional, a number against a target, such as silicates n / 400.
  - `hints`: optional one-line nudges shown on the card while their condition holds, such as "Hire to ten first". Never
    a popup.
  - `guide`: the tab and element the card's **Go** button opens and highlights, in the walkthrough's own shape.
  - `uses`: the routes and data files the step relies on. This is the acceptance's "each beat naming the existing
    system", and the test checks every one.
  - `skipIfAlreadyMet`.
  - `pending[]`: what is finishing while the step is open. Each item has a `source` (a timer the server keeps), a
    `label` and a `payoff`: the named thing the player gets.
  - `done`: text, and optionally an inbox `letter`.
- `closes.handoff`: the next act, and at least one objective and one pending outcome to show.

**Conditions use the milestone ladder's own vocabulary.** A condition is `{ metric, atLeast }`, and `metric` is a string
in the language `resolveMetric` in `server/gameState.js` already reads for `data/milestones.json`: `stat:`,
`employeeCount`, `miningLease:`, `building:`, `building-count:`, `totalMined:` and `unlockedTech:`.

The act needs eight more kinds. This design proposes adding them **to that same resolver**, not to a second one, so the
ladder and the quests cannot drift apart. Each reads state that exists today:

| Proposed kind | Reads |
|---|---|
| `level` | `corp.level` |
| `walkthroughCompleted` | `playerProfile.walkthroughCompleted` |
| `missionActive:<id>`, `missionCompleted:<id>` | `corp.activeMissions`, `corp.completedMissions` |
| `dockedAt:<stationId>` | `corp.currentStationId` |
| `techQueued:<techId>` | `queues.corporateRnD` |
| `extractorsRunning` | `corp.mining.silicateExtractors[].active` |
| `stationStock:<stationId>:<item>` | `corp.inventory` |

**Pending sources** are timers the server already keeps:
- `extractor.endsAt`
- `rnd.completion` (`startedAt + durationHours`)
- `travel.arrivesAt`
- `contracts.nextRefreshAt`
- `office.rentedUntil`

Later acts add refinery cycles, probe fabrication and expeditions the same way.

**State.** One object per corporation, `playerProfile.quests = { act, step, completed: [{ act, step, at }], briefsSeen:
[...] }`. It is evaluated on the server wherever `evaluateLevelProgress` already runs, which is every read and every
mutation, and published to the client the way `levelProgress` is. The server decides what is done, and the client only
draws it. That matches how the ladder works and is what makes the letters possible.

**Placeholders** are `{{corpName}}`, `{{ceoName}}`, `{{speaker.name}}` and `{{speaker.title}}`, and the test allows no
others.

---

## 4. Quests and the milestone ladder

**The ladder stays the source of truth, and the quests walk it.** Three options were weighed:

- **The ladder becomes the quest** (milestones.json replaced by quests). This was rejected. The ladder's 30
  requirements over 10 levels are a checklist that grants unlocks: employee cap, building slots, Fleet Cap, market
  sectors. Retelling every requirement as a story beat either makes 30 beats of equal weight, which is noise, or hides
  requirements, and a hidden requirement is how #424 happened.
- **Parallel and independent.** This was rejected too: two progressions that can disagree about what the player should
  do next.
- **Chosen: the quests narrate the ladder.** Each act spans a stretch of levels (`ladder: { from, to }`) and closes on
  reaching its top. Its beats pick the requirements worth a story and explain *why* they matter. The rest stay on the
  Overview's milestone card, as today. **Quests grant nothing of their own.** Unlocks come from levels, and credits come
  from contracts that already pay (ms-log-001 pays 12,000). So a player who ignores every popup progresses exactly as
  fast as one who reads them, and there is no second economy to balance.

After #424 (!157) the ladder reaches Level 10, and the acts span it:

| Act | Levels | The story | Built on |
|---|---|---|---|
| 1 **The Charter** | 0 → 3 | Production, delivery, trade: the Charter Round review. | Office, hires, leases, yards, cycles, first research, ms-log-001, the Exchange, travel to Mars |
| 2 **Capacity** | 3 → 5 | The Bureau's requisitions grow; the incumbents notice. Second and third yards, a second lease, Industrial Safety and Energy Routing, 50,000 silicates sold. | Levels 4 and 5; ms-log-002 onward; `tt-industrial-safety`, `tt-energy-routing` |
| 3 **Beyond the claim** | 5 → 8 | What the ground cannot give: the Assembly Facility, probes and the belt, and the first refinery. Contracts for nickel, titanium and carbon become deliverable here, because expeditions bring them in. | Levels 6 to 8 (!157); `tt-assembly-fabrication`, `tt-asteroid-prospecting`, `tt-material-compression`; probe fabrication, expeditions, refinery chains; `stat:missionsCompleted` |
| 4 **Luna** | 8 → 10 | LORE calls Luna "a political landmine". A Luna claim, refined goods at volume, and the navigation array to leave Sol. | Levels 9 and 10 (!157); `miningLease:Luna`; `tt-nano-lattice`, `tt-proxima-navigation` |

Acts 2 to 4 are outlines. Each is written as data only after Act 1 has been built and played. A test in the same file
will check them against the build the same way.

---

## 5. Friendly without becoming noise

The rules. Each is stated so an implementation can be checked against it.

1. **One voice, one surface.** A step's brief pops up once, when the step opens. After that the step lives on an
   **objective card** on the Overview: label, progress, hints, pending outcomes and a Go button. Nothing else pops up
   for it.
2. **Never over an action.** A brief waits until no other modal is open (the trade confirmation, the walkthrough, a
   dialogue), and never interrupts a form. In one run while testing !162, a first-day dialogue appeared on top of an
   open trade confirmation; the quest layer must not add another way for that to happen.
3. **Silence for what is already done.** `skipIfAlreadyMet` completes a step with no brief at all. Several steps
   completing together (a returning player, or an expert who raced ahead) produce **one** summary line, not a stack of
   popups.
4. **The return digest.** On a login after more than an hour away, one panel lists what finished while they were gone
   and what is still running, with names: *"Your Earth cycle ended: 1,800 silicates at Earth Station Prime. Basic
   Extraction Analytics is complete: +10% extraction. The Bureau posted two requisitions."* It appears once and can be
   closed, and the same list stays on the objective card.
5. **A player can turn it down.** There are three settings, *Brief me* (default), *Objectives only* (no popups, the card
   stays) and *Off*, plus a **Replay** for any completed brief from the letters and the card. The walkthrough's
   "replay onboarding" already sets the precedent.
6. **No nagging.** A hint is a line on the card, never a popup, and never repeats as a notification. No "you haven't
   played in N days" messages; the BRIEF measures D3 return *without a reminder*, and that is the point.
7. **Nothing expires** (section 6).

---

## 6. Anticipation, not timers (Depth Critique #426, epic 5)

#426 scores the return reason 2 of 5 because the hook is "a timer elapsed". Its epic 5 asks for *"one visible, named
thing waiting at the end of a delay... surfaced before the player logs off"*. The design's answer: **every pending item
is shown with its payoff, not its clock.** "Analytics completes: +10% extraction on every yard" rather than "2h
remaining". The clock is secondary text.

**At every point after the first thirty minutes, at least one named pending outcome is visible:**

| When | Pending, with its payoff | Source |
|---|---|---|
| Minute ~30 onward (beat 4) | The Earth cycle ends: silicates at Earth Station Prime, n / 400 toward the requisition | `extractor.endsAt`, `corp.inventory` |
| Beat 5 onward | Analytics completes: +10% extraction on every yard | `rnd.completion` |
| Beat 7 onward | The Bureau posts new requisitions: a second contract | `contracts.nextRefreshAt` (2 h) |
| Beat 8 | Arrival at Mars: the Mars claims office | `travel.arrivesAt` (15 min) |
| Act 1 close and beyond | The Level 4 objective, the next requisitions, running cycles; later research, refinery cycles, probe fabrication and expeditions | as above; later acts add their sources |

The test enforces the shape of this: once a step has a pending outcome, every later step has one, and the act's handoff
shows at least one.

**Nothing expires in a way that punishes absence:**
- **Contracts have no deadline.** The build stores none and enforces none. The ms-log-001 text says "within the
  deadline", which is copy promising something the build does not do. It is filed as #1104, to be
  fixed in the copy, not by adding a deadline.
- **Quest steps never time out.** A player who comes back after a month finds the same step, the same card and a return
  digest.
- **The daily NPC quota reset** is a refill, not a loss (1,000,000 units a day of Silicates; #426).
- **The one existing expiry, the office lease** (`offices[].rentedUntil`, 7 to 28 days), only blocks *starting* a new
  cycle (`start-mining` answers `office-lease-expired`). Running cycles are not touched, so it does not punish absence
  by destroying anything. Nothing warns before it lapses, though, so the design adds a reminder: a hint on the objective
  card from 48 hours before `rentedUntil`, and a line in the return digest. It is a reminder, never a penalty, and it
  changes no rule.

---

## 7. Prior art

- **CCP, the "what now?" moment.** CCP's public account of rebuilding EVE Online's new-player experience is that only
  5 to 10% of sign-ups ever reach the gameplay that attracted them. The critical moment is when the guided sequence
  ends and the player asks "what now?" ([CCP, *Improved New Player
  Experience*](https://www.eveonline.com/news/view/improved-new-player-experience); [EVE Fanfest 2014, on replacing
  tutorials](https://www.aol.com/news/2014-05-06-eve-fanfest-2014-eves-plan-to-remove-tutorials-and-reinvent-th.html)),
  both cited in #426. ISP's walkthrough ends at "accept your first mission", the same place.
  - **What this design takes from it:** the guided sequence never simply ends. The walkthrough hands to Act 1 by name
    (the promised contract), each act hands to the next with an objective and a pending outcome on screen, and the
    objective card is never empty. When content runs out, it falls back to the next ladder level.
  - **What it does not take:** CCP's answer includes career agents in several lines of work. ISP has one Bureau and one
    coordinator today, and this design does not invent more.
- **Anticipation versus timers.** The retention sources #426 cites (reward timing, day-3 novelty exhaustion) are why the
  pending outcomes are named by their payoff (section 6).

---

## 8. What writing this turned up in the build

| Finding | Where | Status |
|---|---|---|
| Level 2 wants a Mars lease; the Overview's Go link leads to a station that cannot lease Mars | `data/milestones.json` Level 2; Overview | **#1061**, filed by the first-session audit. Act 1 beat 8 carries the story, and the link is still that bug's |
| The contract text promises a deadline that does not exist, and names the coordinator in the data ("Coordinator Voss requires...") | `MISSION_TEMPLATES` text | **#1104**, severity 4: fix the copy, do not add a deadline |
| The second contract on offer can ask for Cobalt, Thorium, Lithium or Water Ice, which a new corporation cannot produce until expeditions (Level 7) or buy except from other players | `refreshContractOfferings`, `BELT_COMPOSITIONS` | Design note: implementation item 6 offers what the corporation can produce first. Not a bug: there is no deadline, so an unfillable offer costs nothing |
| No notification when a mining cycle ends, or before an office lease lapses | `server/index.js` notifications | Design gap: implementation item 5 |
| A declined walkthrough is recorded only in the browser | `markWalkthroughOfferSeen` | Design gap: implementation item 1 |
| LORE.md says Earth has "no extraction rights"; the build leases Earth for 20,000, and the walkthrough and Act 1 use it | LORE.md Sol table | For the Board: the build and the walkthrough both depend on the Earth lease, so the recommendation is to change the LORE line, e.g. to "extraction licensed only to new charters". Not changed here |
| `main` still names the intro dialogue's speaker "Assembly Liaison Aria Voss" | `public/scripts/app.js` | Fixed by !153 (#585), open |

---

## 9. Implementation, once the Board signs off

No item is opened until then. This is the proposed order; each item is S or M.

1. **The resolver kinds and the decline flag (S).** Add the eight metric kinds to `resolveMetric`, with tests. Record a
   declined walkthrough on the server (`playerProfile.walkthroughDeclinedAt`).
2. **The quest engine (M).** Load `data/quests/*.json`, validate against the schema at startup (fail closed), keep
   `playerProfile.quests`, evaluate beside `evaluateLevelProgress`, and send letters on `done.letter`. The cross-catalog
   test moves from `docs/` to `data/quests/`.
3. **The objective card and briefs (M).** The Overview card (label, progress, hints, pending with payoffs, Go), a brief
   modal that waits for other modals to close, and the three settings from section 5.
4. **The return digest (S).**
5. **Two notifications (S).** A mining cycle has ended; the office lease lapses in 48 hours.
6. **Offer what can be delivered (S).** `refreshContractOfferings` prefers contracts for resources the corporation can
   produce or has in stock; the guaranteed first contract is unchanged.
7. **Act 1 as data (S)**, from this example, played end to end in a browser with screenshots before it is called done.
8. **Acts 2 to 4 (M each)**, written after Act 1 has been played.

## Decisions for the Board (veto any)

- **The Charter Round** as the answer to "why them" (section 1). It is new lore, consistent with LORE.md's tone.
- **Quests narrate the ladder and grant nothing of their own** (section 4).
- **The narrator is a role** resolved from `liaison.js`, so the guide can change without touching quest data.
- **Beat 8 sends a new player to Mars in the first act**, because Level 2 requires it.
- **The Earth lease stays**, and the LORE line changes to match the build.
- **Contracts keep having no deadline**, and the copy that promises one changes instead.
