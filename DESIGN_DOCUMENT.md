# Interstellar Settlement Protocol — Design Document

> Last updated: April 4, 2026

---

## What It Is

A browser-based, text-heavy multiplayer sci-fi corporate strategy game set in 2147. Players are CEOs of interstellar corporations operating under the **Interstellar Settlement Authority (ISA)**. The tone is deliberately bureaucratic and cold — think EVE Online crossed with a spreadsheet simulator, wrapped in a dark void/cyan aesthetic. No mouse-clicking action; you sign leases, hire employees, run mining cycles, post sell orders, and queue research.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ESM, `"type": "module"`) |
| Server | Express 4 + `http.createServer` + Socket.io 4 |
| Auth | JWT (access + refresh tokens) + bcryptjs password hashing |
| Persistence | Supabase (per-player accounts & state), `data/state.json` (global market/world) |
| Frontend | Vanilla JS (ES modules), no framework, no bundler |
| Charts | Chart.js 4 (CDN) |
| Starmap | Custom canvas renderer (`starmap.js`) |
| Fonts | Orbitron (headers), Inter (body) — Google Fonts CDN |
| Dev server | `node --watch server/index.js` on port 3000 |

---

## File Structure

```
server/
  index.js        — Express routes, Socket.io, all gameplay API endpoints
  gameState.js    — Re-exports server/game/*.js, so existing imports keep working
  game/           — the game state, one module per system (AB#737); gameState.js re-exports them
    catalog.js    — data paths and the catalogues read at startup; ids, cloning, the atomic file write
    shape.js      — normalising a stored account's state to the current shape
    mining.js     — extractors: cycles, downtime, mining ticks
    refining.js   — refineries
    asteroids.js  — belts, probes and expeditions
    progression.js — stats, the level ladder, fleet cap, level notices, the exchange tax
    corporation.js — a new corporation, contracts and their offering
    world.js      — the global state: its seed, social and market parts
    store.js      — the in-memory state and accounts, persistence, and the account API
    messaging.js  — mail, drafts and the corporation directory
data/
  state.json      — Global world state (market, chat logs, combat reports, systems)
  stations.json   — Station registry (Earth Station Prime, etc.)
  buildings.json  — Building catalogue (16 NPC + player types)
  research.json, ceo-insight.json, refinery-chains.json, milestones.json
public/
  index.html      — Single-page app shell
  styles.css      — All CSS (dark theme, design system, component styles)
  scripts/
    app.js        — All client-side game logic, rendering, event binding
    charts.js     — Financial chart rendering (Chart.js wrappers)
    starmap.js    — Interactive canvas starmap
    starfield.js  — Background starfield canvas animation
    login-page.js, register-page.js — Auth page scripts
```

---

## Server Architecture (`server/game/`, re-exported by `server/gameState.js`)

