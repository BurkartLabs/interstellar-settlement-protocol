# Desk Work: Bureau field assignments and Bureau Standing, an effort-paced loop beside the time-paced ladder (AB#4689)

Product: interstellar-settlement-protocol · Version: not yet on the roadmap (DEVELOPMENT_PHASES.md) · Lanes: interstellar-settlement-protocol/economy, client-views, platform

Migrated from Azure DevOps on 2026-09-30 (AB#4889) and rewritten as slices by the PM on 2026-10-01. The design is docs/design/desk-work.md. The Board accepted it, section 11 included, on 2026-09-28 (Decision AB#4704: "Yes"), so the faucet numbers, the public grade, a survey counting as scouting, priority processing at 5% and the two names stand as the design proposes them.

## Why

The Board asked on 2026-09-27 for something that keeps players playing for longer stretches, rewards effort and not waiting, has little or no gate, and carries an XP track beside the milestone ladder. The Depth Critic has scored return reason 2, mastery 1 to 2 and decision density 2 three reviews running (DEPTH.md): day 1 is thirty minutes of setup and then hours of waiting on cycles and research. Desk Work is a second kind of Bureau assignment beside delivery contracts: short Surveys, Audits and Dispatches a corporation with an office can work at any hour, each a document built and graded on the server from the game's own data and rules, paid in a small bounded fee and in Bureau Standing. It answers the Board's ask and the Critic's three lowest gates with one system, and it wires up pieces that are half built (Bureaucratic Persuasion, the Starmap resource overlay, Voss's reputation tiers).

## Acceptance

1. A corporation with an office and 0 credits opens the Desk on the Assignments tab, finds three packets, answers one correctly, and is paid its tier's fee and its standing points. There are always exactly three open packets, and no timer stands in front of any of them.
2. A wrong answer pays nothing and costs nothing, and the receipt quotes the rule. Nothing on the screen counts down, flashes or turns red.
3. Bureau Standing is one number fed by contracts (10 points each) and desk packets (1, 2 or 3 by tier). A save from before the change shows the same grade as it did. Tier 2 opens at Recognized and tier 3 at Trusted, with the perks in the design's section 4.
4. Standing and desk work never satisfy a ladder requirement: no milestone reads a desk stat, and a desk packet never counts as a contract (a test fails if either is tried).
5. Security: the server generates each packet's truth and stores its key; nothing in a request can set the truth or the grade, and an answer to a packet that is spent or not found pays nothing (it fails closed). Desk pay goes through applyCredits under its own ledger category and is capped per UTC day. No real money touches standing, tiers, packets or pay (BRIEF.md, AB#980).
6. Probes (bots, not players): a rules-aware bot earns at least three times the standing of a random bot in a simulated hour. ECONOMY.md gives the time a broke corporation needs to earn an office's rent at the Desk, computed from the data.

## Slices

Order: slices 1 to 4 need nothing and can go in any order. Slice 5 needs 1 to 4. Slices 6 to 12 need 5. A Builder handed a slice whose earlier slices are not ticked on main releases it and says which one it waits on.

### Slice 1: The desk data block, and the Survey generator and grader (lane: interstellar-settlement-protocol/economy)

Was part of Requirement AB#4695. Design sections 5 (Survey) and 3, rule 3. origin/agent/4695-desk-generators holds a start (d8ec271c): the `desk` block in data/economy.json only. Begin from it. `auditTwoClauseSharePct` 50 in that block was its author's guess; keep it and say so in the pull request.

- [x] data/economy.json has the `desk` block (openPackets, payByTier 40/80/160, pointsByTier 1/2/3, paidAssignmentsPerDay 20, overCapPayPct 25, noise and tolerances), and the schema test knows it.
- [x] server/game/desk.js has a pure, seeded Survey generator and grader for tiers 1 to 3: the same seed and data yield the same packet twice.
- [x] tests/unit/desk.test.js draws 1000 Survey packets per tier from seeds; every stored answer grades correct and every distractor grades incorrect.
- [x] Survey subjects at tier 1 are Sol only; tier 2 only systems the corporation can reach; tier 3 rare or exotic belts.

### Slice 2: The Audit generator and grader (lane: interstellar-settlement-protocol/economy)

Was part of Requirement AB#4695. Design section 5 (Audit).

- [x] server/game/desk.js generates and grades Audit packets for tiers 1 to 3, pure and seeded as the Survey is.
- [x] Every Audit clause maps to a rule the server already enforces (lease headcount, office-before-lease, slots, lease price, ITC line, royalty, quota, yard growth, upgrade tier, deployments, conglomerate cap), and its graded explanation quotes that rule in one sentence.
- [x] The test draws 1000 Audit packets per tier; every stored answer grades correct and every distractor incorrect.

