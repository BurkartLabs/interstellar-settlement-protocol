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
| `logistics.sameSystemTransitMinutes` | 30 | How long a shipment within one system takes. Set in AB#718 as a starting point; not yet used, because transfers still arrive at once until timed transit is built. |
| `logistics.perJumpTransitMinutes` | 120 | Added transit time per jump, twice a corporate ship's hour a jump, as freight is slower. A starting point from AB#718; not yet used, as above. |
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
  100 |  1,600 |     560 |     2,208 |            527 |               415 | 166.1 h (day 7)     | 210.9 h (day 9)
  250 |  4,000 |   1,400 |     5,520 |          1,428 |             1,147 | 61.9 h (day 3)      | 77.1 h (day 4)
Credits start to accumulate: at 100 t/h and 250 t/h from the first hour of mining (day 1), counted as sold; at 10 t/h, never: every hour loses.

Margin per unit above the minimum cost: 24 x 0.92 - 16 = 6.08 credits.
It is positive and the only other cost is a floor, so profit rises with every unit of throughput: the maximum always wins.
A model, not play: perfect play, no travel, selling every unit at the standing bid, no research.
```
<!-- economy-model:end -->

What it says, in words:

- The cheapest way to a first extractor costs **87,000 of the 250,000**: an office, five hires, the Earth lease and a
  yard. That leaves 163,000, so money is not what limits the first session.
- At **250 t/h** the extractor earns about 1,150 an hour, allowing for downtime, and **pays back on day 4**. At
  100 t/h it takes until day 9. **At 10 t/h it never pays back**: every hour loses, because the 600 floor costs more
  than 10 tonnes fetch.
- Credits grow from the first hour of mining at any setting that pays at all. The number to tune is not *whether*
  the first session profits but *how fast*: four days at the top setting.

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

## Rules the model takes from the code

These are not in `data/economy.json`, so the model states them, with where each comes from. The test reads those
files and fails when one changes.

- Starting credits 250,000, at Earth Station Prime (`server/gameState.js`).
- A lease needs an office and 5 employees per lease (`server/index.js`, `EMPLOYEES_PER_LEASE`).
- Throughput is clamped to 10..250 t/h, and a cycle runs at most 72 hours (`server/index.js`, start-mining).
- Downtime starts with probability 0.005% a second, lasts at least 15 minutes, then ends with probability 0.0276% a
  second (`server/gameState.js`). That makes expected uptime about 82%, and costs pause while an extractor is down.
- Leases come from `data/systems.json`: Earth 20,000, Mars 25,000, Luna 30,000. Mined Silicates land at the station
  orbiting the leased body, and an NPC sale draws from the station you are docked at. The Earth path needs no travel.
