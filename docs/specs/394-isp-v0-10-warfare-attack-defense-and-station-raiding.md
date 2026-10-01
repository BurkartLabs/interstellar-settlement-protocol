# ISP v0.10 — Warfare: attack, defense and station raiding

Feature AB#394 (Proposed) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits: v0.10 on the ISP roadmap (DEVELOPMENT_PHASES.md in the product repo), under the product epic.
What it is for: The first system where players can take something from each other. It arrives late on purpose: an economy has to be worth raiding before raiding is interesting.
What it contains:
- Orbital shipyard building as the prerequisite for fleet production
- Attack and defense troop building
- Fleet building: fighters, destroyers, siege engines
- Rock-paper-scissors unit counters in combat resolution
- Accuracy and evasion stats
- Fleet deployment and management UI
- Mercenary contract creation and acceptance
- Corp-vs-corp station raiding, initiating and defending
Each line becomes a story when this version is next. They are listed here rather than filed as work items so the backlog shows what is ready to be worked, not everything that has ever been planned (TRACKING.md).

## Acceptance

_To be written: the Feature had no acceptance criteria in Azure DevOps._

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 2 open, 27 resolved.

### Design Rats in asteroid fields: encounters, escorts and hunts using the v0.10 combat model (Requirement AB#819, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.7 World Expansion plan line "Pirate (Rats) NPC enemies in asteroid fields", moved after v0.10 combat. The Board answered D-0.7-1 (AB#701): "We should be able to fight pirates by the time they're added." Rats therefore land once v0.10 has units, the combat resolver and fleets, and the player fights them with those. What it is. Each system already has a pirateDensity (11 in Sol to 31 in Wolf 359) that nothing reads. Design: the chance of an encounter per expedition from density… (the rest: AB#819)

- [x] docs/design/rats.md gives the encounter formula, each belt's Rat group in v0.10 unit terms, the escort and hunt rules, the bounty and the post-hunt quiet period, and the unescorted outcome table, with numbers.
- [x] It shows by arithmetic, for one belt in Sol and one in Wolf 359, that the best expedition length and escort size differ between the two, and names the probe target, labelled as a bot number: no single launch setting (length, escort size) is best in all six existing belts.
- [x] It states that nothing happens to a player's property while they are away beyond the risk they accepted at launch, that probes and stored goods are never taken, and that the encounter chance is visible before launch as a percentage with and without the chosen escort.
- [x] It quotes the Board's answer on AB#701 and states the unescorted-outcome assumption as an assumption.

### Resolve Rat encounters on the server, with an escort fleet fighting them through the combat resolver (Requirement AB#820, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.7 World Expansion plan line "Pirate (Rats) NPC enemies in asteroid fields", moved after v0.10 combat. The Board answered D-0.7-1 (AB#701): "We should be able to fight pirates by the time they're added." Rats therefore land once v0.10 has units, the combat resolver and fleets, and the player fights them with those. What it is. Add the encounter roll from docs/design/rats.md to the expedition tick, and accept an optional escort fleet on launch-expedition. An escorted encounter… (the rest: AB#820)

