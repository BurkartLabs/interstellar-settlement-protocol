# ISP — handoff

**2026-09-25. Merged from several concurrent Builder panes: #1 did AB#1758 (orchestrata, scope override) then
AB#1052 — a player-triggered stop on a running mining cycle; #2 did ISP-67 (AB#756), then ISP-48 (AB#734), then
ISP-89 (AB#779); #3 did ISP-61 (AB#747) — a scripted Playwright playtest, so ISP is no longer blind, only
extension-less — then ISP-66 (AB#755), below; #4 (this pane) did ISP-278 (AB#985), ISP-279 (AB#986), AB#1765
(refresh tokens hashed at rest), then AB#1766 (socket auth boundary) — the last two per a Director-relayed
priority order. AB#1052 and ISP-279 both used ISP-61's own Playwright pattern rather than the Chrome extension
for their screens. No CONTROL_URL / Chrome extension on any of these panes (Builder panes don't get one by
design). See "Blind spot" below.**

## What's now true (this session: AB#1766)

- **AB#1766 is fixed: market, forums and local chat stop personalizing for an expired-token socket.**
  `emitMarketUpdated`, `emitForumsUpdated` and the local-chat system lookup (`server/index.js`) read
  `peer.data.accountId` directly instead of calling `checkSocketAuth(peer)`, the function ISP-67 (AB#756) added
  to re-verify a socket's token against the clock it is checked at rather than trusting the value cached at
  connect time. A socket whose token expired mid-connection kept seeing "this is your own listing"/"liked by
  me" highlighting for its last-known account, and kept receiving its last-known system's local chat, until
  some other per-account event (an emit through `emitToAccount`, or a `chat:send` attempt) forced a re-check.
  No private or financial data leaked through this path — market/forums are public data with viewer-relative
  highlighting, local chat is public to the system — but "signed out" was not actually signed out for it.
  - All three call sites now route through `checkSocketAuth(peer)`, the same function `emitToAccount` already
    uses, at the small extra cost of re-verifying a token on every market/forum broadcast to every connected
    socket (the proposed fix's own tradeoff, accepted).
  - New `tests/integration/socket-market-forums-auth.test.js` (real `socket.io-client` connections, a token
    given a real 1-second expiry and actually let it lapse — ISP-67's own idiom, not a forged already-expired
    token): confirms an expired socket's own market listing shows `mine: false`, its own forum like shows
    `likedByMe: false`, and it receives nothing at all on `chat:send` to its last-known system's local channel,
    once the token has actually expired. All three fail against the pre-fix code (checked by reverting the fix
    and re-running — T-047).
  - Checks: `npm run check` clean; `npm test` — **154 files, 1556 tests, all passed** (1553 baseline on
    `origin/main` after AB#1765 merged + 3 new).

## What's now true (AB#1765 — prior session, still accurate)

- **AB#1765 is fixed: refresh tokens are hashed before they touch disk.** `storeRefreshToken` used to push the
  client's raw signed JWT into `account.refreshTokens`, persisted verbatim to `accounts-snapshot.json` —
  unlike `passwordHash`, bcrypt-hashed before it ever reaches disk, a leaked snapshot handed out live, 30-day
  bearer tokens with no cracking required.
  - `server/game/store.js`'s new `hashRefreshToken()` (SHA-256; the comparison is always exact-match against a
    machine-generated token, never a user-typed value the way a password's would be, so no salt is needed the
    bcrypt way) runs inside `storeRefreshToken`/`revokeRefreshToken`/`hasRefreshToken`. `server/index.js`'s
    three call sites are unchanged — they pass the raw client-presented token in, same as before; the hashing
    is internal to the store.
  - **Confirmed nothing else reads the raw value**: grepped every reference to `refreshTokens` in `server/`,
    `public/` and `tests/`; the three functions above are the only readers/writers.
  - New tests in `tests/integration/auth.test.js`: the stored value is a SHA-256 digest of the issued token, not
    the token itself (fails against the pre-fix code, checked by reverting the fix and re-running — T-047); a
    full register → refresh → logout → reuse-rejected cycle still passes with the digest in place, so the fix
    is transparent to every existing caller.
  - **Not migrated, and not worth migrating**: any refresh token issued before this fix is stored raw in an
    existing `accounts-snapshot.json` and will fail `hasRefreshToken`'s digest comparison the first time it's
    presented after this deploys — an already-logged-in session's silent refresh fails and the client re-logs
    in. Pre-beta, no real users, the same one-time cost as any password-hash-scheme change; not worth a
    migration path for it.
  - Checks: `npm run check` clean; `npm test` — **153 files, 1553 tests, all passed** (1551 baseline on
    `origin/main` after ISP-279 merged + 2 new).

## What's now true (this session: AB#1052)

- **AB#1052 is done: a player can stop a running mining cycle early.** `POST
  .../gameplay/lease/:leaseId/stop-mining` ends the cycle now, keeps what has been mined, and settles the cost
  for the time actually used.
  - **No new settlement math was needed.** `mutateAccountState` already runs `applyMiningOperations` on every
    extractor before its mutator executes (AB#1448), so by the time this route's mutator runs, the target
    extractor's `minedThisCycle`/`totalSpent`/`lastTickAt` already reflect the real elapsed time; the route
    only calls the existing `stopExtractorCycle` (`server/game/mining.js`, previously unused outside that file,
    now re-exported from `gameState.js`). The mined amount and the charge can't disagree with what a normal
    tick would have produced, by construction — the acceptance line's own bar.
  - **No office check**, unlike start-mining: an expired or wrong-station office lease should not trap a player
    into a cycle they cannot end.
  - Registered in `server/gameplayInput.js` and `gameplay-input.test.js`'s baseline (AB#731's requirement), so
    the hostile-input fuzz suite covers it like every other gameplay route.
  - **Client**: a Stop Cycle button on a running extractor's panel (shown during downtime too — the extractor
    is still `active` then, per the data model), behind the existing trade-confirmation modal. Demo-account
    fallback mirrors the server's settlement math for players with no account.
  - Six new tests (`tests/integration/mining-cycle-stop.test.js`): mined/charged match a partial elapsed time,
    not the full cycle; `totalMined` survives across a stop; refuses a cycle that isn't running; refuses a
    second stop (idempotent, no double-charge); a cycle that already finished naturally before the stop request
    settles the whole cycle and no more; 404 for a nonexistent account. All six confirmed to fail with the
    route removed (T-047).
  - **One test-authoring bug found and fixed along the way, not a route bug**: the first draft's credits
    baseline was read through `getAccountById`, which itself settles mining as a side effect (Bug #1260) —
    reading it *after* advancing the fake clock silently absorbed the charge into the baseline, and the test
    failed for a reason that had nothing to do with the route. Fixed by reading the known starting balance
    instead of re-reading through a settling call.
  - **Looked at it, with ISP-61's own pattern**: `e2e/stop-mining.spec.js` (Playwright, not the Chrome
    extension) registers a fresh account, rents an office, hires, files the Earth claim, builds a yard, starts
    a cycle at 250 t/h, waits for real accrual the way ISP-61's script does, clicks Stop Cycle, confirms, and
    asserts the row reads Idle with the Start-Cycle form back — at 1280×800 and 375×812. Both pass; all 6
    screenshots looked at directly, phone width has no horizontal scroll.
  - Checks: `npm test` — **151 files, 1541 tests, all green** (1500 baseline after merging ISP-48/61/89/278 +
    41 more from this session's merge of ISP-278's sibling work + 6 new here). `npx playwright test
    e2e/stop-mining.spec.js` — 2 passed.

## What's now true (this session: ISP-66, AB#755)

- **ISP-66 is done: registration fields are validated server-side, with the rejection shown beside the field.**
  `createAccount` (`server/game/store.js`) now checks email shape and a 254-char limit, password 10–128
  characters (was "at least 8"), and a CEO name (2–40 characters, the same `NAME_CHARS` set a corporation name
  already uses — now exported from `server/corporationName.js` instead of a second regex). Every rejection
  carries `field` in the JSON body (`POST /api/auth/register`, `server/index.js`); `register-page.js` reads it
  and shows the message in a `<p class="field-error">` beside that input, clearing it on the next submit, not
  the shared status line — the two never say the same thing twice.
  - **The client pre-check (`registerFormProblem`) had to become field-aware too.** It used to just short-circuit
    with a generic message in the status line before ever reaching the server, which meant an empty field never
    exercised the new beside-the-field display at all through the real UI — found by looking at the first
    screenshot, not by the unit tests (they only checked the string, not where it landed). It now returns
    `{ field, text }`, the same shape the server's refusal takes, so both paths render identically.
  - **`ceoName` is now required, with no silent stand-in.** It used to default to `"New CEO"` both server-side
    and in `register-page.js` — Bug #1187 had already fixed this for `corpName` but left `ceoName`'s own copy
    of the same bug in place. Checked every caller of `createAccount`/`POST /api/auth/register` first (57 test
    files via `tests/helpers/api.js`, which already sends a real `ceoName`; every direct call in the suite does
    too) — nothing relied on the default.
  - `EMAIL_MAX_LENGTH`, `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH`, `CEO_NAME_MIN_LENGTH/MAX_LENGTH` are
    exported from `server/game/store.js` so the new tests assert against the same numbers the code enforces,
    not a copy of them.
  - New tests: `tests/integration/register-validation.test.js` (each rejection, both accepted boundaries, no
    password echoed, a hostile extra body field changes nothing), `auth-errors.test.js` and
    `authMessages.test.js` updated for the new response/return shapes.
  - **Looked at**: two throwaway Playwright scripts (not committed — `e2e/first-hour.spec.js` is the permanent
    suite, this was just the evidence), one per path — the client pre-check (blank CEO name) and a real server
    round trip (`Alex_Rivera`, an underscore, passes the client's "is it empty" check but not the server's
    character rule) — both screenshotted at 375x812 showing the message beside the CEO Name field, not just
    asserted. Fixed the pre-check display gap this looking found (above) before calling it done.
  - Checks: `npm test` — **150 files, 1508 tests, all green** (1500 baseline + 8 new). `npm run check` and
    `node --check` on both changed client scripts clean.
  - One more `tests/integration/ticker-mining-settle.test.js` flake seen (failed once under the full suite's
    load, passed alone and on two full reruns) — already filed as **AB#1767** by a concurrent Builder pane, see
    below; not filed again.

## What's now true (ISP-89, AB#779 — earlier session, still accurate)

- **ISP-89 is done: `tests/unit/no-payments.test.js` exists**, scanning every `.js`/`.html`/`.css` file under
  `server/` and `public/` for payment and pricing vocabulary, with a three-entry allowlist (two benign
  "premium" matches, and the one sanctioned credits formatter, `toCurrency` at `public/scripts/app.js:478`).
  Verified per its own acceptance line with a temporary, uncommitted `import Stripe from "stripe"` — caught it,
  then reverted before committing.
- **Confirmed while merging this handoff with a concurrent peer Builder's own: AB#747 (ISP-61) landed on
  `origin/main` mid-session, shipping `e2e/first-hour.spec.js`, a real Playwright playtest that saves
  screenshots without the Chrome extension.** See its own section below for what it actually does. This
  unblocks AB#753/755/757/781/987/989 — the screenshot-gated v0.5 items ISP-67's and ISP-48's own handoffs
  both listed as unclaimable for lack of a browser session.
- **New bug, filed not fixed:** AB#1767, `tests/integration/ticker-mining-settle.test.js` flaky under the full
  `npm test` run (unrelated to this story — no mining or ticker code touched). Passed in two isolated reruns
  and a second full-suite run; root cause not pinned down (unlike AB#1744's clear `setTimeout(50)` cause), and
  the bug notes the two may share a systemic cause (both flake only under full-suite load, pass alone) without
  confirming it.
- Checks: `npm run check` clean; `npm test` — **150 files, 1502 tests, all passed** on the clean rerun (1500
  baseline + 2 new).

## What's now true (this session: ISP-279, AB#986)

- **ISP-279 is done: the Logistics tab quotes the arrival time next to the fee, and lists shipments in flight.**
  Builds on ISP-278/AB#985's `corp.shipments`, which existed server-side with nothing showing it yet.
  - The remote-station card's fee line now reads "Fee to X: $5 per unit, 2h 30m transit (1 jump)" —
    `transitMinutes` (`public/scripts/logistics.js`, already shared with the server) formatted through the
    existing `formatDuration()` helper, not a new one.
  - A new "Shipments In Transit" section (above Transfer History) lists `corp.shipments`: route, contents, fee,
    and a countdown to `arrivesAt`; a held shipment (AB#985's decommissioned-station case) shows "Held —
    destination unreachable" instead. Empty state names what to do next, per the acceptance line. The countdown
    ticks live off the existing 1s `miningUiTicker` (client-side elapsed time against the known timestamp, no
    extra polling).
  - **New:** `shipmentTick` (server) now also emits `logistics:arrived` per account (mirrors `travel:arrived`),
    with `{accountId, shipmentId, delivered}`; the client's handler calls the existing `refreshFromServer()`,
    which re-renders the Logistics tab with no reload the same way travel/market/R&D updates already do.
  - Tests: `tests/integration/transfer-distance.test.js` gained an arrival-time equivalence check (the quote's
    `transitMinutes` equals the dispatched shipment's `arrivesAt - dispatchedAt`, acceptance #1) alongside the
    existing fee-equivalence one. New `tests/integration/logistics-arrived-socket.test.js`: the event fires only
    for the shipment's own account, with `delivered: true` on arrival and `delivered: false` when held (real
    `socket.io-client` connections against the real server, injected time, same pattern ISP-67's
    `socket-rooms.test.js` established).
  - **Screenshots (acceptance #3), looked at, not just taken:** `e2e/logistics-shipments.spec.js`, at 1280x800
    and 375x812 — `01-quote-cross-system-*.png` (the fee+transit-time quote for Centauri Prime Station, 1 jump)
    and `02-in-flight-*.png` (the in-flight list after a real dispatch click, showing route, contents, fee and
    a 2h 30m countdown). Both viewports read correctly: no overlap, no truncation, no sideways scroll on the
    phone width (checked the same way ISP-61 does). Reaching a station outside Sol legitimately needs
    Corporate R&D research that needs corporation level 5 (data/research.json), a real grind even with dev
    mode's zeroed R&D timers, because mining itself is not accelerated (ISP-61's own finding) — scripting that
    climb to take two screenshots of a display panel would be wildly disproportionate, so the spec seeds a
    corporation that already holds stock at that station via `mutateAccountState` (the same mechanism every
    integration test already uses), in a companion script run as its own process
    (`e2e/seed-logistics-account.mjs` — server/gameState.js's `dataDir` is computed once at first import and
    does not follow a later `ISP_DATA_DIR` change within one process, so the seeding could not be inlined via a
    second in-process import without silently writing into the first viewport's already-deleted directory,
    which is what the first version of this spec did). Everything past that point is real: login over real
    HTTP, the quote read off the live page, the dispatch a real click against the real route, delivered by a
    real, separately-spawned `node server/index.js` reading that fixture from disk at boot — the same as an
    actual restart.
  - Checks: `npm run check` clean; `npm test` — **150 files, 1515 tests, all passed** (1513 baseline on
    `origin/main` after AB#985 merged + 2 new); `npx playwright test e2e/logistics-shipments.spec.js` — 2
    passed; `npx playwright test e2e/first-hour.spec.js` re-run against the modified server as a regression
    check — still 2 passed, unaffected.

## What's now true (ISP-278, AB#985 — prior session, still accurate)

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

## What's now true (this session: ISP-61, AB#747)

- **ISP-61 (AB#747) is done: a scripted first-hour playtest, in Playwright.** `e2e/first-hour.spec.js` registers
  a fresh account against `BASE_URL` and plays it the way a new CEO does — office, hire five, file the Earth
  claim, commission a yard, start a cycle at the top rate, sell into a standing buy order once enough has
  accrued, queue Basic Extraction Analytics, accept a contract — at 1280x800 and 375x812, one screenshot per
  step per viewport to `e2e/screenshots/` (gitignored; regenerated per run). Every assertion reads the page (a
  badge, the feedback log, a row appearing), never account state read another way.
  - **Selectors come from `public/scripts/walkthrough.js`**, not guessed: it already names the exact control for
    each of these steps, and `tests/unit/walkthrough.test.js` already fails if one drifts. This script is that
    same sequence played through a real browser.
  - Two real UI behaviors the story had to discover, not assume: registering opens a one-time "Brief me / I'll
    find my own way" dialogue (`#dialogue-modal`) that blocks every click until dismissed; selling to a standing
    order opens a trade-confirmation modal (`#trade-confirm-ok`) before the sale posts. Neither is mentioned in
    `walkthrough.js` because the walkthrough's own predicate-watching skips past them.
  - **No time-acceleration flag was added.** `IS_DEV` already zeroes R&D/CEO Insight duration and shortens
    travel; mining has no such flag. At the form's max rate (250 t/h) the server's 5s ticker credits a whole
    ton within a few ticks (the remainder carries between ticks, so this is real accrual, not a race) — the
    script waits on the extractor row's own live "Mined this cycle" figure (`[data-live="mined"]`, pushed by
    the `mining:updated` socket event), which is what the player would watch, not a fixed sleep. In practice
    that's under 20 real seconds; adding a mining accelerator was judged not worth the risk to touch for this
    story.
  - **A real screenshot bug, found by looking, not by the assertions**: `page.screenshot({ fullPage: true })`
    scrolls and stitches a page taller than the viewport, and the sticky top bar — `position: sticky` — gets
    captured once per stitched segment, so it appeared to repeat down the image on every screen with enough
    content to scroll (P-TOOLS: a screenshot lies when the page is scrolled). Fixed by growing the viewport to
    the page's own `scrollHeight` before each capture (one shot, no stitching) and restoring it after — the
    real target width (1280 or 375) is never touched, only the height used for the capture.
  - `npx playwright test`: **2 passed** (one per viewport). Screenshots attached are the 22 in `e2e/screenshots/`
    from that run; the Board can see them at their generated paths, or from the PR's own run. What was looked
    at: every step's screenshot at both sizes, specifically checking for the header-repeat bug above (gone
    after the fix) and that each step's confirmation (lease badge, headcount, extractor row, sale in Trade
    History, contract in Assignments) is genuinely on screen, not just asserted.
  - `@playwright/test` is now a devDependency; the cached Chromium this machine already had for job-hunt
    (`ms-playwright/chromium-1243`) covers it — nothing had to be downloaded. **This means ISP has its own
    browser now, independent of the Chrome extension.** A future non-extension Builder session can run
    `e2e/first-hour.spec.js` (or a new spec built the same way) to actually look at ISP, the way job-hunt's
    `scripts/look-*.mjs` already let that product's Builders look without the extension.

## What's now true (ISP-67, AB#756 — earlier session, still accurate)

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

## Filed, not fixed (out of scope for the sessions that found them)

- **AB#1744**: `tests/integration/construct-assembly.test.js` is flaky under load (~1 run in 3) — a fixed 50ms
  `setTimeout` used as a sync primitive for an async POST, not tied to the request completing.
- **AB#1767**: `tests/integration/ticker-mining-settle.test.js` flaky under a full `npm test` run — same
  higher-level symptom as AB#1744 (passes alone, flakes under full-suite load) but a different mechanism (no
  `setTimeout`; uses `vi.useFakeTimers()`); root cause not pinned down, confidence low. The two may share a
  systemic cause; unconfirmed.
