# Building upgrade tiers (ISP-99, AB#791)

v0.6's plan line is "Building upgrade (tier) system" (DEVELOPMENT_PHASES.md:99). Every built building already carries
`tier: 1`, and every corporation an unused `unlocks.maxUpgradeTier`; nothing reads either. This is the design they
were waiting for. It changes no code. AB#793 (ISP-101) builds the upgrade endpoint and the Basic Extractor Yard's
tiers, AB#794 (ISP-102) the other catalogue buildings, and AB#795 (ISP-103) the control on each building. Read
against ISP main `e09c00ad` (yard upkeep, AB#2284, included), 2026-09-26.

**Every number here is chosen, not derived, and the Board has not seen them.** They are sized against the model
below so the decision exists; the probe (below) is what says whether they hold.

## The problem a tier has to avoid (T-018)

If a tier multiplied a building's output and its cost by the same factor, "upgrade everything to the maximum" would
always be right, and the system would hold no decision. This is the same trap ISP-86 took out of the throughput
setting, and a tier must not put it back.

A yard's profit per hour today is revenue `24 x T x 0.92` less the running cost `16 x T x (1 + (T / T_ref)^2)`
(ECONOMY.md, T-018). Its best throughput is `T* = T_ref x sqrt(6.08 / 48) = 0.356 x T_ref`, and the most it can earn
an hour is about **1.44 x T_ref**. So the lever for a tier is **`T_ref`**, the point where the running cost starts
to climb. Raising it lets the yard run hotter for the same cost. It does not scale output and cost together: at
the same throughput, an upgraded yard costs less to run, and its best setting moves up.

The decision comes from three things pulling against that gain:

1. **Each tier costs half again as much as the last, but earns only a quarter more.** The upgrade price follows
   OGame's `base x factor^(level - 1)` with factor 1.5, the factor OGame uses for its mines (OGame Wiki, *Formulas*
   and *Metal Mine*, the prior art named on AB#791). What a tier adds grows by 1.25. So each tier pays back more
   slowly than the one before.
2. **An upgrading yard is offline**, and the hours it does not mine are part of the upgrade's price.
3. **A hotter yard needs more cash on hand.** Its running cost is charged by the hour and its ore pays only when
   sold, so a higher tier needs a larger float. The superlinear running cost makes that float grow faster than the
   profit does.

## Basic Extractor Yard: five tiers

For tier `n`:

- `T_ref(n) = 420 x 1.25^(n-1)`, the running cost's reference throughput (`operations.throughputReferencePerHour`
  today, now per tier);
- the throughput cap is `250 x 1.25^(n-1)`, rounded, so the best setting stays reachable;
- the upgrade **to** tier `n` costs `40,000 x 1.5^(n-2)`;
- upgrading needs the yard idle (no cycle running) and takes it offline for `6 x (n - 1)` hours, during which no
  cycle can start;
- `operations.costPerThroughputUnit` (16), the 600 floor, the startup rule and the yard upkeep (AB#2284, 41.67 an
  hour for yards after the first) do not change with tier;
- each upgrade adds 70% of its cost to the yard's book value, the same share the Refinery Complex uses
  (buildings.md).

The model's assumptions, as `npm run economy:model`: Earth Silicates at 24, 8% tax, no research, expected uptime
81.6% (costs and revenue both pause while down). "Float" is one expected day of running cost at the best setting.

| tier | T_ref | cap (t/h) | best T | profit/h | cost/h at best | expected profit/day | float/day | upgrade cost | offline | gain/day | payback |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 420 | 250 | 146 | 606 | 2,618 | 11,868 | 51,271 | - | - | - | - |
| 2 | 525 | 313 | 182 | 757 | 3,262 | 14,825 | 63,883 | 40,000 | 6 h | 2,957 | 14.5 days |
| 3 | 656 | 391 | 232 | 947 | 4,176 | 18,546 | 81,783 | 60,000 | 12 h | 3,721 | 18.1 days |
| 4 | 820 | 488 | 288 | 1,183 | 5,176 | 23,168 | 101,367 | 90,000 | 18 h | 4,622 | 22.5 days |
| 5 | 1,025 | 610 | 361 | 1,479 | 6,492 | 28,965 | 127,139 | 135,000 | 24 h | 5,797 | 27.3 days |

