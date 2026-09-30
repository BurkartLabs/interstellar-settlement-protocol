# Desk Work: Bureau field assignments and Bureau Standing, an effort-paced loop beside the time-paced ladder

Feature AB#4689 (Proposed) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits. ISP epic AB#388. Board, in chat, 2026-09-27: come up with functionality that keeps players enthralled for longer stretches, rewards effort rather than waiting, has little or no gate (or one that allows at least an hour of straight play), and carries some sort of XP system alongside the milestone ladder. The Depth Critic has scored return reason 2 (a timer, not anticipation), mastery 1-2 (nothing for skill to bite on) and decision density 2 three reviews running (DEPTH.md); day 1 is thirty minutes of setup and then hours of waiting on cycles and research.
What it is. A second kind of Bureau assignment beside delivery contracts: short desk assignments (Surveys, Audits, Dispatches) a licensed CEO can work at any time from any station, each a document built on the server from the game's own data and rules, graded on the server, paid in a bounded trickle of credits and in Bureau Standing, an effort-paced XP track that extends Voss's existing reputation tiers and unlocks access and ISA-facing perks, never ladder levels. The design is docs/design/desk-work.md in the product repo.
Why it matters. It answers the Board's ask and the Critic's three lowest gates with one system, and it wires up several half-built pieces (Bureaucratic Persuasion, the Starmap resource overlay, Voss's reputation tiers) instead of adding another inert one.

## Acceptance

_To be written: the Feature had no acceptance criteria in Azure DevOps._

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 9 open, 0 resolved.

### Desk packet generators and graders (surveys, audits, dispatches) (Requirement AB#4695, Proposed) (lane: interstellar-settlement-protocol/economy)

What: Where it sits: Feature AB#4689 Desk Work and Bureau Standing, docs/design/desk-work.md section 5 and rule 3. Opens only after the Board answers the Decision in section 11 (see the Decision Issue under the same Feature); until then it stays Proposed and is not agent-ready. / What: server/game/desk.js with a pure, seeded generator and grader per kind and tier: Survey (noisy readings of a real body or belt from data/systems.json and the live belt state; tier 1 dominant resource, tier 2 top three… (the rest: AB#4695)

- [ ] tests/unit/desk.test.js draws 1000 packets per kind per tier from seeds; every stored answer grades correct and every distractor grades incorrect.
- [ ] Generators are pure functions of (seed, data): the same seed yields the same packet twice.
- [ ] Every Audit clause maps to a rule the server already enforces (lease headcount, office-before-lease, slots, lease price, ITC line, royalty, quota, yard growth, upgrade tier, deployments, conglomerate cap) and its graded explanation quotes that rule in one sentence.
- [ ] Survey subjects at tier 1 are Sol only; tier 2 only systems the corporation can reach; tier 3 rare or exotic belts.
- [ ] The desk block in data/economy.json is documented in ECONOMY.md with reasons (story 8).

### Bureau Standing as points: migrate completedCount, thresholds x10, contracts worth 10 (Requirement AB#4696, Proposed) (lane: interstellar-settlement-protocol/economy)

What: Where it sits: Feature AB#4689 Desk Work and Bureau Standing, docs/design/desk-work.md section 4. Opens only after the Board answers the Decision in section 11 (see the Decision Issue under the same Feature); until then it stays Proposed and is not agent-ready. / What: agentReputation[agent].completedCount becomes points; existing saves migrate as points = completedCount x 10; data/missions.json reputationTiers thresholds multiply by desk.reputationThresholdMultiplier (10) so every current grade… (the rest: AB#4696)

- [ ] A save with completedCount 7 loads as points 70 and grade Reliable, identical to before.
- [ ] Completing a contract adds exactly 10 points (11 or 12 with Bureaucratic Persuasion, rounded as the code documents).
- [ ] Unit tests cover migration, the multiplier and the insight bonus; the completion receipt (AB#744) still reports the grade.
- [ ] No milestone in data/milestones.json reads points or any desk stat (story 9 guard passes).

### Desk routes and state: open packets, answer, decline, daily pay cap, ledger category (Requirement AB#4697, Proposed) (lane: interstellar-settlement-protocol/economy)

What: Where it sits: Feature AB#4689 Desk Work and Bureau Standing, docs/design/desk-work.md rules 1 to 4 and 6. Opens only after the Board answers the Decision in section 11 (see the Decision Issue under the same Feature); until then it stays Proposed and is not agent-ready. / What: GET .../desk returns three open packets (drawn on demand, seeded per corporation), the grade, points and today's paid count; POST .../desk/answer grades server-side, pays through applyCredits under a new ledger category… (the rest: AB#4697)

- [ ] A corporation with an office and 0 credits can open, answer and be paid for a packet; one without an office gets the section-coded refusal.
- [ ] A wrong answer pays 0 and costs 0; the packet is spent and replaced; there are always exactly three open.
- [ ] The 21st correct answer of a UTC day pays 25 percent of its tier fee; the 21st still adds full points.
- [ ] Payments appear in the ledger under desk and in the receipts feed; integration tests cover answer, decline, cap rollover at midnight UTC and the no-office case.
- [ ] The request body can set neither the packet truth nor the grade (T-019 test: a tampered answer payload is graded against the stored key).

### Survey payoffs: a correct survey scouts a belt and publishes a body profile to the Starmap (Requirement AB#4698, Proposed) (lane: interstellar-settlement-protocol/economy)

What: Where it sits: Feature AB#4689 Desk Work and Bureau Standing, docs/design/desk-work.md section 5, Survey, and Decision 5. Opens only after the Board answers the Decision in section 11 (see the Decision Issue under the same Feature); until then it stays Proposed and is not agent-ready. / What: a correct tier-2 or tier-3 Survey marks the belt scouted for its current generation (asteroidMining.scoutedBelts, the same field a probe writes, so conglomerate intel in server/game/intel.js shares it… (the rest: AB#4698)

- [ ] After a correct tier-2 belt survey, GET starmap shows the belt scouted for the current generation exactly as after a probe; after the belt respawns it is unscouted again.
- [ ] A wrong survey publishes nothing.
- [ ] The resource overlay shows surveyed profiles for the corporation only; another corporation sees nothing unless conglomerate intel shares it.
- [ ] Screenshot of the overlay with one surveyed body attached to the PR (P-001).

### Grade perks: tier gates, third and fourth contract slot, hourly board, priority processing, public grade (Requirement AB#4699, Proposed) (lane: interstellar-settlement-protocol/economy)

What: Where it sits: Feature AB#4689 Desk Work and Bureau Standing, docs/design/desk-work.md section 4 perks table and Decisions 4 and 6. Opens only after the Board answers the Decision in section 11 (see the Decision Issue under the same Feature); until then it stays Proposed and is not agent-ready. / What: tier 2 packets from Recognized, tier 3 from Trusted; CONTRACTS_PER_AGENT becomes per-corporation (2, 3 at Recognized, 4 at Distinguished); CONTRACT_REFRESH_MS becomes per-corporation (2 h, 1 h at… (the rest: AB#4699)

- [ ] A Recognized corporation sees three contracts and can draw tier-2 packets; a Trusted one refreshes hourly and draws tier 3; below those grades the old values hold.
- [ ] Lease and rent charges at Valued are reduced by exactly priorityProcessingPct; Exchange settlement code is untouched (diff shows no change under marketSettlement/buyOrders).
- [ ] The public card shows the grade title; a corporation with 0 points shows Unknown.
- [ ] Unit tests per perk; the ladder test suite still passes with no milestone changed.

### The Desk on the Assignments tab: packet document, answer controls, graded receipt, standing progress (Requirement AB#4700, Proposed) (lane: interstellar-settlement-protocol/economy)

What: Where it sits: Feature AB#4689 Desk Work and Bureau Standing, docs/design/desk-work.md section 2 and docs/design/BUREAUCRATIC_UI.md. Opens only after the Board answers the Decision in section 11 (see the Decision Issue under the same Feature); until then it stays Proposed and is not agent-ready. / What: a Desk section beside the delivery contracts: three packet cards (reference number, division, kind, tier, fee, points), the opened packet as a document (readings table with reference profiles,… (the rest: AB#4700)

- [ ] Screenshots at 1280x800 and 375x812 of the Desk list, an open Survey, an open Audit, an open Dispatch and a graded receipt, attached to the PR (DOCTRINE P-001), and the Board is shown them.
- [ ] Every text string passes the design allowlist check (data/design-allowlist.json) and carries a section code.
- [ ] Answer and decline work end to end against the routes in story 3 in the scripted playtest; a wrong answer shows the rule, not a penalty.
- [ ] Nothing on the screen counts down, flashes or turns red (anticipation, never loss-aversion).

### Probes: desk-mastery, desk-decisions, a desk move in isp-runway, the broke-recovery assertion (Requirement AB#4701, Proposed) (lane: interstellar-settlement-protocol/economy)

What: Where it sits: Feature AB#4689 Desk Work and Bureau Standing, docs/design/desk-work.md section 8. Opens only after the Board answers the Decision in section 11 (see the Decision Issue under the same Feature); until then it stays Proposed and is not agent-ready. / What: ops/probes/desk-mastery (a random bot and a rules-aware bot each work the Desk for one simulated hour; the rules-aware bot must earn at least 3x the standing and its lead must grow at tiers 2 and 3), ops/probes/desk-decisions (for… (the rest: AB#4701)

- [ ] Both new probes run from origin/main with npm run probe:desk-mastery and probe:desk-decisions, exit 1 on failure, and print what they measure in their first line (bots, not players).
- [ ] isp-runway.ts ledger summary has a desk row; the --broke scenario asserts the one-hour recovery.
- [ ] DEPTH.md gains a line under mastery and decision density naming the probe and its current number, marked as a bot number.

### ECONOMY.md: the desk faucet joins the model, the yard tables recomputed, the way back from broke (Requirement AB#4702, Proposed) (lane: interstellar-settlement-protocol/economy)

What: Where it sits: Feature AB#4689 Desk Work and Bureau Standing, docs/design/desk-work.md section 7. Opens only after the Board answers the Decision in section 11 (see the Decision Issue under the same Feature); until then it stays Proposed and is not agent-ready. / What: the desk keys join ECONOMY.md's tunables table with their reasons; the model output gains the Desk as a faucet at the daily cap per tier beside missions and salvage; the yard tables are shown beside an hour and three hours of desk… (the rest: AB#4702)

- [ ] Every key in data/economy.json desk has a row with a reason; ECONOMY.md's check script (if present) passes.
- [ ] The model output includes desk income for the planner, greedy and reserve profiles at the cap.
- [ ] The broke section names both paths and their times, computed from the data, not typed.

### Cross-catalog guard: no milestone metric may name a desk stat (Requirement AB#4703, Proposed) (lane: interstellar-settlement-protocol/platform)

What: Where it sits: Feature AB#4689 Desk Work and Bureau Standing, docs/design/desk-work.md section 6 and rule 7. Opens only after the Board answers the Decision in section 11 (see the Decision Issue under the same Feature); until then it stays Proposed and is not agent-ready. / What: tests/schema/data-files.test.js asserts that no metric in data/milestones.json begins stat:desk or reads agentReputation points, and that desk completion does not push completedMissions or bump missionsCompletedTotal (a… (the rest: AB#4703)

- [ ] Adding a milestone with metric stat:deskCompleted fails the schema test with a message naming this rule.
- [ ] Completing ten desk packets leaves completedMissions and missionsCompletedTotal unchanged (integration test).

## Demo script

_To be written._
