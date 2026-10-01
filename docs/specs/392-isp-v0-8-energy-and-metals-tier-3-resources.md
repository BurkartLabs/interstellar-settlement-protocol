# ISP v0.8 — Energy and metals (tier 3 resources)

Feature AB#392 (Proposed) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits: v0.8 on the ISP roadmap (DEVELOPMENT_PHASES.md in the product repo), under the product epic.
What it is for: The second resource tier, which is what makes the refinery chains and the exchange interesting rather than merely present.
What it contains:
- Helium-3 and deuterium extraction and refinery chains
- Nickel-iron: extraction, smelting, alloy production
- Rare metals chain (rare earths, thorium, cobalt)
- Light metals chain (lithium, aluminium composites)
- Multi-step manufacturing across all tier-3 tracks
- Off-world mining on specific starmap bodies
- Starmap resource concentration overlay
Each line becomes a story when this version is next. They are listed here rather than filed as work items so the backlog shows what is ready to be worked, not everything that has ever been planned (TRACKING.md).

## Acceptance

1. Every tier-3 track under "What it contains" can be played on the running build from extraction to its manufactured good, each step gated by its research.
2. The production-chain probe (bots, not players) shows no single refine-or-sell policy winning at every price.

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 2 open, 16 resolved.

### ISP-141 Production-chain probe: no single refine-or-sell policy wins at every price (Requirement AB#835, Active) (lane: interstellar-settlement-protocol/economy)

PM note (2026-10-01): the probe looks done on main (d67bd53e, 33ab3d2b: tests/probes/chain-probe.test.js, chainProbe.js). Check the first two lines against main and tick them; do not rebuild. The last two lines describe the original pull request's text: strike them through with that reason. The fourth as worded is contradicted by the test's week(), which sets inventory directly; say so when striking it.

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), multi-step manufacturing line. The measurement for the version's economy. What it is. A headless test bot runs a week of each track under three policies ("always sell raw", "always refine to the end", "the design's rule") at three NPC price states, and reports credits at the end. Why it matters. T-018 and DEPTH's decision-density gate: the chains are a decision only if the best policy changes with prices. Estimate: 1 session, assuming… (the rest: AB#835)

