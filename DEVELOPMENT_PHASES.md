# ISP Development Roadmap

Each version represents a meaningful, playable milestone. Items marked [x] are complete.

## Version 0.1 — Current

- [x] Real account registration (email/password + hashing)
- [x] Session / JWT authentication
- [x] Dummy account with 2-hour token expiry; progress and sessions persist across server restarts; reset only on explicit request
- [x] Corporation identity with Location field (defaults to Earth)
- [x] Basic silicate mining cycle with per-extractor tracking
- [x] In-game notification system (basic)
- [x] JSON data files: milestones, research, CEO insight, refinery chains
- [x] Remove liquidity as a separate resource — simplify finances to credits only; strip all liquidity cap, regen, and tick logic from server and client
- [x] Remove Milestones from sidebar
- [x] Station tab — Earth Station Prime with NPC building grid (16 buildings, faction badges, coming-soon states)
- [x] Orbital Executive Suites — first accessible building; rent-office flow with milestone tracking (`corp.officeRented`), office status view, in-office hire form, ISA lease placeholder

## Version 0.2 — Walkthrough, Office Rental, Mining Leases, Silicate Mining, Exchange, Persistent Accounts

### Starting Corporation Parameters (spec — code must match)
- [ ] Starting credits: **$250,000** (currently $150,000 in code — needs correction)
- [ ] Starting assets: $0
- [ ] Hire cost: **$2,000/employee** one-time (currently $1,200 — needs correction)
- [ ] Payroll: **$150/day per employee** (currently $36 — needs correction)
- [ ] Office cost: **$1,000/day, 30-day minimum** rental (currently flat $20,000 one-time — needs rework to recurring model)
- [ ] Basic Extractor Yard cost: **$50,000 + logistics fees** (currently $65,000 — needs correction)

### Walkthrough
- [ ] Interactive walkthrough — guided first-session onboarding following the sequence in NEW_PLAYER_EXPERIENCE.md:
  1. Mailbox with ISA licence message
  2. UI orientation (most tabs locked until office rented)
  3. Starmap introduction
  4. Guided office rental at Earth Station Prime
  5. Hire initial employees (min 5 for first lease)
  6. Purchase Mars mining lease at ISA Claims & Leases Division
  7. Build Basic Extractor Yard on the new lease
  8. Launch first silicate mining cycle
  9. Queue Basic Extraction Analytics in Corporate R&D
  10. Sell silicates on the Galactic Exchange against an NPC buy order
  11. Navigate to Missions board; suggest accepting first mission

### Office & Leases
- [ ] Office rental cost model — switch from one-time fee to **$1,000/day recurring** with a **30-day minimum** commitment; deduct on lease; track `rentedUntil` timestamp; lock office benefits if lease lapses
- [ ] Mining rights leasing system — lease extraction rights in Sol before building extractors; each lease grants **2 building slots on that body**; requires **5 employees per active lease** (e.g. 23 employees → max 4 leases); ISA Claims & Leases Division building in station

### Economy & Progression
- [ ] Silicate mining refinements — facility downtime risk mechanic (per-second shutdown probability ~0.005%, recovery ~0.0276%/s; R&D modifiers reduce risk; automatic resume; extractor panel visibility)
- [ ] Corporation level-up system (Levels 1–10) with full reward grants (employee caps, building slots, fleet caps, market sector unlocks)
- [ ] Full milestone roadmap wired to level-up system

### Market
- [ ] Market order matching engine — buy orders meet sell orders
- [ ] Players can purchase from existing sell orders on the exchange
- [ ] NPC corporations populate the exchange with sell orders for price anchoring and supply volume

### Infrastructure
- [ ] Persistent game state — all corp and world state survives server restart across sessions
- [ ] Local chat tied to player's current solar system
- [ ] Persistent chat history
- [ ] Server-side R&D queue auto-completion — server tick scans `queues.corporateRnD`, computes elapsed time from `startedAt + durationHours`, marks completions, applies tech effects to authoritative state, emits websocket and notification events

## Version 0.3 — Tier 1 Research, Refinery Chains, Asteroid Mining, Missions

