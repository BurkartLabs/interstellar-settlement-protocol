# ISP — handoff

**2026-09-23, Builder (Sonnet 5), non-visual session (no CONTROL_URL, no Chrome extension attached — see
"Blind spot" below). Rewritten to fold in a parallel session's AB#1124 work merged the same day.**

## What's now true

- `/api/auth/login`, `/register` and `/refresh` are rate-limited (ISP-64, AB#752): 10 login attempts/minute
  per address, 5 failed logins per account per 15 minutes (lockout keyed on email, not address; the no-email
  fallback goes through express-rate-limit's own `ipKeyGenerator`, not a raw `req.ip` — AB#1747, fixed the
  `ERR_ERL_KEY_GEN_IPV6` startup log the first version left), 5 registrations/hour per address, 60
  refreshes/minute per address. `trust proxy` is 1 hop app-wide. Limits live in `server/rateLimiters.js`,
  overridable per-limiter via `ISP_RATE_LIMIT_*` env vars; under `NODE_ENV=test` they default high so the rest
  of the suite doesn't trip them by accident.
- The tickers no longer deep-clone the account they just mutated, and no longer settle mining redundantly
  (ISP-43a, AB#1448): `mutateAccountState(id, mutator, { sanitize, settleMining })`, both default `true`
  (route handlers unchanged). Combined ticker event-loop share at N = 1,000 fell from 35% to 2% (PERFORMANCE.md).
- `tt-energy-routing` and `tt-material-compression`'s research effect text (AB#1259) says what it actually
  unlocks instead of a mechanic nothing read. Fixed in all three duplicated catalogs (`data/research.json`,
  `server/index.js` `RESEARCH_LIBRARY`, `public/scripts/app.js` `techTree`); unifying those three is AB#1049's
  separate scope. New schema test guards every research effect has a stated unlock or a real reader.
- An office authorizes a corporation only at the station it was rented at, while its lease has not lapsed
  (AB#1124, parallel session): hiring, renting, leasing and starting a mining cycle all read one helper,
  `activeOfficeAt(corp, stationId, now)`. Confidence medium — flagged in that PR for the Board to veto if a
  company-wide office was intended.

## Filed, not fixed (out of this session's scope)

- **AB#1744**: `tests/integration/construct-assembly.test.js` is flaky under load (~1 run in 3) — a fixed 50ms
  `setTimeout` used as a sync primitive for an async POST, not tied to the request completing.

## Blind spot

No browser this session (no Chrome extension, no CONTROL_URL — Builder panes don't get either by design).
Everything above is server/data-only — verified with `npm test` (148 files / 1493 tests green) and
`node --check`, plus `npm run bench:ticks` for the AB#1448 claim and a direct import of `server/index.js` with
a `console.error` spy for the AB#1747 claim. Nothing here has a screen. (AB#1124's new refusal text is also
read from two screens nobody has looked at yet — noted by that session, still true.)

Checked and left unclaimed rather than forced:
- **AB#756 (ISP-67, socket auth/rooms):** mostly already done by Bug #710/#1021. One open acceptance point
  (disconnect an unauthenticated socket at handshake) conflicts with an intentional feature (anonymous read
  access). Commented on the item for PM to trim the acceptance line or decide anonymous sockets should go.
- **AB#734 (ISP-48)** depends on AB#731/#732 (still Active elsewhere) and AB#756 above — not buildable yet.
- **AB#753/755/757/781/987/989**: all have a screenshot in their acceptance criteria — skipped per the Board's
  instruction rather than faked with a proxy for looking.

## What's next

- Re-check AB#731/#732/#756 next session — once those land, AB#734 becomes buildable.
- The screenshot-gated v0.5 items above are ready to pick up once a browser session is available.

## In flight / blocked

Nothing blocked, nothing left uncommitted. `fix/rate-limiter-ipv6-warning` branch, PR opening next.
