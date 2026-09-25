# SECURITY — interstellar-settlement-protocol

ISP-48 (AB#734), v0.5 Beta MVP, Release Engineering. Answers DOCTRINE's four questions — what data does this
touch and does it need to; who can reach it and what happens if they are hostile; what is the blast radius of a
leak; does it fail closed — for the four areas that carry risk: auth, persistence, the market and sockets. Every
answer cites the file and line it is true of, so it goes stale the moment the code moves and someone can tell.

This is a design document, not a pass before launch (DOCTRINE, "Security first, at design time"). It answers
what is built. It does not defer anything: gaps found while writing it are filed as bugs below, not fixed here.

## Auth

**What data does this touch, and does it need to?** An email, a bcrypt password hash (never the plain password
past the request that set it), and two signed JWTs (access, refresh) naming an account id and nothing else
(`server/index.js:282-289`, `signAccessToken`/`signRefreshToken`). No name, address or payment detail is
collected at any point — the game has none of those fields.

**Who can reach it, and what happens if they are hostile?** `POST /api/auth/register` and `/login` are public by
necessity; both are rate-limited (`server/rateLimiters.js:77-95`, ISP-64) and the login route answers "Invalid
account credentials" whether the email or the password was wrong (`server/index.js:899-901`), so a hostile
caller cannot use the response to enumerate registered emails. Every other route requires a verified bearer
token (`requireAuth`, `server/index.js:328-336`), and every `/api/accounts/:accountId/*` route additionally
requires the token's own account to match the `:accountId` in the URL (`requireAccountAccess`,
`server/index.js:338-350`) — a valid token for account A can never read or act on account B by editing the URL.

