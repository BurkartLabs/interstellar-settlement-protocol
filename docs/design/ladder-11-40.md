# Levels 11 to 40 (ISP-105, AB#797)

v0.6's plan line is "Full milestone roadmap (Levels 11-40)". The Board answered D-0.6-1 (AB#700): **"Level 40 should
take like a year of gameplay."** The half it did not answer takes the recommendation, option A: all thirty levels are
written now against what exists at the end of v0.6, and later versions swap requirements in as their systems land.
This is the design. The data is AB#800 to AB#802, the resolver changes AB#798 and the level panel AB#803. Read against
ISP main `4c051e76`, 2026-09-26, with AB#796's unlock allowlist.

**Every number here is a bot number, not a measured human pace (P-PROXY).** No player's pace has been measured. The
year is stated as the target of a year-pacing probe (a new story): a bot that acts only at **two check-ins per
simulated day**, takes the cheapest path, and has the server clock injected, reaches Level 40 **between simulated day
330 and day 400**. The per-level days below are that probe's targets, not predictions about a person.

## What paces the year, and what does not

- **Research does not.** All thirteen techs total 114 hours and 100,000 credits, and levels 3 to 10 already require
  eight of them. Levels 11 to 40 require the three left: Containment Physics (10 h, 8,000), Exotic Energy Routing
  (16 h, 12,000) and Deep-Star Navigation (14 h, 20,000). That is 40 queued hours in a year.
- **Credits do not.** Six yards at tier 2 earn about 75,000 a day after upkeep and royalty (docs/design/upgrades.md's
  table, less AB#2284 and AB#2285). Every band's purchases below cost under two weeks of that. Credits will pile up
  from band C unless something absorbs them. The proposed tiers 6 to 8 (below) and the scaling sinks (AB#778) are
  where they go. This is flagged, not solved, here.
- **Production does.** The counters a level asks for grow only as fast as the corporation produces, and what bounds
  production exists today: six yards at most (only Earth, Mars and Luna lease, two yards each), each yard's tier, one
  expedition out at a time (`BASE_MAX_DEPLOYMENTS`), two contracts on offer with a 4-hour cooldown, and refinery runs
  of 4 to 8 hours between check-ins. The targets sit on the cumulative curve of those rates, so each level takes about
  **11 days** (Level 10 at day 30, Level 40 at day 365).

**Why roughly even steps, not an exponential curve.** Aversa's comparison of level curves (*RPG level-based
progression*) is the prior art named on AB#797: an exponential requirement on a roughly linear income makes each level
take longer than the last, so most of a year would sit in the last band, which is a wall, not a goal. Here the
requirements are cumulative production and production itself rises with tiers, so equal days per level come from
targets that grow a little faster than linearly. EVE's "what now?" drop-off after its guided sequence (cited in
DEPTH.md) is why every band below has a name and a reward to use, not only a bigger number.

## The rates the targets are drawn from (arithmetic, bot numbers)

Per simulated day, for the check-in bot, from the tier table in docs/design/upgrades.md (best rate x 24 x 81.6%
uptime, six yards):

| days | yards at tier | Silicates mined (capacity) | Silicates the world buys (GEX quota) | refined units | expeditions | contracts |
|---|---|---|---|---|---|---|
| 30-90 | 2 | 21,384 | 7,000 | 330 (one Refinery, 3 batches a check-in) | 2 (one out, relaunched each check-in) | 2 |
| 90-150 | 3 | 27,258 | 7,000 | 990 (two, one a Complex) | 2 | 3 |
| 150-210 | 4 | 33,840 | 7,000 | 1,320 (both tier 3) | 2 | 3 |
| 210-365 | 5 | 42,420 | 7,000 | 1,320 | 2 | 3 |