- **AB#1765**: refresh tokens stored in plain text in `accounts-snapshot.json`, unlike bcrypt-hashed passwords.
- **AB#1766**: `emitMarketUpdated`/`emitForumsUpdated`/local chat read `peer.data.accountId` directly instead
  of through `checkSocketAuth` (ISP-67's own known-boundary note above, now filed).

No Chrome extension on any of these panes (Builder panes don't get one by design), but ISP-61 changed what that
means for ISP. ISP-61 is entirely about screens and was looked at for real: Playwright, not the extension,
drove a real Chromium against a real running server, and the 22 resulting screenshots were read back and
checked, including catching and fixing a header-repeat capture bug (`fullPage: true` stitching a `position:
sticky` header into the image twice). ISP-48 and ISP-89 have no screen of their own — a markdown file and a
server-side throttle, a source-scanning Vitest test — and were each verified directly instead: `SECURITY.md`'s
every code claim read back against the actual file and line; the rate limiter proven with real HTTP requests
through `supertest`; the payments scan run against a temporary, uncommitted seeded violation (caught it) and
against a clean checkout (passed) — each the actual mechanism its own acceptance criteria describe, not a
proxy for it. ISP-278 has no screen of its own either — a dispatch/delivery split in server state, proven with
real HTTP requests and a real `shipmentTick()` call through `supertest`/`getApp()` (not a mock). One thing that
session did **not** look at: the client's post-dispatch toast wording, reasoned through and `node --check`ed
but never rendered — that gap is closed now: **ISP-279 (this session) used ISP-61's Playwright pattern for
real**, `e2e/logistics-shipments.spec.js`, and the four resulting screenshots were read back and checked (see
above) — the quote line, the toast, and the in-flight list all render correctly, at both widths, with no
overflow. AB#1052 (a concurrent pane) also used this pattern for its own screen, `e2e/stop-mining.spec.js`.
ISP-67's own blind-spot note (an earlier session) stands unchanged: `socket.io-client` against a real server
was that session's equivalent of "looked at it."

`npm test` after merging AB#1052 and ISP-89 into this branch: **152 files, 1543 tests, all green**. `npm run
check` clean. `npx playwright test`: `first-hour.spec.js` 2 passed (re-run as a regression check against the
modified server), `logistics-shipments.spec.js` 2 passed (this session's new spec). One, unrelated
`ticker-mining-settle.test.js` flake seen once under full-suite load during the ISP-89 session, filed as
AB#1767, not reproduced again. **One line-number fix on merge**: ISP-89's `no-payments.test.js` allowlists
`public/styles.css` by line number; this session's CSS insertion pushed the one existing allowlisted match (a
"Premium Thread Detail View" section comment) from line 4151 to 4195, and the test's own message ("the code
moved; update or remove the entry") says exactly what to do — updated, not a new finding.

**AB#753/755/757/781/987/989 (the remaining screenshot-gated v0.5 items) are no longer blocked on "no
browser."** Playwright is the way to do it for ISP now — see ISP-61's pattern (`e2e/first-hour.spec.js`) or
this session's (`e2e/logistics-shipments.spec.js`, for a story that needs a seeded fixture rather than fresh
play) — but nobody has yet written the scripts for CSP-console-checking, the register page, or the
verification-email flow. That's real work still to do, not a blind spot anymore, and the natural next pick for
a Builder pane without the Chrome extension.

## What's next

- **Director-relayed priority order for this pane (2026-09-25), after AB#1765/#1766 (both now done)**:
  **AB#1753** next (the Level-2 gate — must be clearable before any v0.6+ work), then **AB#758** (one Station
  mockup — the Board is waiting on this one specifically). **AB#1740 was picked up and merged by a concurrent
  pane while this session worked AB#1765/#1766** — no longer available to take. If this pane frees up before
  AB#1753/#758 and **ENG-9 (AB#669)** is still unclaimed, take that instead — platform-first priority per
  PM/Director.
- **ISP-279** and **ISP-66 (AB#755)** are both done (concurrent panes) — see above.
- **AB#753 (ISP-65, CSP/security headers)** has an unmet predecessor, AB#739 (splitting `app.js`), still
  Proposed as of 2026-09-25 — check its state before claiming; it may be worth doing anyway now that the actual
  risk that predecessor was hedging against (many inline event handlers to convert) turned out not to exist —
  `grep -c 'onclick='` across `public/` returns 0, the client already uses `addEventListener` exclusively.
- **AB#757/987/989** (the rest of the screenshot-gated v0.5 items) can now be built and looked at with
  Playwright too — see ISP-61 (`e2e/first-hour.spec.js`, fresh play), AB#1052 (`e2e/stop-mining.spec.js`, fresh
  play) or ISP-279 (`e2e/logistics-shipments.spec.js`, a seeded fixture — the pattern to reach for when the
  state under test would need disproportionate grinding to reach by fresh play) for the established shapes.
  Each has its own unmet predecessor as of 2026-09-25 (AB#757 wants the CSP story above; AB#987/989 want AB#757
  and AB#781 respectively) — check state before claiming.
- **AB#1767** (a flaky test, possibly related to AB#1744) is filed, Proposed, unclaimed — non-visual fallback.
- Multiple Builder panes are working ISP at once — check ADO for what's Active before claiming.

## In flight / blocked

Nothing blocked, nothing left uncommitted. ISP-67's branch (`agent/756-socket-boundary`, PR !392), ISP-48's
(`agent/734-security`, PR !402), ISP-89's (`agent/779-no-payments-test`, PR !409), ISP-61's
(`agent/747-first-hour-playtest`, PR !406), ISP-278's (`agent/985-timed-transit`, PR !408), AB#1052's
(`agent/1052-stop-mining`, PR !417), ISP-66's (`agent/755-registration-validation`), ISP-279's
(`agent/986-shipments-ui`, PR !432) and AB#1765's (`fix/1765-hash-refresh-token`, PR !439) are all merged. This
session's (AB#1766) branch is `fix/1766-socket-auth-check`, PR to be opened next and set to auto-complete.
Multiple Builder panes are active on ISP at once — check ADO state before claiming the next item.
