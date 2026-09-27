# Desk Work and Bureau Standing: an effort-paced loop beside the time-paced ladder (AB#4689, AB#4690)

**Design only. Nothing here is built.** The Board asked for it in chat on 2026-09-27: *"something they can do that
benefits them, that's fun, that doesn't have much of a gate, or has a gate that allows for at least an hour of gameplay
straight... SOME sort of XP system... a very steady progression curve, where the game yields progression relative to the
amount of effort they put in... We want to reward effort."* The implementation stories are children of Feature AB#4689
and open when the Board accepts this document (section 11). Read against ISP `origin/main` at `36d52032`,
2026-09-27.

**Every number in this document is arithmetic from the data files and the code it names, or a proposal for the Board.
No player has been measured (P-PROXY).** Where a number is chosen rather than derived, it says so.

---

## 1. The problem, in the build's own words

The first day is thirty minutes of decisions and then a wait. NEW_PLAYER_EXPERIENCE.md's sequence (office, five
hires, an Earth lease, a yard, a cycle, one research item, the Exchange, Voss's contract) is the whole of what a new
corporation can do, and every one of those things then runs on a clock the player cannot touch:

| What the player started | How long until it gives them anything to do |
| --- | --- |
| A mining cycle at the best rate (60 t/h, ECONOMY.md T-018) | Voss's first contract wants 320-480 Silicates: **5 to 8 hours** |
| Basic Extraction Analytics | 2 hours; the tree's other 29 nodes are 3 to 36 hours each (`data/research.json`) |
| A CEO Insight program | 4 to 18 hours (`data/ceo-insight.json`) |
| The Bureau's next two contracts | `CONTRACT_REFRESH_MS`, 2 hours; a completed one is off the board for 4 (`server/game/corporation.js`) |
| An expedition | Level 7 research (8 h) + an Assembly Facility (60,000) + a probe (8,000, 30 min): not day 1 at all |

DEPTH.md has scored this three reviews running and its words have not changed: return reason **2**, "a timer
elapsed, not anticipation"; mastery **1-2**, "no opponent, no scarcity and no market pressure gives skill anything to
bite on"; decision density **2**. Review #1's fifth epic asked for *"one visible, named thing waiting at the end of a
delay"*; the quest spine (docs/QUEST_SPINE.md) answers that with pending outcomes named by payoff, and it is right, but
it makes the wait *legible*, not *shorter*. Nothing in the build lets a player convert an hour of attention into
progress. That is the gap this design fills.

Two constraints already on record shape the answer:

- **Quests grant nothing of their own, and there is no second economy to balance** (QUEST_SPINE section 4). The
  milestone ladder is the one progression, deliberately production-paced: the Board wants Level 40 to take about a
  year (AB#700), ~11 days a level (docs/design/ladder-11-40.md). An XP system that made levels come faster would be
  the "two progressions that can disagree" the spine rejected, and it would break the pacing the Board set.
- **No mouse-clicking action** (DESIGN_DOCUMENT.md). The verb is *allocate*; the game is "a spreadsheet that argues
  back" (BRIEF.md). Whatever fills the hour has to be reading, judging and deciding, not aiming.

So the design's first move is to put the XP on a **different axis from the ladder**. The ladder measures what the
*corporation* has produced and owns, and time paces it. Bureau Standing measures what the *CEO* has done for the ISA,
and effort paces it. They never read each other's counters (section 6), so a player who does an hour of desk work a
day is at exactly the same level as one who does none, and a good deal further along in standing, with the access and
the intel that standing brings.

## 2. What it is, in one screen

The Contracting & Assignments Bureau does not only requisition goods. The ISA's bureaucracy is "vast and deliberately
slow" (LORE.md), the Charter Round licensed a great many small operators (QUEST_SPINE section 1), and Coordinator
Voss's division has a backlog that does not need ore. A chartered corporation with an office can take **desk
assignments** from the Bureau at any station, at any hour, as many as it likes:

> **ISA-SRV-2147-004417 · Mineral Survey Division · Spectral return, Barnard's Belt, generation 3**
> Four passes, 22 s integration each. Readings, normalised, ± instrument error at this depth:
> Iron Ore 0.38 · Silicates 0.31 · Nickel 0.19 · Carbon 0.08 · Water Ice 0.04
> Reference profiles for the uncommon tier are attached. **Which resource dominates this belt?**

The player reads, decides, answers. The server grades it against the truth it generated the packet from, pays a small
fee, and adds to the corporation's **Bureau Standing**. Three more packets are already waiting. The Assignments tab
gains a **Desk** section beside the delivery contracts, and the Bureau Standing panel Voss's office already shows (the
reputation tiers in `data/missions.json`) becomes the thing the desk fills.

