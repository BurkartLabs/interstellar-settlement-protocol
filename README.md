# The Interstellar Settlement Protocol (ISP) - Prototype

Production-ready prototype scaffold for a browser-based, text-heavy online multiplayer sci-fi strategy game.

## Stack

- Frontend: HTML5 + vanilla JavaScript + plain CSS
- Charts: Chart.js
- Realtime: Socket.io
- Backend: Node.js + Express
- Persistence: local JSON state file at `data/state.json`

## Implemented Prototype Modules

- Dark atmospheric UI shell aligned to the specified palette.
- Milestone-based corporation progression model (level 1-40 framing).
- Corporate dashboard with finance controls and investment panel.
- Financial charts:
  - Cash flow projection
  - Asset/liability profile
  - Sector exposure pie chart
  - Yield trend bars (candlestick-like placeholder)
- Parallel queue placeholders:
  - Corporate R&D
  - CEO Insight Program
- Resource/refinery chain view with R&D-gated outputs.
- Galactic market:
  - Buy/sell order submission
  - Real-time order book updates
  - Mercenary rental listings
- Realtime chat channels:
  - Global
  - Local
  - Trade
  - Private (placeholder delivery model)
- Forum UI with categories, thread, reply, and likes placeholders.
- Mission board with story/control-shift flags.
- Deterministic combat report generator.
- Interactive starmap (primary visual feature):
  - Pan + zoom
  - Overlay filters (resource/GDP/activity/pirates)
  - System selection details
  - Sol-system detail rendering at higher zoom
- Text-only fallback toggle so gameplay remains usable when graphics are disabled.

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start server:

```bash
npm run dev
```

3. Open browser:

`http://localhost:3000`

## Project Structure

- `server/index.js` - Express API, Socket.io events, static hosting
- `server/gameState.js` - seed state, mutation helpers, JSON persistence
- `public/index.html` - module shell and all placeholder interfaces
- `public/styles.css` - dark theme, responsive layout, subtle atmospheric effects
- `public/scripts/app.js` - frontend state, forms, rendering, realtime bindings
- `public/scripts/starmap.js` - starmap renderer + interactions + text fallback
- `public/scripts/charts.js` - finance chart generation and refresh
- `data/state.json` - auto-generated persistent state

## Notes for Expansion

- Replace placeholder auth with real account/session systems.
- Migrate from JSON persistence to PostgreSQL/Supabase once schema stabilizes.
- Add deterministic hybrid warfare layers (economic, legal, political) to dedicated services.
- Add moderation tooling and permission models for chat/forums.
- Add full market settlement engine, escrow, and contract enforcement.
- Split game systems into domain modules (corp, market, warfare, diplomacy, map, missions).

## Accessibility

- Text-dominant UI with high contrast.
- Non-map systems are fully usable without graphics.
- Starmap includes text fallback summary mode.
