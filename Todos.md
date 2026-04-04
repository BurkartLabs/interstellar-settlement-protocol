# ISP — Development Todos

This file tracks outstanding tasks, bugs, and improvements for The Interstellar Settlement Protocol.
GitHub Copilot should read this file at the start of every session and reference it when suggesting or making changes.
**Copilot must always ask for permission before marking any item complete or adding new items.**

---

## In Progress

*(none)*

---

## Backlog

### Economy Constants *(surgical server-side fixes)*
- [x] Starting credits: correct `$150,000` → `$250,000` in `gameState.js`
- [x] Starting assets: correct `$150,000` → `$0` in `gameState.js`
- [x] Hire cost: correct `$1,200` → `$2,000` per employee in `index.js`
- [x] Payroll rate: correct `$36/day` → `$150/day` per employee in `index.js`
- [x] Extractor yard cost: two conflicting values in `index.js` (`$50,000` and `$65,000`) — reconcile both to `$50,000`

### Office Rental Model *(significant rework)*
- [ ] Switch office from flat `$20,000` one-time fee to `$1,000/day` recurring with a **30-day minimum** (`$30,000` committed upfront at point of rental)
- [ ] Track `rentedUntil` timestamp on corp state; lock office benefits (hiring, leases) if lease lapses
- [ ] Office interior view — show lease status, days remaining, renewal option, payroll summary, and quick-nav links to related tabs

### Walkthrough *(full overhaul)*
- [ ] Overhaul the guided first-session walkthrough to fully conform to the 11-step sequence defined in `NEW_PLAYER_EXPERIENCE.md`

### Silicate Mining
- [ ] Implement facility downtime risk mechanic: per-second shutdown probability (~0.005%), recovery rate (~0.0276%/s), auto-resume on recovery, R&D `Industrial Safety Protocols` node reduces risk

### Corporation Progression
- [ ] Level-up system (Levels 1–10) — define milestone triggers and grant rewards on completion: employee cap increase, building slot increase, fleet cap increase, market sector unlocks
- [ ] Wire full milestone roadmap to level-up triggers so milestones drive progression rather than being display-only

### Market
- [ ] Market order matching engine — player-created buy orders automatically fill against matching sell orders

### Chat
- [ ] Local chat channel scoped to the player's current solar system (distinct from Global channel)

### Server-Side R&D Auto-Completion
- [ ] Server `setInterval` tick that scans `queues.corporateRnD` for elapsed items (`startedAt + durationHours * 3600000 < Date.now()`), marks them complete, applies tech effects to authoritative state, and emits WebSocket + notification events

---

## Completed

*(none)*
