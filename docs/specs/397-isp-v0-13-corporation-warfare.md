# ISP v0.13 — Corporation warfare

Feature AB#397 (Proposed) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits: v0.13 on the ISP roadmap (DEVELOPMENT_PHASES.md in the product repo), under the product epic.
What it is for: Conflict fought with markets and lawyers rather than fleets, which is the version of warfare this game is actually about.
What it contains:
- Territorial control and system ownership
- Economic warfare: market flooding, tariffs
- Lawfare: patents, NPC faction lobbying
- The Galactic Arbitration Council
Each line becomes a story when this version is next. They are listed here rather than filed as work items so the backlog shows what is ready to be worked, not everything that has ever been planned (TRACKING.md).

## Acceptance

_To be written: the Feature had no acceptance criteria in Azure DevOps._

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 2 open, 23 resolved.

### ISP-221 Design territorial control: an ISA concession, not ownership, earned by sustained dominance (Requirement AB#916, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Territorial control and system ownership". The first story of the version. What it is. A design doc at docs/design/TERRITORY.md that reconciles "system ownership" with the lore. The ISP Treaty says no body may be privately owned (LORE.md), so ownership becomes an ISA administrative concession held by a corporation or conglomerate. The doc covers: how a concession is earned (v0.12's dominance metric sustained over a stated… (the rest: AB#916)

- [x] docs/design/TERRITORY.md exists and defines: eligibility, petition, grant, upkeep, lapse and challenge as a state list; what a concession grants; and the list of never-concedable systems with the reason.
- [x] Prior art cited: EVE Online sovereignty. Aegis sovereignty (2015) made an actively used system harder to take through the Activity Defense Multiplier, and the Equinox update (2024) tied the cost of holding space to its use. The doc also cites Offworld Trading Company (Mohawk Games, 2016) as an economic-only conquest game. It says which ideas ISP adopts.
- [x] T-018 check: concession upkeep grows faster than linearly with the number of concessions held (a curve is given), and a worked example shows a corporation for which the third concession is not worth holding.
- [x] Charter risk check: nothing in the design lets an absent player lose assets. A lapsed concession removes the concession's benefits, never the player's leases, buildings or inventory.
- [x] Every number is in one table for v0.13-05.

### ISP-222 Design economic warfare: tariffs with an optimum, and dumping as a calculated risk (Requirement AB#917, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Economic warfare: market flooding, tariffs". What it is. A section of docs/design/WARFARE.md. Tariffs: a concession holder sets a tariff within bounds on exchange sales of goods held in its system and on transfers into it, and the revenue goes to the holder. Flooding: selling large volume far below the trailing price to hurt a rival is allowed, but the Interplanetary Trade Commission (an existing NPC building,… (the rest: AB#917)

- [x] The doc states the tariff bounds, the notice period before a tariff change takes effect (so traders are never surprised), and why the revenue-maximising tariff is below the maximum. Traders can route goods through another system's station for the logistics fee, so revenue follows a Laffer-shaped curve. It cites the optimum-tariff argument in trade economics (Bickerdike, 1906).
- [x] The dumping rule is written as a formula: the price threshold against the trailing average, the volume threshold, the detection window and the duty. It cites the WTO Anti-Dumping Agreement's definition of dumping (sale below normal value) and Offworld Trading Company's market manipulation.
- [x] Dependency named: flooding only has an effect if the NPC standing bid no longer pins the price (DEPTH epic 3, "unpin the exchange"). The doc checks whether that has shipped by v0.13 and, if not, says this line is blocked on it.
- [x] Every number is in the table for v0.13-05.

### ISP-223 Design lawfare: patents that earn royalties, and lobbying that moves bounded rules (Requirement AB#918, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Lawfare: patents, NPC faction lobbying". What it is. A section of docs/design/WARFARE.md. Patents: the first corporation to complete a patentable R&D node or refinery chain may file a patent at Corporate Registry & Charters. For its term, other corporations using it pay the holder a royalty; they are never blocked. Lobbying: faction standing with the Earth Assembly and the Interplanetary Trade Commission is earned, then spent… (the rest: AB#918)

