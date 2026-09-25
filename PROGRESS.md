# ISP — handoff

**2026-09-25, Builder (Sonnet 5), non-visual session (no CONTROL_URL, no Chrome extension attached — see
"Blind spot" below).**

## What's now true

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

## Blind spot

No Chrome extension connected this session (Builder panes don't get one by design), so nothing visual was
looked at. This story has no screen of its own — it's socket handshake and room membership — and was verified
with real `socket.io-client` connections against a real running server (`npm test`, not a mock), which is the
actual mechanism the acceptance criteria describe, not a DOM/pixel proxy for it. `npm test`: **147 files, 1495
tests, all green** (1492 baseline + 3 new). `npm run check` (`node --check server/index.js`) and
`node --check public/scripts/app.js` both clean.

The previous handoff (2026-09-23) listed several other v0.5 items with a screenshot in their acceptance
criteria (AB#753/755/757/781/987/989) as skipped for the same reason. Still true this session — not picked up.

## What's next

- The market/forum "still-authenticated-looking" boundary noted above, if the Board wants it closed.
- **AB#752's rate limiter** (`server/rateLimiters.js:86`) logged `ERR_ERL_KEY_GEN_IPV6` on every server start as
  of 2026-09-23 — not re-checked this session; confirm it's still there before re-filing.
- AB#734 (ISP-48, security answers + audit) was blocked on AB#731/#732/#756 as of 2026-09-23. AB#756 is now
  done; check whether #731/#732 have landed before picking #734 up.
- The screenshot-gated v0.5 items (AB#753/755/757/781/987/989) are ready once a browser session is available.

## In flight / blocked

Nothing blocked, nothing left uncommitted. This session's branch is `agent/756-socket-boundary`, PR opening
now. Worktree removed once the PR is open (P-STRANDED).