- [x] For a fixed seed an expedition's encounter, battle and outcome are deterministic (test), and across 10,000 seeded rolls the encounter rate is within 1 percentage point of the formula (test).
- [x] An escort stronger than the belt's Rat group per the design wins and the full haul arrives; a weaker one loses units per the resolver and the haul takes the unescorted outcome (tests with fixture fleets).
- [x] An escort fleet is committed for the expedition's duration and cannot be deployed, raided with or escorting twice meanwhile (test).
- [x] Ticking the same expedition twice applies the outcome once (idempotence test).
- [x] Security (DOCTRINE constraint 1): the route sits behind requireAuth and requireAccountAccess; it touches the caller's expeditions, fleets, probes, station inventory and credits and nothing else; every id is checked against the server catalog and against the caller's ownership (another corporation's fleet id returns 400); every quantity is a bounded positive integer, so an unknown id, a negative, NaN, a float or an oversized number returns 400 with no state change (a test sends each); outcomes… (the rest: AB#820)

### Rats at launch: encounter chance with and without escort, choosing an escort, and the encounter report (Requirement AB#821, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.7 World Expansion plan line "Pirate (Rats) NPC enemies in asteroid fields", moved after v0.10 combat. The Board answered D-0.7-1 (AB#701): "We should be able to fight pirates by the time they're added." Rats therefore land once v0.10 has units, the combat resolver and fleets, and the player fights them with those. The visible half of escorts; hunting and the map are a separate new story. What it is. The expedition launch panel shows the encounter chance for the chosen belt and… (the rest: AB#821)

- [x] The chance shown equals the server's formula for the same inputs, with and without the selected escort (test comparing the rendered values with the server function).
- [x] Only fleets that are free and able to reach the belt are offered as escorts; others show why not.
- [x] The expedition report and its notification name the encounter, the battle result, escort losses and the haul outcome in words.
- [x] Screenshot of the launch panel with an escort selected and of one expedition report with a fought encounter, at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock) attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-164 Design the combat model: unit catalog, counters, accuracy and evasion, upkeep (Requirement AB#858, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. docs/design/v0.10-combat.md: every unit (light fighters, destroyers, siege engines, attack troops, defense troops) with cost, build time, upkeep, attack, defense, accuracy and evasion; the counter matrix; and a deterministic resolution algorithm, per the design goal that combat is "almost entirely deterministic/numbers-based". / Why it matters. The existing resolver is attack + defense times a caller-supplied… (the rest: AB#858)

- [x] The doc has the full unit table and a counter matrix (each unit type strong against one and weak against one), and a worked battle by hand with the round-by-round numbers.
- [x] Accuracy versus evasion is a stated formula (e.g. hit fraction = accuracy ÷ (accuracy + evasion), deterministic expected damage, no hidden dice); if any randomness is used it is seeded and the doc says why.
- [x] A no-dominant-composition argument: for three budgets, the best response to each pure composition is a different composition (rock-paper-scissors holds), shown in a table the v0.10-05 test will reproduce.
- [x] T-018: military size has an interior optimum because upkeep scales superlinearly with fleet size (or equivalent) against the economy that pays it; the doc shows the curve with numbers. Unpaid upkeep degrades readiness, never deletes units or locks the player out.
- [x] Where each unit is built (shipyard for ships, the doc decides where troops train) and what research gates them, using ids that exist or are added in v0.10-04.
- [x] Prior art cited: Lanchester's laws (why numbers scale non-linearly), OGame's round-based combat with rapid-fire counters, and Travian's attack/infantry-defense/cavalry-defense split as a three-way counter precedent.

### ISP-165 Design raids and mercenary contracts: lifecycle, windows, escrow and reports (Requirement AB#859, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. docs/design/v0.10-raids-mercenaries.md: what a raid targets (the plan says "station raiding", but players do not own stations until v0.12, so the doc defines the target as a corporation's holdings at a station), the declare, travel, warning, resolve lifecycle, and the mercenary contract lifecycle with escrow and structured terms. / Why it matters. Raids are the first system where one player takes from another… (the rest: AB#859)

- [x] Raid lifecycle states and transitions are listed, including the defender's warning window and how an offline defender is defended (garrison fights automatically; nothing requires being online, per DEPTH's rule that nothing may punish absence).
- [x] Loot, losses, protection and cooldown are written as D-0.10-1's options, marked "pending Board".
- [x] Mercenary contract fields are all numeric or enum (units, duration, price, collateral, allowed use: defense only / PvE / raids); no free text. Units under contract are escrowed, returned at expiry, and losses are paid from collateral by a stated formula.
- [x] Combat reports are private to the parties (not the global feed); the doc says what each side sees.
- [x] Security section: every raid and contract action is authenticated to the acting corporation, target ids are validated, and raids move value only through the v0.9 settlement ledger and a matching item-escrow primitive.
- [x] Prior art cited: EVE Online courier contracts with collateral (EVE University: Contracts) for mercenary escrow.