**The quota binds (AB#2321, Director ruling 2026-09-26).** The GEX standing buy order takes 7,000 t of Silicates a
day for the whole world (`npcBid.quotaPerDay` in data/economy.json), and a yard costs about 80% of its best-rate
revenue to run, so ore past the quota and the refineries' take is pure cost. A profitable corporation mines about
8,200 t a day, not the capacity above (bot, days 49 to 71). Levels 11 to 15's `totalMined:silicate` targets are drawn
from that: about 160,000 mined at day 30 plus 8,200 a day, 90% of it at the level's day. The quota is not raised: it is
a world economy lever, not a pacing one, and the design already has too many credits. The targets from Level 21 on
still assume capacity; what happens past Level 20 is AB#2324 (Board), and AB#801 and AB#802 wait for it. The probe
runs one corporation alone, so these are numbers for an empty server.

**AB#2324 is answered:** ECONOMY.md, "Demand: the Board's rule (AB#2324)", owns demand now. Progress never waits on
the market, and demand is tuned later to one goal (yards 3 to 6 pay). This table's "the world buys" column and the
paragraph above describe today's shared 7,000 t quota, which is pre-tuning. AB#801 and AB#802 redraw the targets
against that rule; no number here changes until they do.

Silicates sold are the mined, less what goes into refineries (100 in for 55 out) and contracts (about 400 each). Each
target below is 90% of the curve at its level's day, rounded down, so the bot meets it on that day or a little before.
Level 10's own targets are the curve's starting point. The refined curve is anchored at Level 10's 2,000 refined units (AB#2312, which lowered it from 10,000):
every `stat:refinedUnitsProduced` target from Level 16 on is 7,200 (90% of the 8,000 difference) below its first version.

## The levels

The `stat:silicateSoldOnExchange` targets below (Levels 28 to 40) count NPC sales, which ECONOMY.md's "Demand: the
Board's rule (AB#2324)" excludes from ladder requirements: a level counts what a corporation produces. AB#802 redraws
them as production metrics; they stand here, unchanged, until it does.

`building-tier:<id>:<n>` is new: the count of that catalogue building at tier n or above (see "What AB#798 must
change"). The `maxUpgradeTier` values above 5 are a **proposal** that needs a story before the data may carry them
(see "Rewards past Level 10"); the `maxDeployments` column may be carried now (AB#2307 added the key). The other unlocks continue levels 1 to 10's steps.

| level | probe day | requirements (metric, target) | employeeCap | buildingSlots | maxFleetSize | maxUpgradeTier | maxDeployments (proposed) |
|---|---|---|---|---|---|---|---|
| 11 | 41 | `building-count:Basic Extractor Yard` 4<br>`totalMined:silicate` 225,000 | 210 | 12 | 145 | 5 | 1 |
| 12 | 52 | `building-tier:basic-extractor-yard:2` 3<br>`totalMined:silicate` 306,000 | 220 | 12 | 150 | 5 | 2 |
| 13 | 64 | `building-count:Basic Extractor Yard` 5<br>`stat:miningLeasesCount` 3<br>`totalMined:silicate` 394,000 | 230 | 12 | 155 | 5 | 2 |
| 14 | 75 | `building-tier:basic-extractor-yard:2` 6<br>`totalMined:silicate` 476,000 | 240 | 12 | 160 | 5 | 2 |
| 15 | 86 | `building-count:Basic Extractor Yard` 6<br>`building-tier:basic-extractor-yard:3` 3<br>`totalMined:silicate` 557,000 | 250 | 13 | 165 | 5 | 2 |
| 16 | 97 | `building-count:Refinery` 2<br>`stat:refinedUnitsProduced` 25,800 | 260 | 13 | 170 | 5 | 2 |
| 17 | 108 | `building:Refinery Complex` 1<br>`stat:refinedUnitsProduced` 34,800 | 270 | 13 | 175 | 5 | 2 |
| 18 | 119 | `unlockedTech:tt-containment-physics` 1<br>`stat:refinedUnitsProduced` 44,800 | 280 | 13 | 180 | 5 | 2 |
| 19 | 131 | `building-tier:basic-extractor-yard:3` 6<br>`stat:refinedUnitsProduced` 55,800 | 290 | 13 | 185 | 5 | 2 |
| 20 | 142 | `building-tier:refinery:3` 1<br>`stat:refinedUnitsProduced` 65,800 | 300 | 14 | 190 | 6 | 2 |
| 21 | 153 | `building:Ferric Mining Complex` 1<br>`stat:asteroidExpeditionsCompleted` 230 | 310 | 14 | 195 | 6 | 2 |
| 22 | 164 | `building-tier:assembly-facility:2` 1<br>`stat:asteroidExpeditionsCompleted` 250 | 320 | 14 | 200 | 6 | 2 |
| 23 | 175 | `unlockedTech:tt-exotic-energy-routing` 1<br>`stat:asteroidExpeditionsCompleted` 270 | 330 | 14 | 205 | 6 | 2 |
| 24 | 186 | `building-tier:basic-extractor-yard:4` 3<br>`stat:asteroidExpeditionsCompleted` 289 | 340 | 14 | 210 | 6 | 3 |
| 25 | 198 | `unlockedTech:tt-deep-star-navigation` 1<br>`stat:asteroidExpeditionsCompleted` 311 | 350 | 15 | 215 | 6 | 3 |
| 26 | 209 | `building-tier:refinery:3` 2<br>`stat:missionsCompleted` 451 | 360 | 15 | 220 | 6 | 3 |
| 27 | 220 | `building-tier:basic-extractor-yard:4` 6<br>`stat:missionsCompleted` 481 | 370 | 15 | 225 | 6 | 3 |
| 28 | 231 | `stat:missionsCompleted` 511<br>`stat:silicateSoldOnExchange` 4,800,000 | 380 | 15 | 230 | 6 | 3 |
| 29 | 242 | `building-tier:basic-extractor-yard:5` 2<br>`stat:missionsCompleted` 540 | 390 | 15 | 235 | 6 | 3 |
| 30 | 253 | `stat:missionsCompleted` 570<br>`stat:silicateSoldOnExchange` 5,600,000 | 400 | 16 | 240 | 7 | 3 |
| 31 | 265 | `building-tier:basic-extractor-yard:5` 3<br>`totalMined:silicate` 6,600,000 | 410 | 16 | 245 | 7 | 3 |
| 32 | 276 | `totalMined:silicate` 7,000,000<br>`stat:silicateSoldOnExchange` 6,400,000 | 420 | 16 | 250 | 7 | 3 |
| 33 | 287 | `building-tier:basic-extractor-yard:5` 4<br>`totalMined:silicate` 7,400,000 | 430 | 16 | 255 | 7 | 4 |
| 34 | 298 | `totalMined:silicate` 7,800,000<br>`stat:silicateSoldOnExchange` 7,100,000 | 440 | 16 | 260 | 7 | 4 |
| 35 | 309 | `building-tier:basic-extractor-yard:5` 6<br>`totalMined:silicate` 8,200,000 | 450 | 17 | 265 | 7 | 4 |
| 36 | 320 | `totalMined:silicate` 8,700,000<br>`stat:silicateSoldOnExchange` 7,900,000 | 460 | 17 | 270 | 7 | 4 |
| 37 | 332 | `stat:silicateSoldOnExchange` 8,300,000<br>`stat:refinedUnitsProduced` 282,800 | 470 | 17 | 275 | 7 | 4 |
| 38 | 343 | `stat:refinedUnitsProduced` 292,800<br>`stat:asteroidExpeditionsCompleted` 572 | 480 | 17 | 280 | 7 | 4 |
| 39 | 354 | `stat:asteroidExpeditionsCompleted` 592<br>`stat:missionsCompleted` 843 | 490 | 17 | 285 | 7 | 4 |
| 40 | 365 | `totalMined:silicate` 10,000,000<br>`stat:silicateSoldOnExchange` 9,500,000<br>`stat:refinedUnitsProduced` 322,800<br>`stat:asteroidExpeditionsCompleted` 612<br>`stat:missionsCompleted` 873 | 500 | 18 | 290 | 8 | 4 |

## The six bands

Each band has a name, one thing the player gets that they can see or use, and a choice whose best answer depends on
the player's situation (T-018), so the year is not only waiting. Credits and research per band are what the band's
requirements cost to meet (arithmetic, list prices).

**A. The full claim (11-15, days 41-86).** Six yards across Earth, Mars and Luna, half of them at tier 3.
*Gets:* a second expedition out at once (Level 12, proposed `maxDeployments`). *Choice:* build the next yard or
upgrade one. The 4th to 6th yards cost 98,000, 122,000 and 153,000 (AB#2286) against tier upgrades at 40,000 and
60,000. Under AB#791's rule the build wins while it pays back faster, and the rising yard price is what moves that
line. *Costs:* about 830,000 (three yards, the Luna lease and hires, six tier-2 and three tier-3 upgrades), no research.

**B. The refinery floor (16-20, days 97-142).** Two refineries, one a Refinery Complex, one at tier 3. *Gets:* yard
tier 6 (Level 20, proposed). *Choice:* feed Silicates to the refineries or sell them. 100 t into a run gives 55 refined
units toward the level and forgoes about 2,200 credits of sales, and refined goods have no NPC buyer at v0.6
(DEPTH.md). So a player short of credits climbs slower on purpose, and one with a reserve climbs faster. *Costs:* about
510,000 (a second Refinery, the Complex, tier 3, three more yard tier-3 upgrades) and 10 h of research.

**C. Survey fleet (21-25, days 153-198).** The Ferric Mining Complex, a tier-2 Assembly Facility, two long research
projects, 311 expeditions. *Gets:* a third expedition slot (Level 24, proposed). *Choice:* short sweeps or deep-core
drills. Either counts once, but a drill brings back more Nickel and Titanium, which the Ferric Mining Complex raises by
a quarter and the metal refinery chains need. So a player refining metals drills, and one only climbing sweeps. Each
launch costs 3,000. *Costs:* about 900,000 (the Ferric complex, the assembly tier, three yard tier-4 upgrades, about
160 launches) and 30 h of research.

**D. Contractor of record (26-30, days 209-253).** Contracts and sales. *Gets:* yard tier 7 (Level 30, proposed).
*Choice:* deliver Silicates to a contract (it counts toward the level and pays its reward) or sell them into the
standing bid (paid at once, and the bid falls as the day's volume rises). The better one moves with the day's bid.
*Costs:* about 790,000 (the second Refinery's Complex and tier 3, three yard tier-4 and two tier-5 upgrades).

**E. Industrial scale (31-35, days 265-309).** All six yards at tier 5. *Gets:* a fourth expedition slot (Level 33,
proposed). *Choice:* the last tier-5 upgrades (135,000 each, a 27-day payback in AB#791's table) against pushing the
refinery and expedition counters the capstone needs. With this band asking for yards and the next for everything,
where the check-ins go decides which arrives first. *Costs:* about 540,000.

**F. Sovereign output (36-40, days 320-365).** Every counter at once; Level 40 asks for all five. *Gets:* yard tier 8
(Level 40, proposed), the capstone. *Choice:* which counter to push at each check-in; the one furthest behind its
target sets the day. *Costs:* no new purchases unless tiers 6 to 8 exist, which is where the credits from band C on go.

## Rewards past Level 10, honestly

At v0.6 nothing a level from 11 to 40 could grant is something a player can use, so the bands name proposals.

- **`employeeCap`, `buildingSlots` and `maxFleetSize` do not bind.** Three leases' worth of staff is 15 employees
  against a cap already 200 at Level 10; eleven buildings fit in 12 slots plus 2 per lease; and with one expedition
  out at a time a fleet of 140 is not the limit. The table continues their steps for continuity and AB#803's panel, and
  does not call them rewards.
- **Market sectors gate nothing.** `unlocks.marketSectors` is recorded and shown, and no code reads it. This design
  adds no sector until a story makes one do something. Naming a sector as a reward would be a reward that is not one.
- **`maxDeployments` is an unlock key since AB#2307:** in AB#796's allowlist (`LEVEL_UNLOCK_KEYS`, server/game/catalog.js)
  with an applier that raises `corp.asteroidMining.maxDeployments` from `BASE_MAX_DEPLOYMENTS` and never lowers it; the
  launch route already read that field, and the level notice names it "Deployment slots".
- **Yard tiers 6 to 8 are in the data since AB#2308:** AB#791's curve (`T_ref` and the cap x1.25 a tier, the price
  x1.5: 202,500, 303,750 and 455,625), with paybacks of 32.9, 39.7 and 47.2 days (docs/design/upgrades.md's table).
  A level's `maxUpgradeTier` may now go up to 8.

## What AB#798 must change

- **`building-tier:<id>:<n>`**: the number of the corporation's buildings of catalogue id `<id>` (matched by its name
  in `data/player-buildings.json`) whose `tier` is `n` or more. Used for the yard, the Refinery and the Assembly
  Facility.
- **`stat:missionsCompleted` past 200.** It is counted from `corp.completedMissions`, which keeps only the last 200,
  so a target above 200 could never be met. Completing a contract should also `bumpStat` a running total (a new counted
  stat), and the resolver should read the larger of the two, so old saves keep their count.
- Every other metric used resolves today: `building-count`, `building`, `unlockedTech`, `totalMined:silicate`,
  `stat:silicateSoldOnExchange`, `stat:refinedUnitsProduced`, `stat:asteroidExpeditionsCompleted` and
  `stat:miningLeasesCount`.

## What to revisit when later versions land

- **v0.7, World Expansion** (20+ systems, neutral stations, pirates): leases beyond Sol lift the six-yard ceiling, so
  band A's yard counts and every `totalMined` target are re-derived; band C's expedition counts become expeditions
  beyond Sol and pirate encounters.
- **v0.8, Energy and Metals** (He-3, Nickel-Iron, rare and light metals): band B's and F's refined-unit counts become
  specific chains, and `totalMined:silicate` gains siblings (`totalMined:<resource>`, a resolver change).
- **v0.9 finance, v0.10 warfare, v0.12 conglomerates**: band D (contracts) and band F (the capstone) are where their
  requirements go, replacing sales and contract counts rather than adding a sixth counter to Level 40.

## Credits only

Nothing here is sold for money: no level, no requirement, no skip (BRIEF.md; Board decision AB#980 for research and
insight, applied to levels in the same way).