**In-memory store** (`server/game/store.js`): accounts are loaded at startup from `accounts-snapshot.json` in the data directory (`ISP_DATA_DIR`) into `accountsStore`, and `state.json` into `state`. All reads and writes happen in memory; `scheduleAccountsSave()` writes the accounts 500 ms after the first unsaved change and `scheduleSave()` the world 300 ms after (Bug #1447), both atomically.

### Code organisation: one module per system (AB#737)

Each game system has its own module under `server/game/`, and a module holds one system's state, rules and I/O, kept apart within it. The soft cap is about 600 lines; a module past 800 is split, and a test enforces 800 for everything under `server/` except `server/index.js`. Why: every system from v0.1 to v0.4 went into one file of 2,641 lines, so no part could be read, reviewed or tested on its own, and every change to any system was a change to the same file, which is where parallel pull requests collided. Modules import only from those below them in this order, so nothing depends on load order: catalog, buildingIds, progression, mining, refining, asteroids, shape, corporation, world, store, messaging. New code imports the module it needs; `server/gameState.js` stays as a re-export so nothing that imports it had to change.

### Key Functions

| Function | Purpose |
|---|---|
| `normalizeStateShape(rawState)` | Ensures all required fields exist on load; called on every account at startup |
| `ensureCorpMiningModel(corp)` | Normalizes the extractor array; handles legacy single-extractor migration |
| `applyMiningOperations(corp, now)` | Tick-based mining calc; called on every `getAccountById`; computes elapsed time, applies throughput, deducts op costs, adds silicates to inventory |
| `evaluateLevelProgress(profileState)` | Recalculates level, requirements, and unlocks on every read; results written back to in-memory store |
| `mutateAccountState(accountId, mutator)` | Pattern for all account mutations; applies mutator, calls `scheduleAccountsSave()`, returns `sanitizeAccount(account)` |
| `sanitizeAccount(account)` | Returns `{ id, email, createdAt, lastLoginAt, walkthroughCompleted, state: deepClone(account.state) }` — no password hash ever reaches the client |
| `scheduleAccountsSave()` | Debounced 500ms; batches rapid writes |

---

## Authentication

- **Real accounts**: email + bcrypt password → JWT access token (7-day) + refresh token (30-day); tokens stored server-side for revocation
- **Dummy account** (`dummy@isp.local`): special pre-seeded account for unauthenticated play; access token expires in 2 hours; progress persists across restarts; reset only via `POST /api/auth/dummy-reset`
- All account-scoped routes guarded by `requireAuth` (JWT verification) + `requireAccountAccess` (token subject must match `:accountId` param)

---

## Corp State Shape

```js
{
  name, ceoName, location,        // "Earth" default
  level,                          // 1–10
  employeeCount, employeeCap,
  officeRented: Boolean,
  offices: [{
    stationId, name, body, systemId, tier,
    rentedAt, rentedUntil,        // Unix ms timestamps
    durationDays                  // 7 | 14 | 21 | 28
  }],
  finances: {
    credits,                      // starting $250,000
    assets,                       // starting $0
    liabilities,                  // always 0 (not yet tracked)
    dailyRevenue, dailyCosts,
    bondYieldPct                  // unused (vestigial)
  },
  mining: {
    silicateExtractors: [{
      id, name, tier, active,
      startedAt, lastTickAt, endsAt,
      throughputPerHour, operationCostPerHour,
      totalMined, totalSpent, lastCompletedAt,
      leaseId                     // links extractor to a lease
    }],
    silicateExtractor: <ref to [0]>  // legacy compat alias
  },
  miningLeases: [{
    id, body, leaseType, issuedAt, cost,
    buildingSlots: 2,             // each lease grants 2 extractor slots
    extractorIds: []
  }],
  inventory: { Silicates: Number },
  unlockedTech: [...techIds],
  buildings: [{ name, ... }],
  milestonesCompleted: [...names],
  milestoneRoadmap: [...names],   // always the full LEVEL_10_MILESTONE_ROADMAP
  tradeHistory: [...],
  stats: {
    silicateSoldOnExchange,
    ironSilicateAlloysManufactured,
    missionsCompleted
  },
  unlocks: { maxBasicExtractorYards: Number },
  queues: {
    corporateRnD: [{ id, name, durationHours, startedAt, ... }],
    ceoInsight: [...]
  }
}
```

---

## Economy Constants

| Item | Value |
|---|---|
| Starting credits | $250,000 |
| Starting assets | $0 |
| Hire cost | $2,000 one-time per employee |
| Payroll | $150/day per employee |
| Office lease | $1,000/day × duration (7 / 14 / 21 / 28 days) |
| Basic Extractor Yard | $50,000 |
| Mars mining lease | $25,000 |
| Luna mining lease | $30,000 |
| Employees required per lease | 5 per active lease |
| Transfer fee | $2/unit within a system, +$3/unit per jump (see Transfers, below) |

---

## Transfers: Fee and Transit Time by Distance (AB#718)

**The decision.** The Board answered AB#693 (how moving resources between stations should cost and take time):
*"distance based time and fees"*. This replaced the flat 2 credits a unit for any pair of stations. The reason, from
T-018: with a flat fee, where goods are processed is not a decision.

**The model.** Distance is counted in jumps between systems on the map in `public/scripts/navigation.js`
(`SYSTEM_ADJACENCY`, the same graph the server's travel times use). Two stations in one system are 0 jumps apart.

- Fee per unit = `sameSystemFeePerUnit` + `perJumpFeePerUnit` × jumps
- Transit time = `sameSystemTransitMinutes` + `perJumpTransitMinutes` × jumps

The numbers are in `data/economy.json` under `logistics`: 2 credits a unit within a system (the old flat fee, so
nothing moved within Sol costs more than before), 3 more a unit per jump, 30 minutes within a system, and 2 hours per
jump. They are a starting point for the balance pass, not tuned against play. The server computes both from the two
station ids (`server/transfers.js`: `transferFee(from, to, quantity)`, `transitTime(from, to)`). The Logistics tab gets
the same rates with the station list and quotes the fee **and the arrival time** on each station's card before
anything is moved (AB#986, ISP-279). Since AB#985 (ISP-278) a dispatch debits the origin and the fee at once and
creates a shipment that credits the destination on the first tick at or after its arrival time (`shipmentTick`,
mirroring `travelTick`); the goods are in neither inventory while in flight, and the Logistics tab lists them
there (`corp.shipments`) until they arrive, moving with no reload on the `logistics:arrived` socket event
(mirroring `travel:arrived`).

**Every pair of stations** (the fee is per unit; a test checks this table against the code):

| From | To | Jumps | Fee per unit | Transit time |
|---|---|---|---|---|
| Earth Station Prime | Luna Gateway | 0 | 2 | 30 min |
| Earth Station Prime | Mars Orbital Dock | 0 | 2 | 30 min |
| Earth Station Prime | Centauri Prime Orbital | 1 | 5 | 2 h 30 min |
| Earth Station Prime | Ironwell Mining Depot | 1 | 5 | 2 h 30 min |
| Earth Station Prime | Halo Anchorage | 2 | 8 | 4 h 30 min |
| Earth Station Prime | Verde Trade Hub | 2 | 8 | 4 h 30 min |
| Earth Station Prime | Kestrel Platform | 3 | 11 | 6 h 30 min |
| Luna Gateway | Mars Orbital Dock | 0 | 2 | 30 min |
| Luna Gateway | Centauri Prime Orbital | 1 | 5 | 2 h 30 min |
| Luna Gateway | Ironwell Mining Depot | 1 | 5 | 2 h 30 min |
| Luna Gateway | Halo Anchorage | 2 | 8 | 4 h 30 min |
| Luna Gateway | Verde Trade Hub | 2 | 8 | 4 h 30 min |
| Luna Gateway | Kestrel Platform | 3 | 11 | 6 h 30 min |
| Mars Orbital Dock | Centauri Prime Orbital | 1 | 5 | 2 h 30 min |
| Mars Orbital Dock | Ironwell Mining Depot | 1 | 5 | 2 h 30 min |
| Mars Orbital Dock | Halo Anchorage | 2 | 8 | 4 h 30 min |
| Mars Orbital Dock | Verde Trade Hub | 2 | 8 | 4 h 30 min |
| Mars Orbital Dock | Kestrel Platform | 3 | 11 | 6 h 30 min |
| Centauri Prime Orbital | Ironwell Mining Depot | 2 | 8 | 4 h 30 min |
| Centauri Prime Orbital | Halo Anchorage | 1 | 5 | 2 h 30 min |
| Centauri Prime Orbital | Verde Trade Hub | 2 | 8 | 4 h 30 min |
| Centauri Prime Orbital | Kestrel Platform | 2 | 8 | 4 h 30 min |
| Ironwell Mining Depot | Halo Anchorage | 2 | 8 | 4 h 30 min |
| Ironwell Mining Depot | Verde Trade Hub | 1 | 5 | 2 h 30 min |
| Ironwell Mining Depot | Kestrel Platform | 2 | 8 | 4 h 30 min |
| Halo Anchorage | Verde Trade Hub | 1 | 5 | 2 h 30 min |
| Halo Anchorage | Kestrel Platform | 1 | 5 | 2 h 30 min |
| Verde Trade Hub | Kestrel Platform | 1 | 5 | 2 h 30 min |

**Where to refine, by arithmetic from the data (not from player behaviour).** The story set out to show that the
cheapest place to refine is sometimes neither the mine's station nor the main market's. The arithmetic shows the
opposite for every chain the game has today. It is written down here because it matters more than the table.

Take the silicates chain (`data/refinery-chains.json`): 100 Silicates make 40 Aerogel and 15 Quantum Insulators, 55
units. A refinery runs where its inputs are held, and every station has an exchange. Mine at Kestrel Platform (Epsilon
Eridani) and sell at Earth Station Prime, 3 jumps away:

- Refine at the mine: ship 55 units 3 jumps: 55 × 11 = **605** credits, and the goods reach Earth 6 h 30 min after
  the cycle ends.
- Refine at Verde Trade Hub, on the way (1 jump from Kestrel, 2 from Sol): 100 × 5 + 55 × 8 = **940** credits, and
  2 h 30 min + 4 h 30 min = 7 hours of transit.
- Refine at Earth: ship 100 units 3 jumps: 100 × 11 = **1,100** credits, and 6 h 30 min of transit before the cycle.

The mine wins on fee and ties or wins on time, and that holds in general. Every chain turns more units in into fewer
out, and jumps obey the triangle inequality. So for any refinery station R between mine M and market K, the fee is
`in × f(M,R) + out × f(R,K) ≥ out × (f(M,R) + f(R,K)) ≥ out × f(M,K)`, which is the fee of refining at the mine.
Time is the same: the two legs through R are never shorter than the direct route. So a fee and a delay that grow with
distance make "refine where you mine" the answer, not a trade-off.

What would give siting a middle: a chain with inputs from two different mines, a station where refining is cheaper or
faster, or prices that differ by station (a market geography). None of these exist yet. That is a design choice for
the Board, filed as a Decision rather than guessed at here.

---

## Gameplay API Routes

All account-scoped routes require a valid Bearer token matching the `:accountId` parameter.

| Route | Method | Action |
|---|---|---|
| `/api/auth/register` | POST | Create account |
| `/api/auth/login` | POST | Authenticate |
| `/api/auth/dummy-login` | POST | Enter as dummy |
| `/api/auth/refresh` | POST | Rotate tokens |
| `/api/auth/logout` | POST | Revoke refresh token |
| `/api/auth/session` | GET | Validate current session |
| `/api/bootstrap` | GET | Global world state (market, systems, chat) |
| `/api/accounts/:id/gameplay/hire` | POST | Hire N employees |
| `/api/accounts/:id/gameplay/rent-office` | POST | Lease office (duration-based) |
| `/api/accounts/:id/gameplay/purchase-lease` | POST | Buy mining rights on a body |
| `/api/accounts/:id/gameplay/build-extractor` | POST | Deploy extractor on a lease |
| `/api/accounts/:id/gameplay/start-mining` | POST | Start a mining cycle |
| `/api/accounts/:id/gameplay/sell` | POST | Post sell order to exchange |
| `/api/accounts/:id/gameplay/buy-npc` | POST | Sell to NPC buy orders (quota-gated) |
| `/api/accounts/:id/gameplay/research` | POST | Enqueue research project |

---

## Frontend (`public/scripts/app.js`)

Single ~3,500-line ES module. No framework, no bundler.

### Global State

**`appState`** — single global object:
```js
{
  data,               // full corp state (mirrors server corp object)
  accountId,          // null when in dummy mode
  token,              // JWT access token
  stationRegistry,    // loaded from /api/stations
  buildingRegistry,   // loaded from /api/buildings
  stationActiveLease, // currently viewed lease ID
  ...
}
```

### Key Patterns

- **`updateAllViews()`** — re-renders every tab section from `appState.data`; called after every mutation
- **Dummy mode** — when `appState.accountId` is falsy, all gameplay actions mutate `appState.data` directly in memory (no API calls); mimics authenticated play
- **Socket.io** — listens for `market:updated`, `chat:message`, `notifications:new`, `finance:updated`
- **Tab system** — `setTab(id)` toggles `.active` on `.nav-tab` and `.tab-panel` and opens the tab's group; the six groups are in `public/scripts/navGroups.js` (ISP-75, AB#764)

### Tabs

| Tab ID | Content |
|---|---|
| `overview` | Corp overview, level progress, milestone roadmap |
| `finance` | Financial Control Board — 4 charts |
| `station` | Earth Station Prime — building grid + detail views |
| `mining` | Silicate extractor panels |
| `market` | Galactic Exchange — sell orders, buy form, trade history |
| `rnd` | Corporate R&D queue + available research |
| `ceo` | CEO Insight Program queue |
| `starmap` | Interactive canvas starmap |
| `forum` | Forum categories and threads |
| `inbox` | Notifications and messages |

### Key Render Functions

| Function | Renders |
|---|---|
| `renderOrbitalExecutiveSuites(building, data)` | Pre-rental lease form OR post-rental Office Interior View |
| `renderISAClaimsLeases(building, data)` | Mining lease list + purchase form |
| `renderFinanceCharts(finances)` | 4× Chart.js charts (cash flow, assets, sector, yield) |
| `renderTechTree(data)` | R&D queue + available research (`.rnd-panel` layout) |
| `updateAllViews()` | Full re-render pass |

---

## Visual Design System

### CSS Variables

```css
--void-black:     #05050f
--cold-navy:      #0a1f2e
--dark-steel:     #112233
--electric-cyan:  #00f7ff   /* --accent */
--text-main:      #d8ebf5
--text-muted:     #89a7bd
--panel:          rgba(10, 31, 46, 0.68)
--panel-border:   rgba(0, 247, 255, 0.18)
```

### Key Component Classes

| Class | Purpose |
|---|---|
| `.form-card` | Standard dark panel card with border and blur |
| `.action-surface` | Slight cyan-tinted background for interactive sections |
| `.btn-accent` | Primary cyan action button |
| `.kv-list` | Definition list for key/value data rows |
| `.building-status-badge` | Inline status badge (`.operational`, `.warning`, `.expired`) |
| `.rnd-panel` | Unified R&D queue panel with two sections |
| `.office-interior` | Post-rental office interior container |
| `.office-panel` | Interior section card |
| `.lease-countdown` | Large Orbitron digit countdown (days remaining) |
| `.office-nav-btn` | Quick-nav pill buttons inside office interior |

---

## Financial Charts (Current State)

All four charts in the Financial Core tab are now wired to real server-side data (v0.4):

| Chart | Data Source | Status |
|---|---|---|
| Cash Flow (30-day) | `finances.cashflowHistory[]` — daily net flow appended on day tick | **Real** |
| Assets / Liabilities | Live `credits`, `assets`, and `liabilities` (outstanding payroll + active office leases) | **Real** |
| Sector Exposure | Computed from `finances.incomeBySource` | **Real** |
| Credits History | `finances.creditsHistory[]` — 30-day balance snapshot series | **Real** |

Full balance sheet / P&L / cash flow statements stored server-side are planned for v0.5.

---

## Level Progression System

Levels 1–10 defined. Each level has a set of requirements that must all be met simultaneously. `evaluateLevelProgress()` runs on every account read and auto-advances level when all requirements are complete. Levels are climbed in order: level N is granted only from level N-1, so meeting a later level first waits for the one below it. Every level at or below the current one keeps its unlocks and its "Reached Corporation Level N" milestone.

| Level | Key Requirements |
|---|---|
| 1 | Rent office, hire 5 employees |
| 2 | Mars mining lease, build extractor, mine 300 silicate |
| 3 | Sell 300 silicate on exchange, research Basic Extraction Analytics |
| 4 | 2nd extractor, 10 employees, Industrial Safety research, sell 50k silicate |
| 5 | Energy Routing research, 2nd lease, 3rd extractor, 15 employees |
| 6 | Ferric Core research, 25 employees, Ferric Mining Complex |
| 7 | Multi-Stage Refinery research, Refinery Complex |
| 8 | 5,000 Iron-Silicate Alloys manufactured, 25 missions |
| 9 | Cryo-Vapor research, Luna lease |
| 10 | Extrasolar Expansion research, asteroid belt operations |

---

## Research Tree (Current Nodes)

| ID | Name | Duration | Cost | Prereqs |
|---|---|---|---|---|
| `tt-basic-extraction` | Basic Extraction Analytics | 2h | $18,000 | — |
| `tt-industrial-safety` | Industrial Safety Protocols | 3h | $26,000 | basic-extraction |
| `tt-supply-forecast` | Supply Forecast Engine | 4h | $32,000 | basic-extraction |
| `tt-energy-routing` | High-Density Energy Routing | 6h | $54,000 | industrial-safety + supply-forecast |

Server-side auto-completion (marking done and applying effects) runs on a five-second tick: `processRndCompletions` in `server/index.js`.

---

## Known Issues

| Issue | Status |
|---|---|
| "Lease Expires" shows Unknown after server restart | Root cause: in-memory state may lag behind Supabase on restart. Investigate hydration timing. |
| Financial charts show fake/placeholder data | Resolved in v0.4 — all four charts wired to live server-side data |
| R&D queue completion is client-display-only | Server-side auto-completion not yet implemented |
| `rentedUntil` lapse enforcement not implemented | Office benefits not locked when lease expires |

---

## Operational Rules

1. **Stop the server before editing `data/*.json` directly** — the in-memory store will overwrite any file changes on next save tick
2. Restart the dev server with `node --watch server/index.js` from the project root
3. Hard-refresh the browser (**Ctrl + Shift + R**) after editing JS or CSS
4. Work is tracked in Azure DevOps (area `interstellar-settlement-protocol`), with the version plan in `DEVELOPMENT_PHASES.md`; `Todos.md` is retired (AB#412)

---

## Development Roadmap Summary

See `DEVELOPMENT_PHASES.md` for the full version-by-version plan.

| Version | Focus |
|---|---|
| 0.1 | Core systems — auth, mining, exchange, station, R&D ✅ |
| 0.2 | Walkthrough, office rental, mining leases, downtime, exchange, persistent accounts ✅ |
| 0.3 | Full R&D tree, CEO Insight, refinery chains, asteroid mining, missions ✅ |
| 0.4 | Testing automation, server-authoritative financial core, system-scoped local chat, interactive forums ✅ |
| 0.5 | Beta MVP — polish, persistence completion, exchange/logistics polish, tutorial pass, bug bash, public beta deploy |
| 0.6 | Industrial expansion — full building catalogue, upgrade tiers, Levels 11–40 |
| 0.7 | World expansion — 20+ solar systems, neutral stations, NPC corps, pirates |
| 0.8 | Energy and metals (He-3, nickel-iron, rare metals) |
| 0.9 | Financial markets — bonds, loans, equity, investment returns |
| 0.10 | Warfare — orbital shipyard, fleets, station raiding |
| 0.11 | Tier 4 production and last 5 resources |
| 0.12 | Conglomerates — alliances, shared stations, private messaging |
| 0.13 | Corporation warfare — territory, economic warfare, lawfare |
| 1.0 | Facelift, balance pass, security hardening, public 1.0 release |