- [ ] The test exists and passes: in at least one price state each fixed policy is beaten by another (the design's target), at tier 1.
- [ ] The same run at a tier-3 Refinery is separately reported, and "always refine" there is an expected, accepted outcome, not a failure (AB#823 section 8: the tier-3 multiplier, 2x for 150,000, was priced before refined goods had a buyer, and is kept as the reward for that investment rather than retuned - see AB#823's comments for the PM's decision). The test does not assert a policy split at tier 3.
- [ ] The PR quotes the nine end-of-week credit totals per track at tier 1, plus the tier-3 comparison, labelled as bot numbers (P-PROXY), and says what they do not measure (human pacing, player-to-player prices).
- [ ] The bot drives the game only through server functions or routes; it never writes inventory or credits directly (grep in the PR).

### Gas-giant and ice-giant skimming: a lease on a giant needs Fusion Fuel Cycle, and giants take leases (Requirement AB#2352, Proposed) (lane: interstellar-settlement-protocol/economy)

PM note (2026-10-01): which giants take a lease, and at what price, is the Builder's to choose and to write into docs/design/tier3-resources.md, as the lines say.

What: Where it sits. v0.8 Energy and Metals (AB#392), the Fuel track's second source. docs/design/tier3-resources.md section 3: a gas giant (Hydrogen 55, Helium-3 30, Deuterium 15) or ice giant needs "a lease and skimming research (the Helium-3 track's)", and tier3-recipes.md section 3 has tt-fusion-fuel-cycle unlock "gas-giant skimming". Split out of AB#830, which put the research node and the Luna and Rime sources into data but not this mechanic. / What it is. Two things. (1) A lease that requires… (the rest: AB#2352)

- [ ] A lease on a giant without Fusion Fuel Cycle is refused with a message naming the research, and changes nothing; with it, it is filed and a yard there yields the giant's profile (integration test).
- [ ] The giants that take leases, their prices and where each is filed are in data/systems.json and data/stations.json, with the choice written into docs/design/tier3-resources.md.
- [ ] The lease picker names the research a giant needs, looked at at 375 and 1280.

### ISP-128 Design the tier-3 resource catalogue: every item, its tier, and which bodies and belts yield it (Requirement AB#822, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392). Design first for the whole version: the plan says "Tier 3 resources", but LORE.md calls Helium-3 and Nickel tier 1 and Rare Earths, Lithium, Cobalt and Thorium tier 2, and Deuterium and aluminium exist nowhere in the build. What it is. One document that fixes the taxonomy (what "tier" means, reconciled with LORE.md), lists every raw item the four tracks need with where it comes from (body types, specific bodies, belts), and says which… (the rest: AB#822)

- [x] docs/design/tier3-resources.md states the tier taxonomy and lists each disagreement with LORE.md and how it is resolved.
- [x] It lists every raw item for the four tracks (Helium-3 and Deuterium; Nickel-Iron; Rare Metals; Light Metals) with id, name, tier and sources (which bodies by type or name, which belts).
- [x] It gives a resource profile (item and concentration) for every existing body that yields anything, and a rule for new bodies.
- [x] It interprets "Nickel-Iron Rally" in one sentence (the plan's wording) and says what the player does.
- [x] It lists which items already appear in the build (belt compositions, NPC bids, mission quotas, refinery chains) and keeps their names.

### ISP-129 Design the tier-3 recipe graph: every chain, its inputs and outputs, and why refining beats selling raw only sometimes (Requirement AB#823, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), plan line "Multi-step manufacturing chains across all Tier 3 resource tracks", and the recipe half of each track. What it is. The recipe graph for all four tracks: each chain's inputs (several, where the design calls for it), outputs, cycle length, research gate and building, and which outputs feed which chains across tracks. Today's six chains in data/refinery-chains.json each take one input. Prior art: EVE Planetary Industry's P0 to P4… (the rest: AB#823)

- [x] docs/design/tier3-recipes.md lists every chain with inputs, outputs, cycle length, research gate and building, and shows the graph as a table or diagram.
- [x] Every input is either a raw item from v0.8-01 or an output of another chain in the graph (the doc says which), and at least one final product consumes outputs of two or more tracks.
- [x] It gives an NPC floor price for every new item, and shows by arithmetic for at least two chains that at the NPC floor, refining beats selling raw only when a named condition holds (refinery slot free, input price below X).
- [x] It names the probe target for v0.8-14, labelled as a bot number: no single policy ("always refine", "always sell raw") is best in all three test price states.
- [x] It states which existing chains change shape and how existing in-progress refinery cycles are handled.

### ISP-130 Item catalog with a test that every item named anywhere resolves (Requirement AB#824, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392). Data before server. What it is. Add data/items.json holding every raw and refined item from both designs plus every item already in the build, and a test that every item named in refinery chains, belt compositions, NPC orders, mission quotas and milestone metrics exists in it. Why it matters. Items are free strings today, so "Helium-3" and "Helium 3" would be two commodities and nobody would notice (T-019). Estimate: 1 session, assuming… (the rest: AB#824)

- [x] data/items.json holds each item with id, display name, tier and category, and the schema test checks the fields.
- [x] The cross-catalog test fails if any of the named sources references an item not in the catalog (demonstrated by a fixture with a misspelt item).
- [x] The exchange order routes reject an item that is not in the catalog with 400 and no state change (test), so a client cannot list an invented commodity.

### ISP-131 Refinery chains with several inputs, debited together or not at all (Requirement AB#825, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), multi-step manufacturing line. Server capability every track needs. What it is. Change the chain schema from one input to inputs: [{ item, quantityPerCycle }], migrate the six existing chains, and make start-refinery debit every input in one mutation or reject the whole start. Why it matters. An alloy is two metals; a half-debited start destroys goods. Estimate: 1 session, assuming v0.8-03 is merged.

- [x] The six existing chains behave exactly as before (test per chain).
- [x] A two-input chain starts only when both inputs are present in the scaled amount; with either short it returns 400 naming the missing input and debits nothing (test).
- [x] A refinery cycle in progress when the server upgrades completes with its original outputs (migration test).
- [x] Security (DOCTRINE constraint 1): the route sits behind requireAuth and requireAccountAccess; it touches the caller's refineries and station inventory and nothing else; every id in the request is checked against the server catalog and every quantity is a bounded positive integer, so an unknown id, a negative, NaN, a float or an oversized number returns 400 with no state change (a test sends each); costs, effects and outcomes are computed on the server, never read from the request; if the… (the rest: AB#825)

### ISP-132 Resource profiles for every body in the system catalog (Requirement AB#826, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), plan line "Off-world mining operations on specific starmap bodies". What it is. Add a resource profile (item and concentration) to every body in data/systems.json per docs/design/tier3-resources.md. Why it matters. Mining leases produce Silicates on every body; which body you lease should matter. Estimate: 1 session, assuming v0.8-03 and v0.7-04 are merged.

- [x] Every body has a profile (possibly empty); every item in a profile exists in the item catalog; concentrations are between 0 and 1 (schema test).
- [x] The profiles match the design (diffable) and are served read-only with the system catalog.

### ISP-134 Extractors produce their body's resources instead of always Silicates (Requirement AB#828, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), off-world mining line. What it is. The mining tick yields Silicates for every lease (leaseType "Silicate Extraction", silicateExtractors). Make it yield the resources of the lease's body profile, scaled by concentration, and credit totalMined per item so the ladder's generic metric works. Why it matters. This is the line itself: off-world mining that depends on where you mine. Estimate: 1 session, assuming v0.8-06 is merged; the… (the rest: AB#828)

- [x] An extractor on a body with a two-item profile produces both items in the profile's proportions over a cycle (test).
- [x] An extractor on Mars produces the same Silicates per hour as before (regression test).
- [x] totalMined:<item> resolves for every mined item (test).
- [x] Output is added only by the server tick; no route accepts a yield from the client.

### ISP-135 Lease and extractor panels show what each body yields (Requirement AB#829, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), off-world mining line. The visible half. What it is. The lease picker lists leasable bodies with their resources and concentration; each extractor panel shows what it is producing, per item. Why it matters. The player's choice of body is the point of the line and must be made with the numbers in front of them. Estimate: 1 session, assuming v0.8-07 is merged.

- [x] The lease picker shows each body's items and concentration from the catalog.
- [x] Each extractor panel shows per-item output for the current cycle (labelled as this cycle, not lifetime: see AB#575).
- [x] Screenshot of the lease picker with at least three bodies of different profiles, and an extractor on a two-resource body at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### ISP-136 Helium-3 and Deuterium track: extraction sources, chains and NPC floor prices in data (Requirement AB#830, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), plan line "Helium-3 and Deuterium extraction and refinery chains". What it is. Add Helium-3 and Deuterium extraction and their refinery chains from docs/design/tier3-resources.md and docs/design/tier3-recipes.md: items, body and belt sources, chains, research gates and NPC floor bids. Helium-3 already has an NPC bid (92) and a chain gated on Containment Physics I; Deuterium exists nowhere. Why it matters. Each track is a playable path from… (the rest: AB#830)

- [x] A test corporation leases a source body, extracts, runs every chain in the track to its last output, and sells the output to its NPC floor, all through server routes (integration test).
- [x] Each new chain is gated by the research the design names; starting it without that research returns 400.
- [x] The cross-catalog test passes with the new items and chains.
- [x] The PR quotes, from the design's numbers, the credits per refinery-hour for refining versus selling raw at the NPC floor, labelled as arithmetic from data, not play.

### ISP-137 Nickel-Iron track: extraction sources, chains and NPC floor prices in data (Requirement AB#831, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), plan line "Nickel-Iron Rally - raw metal extraction, smelting, and alloy production". What it is. Add Nickel-Iron extraction, smelting and alloy production from docs/design/tier3-resources.md and docs/design/tier3-recipes.md: items, body and belt sources, chains, research gates and NPC floor bids. Nickel has an NPC bid and one chain. Why it matters. Each track is a playable path from a lease to a sale; the version is four of them.… (the rest: AB#831)

- [x] A test corporation leases a source body, extracts, runs every chain in the track to its last output, and sells the output to its NPC floor, all through server routes (integration test).
- [x] Each new chain is gated by the research the design names; starting it without that research returns 400.
- [x] Every refined item is independently countable as manufactured: stat:manufactured:<item> resolves per item through resolveMetric, and a test confirms two different products (Nickel-Iron Alloy, Pressure Vessels) count separately with no cross-leak. This is infrastructure for a future level or track to use; Level 8's own requirement is unchanged (25 missions, AB#424) and this item does not touch it.
- [x] The PR quotes, from the design's numbers, the credits per refinery-hour for refining versus selling raw at the NPC floor, labelled as arithmetic from data, not play.

### ISP-138 Rare Metals track: extraction sources, chains and NPC floor prices in data (Requirement AB#832, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), plan line "Rare Metals chain (rare earths, thorium, cobalt)". What it is. Add the Rare Metals chains (rare earths, thorium, cobalt) from docs/design/tier3-resources.md and docs/design/tier3-recipes.md: items, body and belt sources, chains, research gates and NPC floor bids. Rare Earths has a chain; Thorium and Cobalt appear only in belt compositions and mission quotas. Why it matters. Each track is a playable path from a lease to a sale;… (the rest: AB#832)

- [x] A test corporation leases a source body, extracts, runs every chain in the track to its last output, and sells the output to its NPC floor, all through server routes (integration test).
- [x] Each new chain is gated by the research the design names; starting it without that research returns 400.
- [x] The cross-catalog test passes with the new items and chains.
- [x] The PR quotes, from the design's numbers, the credits per refinery-hour for refining versus selling raw at the NPC floor, labelled as arithmetic from data, not play.

### ISP-139 Light Metals track: extraction sources, chains and NPC floor prices in data (Requirement AB#833, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), plan line "Light Metals chain (lithium, aluminium composites)". What it is. Add the Light Metals chains (lithium, aluminium composites) from docs/design/tier3-resources.md and docs/design/tier3-recipes.md: items, body and belt sources, chains, research gates and NPC floor bids. Lithium appears only in belt compositions and a mission quota; aluminium exists nowhere. Why it matters. Each track is a playable path from a lease to a sale; the… (the rest: AB#833)

- [x] A test corporation leases a source body, extracts, runs every chain in the track to its last output, and sells the output to its NPC floor, all through server routes (integration test).
- [x] Each new chain is gated by the research the design names; starting it without that research returns 400.
- [x] The cross-catalog test passes with the new items and chains.
- [x] The PR quotes, from the design's numbers, the credits per refinery-hour for refining versus selling raw at the NPC floor, labelled as arithmetic from data, not play.

### ISP-140 Cross-track manufacturing chains: final products that need two or more tracks (Requirement AB#834, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), plan line "Multi-step manufacturing chains across all Tier 3 resource tracks". What it is. Add the chains in docs/design/tier3-recipes.md whose inputs are outputs of other chains across tracks, with their gates and NPC floors. Why it matters. This is where the tracks meet and the player trades inputs they did not make themselves, which is the BRIEF's second metric (orders filled by another player). Estimate: 1 session, assuming v0.8-09 to… (the rest: AB#834)

- [x] Every cross-track chain in the design is in the data; a test runs each one from inputs to output.
- [x] A test corporation that holds only one track's outputs cannot start a cross-track chain and is told which input is missing.
- [x] The cross-catalog test passes.

### ISP-142 Refinery panel for multi-input chains: every input, what is short, and what feeds what (Requirement AB#836, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), multi-step manufacturing line. The visible half. What it is. The chain picker lists every input with the amount needed and the amount held at this station, marks the ones that are short, and shows which chain produces each input and what consumes the output. Why it matters. Players cannot plan a multi-step chain from a list of one-step recipes. Estimate: 1 session, assuming v0.8-13 is merged.

- [x] Every input row shows needed and held amounts from the server; a short input is marked and the Start button says which.
- [x] Each input and output links to the chain that produces or consumes it.
- [x] Screenshot of the refinery panel with a two-input chain where one input is short, and with a cross-track chain ready to start at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### ISP-143 Starmap resource concentration overlay (Requirement AB#837, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), plan line "Starmap: resource concentration overlay". Prior art: DOTLAN's per-system overlays on the EVE map are the genre's standard for putting a statistic on a star map (DOTLAN EveMaps). What it is. A toggle on the starmap that, for a chosen item, colours each system by its best body or belt concentration on the cluster view and each body by its concentration on the system view, with a legend. It shows catalog data only: belt… (the rest: AB#837)

- [x] Choosing an item colours systems and bodies by concentration from the catalog; choosing none removes the overlay.
- [x] The colour scale has a legend with values and is readable without colour (values or pattern on hover or tap).
- [x] Security: the overlay reads public world data only; if scouting gates belt data, the server sends a player only the belts that player has scouted (test with two accounts).
- [x] Screenshot of the cluster view and the Sol system view with the Helium-3 overlay on at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### A standing bid drifts on its own item's daily quota, not the world's 7,000 (per-product quota for refined goods) (Requirement AB#2351, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.8 Energy and Metals (AB#392). docs/design/tier3-recipes.md section 4 and section 8 ("The per-product quota ... changes npcBidFor's signature. It is the only engine change here beyond AB#825"), which assigned it to the track stories; split out of AB#830 as the item's estimate asks for any mechanic beyond multi-input chains. / What it is. Every standing NPC bid drifts on one quota, npcBid.quotaPerDay (7,000), whatever the item (server/economy.js npcBidFor; server/game/world.js… (the rest: AB#2351)

- [x] Each standing order's quota is its item's: a product's dailyQty, a raw item's npcBid.quotaPerDay; selling a product's daily quantity pushes its bid to its floor (unit test with npcBidFor, and an integration test through the sell route).
- [x] A state saved before this loads with each order on its own quota, keeping soldToday (normalisation test).
- [x] The Exchange shows each order's own remaining-today figure, looked at at 375 and 1280.
- [x] ECONOMY.md's npcBuyers.dailyQty row no longer says the bid ignores it.

### Chain probe: turn AB#2367's it.fails into a real assertion (5%/11% split) and add the player-facing tripwire (Requirement AB#2372, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v0.8 Energy and Metals (Feature AB#392), the chain probe (tests/probes/chain-probe.test.js). Small follow-up from the Director's ruling on AB#2367 (2026-09-26), docs already corrected in this repo's docs/design/tier3-recipes.md section 6. / What it is. Two small, precise code changes. (1) tests/probes/chain-probe.test.js's it.fails test ("at tier 1, the design's rule ends within 5% of the best policy at every point") is currently a known, accepted failure (33/40). Replace it.fails… (the rest: AB#2372)

- [x] chain-probe.test.js's it.fails is replaced by a real it asserting: at every sweep point where best(row) is "refine to the end", the design's rule is within 11% of it; everywhere else, within 5%. The test passes today (measured worst 10.7%) and is a real regression test going forward.
- [x] A tripwire test fails if any file under public/ or a server route serving player-facing content names or recommends "the design's rule" (or an equivalent refine-vs-sell suggestion) while the low-volume gap (any point outside the 5% band) is still open; it passes today since nothing shows the rule to a player.
- [x] docs/design/tier3-recipes.md section 6 (already corrected in this repo, PR pending) is not re-litigated by this story - it states the target and the tripwire in prose; this story makes the code match it.
- [x] Strict suite green; the PR states which two tests changed and quotes their new pass/fail status.

## Demo script

_To be written._
