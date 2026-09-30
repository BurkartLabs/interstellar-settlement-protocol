# ISP v0.6 — Industrial expansion

Feature AB#390 (Proposed) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits: v0.6 on the ISP roadmap (DEVELOPMENT_PHASES.md in the product repo), under the product epic.
What it is for: Round out the build-and-upgrade loop and the milestone progression that drives the mid game. The player currently plateaus once leases and extractors are running; this is what gives them somewhere to put the money.
What it contains:
- Full buildable building catalogue (all designed types)
- Building upgrade tier system
- Full milestone roadmap for levels 11–40, wired to the level-up system
Each line becomes a story when this version is next. They are listed here rather than filed as work items so the backlog shows what is ready to be worked, not everything that has ever been planned (TRACKING.md).

## Acceptance

_To be written: the Feature had no acceptance criteria in Azure DevOps._

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 1 open, 30 resolved.

### ISP-110 Author levels 31 to 40 in the milestone data (Requirement AB#802, Active) (lane: interstellar-settlement-protocol/accounts)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), plan line "Full milestone roadmap (Levels 11–40)". What it is. Add levels 31 to 40 to data/milestones.json exactly as specified in docs/design/ladder-11-40.md, and make any stat writes those levels need through the bumpStat allowlist from AB#424. Why it matters. Ten levels is the most one session can author and verify against the ladder bot; the ladder is the goal horizon DEPTH scored 1/5. Estimate: 1 session, assuming the design is… (the rest: AB#802)

