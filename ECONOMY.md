# ECONOMY: the first session, computed

Every number the economy runs on is in `data/economy.json` (AB#726). This file gives each one a reason and then
computes what they add up to for a new corporation. The computation is `npm run economy:model`
(`scripts/economy-model.mjs`). **It is a model, not play:** it assumes perfect play, no travel, no research, and that
every unit mined is sold at the standing bid. `tests/unit/economyModel.test.js` fails when this file lists a key the
data file lacks, misses one it has, or quotes output the script no longer prints.

Where a number has no recorded reason, this file says so instead of inventing one. Those are the first numbers to
question in the retune (AB#728).

## Every key in data/economy.json

| Key | Value | Why it is this number |
| --- | --- | --- |
| `employees.hireCost` | 2,000 | About thirteen days of one employee's payroll, paid once. It makes the five hires a lease needs (10,000) a real step in the first session without dominating it. No reason is recorded for the exact figure. |
| `employees.payrollPerDay` | 150 | The cost of staff over time: five employees are 750 a day, about half an hour of a 250 t/h extractor's profit. It is charged only once AB#1097 lands; until then it is a projection. |
| `office.rentPerDay` | 1,000 | The standing cost of being in business. A lease cannot be filed without an office, so every first session pays at least one term. |
| `office.termDays` | 7, 14, 21, 28 | The terms offered. The shortest, 7 days (7,000), is the cheapest way in, and the model uses it. |
| `buildings.extractorYardCost` | 50,000 | The largest purchase before mining: over half of the 87,000 the cheapest path spends. It is what makes payback a multi-day question. |
| `buildings.extractorYardAssetValue` | 36,000 | Book value on the balance sheet: 72% of cost, so building one lowers net worth by 14,000 on the day. No reason is recorded for 72%. |
| `buildings.assemblyFacilityCost` | 60,000 | Priced above the extractor yard because it comes later. It earns nothing in the first session. |
| `buildings.assemblyFacilityAssetValue` | 40,000 | 67% of cost on the balance sheet. No reason is recorded. |
| `buildings.refineryCost` | 75,000 | The dearest building. Its outputs have no NPC buyer (DEPTH.md), so it is a bet on the player market. |
| `buildings.refineryAssetValue` | 55,000 | 73% of cost on the balance sheet. No reason is recorded. |
| `buildings.supplyForecastCostMultiplier` | 0.94 | Supply Forecast research takes 6% off a yard or refinery: 3,000 on an extractor yard. It is small next to the research's other effect, +6% output. |
| `operations.costPerThroughputUnit` | 16 | What a tonne costs to mine. Against a net sale price of 22.08, it leaves a 6.08 margin, which is the T-018 problem below. |
| `operations.minCostPerHour` | 600 | The floor on an extractor's hourly cost: 37.5 t/h's worth. Below that, the player pays for throughput they do not get, so low settings lose money. |
| `operations.startupShareOfHourlyCost` | 0.35 | A cycle's startup is about a third of an hour's cost. Over a 72-hour cycle that is noise; over a 1-hour cycle it is a 35% surcharge. |
| `operations.minStartupCost` | 500 | The floor on startup, so the smallest cycle still costs something to begin. |
| `operations.throughputReferencePerHour` | 420 | The rate at which an extractor's running cost is double its straight-line cost: `16 x T x (1 + (T / 420)^2)`. It sets where the profit curve peaks, and so what the throughput decision is worth (ISP-86). |
| `probes.buildCost` | 8,000 | A mining probe, the cheap way to scout. Not on the first-extractor path. |
| `probes.assetValue` | 5,000 | 63% of cost on the balance sheet. No reason is recorded. |
| `expeditions.launchCost` | 3,000 | The price of a look at a belt's composition. Not on the first-extractor path. |
| `exchange.salesTaxPct` | 8 | The exchange's cut of every sale. At 24 a tonne it is 1.92, almost a third of the 6.08 margin. Each point off it is 0.24 a tonne, about 60 an hour at 250 t/h; +10% output from research is worth about 550. |
| `npcBid.quotaPerDay` | 7000 | How much a standing buy order takes in a day before it stops buying. A yard running at its best rate produces about 3,500 units a day, so this is two yards' output: a corporation that runs three fills it and sees the price move. It was 40,000 until the probe showed the drift almost never bit at that size (ISP-87). |
| `npcBid.driftAtFullQuotaPct` | 50 | How far the bid falls when the day's quota has been sold into it: half. Selling into the bid moves the price against the seller, which is what makes another player worth trading with. |
| `npcBid.recoveryPerDayPct` | 60 | How much of the gap back to the base price the bid recovers overnight. A market glutted yesterday opens dearer than it closed and cheaper than if nobody had sold. |
| `npcBid.floorPct` | 55 | The lowest the bid ever goes, as a share of its base price. A corporation dumping volume cannot strand a new player: this is the price always guaranteed. |
| `logistics.sameSystemFeePerUnit` | 2 | Moving stock between two stations in one system, per unit: the old flat fee, kept so nothing moved within Sol costs more (AB#718). 9% of the net Silicates price. The cheapest path avoids it by selling where it mines. |
| `logistics.perJumpFeePerUnit` | 3 | Added per unit for each jump between systems (AB#693, the Board: "distance based time and fees"). A starting point set in AB#718, not derived: no reason beyond that is recorded. |
| `logistics.sameSystemTransitMinutes` | 30 | How long a shipment within one system takes. Set in AB#718 as a starting point; live since AB#985 (ISP-278) — a dispatch creates a shipment that arrives on the tick at or after `dispatchedAt + transitTime(...)`, not on the spot. |
| `logistics.perJumpTransitMinutes` | 120 | Added transit time per jump, twice a corporate ship's hour a jump, as freight is slower. A starting point from AB#718; live since AB#985, as above. |
| `salvage.creditsThreshold` | 3,000 | Below this, and with no cycle running, the Salvage Assignment is offered (ISP-297): "the way back from broke," below. Set equal to `expeditions.launchCost`'s round number, not derived. |
| `salvage.hoursRequired` | 4 | How long the Assignment takes: paid in time served, not delivered quota, so nothing the player sets — throughput, research, a lever of any kind — changes how fast it pays (T-018). |
| `salvage.payoutCredits` | 3,000 | The flat payout: exactly the threshold above, so completing one contract is enough to be offered a real one again, not two. |
| `salvage.cooldownHours` | 8 | How long after completion before another is offered, so it is a stopgap and not a standing income. |
| `npcBuyers.unitPrice` | Silicates 24, Helium-3 92, Nickel 18, Titanium 64, Carbon 12, Rare Earths 140 | The standing bids. They are the only steady faucet of new credits in the game (see below). Silicates at 24 is the one a first session sells into. No derivation is recorded for any of them. |
| `npcBuyers.dailyQty` | Silicates 1,000,000, Helium-3 250,000, Nickel 750,000, Titanium 400,000, Carbon 1,500,000, Rare Earths 120,000 | How much each buyer takes a day. One extractor at 250 t/h makes 6,000 a day, 0.6% of the Silicates bid, so in practice the bid has no bottom (DEPTH.md, review #1, epic 3). |

`npcBuyers.item` and `npcBuyers.buyer` are the only words in the file: which good and who buys it.

## The first session, computed

The model's output, as `npm run economy:model` prints it today:

<!-- economy-model:start -->
```text
Start: 250,000 credits at earth-station-prime.

Purchase order (the cheapest path to a first extractor):
  1. Rent an office, 7 days       -  7,000  ->  243,000   (a lease needs an office)
  2. Hire 5 employees             - 10,000  ->  233,000   (a lease needs 5 on payroll)
  3. Lease Earth                  - 20,000  ->  213,000   (the cheapest body with lease terms)
  4. Build an extractor yard      - 50,000  ->  163,000   (no research discount yet)
  Spent before mining: 87,000. Credits left: 163,000.

Running costs while mining: payroll and office 72.92/h; each cycle's startup spread over 72 h.
(Payroll is charged once AB#1097 lands; until then the game charges less than this.)
Silicates sell to GEX Commodities Authority at 24, less 8% tax: 22.08 a unit.
Expected uptime: 81.6% (a stoppage every 5.6 h on average, lasting 1.26 h).

Pays back = the purchases and the first startup earned back: credits are at the starting figure again.
  t/h | cost/h | startup | revenue/h | profit/h ideal | profit/h expected | pays back (ideal)   | pays back (expected)
   10 |    600 |     500 |       221 |           -459 |              -389 | never               | never
  100 |  1,691 |     592 |     2,208 |            436 |               341 | 201.0 h (day 9)     | 257.2 h (day 11)
  250 |  5,417 |   1,896 |     5,520 |              4 |               -15 | 23705.6 h (day 988) | never
Credits start to accumulate: at 100 t/h from the first hour of mining (day 1), counted as sold; at 10 t/h and 250 t/h, never: every hour loses.

Running cost curves with throughput (operationCostPerHourFor, server/economy.js): the best setting here, no research, is 146 t/h at 606 an hour.
Every throughput from the floor to the cap stays startable; the curve is what makes the setting a decision, not a wall.
A model, not play: perfect play, no travel, selling every unit at the standing bid, no research.
```
<!-- economy-model:end -->

What it says, in words:

- The cheapest way to a first extractor costs **87,000 of the 250,000**: an office, five hires, the Earth lease and a
  yard. That leaves 163,000, so money is not what limits the first session.
- **250 t/h is no longer the right answer**: the curved cost (T-018 below) makes it earn about 4 credits an hour
  under perfect play and **lose money once real downtime is counted** — it never pays back. **100 t/h pays back
  around day 9** (day 11 with downtime). **10 t/h never pays back**, because the 600 floor costs more than 10
  tonnes fetch. The best setting at this price, with no research, is **146 t/h at 606 an hour** — below either
  number this table samples, which is the point: the decision is a real one, not a slide to the cap.
- Credits grow from the first hour of mining only at a setting that actually pays — no longer every setting up to
  the cap. The number to tune is *which throughput to run*, not just how fast a fixed answer pays back.

## T-018: the throughput is a decision (ISP-86)

Revenue per hour is **24 x T x 0.92** (price, throughput, what the tax leaves). Cost per hour used to be
**16 x T** above the 600 floor, so profit was **6.08 x T** less fixed costs and rose with every tonne: 250 t/h was the
right answer at every scale and every balance, and the slider was arithmetic. DEPTH.md scored decision density 2
for this reason.

The cost now rises faster than the rate (`operationCostPerHourFor`, server/economy.js):

**cost per hour = 16 x T x (1 + (T / 420)^2)**, never below the 600 floor.

Profit per hour for Earth silicates at 24 credits and 8% tax, with no research:

| T (t/h) | revenue/h | cost/h | profit/h |
| --- | --- | --- | --- |
| 10 | 221 | 600 | -379 |
| 50 | 1,104 | 811 | 293 |
| 100 | 2,208 | 1,691 | 517 |
| 150 | 3,312 | 2,706 | 606 |
| 173 | 3,820 | 3,238 | 582 |
| 200 | 4,416 | 3,926 | 490 |
| 250 | 5,520 | 5,417 | 103 |

The maximum is at **T = 146 t/h**, paying **606 credits an hour**. Two things move it, which is what makes it a
decision rather than a constant:

- **Research.** With Basic Extraction Analytics and Supply Forecast (x1.1 and x1.06 on what an hour yields) the
  best setting rises to **189 t/h** at **1,230 an hour**. Earning more per tonne is worth running hotter.
- **Price.** A dearer buyer or a lower sales tax moves it up; a cheaper one moves it down.

Below about 37 t/h the 600 floor means the corporation pays for throughput it does not get, so a very low setting
loses money. At the top of the range the curve costs 5,417 an hour and pays 103: **17% of what the best setting
pays**. Ignoring the curve is a real cost and never a wall - every throughput from 10 to 250 stays startable, which
is the rule the tests hold (`tests/unit/throughputCurve.test.js`).

## The standing bid is a floor, not a ceiling (ISP-87)

The silicate bid used to be 24 credits with a million units a day behind it. No corporation reaches a million
units, so the bid absorbed everything anyone could mine: the rational play was never to trade with another player,
and the BRIEF's second measure - orders filled by a player rather than an NPC - could not move.

The bid now drifts with the day's volume (`npcBidFor`, server/economy.js), and is computed on the server from what
the order has already taken; nothing in a request can set it:

**bid = max(floor, base x (1 - 0.50 x sold today / 7,000))**, floor = 55% of base.

For silicates at 24 credits:

| sold into it today | bid |
| --- | --- |
| 0 | 24 |
| 1,750 | 21 |
| 3,500 | 18 |
| 5,250 | 15 |
| 7,000 | 13 |
| beyond the quota | 13 (the floor) |

Overnight it recovers 60% of the gap back to base: a bid driven to the floor opens the next day at 17, then 20,
then 22. A corporation that dumps volume therefore pays for it twice - in the price it gets and in the price it
gets tomorrow - and a corporation that did not sell finds the market where it left it.

What this is for: at 40,000 units a day and a bid that falls as you sell, a second corporation's listing becomes
worth buying, and a seller with more than a day's quota has a reason to list rather than dump. The suggested price
on Create Listing no longer floors itself at the NPC bid, so a glutted market can be listed below it.

## Faucets and sinks

Credits enter the game from two places: the NPC bids (every sale to them creates money) and mission rewards. Every
other movement is a sink: rent, hires, payroll, buildings, startup and running costs, the sales tax and transfer fees.
The bid is a fixed price with a daily quantity no single corporation approaches, so the faucet grows with every
extractor while the sinks stay flat. Published writing on MMO economies names this as the classic route to inflation
in a player market, and argues for keeping the NPC bid as a floor while tying drains to the money supply:
[Raph Koster, MMO economies](https://www.raphkoster.com/2006/09/07/agc-mmo-economies/), and
[Game Developer, *Virtual Economic Theory: How MMOs Really Work*](https://www.gamedeveloper.com/business/virtual-economic-theory-how-mmos-really-work)
(both already cited in DEPTH.md and MONETIZATION.md). The ledger from AB#712 books every sink and faucet by category,
so the retune can measure it instead of asserting it.

## The way back from broke (ISP-289, replaces the next attempt at ISP-42/AB#728)

**Evidence a retune cannot fix (bot numbers, P-PROXY).** On `agent/728-economy-retune`, seed 7000, the planner and
greedy bots' 7-day and 30-day probe runs are byte-for-byte identical past bot-day 2-3 except the `wait` count
(216/235 at day 7, 1,136/1,155 at day 30). Both end at 0 credits, payback never reached. 17,226 units were listed
across both bots and only 13,407 cleared — most of what was mined is still on the book when they go idle, so the
deadlock is not a demand problem. Raising `npcBid.floorPct` from 55 to 75 changed nothing, byte for byte: the
clearing price never approached either floor, so that lever is not the binding constraint. **The actual mechanism**
(read from `server/routes/mining.js`'s `start-mining` and `payroll.js`): starting a cycle needs `startupCost` credits up
front (at least `operations.minStartupCost`, 500) and a corporation at 0 credits cannot pay it — `start-mining`
refuses with "Starting this mining cycle requires N credits. Current reserves: 0 credits." Payroll fails
gracefully (a balance stops at 0, never below; arrears accrue, nobody is let go — `payroll.js`), so a broke
corporation is not punished further. It is simply frozen: no credits to start a cycle, no ore to sell to get
credits, and no other move that changes anything. That is the dead end this design closes — a dead game, not a
hard one (P-PIT).

**What the current probe cannot see.** Two bots are the whole market (P-PROXY): player-to-player demand is thin
by construction, and neither bot ever needs another player's ore. But the deadlock above is not a demand-side
problem to begin with — `npcBuyers.dailyQty` (1,000,000 for Silicates) is already far past anything one
corporation mines, so the standing bid has no practical bottom (this file, "faucets and sinks"). A corporation at
0 credits and 0 ore has nothing to sell into any bid, however deep. **Deeper NPC demand would not fix this**,
because the constraint is upfront credits to start a cycle, not the price or quantity a finished cycle sells for.
If a future retune ever narrows the gap between "broke" and "back mining" enough that demand becomes the binding
constraint instead, that would be the cheaper fix at that point — it is not the fix today, and the falsifiable
claim below is written so a future session can tell the difference.

**Recommended affordance: an ISA Salvage Assignment — a Bureau contract paid in time, not delivered resources.**
Elara Voss's office (the same agent every `MISSION_TEMPLATES` contract comes from) offers a Salvage Assignment
whenever a corporation's credits fall below **3,000** and it has no active mining cycle and no salvage assignment
already running. Accepting costs nothing (mission accept already does, today — `accept-mission` has no credit
check). Completing it needs **4 real hours served**, not a resource quota, and pays a **flat 3,000 credits**,
booked as a new faucet category (`salvage`, alongside `missions` in the ledger). The 4-hour wait and the flat
payout are the same for every corporation: nothing the player sets changes what it pays or how fast, which is
what keeps it a floor and not a decision (T-018 — a lever a player can turn to maximize is exactly what this must
not be). A second corporation-side cooldown, 8 hours after completion, stops an assignment being retaken the
instant credits dip again from an unrelated cause.

**The numbers, and why 3,000.** The cheapest real restart is `minStartupCost` (500) to begin a cycle at the
lowest sane throughput, plus a few hours of `operations.minCostPerHour` (600) while the first batch of ore
accrues and before it is sold (this file, T-018 table: 50 t/h already profits at 293/h once running). If the
corporation's office has also lapsed — the harder case, not the common one, since both bots still held theirs
throughout the probe runs above — the cheapest term is 7 days at `office.rentPerDay` (1,000/day) = 7,000 up
front... except a corporation this broke does not need a fresh 7-day term to take one more cycle; it needs one
cycle's worth of credits, and 3,000 clears the startup-plus-running-buffer case with room to renew a lapsed
office at the 7-day minimum only if paired with a second assignment, which the 8-hour cooldown does not block —
two assignments 8 hours apart cover 6,000, comfortably past 7,000 minus what a single mining hour already
recovers. One flat payment intentionally does not promise to solve every compounding failure in one shot; it
promises the corporation is never in a state where nothing it can do changes anything.

**Why it beats the other candidates.**
- **Selling or mothballing a building back** needs a new valuation and refund system that does not exist anywhere
  in the code today, and a corporation that mothballs its only extractor yard has ended its own mining path for
  good — a harsher, one-shot answer, not a repeatable floor, for a larger implementation than a new mission type.
- **An ISA credit line** is explicitly the smallest version of the v0.9 loan system (ISP-144–156) arriving early;
  it needs interest, a repayment schedule and a default case even in miniature, which is more new financial state
  than a v0.5 story should carry, and it does not answer what happens to a corporation that cannot repay it either.
- **Deeper NPC demand** is ruled out above: the deadlock is not a demand-side problem.
- **A starting position that cannot reach zero this fast** treats the symptom, not the mechanism — a longer or
  unluckier session reaches the same wall regardless of the cushion, and the evidence above already shows
  retuning the numbers around the wall (the `floorPct` attempt) does not move it.
- A wage-for-time contract is the cheapest build (one new mission shape, no new financial primitive), is
  self-limiting by construction (the credit threshold makes it vanish the moment it is not needed, so it can
  never run alongside real mining as a second income), and fits the game's own framing: the Bureau already pays
  for a corporation's time and capacity, just previously only for delivered goods.

**Falsifiable before anything is built.** The claim: *no corporation is ever in a state where every available
action changes nothing.* Once the Salvage Assignment exists, `ops/probes/isp-runway.ts` (or a variant of it) run
with a bot forced to 0 credits and 0 ore — the planner and greedy bots' own day-2/3 collapse above is the natural
seed to reuse — must show the bot accepting and completing a Salvage Assignment and its credits rising above 0
within 4 simulated hours of hitting the floor, at seed 7000 and seed 7001 (a second seed, so the claim is not an
artifact of one run), over both a 7-day and a 30-day horizon. If any run instead shows the bot still refused on
every available action after reaching 0 credits, the claim is false and the design has not closed the wall it
claims to.

**Implementation stories, each session-sized.**
1. **Server: the Salvage Assignment contract type.** A new pool (or a `kind: "time-served"` field on
   `MISSION_TEMPLATES` entries) with no `quota`, an `hoursRequired` instead; `refreshContractOfferings` offers it
   only under the credits/no-active-cycle gate above; `accept-mission` records `acceptedAt`; `complete-mission` (or
   a parallel route) accepts it once `hoursRequired` has elapsed and books the payout under a new `salvage` ledger
   category, through `applyCredits` like every other faucet (AB#712).
2. **Client: the Assignments tab shows it distinctly from a delivery contract** (a countdown, not a resource
   quota), and Overview surfaces it when a corporation is broke and idle — a player at 0 credits needs to be told
   this exists, not left to find Assignments unprompted.
3. **Probe: the falsifiable assertion above**, as a runnable mode of `ops/probes/isp-runway.ts` (a `--broke`
   scenario that forces the starting state instead of playing to it) so the claim is checked on every future
   change to the economy, not proven once and forgotten.
4. **ECONOMY.md and DESIGN_DOCUMENT.md** get this section's numbers folded into their own model output once the
   code exists, the way `<!-- economy-model:start -->` already does for the purchase order above.

**What ISP-42 (AB#728) retunes once this exists, and what it does not.** The retune's own mandate — the first
session's pacing, the throughput curve's shape, the standing bid's drift — is unaffected by this design and can
proceed on its original numbers; the evidence above shows the *wall* was never a pacing problem, so pacing work
does not need to solve it. What ISP-42 gains is a floor to retune *against*: once a corporation can never truly
deadlock, a retune that turns out to run corporations closer to 0 more often is a legitimate, measurable
trade-off instead of an unrecoverable trap, and the Salvage Assignment's own 3,000/4-hour numbers are themselves
fair game for that retune to adjust, once real play data exists to adjust them against.

**Flagged for the Board:** this design adds a new, permanent credits faucet (the Salvage Assignment) — something
every later balance number in this file, and every future retune, will be computed against. It is deliberately
worse than any real mining setting (T-018) and self-limiting (the credit threshold), but it is still new money
entering the game from nowhere, which is exactly the kind of change BRIEF.md's "what we will measure first"
section and DOCTRINE's security-first framing both ask to be surfaced rather than assumed.

## ISP-42's re-run against the floor above (AB#728), 2026-09-25

Bot numbers, seed 7000 (P-PROXY). **Before** (MONETIZATION.md review #2, pre-Salvage-Assignment): planner and
greedy both plateau at level 2, 0 credits, banked/spent 0.00x/0.00x/0.00x at day 3/7/30 — the dead-end this
file's "way back from broke" section closes. **After**, with AB#1789/1791/1792 (the Salvage Assignment),
AB#1774 (the reserve bot) and AB#1812 (giving planner/greedy a real mission-taking decision) all on `main`:

| | level | credits at day 30 | banked/spent, day 3 / 7 / 30 | moves include |
| --- | --- | --- | --- | --- |
| planner | 3 | 141 | 0.00x / 0.01x / 0.00x | 22 salvage-accept, 22 salvage-complete |
| greedy | 3 | 1,700 | 0.00x / 0.00x / 0.01x | 56 salvage-accept, 56 salvage-complete |
| reserve | 2 | 25,858 | 0.16x / 0.22x / 0.12x | never dips low enough to need one |

The deadlock is gone (both bots now spend real turns on salvage-accept/salvage-complete, and neither is
permanently refused every action), and the acceptance line's sink target — banked ÷ spent stays below 3x at
day 3 and day 7 — is met by all three profiles. It is met the way MONETIZATION.md's own review #1 already
warned against (thin margins near 0.00x-0.01x rather than a healthy reserve), which is a sink-depth finding for
a different epic (MONETIZATION.md epic 2), not something this item's mandate reaches.

**The 24-hour payback target is not met, by any bot, at any horizon tried (3 or 30 bot-days) — and no
`data/economy.json` value moves it.** `bestThroughputFor` already sets planner near the profit-maximising
point (94-146 t/h across these runs); the model above already shows the best real setting paying back around
day 9-11 under *ideal* play, because `buildings.extractorYardCost`'s own recorded rationale is "it is what
makes payback a multi-day question" — the target and the design intent are opposed on paper before any bot
is even run. Checked rather than assumed: cutting `extractorYardCost` from 50,000 to 3,000 (94%, well under
the building's own 36,000 asset value, an indefensible value in its own right) in a scratch run still shows
"paid for itself in no part of 3 bot days." Closing a ~9-11 day gap to 24 hours needs roughly a 10x
improvement in margin-per-sunk-credit that no single lever, or defensible combination of them, supplies
without gutting the T-018 curve's own point (that profit does not scale linearly with throughput) or the
office/hire/lease/yard costs the design intentionally sized to make the first session a real decision.

**Outcome: no value in `data/economy.json` changed.** Per this item's own acceptance line, "nothing needed
changing" is recorded as the result for the value-retune mandate — the Salvage Assignment alone moved the sink
target — and the payback target is filed as **Bug AB#1871** (root cause: Specification Error; the acceptance
number was written without checking it against this file's own model output or the yard cost's documented
rationale), for the Director to either rewrite the target or confirm it should be dropped.

## Rules the model takes from the code

These are not in `data/economy.json`, so the model states them, with where each comes from. The test reads those
files and fails when one changes.

- Starting credits 250,000, at Earth Station Prime (`server/gameState.js`).
- A lease needs an office and 5 employees per lease (`public/scripts/leaseStaffing.js`, `EMPLOYEES_PER_LEASE`, which the lease route imports).
- Throughput is clamped to 10..250 t/h, and a cycle runs at most 72 hours (`server/routes/mining.js`, start-mining).
- Downtime starts with probability 0.005% a second, lasts at least 15 minutes, then ends with probability 0.0276% a
  second (`server/gameState.js`). That makes expected uptime about 82%, and costs pause while an extractor is down.
- Leases come from `data/systems.json`: Earth 20,000, Mars 25,000, Luna 30,000. Mined Silicates land at the station
  orbiting the leased body, and an NPC sale draws from the station you are docked at. The Earth path needs no travel.
