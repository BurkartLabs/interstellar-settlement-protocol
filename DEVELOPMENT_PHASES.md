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

## Version 0.2

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
- [x] Remove the requirement for Accounts.json and rely on supabase integration 

## Version 0.4 — Current — Testing Automation, Financial Core, Comms

Scope kept tight: testing infrastructure, server-authoritative finance charts, and chat/forum interactivity. Larger systems originally listed here have been split into dedicated versions below.

- [x] Implement automated testing framework (unit, integration, and end-to-end tests)
- [x] Add test coverage reporting to CI pipeline
- [x] Write tests for core game logic (mining, leasing, exchange, R&D)
- [x] Ensure all new features include corresponding tests
- [x] Local chat tied to player's current solar system
- [x] Forum posting and replying (not display-only)
- [x] Financial Core — Cash Flow chart: 30-day daily net flow history server-side (`finances.cashflowHistory[]`)
- [x] Financial Core — Assets/Liabilities chart: live sum of outstanding payroll obligations and active office lease commitments
- [x] Financial Core — Sector Exposure pie: live data derived from `finances.incomeBySource`
- [x] Financial Core — Credits History chart: 30-day credits balance snapshot series (`finances.creditsHistory[]`)

## Version 0.5 — Beta MVP: Polish & Publish

The first publishable beta release. No new major systems — only the polish, persistence, and trust work needed to put the current game in front of real players.

**Persistence & Reporting**
- [ ] Full balance sheet / P&L / cash flow statements stored server-side (currently only active-session data in browser)
- [ ] Market price history and trend display (per-item rolling chart on the Galactic Exchange)

**Exchange & Logistics Polish**
- [ ] Filters and sorting on the Galactic Exchange
- [ ] Resource Transportation polish pass — basic transfer endpoint already exists (`POST /transfer-resources`, flat $2/unit logistics fee, instant). Decide fee model (flat vs. distance-based across system hops), decide instant vs. timed transit, audit UX (bulk transfers, transfer history, error messaging), add tests

**Onboarding & Tutorial**
- [ ] Tutorial / NEW_PLAYER_EXPERIENCE polish pass against the live build
- [ ] First-session UX audit (empty states, error copy, dead ends)

**Release Engineering**
- [ ] Bug bash across all 0.1–0.4 systems
- [ ] Balance pass on economy (mining yields, refinery cycles, payroll, office costs)
- [ ] Performance audit (tick cost at scale, Supabase persistence frequency, client render budget)
- [ ] Security hardening pass (auth, rate limiting, input validation, secrets handling)
- [ ] Public beta deployment configuration

## Version 0.6 — Industrial Expansion

Round out the build/upgrade loop and the milestone progression that drives mid-game.

- [ ] Full buildable building catalogue (all types currently designed)
- [ ] Building upgrade (tier) system
- [ ] Full milestone roadmap (Levels 11–40)
- [ ] Full milestone roadmap wired to level-up system

## Version 0.7 — World Expansion

Scale up the universe so progression past Sol feels meaningful.

- [ ] Starmap: expand to 20+ solar systems
- [ ] Starmap: neutral stations shown on map
- [ ] NPC corporations in Sol system (price anchoring + flavour presence)
- [ ] Pirate (Rats) NPC enemies in asteroid fields

## Version 0.8 — Energy and Metals (Tier 3 Resources)

- [ ] Helium-3 and Deuterium extraction and refinery chains
- [ ] Nickel-Iron Rally — raw metal extraction, smelting, and alloy production
- [ ] Rare Metals chain (rare earths, thorium, cobalt)
- [ ] Light Metals chain (lithium, aluminium composites)
- [ ] Multi-step manufacturing chains across all Tier 3 resource tracks
- [ ] Off-world mining operations on specific starmap bodies
- [ ] Starmap: resource concentration overlay

## Version 0.9 — Financial Markets

A coherent debt/equity layer. Grouped together because each instrument needs the others (and a price-history substrate) to be meaningful.

- [ ] Corporate bond issuance system
- [ ] Loan system (player-to-player and NPC underwriters)
- [ ] Real equity investment in other player corporations
- [ ] Investment returns based on target corp performance
- [ ] Credit rating / risk model exposed to lenders and investors

## Version 0.10 — Warfare (Attack & Defense, Station Raiding)

- [ ] Orbital shipyard building (prerequisite for fleet production)
- [ ] Attack and defense troop building
- [ ] Fleet building: fighters, destroyers, siege engines
- [ ] Unit rock-paper-scissors counters in combat resolution
- [ ] Accuracy and evasion stats in combat
- [ ] Fleet deployment and fleet management UI
- [ ] Mercenary contract creation and acceptance
- [ ] Station raiding — initiate and defend against corp-vs-corp raids

## Version 0.11 — Tier 4 Production and Last 5 Resources

- [ ] High-tier exotic resources with R&D gates (Exotic Matter, Uranium, and remaining catalogue entries)
- [ ] Tier 4 manufacturing chains and advanced product synthesis
- [ ] Final 5 resource types fully integrated into extraction, refinery, and market systems

## Version 0.12 — Conglomerates

- [ ] Conglomerate creation and membership system
- [ ] Conglomerate leveling and capacity upgrades (5 → 100 members)
- [ ] Conglomerate resource pooling and shared intel
- [ ] Co-owned conglomerate stations
- [ ] Private messaging between players
- [ ] Starmap: corp and conglomerate dominance overlay

## Version 0.13 — Corporation Warfare

- [ ] Territorial control and system ownership
- [ ] Economic warfare: market flooding, tariffs
- [ ] Lawfare: patents, NPC faction lobbying
- [ ] Galactic Arbitration Council system

## Version 1.0 — Facelift, Stable Release, Published

- [ ] Full visual redesign and UI facelift
- [ ] Bureaucratic UI pass — reinforce the cold corporate sci-fi tone: section headers as formal document codes (e.g. "CORP-OPS-7 // Mining Operations"), status text as dry protocol language, timestamps in UTC with reference numbers, UI chrome that reads like internal corporate software
- [ ] Landing page facelift (visual redesign, messaging polish, improved first-use UX)
- [ ] Final performance audit and optimisation
- [ ] Final security hardening and public deployment configuration
- [ ] Final balance pass across economy, combat, and progression
- [ ] Public 1.0 release
