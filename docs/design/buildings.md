# The player building catalogue (ISP-92, AB#782)

v0.6's plan line is "Full buildable building catalogue (all types currently designed)" (DEVELOPMENT_PHASES.md:98).
This is the list of those types and the one data shape they share. It changes no code. AB#783 (ISP-93) moves the
three buildings that exist into the shape; later v0.6 stories add the rest. Read against ISP main `d1401f3`,
2026-09-25. Nothing here decides what the Board owns; the figures marked *proposed* are for the Board, or the PM with
ECONOMY.md, to accept or change.

## Every player building type found

A player building is one a corporation builds or owns: an entry in `corp.buildings`. The 17 station buildings in
`data/buildings.json` belong to the station (`owner: "npc"`) and are not in this list.

| Type | Where it was found | Status at v0.6 |
|---|---|---|
| Basic Extractor Yard | server/routes/mining.js:17 (build route), :62; data/economy.json:10-12; data/milestones.json:20, 46, 63; server/game/progression.js:38 | Built; in the catalogue |
| Assembly Facility | server/routes/asteroids.js:15 (build route), :45; data/economy.json:13-14; data/milestones.json:77; progression.js:38 | Built; in the catalogue |
| Refinery | server/routes/refining.js:14 (build route), :48; data/economy.json:15-16; data/milestones.json:104; progression.js:38 | Built; in the catalogue |
| Headquarters | server/game/corporation.js:30 (every new corporation); server/game/world.js:40 (dev seed) | Not a building yet |
| Refinery Annex | server/game/world.js:42 (dev seed); DEVELOPMENT_PHASES.md:45 | The Refinery's old name; not a separate type |
| Ferric Mining Complex | data/player-buildings.json; server/game/asteroids.js (`ferricBonus`); data/economy.json (price, multiplier) | Built (ISP-96, AB#786); in the catalogue |
| Refinery Complex | data/milestones.json:170; chrome.js:149; DESIGN_DOCUMENT.md:385 | Designed only; proposed below |
| Cryo-vapor Extractor Array | data/milestones.json:177; chrome.js:153; DESIGN_DOCUMENT.md:387 (as "Cryo-Vapor research, Luna lease") | Designed only; proposed below |

## The three that exist

**Slots.** A corporation slot is one of `corp.buildingSlots` (2 at Level 1, 12 at Level 10; data/milestones.json
unlocks). Every build checks `corp.buildings.length >= corp.buildingSlots` (server/routes/mining.js:44,
asteroids.js:34, refining.js:37). A lease slot is one of a mining lease's own `buildingSlots`, checked at
mining.js:38.

**Basic Extractor Yard** (`basic-extractor-yard`)
- **Cost:** 50,000, or 47,000 with tt-supply-forecast (data/economy.json:11 and :17; server/economy.js:92; mining.js:28).
- **Asset value:** 36,000 (economy.json:12).
- **Slots:** one corporation slot and one slot on the lease it stands on (mining.js:44, :38).
- **Research gate:** none. tt-supply-forecast is a discount, not a gate.
- **Cap:** as many as there are free slots on both counts.
- **What it does:** adds an extractor to `corp.mining.silicateExtractors` (mining.js:57-63). Its cycles add Silicates to the station's inventory in `applyMiningOperations` (server/game/mining.js:230, :335).
- **Route:** `POST /api/accounts/:accountId/gameplay/lease/:leaseId/build-extractor`.

**Assembly Facility** (`assembly-facility`)
- **Cost:** 60,000 (economy.json:13).
- **Asset value:** 40,000 (economy.json:14).
- **Slots:** one corporation slot (asteroids.js:34).
- **Research gate:** tt-assembly-fabrication (asteroids.js:23).
- **Cap:** 1 per corporation (asteroids.js:28, outcome `already-built`).
- **What it does:** lets the corporation fabricate mining probes; `build-mining-probe` refuses without one (asteroids.js:73, :86, outcome `no-assembly`).
- **Route:** `POST /api/accounts/:accountId/gameplay/build-assembly-facility`.

**Refinery** (`refinery`)
- **Cost:** 75,000 (economy.json:15).
- **Asset value:** 55,000 (economy.json:16).
- **Slots:** one corporation slot (refining.js:37).
- **Research gate:** tt-material-compression and tt-nano-lattice, both (refining.js:24).
- **Cap:** 2 per corporation (refining.js:30, `MAX_REFINERIES`).
- **What it does:** adds an entry to `corp.refineries` (refining.js:52). Its cycles turn raw resources into the products in data/refinery-chains.json (server/game/refining.js:80).
- **Route:** `POST /api/accounts/:accountId/gameplay/build-refinery`.

**Where the numbers live, since AB#783.**
- **Catalogue:** data/player-buildings.json holds the three, and server/playerBuildings.js loads it.
- **Prices:** still in data/economy.json's `buildings` block, named by each entry's `price`.
- **One build route (ISP-94, AB#784):** `POST /api/accounts/:accountId/gameplay/build` with `{ buildingId, leaseId? }`. server/construction.js checks the lease, the catalogue's research gates and cap (`catalogueRefusal`), the lease's slots, a corporation slot and the price, then builds. The three old routes are that handler with the building fixed. A catalogue entry needs an entry in `CONSTRUCTIONS` (what it adds, its notification and receipt) or it is refused: a building added to the file is data plus that one entry, not a new route.
- **Construction panel (ISP-95, AB#785):** the Station lists every catalogue entry with Build or its first unmet condition (public/scripts/constructionPanel.js), so a building added to the file appears there with no client change.
- **`PLAYER_BUILDINGS`:** the catalogue's names (progression.js).
- **Schema test:** tests/schema/player-buildings.test.js fails on a research id or a milestone building that the files do not share (T-019).

## Not a building yet (P-INERT-FEATURE)

**Headquarters.**
- Every corporation starts with it (corporation.js:30), and no route builds it. Nothing reads it: no code tests for a building named Headquarters.
- Its one consequence is that it counts in `corp.buildings.length`, so it takes one of the two slots a new corporation has.
- It stays in corporation state, unchanged, and out of the catalogue. AB#783 must not change behaviour, and dropping it would free a slot.
- Whether it should do something (for example hold the base slot count), or stop taking a slot, is the Board's call. It is not settled here.

## Refinery, Refinery Annex, Refinery Complex

- **Refinery** is the building v0.3 shipped: the `build-refinery` route, `corp.refineries` and the refinery chains.
- **Refinery Annex is the same building under its v0.3 name.** DEVELOPMENT_PHASES.md:45 ticks "Refinery Annex building and operational controls" for the feature that is now the Refinery. The name survives in one place: the dev seed, as `{ name: "Refinery Annex", status: "Constructing" }` (world.js:42). That entry has no `corp.refineries` record and nothing reads it. It goes when AB#737 removes the legacy seed; until then the catalogue does not list it.
- **Refinery Complex is distinct: an upgrade of a Refinery, not a second building beside it.** It is the "Multi-Stage Refinery" step of the old level 7 (DESIGN_DOCUMENT.md:385). It fits v0.6's own "Building upgrade (tier) system" (DEVELOPMENT_PHASES.md:99) as the Refinery's tier 2. Proposed below.

## The three designed buildings: proposed effects

Each proposal below uses only what v0.6 has:
- the resources that lease extractors and asteroid expeditions produce (Silicates from extractors, mining.js:335; belt yields including Nickel, Titanium, Water Ice and Helium-3, server/game/asteroids.js:17-22);
- the refinery chains in data/refinery-chains.json;
- the Luna lease (data/systems.json:19);
- research ids that exist in data/research.json.

Every cost and asset value in this section is *proposed*. Asset value is about 0.7 of cost, as it is for the three
that exist (0.72, 0.67 and 0.73).

**Ferric Mining Complex** (`ferric-mining-complex`)
- **What it does:** probes bring back more metal. When an expedition returns, the Nickel and Titanium it deposits are multiplied by 1.25 before they reach the station's inventory (server/game/asteroids.js:204-205). Those are the inputs to the nickel and titanium refinery chains.
- **Cost / asset value:** 90,000 / 65,000.
- **Slots:** one corporation slot.
- **Research gate:** tt-material-compression ("Unlocks Nickel refining").
- **Cap:** 1 per corporation.
- **Why not raw ferric extraction on a lease:** iron is not a resource at v0.6. Raw metal extraction is v0.8's "Nickel-Iron Rally" (DEVELOPMENT_PHASES.md:115), so this deliberately leaves extraction to v0.8.

**Refinery Complex** (`refinery-complex`, an upgrade of one Refinery)
- **What it does:** turns one Refinery into a complex. Its per-cycle output is 1.5 times `quantityPerCycle` (the `produced` line at server/game/refining.js:80), and the refinery entry records `tier: 2`.
- **Cost / asset value:** 100,000 / 70,000.
- **Slots:** none. It upgrades a Refinery in place.
- **Research gate:** tt-nano-lattice, the tier-3 node the Refinery already needs.
- **Cap:** one per Refinery, so at most 2 per corporation.

**Cryo-vapor Extractor Array** (`cryo-vapor-extractor-array`, Luna only)
- **What it does:** built on a Luna lease, it makes that lease's extractor cycles also yield 1 t of Helium-3 for every 50 t of Silicates mined. The Helium-3 is added to the station's inventory beside the Silicates (mining.js:335). That opens the Helium-3 chain (tier 3) without deep-star expeditions.
- **Cost / asset value:** 80,000 / 58,000.
- **Slots:** one slot on the Luna lease and one corporation slot, like an extractor.
- **Research gate:** tt-containment-physics ("Unlocks Helium-3 refinery chain").
- **Cap:** 1 per Luna lease.
- **Overlap with v0.8, a question for the PM:** v0.8 plans "Helium-3 and Deuterium extraction" (DEVELOPMENT_PHASES.md:114). If Helium-3 from Luna belongs to v0.8, the fallback effect is Luna extractor throughput +20% (cryogenic cooling of the extractors). That uses nothing new.

**How this fits AB#424's levels 6 to 10.** AB#424 kept levels 6 to 10 and rewrote them against what exists:
- level 6: Assembly Facility;
- level 7: asteroid prospecting;
- level 8: tt-material-compression and a Refinery;
- level 9: tt-nano-lattice, refined units and the Luna lease;
- level 10: Proxima navigation and volume.

None of them names these three buildings, and this design does not put them back. Doing that would lock those levels again until the buildings exist, which reverses AB#424. Each proposal instead becomes buildable at the level where its research and lease already fall:
- the Ferric Mining Complex after level 8's tt-material-compression;
- the Refinery Complex after level 9's tt-nano-lattice and first Refinery;
- the Cryo-vapor Array after level 9's Luna lease.

Levels 11 to 40, which v0.6 also plans (DEVELOPMENT_PHASES.md:100, AB#798), are where a level could name them.

**Drift this found, already owned by AB#798.** The sidebar's roadmap still lists "Build a Ferric Mining Complex",
"Build a Refinery Complex" and "Build a Cryo-vapor Extractor Array" as open steps:
- data/milestones.json:167, 170 and 177;
- public/scripts/views/chrome.js:148-153, rendered at :118.

No level requires them since AB#424, so those lines stay Open for ever. AB#798 (ISP-106, Proposed) derives the roadmap from the level definitions, which removes them. DESIGN_DOCUMENT.md:384-387 has the same old table.

## The data shape: a separate `data/player-buildings.json`

**Decision: a separate file, not `owner: "player"` entries in data/buildings.json.**

**Why:**
- **Different readers.** data/buildings.json is the station's catalogue: stations resolve their `buildingIds` against it, and the station view renders it (public/scripts/html.js:131). The only thing telling player and station entries apart would be a filter every reader must remember. One reader already filters on `owner`; the others would not, and a player building would appear inside a station.
- **Different fields.** Station entries carry faction, factionCode, imageFile, action and flavour. Player entries carry cost, asset value, slot, research gate, cap and effect. One file means one schema where every field is optional. Two files let the schema test require every field of each.
- **One source for each number.** A building's price stays in data/economy.json, and its catalogue entry names it by `price`. *Amended by AB#783:* this document first had the catalogue take the prices over. Building that showed economy.json is deliberately the one file the balance pass edits (AB#726). ECONOMY.md explains every key in it, the economy model reads it, and `tests/unit/economyModel.test.js` holds the two together. Moving six prices out would have split the balance pass across two files for no gain. One home per number holds either way.

**Fields:**
- `id`: kebab-case, used in data and code.
- `name`: the string already stored in saved games' `corp.buildings`, so no migration is needed.
- `price`: the stem of its two keys in data/economy.json's `buildings`. For example, `"extractorYard"` names `extractorYardCost` and `extractorYardAssetValue`. The loaded entry (server/playerBuildings.js) carries them as `cost` and `assetValue`, and so does the copy served in `/api/bootstrap`.
- `slot`: `"corporation"`, `"corporation+lease"` or `"upgrade"`.
- `researchGates`: ids in data/research.json, all required.
- `cap`: `perCorporation`, or for a lease building `perLease` (with `lease` for one lease only, such as `"luna"`), or for an upgrade `perBuilding`.
- `upgrades`: for an upgrade, the id of the building it upgrades.
- `effect`: one sentence naming the state it changes.
- `since`: the version it arrived.

A building's effect stays in code: the catalogue describes it for the player and the tests, and does not drive it.

**Example**, the three that exist, as AB#783 wrote them in data/player-buildings.json:

```json
{
  "buildings": [
    {
      "id": "basic-extractor-yard",
      "name": "Basic Extractor Yard",
      "price": "extractorYard",
      "slot": "corporation+lease",
      "researchGates": [],
      "cap": {},
      "effect": "Adds a silicate extractor to the lease it stands on; its cycles add Silicates to the station's inventory.",
      "since": "0.1"
    },
    {
      "id": "assembly-facility",
      "name": "Assembly Facility",
      "price": "assemblyFacility",
      "slot": "corporation",
      "researchGates": ["tt-assembly-fabrication"],
      "cap": { "perCorporation": 1 },
      "effect": "Lets the corporation fabricate mining probes.",
      "since": "0.3"
    },
    {
      "id": "refinery",
      "name": "Refinery",
      "price": "refinery",
      "slot": "corporation",
      "researchGates": ["tt-material-compression", "tt-nano-lattice"],
      "cap": { "perCorporation": 2 },
      "effect": "Runs a refinery chain, turning raw resources at a station into refined products each cycle.",
      "since": "0.3"
    }
  ]
}
```

The proposed buildings are added in the same shape when a story builds each one. For example, the Refinery Complex
would be `"slot": "upgrade", "upgrades": "refinery", "cap": { "perBuilding": 1 }`. None is added before its effect
exists, so the catalogue never lists a building that does nothing.

## Out of scope: found, and belonging to a later version

- **Orbital shipyard:** v0.10 (DEVELOPMENT_PHASES.md:134; DESIGN_DOCUMENT.md:440; a card in kanban/kanbanState.json:71).
- **"Attack and defense troop building":** v0.10 (DEVELOPMENT_PHASES.md:135). This means building troops, not a building type.
- **Buildings v0.8 may bring** with Nickel-Iron smelting, Helium-3 and Deuterium extraction, and off-world mining on bodies (DEVELOPMENT_PHASES.md:114-118): v0.8.
- **The building upgrade (tier) system in general** (DEVELOPMENT_PHASES.md:99): v0.6, but its own story. The Refinery Complex is proposed as its first case, not as the system.
- **Orbital Executive Suites:** not a player building. It is the office a corporation rents (`corp.offices`), not an entry in `corp.buildings`.
- **The 17 station buildings** in data/buildings.json: station-owned. Unchanged.
