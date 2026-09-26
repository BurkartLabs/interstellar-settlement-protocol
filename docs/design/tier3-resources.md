# The v0.8 resource catalogue: tiers, items and where they come from (AB#822)

v0.8 is "Energy and Metals" (DEVELOPMENT_PHASES.md:112), four tracks: **Helium-3 and Deuterium**, the **Nickel-Iron
Rally**, **Rare Metals** and **Light Metals**. Its heading says "(Tier 3 Resources)", and LORE.md's own tier table
disagrees with that and with the build. Every later v0.8 story names items, so this fixes what a tier is, every raw
item the four tracks need, and where each comes from, before any of them is built. It is a design: nothing here is in
`data/` yet, and **no price, rate or quantity is set here**. Those belong to the stories that build each track and to
ECONOMY.md.

## 1. What a tier is

A tier says **how hard an item is to get**, not whether it has been processed:

| Tier | Meaning | Where it comes from |
| --- | --- | --- |
| **Tier 1, common raw** | Extracted directly; available in Sol | Leases on Sol bodies, Sol's belt, and belts past Sol |
| **Tier 2, scarce raw** | Extracted directly; not in Sol, or only in trace amounts | Belts past Sol (weighted by the system's rarity), and a few bodies in rare and exotic systems |
| **Tier 3, refined** | Made, never mined | Refinery chains (data/refinery-chains.json), from Tier 1 and Tier 2 inputs |

So **v0.8 does not add Tier 3 raw resources**: there is no such thing. It adds four production tracks. Three new raw
items, all Tier 1, and the Tier 3 products its chains make (those are the chain stories' to name).

### Where this disagrees with LORE.md, and how each is resolved

| # | LORE.md says | The build | Resolution |
| --- | --- | --- | --- |
| 1 | Tier 2 is "Processed": Titanium, Rare Earths, Lithium, Cobalt, Thorium, Uranium | All six are mined raw from belts (data/systems.json `composition`) and none is made by a chain | Tier 2 means **scarce raw**. LORE.md's heading "Tier 2 (Processed)" becomes "Tier 2 (Scarce)". **Proposed LORE edit, for the PM** |
| 2 | Exotic Matter is Tier 3, "Synthetic / Exotic" | Exotic Matter is mined raw from Epsilon Eridani's belt (8%) | Exotic Matter is **Tier 2**, found only in exotic-rarity belts. It leaves LORE's Tier 3 row. **Proposed LORE edit** |
| 3 | Tier 3 is Aerogel, Quantum Insulators, Plasma Conduits, Dark-Matter Capacitors, Exotic Matter | The chains make twelve products: those four and Structural Alloys, Magnetic Cores, Armour Plating, Precision Frames, Carbon Fibre Sheets, Graphene Lattice, Sensor Arrays, Catalyst Substrates | Tier 3 is **every chain output**. LORE's row names examples, not the list. **Proposed LORE edit: "for example"** |
| 4 | Helium-3 is Tier 1, and Jupiter's needs "advanced tech" | Helium-3 comes only from four belts past Sol (Tau Ceti, Epsilon Eridani, Sirius, Ross 248), which makes it effectively Tier 2 | LORE wins: **Helium-3 is Tier 1**, and v0.8 gives it Sol sources (Luna's regolith on a lease, and the gas giants behind research, section 3) |
| 5 | Earth: "No extraction rights" | Earth has a lease (20,000) and is the starting kit's lease | The build wins: the first hour and the starting-kit rulings (AB#2287) stand on it. **Proposed LORE edit**: Earth's note becomes "Silicate leases only; the regulatory centre of gravity" |
| 6 | DEVELOPMENT_PHASES.md: "Version 0.8 — Energy and Metals (Tier 3 Resources)" | Nothing in v0.8 is a Tier 3 raw resource | **Proposed plan edit**: the heading drops "(Tier 3 Resources)" |

The LORE and plan edits are proposals, not made here: LORE.md is the setting's voice, and the plan is the PM's.

## 2. The raw items the four tracks need

Names are the build's exact item names, which are the keys of inventories, listings, bids and quotas, so existing
names are **kept as they are**. An id is the name in kebab case. **New** marks an item that exists nowhere in the build.

### Helium-3 and Deuterium (fusion fuel)

| id | Name | Tier | New? | Sources |
| --- | --- | --- | --- | --- |
| `helium-3` | Helium-3 | 1 | no | **Luna** (regolith, on a lease; LORE and buildings.md's deferred Luna Helium-3); **gas giants** (bands surface: Jupiter, Saturn, wf-garnet, tc-lumen, ee-orion, la-c, lc-c), skimmed, behind research; belts: tc-cloud, ee-crown, si-disk, r248-halo |
| `deuterium` | Deuterium | 1 | **yes** | **Ice worlds and ice moons** (ice surface: Europa, Enceladus, Ganymede, Callisto, ac-haven, wf-halo, tc-aqua, si-anchorage, r248-i, r248-rime), from the heavy water in their ice; **ice giants** Uranus and Neptune; belt: r248-halo (ice-rich) |
| `water-ice` | Water Ice | 1 | no | Feedstock for Deuterium. Belts: Sol's belt, la-drift, r248-halo; ice worlds and moons |
| `hydrogen` | Hydrogen | 1 | no | Feedstock and by-product of skimming. Gas and ice giants; belts: ac-belt, bn-rift, r154-ring, r248-halo |

### The Nickel-Iron Rally (raw metal, smelting, alloys)

| id | Name | Tier | New? | Sources |
| --- | --- | --- | --- | --- |
| `nickel` | Nickel | 1 | no | All 12 belts; crater and lava planets (section 3) |
| `iron-ore` | Iron Ore | 1 | **yes** | **Crater and lava planets**: Mercury, Mars, bn-iron ("Ironwell"), bn-cinder, ee-kestrel, lc-b, la-b, ac-ii, r154-i, l726-i; crater moons (Phobos, Deimos, bn-arc, r154-ember); not in belts at v0.8 (section 4) |

### Rare Metals (rare earths, thorium, cobalt)

| id | Name | Tier | New? | Sources |
| --- | --- | --- | --- | --- |
| `rare-earths` | Rare Earths | 2 | no | Belts: wf-shards, tc-cloud, ee-crown, si-disk, l726-belt, lc-reef |
| `thorium` | Thorium | 2 | no | Belts: wf-shards, tc-cloud, ee-crown, l726-belt, lc-reef; **lava planets and moons in rare and exotic systems** (l726-i, ee-lyra) |
| `cobalt` | Cobalt | 2 | no | Belts: bn-rift, wf-shards, tc-cloud, ee-crown, la-drift, l726-belt, lc-reef |
| `uranium` | Uranium | 2 | no | Belts: tc-cloud, ee-crown, l726-belt. Not a Rare Metals input; listed because it sits beside Thorium in every belt that has it |

### Light Metals (lithium, aluminium composites)

| id | Name | Tier | New? | Sources |
| --- | --- | --- | --- | --- |
| `lithium` | Lithium | 2 | no | Belts: ac-belt, wf-shards, tc-cloud, ee-crown, r154-ring, si-disk, r248-halo, l726-belt |
| `bauxite` | Bauxite | 1 | **yes** | Aluminium's ore. **Luna** (the lunar highlands are aluminium-rich anorthosite); **clouds planets and moons** (weathered crust: Venus, ac-prime, tc-verde, si-ia, wf-veil); crater moons at a low share |

"Aluminium composites" are Tier 3, the Light Metals chain's output, and the chain story names them.

### Not a v0.8 input, kept as they are

Silicates, Carbon and Titanium (Tier 1, 1 and 2) and Exotic Matter (Tier 2) are in the build and no v0.8 track needs
them as a raw input. Their names, sources and bids do not change.

## 3. Resource profiles

A profile is what an extraction on a body yields, as shares of 100, the way a belt's `composition` already reads.

### Every body that yields anything today

| Body | Yields today | v0.8 profile |
| --- | --- | --- |
| Earth (lease) | Silicates | **Silicates 100, unchanged.** The starting kit's lease is not rebalanced by a resource version |
| Mars (lease) | Silicates | Silicates 60, Iron Ore 30, Bauxite 10 |
| Luna (lease) | Silicates | Silicates 60, Helium-3 25, Bauxite 15 |
| The 12 belts | their `composition` | **Unchanged** (section 4) |

Mars and Luna gain their v0.8 items only once the track that uses them is built. Until then their profile stays
Silicates 100, so no player holds an item nothing buys.

### The rule for any other body (new bodies, and Sol's unsurveyed ones)

A body's profile comes from its **class**: its `type` and, beyond Sol, its `style.surface`. For Sol's photographed
bodies, which have no `style`, the class is given in the table below. Values are shares of 100.

| Class | Profile | Needs |
| --- | --- | --- |
| Crater planet | Silicates 45, Iron Ore 30, Nickel 15, Bauxite 10 | a lease |
| Lava planet or moon | Iron Ore 40, Silicates 25, Nickel 20, Cobalt 15 | a lease |
| Clouds planet or moon | Silicates 45, Bauxite 25, Carbon 15, Water Ice 15 | a lease |
| Ice world or ice moon | Water Ice 55, Deuterium 20, Hydrogen 15, Silicates 10 | a lease |
| Gas giant (bands) | Hydrogen 55, Helium-3 30, Deuterium 15 | a lease and skimming research (the Helium-3 track's) |
| Ice giant | Hydrogen 50, Deuterium 30, Water Ice 20 | a lease and skimming research |
| Crater moon | Silicates 50, Iron Ore 25, Bauxite 15, Carbon 10 | a lease |
| Field (belt) | its `composition` in data/systems.json | a scout and an expedition |

**Rarity:** a lava or crater planet (or lava moon) in a **rare or exotic** system (data/systems.json `rarity`) gives 10 of its Iron
Ore share to Thorium (lava) or Cobalt (crater). That is the only way a body yields a Tier 2 item, so Tier 2 stays a
reason to go far.

Sol's bodies without a `style`:

| Class | Sol bodies |
| --- | --- |
| Crater planet | Mercury |
| Clouds planet | Venus |
| Gas giant | Jupiter, Saturn |
| Ice giant | Uranus, Neptune |
| Ice moon | Europa, Ganymede, Callisto, Enceladus |
| Lava moon | Io |
| Crater moon | Phobos, Deimos |
| Clouds moon (Carbon in Bauxite's place: its haze is hydrocarbon) | Titan |

Earth, Mars and Luna keep the profiles in the table above, not the class rule.

## 4. Belts

The twelve belts' compositions are **unchanged by this design**: they are pinned by tests (tests/unit/systemsCatalog.test.js)
and they are what expedition yields are balanced on. The three new items come from bodies, not belts, so v0.8's
extraction is a reason to hold leases in more places, and the belt loop keeps its own reasons.

AB#1050 makes a belt that runs out respawn with a random composition. When it lands, **the items a belt may draw are
this document's Tier 1 and Tier 2 items that already appear in some belt**, weighted by the system's rarity as that
design says, so a respawn never invents an item this catalogue does not list.

## 5. The Nickel-Iron Rally

**"Nickel-Iron Rally" is the plan's name for v0.8's metals track: the player extracts Iron Ore and Nickel, smelts them
into Nickel-Iron alloy at a smelter, and turns that alloy into the heavier Tier 3 products, as the metals push that
follows v0.7's expansion to twenty systems.** What the player does: leases a crater or lava world (Mars at first, then
Ironwell, Kestrel or Lacaille 9352 b), runs yards there for Iron Ore beside the Nickel their belts already give, and
feeds both to a smelter chain. A "rally" read as a timed server-wide event (a demand drive with a leaderboard) is
**not** what this design takes: nothing else in the plan's v0.8 lines is an event. That reading is flagged for the PM.

## 6. Items already in the build, and where

Every name below is kept exactly as it is. Places, from the data files on main:

| Item | Tier | Belt compositions | NPC bid (economy.json) | Mission quotas (missions.json) | Refinery chains |
| --- | --- | --- | --- | --- | --- |
| Silicates | 1 | 7 belts | yes | yes | silicates-chain input |
| Helium-3 | 1 | 11 belts | yes | yes | he3-chain input |
| Nickel | 1 | 18 belts | yes | yes | nickel-chain input |
| Carbon | 1 | 9 belts | yes | yes | carbon-chain input |
| Water Ice | 1 | 4 belts | | yes | |
| Hydrogen | 1 | 7 belts | | | |
| Titanium | 2 | 20 belts | yes | yes | titanium-chain input |
| Rare Earths | 2 | 16 belts | yes | yes | rare-earths-chain input |
| Lithium | 2 | 14 belts | | yes | |
| Cobalt | 2 | 13 belts | | yes | |
| Thorium | 2 | 10 belts | | yes | |
| Uranium | 2 | 8 belts | | | |
| Exotic Matter | 2 | 7 belts | | | |

The chains' twelve products (section 1, row 3) are Tier 3 and keep their names. Deuterium, Iron Ore and Bauxite appear
nowhere yet. tests/unit/tier3Resources.test.js holds this table to the data files, so a renamed or new raw item fails
it until this document names it. The belt counts are the 22 systems' since AB#807; sections 2 to 5 were written against the
first twelve belts, and their per-belt lists name those twelve only.

## 7. For the PM

- Three LORE.md edits and one plan heading (section 1, rows 1, 2, 3, 5 and 6), proposed, not made.
- The "rally" reading (section 5).
- Every number in sections 3 and 4 is **chosen, not derived**, and none has been modelled. The track stories that put
  a profile into `data/` model it first (ECONOMY.md's way), and may change the shares.