Three kinds of assignment, each a different skill, each built from a real system of the game so that doing the work
teaches the game and produces a real effect in it:

| Kind | Division | The document | The skill | What a correct answer does besides pay |
| --- | --- | --- | --- | --- |
| **Survey** | ISA Mineral Survey Division | Noisy spectral readings from a body or belt the corporation can see, with the tier's reference profiles | Reading noisy data against known profiles | **Publishes the survey to the corporation's own Starmap**: a belt is marked scouted for its current generation without a probe; a lease body's resource profile shows on the resource overlay |
| **Audit** | ISA Claims & Leases Division | A filing from an applicant or NPC corporation: headcount, leases, office, slots, a manifest, a declared tax rate. One clause is broken, or none | Knowing the rules the game itself enforces | Teaches every rule the player will hit later, with a reason (FIRST_SESSION_AUDIT.md found the build's own errors give none) |
| **Dispatch** | GEX Routing Desk | A shipment or a requisition to fill: quantities, stations, listings, fees and transit times | Arithmetic on the real fee and transit tables | Teaches the Logistics tab and the Exchange, which DEPTH.md says the rational day-1 player never opens |

The **tone** is the game's own: every packet has a reference number, a division, an integration time or a filing date,
and one procedural line. Nothing chatty. docs/design/BUREAUCRATIC_UI.md's section codes apply to the Desk as to every other panel.

## 3. Rules

1. **Always available, from day 1, from anywhere.** The Desk needs a registered office (the treaty's "registered
   presence", the walkthrough's first step) and nothing else: no credits, no research, no station. It is the one
   activity in the game with no clock in front of it.
2. **Three open packets at a time, replenished on completion.** There is no refresh timer. Completing or declining a
   packet draws the next. Declining is free and costs no standing; it is how a player skips a kind they dislike.
3. **Generated and graded on the server, from the game's own data, seeded per corporation.** A packet's truth is a
   real body or belt (`data/systems.json`, the live belt state), a real rule (the ones `purchase-lease`, `hire`,
   `start-mining` and the Exchange routes enforce), or a real route (`server/transfers.js`). Nothing in a request sets
   the truth or the grade (the standing.js rule, T-019). A packet is generated when it is drawn and its answer is
   stored on the server; the client sees the document and never the key.
4. **Pay is small and bounded; standing is not bounded.** Each correct packet pays a fee by tier (section 5) and one to
   three standing points by tier. After `paidAssignmentsPerDay` correct packets in a UTC day the fee falls to
   `overCapPayPct` of itself for the rest of the day; standing keeps accruing at full rate. An incorrect answer pays
   nothing, costs nothing, and the packet is spent (a fresh one is drawn). Partial credit exists only where a packet
   asks for a number within a tolerance.
5. **Tiers by grade.** Tier 1 packets are open to every corporation. Tier 2 opens at Recognized, tier 3 at Trusted
   (section 4). A higher tier has more distractors, more noise, more steps and pays more.
6. **Standing does not decay, and nothing at the Desk expires.** Faction standing (`server/game/standing.js`) decays
   2% a day because it is *influence*; Bureau Standing is a *record* ("she keeps count", `data/missions.json`). A
   player away for a month finds the same grade and the same three packets. Nothing punishes absence (DEPTH.md epic 5).
7. **Bureau Standing never satisfies a ladder requirement, and desk work never counts as a contract.** Desk packets
   increment their own counters (`stat:deskCompleted`, `stat:deskCompleted:<kind>`), not `missionsCompletedTotal` or
   `completedMissions`. `data/milestones.json` may not name a desk stat, and the cross-catalog test enforces it
   (section 6).
8. **No real money touches any of it.** Standing, tiers, packets and their pay are earned in play only. This is a
   research-and-insight-shaped system and BRIEF.md's second Board ruling (AB#980) applies to it as written.

## 4. Bureau Standing: the XP track

**It already half exists.** Every completed contract adds one to `corp.agentReputation[agentId].completedCount`
(`server/routes/missions.js`), and `standingFor(count, REPUTATION_TIERS_DATA)` turns the count into one of eleven
titles: Unknown, Registered, Recognized, Reliable, Trusted, Valued, Distinguished, Esteemed, Elite, Legendary, Exalted,
at thresholds 0, 1, 3, 7, 15, 30, 60, 120, 250, 500, 1000. Voss's dialogue promises it ("every contract you complete
raises your standing with me"), the completion receipt reports it (AB#744), and two CEO Insight programs name it
without reaching it: Bureaucratic Persuasion "+15% ISA reputation gains" and Contract Law Essentials. This design
keeps the titles and the shape and changes what feeds them.

**From a count to points.** `completedCount` becomes `points`. A completed contract is worth **10 points**; a correct
desk packet is worth **1, 2 or 3 by tier**. The thresholds are multiplied by ten, so a corporation with one contract
done is Registered exactly as today, and every existing save migrates by `points = completedCount × 10`.

| Grade | Points | Contracts alone (today's pace) | Desk alone at tier 1, 20 packets an hour | Desk with tiers as they open |
| --- | ---: | ---: | ---: | ---: |
| Registered | 10 | 1 | 30 min | 30 min |
| Recognized | 30 | 3 | 1.5 h | 1.5 h · tier 2 opens |
| Reliable | 70 | 7 | 3.5 h | ~2.5 h |
| Trusted | 150 | 15 | 7.5 h | ~4.5 h · tier 3 opens |
| Valued | 300 | 30 | 15 h | ~7 h |
| Distinguished | 600 | 60 | 30 h | ~12 h |
| Esteemed | 1,200 | 120 | 60 h | ~22 h |
| Elite | 2,500 | 250 | 125 h | ~44 h |
| Legendary | 5,000 | 500 | 250 h | ~85 h |
| Exalted | 10,000 | 1,000 | 500 h | ~170 h |

The desk columns assume every packet is answered correctly and 20 packets an hour, which is a bot's pace (a packet is a
minute or three to read); a person is slower and misses some, so these are lower bounds on time. The shape is the
point: the first three grades arrive inside the first session, and the top of the track is months of evening play.
Contracts and desk work feed the same number, so a corporation that mines and delivers climbs it too, more slowly;
Bureaucratic Persuasion's +15% finally applies to something (every point earned, from either source).

**What a grade gives.** Perks are access, information and ISA-facing terms. None is a market advantage over another
player (the Negotiation Fundamentals precedent in BRIEF.md: an Exchange discount is taken out of other players'
trades, so nothing here touches the Exchange), and none is a level.

| Grade | Grants |
| --- | --- |
| Registered | The grade shows on the corporation's public card: the directory, forum posts, Exchange listings, mail. Honest social proof, nothing more |
| Recognized | **Tier 2 packets.** A **third contract** on the Bureau board (`CONTRACTS_PER_AGENT` 2 → 3 for this corporation) |
| Reliable | Survey packets at tier 2 publish a belt's full composition, not only its dominant resource (section 5) |
| Trusted | **Tier 3 packets.** The Bureau's board **refreshes hourly** for this corporation (`CONTRACT_REFRESH_MS` 2 h → 1 h) |
| Valued | **Priority processing**: `priorityProcessingPct` (proposed 5%) off ISA fees the corporation pays the ISA directly: lease purchases and office rent. Pure sinks, no counterparty. *Flagged: it lowers two sinks a little; the Board may set it to 0* |
| Distinguished | A **fourth contract** on the board. A letter of commendation in the inbox, from the coordinator, naming what was done |
| Esteemed | **Sponsorship**: the corporation may vouch for one other corporation a week; the sponsored corporation's board refreshes hourly for seven days. The first perk that is about another player (Phase 2, section 10) |
| Elite, Legendary, Exalted | Letters, and the grade. Anything more is a later design; these are months away for anyone and there is no reason to spend them now |

Why the contract slot and the refresh are the meaningful perks: the ladder's bands D and F (docs/design/ladder-11-40.md)
count contracts, and *"two contracts on offer with a 4-hour cooldown"* is named there as one of the four things that
bound production. More offers and a faster board let an active player deliver more contracts a day, which is the one
place standing touches the ladder at all, and it does so only through contracts the corporation still has to mine
for. It rewards effort with *opportunity*, never with the level itself.

## 5. The packets

Every kind has three tiers. The generator for each is a pure function of a seed and the game data, under
`server/game/desk.js`, and every grader is the same function's inverse; `tests/unit/desk.test.js` draws a thousand
packets of each kind and tier and asserts the stored answer grades correct and every distractor grades incorrect.

### Survey (ISA Mineral Survey Division)

The truth is a body's `resourceProfile` or a live belt's `composition` (server/game/belts.js; the belt's current
generation). The readings are the truth with seeded noise and, from tier 2, one or two distractor resources that are
not in the body at all.

| Tier | Subjects | Noise | The question | Correct when | Publishes |
| --- | --- | --- | --- | --- | --- |
| 1 | Sol bodies and Sol's belt | ± 15% of each share | Which resource dominates? | It is the true maximum | The body's or belt's dominant resource on the corporation's Starmap overlay |
| 2 | Bodies and belts in systems the corporation's research can reach | ± 30%, one distractor | Rank the top three | All three in order | The full composition; a belt is **marked scouted** for this generation (`asteroidMining.scoutedBelts`) |
| 3 | Rare and exotic belts anywhere | ± 45%, two distractors, four passes of differing reserve estimates | Rank the top three, classify the rarity tier, estimate remaining reserve within ± 20% | All three parts | Composition, rarity and reserve on the corporation's Starmap |

A tier-2 or tier-3 survey is the design's bridge to the expedition loop that Level 7 gates: a new corporation can
know what is in Barnard's Belt on day 1, and by the time it has a probe it knows where to send it. Scouting is "a
recurring decision" since belts respawn (docs/design/belts.md rule 6); a survey is the effortful way to make it, a probe
the capital way. The conglomerate intel that shares scouting (server/game/intel.js) shares surveys the same way, since
it reads `scoutedBelts`.

### Audit (ISA Claims & Leases Division)

The truth is one of the game's own rules. A filing is generated for a named NPC corporation (`data/npc-corporations.json`)
or an applicant with a name drawn from a fixed list (no free text, Decision D-0.12-1's rule for generated names), and
one clause is broken, or, in 30% of packets, none is. The player names the clause or certifies the filing.

| Tier | Clauses drawn from | Distractors | The question |
| --- | --- | --- | --- |
| 1 | Five employees per lease; an office before a lease; two slots per lease; a lease body's price (`data/systems.json` `leaseCost`) | Two irrelevant clean fields | Which clause fails, or compliant? |
| 2 | Tier 1 plus: a manifest priced below the ITC line (85% of normal value, the dumping rule); a declared Exchange tax that ignores the lease royalty (8% + `royaltyPointsByLeasesHeld`); a standing order over its daily quota | Four clean fields, one near-miss | Which clause, and by how much? |
| 3 | Tier 2 plus: a yard priced without the growth rule (`extractorYardPriceGrowth`); a tier upgrade past the corporation's `maxUpgradeTier`; an expedition launched past `maxDeployments`; a conglomerate over its member cap | Six clean fields, two near-misses, arithmetic that has to be done | Which clauses (there may be two), and the corrected figures |

Every clause is one the build enforces today, and the packet's explanation on grading (right or wrong) is the rule
in one sentence with its number. FIRST_SESSION_AUDIT.md filed #1057 and #1058 because the game's own refusals
("Insufficient credits to start the mining cycle. Check your finances.") give no next step; a corporation that has
audited fifty filings knows the rulebook before it hits one.

### Dispatch (GEX Routing Desk)

The truth is `transferFee` and `transitTime` (server/transfers.js) and the standing bids and asks
(`npcBidFor`, `npcAskSpecs`). The stations are the registry's (`server/game/stations.js`).

| Tier | The problem | Correct when |
| --- | --- | --- |
| 1 | Move Q units from A to B: what does it cost, and when does it land? Two figures, from the tables on the Logistics tab | Both within ± 5% |
| 2 | Fill a requisition of Q units at station K from three listings at three stations, each with a price and a quantity: which fills it cheapest delivered? | The true minimum of price + fee, with partial fills allowed |
| 3 | A requisition due in H hours at K; candidate lots, prices, quantities and stations; the day's bid movement so far: which lots, in what order, and what is the margin? | The true optimum within ± 5% of margin; a plan that misses the deadline is wrong |

Dispatch packets are the ones that gain most from market geography. Today every NPC order fills at any station and
prices differ by nothing but the fee, so a tier-2 packet is a fee calculation. If the Board later fills each NPC's
orders only at its home station (docs/design/npc-corporations.md, "Where an order is filled", proposed for later), the
same packet becomes a real siting problem without changing this design.

### Why no single kind is always best (T-018)

The three kinds pay in different things, and which matters most depends on the corporation's situation:

| A corporation that is... | Should work | Because |
| --- | --- | --- |
| About to lease, scout or expand | Surveys | The intel is worth more than the fee: a scouted belt saves an 8,000 probe's trip, a body's profile decides a 20,000 to 60,000 lease |
| Climbing the ladder and delivering contracts | Audits | Most standing per minute for a player who knows the rules, and standing is what opens the third slot and the hourly board |
| Broke, or saving for a purchase | Dispatches | The largest fee per packet (they take longest), and the least the player already has |
| Unsure which | Any; declining is free | The choice is the player's, and the Desk shows what each kind pays before it is opened |

The `desk-decisions` probe (section 8) holds this: across the runway probe's bot profiles (planner, greedy, reserve,
plus a "scout" that expands), at least two kinds must be the best kind for different profiles, and no kind may be best
for every profile on every one of the three payoffs (credits, standing, intel). If tuning ever collapses that to one
kind, the probe fails.

## 6. What it never touches

- **Levels.** No metric in `data/milestones.json` may begin `stat:desk`. `tests/schema/data-files.test.js`'s
  cross-catalog check gains that assertion. `resolveMetric` gains nothing.
- **Contract counts.** A desk packet does not push `completedMissions`, does not `bumpStat("missionsCompletedTotal")`
  and does not appear in the missions receipt. Levels 8, 26 to 30, 39 and 40 count contracts; the desk counts desk.
- **The Exchange.** No perk changes a price, a tax, a quota or a fill. Standing is not tradeable and has no credit
  value.
- **Other players' property or standing.** Sponsorship (Esteemed) gives a benefit; nothing at the Desk takes one.
- **The clock.** No cooldown, no energy, no attempts cap. The daily fee cap is the only pacing, and it caps credits, not
  play.

## 7. The faucet, sized (arithmetic, proposals)

Credits enter the game from the standing bids and from mission rewards (ECONOMY.md, "Faucets and sinks"), plus the
Salvage Assignment's bounded floor. The Desk is a **new, permanent faucet**, and this section is where its size is
chosen so that every later balance number can be computed against it. Every key below is proposed for
`data/economy.json` under `desk`, and joins ECONOMY.md's table when the implementation story lands.

| Key | Proposed | Why this number |
| --- | ---: | --- |
| `desk.openPackets` | 3 | Enough to choose a kind, few enough that the choice is one glance |
| `desk.payByTier` | 40 / 80 / 160 | Tier 1 pays a tonne and a half of Silicates at base bid. Twenty tier-1 packets, an hour's work, pay 800: about three and a half hours of a tier-1 yard at its best setting (224 an hour, ECONOMY.md T-018), so an hour of attention is worth more than an hour of the yard the player just built, and much less than a contract (9,600 to 14,400). Doubling by tier so that the grade a player worked for is worth working for |
| `desk.pointsByTier` | 1 / 2 / 3 | Section 4's table is drawn from these |
| `desk.contractPoints` | 10 | A contract is hours of mining; ten tier-1 packets is half an hour. Today's tiers × 10 keep every existing grade where it is |
| `desk.paidAssignmentsPerDay` | 20 | An hour of full pay a day; the rest of a session pays a quarter. Chosen so that a person who plays an evening is not out-earned by one who plays all day at the Desk instead of running a corporation |
| `desk.overCapPayPct` | 25 | Past the cap the fee is a token; standing is the reason to keep going |
| `desk.surveyNoisePctByTier` | 15 / 30 / 45 | Chosen so tier 1 is readable at a glance and tier 3 needs the four passes averaged |
| `desk.auditCleanSharePct` | 30 | Enough clean filings that "compliant" is a real answer and not a trap |
| `desk.priorityProcessingPct` | 5 | Valued's perk; **the Board may set it to 0** (it lowers two sinks) |
| `desk.reputationThresholdMultiplier` | 10 | The migration factor for `completedCount → points` and the tier thresholds |

**What the faucet can add up to.** The most a corporation can draw from the Desk in a day, in credits, is the cap at
its tier plus a token for everything past it. Per corporation per day, all answers correct:

| Playing at | 1 hour (20 packets) | 3 hours (60) | 8 hours (160) |
| --- | ---: | ---: | ---: |
| Tier 1 | 800 | 1,200 | 2,200 |
| Tier 3 | 3,200 | 4,800 | 8,800 |

Against the economy as it stands: a two-yard corporation's best day is about 3,479 (ECONOMY.md's yard table); a
contract pays 9,600 to 14,400; the Salvage Assignment 3,000 for four hours of nothing. So a tier-3 player who works the
Desk three hours a day roughly doubles a small corporation's income, and a day-1 player who works it an hour earns
what their yard makes in an afternoon. **A year of this at the ceiling is about 1.75 million credits into one
corporation** (4,800 × 365), which is real money in an economy where a Refinery is 75,000 and a Synthesis Array 200,000,
and about what one corporation's yards make in the same year. That is the flag: this is deliberately the second
faucet, sized to matter to a new corporation and to stay below production for an established one, and its numbers are
the Board's to move.

**It changes ECONOMY.md's "way back from broke".** That section proved a corporation at 0 credits with no ore has
"no move that changes anything" and built the Salvage Assignment as a four-hour floor. With the Desk, the same
corporation earns `minStartupCost` (500) in about fifteen minutes of tier-1 work. The Salvage Assignment stays as the
no-effort floor (it must, for a player who will not or cannot do the Desk); the Desk is the effort path, and the
`--broke` probe scenario gains a second assertion: a desk-working bot at 0 credits is mining again within one
simulated hour.

## 8. What the probe must show

The RUBRIC gates this design aims at are the three DEPTH.md has scored lowest. Each gets an instrument before the
feature is called done, in `ops/probes/` beside `isp-runway.ts`:

- **Mastery, measured for the first time.** `desk-mastery`: two bots work the Desk for a simulated hour, one answering
  at random, one reading the rules and the data. The rules-aware bot must earn at least **three times** the standing of
  the random one, and its lead must grow at tier 2 and again at tier 3. This is the greedy-versus-planner gap DEPTH.md
  has asked for since review #1, on a system where the skill is the game's own rules.
- **Decision density.** `desk-decisions`: for each runway-probe profile, the best kind to work by each payoff. At least
  two distinct best kinds across profiles; no kind best for every profile on every payoff (section 5).
- **Return reason.** The goal-ladder probe's sample points after minute 30 already require a named pending outcome
  (QUEST_SPINE section 6). Add: at every sample point the Desk has three open packets, and a corporation at any
  balance has an action that changes its state. The `--broke` scenario asserts the fifteen-minute recovery.
- **The faucet.** `isp-runway.ts` gains a `desk` move for its bots and prints credits from `desk` beside `missions`
  and `salvage` in its ledger summary, so the faucet is watched from its first day rather than estimated.

Bot numbers, all of them (P-PROXY). What they cannot see: whether a person finds a spectral return *interesting*, how
long a person takes on a packet, and whether the tone lands. Those need players, and the design's answer is to ship the
Desk into the playtest and watch two numbers the brief already names: **D3 return without a reminder** (BRIEF.md's
first metric; the Desk is the first thing in the build a player can return to *for*), and the share of active
minutes spent at the Desk against the corporation's own screens (if it passes half, the Desk has become the game and
the fee cap or the tier pace is wrong).

