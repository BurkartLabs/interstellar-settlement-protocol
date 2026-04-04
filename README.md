# Interstellar Settlement Protocol (ISP)

![Interstellar Settlement Protocol](https://i.imgur.com/mrvAKGt.jpeg)

> *"Humanity didn't reach the stars for freedom. It reached them for market share."*

**ISP** is a browser-based, multiplayer, text-heavy sci-fi strategy game set in the year 2147. You are the CEO of a fledgling interstellar corporation operating under the jurisdiction of the Interstellar Settlement Authority. Your goal: build an empire from a modest office on Earth Station Prime — through mining, manufacturing, research, trade, and, eventually, warfare.

This repository is an actively developed prototype. The core systems are functional and playable today; the full vision is mapped out across [DEVELOPMENT_PHASES.md](DEVELOPMENT_PHASES.md).

---

## What Kind of Game Is This?

ISP sits at the intersection of **corporate strategy**, **resource management**, and **multiplayer political economy**. Think Eve Online crossed with a spreadsheet simulator, delivered entirely through a dark-themed web UI with no install required.

You do not shoot things with a mouse. You **sign leases**, **hire staff**, **run mining cycles**, **post sell orders**, and **research proprietary extraction technology**. Combat exists — but it is an instrument of economic strategy, not the point of it.

The tone is deliberately bureaucratic. The ISA has forms for everything.

---

## Core Gameplay Loop (Current Prototype)

1. **Register a corporation** — choose your CEO name and corporation identity.
2. **Rent office space** at Earth Station Prime to establish a formal registered presence.
3. **Hire employees** — your headcount gates what you can do next.
4. **File a mining lease** with the ISA Claims & Leases Division on Mars.
5. **Deploy a Basic Extractor Yard** on your leased territory.
6. **Run mining cycles** — extractors consume credits and produce Silicates over time.
7. **Sell your resources** on the Galactic Exchange — to other players, or into NPC standing buy orders.
8. **Research** proprietary technologies in the Corporate R&D queue to improve throughput, unlock refinery chains, and expand your operation.
9. **Level up** your corporation by hitting milestone requirements — each level unlocks new capabilities, building slots, fleet capacity, and market sectors.
10. Repeat at larger scale. Hire more, mine more, trade more, dominate.

---

## Feature Overview

### Corporation Management
- Real account registration with email/password (bcrypt-hashed)
- JWT authentication with refresh token rotation
- Corporation identity, level (1–40 cap), and milestone-gated progression

### Earth Station Prime
- 16-building NPC district with faction badges and lore descriptions
- Orbital Executive Suites: rent an office, hire employees, access ISA services
- ISA Claims & Leases Division: purchase and manage planetary mining leases
- More buildings unlocking across development versions

### Mining Operations
- Multiple simultaneous silicate extractors, each linked to a specific mining lease
- Visual per-extractor progress bars with cycle stats (mined, fees, rate)
- Mining history and per-extractor lifetime totals

### Galactic Exchange
- Real-time order book — player sell orders visible to all, filterable by resource
- Your own listings never appear in the sell orders you can buy from
- NPC standing buy orders (GEX Commodities Authority) — sell directly at the listed peg price, no waiting; daily quota resets at midnight EST
- Full trade history — every listing, purchase, and sale recorded with counterparty, quantity, price, and timestamp
- My Active Listings section — manage your open sell orders separately

### Research & CEO Development
- Corporate R&D queue — queue research projects, track progress with time and percentage remaining
- CEO Insight Program — parallel queue for leadership and operational bonuses
- Research gates refinery chain unlocks and extraction improvements

### Realtime Infrastructure
- Socket.io live events: market updates, chat, finance state
- In-game notification system
- Persistent JSON state survives server restarts

### Other Systems
- Interactive starmap — pan/zoom, system selection, overlay filters (resource, GDP, pirate density)
- Forum UI with categories, threads, and replies
- Mission board with story and bounty missions
- Deterministic combat report generator
- Real-time chat — Global, Local (system-scoped), Trade, Private channels

---

## Lore

For the background, factions, and world history behind ISP, see [LORE.md](LORE.md).

---

## Development Roadmap

See [DEVELOPMENT_PHASES.md](DEVELOPMENT_PHASES.md) for the full version-by-version plan from current prototype to v1.0 public release.

**Current version:** `0.1` (prototype — core systems functional)  
**Next milestone:** `0.2` — walkthrough, refined economy, persistent accounts, market matching engine

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5 + Vanilla JS + Plain CSS |
| Realtime | Socket.io |
| Charts | Chart.js |
| Backend | Node.js + Express (ESM) |
| Auth | JWT + bcrypt |
| Persistence | Local JSON files (`data/`) |

No frontend framework. No build step. Runs with Node only.

---

## Running Locally

**Requirements:** Node.js 18+

```bash
# Install dependencies
npm install

# Start in development mode (auto-restarts on file change)
npm run dev

# Or start in production mode
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

A demo account is available at the login screen. You can also register a real account — all data is persisted in `data/accounts.json` and `data/state.json` locally.

---

## Project Structure

```
server/
  index.js        — Express API, Socket.io event handlers, route definitions
  gameState.js    — Seed state, mutation helpers, account management, JSON persistence

public/
  index.html      — Main application shell and all UI panels
  styles.css      — Dark theme, responsive layout, atmospheric effects
  scripts/
    app.js        — Frontend state, rendering, form handling, realtime bindings
    charts.js     — Finance chart generation
    starmap.js    — Interactive star map renderer
    starfield.js  — Animated starfield background

data/
  state.json      — Auto-generated global game state (market, world, forums)
  accounts.json   — Auto-generated player account store
  buildings.json  — NPC building definitions for station districts
  milestones.json — Milestone definitions for level progression
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development conventions, branching strategy, and how to propose changes.

---

## Accessibility

- Text-dominant UI with high contrast throughout
- All game systems except the starmap are fully usable without graphics
- Starmap includes a text-summary fallback mode
- No JavaScript frameworks or heavy dependencies required on the client