- [x] Patents: the doc lists what is patentable, the filing window after first completion, the term, the royalty bounds, and states that a patent never prevents use. It cites EVE Online blueprint originals and copies as the licensing precedent, and royalty-not-exclusion (FRAND licensing) as the real-world model.
- [x] Lobbying: the doc lists the parameters that can be lobbied, with bounds and duration. Campaign effect shows diminishing returns on spend (a curve is given), and opposing campaigns net against each other. It cites Victoria 3's interest groups and the Democracy series' policy pressure.
- [x] Worked example: two corporations lobbying against each other, and the spend at which extra spending stops paying.
- [x] Every number is in the table for v0.13-05.

### ISP-224 Design the Galactic Arbitration Council: structured claims decided by rules on server evidence (Requirement AB#919, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Galactic Arbitration Council system". What it is. A section of docs/design/WARFARE.md for the Council (an existing NPC building, galactic-arbitration-council). It defines the claim types (for example, a tariff above its bound or without notice, patent royalty evasion, breach of a v0.10 mercenary contract, default on a v0.9 loan, and a concession challenge), the evidence each draws automatically from server logs, the… (the rest: AB#919)

- [x] Every claim type has: who may file, the evidence query, the ruling rule, the remedy, and the filing fee. There are no free-text fields anywhere in a case.
- [x] Enforcement is stated. Damages are paid from escrow or collateral where the underlying contract has it, following EVE Online's courier contracts, which enforce by collateral posted up front rather than by judgment. Otherwise damages become a debt recorded against the respondent. The doc explains why pure judgment without escrow would be unenforceable.
- [x] Frivolous filing has a cost: the filing fee is forfeited on dismissal. A worked example shows when filing is and is not worth it.
- [x] The doc notes that EVE and most MMOs leave disputes to players ("contract scams are legal"). ISP's rule-adjudicated court is a deliberate difference, and the doc says why it fits the Treaty lore.

### ISP-225 Add the warfare catalog and a cross-catalog test (Requirement AB#920, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Territorial control and system ownership". Also covers lines 1 to 3. Data before server. What it is. A data/warfare.json catalog with every number from v0.13-01 to 04: concession thresholds and upkeep curve, tariff bounds and notice period, dumping thresholds and duty, patentable ids, terms and royalty bounds, lobbyable parameters and curves, and claim types and fees. A schema test covers it, plus a cross-catalog test that… (the rest: AB#920)

- [x] Every number in the design tables appears in data/warfare.json with the same value.
- [x] The cross-catalog test fails on any unresolved id, and the PR shows it failing on a broken copy.
- [x] The schema test enforces bounds: tariff maximum at most 25% unless the doc says otherwise, royalty maximum below 100%, and never-concedable systems include sol.
- [x] The server refuses to start on an invalid catalog (fails closed).

### ISP-226 Track control scores and concession eligibility per system (server) (Requirement AB#921, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Territorial control and system ownership". What it is. Extends v0.12's dominance computation with duration: a corporation's or conglomerate's control score per system accumulates while it leads and decays while it does not, per the catalog. Eligibility for a concession is exposed through GET /api/systems/:id/control. Why it matters. Control has to be earned over time, or a single day's flood of sales could take a system. The… (the rest: AB#921)

- [x] Using a fixture timeline, control scores rise and decay as the catalog's curve predicts, and a test shows the hand-worked values.
- [x] Eligibility becomes true only after the sustained window, and never for a never-concedable system.
- [x] The response is public and aggregate: names, rounded scores and eligibility only.
- [x] Security. Hostile input: a system id outside the registry (404). Fails closed: if dominance data is stale beyond the stated age, eligibility reads false.

### ISP-227 Petition for, grant, charge upkeep on and lapse a concession (server) (Requirement AB#922, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Territorial control and system ownership". What it is. The concession lifecycle from the design doc: an eligible corporation or permitted conglomerate role petitions at ISA Claims & Leases; the grant is immediate or after a challenge window (per the doc); upkeep is charged on a daily tick; and the concession lapses on unpaid upkeep or lost eligibility. There is one holder per system. Why it matters. This is where "system… (the rest: AB#922)

- [x] Every transition in the design doc's state list has a test, including two simultaneous petitions for one system, where exactly one wins.
- [x] Upkeep is deducted daily from the holder's credits or treasury. Upkeep that cannot be paid lapses the concession and never pushes the balance negative.
- [x] Lapse removes only concession benefits; a test asserts the holder's leases, buildings and inventory are unchanged.
- [x] Security. Data: holder id and dates, which are public. Hostile input: petitioning for another corporation, petitioning while ineligible, or replaying a petition. Fails closed: if eligibility cannot be computed, the petition is refused.

