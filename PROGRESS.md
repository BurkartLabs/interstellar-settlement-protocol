# ISP — handoff

**2026-09-23, Builder (Sonnet 5), non-visual session (no CONTROL_URL, no Chrome extension attached — see
"Blind spot" below).**

## What's now true

- `/api/auth/login`, `/register` and `/refresh` are rate-limited (ISP-64, AB#752, merged): 10 login
  attempts/minute per address, 5 failed logins per account per 15 minutes (lockout survives a spoofed source
  address — keyed on email, not IP), 5 registrations/hour per address, 60 refreshes/minute per address.
  `trust proxy` is set to 1 hop app-wide (`server/index.js`). Limits live in `server/rateLimiters.js`,
  overridable per-limiter via `ISP_RATE_LIMIT_*` env vars; under `NODE_ENV=test` they default to a high
  ceiling so the rest of the suite doesn't trip them by accident. **Known issue, being fixed next**: logs
  `ERR_ERL_KEY_GEN_IPV6` on every server start (found by a parallel session) — see "What's next".
- The tickers no longer deep-clone the account they just mutated, and no longer settle mining redundantly
  (ISP-43a, AB#1448, merged): `mutateAccountState(id, mutator, { sanitize, settleMining })` — both default
  `true` (every route handler is unchanged) — and all nine tickers in `server/index.js` now pass both `false`.
  Mining still settles exactly once per elapsed interval, inside `miningTick`'s own mutator; no other ticker
  touches mining at all now (the next real read settles what accumulated, same as before). Measured on the
  machine PERFORMANCE.md already had a baseline for: the tickers' combined event-loop share at N = 1,000 fell
  from 35% to 2%.
- `tt-energy-routing` and `tt-material-compression`'s research effect text (AB#1259, bug, this PR) no longer
  promises a mechanic nothing reads ("+1 advanced manufacturing lane", "+8% refining throughput"): both now say
  what they actually unlock, in `data/research.json`, `server/index.js`'s `RESEARCH_LIBRARY` and
  `public/scripts/app.js`'s `techTree` (the three duplicates already tracked for unification in AB#1049 — not
  this story's scope, but a copy fix has to land in whichever one the client actually renders from, which is
  `techTree`). A new schema test (`tests/schema/data-files.test.js`) asserts every research effect is either a
  stated "Unlocks"/"Enables" or has a real reader listed in `RESEARCH_EFFECT_READERS`, and that the reader still
  references the tech id, so a future effect with no reader fails loudly instead of shipping quietly.
- Filed AB#1744 (not fixed): `tests/integration/construct-assembly.test.js` is flaky under load — a fixed 50ms
  `setTimeout` used as a synchronization primitive for an async POST, not tied to the request actually
  completing. ~1 run in 3 in a full `npm test`, always green in isolation. Root cause and proposed fix are on
  the bug.
- An office authorizes a corporation only at the station it was rented at, and only while its lease has not
  lapsed (AB#1124, merged PR !388): hiring, renting an office, filing a mining lease and starting a mining
  cycle all read one helper, `activeOfficeAt(corp, stationId, now)`, in `server/index.js`. Previously hiring
  checked no office at all, renting one worked from any station in the registry (including systems a fresh
  corporation cannot reach), and filing a lease accepted any office ever rented anywhere, expired or not. Six
  existing suites needed an office added to their fixtures to keep passing; one of those changes matters beyond
  test plumbing — "at the employee cap but not yet promoted" is no longer reachable at level 0, because hiring
  now needs an office, and any office plus 5+ employees already completes level 1's own requirements. New
  coverage: `tests/integration/office-requirement.test.js` (9 tests, 7 of which fail on the pre-fix code).
  Confidence medium, as the original filing said: this reads the Suites/claims-office copy as requiring a
  *local* office; flagged in the PR for the Board to veto if a company-wide office was intended.
- AB#1122 (a blank Head Count/Throughput/durationDays hiring or renting for the default price) was **not**
  fixed by the parallel session that looked at it: it was already fixed by AB#731's merge two days earlier,
  filed just after that fix landed but at a commit that predated it reaching the branch that session found it
  on. Closed as a duplicate with the read of current `server/gameplayInput.js` as evidence (P-DUPLICATE-FIX),
  rather than re-fixing it.

## Blind spot

This session has no browser (no Chrome extension connected, no CONTROL_URL/token — Builder panes don't get
either by design). Everything above is server/data-only (routes, tickers, catalog copy) — verified with
`npm test` (147 files / 1492 tests green after AB#1259) and `node --check`, plus `npm run bench:ticks` for the
AB#1448 performance claim. Nothing here has a screen, so there is nothing a screenshot would add, but naming
the gap per CLAUDE.md rather than skipping the question. (AB#1124, from the parallel session, is the same kind
of server-only fix; its new refusal text is also read from two screens that were not looked at, verified
instead with a live server run exercising the real HTTP routes directly.)

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

- **AB#752's rate limiter** (`server/rateLimiters.js:86`) logs `ERR_ERL_KEY_GEN_IPV6` on every server start —
  the server still starts, so not a blocker, but it needs filing and a fix: express-rate-limit v8 validates a
  custom `keyGenerator` (the per-account login limiter, keyed on email) for IPv6-safety even though it never
  touches an IP, which is almost certainly a false positive from the validator, not a real key-collision risk —
  needs confirming against the library's source before deciding whether to silence it or restructure the key.
- Re-check AB#731/#732/#756 next session — once those land, AB#734 becomes buildable.
- The screenshot-gated v0.5 items (AB#753/755/757/781/987/989) are ready to pick up once a browser session is
  available.

## In flight / blocked

Nothing blocked, nothing left uncommitted. `fix/1259-research-effects` merged; `fix/1124-office-requirement`
also merged (P-STRANDED, both worktrees removed). Picking up the `ERR_ERL_KEY_GEN_IPV6` fix next, on a new
branch.