- [ ] Levels 31 to 40 are in the data and match the design document (a reviewer can diff the two).
- [ ] The ladder bot (v0.6-16) climbs to level 40 and the PR quotes its per-level numbers, labelled as bot numbers.
- [ ] The schema and cross-catalog tests pass: every research id, building, stat and unlock key used by these levels resolves.
- [ ] A corporation saved at level 10 before this change loads, is evaluated, and keeps every unlock it had (regression test).
- [ ] The year-pacing probe's check-in profile reaches level 40 between simulated day 330 and day 400, quoted in the PR as a bot number (not player time, P-PROXY); if it does not, the PR retunes the band's numbers, not the probe.
- [ ] Unblocked 2026-09-26 (Board answer, Decision AB#2324): every stat:silicateSoldOnExchange target here (Levels 32, 34, 36, 37 and 40) is redrawn as a production target, not a sales target - the Board's rule is that progress never waits on the market. Cite ECONOMY.md's new "Demand: the Board's rule (AB#2324)" section (AB#2375). Follow AB#2321's own method (90% of the curve at that level's simulated day, from a production-based rate at the shared quota, not a sales-based one) to pick the… (the rest: AB#802)

### ISP-92 Design the player building catalogue: every designed type, and one data shape for all of them (Requirement AB#782, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), plan line "Full buildable building catalogue (all types currently designed)". First story of the line; everything else in it builds on this document. What it is. The plan says "all types currently designed", but there is no list of them. Player buildings exist only as hardcoded endpoints in server/index.js (Basic Extractor Yard, Assembly Facility at $60,000, Refinery at $75,000, plus the starting Headquarters and a "Refinery Annex" in… (the rest: AB#782)

- [x] docs/design/buildings.md exists in the product repo and lists every player building type found in code, data or design docs, each with the file:line where it was found.
- [x] For each type it states: id, display name, cost, asset value, slot use (corporation slot or lease slot), research gate (a real id in data/research.json), per-corporation cap, and what it does in one sentence that names the state it changes. A type whose effect changes no behaviour is listed under "not a building yet" rather than included (P-INERT-FEATURE).
- [x] It resolves the Refinery / Refinery Annex / Refinery Complex naming: which are the same building, which are distinct, and why.
- [x] It proposes an effect for Ferric Mining Complex, Refinery Complex and Cryo-vapor Extractor Array that uses only resources and systems that exist at v0.6, and records how that fits whatever AB#424 decided for levels 6 to 10.
- [x] It fixes the data shape (either owner: "player" entries in data/buildings.json or a separate data/player-buildings.json) with a JSON example, and says which of the two and why.
- [x] An explicit "out of scope" list names anything found that belongs to a later version (for example the orbital shipyard, v0.10) so the catalogue can be checked as complete.

### ISP-93 Move the existing player buildings into a data catalog with a cross-catalog test (Requirement AB#783, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), building catalogue line; follows the design in v0.6-01. What it is. Put Headquarters, Basic Extractor Yard, Assembly Facility and Refinery into the catalog chosen by v0.6-01 and make the existing build routes read cost, asset value, cap and research gate from it instead of from constants inside each handler. Behaviour does not change. Why it matters. Costs live in four handlers today (P-TWO-SOURCES); a catalog is what lets the rest of… (the rest: AB#783)

- [x] The four buildings are catalog entries with the fields v0.6-01 specifies; grep finds no build cost literal (50000, 60000, 75000) left in the build handlers.
- [x] Existing tests pass unchanged, and a new test builds each of the four through its current route and asserts the same credits, assets, slot use and error messages as before the change.
- [x] A schema test fails if any catalog entry names a research id missing from data/research.json, or if any building: / building-count: metric in data/milestones.json names a building missing from the catalog (T-019).
- [x] The catalog is served read-only to the client (for example through /api/bootstrap or /api/buildings); it contains no player data.

### ISP-94 One catalog-driven build endpoint that every building uses (Requirement AB#784, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), building catalogue line. What it is. Add POST /api/accounts/:accountId/gameplay/build taking { buildingId, leaseId? }. It resolves the building in the catalog, checks research gate, cap, slot and credits, and applies the build inside one mutateAccountState. The four existing routes become thin wrappers so the client keeps working. Why it matters. Every later building in this line becomes data plus an effect, not a new hand-written… (the rest: AB#784)

- [x] Building each existing type through the new endpoint yields the same state as its old route; a test covers all four.
- [x] Each failure (unknown building, missing research, cap reached, no slot, lease full, insufficient credits) returns 400 with the specific message and leaves credits, buildings and slots untouched; a test asserts the account state is byte-identical before and after each rejection.
- [x] Security (DOCTRINE constraint 1): the route sits behind requireAuth and requireAccountAccess; it touches the caller's own corporation buildings, slots, credits and assets and nothing else; every id in the request is checked against the server catalog and every quantity is a bounded positive integer, so an unknown id, a negative, NaN, a float or an oversized number returns 400 with no state change (a test sends each); costs, effects and outcomes are computed on the server, never read from the… (the rest: AB#784)
- [x] Built buildings are persisted through the existing repository layer and survive a server restart (test with the in-memory store reloaded).

### ISP-95 Construction panel: every catalog building with its cost, gate and slot use (Requirement AB#785, Resolved, not verified) (lane: interstellar-settlement-protocol/client-shell)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), building catalogue line. The first visible piece of the line; the three new buildings (v0.6-05 to 07) appear here as they land. What it is. A panel (station or operations view, where v0.6-01 says it belongs, built on the ISP-25 design system if it has shipped) listing every catalog building: name, what it does, cost, slot use, and either a Build button or the exact reason it is locked ("requires Assembly & Fabrication Systems", "no free… (the rest: AB#785)

- [x] The panel renders one row per catalog entry, generated from the catalog (a test adds a fake entry to a fixture and sees a row for it).
- [x] A locked row states the first unmet gate in words; a buildable row's button calls /gameplay/build and the row and slot counter update without a reload.
- [x] A server rejection is shown as the server's message, not a generic failure.
- [x] Screenshot of the construction panel for a fresh corporation (most rows locked) and for a level 5 test corporation (several buildable) at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### ISP-96 Add the Ferric Mining Complex to the catalog with its effect (Requirement AB#786, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), building catalogue line. One of the three buildings data/milestones.json level 6 requires that exists nowhere today (AB#424). What it is. Add the Ferric Mining Complex as a catalog entry with the cost, gate and effect specified in docs/design/buildings.md (v0.6-01), and implement that effect in the server tick or build path. Why it matters. Level 6 names this building; until it exists the ladder is a promise the game cannot keep.… (the rest: AB#786)

- [x] The building is a catalog entry, buildable through /gameplay/build once its gate is met, and absent from no list that shows buildings.
- [x] The effect named in docs/design/buildings.md is observable in state: a test builds it, advances the tick, and asserts the specific field the design names has changed by the specified amount.
- [x] The building:Ferric Mining Complex metric in level 6 resolves to 1 after the build (test through resolveMetric).
- [x] Security (DOCTRINE constraint 1): the route sits behind requireAuth and requireAccountAccess; it touches the caller's buildings, slots and credits and nothing else; every id in the request is checked against the server catalog and every quantity is a bounded positive integer, so an unknown id, a negative, NaN, a float or an oversized number returns 400 with no state change (a test sends each); costs, effects and outcomes are computed on the server, never read from the request; if the catalog… (the rest: AB#786)
- [x] Screenshot of the construction panel showing the Ferric Mining Complex buildable, and the panel where its effect is visible after one tick at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### ISP-97 Add the Refinery Complex to the catalog with its effect (Requirement AB#787, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), building catalogue line. One of the three buildings data/milestones.json level 7 requires that exists nowhere today (AB#424). What it is. Add the Refinery Complex as a catalog entry with the cost, gate and effect specified in docs/design/buildings.md (v0.6-01), and implement that effect in the server tick or build path. Why it matters. Level 7 names this building; until it exists the ladder is a promise the game cannot keep. Estimate: 1… (the rest: AB#787)

- [x] The building is a catalog entry, buildable through /gameplay/build once its gate is met, and absent from no list that shows buildings.
- [x] The effect named in docs/design/buildings.md is observable in state: a test builds it, advances the tick, and asserts the specific field the design names has changed by the specified amount.
- [x] The building:Refinery Complex metric in level 7 resolves to 1 after the build (test through resolveMetric).
- [x] Security (DOCTRINE constraint 1): the route sits behind requireAuth and requireAccountAccess; it touches the caller's buildings, slots and credits and nothing else; every id in the request is checked against the server catalog and every quantity is a bounded positive integer, so an unknown id, a negative, NaN, a float or an oversized number returns 400 with no state change (a test sends each); costs, effects and outcomes are computed on the server, never read from the request; if the catalog… (the rest: AB#787)
- [x] Screenshot of the construction panel showing the Refinery Complex buildable, and the panel where its effect is visible after one tick at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### ISP-98 Add the Cryo-vapor Extractor Array to the catalog with its effect (Requirement AB#788, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), building catalogue line. One of the three buildings data/milestones.json level 9 requires that exists nowhere today (AB#424). What it is. Add the Cryo-vapor Extractor Array as a catalog entry with the cost, gate and effect specified in docs/design/buildings.md (v0.6-01), and implement that effect in the server tick or build path. Why it matters. Level 9 names this building; until it exists the ladder is a promise the game cannot keep.… (the rest: AB#788)

- [x] The building is a catalog entry, buildable through /gameplay/build once its gate is met, and absent from no list that shows buildings.
- [x] The effect named in docs/design/buildings.md is observable in state: a test builds it, advances the tick, and asserts the specific field the design names has changed by the specified amount.
- [x] The building:Cryo-vapor Extractor Array metric in level 9 resolves to 1 after the build (test through resolveMetric).
- [x] Security (DOCTRINE constraint 1): the route sits behind requireAuth and requireAccountAccess; it touches the caller's buildings, slots and credits and nothing else; every id in the request is checked against the server catalog and every quantity is a bounded positive integer, so an unknown id, a negative, NaN, a float or an oversized number returns 400 with no state change (a test sends each); costs, effects and outcomes are computed on the server, never read from the request; if the catalog… (the rest: AB#788)
- [x] Screenshot of the construction panel showing the Cryo-vapor Extractor Array buildable, and the panel where its effect is visible after one tick at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### ISP-99 Design building upgrade tiers so that upgrading is a decision, not arithmetic (Requirement AB#791, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), plan line "Building upgrade (tier) system". Design first: every built building already carries a tier: 1 field and the corporation has an unused unlocks.maxUpgradeTier, but nothing reads either. What it is. A design for tiers per building type: how many tiers, the cost curve, what each tier changes, whether an upgrade takes time and takes the building offline, and how maxUpgradeTier is raised (by level). Prior art: OGame prices every… (the rest: AB#791)

- [x] docs/design/upgrades.md exists and gives, for every catalog building, its tiers, the per-tier cost and the per-tier effect in a table.
- [x] It shows by hand-checkable arithmetic, for the Basic Extractor Yard, three cash positions (for example 100k, 500k, 2M credits) where the best move differs between "upgrade this one", "build another" and "wait", and says what makes it differ (a slot ceiling, superlinear operating cost, downtime while upgrading).
- [x] It names the probe target the implementation must meet, labelled as a bot number (P-PROXY): a headless test bot that always upgrades first ends day 7 with at least 10% fewer credits than a bot that picks by the design's rule.
- [x] It states how unlocks.maxUpgradeTier maps to corporation level, for the levels that exist, and hands the rest to the ladder design (v0.6-14).
- [x] It states that upgrades are bought with in-game credits only and that nothing in the design sells tiers for money (T-021).

### ISP-100 Give every built building a stable instance id, with a migration for existing corporations (Requirement AB#792, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), upgrade line. Prerequisite for upgrading one particular building. What it is. Entries in corp.buildings are { name, tier, status } with no id, so the server cannot say which of three extractor yards to upgrade. Add a server-generated id to every entry, backfilled on load for existing corporations, and carry it through the Supabase repositories. Why it matters. An upgrade route that identifies a building by name or index would upgrade… (the rest: AB#792)

- [x] Every building created by any route gets an id generated by the server; a test builds two of the same type and gets two distinct ids.
- [x] Loading a saved corporation without ids assigns them once and persists them; loading again does not change them (idempotence test); a corporation that fails to migrate is loaded unchanged and the failure is logged without player data, never half-migrated.
- [x] Extractor records that link to their building keep the link (test on a corporation with a lease and two extractors).
- [x] The migration runs against the Supabase repository path as well as the file store, covered by the existing repository tests.

### ISP-101 Upgrade endpoint and extractor tiers (Requirement AB#793, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), upgrade line. What it is. Add POST /api/accounts/:accountId/gameplay/buildings/:buildingId/upgrade and the tier table for the Basic Extractor Yard from docs/design/upgrades.md: cost, effect on throughput and operating cost, and any upgrade duration or downtime the design specifies. Why it matters. The extractor is the core loop's main building; it is where the decision the design argued for must actually show up. Estimate: 1 session,… (the rest: AB#793)

- [x] Upgrading an extractor yard charges the design's cost, raises its tier by one, and changes throughput and operating cost to the design's table values (test for tiers 1 to max).
- [x] Upgrading beyond unlocks.maxUpgradeTier or the type's last tier returns 400 with the reason and no state change.
- [x] Security (DOCTRINE constraint 1): the route sits behind requireAuth and requireAccountAccess; it touches the caller's buildings, extractors and credits and nothing else; every id in the request is checked against the server catalog and every quantity is a bounded positive integer, so an unknown id, a negative, NaN, a float or an oversized number returns 400 with no state change (a test sends each); costs, effects and outcomes are computed on the server, never read from the request; if the… (the rest: AB#793)
- [x] The probe from v0.6-08 exists as a vitest test and passes: the always-upgrade bot ends day 7 with at least 10% fewer credits than the rule-following bot. The PR quotes the two numbers and labels them bot numbers.

### ISP-102 Upgrade tiers for every other catalog building (Requirement AB#794, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), upgrade line. What it is. Add the tier tables from docs/design/upgrades.md for every catalog building other than the extractor yard (Headquarters, Assembly Facility, Refinery and the v0.6-05 to 07 buildings), and implement each tier's effect. Why it matters. A tier system that covers one building of seven reads as unfinished; each type needs its own effect or the design must say it has no tiers. Estimate: 1 session, assuming v0.6-10 is… (the rest: AB#794)

- [x] Every catalog building either has a tier table or is marked "no tiers" in the catalog, and a schema test enforces one of the two.
- [x] For each type with tiers, a test upgrades it once and asserts the specific field the design names changed by the specified amount.
- [x] The upgrade endpoint's validation from v0.6-10 applies unchanged; no type adds its own route.

### ISP-103 Upgrade control on each building: cost, before and after, and why it is locked (Requirement AB#795, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), upgrade line. The visible half of the tier system. What it is. On each built building (the construction panel from v0.6-04 and the extractor panel), show the current tier, an Upgrade button with the next tier's cost, the before-and-after of what changes (e.g. "throughput 120 → 150/h, operating cost 1,920 → 2,640/h"), and a locked reason when the corporation's max tier or the type's last tier is reached. Why it matters. The design's… (the rest: AB#795)

- [x] Every built building shows its tier; the before-and-after values come from the server catalog, not from a client copy (a test changes a fixture value and sees it rendered).
- [x] Upgrading updates the building, the credits and the before-and-after in place, without a reload.
- [x] At the tier cap the button is replaced by the reason in words.
- [x] Screenshot of the extractor panel with an upgrade available, and the same panel at the tier cap at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### ISP-104 Make the level-up applier data-driven, strict about unknown unlocks, and in order (Requirement AB#796, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), plan line "Full milestone roadmap wired to level-up system". Groundwork before levels 11 to 40 exist. What it is. evaluateLevelProgress in server/gameState.js applies four hardcoded unlock keys (employeeCap, buildingSlots, maxFleetSize, marketSectors) and silently ignores any other key, which is how AB#586's probe cap came apart from Fleet Cap. It also grants level N whenever N's requirements are met, even if level N−1's are not. Make… (the rest: AB#796)

- [x] A schema test fails if any level's unlocks contains a key not in the exported allowlist.
- [x] A corporation meeting level 7's requirements but not level 6's stays at level 5 (test); meeting both grants 6 then 7 in the same evaluation, each with its unlocks applied.
- [x] maxUpgradeTier granted by a level is what the upgrade endpoint enforces (test across v0.6-10's route).
- [x] Level evaluation never lowers a value the corporation already has (unlocks are max-merged; test).
- [x] Nothing the client sends can set the level or an unlock: the level is only ever written by this function (grep in the PR description shows every write of corp.level).

### ISP-105 Design levels 11 to 40: bands, requirements and unlocks, every one reachable (Requirement AB#797, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), plan line "Full milestone roadmap (Levels 11–40)". The Board answered D-0.6-1 (AB#700): "Level 40 should take like a year of gameplay." The half it did not answer takes the recommendation, option A: all thirty levels are authored in v0.6 against content that exists at the end of v0.6, and later versions swap requirements in as their systems land. What it is. A document specifying all thirty levels: the requirement for each, the unlocks… (the rest: AB#797)

- [x] docs/design/ladder-11-40.md lists levels 11 to 40, each with requirements (metric string, target) and unlocks.
- [x] Every metric resolves against content that exists at the end of v0.6 (option A); the doc lists every metric kind used and, for any new kind (for example building-tier:<id>:<n>), the resolver change v0.6-15 must make.
- [x] It quotes the Board's answer on AB#700 and states the target as a bot number: the year-pacing probe's check-in profile reaches level 40 between simulated day 330 and day 400. Per band it gives the simulated day the probe should reach it, and the credits and queued research hours from data (arithmetic, labelled as such). It says in words that these are bot numbers, not a measured human pace (P-PROXY).
- [x] It says what paces the year (research hours, cycle times, credit costs) and shows that each band contains at least one choice between two paths whose best answer depends on the player's situation, so the year is not only waiting (T-018).
- [x] Each band names one thing the player gets that they can see or use (a building, a tier, a sector), not only a larger cap.
- [x] It lists which requirements should be revisited when v0.7 and v0.8 content lands, so later versions know where to hook in.

### ISP-106 Derive the milestone roadmap from the level definitions and add the metric kinds levels 11 to 40 need (Requirement AB#798, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), wiring line. / What it is. data/milestones.json keeps a hand-written roadmap array that repeats every requirement title of levels 1 to 10 (P-TWO-SOURCES). Generate the roadmap from levels instead, and add to resolveMetric the metric kinds docs/design/ladder-11-40.md lists (for example building tier and generic totalMined:<resource>, which returns 0 today for anything but silicate). / Why it matters. Thirty levels hand-copied into a second… (the rest: AB#798)

- [x] The roadmap array is gone from data/milestones.json; the roadmap the client receives for levels 1 to 10 is derived from levels and matches it by a snapshot test - except levels 6 and 7, where the snapshot is corrected before being recorded so level 6 names the Ferric Mining Complex (AB#786) and level 7 names the Refinery Complex (AB#787), matching what levels actually unlocks there. Do not snapshot today's stale strings for those two.
- [x] Each new metric kind has a unit test with a corporation that meets it and one that does not.
- [x] resolveMetric throws in tests (and logs once in production) on a metric prefix it does not recognise, instead of returning 0 silently; the schema test runs every metric in the file through it.

### ISP-107 Ladder bot: a headless test that climbs every defined level (Requirement AB#799, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), wiring line. The measuring instrument for the three content stories after it. What it is. A vitest harness that starts a fresh corporation, performs the cheapest action satisfying each requirement of the next level through the real server functions (not by writing state), and records the level reached, the actions taken, the credits spent and the queued research hours. DEPTH.md's epic 1 asked for exactly this ("a bot that satisfies… (the rest: AB#799)

- [x] tests/probes/ladder-bot.test.js (or the path the repo uses) climbs levels 1 to 10 on the current data and fails naming the level and requirement where it stops.
- [x] It prints, per level, actions taken, credits spent and research hours queued, labelled as bot numbers, not player time (P-PROXY).
- [x] It drives the game only through exported server functions or HTTP routes; a grep in the PR shows it never assigns to corp.level, corp.stats or corp.unlocks.
- [x] It runs in CI in under 60 seconds with ISP_DISABLE_TICKERS set.
- [x] The harness takes the server clock as a parameter and records simulated elapsed time per level, so a later probe can run it on a check-in profile.

### ISP-108 Author levels 11 to 20 in the milestone data (Requirement AB#800, Resolved, not verified) (lane: interstellar-settlement-protocol/accounts)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), plan line "Full milestone roadmap (Levels 11-40)". What it is. Add levels 11 to 20 to data/milestones.json exactly as specified in docs/design/ladder-11-40.md, and make any stat writes those levels need through the bumpStat allowlist from AB#424. Why it matters. Ten levels is the most one session can author and verify against the ladder bot; the ladder is the goal horizon DEPTH scored 1/5. Estimate: 1 session, assuming the design is… (the rest: AB#800)

- [x] First commit: docs/design/ladder-11-40.md's stat:refinedUnitsProduced targets from Level 16 onward are each reduced by 7,200 (existing rounding kept), with one added line stating the curve is anchored at Level 10's 2,000 (AB#2312); Levels 11-15 (no refined target) are unchanged. Do this before authoring the level data below, as its own commit.
- [x] Levels 11 to 20 are in the data and match the corrected design document (a reviewer can diff the two).
- [x] The ladder bot (v0.6-16) climbs to level 20 and the PR quotes its per-level numbers, labelled as bot numbers.
- [x] The schema and cross-catalog tests pass: every research id, building, stat and unlock key used by these levels resolves.
- [x] A corporation saved at level 10 before this change loads, is evaluated, and keeps every unlock it had (regression test).
- [x] The year-pacing probe's check-in profile reaches level 20 within 15% of the simulated day the (corrected) design gives for it, quoted in the PR as a bot number (not player time, P-PROXY).

### ISP-109 Author levels 21 to 30 in the milestone data (Requirement AB#801, Resolved, not verified) (lane: interstellar-settlement-protocol/accounts)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), plan line "Full milestone roadmap (Levels 11–40)". What it is. Add levels 21 to 30 to data/milestones.json exactly as specified in docs/design/ladder-11-40.md, and make any stat writes those levels need through the bumpStat allowlist from AB#424. Why it matters. Ten levels is the most one session can author and verify against the ladder bot; the ladder is the goal horizon DEPTH scored 1/5. Estimate: 1 session, assuming the design is… (the rest: AB#801)

- [x] Levels 21 to 30 are in the data and match the design document (a reviewer can diff the two).
- [x] The ladder bot (v0.6-16) climbs to level 30 and the PR quotes its per-level numbers, labelled as bot numbers.
- [x] The schema and cross-catalog tests pass: every research id, building, stat and unlock key used by these levels resolves.
- [x] A corporation saved at level 10 before this change loads, is evaluated, and keeps every unlock it had (regression test).
- [x] The year-pacing probe's check-in profile reaches level 30 within 15% of the simulated day the design gives for it, quoted in the PR as a bot number (not player time, P-PROXY).
- [x] Unblocked 2026-09-26 (Board answer, Decision AB#2324): every stat:silicateSoldOnExchange target here (Level 28 and Level 30) is redrawn as a production target, not a sales target - the Board's rule is that progress never waits on the market. Cite ECONOMY.md's new "Demand: the Board's rule (AB#2324)" section (AB#2375). Follow AB#2321's own method (90% of the curve at that level's simulated day, from a production-based rate at the shared quota, not a sales-based one) to pick the replacement… (the rest: AB#801)

### ISP-111 Level panel: level of 40, next level's requirements with progress, and what it unlocks (Requirement AB#803, Resolved, not verified) (lane: interstellar-settlement-protocol/social)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), wiring line. The player-facing end of the ladder. What it is. The corporation progress view shows the current level out of 40, every requirement of the next level with live progress, what reaching it unlocks, and a level-up notification when it happens. Earlier and later levels are browsable without rendering all forty at once. Why it matters. A ladder the player cannot read is the same wall as a broken one: DEPTH describes a player at… (the rest: AB#803)

- [x] The panel shows "Level N of 40" where 40 is derived from the data, not a literal (test with a fixture of 12 levels shows "of 12").
- [x] Each next-level requirement shows progress/target from the server's levelProgress; completing one updates the panel on the next state push without a reload.
- [x] Reaching a level produces one notification naming the level and its unlocks (test that re-evaluating does not send it twice).
- [x] Screenshot of the level panel for a level 1 corporation and for the ladder bot's corporation at level 20 at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### ISP-283 Year-pacing probe: the ladder bot on a twice-daily check-in profile over simulated time (Requirement AB#990, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.6 Industrial Expansion (Feature AB#390), wiring line. The Board answered D-0.6-1 (AB#700): "Level 40 should take like a year of gameplay." / What it is. A probe that runs the ladder bot (ISP-107, AB#799, merged) on an injected clock with a check-in profile: it acts only at two check-ins per simulated day, taking the cheapest path, and prints the simulated day each level is reached. It also runs an always-on profile (acts whenever anything completes) as the lower bound. Both are… (the rest: AB#990)

- [x] The probe prints, per level and per profile, the simulated day reached, credits spent and research hours queued, labelled as bot numbers.
- [x] It takes the band targets from docs/design/ladder-11-40.md and fails if a defined level is reached more than 15% earlier or later than its target on the check-in profile; with levels 31 to 40 defined, it fails unless level 40 falls between simulated day 330 and day 400.
- [x] It drives the game only through server functions or routes (no writes to corp.level, corp.stats or corp.unlocks, shown by grep in the PR).
- [x] It runs in under 5 minutes as npm run probe:pacing; the PR states whether it runs in CI or nightly.

### Make data/research.json the only definition of the research tree (Requirement AB#1049, Resolved, not verified) (lane: interstellar-settlement-protocol/client-shell)

What: Where it sits: the research tree is written out three times: RESEARCH_LIBRARY in server/index.js (about line 59), techTree in public/scripts/app.js (about line 70), and data/research.json, which the schema tests validate but nothing loads. What it is: load the tree from the data file on the server and send it to the client (the pattern CEO Insight uses since Bug #983: GET /api/ceo-insight), and delete the two copies in code. Why it matters: today the three agree (13 technologies, same ids and… (the rest: AB#1049)

- [x] RESEARCH_LIBRARY and techTree are gone; the server reads data/research.json and the client gets the tree from the server.
- [x] A test fails if the server gates on a technology id the file does not define.
- [x] Corporate R&D, looked at in the browser, shows the same tree, costs and prerequisites as before, with a screenshot on the PR.

### Design asteroid belts that deplete and respawn, with rarity that varies within a system (Requirement AB#1050, Resolved, not verified) (lane: interstellar-settlement-protocol/client-shell)

What: Where it sits: server/gameState.js asteroid scouting and expeditions (TODOs at about lines 767 and 783) and the client's refreshBeltCompositions (public/scripts/app.js about line 548). What it is: a design, then the build, for belts that hold a finite amount of ore, disappear when mined out, and respawn (the TODO proposes a 20% chance each hour on the hour), and for rarity that is a distribution per system rather than a fixed label, so an exotic belt in Sol is possible but rare. Why it matters:… (the rest: AB#1050)

- [x] A written design (in the repo's design docs) with the depletion, respawn and rarity numbers, computed against the economy model rather than asserted.
- [x] Implementation stories filed from it, each with acceptance.
- [x] The two TODOs in server/gameState.js and the one in public/scripts/app.js point at those stories.

### Move mission templates, agents and reputation tiers into data, and vary contract quotas and rewards (Requirement AB#1051, Resolved, not verified) (lane: interstellar-settlement-protocol/client-shell)

What: Where it sits: MISSION_TEMPLATES are hard-coded in server/gameState.js (about line 1210, TODO: "the values should be more random"), and MISSION_AGENTS and the reputation tiers are hard-coded in public/scripts/app.js (about lines 4305 and 4334, TODOs: "should be in the database"). What it is: one data file for templates, agents and tiers that server and client both read, and contract generation that varies quota and reward within bounds set in that file. Why it matters: contracts are the same… (the rest: AB#1051)

- [x] data/missions.json (or equivalent) holds templates, agents and reputation tiers, with a schema test.
- [x] Offers vary quota and reward within the file's bounds; a test shows two refreshes can differ and never leave the bounds.
- [x] The Assignments tab, looked at in the browser, shows the agents and offers from the data, with a screenshot on the PR.

### Rebuild the Travel tab in the new design (Requirement AB#1053, Resolved, not verified) (lane: interstellar-settlement-protocol/client-shell)

What: Where it sits: public/scripts/app.js travel rendering (TODO at about line 2054: "Overhaul Travel Page design"). The v1.0 facelift stories rebuild every other screen (ISP-76 to ISP-82, #765 to #771) but none names the Travel tab. What it is: the Travel tab rebuilt on the design tokens and components of the facelift, showing the destination, the route and time, and the in-transit state. Why it matters: without a story the facelift ships with one screen left in the old style. / Filed from the ISP-13… (the rest: AB#1053)

- [x] The Travel tab uses the facelift's tokens and components only; no hard-coded colours or sizes.
- [x] Destination choice, route and time, and in-transit state are shown; looked at at desktop and phone widths, with screenshots on the PR.

### Player buy orders on the Galactic Exchange that fill against matching sell orders (Requirement AB#1054, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits: the Galactic Exchange order book (server/index.js POST /api/market/orders accepts type sell only). Carried over from the retired Todos.md, where it was an open line ("Market order matching engine"). What it is: a player can post a buy order for an item at a price, with the credits held; it fills automatically against sell orders at or under that price, oldest first, and the rest waits. Why it matters: today only sellers can post, so a buyer must watch the book; standing player… (the rest: AB#1054)

- [x] POST a buy order with the credits reserved; a matching sell order fills it at the sell price, oldest first, with both ledgers and trade histories written.
- [x] Partial fills leave the rest standing; cancelling returns the reserved credits; tests for each, including a race of two buyers.
- [x] The order book shows buy orders beside sell orders, looked at in the browser, with a screenshot on the PR.

### ISP-311 Give maxDeployments a level-up unlock key (Requirement AB#2307, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. AB#797's ladder design (docs/design/ladder-11-40.md), one of two proposals it flags as needing a story before AB#800/AB#802's data can carry the reward (bands A/C/E, levels 12, 24 and 33). / What it is. corp.asteroidMining.maxDeployments (server/game/asteroids.js, ensureCorpAsteroidMiningModel) is set once to BASE_MAX_DEPLOYMENTS (1) and nothing today ever raises it. Add maxDeployments to the level-up unlock applier allowlist (server/game/progression.js, alongside the existing… (the rest: AB#2307)

- [x] A corp that reaches a level whose unlocks include maxDeployments has am.maxDeployments raised to that value; it never lowers on a later level with no maxDeployments key or a smaller one (unit test: level granting 2, then a later level granting nothing, cap stays 2).
- [x] A corp that never reaches such a level keeps BASE_MAX_DEPLOYMENTS (1), unchanged (regression test).
- [x] The level-up summary (server/game/progression.js's existing per-key label pattern) names the raised deployment cap the same way employeeCap/buildingSlots/maxFleetSize are named, when granted that level.
- [x] Wherever the unlock allowlist's keys are documented (if anywhere outside the code itself) gains this one; say where.
- [x] Screenshot: the expedition/asteroid panel showing the raised cap for a test corp with the unlock granted, at 375x812 and 1280x800.

### ISP-312 Extend the extractor yard tier table to 6, 7 and 8 (Requirement AB#2308, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. AB#797's ladder design (docs/design/ladder-11-40.md), the second of two proposals it flags as needing a story before AB#800/AB#801/AB#802's data can carry the reward (bands B/D/F, levels 20, 30 and 40). / What it is. data/economy.json's buildings.extractorYardUpgrades array (read by yardUpgradeTo, yardMaxTier and yardTierFor in server/economy.js - all already tier-count-agnostic, so no code change to them is expected) gains three entries, toTier 6, 7 and 8, continuing AB#791's… (the rest: AB#2308)

- [x] buildings.extractorYardUpgrades gains three entries (toTier 6/7/8), upgradeCost 202,500 / 303,750 / 455,625, throughputCap and throughputReferencePerHour continuing the existing x1.25-per-tier curve from tier 5's values (the PR states the exact numbers it computes).
- [x] yardMaxTier() returns 8 once the entries exist (a data-only test of the existing function).
- [x] The upgrade route (server/upgrades.js) accepts an upgrade to tier 6, 7 and 8 for a corp whose maxUpgradeTier unlock allows it, and refuses one past its allowed tier exactly as it does today for tiers 2-5 (existing refusal path, extended coverage).
- [x] docs/design/upgrades.md's tier table gains the three rows; its own "paybacks lengthening past 30 days" claim is checked against the PR's actual numbers, not assumed.
- [x] No probe target of its own: AB#990 (the year-pacing probe) and the ISP-304 family exercise it. State that plainly rather than inventing a redundant check here.
- [x] Screenshot: the Station's upgrade control for a tier-5 yard, showing the tier-6 option and its price, at 375x812 and 1280x800.

### Asteroid belts are finite and respawn: belt state, the hourly respawn draw and the spawn rules (server) (Requirement AB#2329, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.6 Industrial Expansion (AB#390); the first of three stories from the belt design in docs/design/belts.md (AB#1050). Replaces the TODO in server/game/asteroids.js that has described dynamic belts since v0.3. / What it is. Each asteroid belt slot (a Field body in data/systems.json) holds a belt as world state, not a fixed label: a generation number, a rarity drawn from its system's distribution, a composition drawn from that tier's template with jitter, a reserve of units by tier,… (the rest: AB#2329)

- [x] Every belt slot has state: generation, rarity, composition, reserve and remaining; an install saved before this loads with today's belts as generation 1, full, and nothing else changes for it.
- [x] An empty slot draws on the hour, with the design's chance; a unit test on an injected clock and seeded draws shows the chance, the rarity distribution per system and the composition jitter within tolerance over many draws.
- [x] The design's numbers live in data/economy.json with ECONOMY.md rows, and npm run belt:model reads them from there and still prints what docs/design/belts.md quotes (tests/unit/beltModel.test.js).
- [x] No expedition or client change in this story (the next two).

### Expeditions draw from a belt's reserve, and a mined-out belt ends them and disappears (Requirement AB#2330, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. Second of three stories from docs/design/belts.md (AB#1050); needs the belt state from AB#2329 (blocked until it merges). / What it is. An expedition's yield comes out of its belt's remaining reserve, tick by tick, shared by every corporation mining that belt. When the reserve reaches zero, every expedition on it comes home at that tick with what it carried (the launch cost is not refunded) and the belt is gone until its slot respawns. A corporation's scouting is of a generation: a… (the rest: AB#2330)

- [x] Yields never exceed the remaining reserve, and two corporations on one belt share it exactly (integration test).
- [x] The tick that empties a belt ends every expedition on it, deposits what each carried, returns each probe and records the early end; the slot is empty afterwards.
- [x] Scouting is per generation; launching at an empty slot is refused with a message that says when the next chance is.
- [x] The ladder bot and npm run probe:pacing still pass (bot numbers, P-PROXY).

### The Starmap shows a belt's reserve, a mined-out belt and when the next one may appear (Requirement AB#2331, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. Third of three stories from docs/design/belts.md (AB#1050); needs the reserve from AB#2330 (blocked until it merges). Replaces the TODO on refreshBeltCompositions in public/scripts/views/starmap.js. / What it is. The belt panel shows a scouted belt's rarity, composition and remaining reserve as a labelled bar; an empty slot says there is no belt and when the next hourly chance is; an expedition that ended early says so in its report. The belt-compositions route and… (the rest: AB#2331)

- [x] The three states (scouted with reserve, unscouted, empty with the next chance) are on the design system and looked at at 375, 768 and 1280, with screenshots on the PR.
- [x] A respawn while the panel is open shows as unscouted without a reload.
- [x] The AB#772 sweep (e2e/every-screen.spec.js) still passes.

## Demo script

_To be written._