## 9. Prior art, and what is taken from each

- **EVE Online, Project Discovery.** Citizen-science classification tasks inside the game client, paid in ISK, an
  analysis-kit currency and a skill-like rank, with accuracy graded against consensus. *Taken:* a repeatable
  judgment task with an accuracy grade and a long rank ladder; the fact that a rank tier is a thing players will
  grind toward for its own sake. *Rejected, as the Board asked:* the task's independence from the game. Project
  Discovery's skill is looking at cell images; it makes nobody better at EVE. Here every skill is a rule or a table the
  player will use in the corporation, and every survey changes the player's own map.
- **EVE Online, agents and standings.** Standing with an agent's corporation unlocks higher-level agents and better
  missions. *Taken:* standing as access, and the grade shown to others. *Not taken:* new agents. The quest spine is
  explicit that ISP has one Bureau and one coordinator and invents no more; the three kinds are divisions of the ISA
  the lore already has, all reached through Voss's office.
- **Football Manager, between the matches.** The game's own audience description (BRIEF.md: "Football Manager without
  watching the matches"). The between-match play is reading scout reports and making squad decisions from them.
  *Taken:* a report with real information about the world as the unit of play, and the judgment as the verb. A survey
  packet is a scout report on a belt.
- **Papers, Please.** Document inspection where the skill is knowing an ever-growing rulebook. *Taken:* the rulebook
  as the skill, the near-miss as the difficulty. *Rejected:* the time pressure and the penalties. Nothing at the Desk
  is timed and a wrong answer costs nothing but the packet.