### Slice 3: The Dispatch generator and grader (lane: interstellar-settlement-protocol/economy)

Was part of Requirement AB#4695. Design section 5 (Dispatch), and "Why no single kind is always best".

- [x] server/game/desk.js generates and grades Dispatch packets for tiers 1 to 3 from the real fee and transit tables (server/transfers.js), pure and seeded.
- [x] A numeric answer is graded within the tolerance in the `desk` block, and the test covers both edges of the tolerance.
- [x] The test draws 1000 Dispatch packets per tier; every stored answer grades correct and every distractor incorrect.

### Slice 4: Bureau Standing as points (lane: interstellar-settlement-protocol/economy)

Was Requirement AB#4696. Design section 4. `agentReputation[agent].completedCount` becomes `points`; saves migrate as points = completedCount x 10; data/missions.json reputationTiers thresholds multiply by `desk.reputationThresholdMultiplier` (10).

- [ ] A save with completedCount 7 loads as points 70 and grade Reliable, identical to before.
- [ ] Completing a contract adds exactly 10 points (11 or 12 with Bureaucratic Persuasion, rounded as the code documents).
- [ ] Unit tests cover migration, the multiplier and the insight bonus; the completion receipt (AB#744) still reports the grade.

### Slice 5: Desk routes and state (lane: interstellar-settlement-protocol/economy)

Was Requirement AB#4697. Design section 3, rules 1 to 4, 6 and 7. `GET .../desk` returns three open packets (drawn on demand, seeded per corporation), the grade, the points and today's paid count; `POST .../desk/answer` grades on the server and pays through applyCredits under a new ledger category `desk`; `POST .../desk/decline` is free. Rate limits as the other gameplay routes have them.

- [ ] A corporation with an office and 0 credits can open, answer and be paid for a packet; one without an office gets the section-coded refusal.
- [ ] A wrong answer pays 0 and costs 0; the packet is spent and replaced; there are always exactly three open.
- [ ] The 21st correct answer of a UTC day pays 25 percent of its tier fee; the 21st still adds full points.
- [ ] Payments appear in the ledger under desk and in the receipts feed; integration tests cover answer, decline, cap rollover at midnight UTC and the no-office case.
- [ ] The request body can set neither the packet truth nor the grade (T-019 test: a tampered answer payload is graded against the stored key), and an answer to a spent or unknown packet pays nothing.
- [ ] Completing ten desk packets leaves completedMissions and missionsCompletedTotal unchanged, and increments stat:deskCompleted and stat:deskCompleted:<kind> (integration test).

### Slice 6: Survey payoffs on the server: a correct survey scouts a belt (lane: interstellar-settlement-protocol/economy)

Was part of Requirement AB#4698. Design section 5 (Survey) and the Board's decision 5. A correct tier-2 or tier-3 Survey marks the belt scouted for its current generation in asteroidMining.scoutedBelts, the field a probe writes, so conglomerate intel shares it.

- [ ] After a correct tier-2 belt survey, GET starmap shows the belt scouted for the current generation exactly as after a probe; after the belt respawns it is unscouted again.
- [ ] A correct survey of a lease body stores the body's resource profile for that corporation only.
- [ ] A wrong survey publishes nothing.

### Slice 7: Survey payoffs on the Starmap overlay (lane: interstellar-settlement-protocol/client-views)

Was part of Requirement AB#4698. Needs slice 6. The design says the Starmap's resource overlay "does nothing" today (AB#2479 investigated it): read what that investigation found on main first, and say in the pull request what the overlay showed before and shows after.

- [ ] The resource overlay shows surveyed profiles for the corporation only; another corporation sees nothing unless conglomerate intel shares it.
- [ ] Screenshot of the overlay with one surveyed body, at 1280x800 and 375x812, attached to the pull request (P-001).

### Slice 8: Grade perks (lane: interstellar-settlement-protocol/economy)

Was Requirement AB#4699. Design section 4, the perks table. Tier 2 packets from Recognized, tier 3 from Trusted; CONTRACTS_PER_AGENT becomes per-corporation (2, 3 at Recognized, 4 at Distinguished); CONTRACT_REFRESH_MS becomes per-corporation (2 h, 1 h at Trusted); priority processing at Valued; the grade on the public card.

- [ ] A Recognized corporation sees three contracts and can draw tier-2 packets; a Trusted one refreshes hourly and draws tier 3; below those grades the old values hold.
- [ ] Lease and rent charges at Valued are reduced by exactly priorityProcessingPct; Exchange settlement code is untouched (the diff shows no change under marketSettlement or buyOrders).
- [ ] The public card shows the grade title; a corporation with 0 points shows Unknown.
- [ ] Unit tests per perk; the ladder test suite still passes with no milestone changed.

### Slice 9: The Desk on the Assignments tab (lane: interstellar-settlement-protocol/client-views)

Was Requirement AB#4700. Design section 2 and docs/design/BUREAUCRATIC_UI.md. A Desk section beside the delivery contracts: three packet cards (reference number, division, kind, tier, fee, points), the opened packet as a document, the answer controls (a pick, a ranking, a number), the graded receipt with the rule, and the standing progress.

- [ ] Screenshots at 1280x800 and 375x812 of the Desk list, an open Survey, an open Audit, an open Dispatch and a graded receipt, attached to the pull request (DOCTRINE P-001).
- [ ] Every text string passes the design allowlist check (data/design-allowlist.json) and carries a section code.
- [ ] Answer and decline work end to end against slice 5's routes in the scripted playtest; a wrong answer shows the rule, not a penalty.
- [ ] Nothing on the screen counts down, flashes or turns red (anticipation, never loss-aversion).

### Slice 10: The probes: desk-mastery and desk-decisions (lane: interstellar-settlement-protocol/economy)

Was part of Requirement AB#4701. Design section 8. These are bot numbers (P-PROXY). If a target misses, report the number and stop: do not retune the faucet to hit it (economy tuning waits for the Board's review, AB#4779).

- [ ] `npm run probe:desk-mastery` and `npm run probe:desk-decisions` run from origin/main, exit 1 on failure, and print what they measure in their first line (bots, not players).
- [ ] desk-mastery: a random bot and a rules-aware bot each work the Desk for one simulated hour, and the output shows both totals and the ratio at each tier.
- [ ] DEPTH.md gains a line under mastery and decision density naming the probe and its current number, marked as a bot number.

### Slice 11: ECONOMY.md: the desk faucet joins the model (lane: interstellar-settlement-protocol/economy)

Was Requirement AB#4702, plus AB#4695's documentation line. Design section 7.

- [ ] Every key in the `desk` block of data/economy.json has a row in ECONOMY.md with a reason; ECONOMY.md's check script (if present) passes.
- [ ] The model output includes desk income for the planner, greedy and reserve profiles at the cap.
- [ ] The broke section names both paths back (salvage and the Desk) and their times, computed from the data, not typed.

### Slice 12: The cross-catalog guard: no milestone metric may name a desk stat (lane: interstellar-settlement-protocol/platform)

Was Requirement AB#4703. Design section 6 and rule 7. It stands alone and can go at any time.

- [x] Adding a milestone with metric stat:deskCompleted, or one that reads agentReputation points, fails tests/schema/data-files.test.js with a message naming this rule.

## Held back

Not dispatched: each of these waits on something a Builder session in this repo cannot supply, named on its "Held" line. The headings are level 4 so that dispatch, which reads level-3 headings as slices, skips them (PM, 2026-10-01).

#### The desk move in isp-runway.ts, and the broke-recovery assertion (was part of Requirement AB#4701)

Held (2026-10-01): ops/probes/isp-runway.ts is in hq, not in this repo, so this is a slice for the orchestrata engine lane. The PM files it there when slice 5 is on main.

- [ ] isp-runway.ts's ledger summary has a desk row; the --broke scenario asserts the one-hour recovery.

## Demo script

On the deployed build, with a fresh account. Screenshots at 1280x800 and 375x812 where a step says "look".

1. Register, rent an office, and spend every credit. Open Assignments: the Desk shows three packets beside the delivery contracts. Look.
2. Open a Survey, answer it correctly: the receipt shows the tier's fee and points, the ledger shows a `desk` row, and a new packet has replaced it. Look at the receipt.
3. Open an Audit and answer it wrongly: no pay, no cost, and the receipt quotes the rule that was broken, with nothing in red.
4. Decline a Dispatch: it is replaced at once, and standing is unchanged.
5. Answer correctly until Recognized: tier 2 packets appear, and the Bureau board offers a third contract.
6. Answer a tier-2 belt Survey correctly, then open the Starmap: the belt is marked scouted, and the resource overlay shows the surveyed profile. Look.
7. Open the corporation's public card from another account: it shows the grade.
8. Open Milestones: no requirement mentions the Desk or Bureau Standing.

## Out of scope

- Phase 2 in the design's section 10: Analysts, the Commendation board, Sponsorship at Esteemed, and a quest-spine beat.
- Audits earning ITC standing, and market geography for Dispatch tiers 2 and 3 (section 10, "does not settle").
- Any change to the faucet's numbers after the probes run: that is economy tuning, and it waits for the Board's economy review (AB#4779, AB#4881).