**What is the blast radius of a leak?** A leaked *access* token (7 days, `ACCESS_TOKEN_SECONDS`,
`server/index.js:262`) reaches one account for at most that long. A leaked *refresh* token (30 days,
`REFRESH_TOKEN_SECONDS`, `server/index.js:264`) reaches one account for up to 30 days but only that one — the
JWT secret is never embedded in a token, so no leak of any single token exposes another account or lets an
attacker forge one for someone else. `JWT_SECRET` itself is the one credential that would: it is required at
least 32 bytes and the server refuses to start without it outside the dev surface
(`server/jwtSecret.js:18-31`), so a leak there is total (every existing token could be forged) — the same reason
the file's own comment says rotating it is the correct response to a suspected leak (`server/jwtSecret.js:7-8`).
**AB#757 (D-0.5-2):** no token is written to browser storage. The refresh token is an `HttpOnly`, `SameSite=Strict`
cookie scoped to `/api/auth` (`server/auth.js`), and the access token lives only in the page's memory
(`public/scripts/apiClient.js`), so a script running on the page can still use it for as long as the page is open.
The content security policy (ISP-65, AB#753; "Headers and CORS" below) narrows that door: no inline or injected
script runs, and outside scripts load only from the one Chart.js file the page names.

**Fail closed.** `resolveJwtSecret` throws and the process never starts if `JWT_SECRET` is unset or short,
outside `ISP_DEV=1` (never true in production) — no silent fallback to a guessable string (`server/jwtSecret.js:
24-30`, the fix for Bug #589, which once shipped exactly that fallback). `verifyAccessToken` treats a missing,
malformed or expired token identically to a wrong one: `{ error }`, never a partial identity
(`server/index.js:317-326`). `requireAccountAccess` answers 403 before 404 — a token for the wrong account never
learns whether the account it named even exists (`server/index.js:338-350`).

## Persistence

**What data does this touch, and does it need to?** One JSON file per install: `data/accounts-snapshot.json`
(every account — email, password hash, refresh tokens, game state) and `data/state.json` (the shared
market/forums/NPC state), both under `ISP_DATA_DIR` (`server/game/catalog.js:14-17`). Every field on an account
record is read by the game itself; nothing is collected "for later." Daily financial statements live in their
own per-account files under `statementsDir` (`server/game/store.js:22`), kept out of the snapshot itself since
AB#1480 specifically because up to 90 days of them would otherwise ride on every save.

**Who can reach it, and what happens if they are hostile?** Only the server process, which runs on a private
volume — no route ever returns the raw account record. `sanitizeAccount` (`server/game/store.js:269-281`) is the
one function that turns a stored account into what a client is allowed to see, and it is the return value of
every account-reading function that can end up in a response (`getAccountById`, `authenticateAccount`,
`createAccount`, `server/game/store.js:350-361`, `364-391`, `453-458`): it strips `passwordHash` and
`refreshTokens` and keeps `id`, `email`, `createdAt`, `lastLoginAt`, `walkthroughCompleted` and `state`. A client
never receives another account's record at all, gated by `requireAccountAccess` above.

**What is the blast radius of a leak?** Passwords are `bcrypt`-hashed (`PASSWORD_SALT_ROUNDS = 10`,
`server/game/catalog.js:19`) before they ever reach disk — a leaked snapshot does not hand out working
passwords, only hashes that must still be cracked. **Refresh tokens are the exception: `storeRefreshToken`
(`server/game/store.js:560-570`) writes the signed JWT itself into the account record, in plain text, and it is
written to disk unhashed exactly as issued.** A leak of `accounts-snapshot.json` — the same class of leak
AB#415 already caused once, when a copy with 129 accounts' password hashes *and* refresh tokens sat in git
history — hands out live, unexpiring-for-up-to-30-days bearer tokens directly, no cracking required, for every
account whose token was live at snapshot time. Passwords get exactly this protection already; refresh tokens do
not. **Filed as AB#1765 below, not fixed here.** `data/accounts-snapshot.json` and `data/*accounts*.json` are
gitignored (`.gitignore:16-18`) with the AB#415 incident quoted in the comment, so the git-history route to this
leak is now closed; the filesystem/backup route is not narrowed by anything in this repo, since that is the
Board's own hosting choice (INFRA.md), outside this codebase's reach.

**Fail closed.** `safeWriteFile` (`server/game/catalog.js:38-60`) writes to a temp file and renames it into
place, so a process killed mid-write leaves the last good snapshot intact rather than a truncated one; only if
the atomic rename itself fails on every retry does it fall back to a direct overwrite, logged as such. A missing
or unreadable snapshot is treated as "no accounts yet," not a crash: the server starts from the seed and says so
(`server/game/store.js:81`, `"No accounts snapshot in the data directory; starting from the seed."`) rather than
silently fabricating or exposing partial state.

## The market

**What data does this touch, and does it need to?** Sell orders name an item, a quantity, a unit price, the
selling corporation's public name and the station the goods sit at — nothing that was not already public the
moment the order is listed; this is the corner of the game whose whole point is that other players see it. No
account id, email or internal id reaches an order's public shape (`marketView`, `server/marketView.js`).

**Who can reach it, and what happens if they are hostile?** Every state-changing market route requires a
verified token (`requireAuth`, listed on each of `server/index.js:2904`, `2986`, `3021`, `3181`) and every field
in the body is checked against `MARKET_INPUT` before any handler runs — a whole-number quantity and price, and
an item id that exists in the resource/refinery-chain catalog (`server/gameplayInput.js:123-140`, AB#732). A
hostile seller cannot list more than they hold: `available < normalizedQty` is checked against the seller's own
station inventory before any goods move (`server/index.js:2926-2930`), and a seller is capped at
`MAX_OPEN_LISTINGS = 50` open orders (`server/index.js:273`) checked before the order is created
(`server/index.js:2933-2936`, Bug #425) — the book itself is never trimmed, which used to mean an attacker (or
just an enthusiastic player) could grow it without bound and force older listings out from under their owners.

**What is the blast radius of a leak?** There is nothing to leak in the market's own data that is not already
shown to every player by design — the risk here is abuse (flooding the book, undercutting at machine speed), not
disclosure. **AB#734's own new limiter bounds exactly that**: every state-changing market route now shares one
per-account limit with the account routes below (`accountActionLimiter`, `server/rateLimiters.js`,
`server/index.js:2904`, `2986`, `3021`, `3181`) — 120 requests a minute by default, so a compromised or scripted
account cannot out-request a human at the exchange faster than the game's own numbers already assume.

**Fail closed.** A malformed or out-of-catalog field is refused (400) before `mutateAccountState` runs — no
partial order, no goods removed and no listing created on a rejected request (`server/gameplayInput.js`
header comment, AB#732: "a refusal never follows a partial write"). The order-book insert and the inventory
debit happen inside one `mutateAccountState` call (`server/index.js:2923-2952`), so a mid-write failure leaves
neither the goods gone nor a listing nobody paid for.

## Sockets

**What data does this touch, and does it need to?** `state:init` and the four per-account events
(`finance:updated`, `mining:updated`, `notifications:new`, and the per-account slice of `state:init` itself) are
the only channel a corporation's own numbers travel over besides the HTTP API. Global events (`market:updated`,
`forums:updated`, `chat:new`) carry the same publicly-visible shape the HTTP routes already return, viewer-
relativized only for which listing gets a "yours" highlight (`marketView`/`forumsView`, called with
`peer.data.accountId`, `server/index.js:3358-3366`).

**Who can reach it, and what happens if they are hostile?** Anyone may open a socket and receive the public
events — that is intended (Bug #710's comment, `server/index.js:3306-3307`). `io.use`
(`server/index.js:3374-3381`) verifies the handshake's token once at connect time and records the account id
*and* the raw token itself, not just the verdict, specifically so it can be re-checked later against the clock
it is checked at rather than the clock it connected at (ISP-67, AB#756). Only a socket whose token verifies is
joined to its account's room (`server/index.js:3400`) and only a verified socket may `chat:send`
(`checkSocketAuth`, re-checked per message rather than trusted from connect time, `server/index.js:3403-3407`).
A forged `accountId` in a payload is never read anywhere — every per-account action uses `socket.data.accountId`
or the freshly re-verified id, never a value taken from the client.

**What is the blast radius of a leak?** A socket's own per-account events reach only that socket's room
(`emitToAccount`, `server/index.js:3339-3347`) — the Bug #1021 fix this replaced used to `io.emit` every
account's finances, mining and notifications to every connected client, so this is the boundary that made the
blast radius of *any* one socket "its own account" instead of "every account playing right now." `emitToAccount`
re-verifies each room member's token immediately before sending (`checkSocketAuth(socket) === accountId`,
`server/index.js:3345`), so an expired-token socket that is still technically connected is evicted from the room
and skipped in the same pass that would have sent it the event — the first per-account event after expiry is the
one that catches it. **Known, not-yet-closed boundary (ISP-67's PROGRESS.md note, filed as AB#1766 below):**
`emitMarketUpdated`, `emitForumsUpdated` and the local-chat system lookup (`server/index.js:3358-3366`,
`3430-3432`) read `peer.data.accountId` directly rather than through `checkSocketAuth`, so an expired-but-still-
connected socket keeps its last-known account's "this is your own listing" highlighting and local chat delivery
until something else (a per-account emit, or a `chat:send` attempt) forces a re-check. Nothing per-account or
financial travels this path — market and forum views are public data with viewer-relative highlighting, not
private state — so this is a smaller gap than Bug #1021 was, not the same one reopened.

**Fail closed.** `chat:send` returns silently — no message stored, nothing broadcast — the instant any one of
five checks fails: no verified account, no corporation, no allowed channel, empty content, or content over
`CHAT_MAX_LENGTH` (300 characters, `server/index.js:276`, checked at `3406-3415`). The socket CORS origin list
is empty (and therefore `cors: { origin: false }`, refusing every cross-origin handshake) unless
`ISP_APP_ORIGIN` names one explicitly (`server/index.js:388-394`, the fix for Bug #710) — an unset environment
variable fails closed to "no other origin may connect," not open to "any origin may."

## Headers and CORS (ISP-65, AB#753)

**What it touches.** Nothing stored: response headers only, set by `server/securityHeaders.js` and mounted once in
`server/app.js` ahead of every route and the static files, so no route can be added without them. A path nothing
answers gets a 404 from `server/index.js`, not Express's default, which clears the headers already set.

**Who can reach it, and if they are hostile.** The content security policy (`CSP_DIRECTIVES`) lets no inline or
evaluated script run: script-src has neither `'unsafe-inline'` nor `'unsafe-eval'`, and `script-src-attr 'none'`
blocks an `on*` handler written into rendered HTML, the shape of Bug #691. The one outside script, Chart.js, is
allowed by its exact file path, not the CDN's origin, which serves every npm package. style-src keeps
`'unsafe-inline'` because the views still set `style=""` attributes (ISP-26 removes them). `frame-ancestors 'none'`
and `X-Frame-Options: DENY` stop the game being framed, `nosniff` stops a response being read as another type, and
the referrer policy is `same-origin`, so the page's URL (it carries `?account=`) never reaches the font or script CDN.
A request whose Origin is another site is refused with 403 before any route runs, and gets no CORS headers, so the
browser refuses it too (`corsPolicy`). Same origin is judged by host, against Host or the ingress's
X-Forwarded-Host, so the proxy's http-to-https hop does not make the game a stranger to itself.

**Fail closed.** `ISP_APP_ORIGIN`, the list the sockets read, is the only way to allow another origin; unset, none is.
Tested in `tests/integration/security-headers.test.js`.

**Not verified here:** the production ingress's Host and X-Forwarded-Host. If it rewrites both to an internal name,
every same-origin POST in production would be refused. The first deploy should be checked by logging in.

## Rate limits (ISP-64 + AB#734)

| Route(s) | Window | Default limit | Keyed on |
|---|---|---|---|
| `POST /api/auth/login` | 1 minute | 10 / address | caller's IP |
| `POST /api/auth/login` (failed only) | 15 minutes | 5 / account | normalized email, falling back to IP |
| `POST /api/auth/register` | 1 hour | 5 / address | caller's IP |
| `POST /api/auth/refresh` | 1 minute | 60 / address | caller's IP |
| every state-changing route under `/api/accounts/:accountId` and `/api/market` | 1 minute | 120 / account | verified account id, falling back to IP |

The last row is this story's own addition (`accountActionLimiter`, `server/rateLimiters.js`), mounted once and
shared across both route families (`server/index.js:959-961` for the accounts side; `2904`, `2986`, `3021`,
`3181` for the four state-changing market routes) so an account cannot dodge the count by splitting a burst
across the two — `tests/integration/rate-limit-account-action.test.js` proves the shared bucket, the 429 on
tripping it, that `GET` reads are excluded, and that a different account's budget is untouched. Every limiter in
this table fails *open* on its own counter store breaking (`failOpenStore`, `server/rateLimiters.js:35-62`) — a
broken throttle should slow nobody down further than it already has, since it is abuse mitigation, not the
account-scoping boundary above that fails closed.

## Token lifetimes, against the day-three return (BRIEF.md, "What we will measure first")

The product's own success metric is whether a player comes back on day 3 *without being reminded* — a delayed
payout that only pays off if nothing about signing back in gets in the way. `ACCESS_TOKEN_SECONDS = 7 * 24 * 60
* 60` (`server/index.js:262`) and `REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60` (`server/index.js:264`) are both
already well past three days on purpose: a player who returns on day 3 presents a refresh token that is nowhere
near its 30-day expiry, and `POST /api/auth/refresh` (`server/index.js:912+`) reissues both tokens from it
without asking for a password again, provided the token is still stored against the account (`hasRefreshToken`)
and has not been revoked. The only way a returning player is asked to log in again inside that window is a
revoked refresh token — a deliberate sign-out, or (once AB#1765 below ships) a rotation forced by a suspected
leak — which is the acceptance line's own carve-out, not a gap in it.

## Findings filed as bugs, not fixed here (acceptance #5)

- **AB#1765**: refresh tokens are stored in plain text in `accounts-snapshot.json` (`server/game/store.js:
  560-570`), unlike passwords, which are bcrypt-hashed before they ever reach disk. A leak of that file — the
  same class of leak AB#415 already caused once — hands out live 30-day bearer tokens directly. Proposed fix:
  hash a stored refresh token (e.g. SHA-256, since it is compared for exact equality, never against a
  user-typed value) and compare the hash on presentation, the same shape `passwordHash` already uses for the
  slower bcrypt case. Confidence: high on the finding, medium on the exact hash choice (a Builder should confirm
  nothing else reads `account.refreshTokens[].token` expecting the raw value first).
- **AB#1766**: `emitMarketUpdated`, `emitForumsUpdated` and the local-chat system lookup
  (`server/index.js:3358-3366`, `3430-3432`) read `peer.data.accountId` directly instead of through
  `checkSocketAuth`, so an expired-but-still-connected socket keeps its last-known account's market/forum
  highlighting and local chat delivery until something else forces a re-check. No private or financial data
  travels this path. Proposed fix: route all three through `checkSocketAuth(peer)` the way `emitToAccount`
  already does, accepting the small extra cost of re-verifying a token on every market/forum broadcast to every
  connected socket. Confidence: high.

Both are filed in Azure DevOps (area `Orchestrata\interstellar-settlement-protocol`, tag `security`), Proposed,
not claimed by this story.
