# ISP v0.12 — Conglomerates

Feature AB#396 (Proposed) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits: v0.12 on the ISP roadmap (DEVELOPMENT_PHASES.md in the product repo), under the product epic.
What it is for: Guilds, in corporate dress. The social layer the rest of the game has been feeding: shared intel, pooled resources, co-owned stations.
What it contains:
- Conglomerate creation and membership
- Conglomerate levelling and capacity upgrades (5 to 100 members)
- Resource pooling and shared intel
- Co-owned conglomerate stations
- Private messaging between players
- Starmap corp and conglomerate dominance overlay
Each line becomes a story when this version is next. They are listed here rather than filed as work items so the backlog shows what is ready to be worked, not everything that has ever been planned (TRACKING.md).

## Acceptance

_To be written: the Feature had no acceptance criteria in Azure DevOps._

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 2 open, 32 resolved.

### ISP-220 Run the v0.12 milestone playthrough and look at every new screen (Requirement AB#915, Active) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate creation and membership system". Verifies all six lines; last story of the version. What it is. A human-looked-at run of the deployed build: two accounts on two devices found and join a conglomerate, upgrade it once, pool credits and goods, share a belt, fund and complete a station, use a member benefit, check the dominance overlay, and exchange memoranda if D-0.12-1 is answered. Screenshots of every new screen at… (the rest: AB#915)

- [ ] The run is on the deployed build, not localhost, with two accounts on two devices.
- [ ] Each step in the description is shown by a screenshot attached to this item.
- [ ] Every dead end, empty state without a next action, or unhelpful error found is filed as a bug before this closes.
- [ ] The full suite is green on a fresh clone, with the test count stated.
- [ ] The Board has looked at the screenshots and says so on this item.

### ISP: move the Inbox's player mail onto conversations and drop it from the accounts snapshot (Requirement AB#2563, Proposed) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), after AB#910 (private messages by corporation id) and the design in docs/design/messaging.md, step 3 of its migration plan. / What it is. AB#910 built the conversation store and routes (/api/accounts/:id/conversations...) and made the old Inbox's send route write each player message into its conversation too; scripts/migrate-mail.mjs copies the mail sent before that. The Inbox view (public/scripts/views/inbox.js) still reads and writes the old… (the rest: AB#2563)