### ISP-228 Give concession holders their lease-fee modifier and fee share (server) (Requirement AB#923, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Territorial control and system ownership". What it is. The concession's benefits, applied where costs are computed. The holder may set a lease-fee modifier within catalog bounds for new ISA leases in its system (with the notice period), and receives the catalog's share of ISA lease fees paid there. Both are recorded in finances. Why it matters. A concession that changes no number is inert (P-INERT-FEATURE). Lease fees are the… (the rest: AB#923)

- [x] A lease purchased in a held system costs the modified fee after the notice period, and a test compares the fee before and after.
- [x] The holder's fee share is credited on each lease purchase and appears in its P&L under a named source.
- [x] The modifier cannot exceed bounds, and changes are refused during an active notice period.
- [x] Security. Only the holder, or a permitted role of a holding conglomerate, can set the modifier. The value is validated as a number within bounds. Fails closed: on an invalid stored modifier, the base fee is used.

### ISP-229 Show control, concessions and petitions on the starmap and at ISA Claims (Requirement AB#924, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Territorial control and system ownership". What it is. The starmap gains a "Concessions" overlay (holder colour and a marker for a pending petition), extending v0.12-25. The system details panel shows control scores, the holder, eligibility and a petition action. The holder gets a management view for upkeep and the lease-fee modifier. Why it matters. Territory is a map game. If it cannot be read off the map, it will not be… (the rest: AB#924)

- [x] A fixture world with two holders and one pending petition renders correctly on the overlay, with a legend.
- [x] An eligible player can petition from the details panel and sees the upkeep before confirming (ISP-19 confirmation).
- [x] Screenshots of the overlay, the details panel and the holder's management view at 1280px and 375px are attached to the PR and looked at by a human.

### ISP-230 Levy concession-holder tariffs on sales and transfers in the system (server) (Requirement AB#925, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Economic warfare: market flooding, tariffs". What it is. The holder sets a tariff within catalog bounds, with a notice period. It is applied at settlement to exchange sales of goods held at stations in the system, alongside the GEX sales tax (getEffectiveExchangeTaxRate, 8% base), and to transfers into the system alongside the logistics fee. Revenue goes to the holder. Why it matters. Tariffs are the line's concrete weapon… (the rest: AB#925)

- [x] Every sale and transfer path calls one tariff function. A test lists the settlement call sites and fails if one bypasses it.
- [x] A sale in a tariffed system pays GEX tax plus tariff. The holder receives exactly the tariff, and the arithmetic is shown in the test.
- [x] Tariff changes take effect only after the notice period, and a pending change is visible through the API during it.
- [x] Security. Hostile input: a tariff out of bounds or non-numeric (rejected), or setting a tariff for an unheld system (403). Fails closed: if the tariff cannot be read, zero tariff is applied and an error is logged, rather than an unbounded one. The holder cannot tariff its own members' sales differently unless the design doc allows it.
- [x] Tariff income and expense appear in both parties' P&L under named sources.

### ISP-231 Show tariffs to traders before they commit, and to holders as a schedule (Requirement AB#926, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Economic warfare: market flooding, tariffs". What it is. The sell form and the transfer form show the tariff and the net proceeds before confirmation. The starmap system panel shows the current and pending tariff. The holder gets a tariff schedule view with revenue collected. Why it matters. A hidden charge on a trade is a dishonest surface (RUBRIC Honesty). Traders must see it before they commit. Estimate: 1 session,… (the rest: AB#926)

- [x] For a sale in a tariffed system, the confirmation shows gross, GEX tax, tariff and net, and the net matches the server's settlement in a test.
- [x] A pending tariff change is shown with its effective time in UTC.
- [x] Screenshots of the sell confirmation with a tariff, the transfer form, and the holder's schedule at 1280px and 375px are attached to the PR and looked at by a human.

### ISP-232 Run the ITC dumping watch and levy anti-dumping duties (server) (Requirement AB#927, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Economic warfare: market flooding, tariffs". What it is. A daily ticker applies the design doc's dumping formula to exchange sales: volume above the threshold sold below the stated fraction of the trailing price, within the window. A flagged corporation is notified that an ITC investigation is open, and the duty is levied per the doc. Flooding stays legal and possible; it now carries a calculated risk. Why it matters. This… (the rest: AB#927)