Tiers 4 and 5 are computed from `T_ref` as rounded in the table (820 and 1,025), which is what `data/economy.json` holds; the first version of this table used the unrounded values for those two rows (AB#793 corrected them). "Payback" is (upgrade cost + the previous tier's profit lost while offline) / gain per day. It lengthens at every
tier: a corporation that plans 30 days ahead takes a yard to tier 4 and has reason to stop before 5. That interior
optimum is what T-018 asks for.

### Build another, upgrade this one, or wait

Building instead of upgrading, from the same model:

- **a second yard on a lease with a free slot:** 50,000 for 11,868 - 816 (its upkeep) = **11,052 a day: 4.5 days**;
- **a new lease, its five hires and a yard:** Mars 25,000 + 10,000 + 50,000 = 85,000 for 11,868 - 816 - 750 (the
  five hires' payroll) = **10,302 a day: 8.3 days**.

Both pay back faster than any upgrade, so **while there is a slot, build**. Slots run out: only Earth, Mars and Luna
have lease terms (`data/systems.json`), at two yards per lease, so **six yards is the ceiling for the whole game**.
Past it, upgrading is the only way a corporation's extraction grows. Three cash positions, each checkable by hand
from the numbers above:

| position | the state | build | upgrade | best move | what decides it |
|---|---|---|---|---|---|
| **100,000** | Level 2, one tier-1 yard on Earth, one free slot | leaves 50,000; two yards need a float of 2 x 51,271 + 816 = 103,358 | leaves 60,000; a tier-2 yard needs 63,883 | **wait**: mine and sell; the build clears the float once credits reach 153,358, about 4.5 days at 11,868 a day | the float. The superlinear running cost means a bigger or hotter operation needs more cash than this corporation has |
| **500,000** | Level 3, two tier-1 yards filling Earth | Mars lease + hires + yard: 85,000, pays back in 8.3 days; leaves 415,000 against a three-yard float of 155,445 | 40,000, pays back in 14.5 days | **build another** | payback. There is a slot, and a new yard earns more per credit than a tier |
| **2,000,000** | Level 6, six tier-1 yards filling Earth, Mars and Luna | impossible: no leasable body is left | all six to tier 2 costs 240,000 and leaves 1,760,000 against a float of 387,378; tiers 3 and 4 follow at 18.1 and 22.5 days | **upgrade this one**, and the next, up to the tier the horizon pays for | the slot ceiling. Upgrading is the only growth left, and the lengthening payback says where to stop |

### The rule a sensible corporation follows (for the probe)

At each decision point, in order:

1. If what is left after the move would be less than one day's float for all its yards, **wait**.
2. Otherwise, if a yard can be built (a lease with a free slot, or a leasable body not yet leased and a free
   corporation slot), **build** the cheapest.
3. Otherwise, if a yard is below `maxUpgradeTier` and its next tier's payback is inside the planning horizon (30
   days here), **upgrade** the lowest-tier idle yard.
4. Otherwise **wait**.

### The probe target (a bot number, P-PROXY)

A headless test bot that **always upgrades first** (step 3 before step 2) must end **day 7 with at least 10% fewer
credits** than a bot following the rule above, from the same start and seed. That is the check that the numbers
contain the decision. The implementation's probe (AB#793) quotes both numbers and labels them bot numbers: they
measure a policy against these prices, not what a player does.

Two cautions for whoever builds it. **Both bots may end near zero credits.** Today's planner and greedy bots end at
0.00x-0.02x banked/spent (ECONOMY.md), and 10% of nearly nothing tests nothing. So the probe also reports each bot's
net cash generated over the 7 days (earned - spent), and the target is read on that when the credit balances are
both under 10,000. **The seed does not vary a run yet** (AB#2292), so one run is one run however many seeds are
named.

## Refinery: three tiers

A Refinery has no running cost. Its limits are input (ore it has mined or bought) and demand (its outputs have no
NPC buyer, DEPTH.md). So a tier cannot trade output against cost the way the yard's does, and it does not pretend
to. The decision it gives is **whether this corporation has the ore and the buyer for more refined goods**, not
arithmetic. Tier 2 is the **Refinery Complex** already proposed in buildings.md, not a new idea:

| tier | output per cycle | upgrade cost | book value added | offline | gate |
|---|---|---|---|---|---|
| 1 | `quantityPerCycle` (x1) | - | - | - | the Refinery's own research |
| 2 (Refinery Complex) | x1.5 | 100,000 | 70,000 | 4 h | tt-nano-lattice (buildings.md) |
| 3 | x2.0 | 150,000 | 105,000 | 8 h | tt-nano-lattice |

Input per cycle and cycle length do not change, so a tier is more output from the same ore. That is only worth
buying with a buyer for the output, which is the point.

## Assembly Facility: two tiers

It fabricates mining probes, 30 minutes each (`PROBE_FABRICATION_MS`), at 8,000 each
(`probes.buildCost`).

| tier | fabrication time per probe | upgrade cost | book value added | offline |
|---|---|---|---|---|
| 1 | 30 min | - | - | - |
| 2 | 15 min | 30,000 | 21,000 | 2 h |

Worth it only to a corporation whose expeditions wait on probes. The probe price does not change.

## Buildings not covered

- **Headquarters** is not a catalogue building (buildings.md) and has no tiers.
- **Ferric Mining Complex** and **Cryo-vapor Extractor Array** (AB#788) are designed but not in the catalogue. Each
  gets its tiers in the story that adds it. An extraction building follows the yard's pattern (tier raises the cost
  curve's reference and cap; price x1.5 a tier, gain x1.25), so the same three pulls keep the decision.

## maxUpgradeTier by corporation level

`unlocks.maxUpgradeTier` in `data/milestones.json` is the highest tier any building of the corporation may reach.
It is set for the ten levels that exist; levels past 10 belong to the ladder design (v0.6-14).

| level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| maxUpgradeTier | 1 | 2 | 2 | 3 | 3 | 4 | 4 | 5 | 5 | 5 |

A building type's own last tier still applies, so a Level 8 Assembly Facility stops at 2. At Level 1 no building
can be upgraded, so a new corporation's first session reads exactly as ECONOMY.md's model says it does today.

## Credits only (T-021)

Upgrades are bought with in-game credits and time, and nothing else. **Nothing in this design sells a tier, an
upgrade, a shorter offline period or a higher `maxUpgradeTier` for money**, now or as a later option. The same line
BRIEF.md draws for research and insight (Board decision AB#980: never sellable) applies to tiers.

## For the implementation

- `data/player-buildings.json`: each catalogue entry gains `tiers`, a list of `{ tier, upgradeCost, assetValue,
  offlineHours, effect }`. `effect` holds what the tier sets (`throughputReferencePerHour` and `throughputCap` for a
  yard, `outputMultiplier` for a refinery, `fabricationMs` for an assembly facility).
- `data/milestones.json`: `unlocks.maxUpgradeTier` per level, as the table above.
- The upgrade route (AB#793) takes a building id (AB#792's `bld-` ids) and computes every cost, effect and limit on
  the server from these two files.