- [ ] Full Corporate R&D tree (all Tier 1 and Tier 2 nodes) with effects applied to live gameplay values
- [ ] CEO Insight Program — full node library, queue processing, and bonus application (morale, negotiation, charisma, leadership)
- [ ] Server-side CEO Insight queue auto-completion — same authoritative pipeline as R&D with idempotent double-award guards
- [ ] Refinery Annex building and operational controls
- [ ] Refinery Chains — operational UI, input/output display, cycle management, chain unlocking via R&D
- [ ] Asteroid mining — off-world extraction ops tied to specific starmap bodies
- [ ] System access gated by corporation level
- [ ] Playable mission board with reward payouts
- [ ] Mission types: bounty, rescue, salvage, story

## Version 0.4 — Publishable MVP, Station Building

- [ ] Full buildable building catalogue (all types)
- [ ] Building upgrade (tier) system
- [ ] Orbital shipyard building
- [ ] Full milestone roadmap (Levels 11–40)
- [ ] Market price history and trend display
- [ ] Corporate bond issuance system
- [ ] Loan system
- [ ] Real equity investment in other player corporations
- [ ] Investment returns based on target corp performance
- [ ] Full balance sheet / P&L / cash flow statements
- [ ] Filters and sorting on the Galactic Exchange
- [ ] Forum posting and replying (not display-only)
- [ ] Starmap: expand to 20+ solar systems
- [ ] Starmap: neutral stations shown on map
- [ ] NPC corporations in Sol system

## Version 0.5 — Energy and Metals (Tier 3 Resources)

- [ ] Helium-3 and Deuterium extraction and refinery chains
- [ ] Nickel-Iron Rally — raw metal extraction, smelting, and alloy production
- [ ] Rare Metals chain (rare earths, thorium, cobalt)
- [ ] Light Metals chain (lithium, aluminium composites)
- [ ] Multi-step manufacturing chains across all Tier 3 resource tracks
- [ ] Off-world mining operations on specific starmap bodies
- [ ] Starmap: resource concentration overlay
- [ ] Pirate (Rats) NPC enemies in asteroid fields

## Version 0.6 — Warfare (Attack & Defense, Station Raiding)

- [ ] Attack and defense troop building
- [ ] Fleet building: fighters, destroyers, siege engines
- [ ] Unit rock-paper-scissors counters in combat resolution
- [ ] Accuracy and evasion stats in combat
- [ ] Fleet deployment and fleet management UI
- [ ] Mercenary contract creation and acceptance
- [ ] Station raiding — initiate and defend against corp-vs-corp raids
- [ ] Orbital shipyard as prerequisite for fleet production

## Version 0.7 — Tier 4 Production and Last 5 Resources

- [ ] High-tier exotic resources with R&D gates (Exotic Matter, Uranium, and remaining catalogue entries)
- [ ] Tier 4 manufacturing chains and advanced product synthesis
- [ ] Final 5 resource types fully integrated into extraction, refinery, and market systems

## Version 0.8 — Conglomerates

- [ ] Conglomerate creation and membership system
- [ ] Conglomerate leveling and capacity upgrades (5 → 100 members)
- [ ] Conglomerate resource pooling and shared intel
- [ ] Co-owned conglomerate stations
- [ ] Private messaging between players
- [ ] Starmap: corp and conglomerate dominance overlay

## Version 0.9 — Corporation Warfare

- [ ] Territorial control and system ownership
- [ ] Economic warfare: market flooding, tariffs
- [ ] Lawfare: patents, NPC faction lobbying
- [ ] Galactic Arbitration Council system

## Version 1.0 — Facelift, Stable Release, Published

- [ ] Full visual redesign and UI facelift
- [ ] Bureaucratic UI pass — reinforce the cold corporate sci-fi tone: section headers as formal document codes (e.g. "CORP-OPS-7 // Mining Operations"), status text as dry protocol language, timestamps in UTC with reference numbers, UI chrome that reads like internal corporate software
- [ ] Landing page facelift (visual redesign, messaging polish, improved first-use UX)
- [ ] Performance audit and optimisation
- [ ] Security hardening and public deployment configuration
- [ ] Final balance pass across economy, combat, and progression
- [ ] Public release
