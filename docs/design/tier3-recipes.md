# The v0.8 recipe graph: every chain, its inputs and outputs, and when refining pays (AB#823)

The v0.8 tracks (docs/design/tier3-resources.md, AB#822) need chains that take more than one input, and chains that
take other chains' products. Today's six chains in `data/refinery-chains.json` each turn one raw item into two products
that nothing buys. This design:

- generalises the chains to several inputs and several stages;
- adds thirteen chains, including four final products that need two or three tracks;
- gives every item in the graph an NPC bid;
- sets one rule so that refining beats selling raw **only sometimes**.

Prior art is EVE Online's Planetary Industry. Its P0 to P4 tiers each combine two or three products of the tier below
([EVE University, Planetary Commodities](https://wiki.eveuniversity.org/Planetary_Commodities)). Here that is a
**stage**: 1 is made from raw items only, and each later stage is one more than its deepest input.

It is a design. Nothing here is in `data/` yet, and every number is **chosen, not derived** (section 8). The stories
that build each track (AB#830 to AB#834) put it into data and model it first, as ECONOMY.md does.

## 1. The rule that sets every price

Refining is a decision only if the answer changes with prices (T-018). If every step adds value at every price, "refine
everything" is the only move. If no step does, the chains are decoration. One rule gives every chain the same shape:

> **At base prices, a cycle's outputs are worth 1.15 times its inputs.**

A product's base is `1.15 × (inputs per cycle at base) / (units out per cycle)`, rounded. A chain with two outputs
splits that value 60:40 between them. A bid's floor is `data/economy.json` `npcBid.floorPct` (55%) of its base,
rounded as `npcBidFor` rounds it. Each step then pays, per cycle at a tier-1 Refinery:

| Price state | Raw bids | Product bids | Outputs ÷ inputs | Better move |
| --- | --- | --- | --- | --- |
| Fresh | base | base | about 1.15 | refine |
| Raw glut | floor | base | about 2.0 to 2.3 | refine |
| Product glut | base | floor | about 0.63 | sell raw |

**Why 1.15.** The multiplier has to sit between 1 and `1 / (0.55 × 1.5) = 1.21`:

- Above 1, a free Refinery at fresh prices pays: its time is worth something.
- Below 1.21, even a Refinery Complex (1.5 times output) still does better selling raw when products sit at their
  floor. At 1.15, a Complex's cycle at the product floor returns `1.15 × 0.55 × 1.5 = 0.95` of the inputs' base.
- A tier-3 Refinery (2 times) returns 1.27 there, so for its owner refining always wins. That is flagged in section 8.
- It also has to stay below `npcAsks.askMultiple` (1.5, AB#815). Otherwise a corporation could buy inputs from an NPC
  ask, refine them and sell the outputs to an NPC bid at a profit, forever: a money pump. At 1.15, a tier-1 cycle
  bought at the ask returns `1.15 / 1.5 = 0.77`, and a Refinery Complex's returns 1.15. The Complex can only pump if
  its outputs sell at base while its inputs are bought at the ask. The ask stays at 1.5 times base while the bid falls
  as it is sold into, so the pump closes itself within the product's daily quota (section 4). New items' asks, where
  an NPC trades them, follow AB#815's rule from the bases below.

## 2. The graph

All chains run in a **Refinery**: no new building. A corporation has at most two Refineries (`player-buildings.json`
`cap.perCorporation`), so refinery hours are the scarce input, and "is a slot free" is half of every decision
(section 5). Inputs per cycle are debited together or not at all (AB#825). Tracks are **Fuel** (Helium-3 and
Deuterium), **Metals** (the Nickel-Iron Rally), **Rare** (Rare Metals) and **Light** (Light Metals). "Tracks drawn on"
follows every input back to its raw items.

| Chain | Track (story) | Stage | Inputs per cycle | Outputs per cycle | Cycle | Research | Building | Tracks drawn on |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `silicates-chain` | none | 1 | Silicates 100 | Aerogel 40, Quantum Insulators 15 | 4 h | `tt-material-compression`, `tt-nano-lattice` | Refinery | none |
| `he3-chain` | Fuel (AB#830) | 1 | Helium-3 50 | Plasma Conduits 20, Dark-Matter Capacitors 5 | 6 h | `tt-containment-physics`, `tt-exotic-energy-routing` | Refinery | Fuel |
| `nickel-chain` | Metals (AB#831) | 1 | Nickel 120 | Structural Alloys 60, Magnetic Cores 20 | 5 h | `tt-material-compression` | Refinery | Metals |
| `titanium-chain` | none | 1 | Titanium 80 | Armour Plating 30, Precision Frames 25 | 7 h | `tt-material-compression`, `tt-energy-routing` | Refinery | none |
| `carbon-chain` | none | 1 | Carbon 200 | Carbon Fibre Sheets 80, Graphene Lattice 30 | 4 h | `tt-nano-lattice` | Refinery | none |
| `rare-earths-chain` | Rare (AB#832) | 1 | Rare Earths 40 | Sensor Arrays 18, Catalyst Substrates 12 | 8 h | `tt-nano-lattice`, `tt-exotic-energy-routing` | Refinery | Rare |
| `fusion-fuel-chain` **new** | Fuel (AB#830) | 1 | Helium-3 40 + Deuterium 80 | Fusion Pellets 40 | 6 h | `tt-fusion-fuel-cycle` | Refinery | Fuel |
| `cryogenics-chain` **new** | Fuel (AB#830) | 1 | Water Ice 200 + Hydrogen 200 | Cryogenic Coolant 60 | 4 h | `tt-containment-physics` | Refinery | Fuel |
| `smelting-chain` **new** | Metals (AB#831) | 1 | Iron Ore 150 + Nickel 50 | Nickel-Iron Alloy 80 | 5 h | `tt-ferrous-metallurgy` | Refinery | Metals |
| `pressure-vessel-chain` **new** | Metals (AB#831) | 2 | Nickel-Iron Alloy 80 | Pressure Vessels 25 | 6 h | `tt-ferrous-metallurgy` | Refinery | Metals |
| `magnet-chain` **new** | Rare (AB#832) | 1 | Rare Earths 20 + Cobalt 40 | Rare-Earth Magnets 30 | 6 h | `tt-rare-metal-separation` | Refinery | Rare |
| `thorium-fuel-chain` **new** | Rare (AB#832) | 1 | Thorium 30 | Thorium Fuel Rods 10 | 8 h | `tt-rare-metal-separation`, `tt-containment-physics` | Refinery | Rare |
| `aluminium-chain` **new** | Light (AB#833) | 1 | Bauxite 200 | Aluminium Ingots 50 | 5 h | `tt-light-metal-electrolysis` | Refinery | Light |
| `al-li-chain` **new** | Light (AB#833) | 2 | Aluminium Ingots 40 + Lithium 20 | Aluminium-Lithium Alloy 40 | 6 h | `tt-light-metal-electrolysis` | Refinery | Light |
| `battery-chain` **new** | Light (AB#833) | 1 | Lithium 30 + Cobalt 10 | Battery Cells 30 | 6 h | `tt-light-metal-electrolysis` | Refinery | Rare + Light |
| `fusion-core-chain` **new** | Cross-track (AB#834) | 2 | Fusion Pellets 20 + Rare-Earth Magnets 10 + Cryogenic Coolant 20 | Fusion Reactor Cores 4 | 12 h | `tt-integrated-manufacturing` | Refinery | Fuel + Rare |
| `fission-module-chain` **new** | Cross-track (AB#834) | 3 | Thorium Fuel Rods 5 + Pressure Vessels 10 | Compact Fission Modules 5 | 10 h | `tt-integrated-manufacturing` | Refinery | Metals + Rare |
| `spaceframe-chain` **new** | Cross-track (AB#834) | 3 | Aluminium-Lithium Alloy 30 + Structural Alloys 20 | Lightweight Spaceframes 10 | 8 h | `tt-integrated-manufacturing` | Refinery | Metals + Light |
| `ion-thruster-chain` **new** | Cross-track (AB#834) | 2 | Rare-Earth Magnets 10 + Plasma Conduits 10 + Battery Cells 10 | Ion Thrusters 5 | 10 h | `tt-integrated-manufacturing` | Refinery | Fuel + Rare + Light |

**Where each input comes from.** Every input is one of two things:

- A **raw item from the catalogue** (tier3-resources.md, section 2): Helium-3, Deuterium, Water Ice, Hydrogen, Iron
  Ore, Nickel, Rare Earths, Thorium, Cobalt, Lithium and Bauxite. The six existing chains' Silicates, Titanium and
  Carbon are also catalogue items (its "not a v0.8 input" list), and no new chain uses them.
- An **output of another chain in this table**: Nickel-Iron Alloy, Aluminium Ingots, Aluminium-Lithium Alloy, Fusion
  Pellets, Cryogenic Coolant, Rare-Earth Magnets, Thorium Fuel Rods, Pressure Vessels, Battery Cells, and the existing
  Structural Alloys and Plasma Conduits.

Uranium and Exotic Matter feed nothing at v0.8.

**Cross-track.** Four final products need two or three tracks: Fusion Reactor Cores (Fuel + Rare), Compact Fission
Modules (Metals + Rare), Lightweight Spaceframes (Metals + Light) and Ion Thrusters (Fuel + Rare + Light). Battery
Cells draw on two tracks' raw items.

A cross-track chain is gated by `tt-integrated-manufacturing` **alone**, not by the research behind its inputs. A
corporation that never researched magnets can buy Rare-Earth Magnets from one that did, which is where the tracks
meet the BRIEF's second measure: orders filled by another player (AB#834).

**No chain makes a raw item.** Deuterium is mined only. Its "feedstock" in tier3-resources.md is the heavy water in an
ice world's ice, and that happens at extraction (the body's profile), not in a Refinery. That keeps Tier 3 to "made,
never mined".

## 3. Research

One new node per track, and one for the cross-track chains. Costs and durations sit beside their neighbours in
`data/research.json`.

| Node | Name | Tier | Needs | Cost | Hours | Unlocks |
| --- | --- | --- | --- | --- | --- | --- |
| `tt-fusion-fuel-cycle` | Fusion Fuel Cycle | 3 | `tt-containment-physics` | 12,000 | 16 | `fusion-fuel-chain`; gas-giant skimming (tier3-resources.md, section 3) |
| `tt-ferrous-metallurgy` | Ferrous Metallurgy | 2 | `tt-material-compression` | 8,000 | 10 | `smelting-chain`, `pressure-vessel-chain` |
| `tt-rare-metal-separation` | Rare-Metal Separation | 3 | `tt-nano-lattice` | 12,000 | 16 | `magnet-chain`, `thorium-fuel-chain` (with `tt-containment-physics`) |
| `tt-light-metal-electrolysis` | Light-Metal Electrolysis | 2 | `tt-material-compression` | 8,000 | 10 | `aluminium-chain`, `al-li-chain`, `battery-chain` |
| `tt-integrated-manufacturing` | Integrated Manufacturing | 4 | `tt-nano-lattice`, `tt-exotic-energy-routing` | 20,000 | 20 | the four cross-track chains |

`cryogenics-chain` needs only `tt-containment-physics`, which exists. The six existing chains keep their research.

## 4. NPC bids: base and floor

Every item in the graph gets a standing NPC bid that works like today's (`npcBidFor`). It starts each day at its
**base**, falls as the day's quota fills, never goes below its **floor**, and recovers 60% of the gap overnight.

### Raw items

The three new items, and the five existing raw items that have no bid today. Existing bids do not change.

| Item | Tier | Track | Bid today | Base | Floor |
| --- | --- | --- | --- | --- | --- |
| Helium-3 | 1 | Fuel | 92 | 92 | 51 |
| Deuterium | 1 | Fuel | none (**new item**) | 40 | 22 |
| Water Ice | 1 | Fuel | none | 8 | 4 |
| Hydrogen | 1 | Fuel | none | 6 | 3 |
| Iron Ore | 1 | Metals | none (**new item**) | 10 | 6 |
| Nickel | 1 | Metals | 18 | 18 | 10 |
| Rare Earths | 2 | Rare | 140 | 140 | 77 |
| Thorium | 2 | Rare | none | 160 | 88 |
| Cobalt | 2 | Rare | none | 110 | 61 |
| Lithium | 2 | Light | none | 70 | 39 |
| Bauxite | 1 | Light | none (**new item**) | 14 | 8 |

### Products

Every product, the twelve existing ones included: none has a buyer today, and DEPTH.md's fourth recommendation is
that no chain output be unsellable in a one-player world. The existing products' bids come from the same rule as the
new ones.

| Item | Made by | Stage | Feeds | Base | Floor |
| --- | --- | --- | --- | --- | --- |
| Aerogel | `silicates-chain` | 1 | sold | 41 | 23 |
| Quantum Insulators | `silicates-chain` | 1 | sold | 74 | 41 |
| Plasma Conduits | `he3-chain` | 1 | `ion-thruster-chain` | 159 | 87 |
| Dark-Matter Capacitors | `he3-chain` | 1 | sold | 423 | 233 |
| Structural Alloys | `nickel-chain` | 1 | `spaceframe-chain` | 25 | 14 |
| Magnetic Cores | `nickel-chain` | 1 | sold | 50 | 28 |
| Armour Plating | `titanium-chain` | 1 | sold | 118 | 65 |
| Precision Frames | `titanium-chain` | 1 | sold | 94 | 52 |
| Carbon Fibre Sheets | `carbon-chain` | 1 | sold | 21 | 12 |
| Graphene Lattice | `carbon-chain` | 1 | sold | 37 | 20 |
| Sensor Arrays | `rare-earths-chain` | 1 | sold | 215 | 118 |
| Catalyst Substrates | `rare-earths-chain` | 1 | sold | 215 | 118 |
| Fusion Pellets | `fusion-fuel-chain` | 1 | `fusion-core-chain` | 198 | 109 |
| Cryogenic Coolant | `cryogenics-chain` | 1 | `fusion-core-chain` | 54 | 30 |
| Nickel-Iron Alloy | `smelting-chain` | 1 | `pressure-vessel-chain` | 35 | 19 |
| Pressure Vessels | `pressure-vessel-chain` | 2 | `fission-module-chain` | 129 | 71 |
| Rare-Earth Magnets | `magnet-chain` | 1 | `fusion-core-chain`, `ion-thruster-chain` | 276 | 152 |
| Thorium Fuel Rods | `thorium-fuel-chain` | 1 | `fission-module-chain` | 552 | 304 |
| Aluminium Ingots | `aluminium-chain` | 1 | `al-li-chain` | 64 | 35 |
| Aluminium-Lithium Alloy | `al-li-chain` | 2 | `spaceframe-chain` | 114 | 63 |
| Battery Cells | `battery-chain` | 1 | `ion-thruster-chain` | 123 | 68 |
| Fusion Reactor Cores | `fusion-core-chain` | 2 | sold | 2243 | 1234 |
| Compact Fission Modules | `fission-module-chain` | 3 | sold | 932 | 513 |
| Lightweight Spaceframes | `spaceframe-chain` | 3 | sold | 451 | 248 |
| Ion Thrusters | `ion-thruster-chain` | 2 | sold | 1283 | 706 |

**A product's daily quota is what one Refinery makes of it in a day** at tier 1: `24 / cycle hours × units per cycle`,
rounded. For example, Nickel-Iron Alloy is `24 / 5 × 80 = 384` and Fusion Reactor Cores `24 / 12 × 4 = 8`.

Today's quota, 7,000 units a day, is sized for raw items. No refinery could fill it with a 4-unit product, so a product
bid would never move and the product-glut state could not happen in play. With a per-product quota, a corporation
running both Refineries on one product all day pushes its bid to the floor by its own selling. What to refine then
becomes a question too, not only whether to. Raw quotas stay at 7,000.

This needs `npcBidFor` to take a per-item quota (the track stories).

## 5. When refining beats selling raw

The two choices for a cycle's worth of raw items are to sell them to the NPC bid now, or to put them in a Refinery and
sell what comes out. A Refinery has no running cost (ECONOMY.md), so the choice is between two values:

> **Refine a cycle when a Refinery is idle and its outputs at their bids now are worth more than its inputs at their
> bids now.** Otherwise sell raw.

It applies at every stage, and an intermediate's value is its own bid: refine Nickel-Iron Alloy into Pressure Vessels
only if the vessels are worth more than the alloy would fetch. Here is the arithmetic at the **product floor** for two
chains.

**`smelting-chain`: 150 Iron Ore + 50 Nickel → 80 Nickel-Iron Alloy.**

- Inputs at base: `150 × 10 + 50 × 18 = 2,400`. Outputs at floor: `80 × 19 = 1,520`. **Sell raw**, by 880.
- Inputs at floor: `150 × 6 + 50 × 10 = 1,400`. Outputs at floor: 1,520. **Refine**, by 120.
- **The condition:** a Refinery is idle **and** `150 × (Iron Ore bid) + 50 × (Nickel bid)` is **below 1,520**.
  - With Iron Ore at its floor of 6, the Nickel bid must be 12 or less (base 18, floor 10).
  - With both bids at the same share of base, the share must be below 63%. At 50% drift at a full quota, that is
    about 5,100 of each item's 7,000 units sold that day.

**`magnet-chain`: 20 Rare Earths + 40 Cobalt → 30 Rare-Earth Magnets.**

- Inputs at base: `20 × 140 + 40 × 110 = 7,200`. Outputs at floor: `30 × 152 = 4,560`. **Sell raw**, by 2,640.
- Inputs at floor: `20 × 77 + 40 × 61 = 3,980`. Outputs at floor: 4,560. **Refine**, by 580.
- **The condition:** a Refinery is idle **and** `20 × (Rare Earths bid) + 40 × (Cobalt bid)` is **below 4,560**. With
  Rare Earths at its floor of 77, the Cobalt bid must be 75 or less (base 110, floor 61).

**The general form.** At the product floor, a tier-1 cycle beats selling raw exactly when its inputs fetch less than
`1.15 × 0.55 = 63%` of their base value. That lies between the raw floor (55%) and base (100%), so the condition can
happen and does not always hold. At the product's base, refining wins at any raw bid, because 1.15 is more than 1.

**The slot.** It binds when both Refineries are busy. The raw items then either sell now or wait for a slot, and a
fallen bid recovers 60% of its gap overnight. A corporation that mines more than two Refineries can take sells the
surplus raw under any policy.

## 6. The probe target for v0.8-14 (AB#835)

AB#835's bot runs a week of each track, starting from each of three price states:

- **Fresh:** every bid at its base.
- **Raw glut:** raw bids at their floor, product bids at base.
- **Product glut:** raw bids at base, product bids at their floor.

Within the week, bids drift and recover by the normal rules. Three policies play each state: "always sell raw",
"always refine to the end" (every stage the track has) and "the design's rule" (section 5). Each policy uses tier-1
Refineries and the two-Refinery cap.

**Target, a bot number (P-PROXY):**

- No single fixed policy has the most credits at the week's end in all three states.
- "Always refine to the end" beats "always sell raw" in Fresh and Raw glut, and loses to it in Product glut.
- The design's rule ends within 5% of the best policy in every state.

What this measures is whether the rule's arithmetic survives quotas, drift, cycle times and the slot cap. It does not
measure human pacing, player-to-player prices, or other sellers moving the bids.

Section 1's table predicts the per-step result by construction. The probe exists because a week of drift, quotas and
two slots is not per-step arithmetic.

## 7. What changes for the existing chains, and cycles already running

**The six existing chains keep their inputs, outputs, cycle length, research and category.** AB#825 changes their
schema from `input` with `inputQuantityPerCycle` to `inputs: [{ item, quantityPerCycle }]`, one entry each. Their
products gain an NPC bid (section 4), which is not a change of shape.

Their `tier` field (2 or 3) is not an item tier (tier3-resources.md) and no page reads it (`server/game/shape.js` and
`world.js` pass it on; nothing in `public/` uses it). AB#825 replaces it with this document's `stage`.

**Cycles already running when the change deploys** complete with the outputs they started with:

- **The rule:** from AB#825 on, `start-refinery` records the outputs it will deliver on the refinery (items and
  quantities, after batches and the refinery's tier), and completion delivers that record, not the chain as it stands.
- **A cycle started before the deploy** has no record. It completes from its chain, and because none of the six
  changes its outputs, that is what it would have delivered.
- **A missing chain:** today, a running cycle whose chain has disappeared is switched off and its debited inputs are
  lost (`applyRefineryOperations`). With the record it completes instead. No chain id is removed at v0.8.
- **No refunds or second debits:** inputs are debited once, at start, and a cycle never goes back to them.

**Run size.**

- A single-input chain keeps today's rule: whole batches, at least 100 units (`refineQuantity.js`).
- A multi-input run is chosen in batches, at least one.
- For every chain, `cycleScale` is capped at `floor(168 / cycle hours)`, so a run lasts at most a week: 42 batches of a
  4-hour chain, 14 of a 12-hour one. This is the cap AB#825's acceptance asks for. Today nothing bounds a run but the
  inventory, so the cap is new for the six chains too.

## 8. For the PM

- **Every number is chosen, not derived:** the 1.15 multiplier, the 60:40 split, the new raw bases, the quantities,
  cycle lengths and research costs. The track stories model their track first and may move them. The rule in section
  1 is the thing to keep: if a number moves, the product bases move with it.
- **A tier-3 Refinery (2 times output) makes refining always win** once products have a bid (section 1). Its
  multiplier was priced when refined goods had no buyer (ECONOMY.md). Either the probe also runs at tier 3 and the PM
  accepts "a tier-3 Refinery always refines" as the reward for 150,000, or the multiplier comes down to 1.5 or below.
- **Bids for six existing products with no track.** The silicates, titanium and carbon chains' six products (Aerogel,
  Quantum Insulators, Armour Plating, Precision Frames, Carbon Fibre Sheets, Graphene Lattice) belong to no track, so no
  story in AB#830 to AB#834 puts their bids into data. They need an owner: AB#834, or a story of their own. docs/design/npc-corporations.md already names buyers for six of
  the twelve.
- **The per-product quota** (section 4) changes `npcBidFor`'s signature. It is the only engine change here beyond
  AB#825's multi-input starts.
- `tests/unit/tier3Recipes.test.js` holds this document to itself and to `data/`. It checks:
  - every input resolves;
  - every base follows the rule;
  - each chain's three price states come out as section 1 says;
  - the six existing chains match `data/refinery-chains.json`;
  - at least one final product draws on two tracks.
