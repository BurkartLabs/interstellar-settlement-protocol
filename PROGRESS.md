# ISP — handoff

**2026-09-23, Builder (Sonnet 5), non-visual session (no CONTROL_URL, no Chrome extension attached — see
"Blind spot" below).**

## What's now true

- `/api/auth/login`, `/register` and `/refresh` are rate-limited (ISP-64, AB#752, merged): 10 login
  attempts/minute per address, 5 failed logins per account per 15 minutes (lockout survives a spoofed source
  address — keyed on email, not IP), 5 registrations/hour per address, 60 refreshes/minute per address.
  `trust proxy` is set to 1 hop app-wide (`server/index.js`). Limits live in `server/rateLimiters.js`,
  overridable per-limiter via `ISP_RATE_LIMIT_*` env vars; under `NODE_ENV=test` they default to a high
  ceiling so the rest of the suite doesn't trip them by accident.
- The tickers no longer deep-clone the account they just mutated, and no longer settle mining redundantly
  (ISP-43a, AB#1448, this PR): `mutateAccountState(id, mutator, { sanitize, settleMining })` — both default
  `true` (every route handler is unchanged) — and all nine tickers in `server/index.js` now pass both `false`.
  Mining still settles exactly once per elapsed interval, inside `miningTick`'s own mutator; no other ticker
  touches mining at all now (the next real read settles what accumulated, same as before). Measured on the
  machine PERFORMANCE.md already had a baseline for: the tickers' combined event-loop share at N = 1,000 fell
  from 35% to 2%.

## Blind spot

This session has no browser (no Chrome extension connected, no CONTROL_URL/token — Builder panes don't get
either by design). Both items above are server-only (routes, headers, tickers) — verified with `npm test`
(146 files / 1482 tests green after AB#1448) and `node --check server/index.js`, plus `npm run bench:ticks`
for the performance claim. Nothing here has a screen, so there is nothing a screenshot would add, but naming
the gap per CLAUDE.md rather than skipping the question.

Several other v0.5-security items were checked and left unclaimed rather than forced:
- **AB#756 (ISP-67, socket auth/rooms):** mostly already done by Bug #710/#1021 — `emitToAccount` rooms, one
  correctly-global `io.emit`. The one open acceptance point (disconnect an unauthenticated socket at handshake)
  conflicts with an intentional feature (anonymous sockets can read public state today). Left a comment on the
  item for PM to trim the acceptance line or decide anonymous sockets should go; not mine to decide solo.
- **AB#734 (ISP-48, security answers + audit)** depends on AB#731/#732 (still Active, in progress elsewhere)
  and AB#756 above — not ready to build against yet.
- **AB#753/755/757/781/987/989** all have a screenshot in their acceptance criteria (CSP console check,
  register page, reload-keeps-logged-in, verification emails) — skipped this session per the Board's
  instruction rather than faked with a proxy for looking.

## What's next

Continuing the ISP backlog by state/priority, favoring v0.5 non-`ui` items not blocked on the above. Re-check
AB#731/#732/#756 next session — once those land, AB#734 becomes buildable. The screenshot-gated items above are
ready to pick up as soon as a browser session is available.

## In flight / blocked

Nothing blocked, nothing left uncommitted. `agent/1448-ticker-cost` branch, PR opening next.
