# ISP Development Roadmap

Each version represents a meaningful, playable milestone. Items marked [x] are complete.

## Version 0.1

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

## Version 0.2 — Current

- [x] Starting credits: **$250,000** (currently $150,000 in code — needs correction)
- [x] Starting assets: $0
- [x] Hire cost: **$2,000/employee** one-time (currently $1,200 — needs correction)
- [x] Payroll: **$150/day per employee** (currently $36 — needs correction)
- [x] Office cost: **$1,000/day, 30-day minimum** rental (currently flat $20,000 one-time — needs rework to recurring model)
- [x] Basic Extractor Yard cost: **$50,000 + logistics fees** (currently $65,000 — needs correction)
- [x] Office rental cost model — switch from one-time fee to **$1,000/day recurring** with a **30-day minimum** commitment; deduct on lease; track `rentedUntil` timestamp; lock office benefits if lease lapses
- [x] Mining rights leasing system — lease extraction rights in Sol before building extractors; each lease grants **2 building slots on that body**; requires **5 employees per active lease** (e.g. 23 employees → max 4 leases); ISA Claims & Leases Division building in station
- [x] Corporation level-up system (Levels 1–10) with full reward grants (employee caps, building slots, fleet caps, market sector unlocks)
- [x] Market order matching engine — buy orders meet sell orders
- [x] Players can purchase from existing sell orders on the exchange
- [x] NPC corporations populate the exchange with sell orders for price anchoring and supply volume
- [x] Persistent game state — all corp and world state survives server restart across sessions
- [x] Persistent chat history
- [x] Office interior view — after renting, entering the Orbital Executive Suites shows a dedicated office panel with: lease status and expiry, hire employees form, active headcount and payroll summary, and quick-nav links to related tabs
- [x] Silicate mining refinements — facility downtime risk mechanic (per-second shutdown probability ~0.005%, recovery ~0.0276%/s; R&D modifiers reduce risk; automatic resume; extractor panel visibility)
- [x] Server-side R&D queue auto-completion — server tick scans `queues.corporateRnD`, computes elapsed time from `startedAt + durationHours`, marks completions, applies tech effects to authoritative state, emits websocket and notification events
- [x] Interactive walkthrough — guided first-session onboarding following the sequence in NEW_PLAYER_EXPERIENCE.md

## Version 0.3 — Tier 1 Research, Refinery Chains, Asteroid Mining, Missions

- [x] Full Corporate R&D tree (all Tier 1 and Tier 2 nodes) with effects applied to live gameplay values
- [x] CEO Insight Program — full node library, queue processing, and bonus application (morale, negotiation, charisma, leadership)
- [x] Server-side CEO Insight queue auto-completion — same authoritative pipeline as R&D with idempotent double-award guards
- [x] Refinery Annex building and operational controls
- [x] Refinery Chains — operational UI, input/output display, cycle management, chain unlocking via R&D
- [x] Asteroid mining — off-world extraction ops tied to specific starmap bodies
- [x] System access gated by corporation level
- [x] 1st Mission Agent - Logistics 
- [ ] Remove the requirement for Accounts.json and rely on supabase integration 

## Version 0.4 — Testing Automation, Publishable MVP, Station Building

- [ ] Implement automated testing framework (unit, integration, and end-to-end tests)
- [ ] Add test coverage reporting to CI pipeline
- [ ] Write tests for core game logic (mining, leasing, exchange, R&D).
- [ ] Ensure all new features include corresponding tests
- [ ] Full buildable building catalogue (all types)
- [ ] Building upgrade (tier) system
- [ ] Orbital shipyard building 
- [ ] Resource Transporation (move resources between Stations for logistics fee) 
- [ ] Full milestone roadmap (Levels 11–40)
- [ ] Market price history and trend display
- [ ] Corporate bond issuance system
- [ ] Loan system
- [ ] Real equity investment in other player corporations
- [ ] Investment returns based on target corp performance
- [ ] Full balance sheet / P&L / cash flow statements
- [ ] Financial Core — Cash Flow chart: track 30-day daily net flow history server-side (`finances.cashflowHistory[]`); replace sine-wave projection with real historical data; append a new entry each server day tick
- [ ] Financial Core — Assets/Liabilities chart: track liabilities as a live sum of outstanding payroll obligations and active office lease commitments; display real values instead of the always-zero placeholder
- [ ] Financial Core — Sector Exposure pie: compute revenue split from actual income sources (silicate mining, trade, R&D grants, etc.); replace the hardcoded `[36, 24, 19, 11, 10]` slices with live data derived from `finances.incomeBySource`
- [ ] Financial Core — Credits History chart: repurpose the Bond Yield chart (no bond system yet) to show a 30-day credits balance snapshot series; track `finances.creditsHistory[]` server-side alongside cashflow history
- [ ] Filters and sorting on the Galactic Exchange
- [ ] Forum posting and replying (not display-only)
- [ ] Starmap: expand to 20+ solar systems
- [ ] Starmap: neutral stations shown on map
- [ ] NPC corporations in Sol system
- [ ] Full milestone roadmap wired to level-up system
- [ ] Local chat tied to player's current solar system

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