- [x] Fixture sales just under and just over each threshold produce no flag and a flag respectively (boundary tests on price, volume and window).
- [x] The duty is charged once per investigation, never pushes the balance negative (the remainder becomes a recorded debt, per the design doc), and appears in the P&L.
- [x] Notifications use the ISA voice and state the numbers that triggered the flag.
- [x] Security. Inputs are server-held trade records only. Fails closed: if price history is missing for an item, no flag is raised (never a duty on missing data).

### ISP-233 Make flooding visible on the Exchange: price-impact alerts and ITC notices (Requirement AB#928, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Economic warfare: market flooding, tariffs". What it is. On the Galactic Exchange item view: an alert when an item's price has fallen more than the stated percentage against its trailing average, showing the volume behind it. On the seller's sell form: a warning when a listing would cross the dumping threshold, stating the duty risk. Why it matters. A weapon nobody can see being used against them is not a game. The warning… (the rest: AB#928)

- [x] An item under a fixture flood shows the alert with volume and percentage.
- [x] The sell form warns before a listing that would meet the dumping formula, and the warning's threshold matches the server's in a test.
- [x] Screenshots of the alert and the warning at 1280px and 375px are attached to the PR and looked at by a human.

### ISP-234 Add a tariff and dumping profile to the ISP probe (Requirement AB#929, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Economic warfare: market flooding, tariffs". What it is. Extend the ISP probe harness with a profile in which a holder bot sweeps its tariff from 0 to the maximum while trader bots may route around it, and a flooder bot tries to hurt a rival's revenue. It reports holder revenue by tariff level and the flooder's net gain against duty. Why it matters. T-018: the design claims tariffs and dumping each have an interior optimum.… (the rest: AB#929)

- [x] The probe prints holder revenue at each tariff step and the revenue-maximising step (bot number).
- [x] Target (bot number): the revenue-maximising tariff is strictly below the maximum bound, and a flood that damages a rival by 20% or more of its daily revenue is net-negative for the flooder after expected duty. Outside those, a balance bug is filed with the output.
- [x] The probe runs in CI and the PR quotes its raw output.

### ISP-235 File patents at Corporate Registry & Charters (server) (Requirement AB#930, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Lawfare: patents, NPC faction lobbying". What it is. A corporation that is first to complete a patentable R&D node or refinery chain (from the catalog) may file a patent within the filing window, paying the filing fee. There is at most one patent per id, with the term and royalty rate (within bounds) set at filing. Patents are public records. Why it matters. Patents reward being first at research, which today only benefits… (the rest: AB#930)

- [x] Only the first completer within the window can file (tests for second completer, late filing, and non-patentable ids).
- [x] Two simultaneous filings for one id: exactly one succeeds.
- [x] The patent list is public: holder name, id, term end and rate.
- [x] Security. Hostile input: filing for an id not completed (checked against server completion records, never client state), a rate outside bounds, or refiling after expiry (refused if the design doc says patents do not renew). Fails closed: if completion order cannot be established, filing is refused.

### ISP-236 Charge patent royalties when others use a patented chain or technology (server) (Requirement AB#931, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Lawfare: patents, NPC faction lobbying". What it is. When a non-holder runs a refinery cycle of a patented chain or benefits from a patented technology, the royalty from the catalog's formula is charged at the point of settlement and paid to the holder, until the term ends. Use is never blocked; if the user cannot pay, the design doc's rule applies (debt or reduced output), never a lock-out. Why it matters. Royalties are the… (the rest: AB#931)

- [x] A refinery cycle of a patented chain by a non-holder pays the royalty. The holder receives it, and the arithmetic is shown in a test. The holder pays nothing on its own patent.
- [x] After the term ends, no royalty is charged (the test crosses the boundary).
- [x] A user who cannot pay still runs the chain under the doc's rule, and a test asserts the chain is not blocked.
- [x] Royalties appear in both P&Ls under a named source.

### ISP-237 Build the patent office view (Requirement AB#932, Resolved, not verified) (lane: interstellar-settlement-protocol/accounts)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Lawfare: patents, NPC faction lobbying". What it is. In the Corporate Registry & Charters building: file a patent (eligible ids listed with window remaining), see the public patent register, and see the royalties paid and received. The refinery screen shows the royalty on a patented chain before starting a cycle. Why it matters. Players must see royalties before committing to a chain, or the patent is a hidden tax. Estimate:… (the rest: AB#932)

