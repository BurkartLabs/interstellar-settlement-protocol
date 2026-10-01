# ISP v0.11 — Tier 4 production and the last five resources

Feature AB#395 (Proposed) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits: v0.11 on the ISP roadmap (DEVELOPMENT_PHASES.md in the product repo), under the product epic.
What it is for: The top of the production pyramid, gated behind R&D, which gives the late-game research tree something to unlock.
What it contains:
- High-tier exotic resources with R&D gates (exotic matter, uranium, the rest of the catalogue)
- Tier 4 manufacturing chains and advanced product synthesis
- The final five resource types integrated into extraction, refinery and market systems
Each line becomes a story when this version is next. They are listed here rather than filed as work items so the backlog shows what is ready to be worked, not everything that has ever been planned (TRACKING.md).

## Acceptance

_To be written: the Feature had no acceptance criteria in Azure DevOps._

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 1 open, 10 resolved.

### ISP-184 Design Tier 4: name the final five resources, one tier table, the R&D gates and the recipes (Requirement AB#878, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.11 Tier 4 production (Feature AB#395), under the ISP epic AB#388. / What it is. docs/design/v0.11-tier4.md resolving what the plan leaves open: which five resources are "the final 5", one canonical tier numbering, which research gates each, and the Tier 4 recipes. Today the sources disagree: LORE puts Uranium in Tier 2 and lists Aerogel, Quantum Insulators, Plasma Conduits, Dark-Matter Capacitors and Exotic Matter as Tier 3, while those four products already exist as outputs of… (the rest: AB#878)

- [x] The doc names the five resources, says for each whether it is extracted (where: body or belt) or synthesized, and reconciles against the v0.8 build and LORE.md in a table. It keeps LORE's names; if it must contradict LORE's tiers, it says so explicitly for the PM to raise with the Board rather than editing LORE.
- [x] One canonical tier table for all resources and products, replacing the plan's "Tier 3/Tier 4" and LORE's "Tier 1/2/3" with one numbering the catalog's tier field will use.
- [x] Tier 4 recipes are multi-input (e.g. two intermediates plus an exotic) with quantities and cycle times, and the doc states that the current refinery engine is single-input (input, inputQuantityPerCycle), so v0.11-04 generalizes it.
- [x] T-018: at least two Tier 4 recipes compete for the same intermediate or the same facility time, so allocation has an interior optimum; worked example with numbers.
- [x] No free lunch (P-FREE-LUNCH): each Tier 4 product has at least one use besides the NPC bid (a v0.10 unit cost, a v0.6 building upgrade, or a mission), named by id.
- [x] Prior art cited: EVE Online Planetary Industry's R0 to P4 tiers, where P4 items need inputs from several planet types (EVE University: Planetary Industry) as the published model of a raw-to-advanced product pyramid.

### ISP-185 Add the final five resources and Tier 4 products to the resource catalog, with tiers (Requirement AB#879, Resolved, not verified) (lane: interstellar-settlement-protocol/client-shell)

