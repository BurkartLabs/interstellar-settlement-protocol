# ISP — handoff

**2026-09-25, Builder #2 (Sonnet 5). Rewritten after ISP-89 (AB#779), on top of the ISP-48 and ISP-67 handoffs
below (still accurate; not this session's own work).**

## What's now true (this session: ISP-89, AB#779)

- **ISP-89 is done: `tests/unit/no-payments.test.js` exists**, scanning every `.js`/`.html`/`.css` file under
  `server/` and `public/` for payment and pricing vocabulary, with a three-entry allowlist (two benign
  "premium" matches, and the one sanctioned credits formatter, `toCurrency` at `public/scripts/app.js:478`).
  Verified per its own acceptance line with a temporary, uncommitted `import Stripe from "stripe"` — caught it,
  then reverted before committing.
- **Update from a peer Builder mid-session (2026-09-25, relayed by the Board): AB#747 (ISP-61) shipped
  `e2e/first-hour.spec.js`, a real Playwright playtest that saves screenshots without the Chrome extension.**
  This should unblock AB#753/755/757/781/987/989 — the screenshot-gated v0.5 items ISP-67's and ISP-48's own
  handoffs both listed as unclaimable for lack of a browser session. **Not yet verified by this session** —
  next session (or the rest of this one) should confirm the file exists on `origin/main`, read it, and decide
  whether it (or a new `scripts/look-*.mjs` in its pattern) is the way to satisfy those items' screenshot
  requirements before claiming one.
- **New bug, filed not fixed:** AB#1767, `tests/integration/ticker-mining-settle.test.js` flaky under the full
  `npm test` run (unrelated to this story — no mining or ticker code touched). Passed in two isolated reruns
  and a second full-suite run; root cause not pinned down (unlike AB#1744's clear `setTimeout(50)` cause), and
  the bug notes the two may share a systemic cause (both flake only under full-suite load, pass alone) without
  confirming it.
- Checks: `npm run check` clean; `npm test` — **150 files, 1502 tests, all passed** on the clean rerun (1500
  baseline + 2 new).

## What's now true (ISP-48, AB#734 — prior session, still accurate)

- **ISP-48 is done: `SECURITY.md` exists**, answering DOCTRINE's four questions (what data, who can reach it,
  blast radius, fail closed) for auth, persistence, the market and sockets, every answer citing file and line.
  Its dependencies (#731, #732, #752, #756) were all Resolved before this was claimed.
- **New: `accountActionLimiter`** (`server/rateLimiters.js`) — 120 requests/minute shared across every
  state-changing route under `/api/accounts/:accountId` and `/api/market`, keyed on the verified account id
  (falls back to address if unauthenticated, same shape as `loginAccountLimiter`'s AB#1747 fallback). One
  limiter instance mounted at both route families so an account can't dodge the count by splitting a burst
  across them. `tests/integration/rate-limit-account-action.test.js` proves the shared bucket, the 429, that
  `GET` is excluded, and that a different account's budget is untouched.
- **Secret audit**: `git grep` for JWT_SECRET literals, JWT-shaped tokens and password literals over the
  tracked tree found only two clearly-labeled throwaway values in `scripts/bench-*.mjs`. Server logs checked:
  nothing logs an email, password or token (every `console.*` call in `server/` either logs a JS `Error`
  object, a count, or neither).
  - **Middleware registration order matters for what a keyGenerator can see, and it is not what the route's own
    argument list suggests.** `/api/accounts/:accountId` has one `app.use(requireAuth, requireAccountAccess,
    accountActionLimiter)` mount, so the limiter always sees `req.auth`. `/api/market` has no such blanket
    mount — each route lists `requireAuth` itself — but a *separate*, earlier-registered
    `app.use("/api/market", gameplayInputMiddleware(...))` (input validation) runs before any individual
    route's own middleware chain, Express matching `app.use` in *registration order* across the whole app, not
    per-route. A test that posts an out-of-catalog item name to prove the limiter counts it will instead get
    400 from input validation before ever reaching the limiter — not a bug, just a trap for whoever writes the
    next test here. Use a real catalog item name (`data/refinery-chains.json`'s `resourceCatalog`, exact case:
    `"Silicates"`, not `"silicates"`) so the request actually reaches the routes under test.
- **Two findings filed, not fixed (acceptance #5, out of this story's scope):**
  - **AB#1765**: refresh tokens are stored in plain text in `accounts-snapshot.json`
    (`server/game/store.js:560-570`, `storeRefreshToken`) — unlike passwords, which are bcrypt-hashed before
    they ever reach disk. A leak of that file (the same class AB#415 already caused once) hands out live
    30-day bearer tokens directly, no cracking required. Proposed fix in the bug: hash it the way `passwordHash`
    already is, compared for exact match rather than against a typed value.
  - **AB#1766**: `emitMarketUpdated`, `emitForumsUpdated` and the local-chat system lookup
    (`server/index.js:3358-3366`, `3430-3432`) read `peer.data.accountId` directly instead of through
    `checkSocketAuth` — the known boundary ISP-67's own handoff note (below) already described, now actually
    filed as a bug rather than just written down.
- Checks: `npm run check` clean; `npm test` — **149 files, 1500 tests, all passed** (1496 baseline + 4 new).

## What's now true (ISP-67, AB#756 — prior session, still accurate)

- **ISP-67 (AB#756) is done.** The PM re-scoped it on 2026-09-23 after Bug #710/#1021 shipped most of it; what
  was left was the anonymous and expired-token edges, and they're now proven rather than assumed:
  - `io.use` keeps the raw token on `socket.data.token`, not just its verdict, so it can be re-verified later
    against the clock it is checked at.
  - A new `checkSocketAuth(socket)` re-verifies that token on demand. If it has expired since the handshake, the
    socket leaves its account room, loses `socket.data.accountId`, and is sent `auth:expired` — dropped back to
    anonymous, not disconnected.
  - `emitToAccount` calls it for every socket in the room before delivering, so an expired member is evicted and
    skipped in the same pass that would have sent it the event — "the first event after expiry" from the
    acceptance line is literally the next per-account emit attempt.
  - `chat:send` calls it too, so a write from a socket whose token has since expired fails closed instead of
    trusting the account id cached at connect time.
  - Client: `app.js` listens for `auth:expired` and calls the existing `refreshSessionToken()`, which already
    reconnects the socket with a fresh token (Bug #710's `reauthenticateSocket()`) — so a live tab recovers
    without a reload, the acceptance line's "reconnecting with a fresh token restores them."
  - New tests in `tests/integration/socket-rooms.test.js`: an anonymous socket gets the public events and none
    of `finance:updated`/`mining:updated`/`notifications:new` in the same run that produces all four; a token
    that expires mid-connection stops per-account delivery, fires `auth:expired`, and a fresh connection is
    unaffected; an expired-token socket's `chat:send` is dropped rather than sent as the account. All three
    fail against the pre-fix code (checked by reverting the fix and re-running).
  - **Known boundary, not closed by this story:** `emitMarketUpdated`/`emitForumsUpdated` and the local chat
    room-by-system lookup still read `peer.data.accountId` directly rather than through `checkSocketAuth`, so a
    socket whose token has expired but is still connected keeps seeing "this is your own listing" highlighting
    and local chat for its last-known system until it does something that calls `checkSocketAuth` (a per-account
    emit, or `chat:send`). Nothing per-account or financial leaks through this path — market/forum views are
    public data with viewer-relative highlighting, not private state — but it's a real gap between "anonymous"
    and "actually anonymous" worth a follow-up if the Board wants it airtight.
  - Security answer (acceptance #6): an anonymous or expired-token socket sees exactly the signed-out view —
    `state:init`'s shared state with no viewer, and the four global events — and nothing derived from an
    account; a forged `accountId` in a payload is never read (the server always uses `socket.data.accountId`,
    set only from a verified token), and `chat:send`'s existing content/length/channel checks are untouched.
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

No Chrome extension connected this session (Builder panes don't get one by design). ISP-89 has no screen of
its own — a source-scanning Vitest test — and was verified directly: run against a temporary, uncommitted
seeded violation (caught it), then against `origin/main` clean (passed), never trusted from reading the code
alone. `npm test`: **150 files, 1502 tests, all green** on the clean rerun. `npm run check` clean.

**Update, no longer true as stated: AB#747 (ISP-61) shipped `e2e/first-hour.spec.js`, a real Playwright
playtest that saves screenshots without the Chrome extension (reported by a peer Builder mid-session,
2026-09-25, not yet independently confirmed by reading the file).** ISP-48's and ISP-67's blind-spot notes
below, and the "screenshot-gated, unclaimed" framing on AB#753/755/757/781/987/989, predate this and should be
re-checked before being repeated again: read `e2e/first-hour.spec.js` (or a `scripts/look-*.mjs` in its
pattern, if one now exists) before claiming one of those six, to confirm it actually produces a real screenshot
this session can look at.

ISP-48's and ISP-67's own blind-spot notes (prior sessions) are otherwise unchanged: no Chrome extension either
time; `SECURITY.md`'s citations read back against the file, and `socket.io-client` against a real server, were
each session's own equivalent of "looked at it."

## What's next

- **Confirm AB#747's screenshot capability first** (see "Blind spot" above), then claim one of
  AB#753/755/757/781/987/989 if it holds up — they were the largest block of stuck v0.5 work across two prior
  sessions.
- **AB#1765** (refresh tokens in plain text at rest), **AB#1766** (the market/forum socket boundary) and
  **AB#1767** (a second flaky test, possibly related to AB#1744) are filed, Proposed, unclaimed — all
  non-visual fallbacks if the screenshot capability doesn't pan out.
- Check ADO for what a concurrent Builder pane (if any) has Active before claiming, per the Board's "Builder #2
  on ISP" framing this session started under.

## In flight / blocked

Nothing blocked, nothing left uncommitted. This session's branch is `agent/779-no-payments-test`, PR to be
opened next and set to auto-complete. ISP-48's branch (`agent/734-security`, PR !402) merged before this
worktree was created.