- [x] An eligible player can file from the view, and the patent appears in the register.
- [x] The refinery start confirmation shows the royalty, matching the server in a test.
- [x] Screenshots of the patent office and the refinery confirmation at 1280px and 375px are attached to the PR and looked at by a human.

### ISP-238 Track faction standing with the Earth Assembly and the ITC (server) (Requirement AB#933, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Lawfare: patents, NPC faction lobbying". What it is. A standing value per corporation per faction (Earth Assembly, Interplanetary Trade Commission, and the ISA if the design doc includes it), earned through the actions the doc lists (for example, fees paid, contracts completed, compliance), and decaying per the catalog. Exposed to the owning corporation only. Why it matters. Lobbying spends standing. Without standing,… (the rest: AB#933)

- [x] Each earning action in the design doc raises standing by the catalog amount, with one test per action.
- [x] Standing decays on the stated tick and has the stated floor and ceiling.
- [x] Every stat standing reads is written by server code (T-019), and a test asserts this against the stat-writer allowlist.
- [x] Security. Standing is per-corporation private data behind requireAccountAccess, and is never client-reported.

### ISP-239 Run lobbying campaigns that move bounded rules in a system (server) (Requirement AB#934, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Lawfare: patents, NPC faction lobbying". What it is. A corporation spends standing plus credits on a campaign to move one lobbyable parameter (from the catalog) in one system for a period. Effect follows the diminishing-returns curve, opposing campaigns net against each other, and the parameter always stays inside its bounds. Active campaigns are public (who, what, which direction, when it ends), because lobbying in the lore… (the rest: AB#934)

- [x] A campaign moves its parameter by the curve's value for the spend (a test with hand-worked values). Doubling spend yields less than double effect.
- [x] Opposing campaigns net correctly, and the result never leaves bounds (property test over random spends).
- [x] On campaign end, the parameter returns to its base value.
- [x] Security. Hostile input: a parameter not in the lobbyable list, spend above holdings, or non-numeric spend (all rejected). Fails closed: if the curve cannot be evaluated, the campaign is refused and nothing is charged.

### ISP-240 Build the lobbying views at the Earth Assembly and the ITC (Requirement AB#935, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Lawfare: patents, NPC faction lobbying". What it is. The Earth Assembly and ITC building views show your standing, the parameters you can lobby with their current and base values, a campaign form previewing the effect of a given spend, and the public list of active campaigns. Why it matters. The preview is what turns a credit sink into a decision: the player sees the diminishing return before paying. Estimate: 1 session,… (the rest: AB#935)

- [x] The effect preview matches the server's computed effect for the same spend (test).
- [x] The list of active campaigns shows opposing campaigns on the same parameter together.
- [x] Screenshots of both building views at 1280px and 375px are attached to the PR and looked at by a human.

### ISP-241 File arbitration cases with evidence drawn from server records (server) (Requirement AB#937, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Galactic Arbitration Council system". What it is. A POST route to file a case of a catalog claim type against a named respondent, paying the filing fee. The server attaches the evidence the claim type's query returns (trade, tariff, patent, contract or loan records). The respondent is notified. A public docket lists cases by reference number. Why it matters. Filing is the Council's entry point. Drawing evidence from server… (the rest: AB#937)

- [x] Each claim type in the catalog can be filed, and the evidence attached matches the claim type's query on a fixture (test per type).
- [x] A case with a claim type whose underlying system does not exist yet is refused with a clear message, not a crash.
- [x] The docket is public: reference number, claim type, parties' names, status. No evidence details beyond what the design doc marks public.
- [x] Security. No free text anywhere in a case. Hostile input: filing against oneself, an unknown respondent, duplicate filing on the same evidence (refused), or filing without the fee. The claimant is taken from the token. Fails closed: if the evidence query fails, the case is not filed and the fee is not charged.

### ISP-242 Decide and enforce arbitration rulings deterministically (server) (Requirement AB#938, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Galactic Arbitration Council system". What it is. After the claim type's response window, the adjudication tick applies the claim type's ruling rule to the evidence and records the ruling (dismissed, damages, injunction such as a tariff reset, or concession revoked). It then enforces it: damages from escrow or collateral where present, otherwise a recorded debt collected from future income per the design doc. The filing fee… (the rest: AB#938)