- [ ] The Inbox lists conversations newest first and pages a thread by cursor; a message arrives live in an open Inbox; screenshots at 1280x800 and 375x812.
- [ ] Player messages are no longer written to account.messages; after scripts/migrate-mail.mjs has run, the snapshot holds no player mail (test on a fixture store, with the counts before and after).
- [ ] Bodies render as text (a <script> body shows as text). No filter, block, report or moderation (AB#696, AB#707).

### ISP-194 Design the conglomerate core: charter, membership, roles and the level ladder (Requirement AB#888, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate creation and membership system". Covers lines 0 and 1; the first story of the version. What it is. A design doc at docs/design/CONGLOMERATES.md that fixes the charter (who may found one, the charter fee, the name rules), membership (invite, apply, leave, kick, one conglomerate per corporation), roles and what each may do, and the level ladder from 5 to 100 members with what each level costs and requires. The… (the rest: AB#888)

- [x] docs/design/CONGLOMERATES.md exists and contains: founding requirements and charter fee; the membership lifecycle as a state list (invited, applied, member, left, removed); a roles table (at least founder, director, member) with each permission as a row; and a level table from level 1 (5 members) to the maximum (100 members) giving the cost and requirement of each step.
- [x] Prior art is cited with what was taken from each: EVE Online corporations and alliances (roles, titles and per-division hangar and wallet access; EVE University wiki, "Corporation roles"); World of Warcraft guild levels, added in Cataclysm (2010) and removed in Warlords of Draenor (2014) partly because levels pressured players towards large established guilds; and Clash of Clans clan levels and the 50-member cap. The doc says which of those lessons ISP adopts and which it rejects.
- [x] T-018 check, in writing: the doc shows why a bigger conglomerate is not always better. For example, upkeep per member that grows faster than the benefit, or a dominance share that is divided by headcount. A small worked example shows two sizes where the smaller one is the better choice for a stated goal.
- [x] Names: the conglomerate name follows the same validator and reserved-name list as corporation names (#433: no ISA, GEX or NPC-buyer impersonation). No free-text charter description or motto; any identity field is chosen from a fixed list, because player free text is waiting on Board decision D-0.12-1.
- [x] The doc lists every number it introduces in one table so v0.12-03 can move them into a data file unchanged.

### ISP-195 Design pooling, shared intel, co-owned stations and the dominance metric (Requirement AB#889, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate resource pooling and shared intel". Also covers lines 3 and 5; follows v0.12-01. What it is. A second section of docs/design/CONGLOMERATES.md. It defines: what can be pooled (a credit treasury and a goods hangar at a station), who may withdraw and how much; what shared intel means in behaviour (for example, scouted belts from corp_scouted_belts usable by every member for expeditions); how a conglomerate comes to co-own… (the rest: AB#889)

- [x] The doc defines the treasury and hangar: deposit rules, withdrawal permissions per role, a per-role daily withdrawal cap, and an append-only ledger. It cites the EVE Online corporation-theft precedents (the Guiding Hand Social Club heist of 2005, and the EBank embezzlement of 2009) as the reason for the caps.
- [x] Shared intel is written as behaviour, not display (P-INERT-FEATURE): each intel item names the action it enables for a member who did not gather it.
- [x] Co-owned stations: the doc chooses how a station is obtained (recommended: a construction project funded from the pooled treasury and hangar), what a stake is and how it is earned, what the station gives members, and what happens to a leaving member's stake. It cites EVE Online Upwell structures (2016: owner-set access lists and asset safety) and says what ISP adopts from them.
- [x] The dominance metric is a formula over server-held data only (for example, weighted shares of active leases, extraction output over 7 days and exchange sales in the system), with its time window stated. It gives a per-corporation and a per-conglomerate reading, and states what is public (rounded shares of the top 3 plus "others") and what is not (any per-account raw number).
- [x] T-018 check for pooling: the doc shows a cost of pooling (withdrawal caps, a treasury fee or a lost-stake risk) so that "pool everything" is not automatically optimal.
- [x] Every new number is in the doc's number table for v0.12-03.

### ISP-196 Add the conglomerate catalog and a cross-catalog test (Requirement AB#890, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate leveling and capacity upgrades (5 → 100 members)". Data before server. What it is. A data/conglomerates.json file holding every number from the two design stories: charter fee, level ladder (member cap per level, cost, requirements), role permission table, withdrawal caps, station construction costs and dominance weights. A schema test covers it, and a cross-catalog test asserts that every id it references (buildings,… (the rest: AB#890)

- [x] data/conglomerates.json exists, and every number in the design doc's table appears in it with the same value.
- [x] A schema test fails on a missing field, a non-monotonic member cap (each level's cap must be greater than the last), a cap above 100 or a first-level cap other than 5.
- [x] A cross-catalog test fails when any referenced building, station, resource or research id is absent from its catalog. The PR shows it failing on a deliberately broken copy.
- [x] The server loads the catalog at startup and refuses to start if it fails validation (fails closed). A test covers this.
- [x] The full suite runs green and the PR states the test count (T-008).

### ISP-197 Charter a conglomerate at the Conglomerate Affairs Bureau (server) (Requirement AB#891, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate creation and membership system". What it is. Persistence for conglomerates (id, name, founder account id, level, created at) and a corp.conglomerateId link, added as a migration in the v0.6 Postgres schema. A POST /api/accounts/:accountId/conglomerates route charges the charter fee from corp.finances.credits and creates the conglomerate with the founder as its only member. A GET /api/conglomerates route returns the… (the rest: AB#891)

- [x] Founding succeeds only when the corporation meets the catalog's requirements, has no conglomerate already and can pay the fee. Each refusal returns a distinct error code with copy that says what to fix. Tests cover each case.
- [x] The name is validated by the same function as corporation names (#433): length, allowed characters, uniqueness regardless of case, and the reserved list (ISA, GEX, every NPC buyer and faction code). A test iterates the exported reserved list.
- [x] The fee is deducted and the conglomerate created in one transaction; a failure part-way leaves neither (a test injects a failure).
- [x] Security. Data: name, founder account id and level. Only the name and level are public; account ids are never in the public directory response. Hostile input: an oversized name, HTML, a reserved name, a race of two founders with the same name, or another account's id in the URL. All are rejected server-side; requireAccountAccess guards the route; a unique index enforces name uniqueness. Fails closed: if the catalog or the fee check cannot run, the request is refused.
- [x] The corporation's round trip is tested on a used save (P-FRESH-STATE-ONLY): a corporation with existing leases, inventory and history founds a conglomerate, and the state survives a restart.

### ISP-198 Let corporations join and leave a conglomerate: invitations, applications, leave (server) (Requirement AB#892, Resolved, not verified) (lane: interstellar-settlement-protocol/social)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate creation and membership system". What it is. Routes to invite a corporation (by corporation id, from the directory), apply to a conglomerate, accept or decline either, and leave. The member cap from the catalog is enforced at acceptance time. Members receive events in a conglomerate socket room (cong:<id>) as well as their own account room. Why it matters. Membership is the verb of the social layer. Applications and… (the rest: AB#892)

- [x] Invite, apply, accept, decline and leave each work through the API, with a test per transition. Membership states match the design doc's state list.
- [x] Acceptance is refused with a clear error when the conglomerate is at its member cap. Two simultaneous acceptances for the last slot admit exactly one (a concurrency test).
- [x] A corporation cannot hold two memberships. Leaving clears corp.conglomerateId. A founder cannot leave while other members remain until v0.12-06's succession exists (explicit error).
- [x] Security. Data: membership rows (conglomerate id, corporation id, state, timestamps). Hostile input: inviting oneself, accepting an invitation addressed to another corporation, replaying an accepted invitation, or flooding invitations. The server checks that the acting account owns the corporation named in the action, invitations are single-use, and invitations are rate-limited per conglomerate (the limit is stated). Fails closed: an unknown invitation id or state returns 404 or 409 and never… (the rest: AB#892)
- [x] Socket events for membership changes go only to that conglomerate's room and the affected account; a test asserts that a non-member socket receives nothing.

### ISP-199 Add conglomerate roles and permissions, removal, succession and disbanding (server) (Requirement AB#893, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate creation and membership system". What it is. The roles table from the design doc, enforced by one server-side permission check (can(member, action)) that every conglomerate route calls. Adds promote and demote, remove a member, transfer the founder role, automatic succession when a founder's account is deleted or inactive for the design doc's period, and disbanding. Why it matters. Every later feature (treasury,… (the rest: AB#893)

- [x] Every conglomerate route goes through can(). A test enumerates the conglomerate routes on the Express router and fails if any handler does not call it.
- [x] Each row of the roles table has a test for an allowed and a refused actor.
- [x] A director cannot remove the founder or promote anyone above their own role. Founder transfer is atomic. Disbanding requires the founder and an empty treasury and hangar, or states what happens to their contents (from the design doc).
- [x] Security. Data: role per membership. Hostile input: escalating one's own role, acting on another conglomerate's members, or a demoted member's stale client session. Permissions are read from the server on every request, never from the client. Fails closed: an unknown role or action is denied.
- [x] Role changes notify the affected member through their account room.

### ISP-200 Build the Conglomerate Affairs Bureau view: found, browse, apply, invitations (Requirement AB#894, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate creation and membership system". UI after server. What it is. The Conglomerate Affairs Bureau building view on Earth Station Prime becomes usable: a charter form with the fee and requirements shown before commit (an ISP-19 confirmation); a directory of conglomerates with level, member count and cap; apply buttons; and a list of the corporation's pending invitations with accept and decline. Built on the ISP-25 design… (the rest: AB#894)

- [x] From a fresh level-appropriate corporation, a player can found a conglomerate, and a second account can find it in the directory, apply, and be accepted from the first account. Each step is shown in the PR.
- [x] Requirement failures (level too low, cannot afford, already a member) show a disabled action with the reason and what to do, not a silent no-op.
- [x] Empty directory and no-invitations states each offer a next action.
- [x] Screenshots of the Bureau view (charter form, directory and invitations) at 1280px and 375px are attached to the PR and have been looked at by a human; no horizontal scroll at 375px.
- [x] No legacy component or inline style is added; only ISP-25 tokens and components.

### ISP-201 Build the conglomerate headquarters panel and wire the Overview card (Requirement AB#895, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate creation and membership system". What it is. A conglomerate panel (roster with roles, promote, demote, remove, leave, transfer founder) reachable from the Company navigation group. The Overview's existing "Conglomerate Status" card, which today always reads "Independent" because nothing supplies data.conglomerates, now shows the real name, members and cap. Why it matters. Members need one place to see who they are with… (the rest: AB#895)

- [x] The roster shows each member corporation, role and join date; actions appear only for roles allowed to take them. The server still enforces this (v0.12-06); the UI only hides.
- [x] The Overview card shows name and members/cap for a member, and a link to the Bureau for an independent corporation.
- [x] Leaving and removal each use an ISP-19 confirmation that names the consequence (for example, the stake a leaving member forfeits, if the design doc says so).
- [x] Screenshots of the headquarters panel and the Overview card at 1280px and 375px are attached to the PR and looked at by a human.

### ISP-202 Level conglomerates and upgrade member capacity from 5 to 100 (server) (Requirement AB#896, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate leveling and capacity upgrades (5 → 100 members)". What it is. Conglomerate progression per the design doc and data/conglomerates.json: requirements tracked from server events (never client-reported), an upgrade purchased from the treasury by a permitted role, and the member cap raised along the ladder from 5 to 100. Members receive a level-up event. Why it matters. Capacity is the line's promise, and the ladder is… (the rest: AB#896)

- [x] A test drives a conglomerate from level 1 to the maximum by satisfying each level's requirements, and asserts the cap at each level matches the catalog and ends at 100 (T-019: every level is reachable).
- [x] Every stat a level requirement reads is written by some server code path. A test asserts this against an exported allowlist of stat writers, and fails if a requirement names a stat nothing writes.
- [x] Upgrading is refused, with a clear error, without the role, the funds or the requirements. Funds are deducted atomically with the level change.
- [x] Security. Data: level and progress counters. Hostile input: repeated upgrade calls (idempotent: one level per payment) and client-supplied progress (ignored). Fails closed: unknown level data refuses the upgrade.
- [x] Downgrade is never automatic: losing members never reduces the level or strands members above the cap.

### ISP-203 Show conglomerate level, the next upgrade and a level-up moment (Requirement AB#897, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate leveling and capacity upgrades (5 → 100 members)". What it is. In the headquarters panel: current level, member cap, requirements for the next level with progress bars, and an upgrade action with the cost shown before commit. On level-up every online member sees the ISP-25 "milestone reached" overlay. Why it matters. A ladder the player cannot see is not a goal. The Board asked for reward moments to be designed… (the rest: AB#897)

- [x] Requirements and progress match the server's values for a test conglomerate at two different levels.
- [x] The upgrade button is disabled with the reason when unaffordable or not permitted.
- [x] Level-up shows the overlay once per member per level (not repeated on reload).
- [x] Screenshots of the level panel and the level-up overlay at 1280px and 375px are attached to the PR and looked at by a human.

### ISP-204 Add a conglomerate treasury with role limits and an append-only ledger (server) (Requirement AB#898, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate resource pooling and shared intel". What it is. A credit treasury per conglomerate. Deposits from a member's corp.finances.credits; withdrawals by permitted roles up to the per-role daily cap from the catalog; every movement written to an append-only ledger (actor, amount, balance after, reason, timestamp). Deposits and withdrawals are recorded in each corporation's finances through recordIncome / recordExpense so the… (the rest: AB#898)

- [x] Deposit and withdraw work. The treasury never goes negative, and a member's credits never go negative. Two concurrent withdrawals that together exceed the balance or the daily cap: one succeeds and one is refused (a concurrency test).
- [x] The daily cap resets on a stated UTC boundary. A test crosses it.
- [x] Every movement produces exactly one ledger row, and the sum of the ledger equals the balance (an invariant test over a randomized sequence of 200 operations).
- [x] Security. Data: balances and ledger rows, visible only to members, with directors and above seeing the full ledger. Hostile input: non-numeric, negative, fractional or NaN amounts (rejected, and a test proves none reaches persistence); another conglomerate's id; a removed member's in-flight request. Fails closed: if the permission or cap check errors, the withdrawal is refused and no ledger row is written.
- [x] The ledger cannot be edited or deleted through any route (a test enumerates the routes).

### ISP-205 Add a pooled goods hangar at a station with role limits (server) (Requirement AB#899, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate resource pooling and shared intel". What it is. A conglomerate hangar keyed by station, holding resources moved in from and out to members' inventory[stationId][resource] at the same station. It has per-role daily withdrawal caps by quantity or value, and ledger rows like the treasury's. Why it matters. Goods are what the game produces; pooling only credits would leave half the line undone. Refinery inputs and station… (the rest: AB#899)

- [x] Deposit and withdraw work only for a member docked at, or holding inventory at, that station (the rule is the design doc's). Quantities are conserved across member and hangar in every test.
- [x] Per-role caps are enforced, with a concurrency test as for the treasury.
- [x] Ledger rows are written for every movement. The sum of hangar ledger deltas per resource equals the hangar's holdings (invariant test).
- [x] Security. Data: holdings and ledger. Hostile input: unknown resource names (validated against the resource catalog), unknown station ids (validated against the station registry, closing the same class as the purchase-lease free-string body defect in CODEBASE_MAP), non-integer or negative quantities. Fails closed: invalid input moves nothing.
- [x] The used-save round trip is tested: hangar contents survive a restart.

### ISP-206 Build the treasury and hangar screens with the ledger (Requirement AB#901, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate resource pooling and shared intel". What it is. A Treasury tab in the headquarters panel: balance, deposit and withdraw forms with the remaining daily allowance shown, and the ledger as a table that collapses to cards below 768px. A Hangar tab with the same shape, per station. Why it matters. Members will only pool into something they can audit. The ledger view is the trust mechanism. Estimate: 1 session, assuming… (the rest: AB#901)

- [x] A member without withdrawal rights sees deposit only. A director sees the remaining daily allowance before withdrawing.
- [x] The ledger shows actor corporation, amount, balance after and time, newest first, paginated.
- [x] Errors from the server (over cap, insufficient funds) show copy that says what to do.
- [x] Screenshots of Treasury and Hangar at 1280px and 375px are attached to the PR and looked at by a human.

### ISP-207 Share intel inside a conglomerate: scouted belts and price watch (server) (Requirement AB#902, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate resource pooling and shared intel". What it is. The intel set chosen in the design doc, made usable. At minimum: belts scouted by any member (corp_scouted_belts) become available to every member as expedition targets, and members can see each other's active sell listings on the exchange grouped for coordination. Access ends when a member leaves. Why it matters. Shared intel is the cheapest reason to join a… (the rest: AB#902)

- [x] A member can launch an expedition to a belt only another member scouted. A non-member cannot (a test for each).
- [x] When a member leaves, intel access is revoked on the next request, and a test proves it.
- [x] Intel responses contain only what the design doc lists: no credits, no inventory beyond the listed fields, no account ids.
- [x] Security. Data: other corporations' scouting and listings, exposed only to current members. Hostile input: requesting another conglomerate's intel, or a stale membership. Membership is checked on every read. Fails closed: if membership cannot be confirmed, the response is empty and 403.

### ISP-208 Surface shared intel where it is used (Requirement AB#903, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate resource pooling and shared intel". What it is. Shared belts appear in the starmap and expedition picker marked with the scouting member's name. Members' listings appear in a "Conglomerate" filter on the Galactic Exchange (extending ISP-3's filters). Why it matters. Intel that lives on a separate screen is not used. It has to appear at the point of decision. Estimate: 1 session, assuming v0.12-14 is merged.

- [x] A member sees a belt scouted by another member in the expedition picker and can select it.
- [x] The Exchange "Conglomerate" filter shows only current members' listings.
- [x] Screenshots of the expedition picker and the Exchange filter at 1280px and 375px are attached to the PR and looked at by a human.

### ISP-209 Make the station registry hold player-owned stations alongside the NPC catalog (server) (Requirement AB#904, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Co-owned conglomerate stations". Foundation for co-owned stations. What it is. Stations are read today from the static data/stations.json, all owned by npc. This adds a persisted table for stations created in play, merged with the static catalog behind one registry function that every station lookup already goes through or is changed to go through, with an owner field of {type: 'npc' | 'conglomerate', id}. Why it matters. A… (the rest: AB#904)

- [x] One exported registry function returns static and persisted stations. A grep-based test fails if any server file reads stations.json outside the registry module.
- [x] GET /api/stations returns both kinds, with owner type and public owner name only.
- [x] A persisted station survives restart (round-trip test), and static ids cannot be shadowed by a persisted station with the same id.
- [x] Security. Data: station id, name, system, body, owner. Hostile input: a persisted id colliding with a static one, or an unknown system or body (both rejected). Fails closed: a registry load error refuses to start the server rather than starting with no stations.

### ISP-210 Build a conglomerate station as a funded construction project (server) (Requirement AB#905, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Co-owned conglomerate stations". What it is. Per the design doc: a permitted role starts a station project at an eligible body. Members contribute credits from the treasury and goods from the hangar towards the catalog's bill of materials. On completion, the station is created in the registry with the conglomerate as owner. Contributions are recorded per member corporation for stakes (v0.12-18). Why it matters. This is how… (the rest: AB#905)

- [x] A project can be started only by a permitted role, at a body the design doc allows, with at most one active project per conglomerate (tests for each refusal).
- [x] Contributions move value out of the treasury or hangar into the project atomically, and a per-member contribution record is kept.
- [x] On completion, the station appears in the registry and on the starmap, and all members are notified through the conglomerate room.
- [x] Cancelling a project refunds contributions to the treasury and hangar per the design doc; a test proves conservation.
- [x] Security. Data: project progress and per-member contributions (visible to members). Hostile input: contributing more than held, contributing to another conglomerate's project, or completing twice (idempotent). Fails closed: if the bill-of-materials check fails, the station is not created.

### ISP-211 Record ownership stakes and govern the co-owned station (server) (Requirement AB#906, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Co-owned conglomerate stations". What it is. Stakes derived from project contributions (or the design doc's rule), stored per member corporation. Station decisions the design doc names (for example, who may build inside, member office rate) require a permitted role, or a stake-weighted approval if the doc chose that. A leaving member's stake is handled per the doc (bought out from the treasury at book value, or retained). Why it… (the rest: AB#906)

- [x] Stakes sum to 100% for every station (invariant test) and match contributions for a test project.
- [x] Leaving and removal apply the design doc's stake rule, and tests prove conservation of value.
- [x] Governed actions are refused without the role or approval, and a test covers each.
- [x] Security. Data: stakes per corporation (members only). Hostile input: approving twice, approving for another member, or acting on a station of another conglomerate. Fails closed: an unresolved approval state means no change.

### ISP-212 Give members real benefits at their co-owned station (server) (Requirement AB#907, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Co-owned conglomerate stations". What it is. The benefits the design doc lists, applied in the systems they touch. For example: members can rent offices and place buildings in the co-owned station at the member rate, and a docked member's goods can move to the hangar without the transfer fee. Each benefit is implemented where the cost is computed, not as a display label. Why it matters. A co-owned station that changes no cost or… (the rest: AB#907)

- [x] For each benefit, a test compares a member and a non-member performing the same action at the station and asserts the stated difference.
- [x] Non-members can still dock and trade (no access lock-out unless the design doc chose an access list, in which case the list is enforced server-side).
- [x] Security. Membership is resolved server-side at the moment of the action; a removed member loses the rate on the next request (test).

### ISP-213 Build the station construction and co-owned station screens (Requirement AB#908, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Co-owned conglomerate stations". What it is. A project screen (bill of materials, progress per input, contribute actions, contributor list) and, once complete, the co-owned station's own view in the Station group: stakes, member benefits, governance actions. The station uses a real visual treatment from the ISP-25 system, not a coloured box. Why it matters. Building a station is the largest shared goal in v0.12; it must look like… (the rest: AB#908)

- [x] A member can start, contribute to and complete a project from the UI, and the finished station appears in the station list and on the starmap.
- [x] Stakes and benefits shown match the server's values.
- [x] Screenshots of the project screen and the finished station view at 1280px and 375px are attached to the PR and looked at by a human. Any placeholder art is listed as owed in the PR (DOCTRINE: a placeholder is a debt with a due date).

### Design player messaging to scale: storage, indexes, pagination and server limits (Requirement AB#909, Resolved, not verified) (lane: interstellar-settlement-protocol/social)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Private messaging between players". What it is. The Board answered D-0.12-1 (AB#707): "This should just be able to scale....", and D-0.5-4 (AB#696): "no safety measures". Read together: private messaging is free text between any two corporations with no filter, block, report or moderation; the work is engineering it to scale (storage outside the per-account state, indexes, pagination) with rate and size limits that protect the… (the rest: AB#909)

- [x] docs/design/messaging.md gives the storage model, indexes, page size, cursor rule, body size limit, per-sender rate limit and migration plan, and quotes the Board's answers on AB#707 and AB#696 with the interpretation above.
- [x] It states that no filter, block, report or moderation is built, and that the limits are there to protect the server, not to police content.
- [x] It sets a load target as a probe number, labelled as a bot number: with 10,000 corporations and 1,000,000 seeded messages, sending and reading one inbox page stay under a stated p95 latency, and the probe (like AB#729) is named.
- [x] It covers chat history and forum threads with the same pagination and limits.

### Private messages between corporations by id: send, paginated threads, live delivery and server limits (Requirement AB#910, Resolved, not verified) (lane: interstellar-settlement-protocol/social)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Private messaging between players". What it is. The Board answered D-0.12-1 (AB#707): "This should just be able to scale....", and D-0.5-4 (AB#696): "no safety measures". Read together: private messaging is free text between any two corporations with no filter, block, report or moderation; the work is engineering it to scale (storage outside the per-account state, indexes, pagination) with rate and size limits that protect the… (the rest: AB#910)

- [x] Messages are addressed by corporation id; an unknown id returns 404 and stores nothing; a body over the design's size limit returns 413 and stores nothing (tests).
- [x] Cursor pagination returns every message exactly once while new messages arrive between pages (test), and the page size is capped server-side.
- [x] The per-sender rate limit from the design trips in a test and is reported with Retry-After; it is a server limit, not a content rule.
- [x] Existing player mail migrates into conversations with sender, recipient and time preserved (test on a fixture store).
- [x] Live delivery goes to the recipient's room only; a test proves a third socket receives nothing.
- [x] Security. Data: sender id, recipient id, body, timestamps. The sender is taken from the token only; a request naming another sender is ignored (test). Bodies are stored as text and rendered escaped (a test sends <script>). No filter, block, report or moderation, per the Board. Fails closed: if the store is unavailable, sending returns 503 and nothing is half-written.
- [x] The design's probe runs and its numbers are in the PR, labelled as bot numbers.

### Private messages in the Inbox: compose to any corporation, paged threads and a live unread count (Requirement AB#911, Resolved, not verified) (lane: interstellar-settlement-protocol/social)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Private messaging between players". What it is. The Board answered D-0.12-1 (AB#707): "This should just be able to scale....", and D-0.5-4 (AB#696): "no safety measures". Read together: private messaging is free text between any two corporations with no filter, block, report or moderation; the work is engineering it to scale (storage outside the per-account state, indexes, pagination) with rate and size limits that protect the… (the rest: AB#911)

- [x] A player sends a message to another corporation in four or fewer taps or clicks after opening the Inbox, shown in the PR as a click-path.
- [x] The recipient sees it arrive and the unread count change without reloading.
- [x] A thread with 500 seeded messages opens showing the latest page only and loads older pages on scroll, with no duplicate or missing message (test).
- [x] Message text renders as text, never HTML.
- [x] Screenshots of the composer and a thread at 1280x800 and 375x812 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-217 Compute corporate and conglomerate dominance per system (server) (Requirement AB#912, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Starmap: corp and conglomerate dominance overlay". What it is. A ticker that computes the design doc's dominance metric for every system from server-held data, and caches the result. It is exposed through GET /api/starmap/dominance as, per system, the top three corporations and top three conglomerates with rounded shares plus an "others" share. v0.13 territorial control reads the same function. Why it matters. The overlay needs a… (the rest: AB#912)

- [x] For a fixture world with known leases, output and sales, the computed shares match hand-worked values in the test (arithmetic shown in the test).
- [x] Shares per system sum to 100% (±1 for rounding), and a system with no activity returns an empty leader list, not an error.
- [x] The response contains names and rounded shares only: no account ids, credits or raw volumes (a test asserts the response keys).
- [x] The computation runs on a ticker at the stated interval, and its duration at 1,000 fixture corporations is measured and stated in the PR.
- [x] Security. Public endpoint, aggregate data only. Hostile input: none accepted beyond an optional system id validated against the registry. Fails closed: if computation fails, the last good cache is served with its timestamp, never partial data.

### ISP-218 Add corporate and conglomerate dominance overlays to the starmap (Requirement AB#913, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Starmap: corp and conglomerate dominance overlay". What it is. Two new options in the starmap's overlay select (today: none, resource, GDP, activity, pirates, in public/scripts/starmap.js overlayColor). Each system is coloured by its leader with a legend, and the details panel lists the top three with shares. Colours come from a token palette with a text label, never colour alone. Why it matters. The line asks for it directly, and… (the rest: AB#913)

- [x] Selecting "Corporate dominance" or "Conglomerate dominance" recolours systems to match the API's leaders for a fixture world.
- [x] The player's own corporation and conglomerate are marked distinctly, and the legend names every colour shown.
- [x] The map remains usable at 375px (overlay select reachable, details panel as a sheet).
- [x] Screenshots of both overlays at 1280px and 375px are attached to the PR and looked at by a human. Contrast of the legend text meets WCAG AA (numbers stated).

### ISP-219 Add a conglomerate profile to the ISP probe: pooled against solo (Requirement AB#914, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Conglomerate leveling and capacity upgrades (5 → 100 members)". Also measures line 2. What it is. Extend the ISP probe harness (hq/ops/probes/isp-*.ts, DEPTH epic 4) with a profile that runs solo bot corporations against bots in conglomerates of several sizes. It reports credits per day, level reached and the size a planner bot chooses when size is a free choice. Why it matters. T-018: capacity and pooling are knobs. The design… (the rest: AB#914)

- [x] The probe prints, for conglomerate sizes 5, 20, 50 and 100: credits per member per day at day 7, and the planner bot's chosen size. Output is labelled as bot numbers.
- [x] Target (bot number): the planner bot does not always choose the maximum size, and a conglomerate member beats a solo corporation on credits at day 7 by between 5% and 30%. Outside that band, a balance bug is filed with the probe output.
- [x] The probe runs in CI and the PR quotes its raw output.

### ISP-288 Chat and forums at scale: paginated threads, bounded chat history, server rate limits (Requirement AB#995, Resolved, not verified) (lane: interstellar-settlement-protocol/accounts)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Private messaging between players". D-0.12-1 (AB#707) asked whether its ruling covers the existing chat, forums and mail; the Board answered "This should just be able to scale....", with no safety measures (D-0.5-4, AB#696). What it is. Apply docs/design/messaging.md to chat and forums: cursor pagination for thread lists and replies, chat history kept to the design's window in memory and paged from the store, and per-account… (the rest: AB#995)

- [x] Forum thread lists and replies are cursor-paginated with a server-capped page size, returning every item exactly once while new posts arrive (test).
- [x] Chat keeps only the design's window in memory; older history pages from the store (test).
- [x] Posting rate and size limits trip in tests and are server limits, not content rules.
- [x] With 10,000 seeded threads, the first forum page stays under the design's p95 target in the probe, labelled as a bot number.
- [x] Screenshot of a long forum thread paging and of chat history loading older messages at 1280x800 and 375x812 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-212a Move a conglomerate's hangar to its station when it is built (server) (Requirement AB#4654, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Co-owned conglomerate stations". Split from ISP-212 (AB#907), which built two of the four member benefits (the office rate and free in-system logistics) under its three-benefit limit. / What it is. docs/design/CONGLOMERATES.md Part 2, "What the station gives members": once a conglomerate owns a station, the hangar moves there and it becomes the home station, so pooled goods are where the members mine. Today the hangar stays at Earth… (the rest: AB#4654)

- [x] The hangar is at the conglomerate's station once it is built (hangar routes and tests).
- [x] Goods already in the hangar follow the settled rule (moved with it, free) with a conservation test.
- [x] The station project's hangar source and the dissolution split both read the new home station.
- [x] (Written from OPS's dispatch, 2026-09-29; the item had none.)

### ISP-212b Govern the sales tax at a conglomerate station: members pay none, non-members pay the treasury (server) (Requirement AB#4655, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.12 Conglomerates (Feature AB#396), plan line "Co-owned conglomerate stations". Split from ISP-212 (AB#907). / What it is. docs/design/CONGLOMERATES.md Part 2: "An exchange the conglomerate governs: sales tax at the station is set from a fixed list (stationTaxOptions, 2%, 5%, 8%); members always pay 0; what non-members pay goes to the treasury." The tax becomes a station setting the stake vote governs (ISP-211, server/game/stationGovernance.js), and exchange sales settled at the… (the rest: AB#4655)

- [x] Member vs non-member sales at the station: 0% vs the voted rate, credited to the treasury (tests).
- [x] The tax reads only from stationTaxOptions via the stake vote.
- [x] Sales elsewhere unchanged (regression test).
- [x] The exchange's quoted price matches the actual charge.
- [x] (Written from OPS's dispatch, 2026-09-29; the item had none.)

### ISP shared intel: a partner's scouted belt does not reach other members' open pages until they reload (Bug AB#4665, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Symptom. Member A scouts the Sol belt. Member B, with the Starmap open, opens the same belt: "Material composition unknown. Scout this belt", no Shared intel badge. After a reload B sees the badge and can launch there without scouting (ISP-208 works, but only on a fresh read). / Repro. Two members of one conglomerate, both logged in. A: Starmap, Sol, Asteroid Belt, Scout. B (already on the page): Starmap, Sol, Asteroid Belt. Seen in both passes of the playthrough, at 375 and 1280. / How found.… (the rest: AB#4665)
Repro: Symptom. Member A scouts the Sol belt. Member B, with the Starmap open, opens the same belt: "Material composition unknown. Scout this belt", no Shared intel badge. After a reload B sees the badge and can launch there without scouting (ISP-208 works, but only on a fresh read). / Repro. Two members of one conglomerate, both logged in. A: Starmap, Sol, Asteroid Belt, Scout. B (already on the page): Starmap, Sol, Asteroid Belt. Seen in both passes of the playthrough, at 375 and 1280. / How found.… (the rest: AB#4665)

- [x] Fixed: ISP shared intel: a partner's scouted belt does not reach other members' open pages until they reload

### ISP Inbox, Players: a conversation row is 501px wide at 375px, so the page scrolls sideways and the tabs are out of reach (Bug AB#4666, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Symptom. At 375x812, the recipient of a player message opens Inbox, Players: the conversation row ("Orion Survey Company ... 1 new") is 501px wide and the page 159px wider than the viewport. The page scrolls sideways, and the bottom tab bar's buttons could not be clicked afterwards (the playthrough's next step timed out). / Repro. Two corporations; A writes to B; B, on a phone, opens Inbox and the Players sub-tab. The sender's own view of the thread does not overflow. / How found. Builder, the… (the rest: AB#4666)
Repro: Symptom. At 375x812, the recipient of a player message opens Inbox, Players: the conversation row ("Orion Survey Company ... 1 new") is 501px wide and the page 159px wider than the viewport. The page scrolls sideways, and the bottom tab bar's buttons could not be clicked afterwards (the playthrough's next step timed out). / Repro. Two corporations; A writes to B; B, on a phone, opens Inbox and the Players sub-tab. The sender's own view of the thread does not overflow. / How found. Builder, the… (the rest: AB#4666)

- [x] Fixed: ISP Inbox, Players: a conversation row is 501px wide at 375px, so the page scrolls sideways and the tabs are out of reach

### ISP Station screen says a member's office costs 0% (0 credits a day) when the station opened after the page's last read (Bug AB#4669, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Symptom. The Conglomerate tab's Station screen, for a station that opened while the member's page was open, says "Offices at 0%. A member's suite here costs 0 credits a day, not 1,000". The server charges 50% (500 a day; the lease in the same run charged 3,500 for 7 days), and the starmap modal and the Station tab's panel say so. / Repro. Main 90865879. A member's page is open; the station project's build time ends and the server's tick opens the station; the member opens Conglomerate, Station.… (the rest: AB#4669)
Repro: Symptom. The Conglomerate tab's Station screen, for a station that opened while the member's page was open, says "Offices at 0%. A member's suite here costs 0 credits a day, not 1,000". The server charges 50% (500 a day; the lease in the same run charged 3,500 for 7 days), and the starmap modal and the Station tab's panel say so. / Repro. Main 90865879. A member's page is open; the station project's build time ends and the server's tick opens the station; the member opens Conglomerate, Station.… (the rest: AB#4669)

- [x] Fixed: ISP Station screen says a member's office costs 0% (0 credits a day) when the station opened after the page's last read

## Demo script

_To be written._