What: Where it sits. v0.11 Tier 4 production (Feature AB#395), under the ISP epic AB#388. / What it is. Catalog entries for the five resources and every Tier 4 product with the design's tier numbers, in the single server-side resource catalog. / Why it matters. The catalog is triplicated today (data/refinery-chains.json resourceCatalog, the client RESOURCE_CATALOG at public/scripts/app.js:3185 with a "remove duplicate" TODO, and the server); adding five entries to three lists is how they drift… (the rest: AB#879)

- [x] Every resource and product in the design table is in the one catalog with its tier; the client reads the catalog from the server and has no hard-coded list (grep test).
- [x] Cross-catalog test: every item named by any chain, mission quota, NPC buy order, belt composition or unit cost exists in the catalog (T-019).
- [x] Existing saves load: a fixture account from before this change loads and its inventory is intact (P-FRESH-STATE-ONLY).

### ISP-186 Add the Tier 4 research nodes that gate exotic resources and synthesis (Requirement AB#880, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.11 Tier 4 production (Feature AB#395), under the ISP epic AB#388. / What it is. The research nodes from the design (e.g. exotic extraction, uranium handling, advanced synthesis) added to the research catalog the server actually reads, with prerequisites, durations and costs, and their effects implemented. / Why it matters. The plan asks for "R&D gates"; three existing nodes already advertise effects the server never applies, so a gate must be tested as a gate, not described.… (the rest: AB#880)

- [x] The new nodes are in the catalog the server reads (the PR states which file, and that data/research.json and the server list agree, or that one was removed).
- [x] Each node's effect is enforced server-side, with one test per node asserting the gated action is rejected before completion and allowed after (P-INERT-FEATURE).
- [x] Prerequisite chain test: every prerequisite id exists and there are no cycles.
- [x] Durations fit the existing research scale (2 to 18 hours per node today) or the design justifies longer ones.

### ISP-187 Let refinery chains take more than one input (Requirement AB#881, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.11 Tier 4 production (Feature AB#395), under the ISP epic AB#388. / What it is. Generalize the chain schema and applyRefineryOperations from one input to a list of inputs with quantities, keeping every existing single-input chain working unchanged. / Why it matters. Tier 4 "advanced product synthesis" combines intermediates; the current engine cannot express a recipe with two inputs. / Estimate: 1 session, assuming v0.11-01 is merged.

- [x] Chains accept inputs: [{ item, quantityPerCycle }]; the six existing chains are migrated or read through a compatibility path, and the existing applyRefineryOperations tests pass unchanged.
- [x] A cycle runs only if every input is available for that cycle; a partial input set pauses the run and says which input is short (test).
- [x] Starting a multi-input run debits all inputs or none (test with one input short).
- [x] Security. quantities from the client are validated as positive integers within the design's bounds; nothing reaches persistence as NaN (the AB#425 failure shape).

### ISP-188 Gate exotic and uranium extraction behind research, on extractors and belt expeditions (Requirement AB#882, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.11 Tier 4 production (Feature AB#395), under the ISP epic AB#388. / What it is. Extraction of the exotic and radioactive raw resources the design names (at least Exotic Matter and Uranium) requires the gating research, on the bodies and belts the design lists. / Why it matters. Today Uranium and Exotic Matter already drop from belt expeditions in tc-cloud and ee-crown (server/gameState.js:756-757) with no research gate, which contradicts the plan line. / Estimate: 1 session,… (the rest: AB#882)

- [x] Without the research, expedition rolls that would yield a gated resource yield the design's substitute (or nothing, if the design says so), and extractors cannot be set to extract it; with the research, both work (tests for each resource and each path).
- [x] The belt-composition table and the design agree, checked by a test that reads both.
- [x] Players who already hold gated resources keep them; nothing is removed from inventory (test on a fixture save).

### ISP-189 Add the Tier 4 synthesis chains and the facility that runs them (Requirement AB#883, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.11 Tier 4 production (Feature AB#395), under the ISP epic AB#388. / What it is. The Tier 4 recipes from the design added as multi-input chains, runnable at the advanced facility the design names (a new building or an upgrade tier of the refinery, via the v0.6 building catalogue), gated by the new research. / Why it matters. This is the plan's "Tier 4 manufacturing chains and advanced product synthesis": the top of the production pyramid the late research tree unlocks. / Estimate: 1… (the rest: AB#883)

- [x] Every Tier 4 recipe in the design is a chain in the data with inputs, outputs, cycle time, facility and research requirement; a schema test loops all of them.
- [x] An integration test runs one full chain from raw input to Tier 4 output with injected time.
- [x] The facility is built through the authenticated building routes; building without its research or slot is rejected with nothing debited.

### ISP-190 Integrate the final five and Tier 4 products into the Galactic Exchange (Requirement AB#884, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.11 Tier 4 production (Feature AB#395), under the ISP epic AB#388. / What it is. NPC standing buy orders for the new items at floor prices from the design, and the exchange filters, sorting and price history (ISP-2, ISP-3) covering them. / Why it matters. The plan says "fully integrated into ... market systems"; the NPC bid is a floor, not the market (DEPTH epic 3), so the prices must leave room for player trade. / Estimate: 1 session, assuming v0.11-06 is merged and the v0.5… (the rest: AB#884)

- [x] Every catalog item either has an NPC standing buy order with the design's floor price and daily quantity, or is listed in an explicit "no NPC buyer" set; a test loops the catalog and fails on any item in neither.
- [x] Each new item can be listed, bought and sold between two test accounts, and appears in price history after a trade (integration test).
- [x] Security. listing the new items goes through the same validated order path as existing items (quantity integer, positive, within inventory); a test lists a Tier 4 item with quantity: "abc" and gets a 400 with nothing debited.
- [x] Screenshot of the Galactic Exchange filtered to Tier 4 items, with one player listing and the NPC floor row at 1440×900 and at 390×844 attached to the PR, taken from the running app (not a mock or a DOM dump).

### ISP-191 Show Tier 4 in the refinery and research screens, with locked states that name the gate (Requirement AB#885, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.11 Tier 4 production (Feature AB#395), under the ISP epic AB#388. / What it is. Refinery and research views show the new chains and nodes, multi-input recipes with each input's stock, and locked items with the research or facility that unlocks them. / Why it matters. A gate the player cannot see reads as missing content (T-019's lesson about stalled ladders); every locked Tier 4 item says what opens it. / Estimate: 1 session, assuming v0.11-06 and v0.11-05 are merged.

- [x] A multi-input chain card lists every input with required and held quantities, and the start button says which input is short when disabled.
- [x] Locked chains and extraction options name the research node or facility required, linking to it.
- [x] The resource catalog view groups items by the design's tiers.
- [x] Screenshot of the refinery view with one running Tier 4 chain and one locked chain, and the research tree showing the new nodes at 1440×900 and at 390×844 attached to the PR, taken from the running app (not a mock or a DOM dump).

### ISP-192 Give each Tier 4 product the non-NPC use the design named (Requirement AB#886, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.11 Tier 4 production (Feature AB#395), under the ISP epic AB#388. / What it is. Wire the consumers the design lists (e.g. unit costs in data/units.json, building upgrade costs, mission quotas) so each Tier 4 product is spent on something besides the NPC bid. / Why it matters. P-FREE-LUNCH: a product whose only buyer is a fixed NPC bid makes the chain a sell button; a real consumer is what gives players a reason to trade it with each other. / Estimate: 1 session, assuming v0.11-06 is… (the rest: AB#886)

- [x] Each Tier 4 product appears as a cost in at least one consumer, with a test per product that the consuming action debits it.
- [x] The cross-catalog test from v0.11-02 covers the new references.
- [x] If a named consumer does not exist yet, the PR lists it and the PM files it; the product is not left without a use silently.

### ISP-193 Extend the ISP probe with a Tier 4 profile: time to first Tier 4 product and allocation choices (Requirement AB#887, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.11 Tier 4 production (Feature AB#395), under the ISP epic AB#388. / What it is. A bot profile that plays from a v0.10-level corporation through the new research and chains and prints how long the top of the pyramid takes and whether allocation is a decision. / Why it matters. The design claims competing recipes create an interior optimum and that Tier 4 is a long-horizon goal; only a probe can check either. / Estimate: 1 session, assuming v0.11-09 is merged and the ISP probe harness… (the rest: AB#887)

- [x] Printed as bot numbers (not player time, P-PROXY): bot-days from the start profile to the first unit of each Tier 4 product; the share of the planner bot's intermediate stock sent to each competing recipe.
- [x] Target: the planner splits contested intermediates between at least two recipes in at least 60% of runs (interior optimum). Misses are reported and filed.
- [x] Target: every Tier 4 product is reachable by the bot (reachability, T-019); any unreachable product fails the probe.

## Held back

Not dispatched: each of these waits on something a Builder session cannot supply, named on its "Held" line. Its lines stay as its acceptance for when it opens. The headings are level 4 so that dispatch, which reads level-3 headings as slices, skips them (PM, 2026-10-01).

#### npm run probe:tier4's busy-market 60%-split target misses for every contest, not just Exotic Matter (Bug AB#4781, Active) (lane: interstellar-settlement-protocol/economy)

Held (2026-10-01): a decision, not a defect, in the bug's own words: restate the probe's target as a quiet-market claim, or widen margins by 20 to 25%. Waits for the Board's economy review (AB#4779, AB#4881).

What: Where: the Tier 4 probe (npm run probe:tier4; tests/probes/tier4Probe.js, allocation and targets), against AB#887's target that the planner splits a contested intermediate between two or more recipes in at least 60% of runs (the design's interior optimum, docs/design/v0.11-tier4.md section 4). What: the quiet market meets it for every contest (84 to 100%); the busy market (others have sold 0 to 80% of each quota today) misses it for every contest (6 to 36%). Why it matters: whether Tier 4… (the rest: AB#4781)
Symptom: npm run probe:tier4 prints MISS for the busy-market 60% split target: Fusion Pellets 36%, Rare-Earth Magnets 35%, Cryogenic Coolant 7%, Pressure Vessels 6%, Exotic Matter 19%, Synthesis Array hours 20%. The quiet market prints MET (84 to 100%). In the busy market sold-as-it-is takes 68 to 86% of contested stock.
Repro: - On origin/main c0a03819: npm run probe:tier4 / - Read the Targets block: the busy market line is MISS for all six contests.
Proposed fix: A decision, not a defect. Options: / - Keep the economy; restate the target as a quiet-market claim (recommended, confidence medium). The design's worked example is at fresh bids; into a saturated market, selling the raw or idling is the right answer and arguably a real market signal. The probe keeps printing the busy table as information, not a target. Cost: a line in the probe and a sentence in section 4. / - Widen Tier 4 margins (raise Tier 4 product base prices about 20 to 25%, or lower their… (the rest: AB#4781)

- [ ] Fixed: npm run probe:tier4's busy-market 60%-split target misses for every contest, not just Exotic Matter

## Demo script

_To be written._
