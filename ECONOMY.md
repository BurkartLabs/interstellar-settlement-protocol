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
| `buildings.ferricMiningComplexCost` | 90,000 | The Ferric Mining Complex (ISP-96, AB#786), priced in docs/design/buildings.md (v0.6-01) above the Refinery it feeds. It pays back only through expeditions' Nickel and Titanium, so it is a late purchase by design. Chosen, not derived. |
| `buildings.ferricMiningComplexAssetValue` | 65,000 | 72% of cost on the balance sheet, in line with the other buildings. From the design, no further reason. |
| `buildings.ferricMiningComplexMetalMultiplier` | 1.25 | A returning expedition's Nickel and Titanium are multiplied by this when the corporation has the complex, rounded down to whole units: 40 Nickel arrives as 50. From the design (v0.6-01); not yet set against the refinery chains' margins. |
| `buildings.refineryComplexCost` | 100,000 | The Refinery Complex (ISP-97, AB#787), an upgrade of one Refinery in place, priced in docs/design/buildings.md (v0.6-01) above the Refinery itself. It takes no slot, so it is the way to more refined output once slots run out. Chosen, not derived. |
| `buildings.refineryComplexAssetValue` | 70,000 | 70% of cost on the balance sheet, near the other buildings. From the design, no further reason. |
| `buildings.refineryComplexOutputMultiplier` | 1.5 | An upgraded refinery's run delivers this many times each output, rounded down to whole units: a 60-unit output arrives as 90, a 15-unit one as 22. From the design (v0.6-01); refined outputs have no NPC buyer, so what it is worth rests on the player market. |
| `buildings.cryoVaporExtractorArrayCost` | 80,000 | The Cryo-vapor Extractor Array (ISP-98, AB#788), priced in docs/design/buildings.md (v0.6-01). It takes a Luna lease slot a yard would have had, so it pays only on a lease whose other yard runs most of the time. Chosen, not derived. |
| `buildings.cryoVaporExtractorArrayAssetValue` | 58,000 | 72.5% of cost on the balance sheet, in line with the other buildings. From the design, no further reason. |
| `buildings.cryoVaporExtractorArrayMiningMultiplier` | 1.2 | Extractors on the array's Luna lease mine this many times (it multiplies the research efficiency, not the running cost). The design's fallback effect, taken because Helium-3 extraction is v0.8's (DEVELOPMENT_PHASES.md, AB#830); a Board or PM veto swaps it for Helium-3. |
| `buildings.supplyForecastCostMultiplier` | 0.94 | Supply Forecast research takes 6% off a yard or refinery: 3,000 on an extractor yard. It is small next to the research's other effect, +6% output. |
| `buildings.extractorYardUpkeepPctPerDay` | 2 | Every extractor yard past the starting kit (`extractorYardsInStartingKit`, the first two) adds 2% of the yard's price per running day to its hourly running cost: 50,000 x 2% / 24 = 41.67 an hour, after the 600 floor, and not in the startup (ISP-301, AB#2284; ISP-308, AB#2304; sink 1 of "Sinks that scale with income" below). Its share of each running charge is booked as its own ledger category, `yard-upkeep` (ISP-307, AB#2299). A corporation with the starting kit, one lease and its two yards, never pays it; one short of credit mines less and owes nothing. Chosen, not derived: the Board has not seen it. |
| `buildings.extractorYardPriceGrowth` | 1.25 | Each extractor yard past the starting kit costs a quarter more than the last: the n-th is `extractorYardCost x 1.25^max(0, n - extractorYardsInStartingKit)` rounded to the nearest 1,000, so 50,000, 50,000, 63,000, 78,000, 98,000, 122,000 and 153,000 for yards 1 to 7, with the Supply Forecast discount after (ISP-303, AB#2286; ISP-309, AB#2305; sink 3 of "Sinks that scale with income" below). The first yard's price is booked as `construction` and the rest as its own ledger category, `yard-price-growth` (ISP-307, AB#2299). A yard already built keeps its book value (`extractorYardAssetValue`); only the next purchase costs more. The rule is `public/scripts/yardPrice.js`, shared by the build and the page. Chosen, not derived: the Board has not seen it. |
| `buildings.extractorYardsInStartingKit` | 2 | The starting kit, one lease and two yards: the yards a corporation buys up to this count pay no price growth (ISP-309, AB#2305), and its yards up to this count, in build order, pay no upkeep (ISP-308, AB#2304). **A balance call on the opening, from the Director's ruling on AB#2287 (2026-09-26), made on model numbers the Board has not seen: not final until the Board has looked.** One key so the yard-upkeep rework (ISP-308, AB#2304), which moves to the same boundary, can read it too. |
| `buildings.assemblyFacilityUpgrades.toTier` | 2 | The Assembly Facility's one upgrade (ISP-102, AB#794; docs/design/upgrades.md). Chosen, not derived: the Board has not seen it. |
| `buildings.assemblyFacilityUpgrades.upgradeCost` | 30,000 | Half the facility's own price: worth it only to a corporation whose expeditions wait on probes. |
| `buildings.assemblyFacilityUpgrades.assetValue` | 21,000 | 70% of the upgrade's cost, as every upgrade books. |
| `buildings.assemblyFacilityUpgrades.offlineHours` | 2 | No probe can be fabricated while it upgrades. |
| `buildings.assemblyFacilityUpgrades.fabricationTimePct` | 50 | A probe takes half as long: 15 minutes instead of 30 (`PROBE_FABRICATION_MS`). The probe's price does not change. |
| `buildings.refineryUpgrades.toTier` | 3 | The Refinery's tier 3 (ISP-102, AB#794). Its tier 2 is the Refinery Complex (AB#787), priced by `buildings.refineryComplexCost`, `...AssetValue` and `...OutputMultiplier`, whether it is built or bought as an upgrade; the upgrade route takes it with no downtime, as the build does. |
| `buildings.refineryUpgrades.upgradeCost` | 150,000 | Half again the Complex's price, for another half of output. A Refinery has no running cost, so what decides it is ore to feed it and a buyer for the output (docs/design/upgrades.md). |
| `buildings.refineryUpgrades.assetValue` | 105,000 | 70% of the upgrade's cost. |
| `buildings.refineryUpgrades.offlineHours` | 8 | No production run can start while it upgrades. |
| `buildings.refineryUpgrades.outputMultiplier` | 2 | Each run delivers twice `quantityPerCycle` of every output from the same input (`refineryMultiplierFor`, shared by the tick, the receipt and the page). |
| `buildings.extractorYardUpgrades.toTier` | 2, 3, 4, 5 | The tier each upgrade takes an extractor yard to (ISP-101, AB#793; the design and why is docs/design/upgrades.md, AB#791). Tier 1 is the yard as built: `operations.throughputReferencePerHour` and the 250 cap. A yard's last tier is 1 plus the number of upgrades listed. Chosen, not derived: the Board has not seen these. |
| `buildings.extractorYardUpgrades.upgradeCost` | 40,000, 60,000, 90,000, 135,000 | The price of each upgrade: `40,000 x 1.5^(tier - 2)`, OGame's `base x factor^(level - 1)` with its factor for mines. It rises half again a tier while what a tier adds rises a quarter, so each tier pays back more slowly (docs/design/upgrades.md). |
| `buildings.extractorYardUpgrades.assetValue` | 28,000, 42,000, 63,000, 94,500 | Added to book value by each upgrade: 70% of its cost, the share the Refinery Complex uses (docs/design/buildings.md). |
| `buildings.extractorYardUpgrades.offlineHours` | 6, 12, 18, 24 | How long the yard is offline after each upgrade, `6 x (tier - 1)`: no cycle starts until it is back, and the hours it does not mine are part of the upgrade's price. |
| `buildings.extractorYardUpgrades.throughputReferencePerHour` | 525, 656, 820, 1,025 | The running cost's reference throughput at each tier, `420 x 1.25^(tier - 1)` rounded: the curve bends later, so the yard's best setting moves up and the most it earns an hour rises by about a quarter a tier. |
| `buildings.extractorYardUpgrades.throughputCap` | 313, 391, 488, 610 | The highest throughput each tier allows, `250 x 1.25^(tier - 1)` rounded, so the tier's best setting is always reachable. start-mining clamps to the yard's own cap. |
| `operations.costPerThroughputUnit` | 16 | What a tonne costs to mine. Against a net sale price of 22.08, it leaves a 6.08 margin, which is the T-018 problem below. |
| `operations.minCostPerHour` | 600 | The floor on an extractor's hourly cost: 37.5 t/h's worth. Below that, the player pays for throughput they do not get, so low settings lose money. |
| `operations.startupShareOfHourlyCost` | 0.35 | A cycle's startup is about a third of an hour's cost. Over a 72-hour cycle that is noise; over a 1-hour cycle it is a 35% surcharge. |
| `operations.minStartupCost` | 500 | The floor on startup, so the smallest cycle still costs something to begin. |
| `operations.throughputReferencePerHour` | 420 | The rate at which an extractor's running cost is double its straight-line cost: `16 x T x (1 + (T / 420)^2)`. It sets where the profit curve peaks, and so what the throughput decision is worth (ISP-86). |
| `probes.buildCost` | 8,000 | A mining probe, the cheap way to scout. Not on the first-extractor path. |
| `probes.assetValue` | 5,000 | 63% of cost on the balance sheet. No reason is recorded. |
| `expeditions.launchCost` | 3,000 | The price of a look at a belt's composition. Not on the first-extractor path. |
| `belts.reserveStandardExpeditions` | 14 | A belt's reserve, as that many standard expeditions' yield at its tier: 2,520 units common, 4,032 exotic (AB#2329). Sized in docs/design/belts.md (AB#1050) so a lone corporation loses 0.52% of its launches to depletion and a busy belt runs out. Model, not measured. |
| `belts.respawnChancePerHour` | 0.2 | An empty belt slot's chance, each hour on the hour (UTC), of a new belt: a 5-hour wait on average. The old TODO's number, kept by the design. |
| `belts.rarityStepWeight` | 0.25 | A new belt's rarity is its system's label most often, each tier further away this many times as likely: Sol spawns an exotic belt 1.2% of the time. Chosen, not derived. |
| `belts.compositionJitter` | 0.25 | Each resource's share in a new belt is its tier's template share times a draw in 1 ± this, renormalized: belts of one tier differ without changing character. Chosen, not derived. |
| `leases.royaltyPointsByLeasesHeld` | 2: 1, 3: 2, 5: 3 | The ISA lease royalty, points added to `exchange.salesTaxPct` by leases held (ISP-302, AB#2285; sink 2 of "Sinks that scale with income" below): 8% at one lease, 9% at two, 10% at three or four, 11% at five or more, before the Negotiation Fundamentals discount and never below 0. It comes out of every sale's proceeds, player trades included, and is booked as its own ledger category, `lease-royalty`. A one-lease corporation never pays it. Chosen, not derived: the Board has not seen it. |
| `exchange.salesTaxPct` | 8 | The exchange's cut of every sale. At 24 a tonne it is 1.92, almost a third of the 6.08 margin. Each point off it is 0.24 a tonne, about 60 an hour at 250 t/h; +10% output from research is worth about 550. |
| `npcBid.quotaPerDay` | 7000 | How much a standing buy order takes in a day before it stops buying. A yard at the flat-price best rate (146 t/h) produces about 3,500 units a day, so this is two such yards' output; priced along the bid the best rate is about 60 to 74 t/h, 1,450 a day, and the price moves long before the quota fills (AB#2334). It was 40,000 until the probe showed the drift almost never bit at that size (ISP-87). |
| `npcBid.driftAtFullQuotaPct` | 50 | How far the bid falls when the day's quota has been sold into it: half. Selling into the bid moves the price against the seller, which is what makes another player worth trading with. |
| `npcBid.recoveryPerDayPct` | 60 | How much of the gap back to the base price the bid recovers overnight. A market glutted yesterday opens dearer than it closed and cheaper than if nobody had sold. |
| `npcAsks.askMultiple` | 1.5 | An NPC corporation's ask as a multiple of the same good's standing bid base: Silicates at 36 against a bid of 24 (ISP-122, AB#815; docs/design/npc-corporations.md). The gap is the room the player market lives in: a listing between the two is better for both sides than the NPC. |
| `npcAsks.dailyQty.qty` | Silicates 3,000, Helium-3 40, Nickel 300, Titanium 80, Carbon 400, Rare Earths 40 | How much each NPC ask offers, refilled once a day. About a day of what one well-developed corporation produces of the good, not a million (the design's table). |
| `npcBid.floorPct` | 55 | The lowest the bid ever goes, as a share of its base price. A corporation dumping volume cannot strand a new player: this is the price always guaranteed. |
| `logistics.sameSystemFeePerUnit` | 2 | Moving stock between two stations in one system, per unit: the old flat fee, kept so nothing moved within Sol costs more (AB#718). 9% of the net Silicates price. The cheapest path avoids it by selling where it mines. |
| `logistics.perJumpFeePerUnit` | 3 | Added per unit for each jump between systems (AB#693, the Board: "distance based time and fees"). A starting point set in AB#718, not derived: no reason beyond that is recorded. |
| `logistics.sameSystemTransitMinutes` | 30 | How long a shipment within one system takes. Set in AB#718 as a starting point; live since AB#985 (ISP-278) — a dispatch creates a shipment that arrives on the tick at or after `dispatchedAt + transitTime(...)`, not on the spot. |
| `logistics.perJumpTransitMinutes` | 120 | Added transit time per jump, twice a corporate ship's hour a jump, as freight is slower. A starting point from AB#718; live since AB#985, as above. |
| `salvage.creditsThreshold` | 3,000 | Below this, and with no cycle running, the Salvage Assignment is offered (ISP-297): "the way back from broke," below. Set equal to `expeditions.launchCost`'s round number, not derived. |
| `salvage.hoursRequired` | 4 | How long the Assignment takes: paid in time served, not delivered quota, so nothing the player sets — throughput, research, a lever of any kind — changes how fast it pays (T-018). |
| `salvage.payoutCredits` | 3,000 | The flat payout: exactly the threshold above, so completing one contract is enough to be offered a real one again, not two. |
| `salvage.cooldownHours` | 8 | How long after completion before another is offered, so it is a stopgap and not a standing income. |
| `npcBuyers.unitPrice` | Silicates 24, Helium-3 92, Nickel 18, Titanium 64, Carbon 12, Rare Earths 140; products (AB#2341): Aerogel 41, Quantum Insulators 74, Armour Plating 118, Precision Frames 94, Carbon Fibre Sheets 21, Graphene Lattice 37; the Fuel track (AB#830, all the Lunar Helium Consortium's): Deuterium 40, Water Ice 8, Hydrogen 6, Plasma Conduits 159, Dark-Matter Capacitors 423, Fusion Pellets 198, Cryogenic Coolant 54; the Light Metals track (AB#833): Lithium 70, Bauxite 14, Aluminium Ingots 64, Aluminium-Lithium Alloy 114, Battery Cells 123; the Nickel-Iron track (AB#831): Iron Ore 10, Nickel-Iron Alloy 35, Pressure Vessels 129, Structural Alloys 25, Magnetic Cores 50; the Rare Metals track (AB#832, all Synthorium Trading House's): Thorium 160, Cobalt 110, Sensor Arrays 215, Catalyst Substrates 215, Rare-Earth Magnets 276, Thorium Fuel Rods 552 | The standing bids. They are the only steady faucet of new credits in the game (see below). Silicates at 24 is the one a first session sells into. No derivation is recorded for any of them. |
| `npcBuyers.dailyQty` | Silicates 1,000,000, Helium-3 250,000, Nickel 750,000, Titanium 400,000, Carbon 1,500,000, Rare Earths 120,000; products: Aerogel 240, Quantum Insulators 90, Armour Plating 103, Precision Frames 86, Carbon Fibre Sheets 480, Graphene Lattice 180; the Fuel track (AB#830): Deuterium, Water Ice and Hydrogen 7,000 each (the raw quota), Plasma Conduits 80, Dark-Matter Capacitors 20, Fusion Pellets 160, Cryogenic Coolant 360; the Light Metals track (AB#833): Lithium and Bauxite 7,000 each, Aluminium Ingots 240, Aluminium-Lithium Alloy 160, Battery Cells 120; the Nickel-Iron track (AB#831): Iron Ore 7,000, Nickel-Iron Alloy 384, Pressure Vessels 100, Structural Alloys 288, Magnetic Cores 96 (products: a day of one Refinery's output, docs/design/tier3-recipes.md section 4; the bid still moves on `npcBid.quotaPerDay` until npcBidFor takes a per-item quota); the Rare Metals track (AB#832): Thorium and Cobalt 7,000 each, Sensor Arrays 54, Catalyst Substrates 36, Rare-Earth Magnets 120, Thorium Fuel Rods 30 | How much each buyer takes a day. One extractor at 250 t/h makes 6,000 a day, 0.6% of the Silicates bid, so in practice the bid has no bottom (DEPTH.md, review #1, epic 3). |

`npcBuyers.item` and `npcBuyers.buyer` are the only words in the file: which good and who buys it.

The six `buildings.*Cost` and `*AssetValue` keys are each named by one building in data/player-buildings.json (its
`price`, AB#783). That file holds the rest of what a building is: its slot, research, cap and effect. The price stays
here, so the balance pass is still a diff of this one file.

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
Silicates sell to GEX Commodities Authority at 24, less 8% tax, along the standing bid (ISP-87): it falls 50% of base
across the day's 7,000 quota, never below 55%, and recovers 60% of the gap overnight. Each unit is sold along it, from the
opening bid the corporation settles into selling the same amount every day; revenue/h is that day over the hours run.
Expected uptime: 81.6% (a stoppage every 5.6 h on average, lasting 1.26 h).

Pays back = the purchases and the first startup earned back: credits are at the starting figure again.
  t/h | cost/h | startup | revenue/h | profit/h ideal | profit/h expected | pays back (ideal)   | pays back (expected)
   10 |    600 |     500 |       221 |           -459 |              -390 | never               | never
  100 |  1,691 |     592 |     1,835 |             63 |                66 | 1393.9 h (day 59)   | 1331.0 h (day 56)
  250 |  5,417 |   1,896 |     3,538 |         -1,978 |            -1,531 | never               | never
Credits start to accumulate: at 100 t/h from the first hour of mining (day 1), counted as sold; at 10 t/h and 250 t/h, never: every hour loses.

Running cost curves with throughput (operationCostPerHourFor, server/economy.js): the best setting here, no research, is 60 t/h at 224 an hour
(ideal uptime, running cost only; its tonnes average 21.81 before tax). At the flat 24 it was 146 t/h at 606 an hour.
Every throughput from the floor to the cap stays startable; the curve is what makes the setting a decision, not a wall.

One corporation's yards, 2 to a lease, all selling into the one order, at expected uptime, per day (payroll,
office, running and startup costs, yard upkeep and the lease royalty counted; lease and yard purchases not):
  yards | leases | t/h each | tonnes/day | sold to the bid | opening bid | average bid | tax | profit/day
      1 |      1 |       74 |      1,448 |           1,448 |          23 |       21.81 |  8% |      3,234
      2 |      1 |       37 |      1,448 |           1,448 |          23 |       21.81 |  8% |      3,479
      3 |      2 |       39 |      2,290 |           2,290 |          22 |       20.04 |  9% |      1,009
      4 |      2 |       38 |      2,975 |           2,975 |          21 |       18.45 |  9% |     -2,837
Other corporations selling into the same order are not modelled: each one lowers every other's price.
Today's server pays a lot at the bid before it and opens every day at 24 (AB#2356, AB#2357): one lot a day of up to 7,000 t is
paid 24 a tonne, the flat figure above. This model prices what ECONOMY.md's rule says, which the game pays once both are fixed.
A model, not play: perfect play, no travel, selling every unit to the standing bid as mined, no research.
```
<!-- economy-model:end -->

What it says, in words:

- The cheapest way to a first extractor costs **87,000 of the 250,000**: an office, five hires, the Earth lease and a
  yard. That leaves 163,000, so money is not what limits the first session.
- **250 t/h is no longer the right answer**: the curved cost (T-018 below) and the falling bid (ISP-87) make it
  lose about 2,000 an hour, and it never pays back. **100 t/h pays back around day 59** (day 56 with downtime, which
  sells fewer tonnes into a less glutted bid). **10 t/h never pays back**, because the 600 floor costs more than 10
  tonnes fetch. The best setting, with no research, is **60 t/h at 224 an hour** — below either number this table
  samples, which is the point: the decision is a real one, not a slide to the cap.
- **The bid, not the yard, is the limit** (AB#2334). Until AB#2334 this model sold every tonne at the flat 24 and
  said 146 t/h at 606 an hour. Sold along the standing bid, a 146 t/h yard's 3,500 tonnes a day average 17 and it
  loses money. A corporation's best day is **two yards on one lease at 37 t/h each, about 3,500 a day**; a third
  yard needs a second lease and its payroll, and loses. These are one corporation alone in the world: every other
  corporation selling Silicates lowers the price further.
- **Today's server pays more than this** (AB#2356, AB#2357): it prices a whole sale at the bid before it and opens
  every day at 24, so a corporation that sells a day's output in one lot is paid the flat 24, the old 606-an-hour
  figure. The model prices ECONOMY.md's rule; the two bugs are where the game departs from it.
- Credits grow from the first hour of mining only at a setting that actually pays — no longer every setting up to
  the cap. The number to tune is *which throughput to run*, not just how fast a fixed answer pays back.

## T-018: the throughput is a decision (ISP-86)

Revenue per hour was counted as **24 x T x 0.92** (price, throughput, what the tax leaves) until AB#2334; since ISP-87
the 24 falls as the day's sales fill the order (below). Cost per hour used to be
**16 x T** above the 600 floor, so profit was **6.08 x T** less fixed costs and rose with every tonne: 250 t/h was the
right answer at every scale and every balance, and the slider was arithmetic. DEPTH.md scored decision density 2
for this reason.

The cost now rises faster than the rate (`operationCostPerHourFor`, server/economy.js):

**cost per hour = 16 x T x (1 + (T / 420)^2)**, never below the 600 floor.

Profit per hour for Earth silicates at 24 credits and 8% tax, with no research, one yard running every hour of the
day and each tonne sold to the standing bid as it is mined, from the opening bid it settles into (AB#2334,
`steadyBidDay` in scripts/economy-model.mjs). The flat column is what the table said when every tonne fetched 24:

| T (t/h) | tonnes average | revenue/h | cost/h | profit/h | at the flat 24 |
| --- | --- | --- | --- | --- | --- |
| 10 | 24.00 | 221 | 600 | -379 | -379 |
| 50 | 21.97 | 1,011 | 811 | 200 | 293 |
| 60 | 21.81 | 1,204 | 980 | 224 | 345 |
| 100 | 19.95 | 1,835 | 1,691 | 144 | 517 |
| 150 | 16.92 | 2,335 | 2,706 | -371 | 606 |
| 200 | 15.98 | 2,940 | 3,926 | -986 | 490 |
| 250 | 15.38 | 3,538 | 5,417 | -1,879 | 103 |

The maximum is at **T = 60 t/h**, paying **224 credits an hour** (146 t/h and 606 at the flat price). Two things move
it, which is what makes it a decision rather than a constant:

- **Research.** With Basic Extraction Analytics and Supply Forecast (x1.1 and x1.06 on what an hour yields) the
  best setting rises to **93 t/h** at **413 an hour** (189 t/h and 1,230 at the flat price). Earning more per tonne
  is worth running hotter.
- **Price.** A dearer buyer, a lower sales tax or a bid left unsold overnight moves it up; a cheaper one, or other
  corporations selling into the same order, moves it down.

Below about 28 t/h the 600 floor means the corporation pays for throughput it does not get, so a very low setting
loses money. At the top of the range the curve costs 5,417 an hour against 3,538 of sales: it **loses 1,879 an hour**,
where the flat price had it paying 103. Ignoring the curve is a real cost and never a wall - every throughput from 10 to 250 stays startable, which
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

## The Nickel-Iron track: refining against selling raw (AB#831)

Arithmetic from data, not play. Bids at base and at floor (`npcBid.floorPct` 55%, as `npcBidFor` rounds it); the
exchange's sales tax takes the same share of either sale, so it scales both columns and changes no sign. Gain is what
a cycle's outputs fetch minus what its inputs would have fetched sold raw, per hour the Refinery is busy.

| Chain | Inputs sold raw | Outputs sold | Gain per refinery-hour |
| --- | --- | --- | --- |
| `smelting-chain` (5 h): 150 Iron Ore + 50 Nickel → 80 Nickel-Iron Alloy | base 2,400; floor 1,400 | base 2,800; floor 1,520 | both at base +80; both at floor +24; inputs at base, alloy at floor −176 |
| `pressure-vessel-chain` (6 h): 80 Nickel-Iron Alloy → 25 Pressure Vessels | base 2,800; floor 1,520 | base 3,225; floor 1,775 | both at base +71; both at floor +43; alloy at base, vessels at floor −171 |

So refining pays when the Refinery is free and the inputs' bids have fallen below the outputs' value, and loses when
the product's bid is the one that has fallen: docs/design/tier3-recipes.md section 5's rule, with its numbers.

**Mars now mines Iron Ore.** With Light Metals (AB#833) and this track both built, Mars has the design's whole profile,
Silicates 60, Iron Ore 30, Bauxite 10 (docs/design/tier3-resources.md section 3). Sold raw, a ton from a Mars yard
fetches `0.6 × 24 + 0.3 × 10 + 0.1 × 14 = 18.8` at base bids, against 23.0 with Light Metals alone (Silicates 90,
Bauxite 10) and 24 before either: 18% and 22% less. At floors it is `0.6 × 13 + 0.3 × 6 + 0.1 × 8 = 10.4` against
12.5 and 13. A Mars lease pays back more slowly for a corporation that sells raw, until it smelts. Earth is unchanged.

The runway probe (ops/probes/isp-runway.ts, seed 7000, 30 bot days; bot numbers, P-PROXY) was run before AB#833 merged,
on main then (Mars all Silicates) and with this track (Mars 70:30). It printed the same figures except Mars' yards
mining 613 units instead of 614. That is not evidence the change is
harmless: only the expander leases Mars, it mines 613 units there in 30 days against Earth's 11,644, and no bot sells
Iron Ore or smelts. The probe cannot see Mars' lower raw value; a bot that plays this track is AB#835's.

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

## Sinks that scale with income (ISP-88, AB#778)

**A design, then code, one sink at a time.** Each sink is one implementation story, and its key joins the table at the
top of this file when that story lands. Sink 1, yard upkeep (ISP-301, AB#2284), and sink 3, the rising yard price (ISP-303, AB#2286), have; sink 2 has not.

**The problem, as it stands now.** Monetization review #1 found credits piling up past minute 120 with nothing to
want: about 13 sinks, all one-off except payroll and rent. Review #2 and the ISP-42 re-run above found the
opposite at the bottom of the curve: planner and greedy end near 0 credits (banked/spent 0.00x to 0.01x) and the
reserve bot holds 25,858 at day 30 (0.12x). Both readings are true at once: a one-yard corporation is squeezed,
and a corporation that expands has nothing that grows with it. So every sink here is **zero for a one-yard,
one-lease corporation** and grows with yards and leases held. A flat new cost would deepen the squeeze that the
Salvage Assignment exists to catch.

**Prior art.** This file's "Faucets and sinks" section already cites Raph Koster's *MMO economies* and Game
Developer's *Virtual Economic Theory* for keeping the NPC bid as a floor and tying the drains to the money supply.
MONETIZATION.md's survey adds EVE's and RuneScape's permanent, uncapped sinks. The three sinks below apply that
here: each drain is proportional to the capacity that creates money (yards mining, leases held), not a fixed price
that a growing corporation stops noticing.

### The three sinks

**1. Yard upkeep, while a yard runs.** Every extractor yard after the corporation's first two adds an upkeep to its
hourly running cost, of 2% of the yard's price per running day:

upkeep per hour = 50,000 x 2% / 24 = **41.67 credits an hour**, for yards 3 onward, added after the 600 floor.

- *Scales with:* yards running. The first two yards never pay it (the starting kit: one lease's two building slots;
  ISP-308, AB#2304, moved the line from the first yard on the Director's ruling on AB#2287), and an idle yard costs
  nothing.
- *Unpaid:* it is part of the running cost, so it inherits what the mining tick already does when credits cannot
  cover a cycle (`server/game/mining.js`, `affordabilityRatio`). The yard mines in proportion to what the
  corporation can pay, with no debt and no arrears, and a broke corporation's first yard is exempt. **It degrades
  output and never locks the player out.**
- It is a constant per hour, so it does not move T-018's best throughput. It makes each extra yard pay for its
  keep, not change how it is run.
- Proposed key: `buildings.extractorYardUpkeepPctPerDay`, 2.

**2. The ISA lease royalty: a tiered sales tax by leases held.** The exchange's sales tax rises with the number of
mining leases the corporation holds:

| leases held | royalty added to the 8% tax |
| --- | --- |
| 1 | 0 |
| 2 | 1 point |
| 3 to 4 | 2 points |
| 5 or more | 3 points |

- *Scales with:* sales, the one number that is income. A corporation that sells nothing pays nothing.
- *Unpaid:* it cannot be unpaid, because it comes out of the sale's proceeds the way the 8% does today. **Nothing
  is withheld and nothing is locked.** The Negotiation Fundamentals discount (2 points a level, up to 6) still
  applies on top, and the rate never goes below 0.
- It is added in `getEffectiveExchangeTaxRate` (`server/game/progression.js`), so it reaches every sale the tax
  already reaches, including player-to-player trades. That leaves a player's choice between the bid and another
  player where it was.
- Proposed key: `leases.royaltyPointsByLeasesHeld`, {2: 1, 3: 2, 5: 3}.

**3. A capital cost that rises with the corporation: each yard costs more than the last.**

price of the n-th yard = 50,000 x 1.25^max(0, n - 2), rounded to 1,000: **50,000, 50,000, 63,000, 78,000, 98,000,
122,000, 153,000**. The starting kit's two yards are flat; growth starts at the third (ISP-309, AB#2305, the
Director's ruling on AB#2287; flagged for the Board).

- *Scales with:* yards owned. Supply Forecast's 6% discount applies to the escalated price.
- *Unpaid:* it is a purchase. A corporation that cannot afford the next yard keeps everything it has, and nothing it
  already owns costs more. **It never locks a player out.**
- It gives a corporation at the top of the ladder something to buy (Monetization epic 2's second test): there is
  always a next yard, at a price that rises with what it already owns.
- Proposed key: `buildings.extractorYardPriceGrowth`, 1.25.

### What they add up to

**Corrected by AB#2334:** the table below sells every tonne at the flat 24, so its profit column grows by 11,106 a
yard. Along the falling bid one corporation's day peaks at two yards (about 3,500, the model's yard table above) and a
third yard loses money; the sinks' shares of profit are therefore much larger than shown. The design's order of the
sinks still holds; its sizes were set against this overstated profit.

The model's assumptions, as `npm run economy:model` printed them before AB#2334: Earth Silicates at 24, no research, the best setting of 146 t/h
(606 an hour ideal), expected uptime 81.6% (costs and revenue both pause while down), one yard per lease, and 750 a
day of payroll per lease. Office rent, leases and hires are left out, and this design changes none of them. Per
day:

| yards | tax | profit today | yard upkeep | lease royalty | share of profit | this yard's price | its payback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 8% | 11,106 | 0 | 0 | 0% | 50,000 | today's path |
| 2 | 9% | 22,212 | 0 | 1,372 | 6.2% | 50,000 | 5.1 days |
| 3 | 10% | 33,318 | 816 | 4,117 | 14.8% | 63,000 | 8.3 days |
| 4 | 10% | 44,425 | 1,632 | 5,490 | 16.0% | 78,000 | 8.7 days |
| 5 | 11% | 55,531 | 2,448 | 10,293 | 22.9% | 98,000 | 17.9 days |
| 6 | 11% | 66,637 | 3,264 | 12,352 | 23.4% | 122,000 | 14.8 days |

"Its payback" is the yard's price over what that yard adds to the day's profit after both sinks. Under today's
rules every yard after the first pays back its 50,000 in 4.5 days. After this design the 2nd yard does so in about
five days, and the 5th takes two and a half weeks: the step to 5 leases is where the royalty tier rises. The price
column is ISP-309's (AB#2305, growth from yard 3) and the upkeep column ISP-308's (AB#2304, upkeep from yard 3: 816 a
day is a yard's 41.67 an hour over 24 hours at 81.6% uptime); both read `extractorYardsInStartingKit`. A corporation that
stops at 4 has made a real decision (T-018), not hit a wall. **These are model numbers, not play** (P-PROXY): perfect
play, every unit sold at the standing bid.

### What the probe checks after each lands

`ops/probes/isp-runway.ts` counts banked and spent per day. The implementation stories give it the three sinks as
categories of their own, from the AB#712 ledger: `yard-upkeep`, `lease-royalty` and `yard-price-growth` (ISP-307,
AB#2299, for the first and third). These are the numbers it must show. They are bot numbers,
seeds 7000 and 7001, at day 3, 7 and 30:

1. **The acceptance target still holds:** banked/spent below 3x for planner, greedy and reserve at every checkpoint.
   Today it is 0.00x to 0.22x, so this is a guard that the sinks did not break the floor.
2. **The squeezed are untouched:** with `--supply low` (each bot's ore to market capped at 2,000 a day; it still
   owns the starting kit, one lease and its two yards, the squeezed corporation of the Director's AB#2287 ruling;
   Bug AB#2303 corrected "one yard each", which the probe never ran), each bot's spend in the three categories is
   **0**, and planner's and greedy's Salvage Assignment counts at day 30 stay within 10% of 22 and 56 (the counts
   above).
3. **The expanded pay:** with `--supply high`, each bot that has expanded past the starting kit (3 or more yards, or 2
   or more leases) spends **more than 0 and between 5% and 30%** of what it earned on day 30 in the three categories.
   The model above says 10% to 25% for 2 to 6 yards; the band is wider because the bot's yard count is its own. With
   no expanded bot the check **waits**, as check 4 does, rather than failing on nobody (ISP-310, AB#2306); the
   `expander` bot exists to be that corporation.
4. **Something is still for sale at the top:** the probe prints the price of the bot's next yard at its highest
   level, and it is a number, not a cap. This can only be checked past Level 3 once the ladder is reachable (AB#1753).
   Until then the probe reports it and the check waits.

If check 2 fails, the design's premise (zero for the squeezed) is false, and the sink that caused it comes back out.

### What the probe printed (ISP-304, AB#2287; ISP-310, AB#2306)

`node ops/probes/isp-runway.ts --supply <low|high> --seed <7000|7001>` in hq (branch of ISP-310, with AB#2317's session
fix), 30 bot days, against ISP main `e31e390c` (the three sinks, ISP-307's categories, ISP-308's and ISP-309's
starting-kit boundary). `--supply high` runs four bots, the three and `expander`; `--supply low` runs the three (its
Salvage baselines are three-bot numbers). Bot numbers (P-PROXY). The two seeds printed the same numbers: the seed only
picks the pinned downtime roll, and every bot's play is otherwise deterministic.

```text
--supply high (planner, greedy, reserve, expander)
CHECK 1 PASS: banked/spent below 3x for planner, greedy, reserve, expander at every checkpoint — planner 0.01x/0.10x/0.01x, greedy 0.00x/0.00x/0.00x, reserve 0.15x/0.00x/0.02x, expander 0.54x/0.32x/0.00x
CHECK 3 FAIL: --supply high: an expanded bot's (3+ yards or 2+ leases) last-day spend in the three sinks is 5% to 30% of that day's earnings — expander (3 yards, 2 leases) day 30: sinks 0 of 6,000 earned = 0.0%
CHECK 4 WAIT: the next extractor yard's price at a bot's highest level is a number, not a cap — planner level 3: ¤59,220, greedy level 3: ¤59,220, reserve level 3: ¤59,220, expander level 3: ¤73,320 (no bot passed Level 3: the check waits for AB#1753's ladder)
--supply high, --bots planner,greedy,reserve (the world before ISP-310)
CHECK 3 WAIT: ... — no bot expanded past the starting kit (planner 2 yard(s), 1 lease(s), greedy 2 yard(s), 1 lease(s), reserve 2 yard(s), 1 lease(s)): the check waits for one that does
--supply low (planner, greedy, reserve)
CHECK 1 PASS: banked/spent below 3x for planner, greedy, reserve at every checkpoint — planner 0.00x/0.00x/0.00x, greedy 0.00x/0.00x/0.01x, reserve 0.00x/0.00x/0.00x
CHECK 2 PASS: --supply low bots pay 0 in the three sinks; Salvage counts within 10% of 22 and 56 — no bot paid any of the three; salvage-complete by day 30: planner 20 (baseline 22, within 10%), greedy 53 (baseline 56, within 10%)
CHECK 4 WAIT: (as on high, without expander: every bot at level 3, next yard ¤59,220)
```

**Check 2 passes.** With the starting kit exempt from upkeep and price growth (ISP-308, ISP-309), the two-yard bots of
`--supply low` pay 0 in all three sinks, and the Salvage counts are within 10% of the baselines. AB#2287's failure is
gone because the boundary moved, not because the check did.

**Check 3 fails, on a real population, and the finding is not the sinks' size.** `expander` reaches 3 yards and a
Mars lease inside the 30 days, but it ends day 30 with 1,487 credits after 35 Salvage completions: over the run it paid
13,000 in `yard-price-growth` (its third yard, 63,000), 414 in `lease-royalty` and **0 in `yard-upkeep`**, because
its Mars yard never ran a cycle. It never had the startup cost at hand. On day 30 it paid nothing because it was running
almost nothing, so "sinks 0 of 6,000" measures a broke corporation, not an expanded one paying too little. This is
the Director's "the problem is not reproduced" note seen from the expanded side: no bot in this probe reaches the state
the sinks exist for, where credits pile up with nothing to want. Every profile, `expander` included, spends to near 0
(most of `expander`'s money, 365,525, went on other bots' listings through the shared bargain rule). The thresholds
are unchanged.

**Check 4 still waits:** no bot passes Level 3. Level 4 needs Industrial Safety Protocols, and every bot's research
stalls at a few thousand credits it does not keep.

Found on the way, and filed: every bot in this probe had done nothing since ISP AB#2294 made access tokens last 30
minutes (AB#2317, fixed in the same hq change; the probe now renews each bot's session through `/api/auth/refresh`
before each action), and the three bots' own Mars-lease branch can never run (AB#2319), so none of them can hold a
second lease.

### The Soul and Charter check, per sink

None of the three withholds anything already owned, times anything against the player, or can be paid for with
money. Upkeep reduces a yard's output in proportion to what cannot be paid; the royalty comes out of a sale; the
escalating price is a purchase the player can decline. The Salvage Assignment still catches a corporation at 0, and
none of these sinks reaches a one-yard corporation that needs it.

**Flagged for the Board:** these three change what expansion costs for every corporation past its first yard. That
is a balance decision about the core loop, and it is made here on model numbers alone.

## Rules the model takes from the code

These are not in `data/economy.json`, so the model states them, with where each comes from. The test reads those
files and fails when one changes.

- Starting credits 250,000, at Earth Station Prime (`server/gameState.js`).
- A lease needs an office and 5 employees per lease (`public/scripts/leaseStaffing.js`, `EMPLOYEES_PER_LEASE`, which the lease route imports).
- Throughput is clamped to 10..250 t/h for a tier-1 yard (a tier raises the cap, AB#793; `BASE_THROUGHPUT_CAP` in `server/economy.js`), and a cycle runs at most 72 hours (`server/routes/mining.js`, start-mining).
- Downtime starts with probability 0.005% a second, lasts at least 15 minutes, then ends with probability 0.0276% a
  second (`server/gameState.js`). That makes expected uptime about 82%, and costs pause while an extractor is down.
- Leases come from `data/systems.json`: Earth 20,000, Mars 25,000, Luna 30,000. Mined Silicates land at the station
  orbiting the leased body, and an NPC sale draws from the station you are docked at. The Earth path needs no travel.