- [x] For each claim type, a fixture where the claim should succeed and one where it should fail produce the right rulings (two tests per type).
- [x] Enforcement conserves value: what the respondent loses equals what the claimant gains plus any fee sink (invariant test). A debt is collected on the stated schedule.
- [x] Rulings are final and idempotent: re-running the tick on a decided case changes nothing.
- [x] Security. Rulings are computed only from stored evidence, never from client input. Fails closed: an evaluation error leaves the case pending and alerts, and never applies a partial remedy.

### ISP-243 Build the Arbitration Council chambers: file, docket and rulings (Requirement AB#939, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Galactic Arbitration Council system". What it is. The Galactic Arbitration Council building view: a filing wizard (claim type, then respondent, then evidence preview, then fee confirmation), the public docket, and case detail with the ruling written in the ISA's protocol voice with reference numbers. Why it matters. The Council is where the game's bureaucratic tone pays off most directly. It should read like a court registry.… (the rest: AB#939)

- [x] A player can file a case end-to-end from the wizard and later see its ruling.
- [x] The evidence preview shows exactly what the server will attach.
- [x] Screenshots of the wizard, the docket and a ruling at 1280px and 375px are attached to the PR and looked at by a human.

## Held back

Not dispatched: each of these waits on something a Builder session cannot supply, named on its "Held" line. Its lines stay as its acceptance for when it opens. The headings are level 4 so that dispatch, which reads level-3 headings as slices, skips them (PM, 2026-10-01).

#### ISP-244 Run the v0.13 milestone playthrough and look at every new screen (Requirement AB#940, Active) (lane: interstellar-settlement-protocol/platform)

Held (2026-10-01): the three-account test on a local server is on main (d6fea4b9). The open lines need the deployed build, a fresh-clone suite count and the Board's look (AB#4671: not a gate on other work).

What: Where it sits. v0.13 Corporation warfare (Feature AB#397), plan line "Territorial control and system ownership". Verifies all four lines; last story of the version. What it is. A human-looked-at run of the deployed build with three accounts. One earns and holds a concession and sets a tariff and lease modifier. A second trades through it, routes around it, and floods a market until the ITC flags it. The first files a patent and the second pays royalties. The two run opposing lobbying campaigns.… (the rest: AB#940)

- [ ] The run is on the deployed build with three accounts, and each step is shown by a screenshot on this item.
- [ ] Every dead end, surprise charge or unhelpful error is filed as a bug before this closes.
- [ ] The full suite is green on a fresh clone, with the count stated.
- [ ] The Board has looked at the screenshots and says so on this item.

#### Balance risk: the concession upkeep brake holds at 300,000 of trade a day per system, not at ten times that (Bug AB#4877, Proposed) (lane: interstellar-settlement-protocol/combat)

Held (2026-10-01): no change is needed today, in the bug's own words (every target passes). Choosing between a data change and a rule change needs real trade volumes, which do not exist yet.

What: ISP warfare economy (v0.13), the v1.0 final balance pass. AB#967's probe (tests/probes/warfareProbe.js, npm run probe:warfare) plays four rival factions in one world through the real control, concession, upkeep and tariff code. Every AB#967 target passed: at 300,000 of trade a day per held system the top faction holds 3 of 17 concedable systems (17.6%) at day 30 and still at day 60. Concession, patent and lobbying returns all flatten as spend grows. This bug records a sensitivity the probe… (the rest: AB#4877)
Repro: Symptom: the report's "Sensitivity" block (10x trade) shows the top faction's holdings rising through day 60, while the target world is flat. Repro: in the ISP repo, npm run probe:warfare -- --out <dir> (about a minute); the reports are in docs/ab-967 and attached to AB#967.
Proposed fix: A decision for AB#968 and the PM, no change needed today (every target passes). Options: (1) data: raise concessionUpkeepBase if measured trade per system turns out well above 300,000 a day; the break-even k is about 1 + keep / (2 x base), so 10x trade needs about 10x base to hold k at 3. (2) Rule: make upkeep a share of the tariff a concession collected (say 30%) on top of the k-scaled base, so the brake scales with the income it brakes. (3) Re-run this probe once real trade volumes exist and… (the rest: AB#4877)

- [ ] Fixed: Balance risk: the concession upkeep brake holds at 300,000 of trade a day per system, not at ten times that

## Demo script

_To be written._
