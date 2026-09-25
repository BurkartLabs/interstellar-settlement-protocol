# ISP — handoff

**2026-09-25, Builder #4 (Sonnet 5), non-visual session (no CONTROL_URL, no Chrome extension attached — see
"Blind spot" below). Rewritten after ISP-278 (AB#985), on top of the ISP-48/ISP-67 handoffs below (still
accurate; not this session's own work).**

## What's now true (this session: ISP-278, AB#985)

- **ISP-278 is done: shipments arrive on a later tick, not on dispatch.** `POST .../gameplay/transfer-resources`
  debits the origin inventory and the fee once, same as before, but now creates a shipment (`corp.shipments`)
  with an arrival time from `transitTime` (`server/transfers.js`, dead code since AB#718, now wired in) instead
  of crediting the destination on the spot. The goods are in neither inventory while in flight — the bug-#692
  lesson applies here too: the destination station is pinned at dispatch (`corp.currentStationId` read once,
  when the shipment is created), never re-read at delivery time.
  - **`shipmentTick`** (mirrors `travelTick`, same 5s interval) delivers each shipment on the first tick at or
    after `arrivesAt`: credits the destination, records it in `corp.logisticsHistory` (same shape as before, so
    the existing Transfer History list needs no change), fires a notification, and drops the shipment from
    `corp.shipments` in the same pass — delivery is idempotent by construction, no separate guard needed.
  - **Held, not lost:** if the destination station id isn't in the catalog at arrival (a decommissioned
    station), the shipment's marked `status: "held"` and stays in `corp.shipments` rather than crediting nothing
    or vanishing; the player is notified. Nothing today resolves a held shipment — a reasonable follow-up if the
    Board ever retires a station.
  - **New, owner-scoped:** `GET .../gameplay/shipments` (list) and `.../shipments/:shipmentId` (one, 404 if it
    isn't yours — same shape as the existing message/notification-by-id routes).
  - **Client:** `app.js`'s post-transfer toast now reads the dispatch response's ETA rather than
    `logisticsHistory[0]` (which no longer has an entry at dispatch time) — "Dispatched … arriving in N min"
    instead of a false "Moved …". This is a plain-text change, not a layout one; see Blind spot.
  - Tests (`tests/integration/transfers.test.js`, `transfer-distance.test.js`): dispatch-vs-delivery separation,
    idempotent tick delivery with injected time, arrival notification, restart survival (write the live state to
    disk, reload it as a fresh process would, tick from the reloaded copy alone), the held-station case, a
    client-supplied arrival time being ignored, and cross-account 404 scoping. All fail against the pre-fix
    code where meaningful (dispatch-vs-delivery, idempotence) — checked by reverting the diff and re-running.
  - `tests/unit/benchTicks.test.js` and `scripts/bench-ticks.mjs` gained `shipmentTick`; `server/gameplayInput.js`
    and both AB#731/#732 guard-test files gained the two new routes (the first `ref`-kind field in
    `GAMEPLAY_INPUT`, so `gameplay-input.test.js`'s hostile-input loop needed the same ref-kind carve-out
    `remaining-input.test.js` already had — a real gap in that test, not specific to this story, fixed here).
  - `ECONOMY.md` and `DESIGN_DOCUMENT.md`'s "transfers still arrive at once; transit time isn't used yet" notes
    are updated — that sentence is what this story replaces.
  - Checks: `npm run check` clean; `npm test` — **149 files, 1513 tests, all passed** (1500 baseline on
    `origin/main` after merge + 13 new).

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

No Chrome extension connected this session either (Builder panes don't get one by design). ISP-278 has no
screen of its own — a dispatch/delivery split in server state, proven with real HTTP requests and a real
`shipmentTick()` call through `supertest`/`getApp()` (not a mock), which is the mechanism the acceptance
criteria describe (dispatch, tick timing, restart, the held case, ownership). One thing this session did
**not** look at: the client's post-dispatch toast wording (`public/scripts/app.js`) was reasoned through and
`node --check`ed, but never seen rendered — a plain-text change (an ETA in a toast), not layout, so the risk is
narrow, but it is unverified and the reason it's called out rather than folded into "done."

ISP-48's and ISP-67's own blind-spot notes (previous sessions) are unchanged and still true: no Chrome
extension then either.

Screenshot-gated v0.5 items (AB#753/755/757/781/987/989) remain unclaimed for the same reason — no browser
session available this session either.

## What's next

- **AB#1765** (refresh tokens in plain text at rest) and **AB#1766** (the market/forum "still-authenticated-
  looking" socket boundary), both filed by the ISP-48 session, remain Proposed and unclaimed — non-visual, and
  ISP-279 (below) is not the only reasonable next pick.
- **ISP-279** ("Shipments in the Logistics tab: arrival time quoted before you move") is the natural next
  story: it has the `ui` tag this session avoided, and can now build on `corp.shipments` and the two new
  `GET .../gameplay/shipments(/:id)` routes instead of inventing the data model itself.
- The market/forum "still-authenticated-looking" boundary (ISP-67's note) and AB#734/AB#1765/AB#1766 are all
  still open, non-visual, and worth a look before the next screenshot-gated pick.
- The screenshot-gated v0.5 items are ready once a browser session is available.
- Check ADO for what a concurrent Builder pane has Active before claiming — three others were working ISP in
  parallel this session (AB#734 landed on main mid-session and was merged in cleanly; no conflicts).

## In flight / blocked

Nothing blocked, nothing left uncommitted. This session's branch is `agent/985-timed-transit`, PR to be opened
next and set to auto-complete. `agent/734-security` (ISP-48, AB#734) merged into main during this session and
is merged into this branch too, so the checks above are against the combined state.