## 10. What this design does not settle

- **The numbers in section 7** are proposals. The Board sets the faucet; ECONOMY.md's model gains the Desk once the
  data exists and recomputes the yard tables beside it.
- **Whether an audit that catches dumping should also earn ITC standing** (`server/game/standing.js`). It fits the
  fiction and would give the ITC track a second source; it also links two systems that are cleanly separate today.
  Left to a follow-up.
- **Market geography.** Dispatch tier 2 and 3 packets become real siting problems only when prices differ by station
  (docs/design/npc-corporations.md, "Where an order is filled"), which is a Board decision on the economy, not this
  design's.
- **Phase 2**, not filed, each its own design: **Analysts**, employees assigned to the Desk who work packets at a
  fixed lower accuracy while the player is away (an idle trickle that rewards having built a corporation, never more
  than the player earns themselves); the **Commendation board**, a public list of grades and this week's best surveys;
  **Sponsorship** as described at Esteemed; a quest-spine beat in Act 1 ("while your first cycle runs, take a survey")
  so the walkthrough hands to the Desk as well as to the contract.
- **AB#2479** (the Starmap overlay that does nothing) is investigated separately; tier-1 surveys are the first thing
  that would give it real data, and that story should read this section.

## 11. Decisions for the Board (veto any)

1. **The shape**: an effort-paced Desk beside the time-paced ladder, with Bureau Standing as the XP track on its own
   axis, never a level.