### ISP-166 Remove the unauthenticated combat simulator and the global combat-report feed (Requirement AB#860, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. POST /api/combat/simulate (server/index.js:3359) has no auth, writes attacker-supplied names into global state.combatReports (cap 50), persists them and broadcasts to every client; nothing in the client listens. Remove the route, the global feed and the dead client stub. / Why it matters. Real combat is about to be built; leaving a public endpoint that writes arbitrary text into shared state is exactly the… (the rest: AB#860)

- [x] POST /api/combat/simulate returns 404; state.combatReports is removed from the seed and migrated out of existing state files; renderCombatReports and the bootstrap copy are deleted.
- [x] Security. a test posts to the old route with a 10 KB name and asserts 404 and that no global state changed.
- [x] The existing createCombatReport test is replaced by nothing or by a test of the new private report shape (v0.10-14); it is not left testing dead code.

### ISP-167 Add the unit catalog as data, with schema and cross-catalog tests (Requirement AB#861, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. data/units.json holding the combat design's unit table, loaded by the server, with any new research ids added to the research catalog the server reads. / Why it matters. T-019: a requirement in one catalog that names something in another stops silently; units reference research and buildings, so the cross-check ships with the data. / Estimate: 1 session, assuming v0.10-01 is merged.

- [x] Every unit in the design table is in data/units.json with every field; a schema test loops all units.
- [x] Cross-catalog test: every research id, building id and resource named by a unit exists in its catalog, and tt-fleet-coordination ("+12 fleet cap", today advertised but never applied) is either applied to corp.unlocks.maxFleetSize or its effect text is changed, with a test either way (P-INERT-FEATURE).
- [x] The existing corp.military fields (lightFighters, destroyers, siegeEngines, attackValue, defenseValue) are mapped to the catalog or migrated, and the Overview "Military Power" card reads from the new source.

### ISP-168 Write the combat resolver with rock-paper-scissors counters (Requirement AB#862, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. A pure, deterministic resolveBattle(attacker, defender, modifiers) in its own server module, implementing the round algorithm and counter matrix from the combat design. / Why it matters. The counters are the whole of the tactical decision; a pure function is testable exhaustively in a way a route never is. / Estimate: 1 session, assuming v0.10-04 is merged.

- [x] The function is pure (no state, no I/O, no Date.now()) and returns survivors per side, per-round log and winner.
- [x] Counter test: for each unit type, an equal-cost force of its counter wins, and the table from the design doc's no-dominant-composition argument is reproduced by a test that loops it.
- [x] Hand-worked battle from the design doc is a test with the exact numbers.
- [x] Accuracy and evasion are accepted as inputs but fixed at the design's neutral value in this story; v0.10-06 adds them.

### ISP-169 Add accuracy and evasion to combat, with research and CEO modifiers (Requirement AB#863, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. Accuracy and evasion stats per unit applied in the resolver by the design's formula, with modifiers from research and the existing corp.military.modifiers.ceoLeadershipPct. / Why it matters. The design goal names this as the one non-trivial influence on deterministic combat; it is what makes a small, accurate fleet a real alternative to a big one. / Estimate: 1 session, assuming v0.10-05 is merged.

- [x] Tests at non-neutral values (P-IDENTITY-BLIND): a high-evasion defender against a low-accuracy attacker takes the formula's reduced damage, and the reverse; a test at the neutral value reproduces v0.10-05's results exactly.
- [x] Modifiers are read from server state only and bounded (a test sets an absurd modifier and asserts the design's cap applies).
- [x] The design doc's no-dominant-composition table still holds with modifiers at their maximum (test).

### ISP-170 Make the Orbital Shipyard a buildable corporation building (Requirement AB#864, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. A new corporation building type, the Orbital Shipyard, that takes a building slot, costs credits (and materials if the design says so), is gated by level and research, and is the prerequisite for ship production. / Why it matters. The plan makes the shipyard the gate for fleets; building it is the moment a player chooses military over another extractor, which is the trade-off the design wants. / Estimate: 1… (the rest: AB#864)

- [x] The shipyard is an entry in the building catalogue with cost, slot use, level gate and research gate from the design; a cross-catalog test covers its references.
- [x] Security. building it goes through the authenticated account routes; insufficient credits, no free slot, wrong level or missing research each reject with nothing debited (four tests).
- [x] Shipyard appears on the station/buildings view with its locked state explaining what is missing.
- [x] Screenshot of the buildings view with the shipyard locked (with reason) and built at 1440×900 and at 390×844 attached to the PR, taken from the running app (not a mock or a DOM dump).

### ISP-171 Build ships at the shipyard: a production queue for fighters, destroyers and siege engines (Requirement AB#865, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. A server production queue at the shipyard: queue N of a ship type, pay the catalog cost up front, complete on the tick after the build time, capped by corp.unlocks.maxFleetSize. / Why it matters. This is the plan's "fleet building" line; it uses the same authoritative queue pattern as research so completion cannot be forged. / Estimate: 1 session, assuming v0.10-07 is merged.

- [x] Queue route validates type (catalog enum), quantity (positive integer), shipyard present, cap not exceeded including queued units, and credits; each failure rejects with nothing debited.
- [x] Completion is tick-driven and idempotent (a test runs the tick twice past completion and gets the units once).
- [x] Security. the client cannot set build time or cost; a test posts both and the stored job uses catalog values.
- [x] Cancelling a queued job refunds the design's share and is tested.

### ISP-172 Train attack and defense troops (Requirement AB#866, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. A training queue for attack troops (needed to raid) and defense troops (garrison), trained where the combat design says, paid in credits and employees or whatever the design sets, completing on the tick. / Why it matters. The plan's troop line; defense troops are how an offline player is protected without having to be online. / Estimate: 1 session, assuming v0.10-04 is merged.

- [x] Training route validates type, quantity and the design's prerequisites; failures debit nothing.
- [x] If troops consume employees, the payroll and lease-employee rules (5 per lease) stay correct: a test trains troops and asserts leases still satisfy their employee requirement or the training is rejected.
- [x] Completion is idempotent on the tick (test).
- [x] Defense troops are assigned to a station garrison by default at the corporation's current station.

### ISP-173 Charge upkeep for ships and troops, degrading readiness when unpaid (Requirement AB#867, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. Daily upkeep per unit on the tick using the design's superlinear curve, recorded as an expense category, with unpaid upkeep lowering readiness (combat effectiveness) rather than deleting units. / Why it matters. Without upkeep, the optimal army is "as large as the cap", which is T-018 again; upkeep is also the credit sink warfare adds to an economy the Monetization review found has too few. / Estimate: 1 session,… (the rest: AB#867)

- [x] Upkeep appears under a named expense category in the ISP-1 statements; a test with fixture fleets of 10, 50 and 100 units shows cost per unit rising with size per the design curve.
- [x] Unpaid upkeep lowers a readiness value used by the resolver; units are never deleted and nothing else is locked (test asserts buildings, leases and access unchanged after 30 unpaid days).
- [x] Probe target (bot number): in the v0.10-20 probe, the planner bot's fleet size is below the cap in at least 80% of runs (interior optimum).

### ISP-174 Form, move and station fleets: fleet management on the server (Requirement AB#868, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. Fleets as named groups of units with a location; routes to form, split and merge fleets and to deploy a fleet to another station or system using the existing travel timing. / Why it matters. Where a fleet sits is the decision raids and defense turn on; the plan's deployment line needs server state before any screen. / Estimate: 1 session, assuming v0.10-08 and v0.10-09 are merged.

- [x] Unit conservation: forming, splitting and merging never changes total units by type (test loops random operations).
- [x] Deployment uses the existing travel duration rules and systems gated by level and research (tt-proxima-navigation, tt-deep-star-navigation); a fleet in transit cannot be used.
- [x] Security. fleet names are generated or chosen from a list, not free text; all ids validated as belonging to the acting corporation (a test tries to move another corp's fleet and gets 404).

### ISP-175 Fleet tab: units, production queues, fleets and deployment on one screen (Requirement AB#869, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. A Fleet tab that shows units by type with upkeep and readiness, the shipyard and training queues, fleets with location and status, and the deploy action. / Why it matters. The plan's "fleet management UI"; the upkeep and readiness numbers must be on screen next to the build buttons or the fleet-size decision is invisible. / Estimate: 1 session, assuming v0.10-11 is merged.

- [x] Units table shows count, attack, defense, accuracy, evasion and daily upkeep per type, and total upkeep.
- [x] Queues show time remaining; fleets show location, in-transit ETA, and readiness.
- [x] Deploy opens a destination picker with travel time and confirms before sending.
- [x] Text-first: every number is readable with graphics disabled (design goal).
- [x] Screenshot of the Fleet tab with two fleets, one in transit, and a non-empty production queue at 1440×900 and at 390×844 attached to the PR, taken from the running app (not a mock or a DOM dump).

### ISP-176 Mercenary contracts on the server: offer a fleet for hire, accept, escrow and return (Requirement AB#870, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. A corporation offers a fleet for hire with structured terms (duration, price, collateral, allowed use); another accepts; units move under the renter's command for the duration with price and collateral in escrow through the v0.9 settlement ledger, and return at expiry. / Why it matters. The plan's mercenary line and the design goal's "a corporation with a strong fleet but low activity can earn passive income";… (the rest: AB#870)

- [x] Offer fields are numeric or enum only; offering escrows the fleet (it cannot be used by the owner meanwhile).
- [x] Security. accepting escrows price plus collateral through settleTransfer; self-hire is rejected; accepting a withdrawn offer moves nothing; the renter cannot disband, sell or re-hire the units (tests for each).
- [x] At expiry (injected time) units return to the owner, price is paid to the owner, and collateral pays for any units lost by the design's formula, remainder to the renter (test with losses and without).
- [x] Allowed-use enforcement: a contract marked defense-only cannot join a raid (test). Raid use itself is exercised in v0.10-16.

### ISP-177 Mercenary Rentals on the Galactic Exchange: browse, offer and hire (Requirement AB#871, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. The real Mercenary Rentals panel on the Galactic Exchange: offers with unit mix, combat totals, duration, price and collateral; an offer form; and "my contracts" for both sides. This replaces the empty placeholder removed by AB#576. / Why it matters. The design goal puts mercenary rental on the market; showing combat totals beside the price is what lets a renter compare a hire with building their own fleet.… (the rest: AB#871)

- [x] Each offer row shows unit counts by type, total attack and defense, duration, price, collateral and allowed use.
- [x] The offer form previews the income and the collateral a renter must post.
- [x] My contracts shows active contracts with time left and, after expiry, the settlement (losses, collateral paid).
- [x] Screenshot of the Mercenary Rentals panel with two offers and one active contract at 1440×900 and at 390×844 attached to the PR, taken from the running app (not a mock or a DOM dump).

### ISP-178 Declare a raid: target eligibility, travel and the defender's warning window (Requirement AB#872, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. The Board answered D-0.10-1 (AB#705): "14 day new player protection. No offline protection. In a raid, buildings can be damaged (costs money to repair), units destroyed, resources taken." A route to declare a raid by an attacking fleet against another corporation's holdings at a station: a corporation founded less than 14 days ago cannot be targeted; nothing checks whether the defender is online. Assumptions… (the rest: AB#872)

- [x] A target founded 13 days 23 hours ago is refused and one founded 14 days ago is accepted (boundary tests on server time); an attacker inside its own 14 days is refused; the defender's online state is never read (a test raids a defender with no session). The cooldown and repeat-target limit each have a boundary test.
- [x] Security. The attacker is the authenticated corporation; the target id is validated; a raid on oneself, on a protected corporation, or with a fleet not at the origin is rejected with nothing changed. Raid declaration is rate-limited per attacker.
- [x] The defender receives an in-game notification naming the attacker, target station and arrival time; the notification never includes free text from the attacker.
- [x] The raid is persisted and survives a restart mid-travel (integration test).

### ISP-179 Resolve a raid: battle, losses, loot and private reports (Requirement AB#873, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. On arrival the tick resolves the raid with the combat resolver against the defender's garrison and any stationed fleets and hired mercenaries, applies unit losses, damages buildings, and takes resources from station inventory, and writes a private report to both sides. / Why it matters. This is where value actually changes hands between players; every rule here applies the Board's answer. The Board answered… (the rest: AB#873)

- [x] Loot is taken only from station inventory at the target station, up to the design's per-raid cap, moved through an item escrow in one mutation; credits are never taken; a test asserts the defender never loses more than the cap and that attacker gain equals defender loss.
- [x] Buildings at the target station take the damage the design derives from the battle result, through the building-damage function (test).
- [x] Unit losses follow the resolver; mercenary losses are settled per v0.10-13.
- [x] Private reports: attacker and defender each see the battle log (units, rounds, losses, loot); no global feed; a third corporation cannot read it (404 test).
- [x] The design's post-raid cooldown starts after the raid (test); no new-player protection is re-granted by being raided.

### ISP-180 Defend: set a garrison posture and reinforce during the warning window (Requirement AB#874, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. Defender actions: assign fleets and defense troops to a station garrison, choose a posture from the design's list, and send reinforcements that arrive before the raid if travel time allows. / Why it matters. The plan says "initiate and defend"; a defender who can only wait turns raiding into a tax on being offline. / Estimate: 1 session, assuming v0.10-16 is merged.

- [x] Garrison assignment and posture persist and are used by raid resolution (test: the same raid against two postures gives the design's different outcomes).
- [x] A reinforcement arriving before the raid joins the defense; one arriving after does not (test with injected time).
- [x] An offline defender with a garrison is defended automatically (test with no defender actions).

### ISP-181 Raid screens: choose a target, see an incoming raid, read the battle report (Requirement AB#875, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. Client for raiding: a target picker showing only eligible corporations with their protection state, an incoming-raid alert with countdown and a link to garrison, and the private battle report. / Why it matters. An incoming raid the defender does not notice is a loss they had no chance to answer; the alert is part of the rule, not decoration. / Estimate: 1 session, assuming v0.10-17 is merged.

- [x] The target picker lists only eligible targets and shows why others are not (new-player protection with days left, cooldown, repeat-target limit).
- [x] An incoming raid shows on the Overview and Fleet tab with attacker, station and arrival countdown, and a one-click route to the garrison.
- [x] The battle report shows rounds, losses per side, resources taken and building damage with its repair cost, in text-first form.
- [x] Screenshot of the target picker, an incoming-raid alert on Overview, and a battle report at 1440×900 and at 390×844 attached to the PR, taken from the running app (not a mock or a DOM dump).

### ISP-182 Write the Board's never-sell list for military mechanics into the brief (Requirement AB#876, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. Add the Board's answer to D-0.10-2 (AB#706), "All", to the ISP BRIEF.md monetization section: every military mechanic v0.10 introduces may never be sold or accelerated for real money. Named: units and troops, build and training time, shields and protection, upkeep and readiness, fleet cap, raid cooldowns, mercenary terms, and building repair. No cosmetic carve-out is recorded, because the Board did not grant… (the rest: AB#876)

- [x] BRIEF.md quotes the Board's answer with AB#706 and names each mechanic listed above, and says anything military not listed is covered too.
- [x] If the monetization guard test exists, it gains a case for data/units.json; if not, the PR says so.

### ISP-183 Extend the ISP probe with a combat profile: counters, fleet size and raid value (Requirement AB#877, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. / What it is. A bot profile that plays shipyard, production, upkeep and simulated raids between bot corporations and prints the numbers the v0.10 stories claim. / Why it matters. The counter matrix and upkeep curve are claims about decisions; only a probe shows no composition dominates and that raiding does not beat producing (the BRIEF's audience is "bored by the combat half"). / Estimate: 1 session, assuming v0.10-10 is… (the rest: AB#877)

- [x] Printed as bot numbers: win rates of each pure composition against each other at three budgets; planner fleet size as a fraction of the cap; net worth at day 30 for a producer bot, a raider bot and a mixed bot.
- [x] Targets: no composition wins more than 60% of matchups across budgets; planner fleet size is below the cap in at least 80% of runs; the pure raider bot does not beat the producer bot on net worth at day 30 (raiding complements the economy, it does not replace it). Misses are reported and filed, not lowered.
- [x] The raid part runs against the resolver with D-0.10-1's caps once answered; before then it runs combat only and says so.

### ISP-284 Hunt Rats: send a fleet to fight a belt's pirates (server) (Requirement AB#991, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.7 World Expansion plan line "Pirate (Rats) NPC enemies in asteroid fields", moved after v0.10 combat because the Board answered D-0.7-1 (AB#701): "We should be able to fight pirates by the time they're added." What it is. A route that sends a fleet to an asteroid belt to attack its Rats. On arrival the combat resolver fights the fleet against the belt's Rat group from docs/design/rats.md; a win pays the design's bounty and lowers that belt's encounter chance for the design's… (the rest: AB#991)

- [x] A hunt against a fixture belt resolves deterministically for a fixed seed; a win pays the bounty through settleTransfer from the NPC source and lowers the belt's encounter chance for the quiet period, then it returns (tests with injected time).
- [x] A fleet on a hunt cannot escort, raid or deploy until it returns (test).
- [x] Probe target (bot number): the bounty and quiet period make hunting worth it in high-density belts and not in Sol, shown by the design's arithmetic reproduced in a test.
- [x] Security: the fleet must be the caller's and free; the belt id is validated; a hunt on an unknown belt or with another corporation's fleet returns 400 with no state change; outcomes are server-computed; hunts are rate-limited per corporation.

### ISP-285 Pirates on the map: activity per system and a hunt action from the belt (Requirement AB#992, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.7 World Expansion plan line "Pirate (Rats) NPC enemies in asteroid fields", moved after v0.10 combat (D-0.7-1, AB#701). What it is. The starmap's cluster view shows each system's pirate activity with a legend, and a belt shows its current encounter chance and a "Hunt" action that picks a free fleet and shows the expected battle before sending; the hunt's result uses the v0.10 battle report. Why it matters. Pirates the player cannot find on the map cannot be fought. Estimate: 1… (the rest: AB#992)

- [x] Pirate activity shown per system matches the server's value (test), and a belt in its quiet period shows so.
- [x] The hunt action lists only free fleets that can reach the belt and shows the expected result before sending.
- [x] Screenshot of the cluster view with pirate activity, a belt's hunt panel, and a hunt battle report at 1440x900 and 390x844, taken from the running game after performing the action (not a mock) attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-287 Raids damage buildings, and damaged buildings cost credits to repair (Requirement AB#994, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), under the ISP epic AB#388. The Board answered D-0.10-1 (AB#705): "buildings can be damaged (costs money to repair)". / What it is. A damage level on each building, applied by raid resolution from the battle result, and a repair action that costs credits in proportion to damage. Assumptions for what the answer leaves open: damage never destroys a building; a damaged building produces at reduced output until repaired (otherwise repair would never be… (the rest: AB#994)

- [x] A raid result applies the design's damage to buildings at the target station; damage is capped below destruction (test at the cap).
- [x] A damaged building's output falls by the design's rule and returns to full on repair (test).
- [x] Repair debits the design's cost through settleTransfer (repair); insufficient credits repairs nothing (test).
- [x] Security: only the owner can repair; the building id is validated; the cost is server-computed.
- [x] Screenshot of a damaged building with its repair cost and action at 1440x900 and 390x844, from the running game after a test raid attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### Rats: let a hired mercenary fleet escort an expedition (server) (Requirement AB#4678, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.10 Warfare (Feature AB#394), Rats in asteroid fields (docs/design/rats.md section 3). Split from AB#820, which built escorts from the caller's own fleets only. / What it is. The design allows a hired mercenary fleet to escort an expedition when its contract permits pve or raids (mercenaryUseAllowed, AB#870). Launch-expedition takes a hired contract id as the escort; the fleet is committed on its owner's books until the expedition ends; its losses go through recordContractLosses… (the rest: AB#4678)

- [x] A hired fleet whose contract allows pve or raids escorts an expedition; a defense-only contract is refused (test).
- [x] Escort losses are recorded against the contract and settle from the collateral (conservation test).
- [x] A contract that ends while its fleet escorts waits for the expedition to come home (test), as a raid does.

## Held back

Not dispatched: each of these waits on something a Builder session cannot supply, named on its "Held" line. Its lines stay as its acceptance for when it opens. The headings are level 4 so that dispatch, which reads level-3 headings as slices, skips them (PM, 2026-10-01).

#### ISP v0.10: the combat probe's misses: raiding out-earns producing, and light-fighter fleets hit the cap (AB#877 targets failed) (Requirement AB#4650, Proposed) (lane: interstellar-settlement-protocol/combat)

Held (2026-10-01): balance tuning (raiding out-earns producing; light-fighter fleets hit the cap), and it needs a call on which lever moves. Waits for the Board's economy review (AB#4779, AB#4881).

What: Where it sits. v0.10 Warfare (Feature AB#394). This is the follow-up AB#877 promised: two probe targets failed, and they were not lowered. / What the probe showed (npm run probe:combat; bot numbers, P-PROXY: bots on the design's assumed business and fixed policies, not players). (1) Over 4 raid profiles and 30 days, the pure raider beat the average producer on net worth in all 4: 281,572 vs 258,195 at 200k capital with a 2% garrison, and 509,676 vs 448,968 at 400k. The mixed bot beat both by… (the rest: AB#4650)

- [ ] A Director or Board call, with the probe table as evidence, names what changes: the loot share or floor, the repeat limit across all attackers, the cooldown, garrison economics, or smarter defender bots in the probe (a producer that rebuilds its garrison or keeps a counter fleet). A change to the probe's defender policy must be argued as closer to play, not chosen to pass.
- [ ] After it, npm run probe:combat shows the pure raider not beating the producer at day 30 in most profiles, or the design records why that target was replaced.
- [ ] The fleet-size target (below the cap in 80% of runs) is met or explicitly reframed, for example as counted in supply rather than hulls.
- [ ] The counter matrix and the five-way cycle still pass.

#### Balance: destroyers appear in no top-quartile fleet composition (best is 24th of 70) (Bug AB#4875, Proposed) (lane: interstellar-settlement-protocol/combat)

Held (2026-10-01): balance tuning: a number change (destroyer attack 34 to 40) for the 1.0 balance pass (AB#968). Waits for the Board's economy review.

What: ISP combat, the v0.10 unit set (data/units.json), the v1.0 final balance pass. AB#966's fleet composition tournament (tests/probes/tournamentProbe.js, npm run probe:tournament) sets 70 compositions against each other: the budget in quarters over the five units, whole units at replacement value, both roles, budgets 30,000, 120,000 and 480,000, and four modifier sets a side. That is 231,840 battles through the real resolver. The target is that every unit type appears in at least one top-quartile… (the rest: AB#4875)
Repro: Symptom: the report prints "FAIL every unit type is in at least one top-quartile composition: missing ds". Repro: in the ISP repo, npm run probe:tournament -- --out <dir> (about 80 seconds); the report, raw JSON and chart are attached to AB#966.
Proposed fix: Data change in data/units.json, for AB#968 (not applied here). Each option below was measured by running the full tournament against a temporary catalog edit: / - Destroyer attack 34 to 40 (recommended, the smallest that works): the best destroyer composition ranks 18th of 70, one composition in the top quartile, and every other target still passes (best win rate 22.1%, fully invested defender 4.7% to 14.7%). / - Destroyer credits 3,350 to 2,600: ranks 5th, 9 of the top 18 hold destroyers, best win… (the rest: AB#4875)

- [ ] Fixed: Balance: destroyers appear in no top-quartile fleet composition (best is 24th of 70)

## Demo script

_To be written._