2. **The faucet**: `payByTier` 40/80/160, `paidAssignmentsPerDay` 20, `overCapPayPct` 25, or other figures.
3. **Standing never counts toward a level, and desk packets are never contracts** (rule 7). Recommended, strongly: it
   is the whole reason the year to Level 40 survives an effort loop.
4. **The grade is shown publicly** on the corporation's card. Recommended: honest social proof, and the only thing at
   the Desk another player can see.
5. **A correct survey counts as scouting** for the belt's current generation, without a probe. Recommended: it is the
   compounding hook, and it makes the Level 7 gate a graduation instead of a wall.
6. **Priority processing at Valued**: 5% off lease purchases and office rent, or 0.
7. **The names**: "Desk Work" for the section, "Bureau Standing" for the track. ("Docket" was considered and is taken:
   the Arbitration Council's cases already use it.)

## 12. Implementation, once the Board accepts

Each is session-sized and a child of AB#4689; none is agent-ready until section 11 is answered. Sizes are Effort as
process/TRACKING.md now requires.

1. **The generators and graders** (`server/game/desk.js`, `data/desk.json`, the `desk` block in `data/economy.json`):
   three kinds, three tiers, seeded, pure; `tests/unit/desk.test.js` draws a thousand of each and grades them.
2. **Bureau Standing as points**: `agentReputation[agent].points`, the migration from `completedCount`, thresholds × 10,
   `standingFor` unchanged in shape; contracts add `contractPoints`; Bureaucratic Persuasion applies; tests.
3. **The Desk routes and state**: `GET .../desk` (three open packets, grade, today's paid count), `POST .../desk/answer`,
   `POST .../desk/decline`; grading, pay through `applyCredits` under a new ledger category `desk`, the daily cap,
   `stat:deskCompleted[:kind]`; rate limits; receipts.
4. **Survey payoffs**: a correct survey marks a belt scouted for its generation / publishes a body's profile to the
   corporation's Starmap overlay; the overlay reads it (with AB#2479).
5. **Grade perks**: tier gates; the third and fourth contract slots; the hourly board; priority processing; the grade
   on the public card.
6. **The Desk on the Assignments tab**: the packet document, the answer controls (a pick, a ranking, a number), the
   graded receipt with the rule, the standing progress; screenshots at 1280x800 and 375x812 (DOCTRINE P-001).
7. **The probes**: `desk-mastery`, `desk-decisions`, the `desk` move in `isp-runway.ts`, the `--broke` assertion.
8. **ECONOMY.md**: the `desk` keys join the table with their reasons; the model output gains the faucet; "the way
   back from broke" gains the fifteen-minute path.
9. **The cross-catalog guard**: no milestone metric may name a desk stat.
