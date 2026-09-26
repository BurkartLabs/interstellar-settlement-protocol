# CODEBASE_MAP — interstellar-settlement-protocol

> **2026-09-22, AB#737:** `server/gameState.js` is now split into `server/game/*.js` (catalog, shape, mining, refining,
> asteroids, progression, corporation, world, store, messaging) and only re-exports them. The `gameState.js:<line>`
> anchors below predate the split, as do its Supabase sections (removed in AB#578). Find a function by name.
>
> **2026-09-26, AB#763 and AB#764:** the navigation is `nav.app-nav`, a column beside the content on a desktop and a bar
> along the bottom on a phone, holding six `.nav-group` sections (Company, Station, Industry, Market, Comms, Map;
> `public/scripts/navGroups.js`), each a `.nav-group__button` over its `.nav-tab` buttons. The old row of fifteen tab
> pills and its class names are gone; audit findings below that describe it are about the build they were written on.
>
> **2026-09-25, AB#757:** no token is in localStorage any more. The refresh token is an HttpOnly, Secure,
> SameSite=Strict cookie (`isp_refresh`, path `/api/auth`) set by register/login/refresh; the access token is in
> `appState` only, obtained on each page load from `POST /api/auth/refresh`. Logout revokes the cookie's token, not
> one named in a body. The token-storage lines below were refreshed to match (AB#2143); the auth routes' line anchors
> and the logout-by-body sentence still predate it. The two old localStorage key names survive in code only in
> `public/scripts/apiClient.js` (`LEGACY_TOKEN_KEYS`), which deletes whatever an older build left there.

Generated 2026-09-20 from ten parallel subsystem reads of commit `4f92687`, at the start of the v0.5 Beta
MVP pass. Each reader opened the actual files; every claim below carries a `file:line` anchor. **The code
wins** — when this document and the source disagree, the source is right and this file is stale
(`learnings/PATTERNS.md`, P-DOC-DRIFT).

> **Status: unreviewed.** The run's own completeness critic and synthesis passes never executed — the
> session hit its limit first — so nothing here has been cross-checked against the other readers or
> re-verified against the files. Treat it as ten careful first readings, not as a verified map. Anything
> load-bearing should be confirmed in the source before you build on it. The suspected defects in
> particular are **candidates**, not filed bugs.

## Contents

- [server-auth-accounts](#server-auth-accounts) — AUTH and ACCOUNTS (server/index.js auth routes + middleware, server/gameState.js accounts 
- [server-gameplay-station](#server-gameplay-station) — Station gameplay (server): hire, rent-office, renew-office, purchase-lease, transfer-resou
- [server-market-finance](#server-market-finance) — MARKET, EXCHANGE and FINANCE (server): order book, NPC standing buy orders, trade history,
- [server-industry-travel](#server-industry-travel) — INDUSTRY and MOVEMENT (server): refinery chains, asteroid mining and probes, R&D, CEO Insi
- [server-social-contracts](#server-social-contracts) — CONTRACTS, MESSAGING and SOCIAL (server): mission/contract offerings, inbox/messages, noti
- [server-persistence](#server-persistence) — Persistence and state shape (server/gameState.js, server/db/*, server/loadEnv.js, migratio
- [client-shell-walkthrough](#client-shell-walkthrough) — CLIENT SHELL (public/index.html, public/scripts/app.js bootstrap/tabs/walkthrough/dialogue
- [client-screens](#client-screens) — CLIENT SCREENS — public/scripts/app.js tab renderers (Overview, Station + building/lease/e
- [client-design](#client-design) — VISUAL DESIGN (public/styles.css, public/index.html, public/login.html, public/register.ht
- [tests-tooling-docs](#tests-tooling-docs) — TESTS, TOOLING and PRODUCT DOCS (tests/, vitest.config.js, package.json, vercel.json, .git

---

<a id="server-auth-accounts"></a>

## server-auth-accounts

**Scope.** AUTH and ACCOUNTS (server/index.js auth routes + middleware, server/gameState.js accounts store, client token handling in public/scripts/app.js, login-page.js, register-page.js)

Auth is stateless HS256 JWT over bearer headers: `issueTokens` (server/index.js:297) signs an access token (`kind:"access"`, 7 days; 2 h for the `dummy` account only when NODE_ENV=production) and a refresh token (`kind:"refresh"`, 30 days) with `JWT_SECRET`, which falls back to the in-repo literal "isp-dev-insecure-secret-change-me" (index.js:280). Refresh tokens are the only server-side session state: `storeRefreshToken` pushes the raw JWT into `account.refreshTokens` capped at the last 10 (gameState.js:2480-2493); `/api/auth/refresh` (index.js:911) verifies, checks `hasRefreshToken`, revokes and reissues; `/api/auth/logout` (index.js:939) revokes by `{accountId, refreshToken}` from the body with no auth. `requireAuth` (index.js:319) verifies the bearer and the `kind` claim, `requireAccountAccess` (index.js:340) compares `req.auth.accountId` to `:accountId` and checks existence, and both are mounted once with `app.use("/api/accounts/:accountId", ...)` at index.js:958; routes outside that prefix (forums, market, investments) call `requireAuth` explicitly, while `/api/dev/set-credits`, `/api/combat/simulate`, `POST /kanban/api` and the socket.io `chat:send` handler are unauthenticated. Passwords are bcryptjs `hashSync` with 10 rounds (gameState.js:2164) unless `USE_SUPABASE_AUTH` (URL + service key + anon key all set) is on, in which case the user is created in Supabase Auth via `admin.createUser`, login goes through `signInWithPassword`, and the local `passwordHash` is the sentinel "__supabase_auth_managed__" (gameState.js:2166-2183, 2110-2121). The store is a module-level `accountsStore` hydrated once at import (gameState.js:1818) from Supabase `accounts` + `account_state.state_json` (refresh tokens, notifications and messages ride inside `state_json.__accountMeta`, gameState.js:1523-1529), else from `data/accounts-snapshot.json`, else a seeded store containing only `dummy`; every mutation and every `getAccountById` read calls `scheduleAccountsSave` (gameState.js:2099, 1904), which upserts every account row to Supabase and debounce-writes the full store (hashes and raw refresh tokens included) to disk. The client keeps only `isp.accountId` in localStorage; the refresh token is the `isp_refresh` HttpOnly cookie and the access token lives in `appState` (AB#757); `apiFetch` (app.js:512) adds the bearer, and on a 401 calls `refreshSessionToken` (app.js:485) once, then `handleSessionExpired` clears storage and redirects to /login.html?reason=expired. There is no rate limiting, no helmet, no CORS middleware on Express (socket.io alone has `cors: {origin: "*"}`, index.js:385), no cookies, and `express.json()` runs with its 100 kb default. All tests run in local (non-Supabase) mode with VERCEL=1, so neither the Supabase auth path nor disk snapshot writing is ever exercised.

### Entry points

- `JWT_SECRET / token lifetime constants` — `server/index.js:277` — ACCESS_TOKEN_SECONDS=7d, DUMMY_ACCESS_TOKEN_SECONDS=7d (2h only if NODE_ENV=production), REFRESH_TOKEN_SECONDS=30d, JWT_SECRET env with insecure literal fallback, ALLOW_DUMMY_AUTH=true
- `signAccessToken / signRefreshToken / issueTokens` — `server/index.js:288` — Mint {sub, kind} JWTs; issueTokens also stores the refresh token on the account and returns both tokens plus expiry timestamps
- `getBearerToken / requireAuth` — `server/index.js:311` — Parse Authorization: Bearer, jwt.verify, reject non-access kind, set req.auth.accountId
- `requireAccountAccess` — `server/index.js:340` — 403 unless JWT sub === :accountId; 404 unless accountExists
- `POST /api/auth/register` — `server/index.js:824` — createAccount then issueTokens; 400 on validation error, 201 with {account, tokens}
- `POST /api/auth/dummy-login and dummy-reset` — `server/index.js:843` — Unauthenticated dummy-account token issuance and progress reset, gated only by the hardcoded ALLOW_DUMMY_AUTH
- `POST /api/dev/set-credits` — `server/index.js:869` — Unauthenticated credit override for any accountId in the body (already filed as #423 per DEPTH.md)
- `POST /api/auth/login` — `server/index.js:893` — authenticateAccount then issueTokens; 401 on failure
- `POST /api/auth/refresh` — `server/index.js:911` — Verify refresh JWT, require it to be in account.refreshTokens, revoke, reissue pair
- `POST /api/auth/logout` — `server/index.js:939` — Unauthenticated revoke of a refresh token by {accountId, refreshToken}; always 200
- `GET /api/auth/session` — `server/index.js:948` — Bearer-only session validation returning the sanitized account
- `app.use('/api/accounts/:accountId', requireAuth, requireAccountAccess)` — `server/index.js:958` — Single guard for all per-account routes (960-2892)
- `socket.io connection / chat:send` — `server/index.js:3395` — No socket auth; author name taken from client payload
- `Supabase client + mode flags` — `server/gameState.js:14` — PASSWORD_SALT_ROUNDS=10, IS_SERVERLESS=VERCEL, USE_SUPABASE (url+service key), USE_SUPABASE_AUTH (+anon key), sentinel hash
- `stateWithAccountMeta / splitAccountStateAndMeta` — `server/gameState.js:1522` — Packs refreshTokens/notifications/messages into state_json.__accountMeta for Supabase and unpacks on hydrate
- `persistAccountsStoreToSupabase` — `server/gameState.js:1545` — Upserts EVERY account into accounts + account_state, then phase1-3 normalized dual-writes (no-op unless USE_NORMALIZED_TABLES)
- `loadAccountsSnapshotFromDisk / writeAccountsSnapshotToDiskNow / writeAccountsSnapshotToDisk` — `server/gameState.js:1618` — data/accounts-snapshot.json read and 500 ms-debounced atomic write of the whole store (hashes + raw refresh tokens)
- `hydrateAccountsStoreFromSupabaseOrFallback` — `server/gameState.js:1652` — Startup hydrate: Supabase rows -> in-memory store, else disk snapshot, else seeded dummy; seeds fallback INTO Supabase when the accounts table is empty
- `createSeedAccountsStore / accountsStore init` — `server/gameState.js:1794` — Dummy account (dummy@isp.local / dummy-password, all tech unlocked); top-level await at 1818
- `scheduleAccountsSave / saveAccountsNow / flushPendingPersist / rehydrateFromSupabase` — `server/gameState.js:1904` — Persist scheduling: serial mutex around the full-store upsert, disk mirror, Vercel-only per-request rehydrate
- `sanitizeAccount` — `server/gameState.js:2049` — Strips passwordHash/refreshTokens/notifications/messages; deep-clones state for every response
- `getAccountById` — `server/gameState.js:2090` — Read that also applies mining/contract/level ticks and schedules a full persist
- `authenticateAccount` — `server/gameState.js:2103` — Email lookup, then Supabase signInWithPassword or bcrypt compareSync; sets lastLoginAt and pushes an auth notification
- `createAccount` — `server/gameState.js:2146` — Validation (email contains @, password >= 8), duplicate check, bcrypt hash or Supabase admin.createUser, starter state, welcome message
- `storeRefreshToken / revokeRefreshToken / hasRefreshToken` — `server/gameState.js:2480` — Raw-JWT list on the account, expiry-pruned, capped at 10, revoked by exact string match
- `getDummyAccount / resetDummyAccountProgress / mutateAccountState` — `server/gameState.js:2525` — Dummy helpers and the generic mutate-then-persist wrapper used by every gameplay route
- `loadEnv.js` — `server/loadEnv.js:44` — Reads .env then .env.local into process.env without overriding existing keys (no .env or .env.example present in the checkout)
- `STORAGE_KEYS / IS_DEV_ACCESS` — `public/scripts/state.js` — the localStorage key isp.accountId (tokens are not stored, AB#757); dev gate is ?dev=1 or localhost (client-side only)
- `persistSession / clearSession / handleSessionExpired / hydrateSession` — `public/scripts/app.js:400` — Token storage lifecycle and the redirect to /login.html?reason=expired
- `refreshSessionToken / apiFetch` — `public/scripts/app.js:485` — Bearer injection and single-retry refresh on 401; no in-flight dedupe
- `loadAuthenticatedAccount / restoreAuthenticatedSession / loginDummyAccount` — `public/scripts/app.js:5241` — Boot-time session validation via /api/auth/session; dummy login POST
- `in-page register/dummy handlers` — `public/scripts/app.js:6040` — A second register flow inside index.html's auth shell, duplicating register-page.js
- `logout button handler` — `public/scripts/app.js:6472` — POST /api/auth/logout with accountId+refreshToken (raw fetch), then clearSession and showAuthScreen
- `boot()` — `public/scripts/app.js:6585` — Honors ?dummy=1 and ?account=<id> query params, restores the session, cleans the URL
- `login-page.js` — `public/scripts/login-page.js:55` — Standalone login form: POST /api/auth/login, write localStorage, redirect to /?account=<id>; dummy button at line 23
- `register-page.js` — `public/scripts/register-page.js:11` — Standalone register form with the same localStorage + redirect pattern
- `POST /kanban/api` — `server/kanban.js:32` — Unauthenticated overwrite of kanban/kanbanState.json (mounted publicly at index.js:434)

### State this subsystem reads or writes

- `accountsStore.accounts[<id>].id`
- `accountsStore.accounts[<id>].email (lowercased)`
- `accountsStore.accounts[<id>].passwordHash (bcrypt or sentinel '__supabase_auth_managed__')`
- `accountsStore.accounts[<id>].refreshTokens[] {token, expiresAt} (raw JWT strings, max 10)`
- `accountsStore.accounts[<id>].notifications[]`
- `accountsStore.accounts[<id>].messages[]`
- `accountsStore.accounts[<id>].walkthroughCompleted`
- `accountsStore.accounts[<id>].createdAt`
- `accountsStore.accounts[<id>].lastLoginAt`
- `accountsStore.accounts[<id>].state (full corp state; state.playerProfile.walkthroughCompleted mirrored)`
- `accountsStore.accounts.dummy (seeded, never persisted to Supabase, merged back after hydrate)`
- `Supabase table accounts {id, email, password_hash, walkthrough_completed, created_at, last_login_at}`
- `Supabase table account_state {account_id, state_json.__accountMeta.{refreshTokens, notifications, messages}, updated_at}`
- `Supabase table refresh_tokens (defined in supabase_migration.sql:20, never read or written by server code)`
- `data/accounts-snapshot.json (full accountsStore incl. hashes and refresh tokens; gitignored)`
- `state.market.orderBook[].sellerAccountId and state.forums threads[].authorAccountId (account ids exposed via unauthenticated GET /api/bootstrap)`
- `localStorage isp.accountId`
- `appState.accessToken (memory only, AB#757)`
- `cookie isp_refresh (HttpOnly, Secure, SameSite=Strict, path /api/auth; AB#757)`
- `localStorage isp.walkthrough-offer-seen:<accountId>`
- `req.auth.accountId (set by requireAuth)`
- `process.env.JWT_SECRET`
- `process.env.NODE_ENV (drives IS_DEV and dummy token lifetime)`
- `process.env.VERCEL (IS_SERVERLESS; disables disk writes and enables per-request rehydrate)`
- `process.env.SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL`
- `process.env.SUPABASE_SERVICE_ROLE_KEY`
- `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY (turns on Supabase-managed auth)`
- `process.env.USE_NORMALIZED_TABLES`
- `process.env.ISP_DISABLE_TICKERS`
- `process.env.PORT`

### TODOs in this code

- `server/index.js:51` — TODO: Move this to a single file so that we aren't redefining it everywhere (IS_DEV)
- `server/index.js:800` — TODO: Consider moving API to a dedicated api.js file
- `server/gameState.js:1586` — TODO: Evaluate below account persistance functionality. We are frequently having connection issues which trigger the below errors. Despite there being no downtime with the server itself.
- `server/gameState.js:1617` — TODO: Remove all local disk account snapshots. All operations should go through the DB
- `server/gameState.js:1791` — TODO: Evaluate if this is needed (createSeedAccountsStore)
- `server/gameState.js:2479` — TODO: Evaluate usage of Refresh Tokens
- `public/scripts/app.js:5285` — TODO: Duplicate function possibly exists in gameState.js (loginDummyAccount)
- `public/scripts/login-page.js:4` — TODO: Move IS_DEV_ACCESS duplicate to a single file
- `public/scripts/register-page.js:10` — TODO: Implement email verification

### Suspected defects (candidates — unverified, not filed)

- **sev 1** · `server/index.js:280` — **JWT_SECRET fails open to the committed literal 'isp-dev-insecure-secret-change-me'; any deployment that forgets the env var lets anyone mint a valid access token for any account id, and account ids are public (market orders carry sellerAccountId at index.js:3087 and forum threads carry authorAccountId at index.js:2926, both served by unauthenticated GET /api/bootstrap at index.js:802).**
  <br>Evidence: Verified: `const JWT_SECRET = process.env.JWT_SECRET || "isp-dev-insecure-secret-change-me";` with no startup check; no .env or .env.example exists in the checkout (ls .env* empty), so a fresh Azure deploy runs on the literal unless the operator sets it. DEPTH.md:87 mentions this inside the #423 write-up but it is not filed as its own item.
- **sev 2** · `server/gameState.js:1555` — **Every persist upserts EVERY account (two full-table upserts plus three phase dual-writes), and getAccountById schedules a persist on every read, so every authenticated GET (session check, notifications poll, the 60-second mining refresh) rewrites the whole accounts and account_state tables; write volume scales O(accounts x requests), which is the likely cause of the 'frequent connection issues' TODO at line 1586.**
  <br>Evidence: Verified: persistAccountsStoreToSupabase maps `Object.values(snapshot.accounts)` to accountRows/stateRows and upserts both (1555-1583); getAccountById calls scheduleAccountsSave at 2099; scheduleAccountsSave starts _runPersistAccountsToSupabaseSerially immediately (1929) with only a re-queue mutex, no debounce, no per-account dirty tracking.
- **sev 2** · `public/scripts/app.js:485` — **Concurrent 401s race the refresh: refreshSessionToken has no in-flight dedupe, so when the access token expires while two requests overlap (e.g. the 60 s mining-ticker refreshFromServer at app.js:3013 and a user action), both POST the same refresh token; the server rotates on the first and answers 401 'revoked' to the second, whose failure path calls handleSessionExpired and force-logs the player out.**
  <br>Evidence: Verified by reading: apiFetch (512-527) calls refreshSessionToken per 401 with no shared promise; refreshSessionToken calls handleSessionExpired on any non-ok (498-501); server revokes then reissues (index.js:930-931). Not reproduced in a browser (inferred).
- **sev 2** · `server/gameState.js:2182` — **Accounts registered while USE_SUPABASE_AUTH is on have no local password hash (sentinel '__supabase_auth_managed__'); if the anon key is dropped or the app moves off Supabase (the Azure plan), authenticateAccount takes the bcrypt branch and every such user is locked out with no recovery path other than a password reset flow that does not exist.**
  <br>Evidence: Verified: createAccount sets passwordHash = SUPABASE_MANAGED_PASSWORD_HASH when USE_SUPABASE_AUTH (2166-2183); authenticateAccount branches on USE_SUPABASE_AUTH at 2110 and otherwise does bcrypt.compareSync against the sentinel (2123). Whether production accounts were created under Supabase Auth is not verifiable from the repo (inferred risk).
- **sev 2** · `server/index.js:893` — **No rate limiting on /api/auth/login, /register or /refresh, and password work is synchronous (bcryptjs hashSync/compareSync at 10 rounds), so a credential-stuffing loop is both unthrottled and blocks the event loop for every other player.**
  <br>Evidence: Verified: package.json has no limiter/helmet/cors dependency; grep for rateLimit/helmet in server/ returns nothing; gameState.js:2123 compareSync, :2164 hashSync. DEVELOPMENT_PHASES.md:91 lists 'rate limiting' as an open hardening item but no work item anchors it to these routes.
- **sev 3** · `server/index.js:288` — **Tokens carry no jti/nonce, so two tokens issued for the same account within the same second are byte-identical: a refresh within one second of issuance revokes-then-re-stores the same string (rotation is a no-op), two devices logging in the same second share one refresh token, and logout on either revokes both.**
  <br>Evidence: Verified: sign payload is {sub, kind} only (288-295); revokeRefreshToken filters by exact string (2505); tests/integration/auth.test.js:98-108 explicitly sleeps 1100 ms to dodge this and documents it in a comment rather than asserting against it.
- **sev 3** · `server/gameState.js:1526` — **Refresh tokens are stored as raw JWT strings inside account_state.state_json.__accountMeta and in data/accounts-snapshot.json, not hashed and not in the refresh_tokens table the migration defines; the AB#415 leak was possible because of this, and the migration's refresh_tokens table is dead code.**
  <br>Evidence: Verified: stateWithAccountMeta copies account.refreshTokens verbatim (1526); writeAccountsSnapshotToDiskNow serializes the whole accountsStore (1633); `grep -rn refresh_tokens server/ tests/` returns nothing while supabase_migration.sql:20 creates the table.
- **sev 3** · `server/index.js:277` — **Access tokens live 7 days with no server-side revocation, so logout (which only drops the refresh token) leaves a stolen or leftover access token usable for up to a week; the only global kill switch is rotating JWT_SECRET.**
  <br>Evidence: Verified: ACCESS_TOKEN_SECONDS = 7*24*60*60 (277); requireAuth checks signature and kind only (319-337); logout route touches refresh tokens only (939-946).
- **sev 3** · `server/index.js:3395` — **The socket.io layer has no authentication and chat:send trusts the client-supplied `author`, so any visitor can post chat as any corporation name; socket CORS is also origin '*'.**
  <br>Evidence: Verified: io.on('connection') has no handshake check; message.author = stripHtml(payload?.author) (3407); client connects with bare io() (app.js:399); cors origin '*' at index.js:385.
- **sev 3** · `server/kanban.js:32` — **POST /kanban/api is unauthenticated and overwrites kanban/kanbanState.json with whatever JSON body arrives, on a route that is served publicly (BRIEF.md:70 says it is on burkart.dev).**
  <br>Evidence: Verified: router.post('/api') calls saveKanban(req.body) with no auth and no schema check; mounted at index.js:434 after express.json (398).
- **sev 3** · `server/index.js:3359` — **POST /api/combat/simulate is unauthenticated and writes to shared state (combatReports, capped at 50) and broadcasts to every client, so anyone can flood the global combat feed with arbitrary names.**
  <br>Evidence: Verified: no requireAuth on the route; createCombatReport -> mutateState (gameState.js:2034-2045); io.emit('combat:newReport') at 3390.
- **sev 3** · `server/gameState.js:2110` — **In Supabase-auth mode authenticateAccount calls signInWithPassword before checking the local store; a user that exists in Supabase Auth but whose accounts row failed to persist (or was not hydrated on this instance) gets a generic 401 with correct credentials, and the successful GoTrue sign-in is wasted.**
  <br>Evidence: Verified: lookup at 2106 is not checked until 2127, after the network call at 2111-2117.
- **sev 4** · `server/gameState.js:2185` — **Register accepts unbounded ceoName/corpName (no server-side max length or HTML stripping; the 40/80 maxlength lives only in register.html:40,43) and an unbounded password that bcryptjs silently truncates at 72 bytes; email validation is only `includes('@')`.**
  <br>Evidence: Verified: createAccount trims and defaults but never caps (2149, 2185-2189); node_modules/bcryptjs/README.md:17 documents the 72-byte limit and a `truncates()` helper that is not called. Rendering sites checked (app.js:4225, 4757) escape, so XSS is unverified/not claimed.
- **sev 4** · `server/gameState.js:2159` — **Account enumeration: register returns 'An account with this email already exists.' and login returns early without a bcrypt compare when the email is unknown (2118-2120), giving a timing oracle.**
  <br>Evidence: Verified at the cited lines. Common trade-off; noting it because ISP-10 asks the security-first questions.
- **sev 4** · `server/index.js:278` — **The documented 2-hour dummy token (DEVELOPMENT_PHASES.md:9) only applies when NODE_ENV === 'production'; on any host that does not set NODE_ENV (Azure App Service / Container Apps do not by default) the dummy access token lasts 7 days and IS_DEV is true.**
  <br>Evidence: Verified: IS_DEV at index.js:52; DUMMY_ACCESS_TOKEN_SECONDS = IS_DEV ? 7d : 2h at 278. tests/setup.js:28 also sets an ALLOW_DUMMY_AUTH env var that no code reads (supports the already-filed hardcoded-flag defect).
- **sev 4** · `server/gameState.js:2493` — **storeRefreshToken keeps only the last 10 refresh tokens per account, so an 11th login (or 11 refreshes across devices) silently invalidates the oldest device's session with no notice.**
  <br>Evidence: Verified: `.slice(-10)` at 2493; each refresh also consumes a slot because it issues a new token before the old one is filtered out on the next call.

### Test coverage, and what it does not cover

tests/integration/auth.test.js (263 lines, supertest against the real app in local mode) covers: register 201 with tokens, duplicate email 400, missing fields 400, short password 400, email without '@' 400; login 200, wrong password 401, unknown email 401; refresh rotate 200, reuse-after-rotate 401 (with a 1.1 s sleep to avoid the same-second identical-token issue), missing 400, malformed 401; logout 200 then refresh 401; session 200 / no header 401 / tampered 401; dummy-login and dummy-reset 200; requireAccountAccess cross-account 403 and owner 200; public bootstrap/stations/buildings; dev/set-credits 200/400/404. tests/unit/mergeDummyAccount.test.js covers the dummy-merge helper. tests/helpers/api.js provides registerAccount/authed. NOT covered: using a refresh token as a bearer (kind check), expired access or refresh tokens, JWT_SECRET fallback behaviour, the 10-token cap, same-second rotation no-op (sidestepped, not asserted), logout with a mismatched accountId, register max lengths / 72-byte password, timing/enumeration, the entire Supabase-auth path (tests/setup.js blanks every SUPABASE_* var), disk snapshot read/write (setup.js sets VERCEL=1 so IS_SERVERLESS short-circuits all disk I/O), hydrate-from-Supabase and persist upsert logic (never executed), socket.io auth or chat:send author spoofing, /kanban/api (excluded from coverage in vitest.config.js), /api/combat/simulate, any client-side code (no browser or Playwright tests exist for app.js, login-page.js, register-page.js, so the localStorage flow, refresh race and expired-session redirect are untested), rate limiting (nothing to test).

### Before you touch this in v0.5

- Do not re-report: ALLOW_DUMMY_AUTH hardcoded true, /api/dev/set-credits (#423), the AB#415 snapshot leak, Vercel-inert persistence. Everything else above is new as far as hq learnings and DEPTH.md show.
- Cheapest way to honour AB#415's 'invalidate every refresh token': rotate JWT_SECRET on the new host. All tokens (access and refresh) are signed with the single secret at index.js:280, so a new secret logs everyone out at once; the per-account refreshTokens lists then prune themselves via hasRefreshToken. Pair it with a startup check that refuses to boot without JWT_SECRET in production.
- Azure move decision point: there are two auth modes selected purely by env presence (USE_SUPABASE_AUTH needs URL + service key + anon key). Under Supabase Auth the password lives in GoTrue and the local row holds a sentinel; leaving Supabase means those users need a forced password reset (no reset flow exists; register-page.js:10 TODO says email verification is also missing). Under local mode passwords are bcryptjs hashes in the accounts table/snapshot and port cleanly to any Postgres. Find out which mode production ran in before choosing.
- Persistence in local mode IS the disk snapshot. The TODO at gameState.js:1617 wants it removed; if v0.5 removes it before a database replaces it, an Azure container restart wipes every account and session (the seeded store only contains dummy). On Azure Container Apps the filesystem is ephemeral anyway, so the snapshot is not a viable store there.
- Persist shape needs redesign before playtest scale: one dirty flag for the whole store, every read schedules a persist, every persist upserts every account (gameState.js:1555-1583, 2099). Per-account dirty tracking plus a debounce is the minimum; the 'connection issues' TODO at 1586 is probably this.
- The auth guard pattern is sound where it is used: app.use('/api/accounts/:accountId', requireAuth, requireAccountAccess) at index.js:958 protects every per-account route, and forums/market/investments add requireAuth explicitly. Any NEW route outside /api/accounts must add requireAuth by hand; the three that forgot (dev/set-credits, combat/simulate, POST /kanban/api) plus the socket layer are the current gaps.
- NODE_ENV is load-bearing: IS_DEV (index.js:52) flips the dummy token lifetime, and nothing else reads it. Azure does not set NODE_ENV=production for you; set it in the container/app settings alongside JWT_SECRET and PORT.
- Client-side dev gating is cosmetic: IS_DEV_ACCESS (app.js:62, login-page.js:5) only hides the dummy button; ?dev=1 on any host re-shows it and the server route is open regardless. Also ?dummy=1 in the URL triggers a dummy login at boot (app.js:6589).
- Auth client code is triplicated: STORAGE_KEYS and IS_DEV_ACCESS in app.js, login-page.js and register-page.js, plus a second in-page register handler inside app.js (6040-6110) that duplicates register-page.js. Any change to token storage or the redirect must be made in three places, or consolidate first (a redesign of login/register pages for the visual pass is the natural moment).
- Tokens are bearer JWTs in localStorage, not cookies: no CSRF surface, but any XSS exfiltrates a 30-day refresh token. If the visual redesign introduces more innerHTML rendering, keep escapeHtml discipline (currently used for forum/chat author at app.js:4225, 4757). Moving to httpOnly cookies would also let the socket be authenticated for free.
- The migration file (supabase_migration.sql) defines a refresh_tokens table that nothing uses; refresh tokens actually live in account_state.state_json.__accountMeta. If v0.5 adopts the normalized schema, either wire that table up (and hash the tokens) or drop it from the migration.
- The refresh race (app.js:485) will only bite once per device per 7 days (access-token lifetime) but when it does it force-logs the player out mid-session; fix is a shared in-flight promise in refreshSessionToken. Shortening the access token without fixing this makes it fire more often.
- express.json() runs at the 100 kb default with no helmet and no CORS middleware; the browser's same-origin policy is the only thing stopping cross-origin API calls, which is fine while the client is served from the same origin. If the client moves to a Static Web App on a different origin (as Relic Vault is), a CORS policy and the socket origin '*' both need deciding.
- All auth tests run in VERCEL=1 + blank Supabase env, so hydrate, persist and disk paths have zero coverage. Any change to the store should add a test mode that exercises the disk path (IS_SERVERLESS false with a temp dataDir) before trusting it on Azure.

---

<a id="server-gameplay-station"></a>

## server-gameplay-station

**Scope.** Station gameplay (server): hire, rent-office, renew-office, purchase-lease, transfer-resources, travel, extractor commissioning, start/stop cycle, mining model (ensureCorpMiningModel / applyMiningOperations / stopExtractorCycle / downtime), milestones and level progress (resolveMetric / evaluateLevelProgress / MILESTONE_LEVELS / data/milestones.json)

All station actions are Express POST routes under /api/accounts/:accountId/gameplay/* in server/index.js, protected as a group by the router-level `app.use("/api/accounts/:accountId", requireAuth, requireAccountAccess)` at index.js:958 (verified: no per-route middleware on 1038-1420, the gate is the app.use). Every route follows one shape: parse body -> `mutateAccountState(accountId, mutator)` (gameState.js:2580) which runs applyMiningOperations before AND after the mutator, then refreshContractOfferings, ensureCorpMiningModel, evaluateLevelProgress and scheduleAccountsSave -> map an `outcome` string to an error message (400) or emit `notifications:new` via io.emit and return the sanitized account. Costs come from data/economy.json through server/economy.js (AB#726; lease prices from data/systems.json), with these values: hire 2000 credits + 150/day dailyCosts (1047-1061), office 1000 credits/day for 7/14/21/28 days (1094-1096), lease table {Earth 20000, Mars 25000, Luna 30000, default 25000} (1256-1257) with (leases+1)*5 employees required (1258, 1279), extractor 50000 (0.94x with tt-supply-forecast) at 1557-1565 and 1780, cycle startup = max(500, 35% of hourly op-cost) where op-cost = max(600, 16*throughput) and throughput clamps 10-250 (1711-1715, duplicated at 2493-2495). Two parallel extractor families exist: lease-scoped `lease/:leaseId/build-extractor` (1555) and `lease/:leaseId/start-mining` (1654, requires an unexpired office) which the UI uses (app.js:1961, 2022), and legacy generic `build-extractor` (1767, capped by corp.unlocks.maxBasicExtractorYards which is never raised past 1) and `mine` (2482, no office/lease check) whose UI bindings are dead because index.html lacks the level2 form elements (bindLevel2Controls returns at app.js:4900; only level2-requirements/level2-status exist in index.html:326-328). The mining model lives in gameState.js: ensureCorpMiningModel (359) rebuilds every extractor object on every call, backfills extractors from "Basic Extractor Yard" buildings, and re-links leaseId/body/extractorIds; applyMiningOperations (539) is driven by miningTick every 5 s (index.js:467-484) and per-call by mutateAccountState/getAccountById; it handles downtime (0.005%/s base, -8% with tt-industrial-safety, 15-min floor, 0.0276%/s recovery), credits mined Silicates to the station of the lease body via BODY_TO_STATION (644-646), charges op-cost scaled by affordability, records "mining" income at 2.4/unit into the ledger without adding credits, and stops via stopExtractorCycle (532) on endsAt or underfunding; there is no player-facing stop route. Level progress: evaluateLevelProgress (1020) rebuilds corp.levelProgress from MILESTONE_LEVELS (data/milestones.json) using resolveMetric (967) prefixes stat:/employeeCount/miningLease:/building:/building-count:/totalMined:/unlockedTech:, appends milestone titles to corp.milestonesCompleted, and at 1055-1075 sets corp.level to any higher level whose requirements are all complete, granting employeeCap/buildingSlots/maxFleetSize via Math.max and appending marketSectors.

### Entry points

- `POST /api/accounts/:accountId/gameplay/hire` — `projects/interstellar-settlement-protocol/server/index.js:1038` — Hire up to `count` employees clamped to employeeCap-employeeCount; 2000 credits each; adds 150/day to finances.dailyCosts; notification type workforce
- `POST /api/accounts/:accountId/gameplay/rent-office` — `projects/interstellar-settlement-protocol/server/index.js:1092` — Rent an office at stationId for 7/14/21/28 days at 1000/day; pushes an office record; rejects only if an unexpired office exists at that station
- `POST /api/accounts/:accountId/gameplay/renew-office` — `projects/interstellar-settlement-protocol/server/index.js:1175` — Extend the FIRST office record matching stationId by durationDays at 1000/day (Math.max(rentedUntil, now) + extension)
- `POST /api/accounts/:accountId/gameplay/purchase-lease` — `projects/interstellar-settlement-protocol/server/index.js:1248` — Buy a mining lease on `body` (any string accepted); requires any office and (leases+1)*5 employees; adds 2 lease slots and +2 corp.buildingSlots; saveAccountsNow()
- `POST /api/accounts/:accountId/gameplay/transfer-resources` — `projects/interstellar-settlement-protocol/server/index.js:1342` — Instant move of `quantity` of `item` from fromStationId to corp.currentStationId for 2 credits/unit
- `POST /api/accounts/:accountId/gameplay/travel` — `projects/interstellar-settlement-protocol/server/index.js:1408` — Start interstellar (research-gated, hops*1h) or local (station-to-station, or 5s dev/10min prod from open space) travel; sets corp.travel and nulls currentStationId; arrival handled by travelTick (607)
- `POST /api/accounts/:accountId/gameplay/lease/:leaseId/build-extractor` — `projects/interstellar-settlement-protocol/server/index.js:1555` — Commission a Basic Extractor Yard on a lease: checks lease slots (2) and corp.buildingSlots, 50000 credits (0.94x with tt-supply-forecast), pushes building + extractor {leaseId, body}, assets += 36000; used by the UI (app.js:1961)
- `POST /api/accounts/:accountId/gameplay/lease/:leaseId/start-mining` — `projects/interstellar-settlement-protocol/server/index.js:1654` — Start a cycle on a lease extractor: requires an unexpired office; body {extractorId, amount(10-250/h), hours(1-72)}; charges startup = max(500, 0.35*opCost); sets active/startedAt/lastTickAt/endsAt; used by the UI (app.js:2022)
- `POST /api/accounts/:accountId/gameplay/build-extractor (legacy generic)` — `projects/interstellar-settlement-protocol/server/index.js:1767` — Generic extractor build capped by corp.unlocks.maxBasicExtractorYards (always 1); auto-attaches to the sole lease; assets += 42000; UI binding is dead (index.html lacks level2 form ids)
- `POST /api/accounts/:accountId/gameplay/mine (legacy generic start)` — `projects/interstellar-settlement-protocol/server/index.js:2482` — Start a cycle on any extractor with NO office or lease check; same cost formula as start-mining; UI binding is dead (bindLevel2Controls returns at app.js:4900)
- `miningTick` — `projects/interstellar-settlement-protocol/server/index.js:467` — setInterval every 5000 ms (line 484): for every account runs applyMiningOperations inside mutateAccountState and io.emit('mining:updated') with that account's extractors, inventory and credits to all sockets
- `auth gate for all /api/accounts/:accountId routes` — `projects/interstellar-settlement-protocol/server/index.js:958` — app.use(requireAuth, requireAccountAccess): the only auth on the station routes; token sub must equal :accountId
- `mutateAccountState` — `projects/interstellar-settlement-protocol/server/gameState.js:2580` — The single mutation path: applyMiningOperations -> mutator -> applyMiningOperations -> refreshContractOfferings -> ensureCorpMiningModel -> evaluateLevelProgress -> scheduleAccountsSave; returns sanitizeAccount
- `ensureCorpMiningModel` — `projects/interstellar-settlement-protocol/server/gameState.js:359` — Normalizes corp.mining: migrates legacy silicateExtractor, backfills one extractor per 'Basic Extractor Yard' building, rebuilds every extractor object (new references each call), defaults unlocks.maxBasicExtractorYards=1, re-links leaseId/body and rebuilds lease.extractorIds
- `stopExtractorCycle` — `projects/interstellar-settlement-protocol/server/gameState.js:532` — active=false; endsAt=lastTickAt=lastCompletedAt=timestamp. Only called from applyMiningOperations (593, 657); no route exposes a stop (TODO at 531)
- `applyMiningOperations` — `projects/interstellar-settlement-protocol/server/gameState.js:539` — Per-extractor tick: downtime recovery (549-578), downtime roll (598-613), mining output to BODY_TO_STATION[lease.body] station inventory (641-651), op-cost with affordability scaling (624-639), ledger recordExpense('mining-ops')/recordIncome('mining'), stop on endsAt or underfunding (656-658)
- `resolveMetric` — `projects/interstellar-settlement-protocol/server/gameState.js:967` — Maps milestones.json metric strings (stat:, employeeCount, miningLease:, building:, building-count:, totalMined:silicate, unlockedTech:) to live corp values; unknown metrics return 0
- `evaluateLevelProgress (unlock applier at 1055-1075)` — `projects/interstellar-settlement-protocol/server/gameState.js:1020` — Rebuilds corp.levelProgress, appends completed milestone titles, and for each level with corp.level < N and all reqs complete sets corp.level=N and grants employeeCap/buildingSlots/maxFleetSize (Math.max) and marketSectors
- `MILESTONE_LEVELS / REQ_ID_TO_TITLE` — `projects/interstellar-settlement-protocol/server/gameState.js:99` — Loaded from data/milestones.json at module load; MILESTONE_ROADMAP (100) is loaded but never used or exported; REQ_ID_TO_TITLE built at 122-127
- `data/milestones.json` — `projects/interstellar-settlement-protocol/data/milestones.json:1` — 10 levels; L1 office+5 hires; L2 Mars lease+extractor+300 mined; L3 sell 300 silicate (stat:silicateSoldOnExchange)+tt-basic-extraction; L4-L10 add stat:* metrics that have no writer (see defects)
- `createStarterCorporationState` — `projects/interstellar-settlement-protocol/server/gameState.js:1079` — New-account defaults: level 0, employeeCap 8, buildingSlots 2, HQ building, 250000 credits, unlocks {marketSectors:[], maxUpgradeTier:1, maxFleetSize:0, maxBasicExtractorYards:1}, empty offices/miningLeases
- `getAccountById` — `projects/interstellar-settlement-protocol/server/gameState.js:2090` — Read path also runs applyMiningOperations + evaluateLevelProgress and schedules a save (GETs mutate state)

### State this subsystem reads or writes

- `corp.employeeCount`
- `corp.employeeCap`
- `corp.finances.credits`
- `corp.finances.dailyCosts (written by hire only; never deducted)`
- `corp.finances.dailyRevenue (mining phantom revenue)`
- `corp.finances.assets`
- `corp.finances.incomeBySource.mining`
- `corp.finances.expensesByCategory.mining-ops`
- `corp.finances.lifetimeRevenue`
- `corp.finances.lifetimeCosts`
- `corp.offices[] {stationId,name,body,systemId,tier,rentedAt,rentedUntil,durationDays}`
- `corp.miningLeases[] {id,body,leaseType,issuedAt,cost,buildingSlots,extractorIds[]}`
- `corp.buildingSlots`
- `corp.buildings[] {name,tier,status}`
- `corp.mining.silicateExtractors[] {id,name,tier,active,startedAt,lastTickAt,endsAt,throughputPerHour,operationCostPerHour,totalMined,minedRemainder,totalSpent,lastCompletedAt,leaseId,body,downtimeActive,downtimeStartedAt,downtimeRecoveredAt}`
- `corp.mining.silicateExtractor (legacy mirror of extractors[0])`
- `corp.unlocks.maxBasicExtractorYards`
- `corp.unlocks.maxFleetSize`
- `corp.unlocks.marketSectors[]`
- `corp.unlocks.maxUpgradeTier`
- `corp.unlockedTech[] (tt-basic-extraction, tt-supply-forecast, tt-industrial-safety affect mining)`
- `corp.inventory[stationId][item] (Silicates deposited by mining; transfer-resources moves items)`
- `corp.currentStationId`
- `corp.currentSystemId`
- `corp.travel {travelType,fromSystemId,toSystemId,fromStationId,toStationId,departedAt,arrivesAt}`
- `corp.level`
- `corp.levelProgress.levelN.{requirements[],allCompleted}`
- `corp.milestonesCompleted[]`
- `corp.stats.silicateSoldOnExchange (only stats key ever written, index.js:3271)`
- `corp.credits (stray field written by complete-mission index.js:2445, never read)`
- `state.playerProfile.walkthroughCompleted (read by hydration only)`

### TODOs in this code

- `projects/interstellar-settlement-protocol/server/index.js:1255` — TODO: Should we be storing the lease costs here? And why are we only specifying for Earth, Mars, and Luna?
- `projects/interstellar-settlement-protocol/server/gameState.js:369` — TODO: Is this still needed? (legacy single-extractor migration in ensureCorpMiningModel)
- `projects/interstellar-settlement-protocol/server/gameState.js:531` — TODO: Add force-stop functionality (stopExtractorCycle has no route)
- `projects/interstellar-settlement-protocol/server/gameState.js:1078` — TODO: Should this all be hardcoded? Or should some of it be based upon completed research, etc? (createStarterCorporationState)
- `projects/interstellar-settlement-protocol/server/index.js:500` — TODO: Consider implementation of unified tick system where all tick based actions are performed at once, rather than a separate ticker calculation for each function
- `projects/interstellar-settlement-protocol/server/index.js:54` — TODO: This should be extracted from the DB or from research.json (RESEARCH_LIBRARY; the tt-* ids it defines are the ones mining multiplies by)
- `projects/interstellar-settlement-protocol/server/index.js:51` — TODO: Move this to a single file so that we aren't redefining it everywhere (IS_DEV, also defined at gameState.js:777)
- `projects/interstellar-settlement-protocol/server/index.js:800` — TODO: Consider moving API to a dedicated api.js file
- `projects/interstellar-settlement-protocol/public/scripts/app.js:3190` — TODO: Remove. This is defined within gameState.js but should be fetched from the DB or from milestones.json (client duplicates MILESTONE_ROADMAP)
- `projects/interstellar-settlement-protocol/public/scripts/app.js:2840` — TODO: This information should be stored in the database OR in milestones.json (REQ_TAB requirement-id to tab map)

### Suspected defects (candidates — unverified, not filed)

- **sev 1** · `projects/interstellar-settlement-protocol/server/index.js:1039` — **Non-numeric JSON in `count` (hire), `amount` (mine), or `quantity` (transfer-resources) propagates NaN into persisted state (employeeCount, credits, inventory); once credits is NaN every `credits < cost` guard is false, so all purchases succeed for free.**
  <br>Evidence: VERIFIED by node repro of the exact expressions: hire line 1039 `Math.max(1, Number(count || 1))` with count "abc" or {} -> hired NaN, `hired <= 0` false, `credits < NaN` false, then lines 1059-1061 do employeeCount += NaN and credits -= NaN. Same at 2483/2493-2495 (`mine`: throughput/opCost/startup all NaN, credits -= NaN at 2546) and 1345 (`transfer-resources`: quantity NaN, fromInv/toInv/credits NaN at 1380-1386). The lease-scoped start-mining guards throughput at 1711-1714 but not hours (1657: NaN endsAt). No route uses Number.isFinite. Other routes' `credits < x` checks are then all false (e.g. 1054, 1128, 1285).
- **sev 2** · `projects/interstellar-settlement-protocol/server/index.js:473` — **miningTick broadcasts every account's extractors, full inventory and credits to every connected socket every 5 seconds; notifications are broadcast the same way.**
  <br>Evidence: VERIFIED: index.js:473-478 `io.emit("mining:updated", { accountId, extractors, inventory, credits })` inside a loop over getAllAccountIds(); io.on('connection') at 3395-3419 never calls socket.join and there is no io.to() anywhere in index.js (grep). The client discards other accounts' payloads (app.js:5980) but the data is on the wire for all viewers. notifications:new (1086, 1168, 1241, 1330, 1584, 1698, 1800) uses the same io.emit.
- **sev 2** · `projects/interstellar-settlement-protocol/server/gameState.js:607` — **A downtime roll over a long catch-up window discards all mining output for that window; if the window spans endsAt the whole cycle's output is lost.**
  <br>Evidence: VERIFIED by reading: elapsedMs = now - lastTickAt (586-589); tickProb = 1-(1-p)^seconds (606) so an 8 h gap (server restart, Vercel cold start) gives ~76% downtime probability; on trigger (607-613) the function returns without mining or advancing lastTickAt; on recovery (571-575) lastTickAt = now. If now > endsAt after recovery, elapsedMs = max(0, endsAt - now) = 0 and the extractor stops (591-595) having credited nothing. Test 'triggers downtime' (applyMiningOperations.test.js:206-230) asserts totalMined 0 on the trigger tick, i.e. the behaviour is enshrined but the long-window consequence is untested.
- **sev 2** · `projects/interstellar-settlement-protocol/server/index.js:2445` — **Mission reward credits are written to `state.corp.credits`, a field nothing reads; the player never receives mission rewards.**
  <br>Evidence: VERIFIED: complete-mission writes `state.corp.credits = (state.corp.credits || 0) + rewardCredits` (2445) while every other route and the ledger use `corp.finances.credits`; grep for `corp.credits` outside `finances` finds only this line and a client demo fallback (app.js:5703). Outside the strict station scope but found while tracing stat:missionsCompleted.
- **sev 2** · `projects/interstellar-settlement-protocol/server/index.js:1249` — **purchase-lease accepts any `body` string with no registry check (default cost 25000, leaseType always 'Silicate Extraction'), so a raw POST satisfies the L9 `miningLease:Luna` and L10 `miningLease:Asteroid Belt` milestones and creates leases whose ore deposits fall back to the current station.**
  <br>Evidence: VERIFIED: 1249-1257 only require a non-empty string and look up LEASE_COSTS[requestedBody] ?? 25000; the lease is pushed at 1292-1300 with the raw string. resolveMetric miningLease: (985-988) matches on lease.body; applyMiningOperations 644 falls back to corp.currentStationId when BODY_TO_STATION[lease.body] is undefined. The client only offers Earth/Mars/Luna at the docked station (app.js:1667-1674), so there is no legitimate path to an 'Asteroid Belt' lease that L10 requires.
- **sev 3** · `projects/interstellar-settlement-protocol/server/gameState.js:1057` — **Level-ups are non-sequential: a corp jumps to any higher level whose requirements are complete and permanently skips lower levels' grants (marketSectors), because the loop condition is `corp.level < lvlNum` per level.**
  <br>Evidence: VERIFIED by reading 1055-1075. Concrete path: Earth lease (client offers Earth at Earth Station Prime, app.js:1667-1674) + extractor + mine 300 + NPC-sell 300 + tt-basic-extraction completes L3 without the L2 Mars lease; corp.level becomes 3 and L2's 'Logistics Services' sector is never appended. Impact is latent today because marketSectors has no consumer (grep: only app.js:876 default).
- **sev 3** · `projects/interstellar-settlement-protocol/data/milestones.json:88` — **Levels 8-10 are unreachable: stat:missionsCompleted, stat:ironSilicateAlloysManufactured, stat:beltMiningOperationsStarted, stat:cryoSilicateFoamSold, stat:hydratedFerricCompoundsSold, stat:carbonSilicateCompositesSold, stat:carboIronAlloysSold, stat:hydroCarbonEmulsionBaseSold have no writer.**
  <br>Evidence: VERIFIED: grep for `stats.` writers across server/ finds only index.js:3270-3271 (silicateSoldOnExchange in the NPC sell route). complete-mission (2456-2466) appends to corp.completedMissions but resolveMetric stat: (974-979) reads corp.stats[key] only. Also L3/L4 `stat:silicateSoldOnExchange` counts NPC sells only, not player-order fills (3100-3220 never touch stats).
- **sev 3** · `projects/interstellar-settlement-protocol/server/index.js:1123` — **After an office expires and is re-rented at the same station, corp.offices holds two entries; renew-office and the client both `.find` the first (expired) one, so the UI still shows 'expired' and Renew extends the stale entry.**
  <br>Evidence: VERIFIED: rent-office's already-rented check (1123) only blocks unexpired offices and always pushes a new record (1133-1144); nothing ever removes expired offices (grep rentedUntil: 1123, 1142, 1216, 1671). renew-office uses `corp.offices.find((o) => o.stationId === station.id)` (1204) and the client uses the same find (app.js:1362) then computes leaseExpired from it (1397-1398).
- **sev 3** · `projects/interstellar-settlement-protocol/server/index.js:1061` — **Payroll is never charged: hire adds 150/day to finances.dailyCosts but no code deducts dailyCosts from credits; the client promises 'adds 150/day to operational payroll'.**
  <br>Evidence: VERIFIED: grep dailyCosts|payroll across server/ finds writers only at index.js:1061 and defaults (gameState 1114, 1368); finances.js reads it purely for liabilities/snapshot projection (59-60, 110-119). Client copy at app.js:1448 and 4910 states the recurring cost.
- **sev 3** · `projects/interstellar-settlement-protocol/server/gameState.js:648` — **Mining records phantom revenue: 2.4 credits per mined unit is added to dailyRevenue and recordIncome('mining') without any credits being added, and it is the only income the ledger ever records.**
  <br>Evidence: VERIFIED: 648-650 `revenue = round(actualMined*2.4); corp.finances.dailyRevenue += revenue; recordIncome(corp, 'mining', revenue)` with no credits change; recordIncome (finances.js:33-41) only bumps incomeBySource/lifetimeRevenue. grep recordIncome|recordExpense finds calls only at gameState 638 and 650, so exchange sales, hires, offices, leases and builds never hit the ledger while the Financial Core's netFlow/lifetimeRevenue show mining income that never existed.
- **sev 3** · `projects/interstellar-settlement-protocol/server/index.js:2482` — **Office-expiry gating is inconsistent: only lease-scoped start-mining enforces an unexpired office; purchase-lease, the officeRented milestone and the legacy /gameplay/mine route accept expired or absent offices, and running cycles continue through expiry.**
  <br>Evidence: VERIFIED: start-mining checks rentedUntil > now (1666-1675); purchase-lease requires only offices.length > 0 (1265); resolveMetric stat:officeRented is offices.length > 0 (976); /gameplay/mine (2482-2558) has no office or lease check at all and is still a live authenticated route even though its UI binding is dead (bindLevel2Controls returns at app.js:4900 because index.html only has level2-requirements/level2-status at 326-328); applyMiningOperations never consults offices.
- **sev 4** · `projects/interstellar-settlement-protocol/server/gameState.js:563` — **Downtime recovery is effectively immediate after the 15-minute floor because lastTickAt is never advanced during downtime, so each 5 s tick rolls against the cumulative window (>=900 s => >=22% per tick).**
  <br>Evidence: VERIFIED by reading 549-578: lastTick = lastTickAt (563), elapsed = now - lastTick (565), tickProb = 1-(1-0.000276)^seconds (568), and lastTickAt is only written on recovery (575). With the 5 s miningTick (index.js:484) the expected wait after the floor is a few ticks, not the ~60 min the 0.0276%/s constant implies. Same root cause as the catch-up-window loss (lastTickAt not advanced on non-mining ticks).
- **sev 4** · `projects/interstellar-settlement-protocol/server/index.js:1621` — **The same building is valued inconsistently: lease build-extractor adds 36000 to assets, generic build-extractor adds 42000.**
  <br>Evidence: VERIFIED: ASSET_VALUE = 36000 at 1558 applied at 1621; `corp.finances.assets += 42000` at 1833.
- **sev 4** · `projects/interstellar-settlement-protocol/server/index.js:1074` — **Error copy mismatches: hire's insufficient-credits quotes count*2000 rather than the clamped hired*2000; lease build-extractor quotes BASE_BUILD_COST not the discounted buildCost; generic build-extractor says 'requires future corporation perks' but maxBasicExtractorYards is never raised.**
  <br>Evidence: VERIFIED: 1074 uses `count * 2000` while the charge at 1047 is `hired * 2000`; 1635 passes BASE_BUILD_COST while 1565 computed buildCost; 1777 reads corp.unlocks.maxBasicExtractorYards whose only writers are defaults (gameState 473, 1143) and the seed state.json.
- **sev 4** · `projects/interstellar-settlement-protocol/server/finances.js:64` — **Office lease commitments never appear in liabilities because computeLiveLiabilities expects office.leaseDailyCost/daysRemaining, which rent-office never sets.**
  <br>Evidence: VERIFIED: finances.js:62-69 reads leaseDailyCost and daysRemaining; rent-office pushes {stationId,name,body,systemId,tier,rentedAt,rentedUntil,durationDays} (index.js:1135-1144).
- **sev 4** · `projects/interstellar-settlement-protocol/server/gameState.js:1066` — **evaluateLevelProgress assumes corp.unlocks.maxFleetSize and corp.unlocks.marketSectors exist; a state missing them yields NaN (Math.max(undefined, 8)) or a TypeError on .includes.**
  <br>Evidence: INFERRED risk, expressions verified: node prints Math.max(undefined, 8) = NaN; ensureCorpMiningModel (469-474) only guarantees unlocks.maxBasicExtractorYards. Starter state (1139-1144) and normalized-table hydration (unlocksRepo.js:23, setsRepo.js:40) do set both, so only hand-edited or partial state_json rows are exposed; evaluateLevelProgress runs on every hydrated account at 1701.
- **sev 4** · `projects/interstellar-settlement-protocol/server/index.js:1092` — **rent-office, renew-office and purchase-lease do not check that the player is docked at the target station/body; the server accepts any stationId or body while only the client restricts to the current station.**
  <br>Evidence: VERIFIED: rent-office looks up any station in stations.json (1108-1114) with no comparison to corp.currentStationId; purchase-lease has no location check (1262-1304); client sends the docked station (app.js:1473-1484) and filters lease bodies by stationBody (1674).
- **sev 4** · `projects/interstellar-settlement-protocol/server/index.js:470` — **Each 5 s mining tick runs applyMiningOperations three times per account and rebuilds every extractor object four times (mutateAccountState wraps the ticker's own call).**
  <br>Evidence: VERIFIED: miningTick calls applyMiningOperations inside the mutator (472); mutateAccountState calls it before (2586) and after (2588) plus ensureCorpMiningModel again (2590); each applyMiningOperations calls ensureCorpMiningModel (540) which maps extractors to new objects (413-450). Also means three downtime rolls per tick (the two extra have ~0 ms windows so are negligible).

### Test coverage, and what it does not cover

Ran `npx vitest run tests/unit/applyMiningOperations.test.js tests/schema/data-files.test.js`: 38 pass, 1 fails on current main (tests/schema/data-files.test.js:224 expects data/state.json to have chatLog; it does not) — unrelated to this subsystem but the suite is red before any v0.5 change. tests/unit/applyMiningOperations.test.js (11 tests, all pass, uses tests/fixtures/makeCorp.js and pins Math.random) covers: inactive extractor no-op; normal mining deposits Silicates at BODY_TO_STATION[lease.body] (Earth -> earth-station-prime); tt-basic-extraction +10% and stacking with tt-supply-forecast +6%; op-cost deduction and totalSpent; affordability scaling with stop on underfunding; minedRemainder fractional carry; downtime trigger; 15-minute floor; recovery; tt-industrial-safety reducing the roll. NOT covered in the mining model: normal cycle end at endsAt via stopExtractorCycle (592-595, 656-658), the catch-up-window loss when a downtime roll hits a long gap, recovery-window compounding, legacy silicateExtractor migration (370-388), building->extractor backfill (390-411), leaseId/body/extractorIds re-linking (486-528), deposit fallback when the lease body has no station (644), and the phantom 'mining' ledger income (648-650). tests/schema/data-files.test.js:187-217 checks milestones.json shape only (levels array, requirement id/title/metric/target, unique ids) — it does not check that every metric string is one resolveMetric understands, that roadmap titles match requirement titles, or that unlocks are monotonic. tests/unit/phase2Repositories.test.js maps offices/leases/extractors to DB rows and back; tests/unit/phase1Repositories.test.js maps milestonesCompleted rows — neither exercises the routes. There are NO HTTP tests for hire, rent-office, renew-office, purchase-lease, transfer-resources, travel, lease/build-extractor, lease/start-mining, build-extractor or mine (tests/integration/auth.test.js hits only /api/auth/*, /api/bootstrap, /api/stations, /api/buildings, /api/dev/set-credits), and resolveMetric / evaluateLevelProgress have zero tests. tests/helpers/api.js (registerAccount, authed) plus ISP_DISABLE_TICKERS=1 and VERCEL=1 in tests/setup.js already make supertest route tests straightforward.

### Before you touch this in v0.5

- Auth on the station routes is the single router-level `app.use("/api/accounts/:accountId", requireAuth, requireAccountAccess)` at index.js:958 — anything registered under that prefix is protected automatically; /api/market and /api/forums add requireAuth explicitly and /api/dev/set-credits (869) has none. Do not add per-route auth that double-checks.
- mutateAccountState (gameState.js:2580) is the only legitimate mutation path and it re-runs applyMiningOperations before and after your mutator, then evaluateLevelProgress; ensureCorpMiningModel rebuilds every extractor object on each call, so any extractor reference captured across a call is stale (the unit test at applyMiningOperations.test.js:189-190 documents this). GET /api/accounts/:id also mutates via getAccountById (2090).
- Two extractor route families coexist: lease-scoped (1555, 1654; used by the UI at app.js:1961/2022) and legacy generic (1767, 2482; UI bindings dead because index.html lacks the level2 form ids, yet the routes are live and /gameplay/mine bypasses office and lease gating). Decide whether to delete or gate the legacy pair before the beta; the walkthrough and Level-2 progress panel (renderLevel2Progress app.js:2829) still read levelProgress from this model.
- All economy numbers are inline in routes and duplicated: hire 2000/150 (1047, 1061), office 1000/day (1096, 1179), lease table (1256), extractor 50000 (1557, 1780), the throughput->op-cost->startup formula (1711-1715, 2493-2495, and defaults in ensureCorpMiningModel 423-424), downtime constants (555, 566, 599), mining revenue 2.4/unit (648). stations.json has an officeCost field the server never reads (the client fallback at app.js:1492 does). Centralise before rebalancing.
- Numeric body parsing is unguarded everywhere (no Number.isFinite); a single parse helper that rejects non-finite/non-integer input closes the NaN exploit in hire, mine and transfer-resources at once, and start-mining hours (1657) needs it too.
- The ledger (recordIncome/recordExpense in finances.js) is only fed by mining (gameState 638, 650); hires, offices, leases, builds, cycle startup costs and exchange sales bypass it, and mining's 'income' is phantom. If the Financial Core is part of the beta, route every credit change through one helper.
- Milestones: data/milestones.json is the server's single source (MILESTONE_LEVELS), but the client hard-codes MILESTONE_ROADMAP (app.js:3191) and REQ_TAB (2841), and MILESTONE_ROADMAP in gameState.js:100 is unused/unexported. resolveMetric returns 0 for any unknown metric, so a typo in milestones.json silently makes a level unreachable — add a schema test that every metric prefix is handled and every stat:* key has a writer. Level grants use Math.max and buildingSlots is also += 2 per lease (1303), so level slot grants are mostly no-ops; level-ups are not sequential (1055-1075).
- Office expiry has no ticker, no notification and no cleanup; expired records accumulate in corp.offices and the first-match `.find` (1204, app.js:1362) picks the stale one. If offices matter for the beta, either dedupe on re-rent (extend in place) or index by stationId.
- Timing for playtests: mining cycles are real hours even in dev (endsAt = now + hours*3600000 at 1727; only travel has an IS_DEV shortcut at 1490). 'Mine 300 Silicate' at the 250/h cap takes >1.1 h wall-clock; the 5 s miningTick and the 5 s local-travel dev shortcut are the only fast paths. Downtime (0.005%/s) will interrupt a 24 h cycle with ~99% probability, and any server restart risks the catch-up-window loss described in the defects.
- Socket events are global broadcasts (no rooms, index.js:3395-3419); before hosting on Azure with real players, join sockets to a per-account room and emit mining:updated / notifications:new with io.to(accountId).
- The known-defect list already covers probes/maxFleetSize, walkthrough copy drift and Vercel inertness; the items above are additional. The data-files schema test is red on main (state.json lacks chatLog), so `npm test` will fail before you touch anything — file it or fix it first so the pre-commit check is meaningful.

---

<a id="server-market-finance"></a>

## server-market-finance

**Scope.** MARKET, EXCHANGE and FINANCE (server): order book, NPC standing buy orders, trade history, price data, market:updated / finance:updated emits, server/finances.js ledgers and snapshots, credits/assets/liabilities, direct investments

The exchange is three express routes in server/index.js: POST /api/market/orders (sell-only listings; inventory is debited at the seller's current station and the order is unshifted onto the global state.market.orderBook), POST /api/market/orders/:orderId/buy (buyer pays, seller is credited minus the exchange sales tax, order quantity decremented) and POST /api/market/npc-orders/:orderId/sell (sell into a seeded NPC standing bid with a daily quota reset by checkAndResetNpcBuyOrders on startup and every 60s). Every route ends with io.emit("market:updated", getState().market) to all sockets; the market also rides on GET /api/bootstrap and the socket "state:init" payload. There is no server-side price data: the client derives a weighted average from orderBook + npcBuyOrders + tradeHistory (app.js:925). Finance is per-corp on corp.finances: credits/assets are mutated inline by ~20 gameplay routes; dailyCosts is only ever incremented by hiring (index.js:1061) and dailyRevenue by mining (gameState.js:649, at a phantom 2.4/unit) and sales (proceeds/24); the pure helpers in server/finances.js (recordIncome/recordExpense/computeLiveLiabilities/buildSnapshot/pushSnapshot) are imported by gameState.js for mining only and by index.js for a 30s financialSnapshotTick that pushes a 60-entry rolling snapshot per corp and broadcasts each corp's finances to every socket. getEffectiveExchangeTaxRate (gameState.js:946) is 8% minus 2% per completed ceo-negotiation-fundamentals insight. POST /api/investments (level >= DIRECT_INVESTMENT_UNLOCK_LEVEL = 2) deducts credits into corp.investments[], which nothing reads, pays out, persists in normalized mode, or calls from the client. Persistence: global state.market is only ever written to the gitignored data/state.json (never to Supabase); per-corp finances go to Supabase as a full state_json blob, or in USE_NORMALIZED_TABLES mode to corp_finances (subset of fields) and corp_trade_history (subset of fields). Verified by reading the files, running the vitest suite (138 pass / 1 fail baseline) and inspecting the live data/state.json market keys with node; nothing was modified.

### Entry points

- `POST /api/market/orders (list sell order)` — `server/index.js:3029` — requireAuth; rejects type !== "sell" (3038); debits station inventory (3047-3073), records a "listed" tradeHistory entry, unshifts order onto draft.market.orderBook and truncates to 200 (3091-3094), emits market:updated (3096)
- `POST /api/market/orders/:orderId/buy` — `server/index.js:3100` — requireAuth; own-order rejection by sellerAccountId or identity (3123-3132); buyer pays and receives goods (3138-3162); seller credited minus getEffectiveExchangeTaxRate only if order.sellerAccountId (3169-3193); order quantity decremented / removed (3195-3204); emits market:updated (3206)
- `POST /api/market/npc-orders/:orderId/sell` — `server/index.js:3221` — requireAuth; calls checkAndResetNpcBuyOrders (3225); floors quantity (3223); validates remainingQty; debits inventory, applies tax, credits seller, bumps stats.silicateSoldOnExchange for any item (3271), records "sold-npc" trade; decrements remainingQty (3295-3300); emits market:updated (3302)
- `POST /api/investments` — `server/index.js:3310` — requireAuth; gated by corp.level >= DIRECT_INVESTMENT_UNLOCK_LEVEL (282, =2); pushes {targetCorp, amount, instrument} onto corp.investments and subtracts amount from credits (3342-3347); emits finance:updated to all sockets (3355). No client caller.
- `POST /api/dev/set-credits` — `server/index.js:869` — Sets any account's finances.credits; guarded only by the hardcoded ALLOW_DUMMY_AUTH (known defect); not under requireAuth
- `checkAndResetNpcBuyOrders` — `server/index.js:442` — Resets remainingQty = totalQtyPerDay for orders whose lastResetDate != today (America/New_York); early-returns with no emit when nothing changed (445); run at startup (459) and every 60s unless ISP_DISABLE_TICKERS (460)
- `financialSnapshotTick` — `server/index.js:778` — Every 30s (776, 797) for every account: buildSnapshot + pushSnapshot into corp.finances.snapshots (max 60), then io.emit("finance:updated", finances) to ALL sockets with no accountId (791)
- `GET /api/bootstrap and socket state:init` — `server/index.js:802` — Both return getState() (global state including market.orderBook/npcBuyOrders and the legacy seed corp); state:init at 3396 goes to any socket with no auth middleware (no io.use; cors origin "*" at 384-388)
- `NPC buy-order seed (inside ensureStateFile)` — `server/gameState.js:1485` — NPC_BUY_SEED (1487-1494: Silicates 24, Helium-3 92, Nickel 18, Titanium 64, Carbon 12, Rare Earths 140) is added to normalized.market.npcBuyOrders only on the existing-file branch (1478-1516); the fresh-install branch (1470-1476) returns the seed with no market at all (known defect)
- `getEffectiveExchangeTaxRate` — `server/gameState.js:946` — BASE_EXCHANGE_SALES_TAX_PCT 8 (944) minus 2 per ceo-negotiation-fundamentals completion capped at maxLevels; reconciled onto finances.exchangeSalesTaxPct in normalizeStateShape (340) and after insight completion (index.js:744)
- `applyMiningOperations finance side-effects` — `server/gameState.js:635` — Deducts operating cost from credits and recordExpense("mining-ops") (636-638); on mined ore adds actualMined*2.4 to dailyRevenue and recordIncome("mining") with no credits moving (648-650). Runs before and after every mutateAccountState (2586, 2588)
- `server/finances.js helpers` — `server/finances.js:15` — ensureFinanceTracking (15), recordIncome (33), recordExpense (43), computeLiveLiabilities (57: dailyCosts*7 + office.leaseDailyCost*daysRemaining), computeAssetBreakdown (82: flat 2 cr/unit inventory estimate, unused by server), buildSnapshot (106: netWorth = credits+assets-liabilities), pushSnapshot (124, MAX_SNAPSHOTS 60)
- `Starter corp finances default` — `server/gameState.js:1108` — credits 250000, liabilities 0, assets 0, dailyRevenue/dailyCosts 0, taxRatePct 14, bondYieldPct 0, exchangeSalesTaxPct 8, lifetime*/incomeBySource/expensesByCategory/snapshots; investments [] (1145), tradeHistory [] (1150)
- `normalizeStateShape finance init` — `server/gameState.js:313` — Ensures tradeHistory [] (313), finances {} + ensureFinanceTracking (333-334), reconciles exchangeSalesTaxPct (340). Does NOT initialise market.orderBook, chatLog or forums anywhere (grep 226-420)
- `resetDummyAccountProgress orderBook strip` — `server/gameState.js:2569` — Filters the dummy account's sell orders out of state.market.orderBook (guards with || [])
- `financeRepo mapAccountToFinanceRow / applyFinanceRowToAccount` — `server/db/repositories/financeRepo.js:9` — Normalized-mode corp_finances row: credits, liabilities, assets, daily_revenue, daily_costs, liquidity*, tax_rate_pct, bond_yield_pct, exchange_sales_tax_pct only
- `mapAccountToTradeHistoryRows / overlay` — `server/db/repositories/operationsRepo.js:184` — corp_trade_history rows: id, type, item, quantity, unit_price, total, counterparty, at (drops taxPct/taxAmount/proceeds); overlay at 449-463
- `Client: computeAverageMarketPrice` — `public/scripts/app.js:925` — Only price-data mechanism: weighted avg of orderBook (w1), npcBuyOrders (w5), last 50 tradeHistory (w1), floored at best NPC bid
- `Client: renderFinanceDashboard` — `public/scripts/app.js:2661` — KPIs from finances: netWorth uses latest snapshot liabilities or dailyCosts*7; runway = credits/dailyCosts (2685); P&L table from incomeBySource/expensesByCategory/lifetime* (2708-2743)
- `Client: socket market:updated / finance:updated / finance:snapshot handlers` — `public/scripts/app.js:5889` — market:updated replaces appState.data.market and re-renders (5889-5896); finance:updated applied only when profileMode === "dummy" (5911-5920); finance:snapshot bound twice (5922, 5931) and never emitted by the server
- `Client: listing / buy / NPC-sell submit handlers` — `public/scripts/app.js:5355` — POST /api/market/orders (5355), /api/market/orders/:id/buy (5755), /api/market/npc-orders/:id/sell (5825); My Active Listings table has no action column (3926-3937)

### State this subsystem reads or writes

- `state.market.orderBook[] ({id, type:"sell", item, quantity, unitPrice, seller, sellerAccountId, createdAt}) — global, disk-only, never initialised by server code`
- `state.market.npcBuyOrders[] ({id, item, buyer, unitPrice, totalQtyPerDay, remainingQty, lastResetDate}) — global, seeded in ensureStateFile existing-file branch only`
- `corp.finances.credits`
- `corp.finances.assets (incremented by build-extractor, build-assembly-facility, build-refinery, probe fabrication; never decremented)`
- `corp.finances.liabilities (persisted field, always 0; buildSnapshot ignores it and computes live)`
- `corp.finances.dailyRevenue (lifetime accumulator: mined*2.4 + saleProceeds/24; never reset)`
- `corp.finances.dailyCosts (lifetime accumulator: hires*150 only; never reset)`
- `corp.finances.taxRatePct (14, unused)`
- `corp.finances.bondYieldPct (0, vestigial)`
- `corp.finances.exchangeSalesTaxPct (derived from completedInsights)`
- `corp.finances.lifetimeRevenue / lifetimeCosts`
- `corp.finances.incomeBySource (only ever "mining")`
- `corp.finances.expensesByCategory (only ever "mining-ops")`
- `corp.finances.snapshots[] ({t, credits, assets, liabilities, dailyRevenue, dailyCosts, netFlow, netWorth}, max 60)`
- `corp.finances.liquidity / liquidityCap / liquidityRegenPerHour / lastLiquidityTick (repo-only, reserved)`
- `corp.tradeHistory[] ({id, type: listed|bought|sold|sold-npc, item, quantity, unitPrice, total, taxPct?, taxAmount?, proceeds?, counterparty, at}, cap 200)`
- `corp.investments[] ({id, targetCorp, amount, instrument, createdAt})`
- `corp.stats.silicateSoldOnExchange (only stat ever written; milestone metric)`
- `corp.credits (stray field written only by complete-mission at index.js:2445 and app.js:5703)`
- `corp.inventory[stationId][item] (traded at corp.currentStationId)`
- `corp.currentStationId`
- `corp.offices[] ({stationId, name, body, systemId, tier, rentedAt, rentedUntil, durationDays}) — read by computeLiveLiabilities for leaseDailyCost/daysRemaining which are never set`
- `corp.completedInsights[] (tax rate input)`
- `corp.level (investment gate)`
- `corp.corporationName / account.email (order.seller identity fallback)`
- `corp.mining.silicateExtractors[].operationCostPerHour / totalSpent / totalMined / minedRemainder`
- `Supabase: account_state.state_json (blob), corp_finances, corp_trade_history, corp_finance_snapshots (table exists, no writer)`

### TODOs in this code

- `server/finances.js:80` — TODO: Save a snapshot of financial data every x minutes to Supabase
- `server/gameState.js:943` — TODO: Should this be hardcoded? Or should we store it in the database? (BASE_EXCHANGE_SALES_TAX_PCT)
- `server/gameState.js:1486` — TODO: Reevaluate how we are storing the below information. Should it be hardcoded? Should it be more dynamic? (NPC_BUY_SEED)
- `server/index.js:1255` — TODO: Should we be storing the lease costs here? And why are we only specifying for Earth, Mars, and Luna?
- `server/index.js:500` — TODO: Consider implementation of unified tick system where all tick based actions are performed at once, rather than a separate ticker calculation
- `server/index.js:800` — TODO: Consider moving API to a dedicated api.js file
- `server/gameState.js:1587` — TODO: Evaluate below account persistance functionality. We are frequently having connection issues which trigger the below errors.
- `server/gameState.js:1615` — TODO: Remove all local disk account snapshots. All operations should go through the DB
- `public/scripts/app.js:2781` — function updateInvestmentPanel() { /* removed: direct investment panel deprecated */ } (stub; /api/investments has no caller)

### Suspected defects (candidates — unverified, not filed)

- **sev 1** · `server/index.js:3347` — **POST /api/investments mints credits when amount is negative: any authenticated corp at level >= 2 can POST {targetCorp:"x", instrument:"y", amount:-1000000} and gain 1,000,000 credits.**
  <br>Evidence: Validation is `if (!targetCorp || !amount || !instrument)` (3313) — a negative number is truthy; `spend = Number(amount)` (3330); `if (draft.corp.finances.credits < spend)` (3337) is false for negative spend; `draft.corp.finances.credits -= spend` (3347) therefore adds. targetCorp and instrument are never validated against anything, corp.investments is never read or paid out (grep: only 1145, 3342-3346), the client has no caller (app.js:2781 stub, grep shows no /api/investments in public/). Verified by code reading; not executed against a server.
- **sev 2** · `server/index.js:3092` — **POST /api/market/orders throws TypeError (500) on every state.json this codebase can produce, after the seller's inventory has already been debited — so the first player listing destroys the goods. Distinct from filed #425 (200-cap truncation).**
  <br>Evidence: getSeedState (gameState.js:1318-1463) has no `market` key; ensureStateFile only adds `market = {}` + npcBuyOrders on the existing-file branch (1485-1511) and never orderBook; normalizeStateShape has no market handling (grep 226-420); data/state.json is gitignored (.gitignore) and the live file's market keys are exactly ['npcBuyOrders'] (verified with node). Route debits inventory via mutateAccountState at 3047-3073, then `draft.market.orderBook.unshift(order)` at 3092 with no guard → caught by the 500 handler at 3390. Client reaches it at app.js:5355. tests/helpers/reset.js:11 sets orderBook = [] but no test even imports it, so nothing catches this.
- **sev 2** · `server/index.js:2445` — **Mission reward credits are written to `state.corp.credits`, a field nothing else reads, instead of `state.corp.finances.credits`; the player never receives the reward while the UI says it was credited.**
  <br>Evidence: `state.corp.credits = (state.corp.credits || 0) + rewardCredits;` (2445). Every other balance read/write in the repo uses finances.credits (grep `credits -=|credits +=`). The client mirrors the same wrong field at app.js:5703 and then shows `${mission.reward} credited.` (5707).
- **sev 2** · `server/index.js:791` — **finance:updated broadcasts every corporation's full finances (credits, snapshots, incomeBySource) to every connected socket — including unauthenticated ones — with no accountId; the dummy-mode client overwrites its own dashboard with whichever corp was emitted last, and account-mode clients never live-refresh at all.**
  <br>Evidence: financialSnapshotTick loops getAllAccountIds() and does `io.emit("finance:updated", finances)` per account (780-792); /api/investments does the same (3355). No `io.use(` socket auth exists (grep), cors origin is "*" (384-388), and state:init hands the whole global state to any socket (3396). Client handler applies the payload only when `appState.profileMode === "dummy"` and replaces `appState.data.corp.finances` wholesale (app.js:5911-5920).
- **sev 2** · `server/index.js:3271` — **Exchange milestone accounting is wrong: selling any item to an NPC order increments `silicateSoldOnExchange`, selling silicates to another player increments nothing, and the level 7-8 sell milestones reference stats no code writes and products no refinery produces.**
  <br>Evidence: `state.corp.stats.silicateSoldOnExchange += requestedQty` (3271) runs regardless of npcOrder.item; the p2p seller branch (3169-3193) touches no stats. milestones.json:33 and :49 use `stat:silicateSoldOnExchange`. grep shows silicateSoldOnExchange is the only stats key ever written on the server; cryoSilicateFoamSold, hydratedFerricCompoundsSold, carbonSilicateCompositesSold, carboIronAlloysSold, hydroCarbonEmulsionBaseSold (milestones.json:119-120,136-138) have zero server references, and refinery-chains.json outputs are Aerogel, Quantum Insulators, Plasma Conduits, etc. — none of those product names. NPC_BUY_SEED (gameState.js:1487-1494) has raw resources only, so refined goods can only be sold p2p, which records nothing.
- **sev 2** · `server/gameState.js:648` — **Revenue is booked when ore is mined, not when it is sold: dailyRevenue and incomeBySource.mining grow by actualMined*2.4 with no credits moving, then real sales add proceeds/24 to dailyRevenue without any recordIncome — so Lifetime Revenue and the Sector Exposure pie are fiction and exchange income never appears in incomeBySource.**
  <br>Evidence: `const revenue = Math.round(actualMined * 2.4); corp.finances.dailyRevenue += revenue; recordIncome(corp, "mining", revenue);` (648-650) inside the mining tick; the NPC peg for Silicates is 24 (1488). Sale paths do `dailyRevenue += Math.round(sellerProceeds / 24)` (index.js:3175, 3268) and never call recordIncome (grep: recordIncome only at gameState.js:650). Client renders lifetimeRevenue and incomeBySource at app.js:2708-2743 and charts.js:277.
- **sev 3** · `server/index.js:1061` — **dailyCosts is a lifetime hire counter (hired*150, never reduced, never reset) and ignores the dominant burn (extractor operationCostPerHour, min 600/h), so Runway, Net Flow and the 7-day liability figure are all misleading; recordExpense is only called for mining-ops so lifetimeCosts/expensesByCategory omit hires, offices, leases, buildings, R&D, exchange tax and investments.**
  <br>Evidence: Only writer of dailyCosts is `corp.finances.dailyCosts += hired * 150` (1061; grep). start-mining sets operationCostPerHour = max(600, throughput*16) (1713-1714, 1729) and touches no daily figure; recordExpense appears only at gameState.js:638. Client: runway = credits/dailyCosts (app.js:2685), liabilities fallback dailyCosts*7 (2670, finances.js:60). DEPTH.md:109 quotes the real burn at ~96,000/day.
- **sev 3** · `server/finances.js:64` — **computeLiveLiabilities reads office.leaseDailyCost and office.daysRemaining, fields no producer ever sets, so office lease liabilities are always 0; the unit tests pass only because their fixtures invent those fields. The Supabase net_worth column also disagrees with buildSnapshot.**
  <br>Evidence: rent-office writes {stationId, name, body, systemId, tier, rentedAt, rentedUntil, durationDays} (index.js:1135-1144); grep for leaseDailyCost|daysRemaining across server/public hits only finances.js:64-66 and tests/unit/finances.test.js:120-121,131,191. DESIGN_DOCUMENT.md:95 still says liabilities are "always 0 (not yet tracked)". supabase_migration.sql:118 defines net_worth as `assets - liabilities` while buildSnapshot uses credits + assets - liabilities (finances.js:120).
- **sev 3** · `server/index.js:3056` — **There is no way to cancel or withdraw a sell listing: inventory is debited at listing time and no route or UI action returns it, so a mis-priced listing locks the goods until someone buys them or the 200-cap (#425) deletes them.**
  <br>Evidence: Route table (grep app.get/post/delete) has no cancel/delete under /api/market; the My Active Listings rows render item/quantity/price/time with no action cell (app.js:3926-3937); grep for cancel|withdraw|delist in app.js finds only login/forum/trade-confirm buttons. README.md:61 promises "manage your open sell orders".
- **sev 3** · `server/index.js:3102` — **The p2p buy path accepts NaN and fractional quantities (and the listing path accepts a NaN unitPrice), corrupting the buyer's credits, inventory and the order's remaining quantity to NaN. #425 documents the NaN hole only for the listing quantity.**
  <br>Evidence: `Math.max(1, Number(req.body?.quantity || 1))` (3102) yields NaN for "abc"; `requestedQty > order.quantity` (3118) and `credits < tradeTotal` (3140) are both false for NaN; then `credits -= tradeTotal` (3145), `buyerInv[item] += tradeQuantity` (3148) and `target.quantity = Math.max(0, qty - NaN)` (3200) all become NaN. No Math.floor, unlike the NPC path (3223). Listing unitPrice: `Math.max(1, Number(unitPrice))` (3044) with only a truthiness check at 3038.
- **sev 3** · `server/db/repositories/financeRepo.js:9` — **In USE_NORMALIZED_TABLES mode the finance ledgers are not persisted: incomeBySource, expensesByCategory, snapshots, lifetimeRevenue/lifetimeCosts are dropped; corp_finance_snapshots exists in the migration but has no writer; investments have no table; trade rows lose taxPct/taxAmount/proceeds.**
  <br>Evidence: mapAccountToFinanceRow maps only credits/liabilities/assets/daily_*/liquidity*/tax pcts (9-25); grep for corp_finance_snapshots in server/ finds nothing; migration defines it at supabase_migration.sql:109-121; grep investments in server/db finds nothing; mapAccountToTradeHistoryRows (operationsRepo.js:188-198) and overlay (453-462) omit tax fields. The default blob path stores the full state_json (gameState.js:1564-1568), so this only bites after the normalized cutover.
- **sev 4** · `server/index.js:3169` — **When an order has no sellerAccountId (legacy identity-matched listings) or the seller account no longer exists, the buyer pays and the order is consumed but nobody is credited — the proceeds vanish.**
  <br>Evidence: Seller credit is wrapped in `if (order.sellerAccountId)` (3169); the identity fallback at 3127 only prevents self-purchase; mutateAccountState returns null for a missing account (gameState.js:2580-2584) and the route ignores that return (3170).
- **sev 4** · `server/index.js:3063` — **Trade and order ids are `th-${Date.now()}` / `ord-${Date.now()}`; corp_trade_history.id is a global primary key, so two corps trading in the same millisecond collide in normalized mode, and two listings in one ms share an order id.**
  <br>Evidence: Ids built at 3063, 3081, 3152, 3179 (+1), 3275; `id text primary key` at supabase_migration.sql:282; replaceRowsByColumn upserts per corp (operationsRepo.js:692).
- **sev 4** · `public/scripts/app.js:5922` — **Dead client wiring: finance:snapshot is bound twice and the server never emits it; finance:updated is ignored outside dummy mode.**
  <br>Evidence: socket.on("finance:snapshot") at 5922 and 5931; grep finance:snapshot in server/ returns nothing; 5912 gates on profileMode === "dummy".
- **sev 4** · `DESIGN_DOCUMENT.md:169` — **Design/phase docs describe market and finance features that do not exist in code: routes /gameplay/sell and /gameplay/buy-npc, fields finances.cashflowHistory[]/creditsHistory[], and a completed order-matching engine with player buy orders and NPC sell orders.**
  <br>Evidence: DESIGN_DOCUMENT.md:169-170 vs actual routes index.js:3029/3221; DESIGN_DOCUMENT.md:266,269 and DEVELOPMENT_PHASES.md:62,65 vs actual finances.snapshots (finances.js:126); DEVELOPMENT_PHASES.md:30-32 marked [x] while index.js:3038 rejects any type !== "sell", NPC_BUY_SEED (gameState.js:1487-1494) contains buy orders only, and Todos.md:40 still lists the matching engine as open.
- **sev 4** · `tests/schema/data-files.test.js:219` — **A schema test asserts on the gitignored, runtime-mutated data/state.json and currently fails in the baseline run (chatLog undefined); its `market` assertion only passes because a local dev file exists.**
  <br>Evidence: `npx vitest run`: 1 failed / 138 passed, failure at data-files.test.js:224; .gitignore lists data/state.json; live file top keys are world, corp, queues, missions, combatReports, playerProfile, market (node inspection).

### Test coverage, and what it does not cover

Baseline `npx vitest run`: 12 files, 139 tests, 138 pass, 1 fail (tests/schema/data-files.test.js:224, chatLog on gitignored data/state.json). Covered: server/finances.js pure helpers in full (tests/unit/finances.test.js — ensureFinanceTracking, recordIncome/Expense rounding and buckets, computeLiveLiabilities on invented leaseDailyCost/daysRemaining fixtures, computeAssetBreakdown, buildSnapshot, pushSnapshot cap); getEffectiveExchangeTaxRate (tests/unit/getEffectiveExchangeTaxRate.test.js, 5 cases); financeRepo row mapping and round-trip of the mapped subset (tests/unit/phase1Repositories.test.js:97-108, 177-185); tradeHistory row mapping/overlay (tests/unit/phase3Repositories.test.js:117-128, 393-404); applyMiningOperations credit deduction and affordability (tests/unit/applyMiningOperations.test.js) but it asserts nothing about dailyRevenue/incomeBySource; POST /api/dev/set-credits and `bootstrap.market` being defined (tests/integration/auth.test.js:210-216, 234-260). NOT covered at all: POST /api/market/orders, /api/market/orders/:id/buy, /api/market/npc-orders/:id/sell, /api/investments (grep of tests/ for these paths returns nothing); checkAndResetNpcBuyOrders and financialSnapshotTick (exported at index.js:3447-3448 but never imported by a test); tax application on sales; NPC remainingQty decrement and quota errors; own-order rejection; market:updated / finance:updated emits; the mission-reward credit path; the milestone stat increment. tests/helpers/reset.js exports resetMarketState (which papers over the missing orderBook) but no test imports it. Setup forces VERCEL=1 and ISP_DISABLE_TICKERS=1 (tests/setup.js:20,26), so the ensureStateFile fresh-vs-existing branch and ticker behaviour are never exercised.

### Before you touch this in v0.5

- Fix the credit-minting hole in /api/investments first (or remove the route until the v0.9 financial-markets layer exists): validate amount > 0 and finite, validate targetCorp against real accounts, and gate instrument to a known set. Nothing on the client calls it today (app.js:2781 is a stub).
- Initialise state.market = { orderBook: [], npcBuyOrders: [] } (and chatLog/forums, which share the same seed gap) inside normalizeStateShape rather than only on the existing-file branch of ensureStateFile; that single change fixes both the known fresh-install NPC seeding defect and the orderBook TypeError. Add a supertest that lists, buys and NPC-sells on a freshly seeded state without tests/helpers/reset.js pre-creating orderBook.
- Global state.market is only ever written to data/state.json via scheduleSave (gameState.js:1820-1833) and is skipped when IS_SERVERLESS; the Supabase code path persists only per-account rows (tables touched: accounts, account_state, plus the normalized corp_* tables). Moving to Azure App Service (long-running Node) makes the disk file work again, but a multi-instance or restart-safe deployment needs a world/market table.
- Decide what dailyRevenue/dailyCosts mean. Today both are lifetime accumulators with mixed units (mined*2.4, proceeds/24, hires*150) and are never reset; the Financial Core KPIs, runway and the 7-day liability figure are derived from them. A clean model: a rolling 24h window computed from tradeHistory + expense ledger, or a true per-day tick that resets them.
- Route every credits mutation through recordExpense/recordIncome (or a single debit/credit helper that does it) so lifetimeCosts, expensesByCategory and incomeBySource stop lying; remove the mined*2.4 phantom revenue at gameState.js:648-650 and book income at sale time with a source of "exchange" / "npc-exchange" and the tax as an expense.
- Mission rewards: change index.js:2445 and app.js:5703 to finances.credits and add a regression test; the walkthrough's first contract (Silicate Requisition Order, 12,000 credits) currently pays nothing.
- Milestone sell stats: record per-item sold quantities on both the NPC and p2p sell paths (e.g. stats.soldByItem[item]) and either rewrite milestones.json levels 7-8 to reference real refinery outputs (Aerogel, Quantum Insulators, Plasma Conduits, ...) or add NPC buy orders for refined goods; otherwise those levels are unreachable.
- Scope finance:updated to the owning account (socket rooms keyed by accountId after a socket auth handshake, or drop the broadcast and let the client re-fetch); do not broadcast other corps' credits and snapshots, and remove the dummy-only gate in app.js:5911.
- Add a cancel-listing route that returns the remaining quantity to the seller's current-station inventory (and decide what happens if the seller has travelled since listing — orders carry no station today).
- Harden numeric input on all three market routes the way the NPC path already does (Number.isFinite + Math.floor + > 0); #425 covers listing quantity only.
- Office liabilities: either set leaseDailyCost/daysRemaining when renting/renewing (rent-office 1092, renew-office 1175) or compute them in computeLiveLiabilities from rentedUntil/durationDays; then fix the unit-test fixtures to use the real office shape.
- If the normalized-tables cutover proceeds, extend financeRepo to carry incomeBySource/expensesByCategory/lifetime* (jsonb) and write corp_finance_snapshots from financialSnapshotTick (the TODO at finances.js:80); add corp_investments if investments survive; make trade ids corp-scoped or uuid.
- The client's only price signal is computeAverageMarketPrice (app.js:925); BRIEF.md:57 and DEVELOPMENT_PHASES.md:77 want price history, which needs a server-side per-item trade tape independent of any one corp's 200-entry tradeHistory.
- Docs to correct once code settles: DESIGN_DOCUMENT.md:92-98 (finances shape), :169-170 (routes), :260-271 (chart fields); DEVELOPMENT_PHASES.md:30-32 (matching engine / NPC sell orders claimed done), :62-65 (field names); README.md:61 (manage listings).
- Known and not re-reported here: standing buy orders GET/emit gap, fresh-install NPC seed, #425 (200-cap truncation and listing NaN quantity), ALLOW_DUMMY_AUTH, Vercel-inert tickers/persistence, Mercenary Rentals panel.

---

<a id="server-industry-travel"></a>

## server-industry-travel

**Scope.** INDUSTRY and MOVEMENT (server): refinery chains, asteroid mining and probes, R&D, CEO Insight, travel, transfer-resources/logistics

All industry and movement logic lives in two files: pure state functions in server/gameState.js (applyRefineryOperations at :705, applyAsteroidExpeditions at :850, the ensure*Model normalizers, catalog loading) and six independent setInterval tickers plus the POST routes in server/index.js. Tickers (each guarded by ISP_DISABLE_TICKERS) walk every account through mutateAccountState: refineryTick 10s (:486), asteroidExpeditionTick 10s (:502), fabricationTick 5s (:572), travelTick 5s (:607), processRndCompletions 5s (:668), processCeoInsightCompletions 5s (:717). Routes debit corp.finances.credits directly and push queue entries; completion tickers push unlockedTech/completedInsights, emit rnd:completed / ceo:completed / expedition:completed / fabrication:completed / travel:arrived and add notifications, except refineryTick which emits nothing. Catalogs: refinery-chains.json, ceo-insight.json, stations.json and systems.json are read by gameState.js at module load (:34, :103, :111, :114); research.json is NOT read by the server at all, the server truth is the hardcoded RESEARCH_LIBRARY at index.js:55 (verified identical to research.json today, 13/13 nodes, plus a third copy in public/scripts/app.js:67). Travel gating uses the hardcoded SYSTEM_DETAILS (gameState.js:133) and NEAR_STAR_SYSTEMS (index.js:275); travel time comes from SYSTEM_ADJACENCY BFS hops (index.js:181-207) and BODY_ORBITAL_INDEX (index.js:211-268), collapsed to 5s whenever NODE_ENV is not "production" (IS_DEV at index.js:52 and gameState.js:777). Persistence is a whole-state JSON blob in account_state.state_json (gameState.js ~1680-1700) with optional normalized-table dual-write/overlay behind USE_NORMALIZED_TABLES (server/db/repositories/operationsRepo.js); corp.travel exists only in the blob (migrations/07_corp_travel.sql has no repository code). Two defects were confirmed by a read-only simulation under NODE_ENV=production (VERCEL=1 so nothing was written; git status clean afterward): a 2-hour expedition ticked every 10s returned zero yield on every belt, and a probe returning to a full hangar was silently discarded.

### Entry points

- `refineryTick` — `server/index.js:486` — 10s ticker; calls applyRefineryOperations per account. Emits no socket event and adds no notification on completion.
- `asteroidExpeditionTick` — `server/index.js:502` — 10s ticker; calls applyAsteroidExpeditions, then builds notification + ISA inbox report from completedExpeditions, emits expedition:completed (:564).
- `fabricationTick` — `server/index.js:572` — 5s ticker; completes fabricationQueue jobs (job.type === 'mining-probe' at :583), clamps probeCount to maxProbes, adds PROBE_ASSET_VALUE to assets, emits fabrication:completed (:599).
- `travelTick` — `server/index.js:607` — 5s ticker; on arrivesAt sets currentSystemId/currentStationId/location, clears corp.travel, emits travel:arrived (:647/:656).
- `processRndCompletions` — `server/index.js:668` — 5s ticker; moves elapsed queues.corporateRnD items into corp.unlockedTech, emits rnd:completed (:700).
- `processCeoInsightCompletions` — `server/index.js:717` — 5s ticker; pushes programId into corp.completedInsights, recomputes exchangeSalesTaxPct, emits ceo:completed (:753).
- `POST /api/accounts/:accountId/gameplay/transfer-resources` — `server/index.js:1342` — Instant station-to-current-station inventory move, flat LOGISTICS_FEE_PER_UNIT=2 (:1340); destination = corp.currentStationId || 'earth-station-prime' (:1359).
- `POST /api/accounts/:accountId/gameplay/travel` — `server/index.js:1408` — Interstellar (toSystemId; research-gated by NEAR_STAR_SYSTEMS -> tt-proxima-navigation else tt-deep-star-navigation, :1451-1455) or local dock (toStationId; same-system only). Sets corp.travel and undocks.
- `getTravelTimeMs / getInterstellarTravelTimeMs` — `server/index.js:230` — Station-to-station and system-to-system durations (1 min same body, 3 min moon hop, 10+5n min planets, 1h per adjacency hop); both return 5s when IS_DEV (:235, :271).
- `POST /api/accounts/:accountId/gameplay/build-mining-probe` — `server/index.js:1929` — Gated on tt-asteroid-prospecting + Assembly Facility; cap check counts hangar + pending only (:1953-1957); one job at a time; PROBE_BUILD_COST 8000.
- `POST /api/accounts/:accountId/gameplay/scout-belt` — `server/index.js:2008` — Adds beltKey to asteroidMining.scoutedBelts. No cost, no research gate, no location requirement, no duration.
- `POST /api/accounts/:accountId/gameplay/launch-expedition` — `server/index.js:2038` — Requires research, scouted belt, probe in hangar, free deployment slot, same system; charges EXPEDITION_LAUNCH_COST 3000, decrements probeCount (:2098), pushes activeExpeditions entry.
- `GET /api/accounts/:accountId/gameplay/belt-compositions` — `server/index.js:2145` — Returns compositions for scouted belts plus allBeltKeys.
- `POST /api/accounts/:accountId/gameplay/build-refinery` — `server/index.js:2161` — Requires tt-material-compression + tt-nano-lattice; MAX_REFINERIES=2 (:2177); 75,000cr; pushes Refinery building and corp.refineries row.
- `POST /api/accounts/:accountId/gameplay/start-refinery` — `server/index.js:2246` — Validates chain.requiresTechIds, resolves batch scale (min 100 input units), consumes input from currentStationId inventory (:2311-2320), sets refinery.endsAt = cycleDurationHours*scale.
- `POST /api/accounts/:accountId/gameplay/queue-rnd` — `server/index.js:2647` — Gates: prereqs, requiresCorpLevel, all Tier-1 before Tier-2+, credits; durationHours forced to 0 when IS_DEV (:2700); pushes to state.queues.corporateRnD (:2696).
- `POST /api/accounts/:accountId/gameplay/complete-rnd (legacy)` — `server/index.js:2597` — Instantly unlocks tt-basic-extraction for 40,000cr and bumps military.modifiers.rdBonusPct; no caller in public/.
- `POST /api/accounts/:accountId/gameplay/queue-ceo` — `server/index.js:2740` — One program at a time, maxLevels per program, prereqs from completedInsights; durationHours 0 when IS_DEV (:2784).
- `RESEARCH_LIBRARY` — `server/index.js:55` — Hardcoded server research catalog (13 nodes). data/research.json is not read by the server (TODO at :54).
- `applyRefineryOperations` — `server/gameState.js:705` — On endsAt: deposits outputs*cycleScale at corp.currentStationId||'earth-station-prime' (:723-724), resets the refinery. No tech multipliers applied.
- `applyAsteroidExpeditions` — `server/gameState.js:850` — Per tick: totalYield = floor(tickMinutes*3*rarityMult*tickYieldMultiplier) (:885-887), rolls 1-3 seeded drops, sets lastTickAt=now (:897); on completion deposits at a station in exp.systemId and returns the probe clamped to maxProbes (:916).
- `BELT_COMPOSITIONS / SYSTEM_RARITY / EXPEDITION_DURATIONS` — `server/gameState.js:751` — Static belt tables (:751-758), rarity multipliers (:766-775), durations with dev multipliers 126/360/1008 at 10s vs prod 30/60/120 min at x1 (:781-789).
- `ensureCorpAsteroidMiningModel` — `server/gameState.js:798` — Defaults probeCount 0, maxProbes 2, maxDeployments 1, queues/arrays; normalizes activeExpeditions.
- `ensureCorpRefineryModel` — `server/gameState.js:665` — Syncs corp.refineries to count of 'Refinery' buildings; normalizes rows incl. cycleScale.
- `getEffectiveExchangeTaxRate` — `server/gameState.js:946` — The only CEO Insight mechanic: -2% per ceo-negotiation-fundamentals completion, max 3.
- `SYSTEM_DETAILS` — `server/gameState.js:133` — Hardcoded duplicate of data/systems.json used by normalizeSystems (:204) and by the travel route for destination validation (index.js:1428).
- `getStationInventory` — `server/gameState.js:1991` — Get/create per-station inventory bucket corp.inventory[stationId].
- `mutateAccountState` — `server/gameState.js:2580` — Wraps every route mutation: runs applyMiningOperations before/after, refreshContractOfferings, ensureCorpMiningModel, evaluateLevelProgress, schedules persist. Does NOT run refinery/expedition/travel/queue completion (tickers only).

### State this subsystem reads or writes

- `corp.refineries[] {id,name,tier,active,chainId,cycleScale,startedAt,lastTickAt,endsAt,cyclesCompleted,totalInputConsumed,totalOutputProduced}`
- `corp.asteroidMining.probeCount`
- `corp.asteroidMining.maxProbes`
- `corp.asteroidMining.maxDeployments`
- `corp.asteroidMining.fabricationQueue[] {id,type,startedAt,completesAt,cost}`
- `corp.asteroidMining.activeExpeditions[] {id,beltKey,systemId,duration,deployedAt,completesAt,lastTickAt,launchCost,yields,status}`
- `corp.asteroidMining.completedExpeditions[] (+completedAt, depositStationId; capped at 20)`
- `corp.asteroidMining.scoutedBelts[]`
- `corp.inventory[stationId][item]`
- `corp.finances.credits`
- `corp.finances.assets (PROBE_ASSET_VALUE, refinery ASSET_VALUE)`
- `corp.finances.exchangeSalesTaxPct`
- `corp.unlockedTech[]`
- `corp.completedInsights[]`
- `corp.travel {travelType,fromSystemId,toSystemId,fromStationId,toStationId,departedAt,arrivesAt} | null`
- `corp.currentStationId (null while in transit / open space)`
- `corp.currentSystemId`
- `corp.location`
- `corp.buildings[] (Refinery, Assembly Facility)`
- `corp.buildingSlots`
- `corp.level (requiresCorpLevel gates for navigation research)`
- `corp.unlocks.maxFleetSize (read by nothing in this subsystem)`
- `corp.military.modifiers.rdBonusPct (legacy complete-rnd only)`
- `queues.corporateRnD[] {id,techId,name,effect,durationHours,startedAt,costCredits}`
- `queues.ceoInsight[] {id,programId,name,effect,durationHours,startedAt,costCredits}`
- `world.systems (normalized from SYSTEM_DETAILS/systems.json)`
- `world.refineryChains (rebuilt from refinery-chains.json on every normalize)`

### TODOs in this code

- `server/index.js:54` — This should be extracted from the DB or from research.json (RESEARCH_LIBRARY hardcoded)
- `server/index.js:51` — Move IS_DEV to a single file so that we aren't redefining it everywhere
- `server/index.js:180` — SYSTEM_ADJACENCY: Store in DB
- `server/index.js:274` — Remove NEAR_STAR_SYSTEMS, we can simply check for these values when travel beyond is gated
- `server/index.js:500` — Consider implementation of unified tick system where all tick based actions are performed at once, rather than a separate ticker calculation for each function
- `server/index.js:800` — Consider moving API to a dedicated api.js file
- `server/gameState.js:132` — SYSTEM_DETAILS should be fetched from systems.json, see SYSTEMS_DATA
- `server/gameState.js:206` — normalizeSystems: Update to use SYSTEMS_DATA
- `server/gameState.js:746` — Asteroid Belts should be more dynamic: finite ore, disappear when mined out, 20% hourly respawn chance, random composition
- `server/gameState.js:762` — Rarity should be more dynamic; exotic belts possible in Sol but rarer
- `server/gameState.js:774` — Rarity should also determine what types of raw resources are available
- `server/gameState.js:874` — Should we really be defaulting rarity to common? When is SYSTEM_RARITY[exp.systemId] null?
- `server/gameState.js:1078` — createStarterCorporationState: should this all be hardcoded, or based on completed research etc?
- `server/gameState.js:1336` — getSeedState: Remove legacy data (seed corp with pre-filled rnd/ceo queues and 'Refinery Annex')
- `server/gameState.js:1615` — Remove all local disk account snapshots; all operations should go through the DB
- `public/scripts/app.js:67` — techTree should be fetched from db or research.json (third copy of the research catalog)
- `Todos.md:36` — Backlog: Server-Side R&D Auto-Completion tick (already implemented at index.js:668 but still listed as open)
- `DEVELOPMENT_PHASES.md:81` — v0.5: Resource Transportation polish pass: decide fee model (flat vs distance), instant vs timed transit, bulk transfers, history, tests

### Suspected defects (candidates — unverified, not filed)

- **sev 1** · `server/gameState.js:885` — **In production every asteroid expedition returns with zero yield: per-tick yield is floored and the fractional remainder is discarded, and the ticker cadence (10s) is too short to ever reach 1 unit.**
  <br>Evidence: totalYield = Math.floor(tickMinutes * baseYieldPerMin(3) * rarityMult * tickMult) at :885-887; with EXPEDITION_DURATIONS prod tickYieldMultiplier=1 (:786-789) and a 10s tick (index.js:569) tickMinutes=0.167 so floor(0.5*rarity) = 0 even for exotic 1.6; lastTickAt = now at :897 with no carry. VERIFIED by read-only simulation under NODE_ENV=production: 2h 'extended' expedition on sol:belt and epsilon-eridani:ee-crown ticked 721 times -> yields {} ; a single catch-up tick after 2h (server down) -> {Silicates:269}. The player then gets 'Yields: no resources' (index.js:521) and an ISA report saying 'No recoverable material extracted'. Dev multipliers 126/360/1008 (:782-784) hide this entirely in local testing.
- **sev 2** · `server/gameState.js:916` — **A returning probe is silently destroyed when the hangar is already at maxProbes, which the build route allows to happen.**
  <br>Evidence: launch-expedition decrements probeCount (index.js:2098) so an in-flight probe no longer counts; build-mining-probe's cap check is probeCount + fabricationQueue.length >= maxProbes (index.js:1953-1957) which ignores active expeditions, so with maxProbes=2 the player can fabricate a second hangar probe while one is out; on return probeCount = Math.min(am.maxProbes, probeCount+1) (:916) clamps it. VERIFIED by simulation: probeCount 2 (full) + returning probe -> 2. No notification; the 8,000cr probe (PROBE_BUILD_COST :792) and its PROBE_ASSET_VALUE on the balance sheet are lost. Same clamp in fabricationTick (index.js:584).
- **sev 2** · `server/db/repositories/operationsRepo.js:408` — **With USE_NORMALIZED_TABLES on, an in-progress probe fabrication loses its `type` on hydration, so fabricationTick later drops the job without crediting a probe.**
  <br>Evidence: mapAccountToProbeFabricationRows writes only id/corp_id/started_at/completes_at/status (:86-97; no type column in migrations/17); applyOperationsRowsToAccount replaces fabricationQueue with {id,startedAt,completesAt,status} (:408-413), unlike refineries which merge over `prior`. fabricationTick only increments probeCount `if (job.type === 'mining-probe')` (index.js:583) then filters all done jobs out (index.js:588). Inferred from code, not executed; only bites when the normalized overlay is enabled and the server restarts mid-fabrication.
- **sev 2** · `server/index.js:55` — **Three research nodes advertise effects the server never applies: tt-material-compression '+8% refining throughput', tt-energy-routing '+1 advanced manufacturing lane', tt-fleet-coordination '+12 fleet cap'.**
  <br>Evidence: Grep of tt-* ids outside the catalog/prereqs shows only: mining multipliers for tt-basic-extraction/tt-supply-forecast (gameState.js:619-620), downtime for tt-industrial-safety (:601), build-cost for tt-supply-forecast (index.js:1564,1779), and pure gates (index.js:1452,1454,1879,1935,2058,2171 + chain.requiresTechIds). applyRefineryOperations (:705-741) multiplies outputs only by cycleScale; maxFleetSize is written only by milestones (gameState.js:1066) and never by research (no hit in index.js). Players pay 6,000/4,000/12,000cr and 9/6/16h for text.
- **sev 2** · `data/ceo-insight.json:18` — **11 of 12 CEO Insight programs (14,000-50,000cr, 5-18h each) have no mechanic; only Negotiation Fundamentals does anything.**
  <br>Evidence: completedInsights is read at exactly two places: prereq check in queue-ceo (index.js:2753) and getEffectiveExchangeTaxRate (gameState.js:950-957) which only counts 'ceo-negotiation-fundamentals'. No code references ceo-employee-motivation, ceo-crisis-management ('-25% extractor repair time'), ceo-risk-assessment ('-12% downtime'), ceo-contract-law ('+8% mission reward'), ceo-strategic-delegation ('Unlock: Middle Manager'), etc. Only 'negotiation-tax-reduction' has a `mechanic` field.
- **sev 3** · `server/index.js:486` — **Refinery cycle completion is silent: no notification, no socket event.**
  <br>Evidence: refineryTick (:486-495) only calls applyRefineryOperations; io.emit list contains rnd:completed (:700), ceo:completed (:753), expedition:completed (:564), fabrication:completed (:599), travel:arrived (:647/:656) but nothing for refineries, and applyRefineryOperations has no hook. A 4-8h (x scale) wait ends with the output appearing on the next full state fetch. DEPTH.md:73 scores 'return reason' low precisely because completions are bare timers.
- **sev 3** · `server/gameState.js:723` — **Refinery output is deposited wherever the player happens to be when the cycle ends (or Earth Station Prime if in transit), not where the input was consumed; refineries have no station.**
  <br>Evidence: applyRefineryOperations uses corp.currentStationId || 'earth-station-prime' at completion (:723-724); start-refinery consumes input from the same expression at start (index.js:2311-2320); both routes set currentStationId=null while travelling (index.js:1475, :1508); refinery rows carry no stationId (:686-698, :681-694). tests/unit/applyRefineryOperations.test.js:78-105 codifies 'produces every output to the current station inventory'. Interacts with the v0.5 logistics fee decision (DEVELOPMENT_PHASES.md:81): refining is a free teleporter today.
- **sev 3** · `server/index.js:1359` — **transfer-resources while in transit silently routes goods to Earth Station Prime.**
  <br>Evidence: toStationId = corp.currentStationId || 'earth-station-prime' (:1359) with no docked check; travel sets currentStationId to null (:1475, :1508). The same-station guard (:1361) then compares against Earth, so a player flying Mars->Luna can transfer Mars stock 'to their current station' and find it on Earth.
- **sev 3** · `server/index.js:2125` — **maxDeployments is fixed at 1 forever; the error text promises 'research additional capacity' but nothing raises it (sibling of the known maxProbes defect, distinct field).**
  <br>Evidence: maxDeployments set only to BASE_MAX_DEPLOYMENTS=1 (gameState.js:796, :806; index.js:2066) and hydrated from DB default 1 (operationsRepo.js:404); evaluateLevelProgress (gameState.js:1063-1073) touches employeeCap/buildingSlots/maxFleetSize/marketSectors only; no research node references it. Message at :2125.
- **sev 3** · `server/index.js:1970` — **No industry or movement spend is recorded to the P&L buckets, so the v0.5 'full balance sheet / P&L' will omit probes, expeditions, refineries, research, CEO programs and logistics fees.**
  <br>Evidence: recordExpense/recordIncome are called only in gameState.js:638 ('mining-ops') and :650 ('mining'); every route here debits corp.finances.credits directly: probe :1970, expedition :2097, refinery build :2213, research :2695, CEO :2780, transfer fee :1386, assembly :1902. buildSnapshot (finances.js:106) reads incomeBySource/expensesByCategory. DEVELOPMENT_PHASES.md:76 lists the P&L as a v0.5 deliverable.
- **sev 3** · `server/index.js:2008` — **scout-belt is free, instant and ungated: any belt in any system can be scouted from Earth on day one.**
  <br>Evidence: Route :2008-2036 checks only that beltKey exists in BELT_COMPOSITIONS; no credits, no research, no same-system check, no duration; compositions are static (:751-758). launch-expedition does enforce same system (:2085-2088) so scouting is the only step that ignores location. Client renders the button for every Field body (public/scripts/starmap.js:940-941).
- **sev 4** · `server/index.js:622` — **corp.location is overloaded: a system id after interstellar arrival, a body name after docking.**
  <br>Evidence: travelTick sets state.corp.location = travel.toSystemId (:622) vs dest.body (:630); default 'Earth' (gameState.js:279); persisted to corporations.location (corporationRepo.js:23). No server consumer found, so cosmetic today, but any UI or query keyed on location will see 'alpha-centauri' alongside 'Earth'.
- **sev 4** · `server/index.js:2696` — **queue-rnd reads the R&D queue defensively but writes to it unguarded; a state blob lacking queues.corporateRnD throws inside mutateAccountState.**
  <br>Evidence: const queue = state.queues?.corporateRnD || [] (:2657) then state.queues.corporateRnD.push (:2696). normalizeStateShape guarantees queues.ceoInsight (gameState.js:341-345) but not corporateRnD; only createStarterCorporationState (:1152-1155) and the phase-3 overlay when rows.rdQueue is defined (operationsRepo.js:527) create it. Latent; only a hand-edited or partially hydrated blob triggers it.
- **sev 4** · `server/index.js:2597` — **Legacy complete-rnd route sells tt-basic-extraction for 40,000cr instantly (queue-rnd charges 2,000cr + 2h) and sets a modifier nothing else uses; no client caller.**
  <br>Evidence: Route :2597-2645 hardcodes techId and rdCost 40000, writes corp.military.modifiers.rdBonusPct; grep of public/ for 'complete-rnd' returns nothing. Dead route with a 20x price discrepancy reachable by any authenticated account for its own corp.
- **sev 4** · `data/research.json:1` — **The research catalog exists in three copies with no parity check; the JSON file the docs call the source of truth is read only by a schema test.**
  <br>Evidence: server truth RESEARCH_LIBRARY index.js:55-175 (TODO :54); data/research.json read only in tests/schema/data-files.test.js:92 (grep of server/ and public/ finds no reader); public/scripts/app.js:67 techTree (TODO). Verified identical today (13/13 ids, no field diffs) by script; research.json additionally carries description/category the server never serves. Same pattern for SYSTEM_DETAILS (gameState.js:133) vs systems.json, and travel validates against SYSTEM_DETAILS (index.js:1428).

### Test coverage, and what it does not cover

Covered: tests/unit/applyRefineryOperations.test.js (5 cases on the pure function: inactive, missing chain, unknown chain deactivates, pre-endsAt no-op, completion deposits to current station); tests/unit/catalogs.test.js (constants PROBE_BUILD_COST/EXPEDITION_LAUNCH_COST/BASE_MAX_PROBES/BASE_MAX_DEPLOYMENTS, REFINERY_CHAINS/CEO_INSIGHT_LIBRARY/BELT_COMPOSITIONS/EXPEDITION_DURATIONS shapes); tests/schema/data-files.test.js (research.json prereqs resolve and ids unique, refinery-chains/ceo-insight/systems/stations shape); tests/unit/getEffectiveExchangeTaxRate.test.js (CEO tax math); tests/unit/phase3Repositories.test.js (row mapping and overlay hydration for refineries, asteroid core, probe fabrications, expeditions + yields, scouted belts, rd/insight queues incl. durationHours reconstruction). tests/setup.js sets ISP_DISABLE_TICKERS=1, VERCEL=1 and NODE_ENV=test, so every test runs with tickers off and IS_DEV=true (dev durations/multipliers). NOT covered: applyAsteroidExpeditions (no unit test, which is how the zero-yield and probe-clamp defects survived); all six tickers (refineryTick, asteroidExpeditionTick, fabricationTick, travelTick, processRndCompletions, processCeoInsightCompletions); every route in this subsystem (travel, transfer-resources, build-assembly-facility, build-mining-probe, scout-belt, launch-expedition, belt-compositions, build-refinery, start-refinery incl. batch scaling and minimum-100 rule, queue-rnd tier/level gates, queue-ceo maxLevels, complete-rnd); getTravelTimeMs/getSystemHops/getInterstellarTravelTimeMs; NEAR_STAR_SYSTEMS gating; production-mode (NODE_ENV=production) behaviour of any of the above; RESEARCH_LIBRARY vs research.json vs app.js parity; the normalized-overlay round trip for fabricationQueue.type. tests/integration/auth.test.js covers auth only.

### Before you touch this in v0.5

- Set NODE_ENV=production on the Azure host or the game ships at test pace: IS_DEV (index.js:52, gameState.js:777) collapses travel to 5s, probe fabrication to 10s, expeditions to 10s with x126-x1008 yield multipliers, and research/CEO durations to 0h (index.js:2700, :2784). DEPTH.md:69 already flags this; nothing in the repo sets it (no workflow, vercel.json does not).
- Fix the expedition yield formula before any balance pass: the current per-tick floor makes production yield 0 and makes yield a function of server uptime (one catch-up tick after downtime pays 269 units; continuous ticking pays 0). Accumulate a fractional remainder like applyMiningOperations.minedRemainder (gameState.js:626-628) or compute yield once at completion from elapsed duration. Note the seeded drop rolling (1-3 resources per tick, :890-895) means resource mix also depends on tick count; decide whether yield should be rolled once per expedition.
- The tickers only advance state on a long-running process; mutateAccountState (gameState.js:2580) never calls applyRefineryOperations/applyAsteroidExpeditions/travel/queue completion. Azure App Service (single always-on node) restores this; if you ever scale to >1 instance every ticker runs on every instance against its own in-memory copy and persists over each other. Consider the unified tick TODO (index.js:500) and single-instance affinity.
- corp.travel is persisted only inside account_state.state_json; migrations/07_corp_travel.sql exists but no repository reads or writes it (grep -i travel server/db/repositories -> nothing). If the Azure move makes normalized tables the source of truth, in-flight trips are lost on restart (player left undocked; they can still dock from open space via index.js:1489-1491).
- Hydrating from normalized tables drops fabricationQueue[].type (operationsRepo.js:408-413), which fabricationTick requires (index.js:583). Either persist type or make the tick treat typeless jobs as mining-probe.
- Three of six systems (wolf-359, tau-ceti, epsilon-eridani), their belts and stations are unreachable by real players: tt-deep-star-navigation requires corp level 10 (index.js:159) and levels 6-10 need research ids that do not exist (verified: tt-ferric-core-extraction, tt-multi-stage-refinery, tt-cryo-vapor-extraction, tt-carbonaceous-slurry-recovery, tt-asteroid-belt-mining, tt-extrasolar-expansion) - this is already filed as #424. Only the dummy account (gameState.js:1796-1800) is granted the nav techs. For beta either lower the gate or accept that half the map is dead content.
- Decide the effect texts before the bug bash: 3 research nodes and 11 CEO programs are cosmetic today. Either implement (refinery throughput multiplier in applyRefineryOperations is a one-liner; fleet cap +12 in processRndCompletions; downtime/repair modifiers in applyMiningOperations) or reword the catalog so beta players are not paying for nothing.
- The research catalog must be de-duplicated before touching it: server truth is index.js RESEARCH_LIBRARY, not data/research.json (unread by the server), and public/scripts/app.js:67 has a third copy. Adding a node in one place will desync the UI or the gates. Same for SYSTEM_DETAILS vs systems.json (travel validation uses the hardcoded one at index.js:1428).
- Probe cap accounting: build-mining-probe must count active expeditions (hangar + pending + in-flight >= maxProbes), or the return path must not clamp. Also raise maxProbes/maxDeployments somewhere (milestones or research) or remove the 'research additional capacity' copy at index.js:1990/:2125.
- Refineries need a station id if the v0.5 logistics fee model is to mean anything; today input is consumed at the start station and output appears at the end station, so refining doubles as free transport. The unit test at tests/unit/applyRefineryOperations.test.js:78 will need updating with that change.
- For the P&L story (DEVELOPMENT_PHASES.md:76) route every industry debit through recordExpense (server/finances.js:43): probe, expedition, refinery build, research, CEO, transfer fee, assembly facility. Today only mining ops and a phantom 2.4cr/unit 'mining' income are recorded.
- Add tests before refactoring: applyAsteroidExpeditions under NODE_ENV=production cadence (10s ticks) with a non-zero-yield assertion, probe return when hangar is full, travelTick arrival, transfer-resources while in transit, start-refinery batch scaling, queue-rnd tier/level gates. tests/setup.js forces NODE_ENV=test so production timings are never exercised; parametrize IS_DEV or test the pure functions with explicit durations.
- Todos.md still lists 'Server-Side R&D Auto-Completion' as backlog although processRndCompletions (index.js:668) implements it; kanban items for R&D Tree, Refinery, CEO Insight and Asteroid Mining are stale relative to the code.
- The two confirmed defects in this subsystem were checked with a throwaway read-only script that imports gameState.js with VERCEL=1, so it neither reads accounts-snapshot.json nor writes state. The script was not kept; it is worth rewriting as the missing vitest cases listed above.

---

<a id="server-social-contracts"></a>

## server-social-contracts

**Scope.** CONTRACTS, MESSAGING and SOCIAL (server): mission/contract offerings, inbox/messages, notifications, chat, forums, combat reports, kanban router

Contracts are a per-account rotation: refreshContractOfferings (server/gameState.js:1285) picks CONTRACTS_PER_AGENT=2 of the 10 hardcoded MISSION_TEMPLATES (all agentId "elara-voss", 1178-1279) every 2h with a 4h cooldown after completion; it is invoked on every getAccountById/authenticateAccount/mutateAccountState (2097, 2134, 2589), so reads mutate and persist state. The three mission routes (index.js:2374/2404/2417) mutate corp.activeMissions/completedMissions/agentReputation; complete-mission deducts the quota from inventory[currentStationId] and credits the reward into a field nothing else reads. Notifications and messages are per-account arrays on the account record (not on account.state): pushSystemNotification (gameState.js:2072, cap 120) is called by ~20 routes and 5 tickers and broadcast to every socket via io.emit("notifications:new"); inbox messages (pushSystemMessage 2296, sendPlayerMessage 2355, drafts 2414/2451, folders inbox/sent/archive/trash/draft with 7-day trash TTL) are served by 6 routes at index.js:2823-2890 and are uncapped. Both arrays persist inside the Supabase account_state.state_json blob under __accountMeta (1523-1543) and the local data/accounts-snapshot.json mirror (1642, 500ms debounce); optional normalized tables (migrations 23-27, 31, 32; operationsRepo.js) only when USE_NORMALIZED_TABLES. Social state is global: chatLog[channel] (appendChatMessage 2009, cap 120/channel, fed by the unauthenticated socket handler index.js:3398-3414 which trusts payload.author/channel), forums.threads (three requireAuth routes index.js:2896/2943/2987, broadcast forums:updated), and combatReports (createCombatReport 2034, cap 50, via unauthenticated POST /api/combat/simulate 3359); all of it lives only in data/state.json via debounced scheduleSave (1820) and is never written to Supabase, and it reaches clients only through socket state:init (3396) and GET /api/bootstrap (802). Verified by running gameState.js in the test env: the shipped state.json has no chatLog or forums key, so appendChatMessage throws and the forum category select is empty, meaning chat and forum posting are both non-functional on this checkout. The kanban router (server/kanban.js) is a separate unauthenticated JSON read/write of kanban/kanbanState.json mounted at /kanban (index.js:427-434).

### Entry points

- `MISSION_TEMPLATES` — `server/gameState.js:1178` — Hardcoded pool of 10 Logistics contracts, all agentId elara-voss, each with quota {resource, amount} and reward string
- `refreshContractOfferings` — `server/gameState.js:1285` — Regenerates corp.contractOfferings.missions (2 picks, 2h timer, 4h cooldown on completed ids); called on every account read and mutation
- `POST /api/accounts/:id/gameplay/accept-mission` — `server/index.js:2374` — Pushes offered mission (or any template id as fallback) into corp.activeMissions
- `POST /api/accounts/:id/gameplay/abandon-mission` — `server/index.js:2404` — Removes mission from corp.activeMissions, no penalty
- `POST /api/accounts/:id/gameplay/complete-mission` — `server/index.js:2417` — Deducts quota from inventory at current station, credits reward, records completedMissions and agentReputation
- `pushSystemNotification` — `server/gameState.js:2072` — Unshifts a notification onto account.notifications (cap 120)
- `addAccountNotification` — `server/gameState.js:2245` — Public wrapper used by routes and tickers; returns sanitized notification for io.emit
- `GET/POST notifications routes` — `server/index.js:1008` — list (1008), mark one read (1018), read-all (1028); all behind requireAuth+requireAccountAccess (958)
- `pushSystemMessage / addSystemMessageToAccount` — `server/gameState.js:2296` — System inbox mail (registration licence at 2211, expedition reports from index.js:544)
- `sendPlayerMessage` — `server/gameState.js:2355` — Player-to-player mail resolved by corporation name; writes inbox copy and sent copy
- `saveDraft / deleteDraft / moveMessage / markMessageRead / listAccountMessages` — `server/gameState.js:2321` — Inbox folder operations; listAccountMessages also purges 7-day-old trash and schedules a save
- `messages routes` — `server/index.js:2823` — GET list (2823), send (2833), draft save (2852), draft delete (2867), read (2873), move (2882)
- `forums routes` — `server/index.js:2896` — create thread (2896), reply (2943), toggle like (2987); each mutateState + io.emit forums:updated
- `socket chat:send handler` — `server/index.js:3398` — stripHtml content, trust payload.channel/author, appendChatMessage, io.emit chat:new
- `appendChatMessage` — `server/gameState.js:2009` — Push into state.chatLog[channel], cap 120; assumes chatLog exists
- `resetChatHistory` — `server/gameState.js:2023` — Only place chatLog is initialized (global/local/trade/private); exported but never imported
- `createCombatReport` — `server/gameState.js:2034` — Unshift into state.combatReports, cap 50
- `POST /api/combat/simulate` — `server/index.js:3359` — Unauthenticated deterministic combat resolver; emits combat:newReport which no client listens for
- `asteroidExpeditionTick` — `server/index.js:502` — Every 10s: on expedition completion pushes notification and a formatted ISA inbox report
- `kanban router` — `server/kanban.js:27` — GET /kanban/api returns kanbanState.json; POST /kanban/api overwrites it with req.body; mounted at index.js:434 with static files at 427
- `stateWithAccountMeta / splitAccountStateAndMeta` — `server/gameState.js:1523` — Packs notifications/messages/refreshTokens into __accountMeta inside the state_json blob for Supabase and back
- `scheduleAccountsSave` — `server/gameState.js:1904` — Persist path for every account mutation and most reads: disk mirror (1642) plus immediate Supabase upsert of all accounts
- `scheduleSave` — `server/gameState.js:1820` — Debounced write of global state (chat, forums, combat, market) to data/state.json; no-op when VERCEL
- `operationsRepo mission/notification/message mappers` — `server/db/repositories/operationsRepo.js:201` — Row mappers (201-343) and row-to-account apply (465-525) for the normalized-table path

### State this subsystem reads or writes

- `account.state.corp.contractOfferings.missions[]`
- `account.state.corp.contractOfferings.nextRefreshAt`
- `account.state.corp.activeMissions[]`
- `account.state.corp.completedMissions[] (cap 200)`
- `account.state.corp.agentReputation[agentId].completedCount`
- `account.state.corp.credits (phantom; written only by complete-mission)`
- `account.state.corp.finances.credits (canonical balance)`
- `account.state.corp.inventory[stationId][resource]`
- `account.state.corp.asteroidMining.completedExpeditions[] (read by expedition tick for inbox reports)`
- `account.notifications[] (cap 120; outside account.state, persisted via __accountMeta)`
- `account.messages[] (uncapped; folder inbox|sent|archive|trash|draft; trashedAt; toCorpName on drafts)`
- `state.chatLog[channel][] (global state; cap 120 per channel; NOT seeded)`
- `state.forums.categories[] / state.forums.threads[] (global; NOT seeded; threads carry authorAccountId, likedBy[])`
- `state.combatReports[] (global; cap 50)`
- `state.missions[] (legacy seed at gameState.js:1448; unused by client)`
- `kanban/kanbanState.json columns[].cards[]`
- `data/state.json (global state file)`
- `data/accounts-snapshot.json (local mirror of accountsStore)`
- `Supabase account_state.state_json.__accountMeta.{notifications,messages,refreshTokens}`
- `Supabase corp_active_missions / corp_completed_missions / corp_agent_reputation / corp_contract_offerings / corp_contract_offering_missions / account_notifications / account_messages (only when USE_NORMALIZED_TABLES)`

### TODOs in this code

- `server/gameState.js:1176` — TODO: This shouldn't be hardcoded in this way. The values should be more random. (MISSION_TEMPLATES)
- `server/gameState.js:1336` — TODO: Remove legacy data (seed corp 'ISP Foundry Holdings' and legacy state.missions at 1448)
- `server/gameState.js:1615` — TODO: Remove all local disk account snapshots. All operations should go through the DB
- `server/gameState.js:2479` — TODO: Evaluate usage of Refresh Tokens
- `server/index.js:500` — TODO: Consider implementation of unified tick system where all tick based actions are performed at once
- `server/index.js:800` — TODO: Consider moving API to a dedicated api.js file
- `server/index.js:3417` — Placeholder for future presence tracking and local system channel cleanup. (socket disconnect)
- `public/scripts/app.js:5857` — TODO: Investigate current socket.io implementation
- `public/scripts/app.js:5495` — TODO: Move all functionality for the forums to its own dedicated file
- `public/scripts/app.js:4730` — renderCombatReports() { /* removed: combat reports tab deprecated */ }
- `Todos.md:52` — [ ] Local chat channel scoped to the player's current solar system (still unchecked although DEVELOPMENT_PHASES.md:60 marks it done)

### Suspected defects (candidates — unverified, not filed)

- **sev 1** · `server/index.js:2445` — **Contract rewards are paid into a phantom field state.corp.credits, so completing a contract consumes the quota and the player's balance never changes.**
  <br>Evidence: Line 2445 is the only write to corp.credits in the server (grep). The canonical balance is corp.finances.credits everywhere else (gameState.js:626/636, index.js:361, dev set-credits at index.js:882). Verified by running gameState.js in the test env: starter dummy corp has corp.credits undefined and corp.finances.credits 250000. recordIncome (finances.js:33) is never called for contracts, so P&L also misses it. The client mirrors the same phantom write in dummy mode at public/scripts/app.js:5703 and nothing reads corp.credits anywhere.
- **sev 1** · `server/gameState.js:2011` — **Chat is non-functional on this checkout: appendChatMessage throws TypeError because state.chatLog is never seeded.**
  <br>Evidence: Verified by executing gameState.js with the tests/setup.js env: getState() keys are world,corp,queues,missions,combatReports,playerProfile,market; typeof state.chatLog is undefined; appendChatMessage('global', ...) threw 'TypeError: Cannot read properties of undefined (reading global)'. normalizeStateShape (226-345) and getSeedState (1318-1462) never create chatLog; the only initializer resetChatHistory (2023) is exported but not imported by index.js (10-49). The throw occurs inside the socket handler at index.js:3412, which socket.io dispatches on process.nextTick, so it lands in the uncaughtException logger at index.js:390 and the message is silently dropped. Git history is a single squash commit (4f92687) so I cannot tell whether a seed once existed.
- **sev 1** · `public/scripts/app.js:4238` — **Forum posting is impossible on a fresh install: the category select is populated only from state.forums.categories, which the server never seeds.**
  <br>Evidence: Same run showed typeof state.forums undefined. The client builds the category <select> exclusively from data.forums?.categories (app.js:4238-4244, markup index.html:748 has no options) and refuses to submit when category is empty (4268). The server route at index.js:2896 would accept a thread (it only validates categories when the list is non-empty, 2915) but the client can never reach it. README.md:150 claims state.json holds forums; gameState.js contains no 'forums' string at all (grep).
- **sev 2** · `server/kanban.js:32` — **Anyone can overwrite or wipe the public kanban board: POST /kanban/api has no authentication and writes req.body verbatim.**
  <br>Evidence: server/index.js:427-434 mounts the kanban static files and router with no requireAuth; kanban.js:32-35 calls saveKanban(req.body) with no schema check. BRIEF.md:70-71 records that kanbanState.json is served publicly on burkart.dev. Also kanban.js:6 resolves the file via process.cwd() while every other path uses __dirname (index.js:372, gameState.js:10), so it breaks if the process is started from another directory.
- **sev 2** · `server/index.js:3407` — **Chat author and channel are client-asserted on an unauthenticated socket, so any visitor can impersonate any corporation and post into any channel.**
  <br>Evidence: io.on('connection') at 3395 performs no handshake auth and the client connects with bare io() (public/scripts/app.js:399). The handler takes author from payload (3407) and channel from payload with no allowlist (3406); the client sends its corp name as author (app.js:5488). Consequences: impersonation, posting into local:<any-system> regardless of location, unbounded channel keys in chatLog, and no length cap on content (only stripHtml at 3399).
- **sev 2** · `server/db/repositories/operationsRepo.js:467` — **With USE_NORMALIZED_TABLES on, hydration rebuilds active missions as stubs without quota/title/reward, so no contract can be completed after a restart.**
  <br>Evidence: applyOperationsRowsToAccount replaces corp.activeMissions wholesale with {id, missionTemplateId, acceptedAt, expiresAt, progressQuantity, status} (467-474); the row mapper (201-213) never stores quota/title/reward and reads acceptedAt/expiresAt/progressQuantity/status that accept-mission never sets (index.js:2390, 2392 spread the template only). complete-mission then returns 'no-quota' (index.js:2426) for every mission and the mission modal shows empty title/reward. tests/unit/phase3Repositories.test.js:405-414 asserts the stub shape, enshrining it. Flag defaults off (supabaseClient.js:27-28).
- **sev 3** · `server/index.js:2387` — **accept-mission falls back to the full template pool, so the 2-per-2h offering rotation can be bypassed and all 10 contracts accepted at once with no deadline.**
  <br>Evidence: Lines 2387-2390: if the id is not in current offerings, any MISSION_TEMPLATES entry is accepted. There is no cap on activeMissions and no acceptedAt/expiresAt stamp, although every template's text promises delivery 'within the deadline' (gameState.js:1185) and the schema has expires_at (migrations/23_corp_active_missions.sql).
- **sev 3** · `server/gameState.js:2363` — **Player mail is delivered to the first account whose corporation name matches, so two corps with the same name cause misdelivery.**
  <br>Evidence: sendPlayerMessage resolves the recipient with Object.values(...).find on lower-cased corporationName (2363-2365). createAccount enforces only email uniqueness (2158); nothing checks corp-name uniqueness, so a later registrant with the same name can never receive mail and the earlier one receives it.
- **sev 3** · `server/index.js:515` — **An expedition can be notified and inbox-reported twice when two expeditions complete in consecutive ticks.**
  <br>Evidence: The tick runs every 10s (569) and, whenever the active count drops, re-collects every completedExpedition with completedAt >= now - 15000 (515-516). gameState.js:919 stamps completedAt = now on completion. Expedition A completing at tick N and B at tick N+1 (10s later) puts A inside the 15s window again, re-sending its notification (522) and ISA report mail (544). Inferred from code; not runtime-verified.
- **sev 3** · `server/index.js:528` — **Every account-scoped socket event is broadcast to every connected client, leaking other players' notifications, inventory and finances and scaling as accounts x sockets per tick.**
  <br>Evidence: All notifications:new emits use io.emit (528, 598, 660, 709, 762, 983, 1086, ...); mining:updated broadcasts each account's full inventory and credits every 5s (473-478); finance:updated carries no accountId at all (791, 3355). The client discards mismatched accountIds (app.js:5941, 5980) but the payloads are on the wire to everyone; in dummy mode finance:updated is applied unconditionally (app.js:5911-5916), so the dummy client's finances are overwritten by whichever account the 30s snapshot tick emitted last. No socket rooms are used anywhere (grep 'socket.join' empty).
- **sev 3** · `server/gameState.js:2298` — **account.messages grows without bound and the entire accounts store is re-serialized on every save.**
  <br>Evidence: pushSystemMessage (2298), sendPlayerMessage (2378, 2395) and saveDraft (2446) unshift with no cap; the only pruning is the 7-day trash purge (2314-2319). Every completed expedition adds a system mail (index.js:544). Persistence serializes the whole accountsStore (1633) and maps all accounts for Supabase (1555), so persist payloads grow with mail volume; notifications by contrast are capped at 120 (2087).
- **sev 3** · `server/gameState.js:2325` — **Read endpoints trigger a full-store persist: GET /messages and GET /accounts/:id each schedule a save of every account.**
  <br>Evidence: listAccountMessages calls scheduleAccountsSave on every call (2325); getAccountById calls refreshContractOfferings and scheduleAccountsSave (2097-2099). In Supabase mode scheduleAccountsSave immediately runs _runPersistAccountsToSupabaseSerially for all accounts (1914-1931); locally it debounces a full snapshot write (1642-1650). DEVELOPMENT_PHASES.md:90 already lists 'Supabase persistence frequency' as a v0.5 audit item.
- **sev 3** · `server/index.js:3359` — **POST /api/combat/simulate is an unauthenticated dead endpoint that writes global state and persists to disk.**
  <br>Evidence: No requireAuth on 3359; createCombatReport mutates and schedules a save (gameState.js:2041-2044). The client has no listener for combat:newReport (grep public/scripts/app.js) and renderCombatReports is a stub (app.js:4730). Missing body fields become NaN via Number(undefined) at 3370-3371, so attackerWin is false and NaN powers are stored. BRIEF.md:49 places combat in v0.10.
- **sev 3** · `public/scripts/app.js:5865` — **In dummy mode a socket (re)connect replaces the player's data with the global legacy seed corporation.**
  <br>Evidence: state:init sends getState() (index.js:3396) whose top-level corp is the seed 'ISP Foundry Holdings' with 2,450,000 credits (gameState.js:1337-1371, marked 'TODO: Remove legacy data' at 1336). The client, when profileMode is 'dummy' and authenticated, does appState.data = deepClone(serverState) (app.js:5865-5866). Outside this subsystem's core but reached via the same socket path; inferred, not runtime-verified.
- **sev 4** · `public/scripts/app.js:697` — **The notification panel renders title/body/id without escaping, and the purchase-lease route feeds a raw request string into a notification body.**
  <br>Evidence: app.js:697-700 interpolates item.id, item.title, item.body into innerHTML with no escapeHtml (every other renderer escapes: chat 4757, forums 4044/4065, inbox 6212/6218). index.js:1249 takes requestedBody = req.body.body with only a non-empty check; 1257 defaults unknown bodies to 25000 credits; 1294 stores it as the lease body; 1327 puts it in the notification. Result: an arbitrary-string lease plus stored self-XSS in the owner's own panel (notifications are account-scoped, so self-only).
- **sev 4** · `server/gameState.js:2136` — **Every login pushes a 'Secure Access Granted' notification, crowding real notifications out of the 120-item cap.**
  <br>Evidence: authenticateAccount unshifts the notification unconditionally (2136-2140); pushSystemNotification slices to 120 (2087). The client shows only the newest 30 (app.js:693).
- **sev 4** · `server/index.js:2428` — **complete-mission has no server-side check that the player is docked at the contracting agent's station; only the client gates it.**
  <br>Evidence: Server uses currentStationId || 'earth-station-prime' for the inventory (2428) and never compares against the agent's station. The client computes isAtAgentStation from MISSION_AGENTS (app.js:4337-4345, 4373) and disables Complete otherwise (4419), so a direct API call completes anywhere the quota sits.
- **sev 4** · `server/index.js:802` — **Unauthenticated endpoints expose account IDs of every forum author, liker and market seller.**
  <br>Evidence: GET /api/bootstrap (802) and socket state:init (3396) return the full global state; forum threads and replies embed authorAccountId (2926, 2960) and likedBy account-id arrays (3010) and are re-broadcast on every forums:updated. Account IDs are Supabase auth user UUIDs when USE_SUPABASE_AUTH (gameState.js:2181). An ID alone does not grant access (JWT required, 340-352) but it is needless disclosure.

### Test coverage, and what it does not cover

Touching this subsystem: tests/unit/createCombatReport.test.js (report shape, unshift into state.combatReports, cap 50); tests/unit/catalogs.test.js:68-81 (MISSION_TEMPLATES have id/type/reward/quota and unique ids); tests/unit/phase3Repositories.test.js:188-520 (normalized-table row mappers and applyOperationsRowsToAccount round-trips for active/completed missions, agent reputation, contract offerings, notifications and messages; note 405-414 asserts the stripped active-mission shape); tests/integration/auth.test.js:186-208 covers requireAccountAccess which fronts the notification and message routes. NOT covered at all: accept/abandon/complete-mission routes and their outcome codes; refreshContractOfferings rotation, cooldown and timer; the notifications routes (list, read, read-all) and pushSystemNotification cap; every messages route and gameState function (list, send, draft save/delete, read, move, trash purge, recipient resolution); the three forums routes (create, reply, like toggle); the chat socket handler and appendChatMessage (which would have caught the missing chatLog seed); asteroidExpeditionTick's notification and inbox report; the kanban router (explicitly excluded from coverage in vitest.config.js:14). tests/setup.js sets VERCEL=1 so scheduleSave/scheduleAccountsSave are no-ops, meaning no test exercises state.json or accounts-snapshot persistence, and no test opens a socket.io connection.

### Before you touch this in v0.5

- Persistence split you must keep in mind for the Azure move: global social state (chatLog, forums, combatReports, market) lives ONLY in data/state.json via debounced scheduleSave (gameState.js:1820-1835) and is never written to Supabase; per-account notifications/messages/missions live in accountsStore, mirrored to data/accounts-snapshot.json (1642, 500ms debounce, gitignored) and to Supabase account_state.state_json under __accountMeta (1523-1543), plus normalized tables only when USE_NORMALIZED_TABLES. A long-running Azure App Service instance will write state.json to its local disk, which is lost on redeploy/scale-out unless data/ is on persistent storage or global state moves to the DB.
- Before anything else in this area, seed chatLog {global, local, trade, private} and forums {categories, threads} in getSeedState/normalizeStateShape (or ensure them lazily in appendChatMessage and the forum routes) and add a socket-level test; today chat and forum posting are both dead on a fresh state.json (verified by execution, see defects 2-3). Deleting data/state.json locally reproduces it.
- One change fixes chat spoofing and the broadcast leaks together: verify the access JWT in an io.use handshake middleware (client must pass the token in io({auth})), socket.join(accountId), derive chat author from the account and local channel from corp.currentSystemId, allowlist channels, and replace io.emit for notifications:new / mining:updated / finance:updated / travel / rnd / ceo / expedition / fabrication events with io.to(accountId).emit. Keep io.emit only for market:updated, forums:updated and chat:new.
- The 'Private' chat tab (public/index.html:722) is a global broadcast channel literally named private; either remove it for beta or implement it. Player-to-player mail already exists in the inbox but has no live delivery: no messages:new socket event exists (grep), and the client loads the inbox only on tab activation (app.js:6461-6463) or after expedition:completed (6002). Emit to the recipient's room once rooms exist.
- Fix contract rewards to corp.finances.credits and call recordIncome(corp, 'contracts', n) (finances.js:33) so the v0.5 P&L work (DEVELOPMENT_PHASES.md:76) sees contract income; also fix or delete the client's dummy-mode mirror at app.js:5703. Add a regression test that completes a mission through the route and asserts finances.credits.
- Reads are writes: getAccountById (gameState.js:2097-2099), listAccountMessages (2325) and mutateAccountState (2589-2592) all run refreshContractOfferings and scheduleAccountsSave. When you do the persistence-frequency audit (DEVELOPMENT_PHASES.md:90), make GET paths pure and move offering refresh into a ticker or into accept-mission only.
- If USE_NORMALIZED_TABLES is enabled on Azure, active missions must either store the full template snapshot (quota/title/reward/agentId/text) or be re-resolved from MISSION_TEMPLATES on hydrate (operationsRepo.js:467-474); otherwise every contract returns 'no-quota' after the first restart. Update tests/unit/phase3Repositories.test.js:405-414 accordingly. Also stamp acceptedAt/expiresAt in accept-mission so the deadline the mission text promises is real.
- Decide the kanban's fate (BRIEF.md:70-72 says it disagrees with the docs and is served publicly): at minimum put requireAuth or an admin key on POST /kanban/api (server/kanban.js:32) and exclude /kanban from the public beta build; it also uses process.cwd() (kanban.js:6) unlike the rest of the server.
- POST /api/combat/simulate and state.combatReports are dead weight (client stub app.js:4730, no combat:newReport listener; combat is v0.10 per BRIEF.md:49). Remove the route or gate it behind requireAuth so it cannot be used to spam global state.
- Cap account.messages (e.g. 500 newest plus drafts) and consider archiving expedition reports server-side; the whole accountsStore JSON is the persist unit (gameState.js:1633, 1555), so mail volume directly inflates every save. Also enforce corporation-name uniqueness at registration (createAccount only checks email, 2158) or route player mail by account id, since sendPlayerMessage resolves recipients by name (2363).
- No rate limiting exists anywhere (grep) and chat content has no length cap (index.js:3399); forum title/body and mail subject/body are capped (2899-2900, 2944, 2368-2369) and every renderer escapes except the notification panel (app.js:697-700). Add a length cap on chat and escapeHtml in renderNotifications during the security hardening pass (DEVELOPMENT_PHASES.md:91); validate purchase-lease body against the station registry (index.js:1249-1257).
- Vercel-only branches become dead code on Azure: the persist-before-respond middleware (index.js:407-423), IS_SERVERLESS gates in gameState.js (15, 51, 1466-1475, 1617, 1631, 1643, 1821, 1916) and vercel.json. Keep ISP_DISABLE_TICKERS and the VERCEL=1 trick in tests/setup.js until tests get a proper in-memory persistence switch, or the test suite will start writing data/state.json.
- The notification and inbox copy are heavily themed ISA-bureaucracy prose (index.js:544-560, gameState.js:2211-2224); the registration mail names 'Liaison Officer Aria Voss' while the contracts agent is 'Elara Voss' (MISSION_TEMPLATES agentId elara-voss, client MISSION_AGENTS app.js:4337-4345). Worth a consistency pass alongside the walkthrough copy drift already filed.

---

<a id="server-persistence"></a>

## server-persistence

**Scope.** Persistence and state shape (server/gameState.js, server/db/*, server/loadEnv.js, migrations/, plus the index.js tickers and shutdown path that drive it)

There are two unrelated persistence tiers. GLOBAL state (`state`, gameState.js:1519) is one JSON file, data/state.json (gitignored, so every checkout self-seeds from getSeedState() at 1318): it holds `market` (npcBuyOrders, orderBook), `forums`, `chatLog`, `combatReports` and a legacy seed `corp/queues/missions/playerProfile` that nothing per-account uses but /api/bootstrap (index.js:803) and socket `state:init` (3396) still ship to the client; it is mutated only through mutateState (2003) and saved by scheduleSave (1820), a 300 ms debounced synchronous safeWriteFile (59), and it is never written to Supabase. PER-ACCOUNT state lives in `accountsStore.accounts[id]` (hydrated once at module load by a top-level await, 1818) and is mutated through mutateAccountState (2580), which runs applyMiningOperations before and after the mutator, refreshContractOfferings, ensureCorpMiningModel, evaluateLevelProgress, then scheduleAccountsSave (1904). In Supabase mode every save serialises EVERY account into `accounts` + `account_state.state_json` (1545-1584; refresh tokens, notifications and messages are smuggled inside the blob as `__accountMeta`, 1523-1531), then optionally dual-writes the normalized tables in three phases (repositories/index.js:109/176/227) behind USE_NORMALIZED_TABLES (supabaseClient.js:26-28, default off; I could not verify production's value), and mirrors the whole store, password hashes included, to data/accounts-snapshot.json (1642). Hydrate (1652) loads the blob first, then overlays phase 1/2/3 rows on top, so wherever a normalized table exists it wins over the blob. Because Node is single-threaded the eight setInterval tickers (index.js:460-798) cannot interleave with request handlers inside a mutator; the real hazards are that (a) the persist pass builds the blob rows synchronously but phases 1-3 re-read live state after awaits, (b) on Vercel rehydrateFromSupabase replaces `accountsStore.accounts` wholesale per request (1980), and (c) shutdown never actually flushes (index.js:3429-3432). Verified per-account shape (account.state, from createStarterCorporationState 1079, normalizeStateShape 226, and the index.js writers cited in stateFields):

account { id, email, passwordHash, walkthroughCompleted, createdAt, lastLoginAt, refreshTokens[{token,expiresAt}], notifications[{id,accountId,type,title,body,createdAt,readAt}], messages[{id,fromType,fromId,fromName,toAccountId,toCorpName?,toName,subject,body,sentAt,readAt,folder,trashedAt,updatedAt?}], state }
account.state
├─ world {lawName, lawYear, systems[], refineryChains[]}   ← deep-cloned seed copy per account (1080); no server reader
├─ missions[] / combatReports[]                             ← legacy seed copies (1448, 1461); unused
├─ playerProfile {isNewPlayer, registeredAt, walkthroughCompleted}
├─ queues
│  ├─ corporateRnD[{id:"rnd-<ts>", techId, name, effect, durationHours, startedAt, costCredits}]   (index.js:2696)
│  └─ ceoInsight[{id:"ceo-<ts>", programId, name, effect, durationHours, startedAt, costCredits}]  (index.js:2781)
└─ corp
   ├─ id: "corp-001"                       ← leaked from seed (1338); identical for every account
   ├─ ceo, corporationName
   ├─ location, currentStationId, currentSystemId
   ├─ travel: null | {travelType:"interstellar"|"local", fromSystemId?, toSystemId, fromStationId, toStationId?, departedAt, arrivesAt} (index.js:1460,1493)
   ├─ level, levelCap=40, milestonesCompleted[string], levelProgress{levelN:{requirements[{id,title,progress,target,complete}],allCompleted}} (derived, 1024)
   ├─ employeeCap, employeeCount, buildingSlots
   ├─ buildings[{name, tier, status}]       (index.js:1599,1797,1901,2195; phase-2 overlay adds id/stationId/builtAt/completesAt)
   ├─ military {lightFighters, destroyers, siegeEngines, attackValue, defenseValue, modifiers{rdBonusPct, ceoLeadershipPct}}
   ├─ finances {credits, liabilities, assets, dailyRevenue, dailyCosts, taxRatePct, bondYieldPct, exchangeSalesTaxPct(derived 340), lifetimeRevenue, lifetimeCosts, incomeBySource{}, expensesByCategory{}, snapshots[{t,credits,assets,liabilities,dailyRevenue,dailyCosts,netFlow,netWorth}] max 60; liquidity/liquidityCap/liquidityRegenPerHour/lastLiquidityTick only via phase-1 overlay}
   ├─ credits                               ← STRAY field written by complete-mission (index.js:2445), never read
   ├─ inventory {stationId: {item: qty}}    (flat→per-station migration at 254-260)
   ├─ mining {silicateExtractors[{id, name, tier, active, startedAt, lastTickAt, endsAt, throughputPerHour, operationCostPerHour, totalMined, minedRemainder, totalSpent, lastCompletedAt, leaseId, body, downtimeActive, downtimeStartedAt, downtimeRecoveredAt}], silicateExtractor: duplicate of [0] (453, 661)}
   ├─ refineries[{id, name, tier, active, chainId, cycleScale, startedAt, lastTickAt, endsAt, cyclesCompleted, totalInputConsumed, totalOutputProduced}]
   ├─ asteroidMining {probeCount, maxProbes, maxDeployments, fabricationQueue[{id, type:"mining-probe", startedAt, completesAt, cost}], activeExpeditions[{id, beltKey, systemId, duration, deployedAt, completesAt, lastTickAt, launchCost, yields{}, status}], completedExpeditions[…+completedAt, depositStationId] max 20, scoutedBelts[beltKey]}
   ├─ unlocks {marketSectors[], maxUpgradeTier, maxFleetSize, maxBasicExtractorYards}
   ├─ unlockedTech[techId], completedInsights[programId, repeated per level]
   ├─ offices[{stationId, name, body, systemId, tier, rentedAt, rentedUntil, durationDays}]   (index.js:1135)
   ├─ miningLeases[{id, body, leaseType, issuedAt, cost, buildingSlots, extractorIds[]}]       (index.js:1292)
   ├─ tradeHistory[{id, type:listed|bought|sold|sold-npc, item, quantity, unitPrice, total, counterparty, at, taxPct?, taxAmount?, proceeds?}] max 200
   ├─ activeMissions[{…MISSION_TEMPLATE: id, title, type, risk, reward, text, agentId, quota{resource, amount}}]  (index.js:2390)
   ├─ completedMissions[{id, title, type, agentId, reward, completedAt}] max 200
   ├─ agentReputation {agentId: {completedCount}}
   ├─ contractOfferings {missions[template], nextRefreshAt}
   ├─ investments[{id, targetCorp, amount, instrument, createdAt}]   (index.js:3346)
   └─ stats {silicateSoldOnExchange}                                  (index.js:3271; read by milestone metric stat:*, 974)

Global `state` (data/state.json): world, corp/queues/missions/playerProfile (legacy seed), combatReports (max 50), market{npcBuyOrders[{id,item,buyer,unitPrice,totalQtyPerDay,remainingQty,lastResetDate}], orderBook[{id,type,item,quantity,unitPrice,seller,sellerAccountId,createdAt}]}, forums{categories[],threads[{id,category,title,author,authorAccountId,body,likes,likedBy[],createdAt,replies[]}]}, chatLog{channel:[msg]}. Of these, the seed produces only world + legacy; `market.npcBuyOrders` is added on the second boot (1485-1511), `forums` lazily on first post (index.js:2934), and `market.orderBook` and `chatLog` are never initialised anywhere (verified: this checkout's generated state.json has neither).

### Entry points

- `getSeedState` — `server/gameState.js:1318` — Builds the seed for BOTH the global state file and (via createStarterCorporationState) every new account; contains legacy corp/queues/missions but no market, chatLog or forums
- `normalizeStateShape` — `server/gameState.js:226` — Idempotent shape upgrader run on the state file at boot and on every account blob at hydrate/split; rebuilds world.refineryChains, migrates flat inventory to per-station, backfills every corp.* array, recomputes exchangeSalesTaxPct
- `ensureCorpMiningModel` — `server/gameState.js:359` — Syncs silicateExtractors with Basic Extractor Yard buildings, applies throughput/cost defaults to inactive yards (423-424), relinks leaseId/body, rebuilds lease.extractorIds, writes the legacy silicateExtractor duplicate
- `ensureCorpRefineryModel / ensureCorpAsteroidMiningModel` — `server/gameState.js:665` — Same pattern for refineries (665) and asteroidMining (798)
- `createStarterCorporationState` — `server/gameState.js:1079` — New-account state: deepClones the whole seed (world, missions, combatReports included) and overrides corp/queues/playerProfile
- `evaluateLevelProgress` — `server/gameState.js:1020` — Derives corp.levelProgress, milestonesCompleted and level-ups from data/milestones.json on every mutateAccountState/getAccountById/hydrate
- `ensureStateFile` — `server/gameState.js:1465` — Module-load sync read/normalise/rewrite of data/state.json; seeds npcBuyOrders only on the file-exists branch
- `safeWriteFile` — `server/gameState.js:59` — Synchronous atomic write (tmp + renameSync with 4 EPERM/EBUSY retries, then in-place fallback); the only disk writer for state.json and accounts-snapshot.json
- `mutateState` — `server/gameState.js:2003` — Global-state mutator; calls scheduleSave (300 ms debounced sync write, no-op when IS_SERVERLESS)
- `mutateAccountState` — `server/gameState.js:2580` — Per-account mutator: applyMiningOperations before AND after the mutator, refreshContractOfferings, ensureCorpMiningModel, evaluateLevelProgress, scheduleAccountsSave, returns a deepCloned sanitizeAccount
- `getAccountById` — `server/gameState.js:2090` — A read that mutates (mining tick, contract refresh, level eval) and schedules a full save
- `scheduleAccountsSave` — `server/gameState.js:1904` — Local mode: debounced disk mirror. Supabase mode: sets _persistDirty, mirrors to disk, and immediately starts a serialised full-store Supabase persist (returns early on serverless)
- `_runPersistAccountsToSupabaseSerially` — `server/gameState.js:1875` — Mutex + requeue flag so only one persistAccountsStoreToSupabase runs at a time; on failure marks dirty and falls back to disk
- `persistAccountsStoreToSupabase` — `server/gameState.js:1545` — Upserts ALL accounts to accounts + account_state (blob with __accountMeta) then phase1/2/3 dual-writes, each try/caught and logged
- `saveAccountsNow` — `server/gameState.js:1934` — Called by onShutdown; uses the DEBOUNCED disk write and an async Supabase persist that the caller does not await
- `flushPendingPersist / rehydrateFromSupabase` — `server/gameState.js:1956` — Serverless-only: awaited around every res.json (index.js:407-423); rehydrate (1976) replaces accountsStore.accounts wholesale
- `hydrateAccountsStoreFromSupabaseOrFallback` — `server/gameState.js:1652` — Startup hydrate: Supabase blob → normalizeStateShape → phase1/2/3 overlays → mergeDummyAccount; falls back to disk snapshot or in-memory seed; if accounts table is empty it PERSISTS the fallback store (incl. dummy) into Supabase (1674)
- `stateWithAccountMeta / splitAccountStateAndMeta` — `server/gameState.js:1523` — Packs/unpacks refreshTokens, notifications, messages into the state_json blob as __accountMeta
- `writeAccountsSnapshotToDisk / loadAccountsSnapshotFromDisk` — `server/gameState.js:1642` — 500 ms debounced (unref'd timer) sync mirror of the whole accountsStore, hashes and tokens included, to data/accounts-snapshot.json; loader at 1616
- `createSeedAccountsStore / mergeDummyAccount` — `server/gameState.js:1792` — In-memory dummy account with all techs; mergeDummyAccount (1774) re-attaches it after hydrate
- `top-level await hydrate` — `server/gameState.js:1818` — Importing gameState.js blocks on Supabase (or disk) and performs sync file I/O at 1519; tests neuter this with VERCEL=1
- `USE_SUPABASE / USE_SUPABASE_AUTH / USE_NORMALIZED_TABLES / supabaseAdmin` — `server/db/supabaseClient.js:23` — Flag computation and a SECOND admin client (gameState.js:42 creates its own); normalized flag defaults off
- `persistAccountsPhase1/2/3 and hydrateOverlayPhase1/2/3` — `server/db/repositories/index.js:109` — Phase facade (persist 109/176/227, overlay 144/196/260); all no-op unless USE_NORMALIZED_TABLES
- `replaceInfrastructureRows / applyInfrastructureRowsToAccount` — `server/db/repositories/infrastructureRepo.js:219` — Phase 2 delete-then-insert per corp (extractors, buildings, offices, leases) and the overlay that REPLACES those four corp arrays (120)
- `replaceOperationsRows / applyOperationsRowsToAccount` — `server/db/repositories/operationsRepo.js:656` — Phase 3 delete-then-insert across 18 tables and the overlay (344) that replaces refineries, asteroidMining, inventory, tradeHistory, missions, reputation, offerings, queues, insights, notifications, messages
- `loadEnvFile` — `server/loadEnv.js:17` — Reads .env then .env.local, skipping keys already set — so .env wins over .env.local
- `VERCEL persist-before-respond middleware` — `server/index.js:407` — Serverless only: rehydrate per request, wrap res.json to await flushPendingPersist
- `tickers` — `server/index.js:467` — miningTick 467 (5 s), refineryTick 486 (10 s), asteroidExpeditionTick 502 (10 s), fabricationTick 572 (5 s), travelTick 607 (5 s), processRndCompletions 668 (5 s), processCeoInsightCompletions 717 (5 s), financialSnapshotTick 778 (30 s), checkAndResetNpcBuyOrders 442 (60 s); each loops every account through mutateAccountState
- `onShutdown` — `server/index.js:3429` — SIGINT/SIGTERM handler: saveAccountsNow() then process.exit(0) immediately
- `migrations/01..34` — `migrations/README.md:1` — One CREATE TABLE per file for the normalized schema; 33/34 are ALTERs adding corp_extractors.body and corp_refineries.cycle_scale; supabase_migration.sql is the combined original

### State this subsystem reads or writes

- `state.world.systems`
- `state.world.refineryChains`
- `state.market.npcBuyOrders`
- `state.market.orderBook`
- `state.forums.categories`
- `state.forums.threads`
- `state.chatLog[channel]`
- `state.combatReports`
- `state.corp / state.queues / state.missions / state.playerProfile (legacy seed, global copy)`
- `accountsStore.accounts[id].{id,email,passwordHash,walkthroughCompleted,createdAt,lastLoginAt}`
- `accountsStore.accounts[id].refreshTokens`
- `accountsStore.accounts[id].notifications`
- `accountsStore.accounts[id].messages`
- `account.state.world (per-account seed copy)`
- `account.state.missions / combatReports (per-account seed copies)`
- `account.state.playerProfile.{isNewPlayer,registeredAt,walkthroughCompleted}`
- `account.state.queues.corporateRnD`
- `account.state.queues.ceoInsight`
- `corp.id`
- `corp.ceo`
- `corp.corporationName`
- `corp.location`
- `corp.currentStationId`
- `corp.currentSystemId`
- `corp.travel`
- `corp.level`
- `corp.levelCap`
- `corp.levelProgress`
- `corp.milestonesCompleted`
- `corp.employeeCap`
- `corp.employeeCount`
- `corp.buildingSlots`
- `corp.buildings`
- `corp.military.{lightFighters,destroyers,siegeEngines,attackValue,defenseValue,modifiers}`
- `corp.finances.{credits,liabilities,assets,dailyRevenue,dailyCosts,taxRatePct,bondYieldPct,exchangeSalesTaxPct}`
- `corp.finances.{lifetimeRevenue,lifetimeCosts,incomeBySource,expensesByCategory,snapshots}`
- `corp.finances.{liquidity,liquidityCap,liquidityRegenPerHour,lastLiquidityTick} (phase-1 overlay only)`
- `corp.credits (stray, index.js:2445)`
- `corp.inventory[stationId][item]`
- `corp.mining.silicateExtractors`
- `corp.mining.silicateExtractor (legacy duplicate)`
- `corp.refineries`
- `corp.asteroidMining.{probeCount,maxProbes,maxDeployments}`
- `corp.asteroidMining.fabricationQueue`
- `corp.asteroidMining.activeExpeditions`
- `corp.asteroidMining.completedExpeditions`
- `corp.asteroidMining.scoutedBelts`
- `corp.unlocks.{marketSectors,maxUpgradeTier,maxFleetSize,maxBasicExtractorYards}`
- `corp.unlockedTech`
- `corp.completedInsights`
- `corp.offices`
- `corp.miningLeases`
- `corp.tradeHistory`
- `corp.activeMissions`
- `corp.completedMissions`
- `corp.agentReputation`
- `corp.contractOfferings.{missions,nextRefreshAt}`
- `corp.investments`
- `corp.stats.silicateSoldOnExchange`
- `Supabase: accounts, account_state.state_json (+__accountMeta), corporations, corp_finances, corp_military, corp_unlocks, corp_unlocked_market_sectors, corp_unlocked_tech, corp_milestones_completed, corp_buildings, corp_offices, corp_mining_leases, corp_extractors, corp_refineries, corp_asteroid_mining, corp_probe_fabrications, corp_expeditions, corp_expedition_yields, corp_scouted_belts, corp_station_inventory, corp_trade_history, corp_active_missions, corp_completed_missions, corp_agent_reputation, corp_contract_offerings, corp_contract_offering_missions, corp_rd_queue, corp_ceo_insight_queue, corp_completed_insights, account_notifications, account_messages`
- `Supabase tables with NO code path: refresh_tokens, corp_travel, corp_finance_snapshots`
- `Disk: data/state.json, data/accounts-snapshot.json (hashes + refresh tokens), *.tmp during atomic writes, kanban/kanbanState.json`

### TODOs in this code

- `server/gameState.js:132` — SYSTEM_DETAILS should be fetched from systems.json, see SYSTEMS_DATA (also 206: normalizeSystems should use SYSTEMS_DATA)
- `server/gameState.js:369` — Legacy single-extractor migration: is this still needed?
- `server/gameState.js:531` — Add force-stop functionality for extractor cycles
- `server/gameState.js:745` — Asteroid belts should be dynamic (finite ore, despawn, 20%/hour respawn, random composition)
- `server/gameState.js:761` — Rarity should be dynamic; exotic belts possible in Sol but rarer (and 774: rarity should gate resource types)
- `server/gameState.js:874` — Should SYSTEM_RARITY default to common? When is it null?
- `server/gameState.js:943` — Should BASE_EXCHANGE_SALES_TAX_PCT be hardcoded or stored in the DB?
- `server/gameState.js:1078` — Should starter corporation state be hardcoded or based on research etc.?
- `server/gameState.js:1176` — MISSION_TEMPLATES shouldn't be hardcoded; values should be more random
- `server/gameState.js:1322` — (spelled TOOD) Should lawYear increment on Jan 1st?
- `server/gameState.js:1336` — Remove legacy data from getSeedState().corp
- `server/gameState.js:1486` — Reevaluate how NPC_BUY_SEED is stored: hardcoded vs dynamic
- `server/gameState.js:1587` — Evaluate account persistence: frequent connection issues trigger the phase dual-write errors despite no server downtime
- `server/gameState.js:1615` — Remove all local disk account snapshots; all operations should go through the DB
- `server/gameState.js:1790` — Evaluate if createSeedAccountsStore (dummy account) is needed
- `server/gameState.js:2479` — Evaluate usage of refresh tokens
- `server/finances.js:80` — Save a snapshot of financial data every x minutes to Supabase (corp_finance_snapshots table exists but is unused)
- `server/index.js:51` — IS_DEV is redefined in gameState.js and index.js; move to a single file
- `server/index.js:54` — RESEARCH_LIBRARY should be extracted from the DB or research.json
- `server/index.js:274` — Remove NEAR_STAR_SYSTEMS; check values where travel is gated
- `server/index.js:500` — Consider a unified tick system instead of a separate setInterval per function
- `server/index.js:800` — Consider moving the API to a dedicated api.js
- `DEVELOPMENT_PHASES.md:73` — v0.5: refactor gameState.js and app.js into separate files
- `DEVELOPMENT_PHASES.md:90` — v0.5: performance audit (tick cost at scale, Supabase persistence frequency)

### Suspected defects (candidates — unverified, not filed)

- **sev 1** · `server/index.js:3092` — **Creating a sell order on any fresh checkout deducts the seller's inventory, then throws TypeError because state.market.orderBook is never initialised; the inventory loss is persisted, the order never exists, client gets a 500.**
  <br>Evidence: getSeedState (gameState.js:1318-1463) has no `market` key; ensureStateFile only creates market.npcBuyOrders (1485-1511) and never orderBook; the only writer of orderBook is resetDummyAccountProgress (2571). index.js:3047-3073 deducts inventory via mutateAccountState (which calls scheduleAccountsSave), then 3091-3094 does `draft.market.orderBook.unshift(order)` with no guard; the express error handler at 3390 returns 500. This checkout's generated data/state.json (dumped via python) has market.npcBuyOrders but no orderBook. tests/helpers/reset.js:11 masks this by setting orderBook=[] before integration tests. Not in the known list (which covers npcBuyOrders seeding and the missing GET route).
- **sev 1** · `server/index.js:2445` — **Mission rewards are never paid: complete-mission adds the reward to `state.corp.credits` (a field nothing reads) instead of `state.corp.finances.credits`, and the stray field is then persisted into state_json.**
  <br>Evidence: index.js:2443-2446 `state.corp.credits = (state.corp.credits || 0) + rewardCredits`; every other credit change in the file uses corp.finances.credits (e.g. 1060, 1133, 3145). grep for `corp.credits` finds only this line and the client mirror at public/scripts/app.js:5703, which has the same bug, so the UI also never shows the payout.
- **sev 2** · `server/gameState.js:2011` — **Chat is broken on any fresh checkout and the test suite is red: `chatLog` is never seeded, so appendChatMessage throws TypeError on `draft.chatLog[channel]`, and tests/schema/data-files.test.js fails.**
  <br>Evidence: getSeedState has no chatLog; normalizeStateShape/ensureStateFile never add it; resetChatHistory (2023) is exported but has no caller (grep server/ public/ tests/). index.js:3412 calls appendChatMessage from the socket handler; the throw lands in the uncaughtException logger at 390. Ran `npx vitest run`: 138 passed, 1 failed — data-files.test.js:224 `expect(data.chatLog).toBeDefined()` on this checkout's generated state.json. Client is safe because its deepClone is structuredClone (app.js:551).
- **sev 2** · `server/index.js:3430` — **Graceful shutdown does not flush: onShutdown calls saveAccountsNow() (which only arms a 500 ms debounced disk write and starts an un-awaited async Supabase persist) and then process.exit(0) synchronously, so up to 500 ms of account changes, the in-flight Supabase write, and any pending 300 ms global-state save are lost on every SIGINT/SIGTERM — including every `node --watch` restart in dev.**
  <br>Evidence: index.js:3429-3432; gameState.js:1934-1954 (saveAccountsNow → writeAccountsSnapshotToDisk, the debounced one at 1642-1650 whose timer is unref'd, then `await _runPersist…` which the caller never awaits); scheduleSave's saveTimer (1829) is never flushed at all. writeAccountsSnapshotToDiskNow (1630) exists but is not used here.
- **sev 2** · `server/gameState.js:2592` — **Persistence storm: every ticker pass calls mutateAccountState for every account, and mutateAccountState unconditionally calls scheduleAccountsSave, so in Supabase mode the ENTIRE account store (every account's full state_json, plus phase 1-3 delete/insert cascades if enabled) is upserted at least every 5 s forever, even with nobody online and nothing changed; getAccountById (2099) also saves on every read. This is the most plausible cause of the 'connection issues' noted at 1587.**
  <br>Evidence: index.js:467-484 miningTick (5 s) and seven more tickers (486-798) each loop getAllAccountIds() through mutateAccountState; gameState.js:2580-2593 has no dirty check; scheduleAccountsSave 1904-1932 starts _runPersistAccountsToSupabaseSerially immediately; persistAccountsStoreToSupabase 1550-1584 maps `Object.values(snapshot.accounts)` with no per-account dirty flag, deepCloning each state (1524). The old snapshot reportedly held 129 accounts (.gitignore comment), so each pass is ~129 blobs every ≤5 s.
- **sev 2** · `server/db/repositories/operationsRepo.js:407` — **With USE_NORMALIZED_TABLES=true the phase-3 overlay is lossy in ways that break play after any restart: fabricationQueue rows drop `type` (and `cost`), so fabricationTick never matches `job.type === "mining-probe"` and the paid-for probe is silently discarded; activeMissions rows drop `quota`, `reward`, `title` etc., so complete-mission answers 'no-quota' for every mission accepted before the restart; tradeHistory drops taxPct/taxAmount/proceeds.**
  <br>Evidence: In-memory shapes: index.js:1973-1979 (fabrication job has type/cost), 2390-2392 (activeMissions is a full template spread incl. quota). Mappers: operationsRepo.js:86-97 persists only id/started_at/completes_at/status; 201-214 persists only id/template/accepted/expires/progress/status. Overlays REPLACE the arrays wholesale: 407-414 and 465-475 (no merge with prior, unlike refineries at 356-379). Consumers: index.js:583 `if (job.type === "mining-probe")` then 588 removes the job regardless; index.js:2426 `if (!mission.quota) { outcome = "no-quota" }`. Flag default is off (supabaseClient.js:26-28); I could not verify production's value, so this is latent-or-live.
- **sev 3** · `server/gameState.js:1595` — **Within a single persist pass the state_json blob and the normalized tables can describe different moments: blob rows are built synchronously up front, but phases 1-3 re-read the live account objects after two awaited upserts, so a ticker mutation in between makes the overlay newer than the blob; on hydrate the overlay wins for its domains and the blob for the rest (e.g. finances/inventory from one instant, travel/investments/stats from an earlier one).**
  <br>Evidence: gameState.js:1555-1568 builds accountRows/stateRows (deepClone via stateWithAccountMeta) → 1570-1584 two awaits → 1595/1602/1609 pass the live `allAccounts` array to persistAccountsPhase1/2/3, whose mappers read account.state at call time (e.g. corporationRepo.js:8-28). hydrate order 1696-1753 (blob then overlays). Only matters when USE_NORMALIZED_TABLES is on.
- **sev 3** · `server/gameState.js:563` — **Extractor downtime recovery probability compounds instead of being 0.0276%/s: on a failed recovery roll lastTickAt is never advanced, so every subsequent call rolls with the full elapsed window since the outage began, and mutateAccountState invokes applyMiningOperations twice per call across eight tickers, so once the 15-minute floor passes recovery is near-certain within seconds.**
  <br>Evidence: gameState.js:562-578: elapsedMs = now - (lastTickAt || downtimeStartedAt); on failure `return` at 578 without touching lastTickAt; on the trigger path 608-612 also returns before the lastTickAt update at 654. After 15 min the per-roll chance is 1-(1-0.000276)^900 ≈ 22%, and index.js tickers plus mutateAccountState (2586, 2588) produce well over a dozen rolls per 5 s. tests/unit/applyMiningOperations.test.js:257-286 pins Math.random to 0 and calls once, so it cannot detect this.
- **sev 3** · `server/gameState.js:1080` — **Every account's state_json carries a full deep copy of world.systems (6 systems, 18 Sol bodies), world.refineryChains, the legacy seed `missions` array and `combatReports`, and every account's corp.id is the literal "corp-001"; this bloats every blob upsert in the storm above and nothing reads the per-account copies.**
  <br>Evidence: createStarterCorporationState deepClones baseState (1080) and only replaces corp (1082, spreading the seed corp so id "corp-001" from 1338 survives), queues (1153) and playerProfile (1158); getSeedState world at 1320-1335, missions at 1448-1460. normalizeStateShape rebuilds refineryChains per account on every hydrate (229-241). grep for `state.world`/`state.missions` readers in server/index.js: none; the client takes world from the global bootstrap (app.js:4821).
- **sev 3** · `server/finances.js:64` — **computeLiveLiabilities' office-lease term is always zero because no code ever writes office.leaseDailyCost or office.daysRemaining; reported liabilities/net worth omit outstanding office rent.**
  <br>Evidence: finances.js:62-69 reads office.leaseDailyCost/daysRemaining; grep across server/ and public/scripts/ finds no writer (the only hit is an unrelated local `daysRemaining` in app.js:1400). Offices are created at index.js:1135-1144 with rentedAt/rentedUntil/durationDays only. tests/unit/finances.test.js:116 passes because it injects those fields directly.
- **sev 3** · `server/gameState.js:2056` — **Ticker CPU waste: mutateAccountState and getAccountById return sanitizeAccount(), a JSON.parse(JSON.stringify()) of the entire account state, and all eight tickers discard that return value — 8 × N full-blob clones every 5-10 s on top of the persist clones.**
  <br>Evidence: gameState.js:2049-2057 (deepClone), 2593 and 2100 (always returned); index.js:470, 489, 507, 576, 613, 673, 722, 782 ignore the result.
- **sev 4** · `migrations/01_refresh_tokens.sql:1` — **Three migrated tables have no code path at all: refresh_tokens (01), corp_travel (07), corp_finance_snapshots (09). Refresh tokens are instead embedded in account_state.state_json.__accountMeta and the on-disk snapshot; travel and finance snapshots live only in the blob.**
  <br>Evidence: grep -rn 'corp_travel|refresh_tokens|corp_finance_snapshots' server/ tests/ returns nothing; gameState.js:1526 packs refreshTokens into the blob; finances.js:80 TODO acknowledges snapshots are not in Supabase.
- **sev 4** · `server/loadEnv.js:44` — **.env.local cannot override .env: files load in the order .env then .env.local and any key already present is skipped, which is the inverse of the usual convention.**
  <br>Evidence: loadEnv.js:37 `if (!key || process.env[key] !== undefined) continue;` and 44-45 `loadEnvFile(".env"); loadEnvFile(".env.local");`. tests/setup.js:5-9 documents having to set keys to "" rather than delete them because of this behaviour.
- **sev 4** · `server/gameState.js:1769` — **The comment says the dummy account is never persisted to Supabase, but it is: persistAccountsStoreToSupabase maps every account with no filter, and an empty accounts table causes the fallback store (dummy@isp.local with a bcrypt hash) to be seeded into production.**
  <br>Evidence: gameState.js:1550-1562 (no dummy filter), 1672-1676 (seeds fallbackStore into Supabase when accounts is empty), 1792-1815 (dummy definition); repositories/index.js:100-102 isPersistableAccount accepts it and tests/unit/phase1Repositories.test.js:230 asserts that.

### Test coverage, and what it does not cover

Verified by running `npx vitest run` (safe: tests/setup.js sets VERCEL=1 so IS_SERVERLESS short-circuits every disk write and the snapshot loader, ISP_DISABLE_TICKERS=1, blank Supabase env): 12 files, 139 tests, 138 pass, 1 FAILS — tests/schema/data-files.test.js:222 'contains market and chatLog sections' (chatLog absent from the generated state.json). What touches this subsystem: tests/unit/applyMiningOperations.test.js (pure mining maths, cost/affordability, minedRemainder carry, downtime trigger/15-min floor/recovery/safety tech, all with Math.random pinned and a single call); tests/unit/applyRefineryOperations.test.js (inactive/unknown-chain/before-endsAt/produces outputs; I did not verify it covers cycleScale); tests/unit/finances.test.js (ledgers, liabilities incl. the never-written leaseDailyCost fields, asset breakdown, snapshots cap); tests/unit/getEffectiveExchangeTaxRate.test.js; tests/unit/mergeDummyAccount.test.js; tests/unit/createCombatReport.test.js (the only test of the global mutateState path, combatReports cap 50); tests/unit/phase1/2/3Repositories.test.js (mapper and apply round-trips against fixture objects plus 'flag off ⇒ no-op'; no Supabase I/O; they do not assert that fabricationQueue.type or activeMissions.quota survive apply, so the lossy overlay passes); tests/integration/auth.test.js via supertest (register/login/refresh/logout/session/dummy/dev set-credits) — but in serverless mode scheduleSave and scheduleAccountsSave are no-ops, so nothing about persistence is exercised; tests/schema/data-files.test.js (catalog shapes + the failing state.json check). NOT covered anywhere: normalizeStateShape migrations (flat→per-station inventory, legacy extractor, lease/extractor relinking), ensureStateFile first-boot vs second-boot branches, safeWriteFile atomic write/retry/fallback, scheduleSave/scheduleAccountsSave/saveAccountsNow/flushPendingPersist/_runPersist mutex+requeue, hydrate fallback branches and stateWithAccountMeta/splitAccountStateAndMeta round trip, createStarterCorporationState shape (world leakage, corp.id), evaluateLevelProgress, refreshContractOfferings, mutateAccountState ordering and the double applyMiningOperations, all nine tickers (exported at index.js:3439-3449 but never imported by a test), onShutdown, market order routes (orderBook TypeError), NPC sell, chat socket, forums, complete-mission reward, loadEnv precedence, and any repeated-call/recovery-compounding scenario.

### Before you touch this in v0.5

- Severity scale used above: 1 = player-visible data loss or broken core action on a clean install; 2 = wrong persisted state or lost writes under normal operation; 3 = balance/performance/consistency drift; 4 = hygiene, docs, dead code.
- data/state.json is gitignored, so EVERY environment (dev, CI, Azure) self-seeds from getSeedState(); the seed is the contract and it currently omits market.orderBook, chatLog and forums. Fix the seed (or normalizeStateShape) rather than shipping a state.json; resetChatHistory (gameState.js:2023) already builds the chatLog shape and is unused.
- Importing server/gameState.js has side effects: sync read+rewrite of data/state.json (1519) and a top-level `await` on Supabase/disk hydrate (1818). Any refactor that splits the file must keep this ordering or every importer's startup changes; tests depend on VERCEL=1 to neuter it.
- IS_SERVERLESS (= Boolean(process.env.VERCEL), line 15) gates: tmp cleanup 51, safeWriteFile catch 90 (dead — every caller is already gated), ensureStateFile 1466/1472/1513, snapshot load 1617, snapshot write 1631/1643, scheduleSave 1821, scheduleAccountsSave 1916; index.js:407 (middleware) and 3422 (listen/shutdown). On Azure App Service none of these fire, so disk persistence, tickers and socket.io come back to life — and so do the storm (#5), the shutdown loss (#4) and the plaintext-hash snapshot on the server disk (data/accounts-snapshot.json, written whenever anything mutates, 1922/1945).
- Global state has no multi-instance story: one JSON file, sync writes, never in Supabase. Fine for a single Azure instance; anything with >1 instance or a container restart without a persistent volume loses market orders, forums and chat. Decide where world/market/forums/chat live before scaling out.
- Synchronous writes on the event loop: fs.writeFileSync/renameSync in safeWriteFile (64, 71, 81) via 1473, 1514 (boot), 1633 (500 ms debounced whole-store snapshot), 1830 (300 ms debounced global state); kanban.js:23 writeFileSync on POST; bcrypt.hashSync/compareSync at 1806, 2123, 2164. The snapshot is the whole accountsStore serialised each time — this scales with account count, not with change size.
- Node is single-threaded so a mutator cannot interleave with a ticker; there is no rollback, though: a mutator that throws (or, like the sell-order path, a request that mutates account state then throws on global state) leaves a half-applied change that the next ticker persists. Prefer validate-then-mutate inside every mutator and consider wrapping the two-store market mutations in one function.
- Persistence model to change for beta: (a) per-account dirty flags and per-account writes instead of whole-store upserts on every ticker/read; (b) skip scheduleAccountsSave when the mutator changed nothing; (c) make onShutdown await saveAccountsNow and use writeAccountsSnapshotToDiskNow; (d) treat account_state.state_json as the single source of truth and either delete the phase-1/2/3 overlay or make its mappers lossless (fabricationQueue.type/cost, activeMissions template fields, tradeHistory tax fields, queue ids become bigserial numbers on hydrate, completedInsights.completed_at is Date.now() at every persist).
- USE_NORMALIZED_TABLES defaults off (supabaseClient.js:26-28). I could not determine whether production Supabase has it on (nothing in hq handoffs/learnings mentions it). Do not enable it before the lossy-overlay fixes; if it is already on, defects #6/#7 are live today.
- Two Supabase admin clients exist (gameState.js:42 and supabaseClient.js:30) with duplicated flag logic; collapse to one when swapping Supabase for an Azure-hosted Postgres.
- Migrations: refresh_tokens (01), corp_travel (07), corp_finance_snapshots (09) are unused; corp.travel, corp.stats, corp.investments, finances.{snapshots,incomeBySource,expensesByCategory,lifetime*} and playerProfile.walkthroughCompleted's twin on accounts.walkthrough_completed only exist in the blob/accounts row. Refresh tokens live inside state_json.__accountMeta and in the disk snapshot — a security-hardening pass should move them to their table or drop the table.
- normalizeStateShape silently 'heals' data on every hydrate (default throughput 40 / cost 640 for inactive yards at 423-424, refineryChains rebuilt, extractors auto-linked to a sole lease at 513-519). This masks migration bugs; add a round-trip test (seed → blob → splitAccountStateAndMeta → deepEqual) before refactoring.
- Every new account currently inherits corp.id "corp-001" and a copy of world/missions/combatReports; strip them in createStarterCorporationState and in a one-off normalizeStateShape step so blobs shrink before beta traffic.
- The mission reward bug (index.js:2445) is mirrored in the client (public/scripts/app.js:5703); fix both and add a supertest for complete-mission that asserts finances.credits.
- Found-in commit for everything above: 4f92687 (the checkout has a single squashed commit).

---

<a id="client-shell-walkthrough"></a>

## client-shell-walkthrough

**Scope.** CLIENT SHELL (public/index.html, public/scripts/app.js bootstrap/tabs/walkthrough/dialogue/notifications/auth-fetch, login/register pages)

The shell is a single-page vanilla-JS app. public/index.html holds an unauthenticated marketing landing (#auth-shell, lines 23-236, hardcoded copy) and a hidden #game-shell (238-958): sticky header with a notifications dropdown, Replay Onboarding and Log Out (241-261); a sidebar with Corporation Identity (<dl id="corp-identity">, 269-271) and Quick Actions (data-jump buttons, 279-289); a flat row of 15 tab buttons with data-tab (292-308; the six groups of nav.app-nav since AB#764) matched by id to 15 article.tab-panel siblings (311-958); and three root-level modals sharing .modal-backdrop (trade-confirm 961, dialogue 973, walkthrough 983). app.js (6641 lines, ESM, imports charts.js and starmap.js) keeps one module-level appState (4-52), caches DOM refs at import time (283-311), and creates the socket unauthenticated at load (399). boot() (6569-6639) hydrates isp.* tokens from localStorage, binds everything, loads /api/bootstrap + /api/stations + /api/buildings, then either dummy-logs-in (?dummy=1, localhost only) or restores the session via GET /api/auth/session and calls enterGame (5145-5190), which flips the shells, runs updateAllViews (4789-4837: every tab re-rendered unconditionally on every state change), mounts the starmap, optionally shows the walkthrough offer, loads notifications and starts a 1s UI ticker (2964-3017) that also polls refreshFromServer every 60s while cycles run. Auth: login.html/register.html are separate static pages whose scripts POST to /api/auth/login|register, write isp.accountId/accessToken/refreshToken to localStorage and redirect to /?account=<id> (login-page.js:76-91, register-page.js:29-45); apiFetch (512-531) adds Authorization: Bearer and on 401 performs one POST /api/auth/refresh with the rotating refresh token (485-510), else handleSessionExpired (435-448) redirects to /login.html?reason=expired. Onboarding: runIntroDialogue (802-836) drives showDialogue (770-792) with a 14ms/char typewriter (754-768); promptWalkthroughOffer (5113-5136) -> startWalkthrough (5107) -> renderWalkthroughStep (5083-5105) walks 12 walkthroughSteps (207-280) by switching tab and adding .walkthrough-focus to a selector; Next/End (6551-6566) call completeWalkthroughForAccount (5046-5063) and setTab("rnd"). Feedback/errors: there is no toast system; pushFeedback (616-625) writes an 8-entry log into the Overview #feedback-log, forms write to their own *-status paragraphs, boot failures overwrite #auth-shell with a .alert (6624, 6636), and showMissionCompleteOverlay (4461-4515) is the only celebratory overlay. Realtime: bindRealtimeEvents (5852-6009) listens for state:init, chat:new, market:updated, forums:updated, finance:updated, finance:snapshot (registered twice), notifications:new, ceo/rnd/travel/mining/expedition/fabrication events, all filtered client-side by payload.accountId because the server io.emit()s every per-account event to every socket.

### Entry points

- `boot` — `public/scripts/app.js:6569` — DOMContentLoaded entry: hydrateSession, bind all handlers, load bootstrap+registries, dummy-login or restore session
- `enterGame` — `public/scripts/app.js:5145` — Switch auth-shell to game-shell, seed appState, updateAllViews, mount starmap, offer walkthrough, load notifications, start UI ticker
- `updateAllViews` — `public/scripts/app.js:4789` — Re-render every tab and sidebar from appState.data (called after every state change and by socket handlers)
- `setTab` — `public/scripts/app.js:4984` — Tab switch by id; honours TRAVEL_ALLOWED_TABS lockdown; triggers starmap resize, inbox load, chat scroll
- `bindTabs` — `public/scripts/app.js:5015` — Wire the navigation's .nav-tab and .nav-group__button, sidebar [data-jump] quick actions and delegated requirement-card jumps
- `enforceTravelTabLockdown` — `public/scripts/app.js:2073` — Show/hide Travel tab, disable non-allowed tabs while corp.travel.arrivesAt is set
- `apiFetch` — `public/scripts/app.js:512` — fetch wrapper adding Bearer token; single 401 retry after refreshSessionToken
- `refreshSessionToken` — `public/scripts/app.js:485` — POST /api/auth/refresh with stored refresh token; persists new pair or expires session
- `handleSessionExpired` — `public/scripts/app.js:435` — Clear localStorage session, stop ticker, redirect to /login.html?reason=expired (1s re-entrancy guard)
- `restoreAuthenticatedSession` — `public/scripts/app.js:5263` — GET /api/auth/session then enterGame('account', ...) with autoPromptWalkthrough
- `loadBootstrap` — `public/scripts/app.js:5204` — GET /api/bootstrap into appState.serverData; sets #app-version-line from version
- `loadStationRegistry` — `public/scripts/app.js:5222` — GET /api/stations and /api/buildings (raw fetch, best-effort) into stationRegistry/buildingRegistry
- `refreshFromServer` — `public/scripts/app.js:5295` — Full reload of account + shared state; used by socket completion events and the 60s ticker poll
- `bindRealtimeEvents` — `public/scripts/app.js:5852` — Register all socket.io listeners (state:init, chat:new, market/forums/finance updates, notifications:new, completion events)
- `bindGlobalControls` — `public/scripts/app.js:6471` — Logout, Replay Onboarding, map overlay, notification toggle/read-all, walkthrough Prev/Next/End
- `bindAuthControls` — `public/scripts/app.js:6011` — Legacy in-page login/register panel wiring; every element it queries is absent from index.html, so it is dead
- `showDialogue` — `public/scripts/app.js:770` — Fill #dialogue-modal, run typewriter, then append choice buttons / Continue
- `typeDialogueText` — `public/scripts/app.js:754` — setInterval typewriter at 14ms/char into #dialogue-text (no skip)
- `runIntroDialogue` — `public/scripts/app.js:802` — Aria Voss two-beat intro; only reachable from Replay Onboarding today
- `walkthroughSteps` — `public/scripts/app.js:207` — 12-step array {selector,title,text,tab}
- `promptWalkthroughOffer` — `public/scripts/app.js:5113` — Operations AI Start/Skip dialogue; marks isp.walkthrough-offer-seen:<id> before the answer
- `renderWalkthroughStep` — `public/scripts/app.js:5083` — setTab(step.tab), add .walkthrough-focus to step.selector, scrollIntoView, set modal text and buttons
- `completeWalkthroughForAccount` — `public/scripts/app.js:5046` — POST /walkthrough-complete (best-effort), replace appState.data, updateAllViews
- `resetWalkthroughForAccount` — `public/scripts/app.js:5065` — POST /walkthrough-reset for Replay Onboarding
- `pushFeedback / renderFeedbackLog` — `public/scripts/app.js:616` — 8-entry command feedback log rendered into Overview #feedback-log (the de-facto toast/alert channel)
- `renderNotifications / loadNotifications` — `public/scripts/app.js:680` — Header dropdown list + unread badge from GET /api/accounts/:id/notifications
- `updateCorpIdentity` — `public/scripts/app.js:1211` — Sidebar identity <dl> (corporation, CEO, location, level, employees, slots, fleet cap)
- `updateOverview / renderLevel2Progress` — `public/scripts/app.js:2783` — Overview KPI cards and next-level requirement cards with data-jump navigation
- `showTradeConfirmation` — `public/scripts/app.js:575` — Promise-based confirm modal (#trade-confirm-modal) reused by market actions
- `showMissionCompleteOverlay` — `public/scripts/app.js:4461` — Celebration overlay with particle burst; the only reward moment in the shell
- `startMiningUiTicker` — `public/scripts/app.js:2964` — 1s interval re-rendering queues/refinery/expeditions/timers; refreshFromServer every 60 ticks when cycles active
- `login form submit` — `public/scripts/login-page.js:55` — POST /api/auth/login, store tokens in localStorage, redirect to /?account=<id>
- `register form submit` — `public/scripts/register-page.js:11` — POST /api/auth/register, store tokens, redirect to /?account=<id> (no intro dialogue)
- `#game-shell` — `public/index.html:238` — Authenticated shell: header (241), sidebar (263-290), the navigation (nav.app-nav, AB#764), tab panels (311-958)
- `modals` — `public/index.html:961` — #trade-confirm-modal 961, #dialogue-modal 973, #walkthrough-modal 983 (all .modal-backdrop)
- `GET /api/auth/session` — `server/index.js:948` — Session restore endpoint used by boot (requireAuth 319, sanitizeAccount gameState.js:2049)
- `POST /api/auth/refresh` — `server/index.js:911` — Rotating refresh: revokes presented token then issues a new pair
- `walkthrough-complete / walkthrough-reset` — `server/index.js:970` — Persist walkthroughCompleted and push an onboarding notification (989 for reset)
- `notifications routes` — `server/index.js:1008` — list (1008), per-id read (1018, unused by client), read-all (1028)
- `io.on('connection')` — `server/index.js:3395` — Unauthenticated socket; emits full getState() as state:init; chat:send accepts client-supplied author

### State this subsystem reads or writes

- `appState.serverData (global bootstrap: world, market, forums, chatLog, combatReports, conglomerates, version)`
- `appState.data (per-account state clone)`
- `appState.authenticated`
- `appState.accountId`
- `appState.accountEmail`
- `appState.accessToken`
- `appState.refreshToken`
- `appState.profileMode ('account' only; 'dummy' branches unreachable)`
- `appState.walkthroughCompleted`
- `appState.walkthroughIndex`
- `appState.activeTypewriter`
- `appState.feedbackLog`
- `appState.notifications`
- `appState.unreadNotifications`
- `appState.mapMounted`
- `appState.stationRegistry`
- `appState.buildingRegistry`
- `appState.miningUiTicker`
- `appState.requirementsInitialized`
- `appState.completedRequirementIds`
- `appState.activeMissions`
- `localStorage isp.accountId`
- `appState.accessToken (memory only, AB#757)`
- `cookie isp_refresh (HttpOnly, Secure, SameSite=Strict, path /api/auth; AB#757)`
- `localStorage isp.walkthrough-offer-seen:<accountId>`
- `corp.corporationName`
- `corp.ceo`
- `corp.location`
- `corp.level`
- `corp.levelCap`
- `corp.employeeCount`
- `corp.employeeCap`
- `corp.buildingSlots`
- `corp.unlocks.maxFleetSize`
- `corp.finances.credits`
- `corp.finances.dailyRevenue`
- `corp.finances.dailyCosts`
- `corp.finances.snapshots (via charts.js)`
- `corp.military.attackValue`
- `corp.military.defenseValue`
- `corp.conglomerateId`
- `corp.travel.arrivesAt`
- `corp.currentStationId`
- `corp.currentSystemId`
- `corp.levelProgress.level<N>.requirements[] (id,title,progress,target,complete)`
- `corp.milestonesCompleted`
- `corp.asteroidMining.{probeCount,maxProbes,maxDeployments,activeExpeditions,scoutedBelts}`
- `corp.activeMissions`
- `corp.mining.silicateExtractors`
- `corp.inventory`
- `world.systems`
- `queues.corporateRnD`
- `queues.ceoInsight`
- `playerProfile.walkthroughCompleted`
- `account.walkthroughCompleted (server accountsStore.accounts[id].walkthroughCompleted)`
- `account.notifications[] {id,type,title,body,createdAt,readAt}`
- `account.refreshTokens[] (server only; stripped by sanitizeAccount)`

### TODOs in this code

- `public/index.html:2` — TODO: Content should be fetched from database (landing copy hardcoded)
- `public/scripts/app.js:67` — TODO: techTree should be fetched from db or research.json
- `public/scripts/app.js:190` — TODO: insightPrograms store in DB or fetch from insight.json
- `public/scripts/app.js:206` — TODO: Move walkthroughSteps to dedicated file
- `public/scripts/app.js:533` — TODO: consolidate helper functions (toCurrency etc.)
- `public/scripts/app.js:558` — TODO: refreshBeltCompositions must change when belts become dynamic
- `public/scripts/app.js:801` — TODO: Expand design of intro dialogue
- `public/scripts/app.js:837` — TODO: Remove createNewPlayerState (duplicate of server logic) — verified: no call sites in app.js
- `public/scripts/app.js:2061` — TODO: Overhaul Travel Page design
- `public/scripts/app.js:4788` — TODO: updateAllViews performance — do we always need to update every view?
- `public/scripts/app.js:5045` — TODO: completeWalkthroughForAccount duplicate found in gameState.js
- `public/scripts/app.js:5064` — TODO: resetWalkthroughForAccount duplicate?
- `public/scripts/app.js:5285` — TODO: loginDummyAccount duplicate possibly in gameState.js
- `public/scripts/app.js:5857` — TODO: Investigate current socket.io implementation
- `public/scripts/login-page.js:4` — TODO: Move IS_DEV_ACCESS duplicate to a single file (also duplicated STORAGE_KEYS in register-page.js:4)
- `public/scripts/register-page.js:10` — TODO: Implement email verification
- `public/login.html:2` — TODO: page header should be loaded from a standalone shared file (same in register.html:2)
- `public/styles.css:1` — TODO: Organize CSS (5,300+ line single stylesheet)
- `Todos.md:24` — [ ] Overhaul the guided first-session walkthrough to fully conform to the 11-step sequence in NEW_PLAYER_EXPERIENCE.md
- `DEVELOPMENT_PHASES.md:84` — [ ] Tutorial / NEW_PLAYER_EXPERIENCE polish pass against the live build

### Suspected defects (candidates — unverified, not filed)

- **sev 2** · `public/styles.css:2036` — **The walkthrough cannot be followed: its modal backdrop covers the whole viewport and swallows clicks, so steps that tell the player to act (enter Orbital Executive Suites, file a lease, commission a yard, launch a cycle) are impossible without pressing End Walkthrough, which marks the walkthrough complete server-side and jumps to the R&D tab.**
  <br>Evidence: VERIFIED by code reading (not run in a browser). .modal-backdrop is position:fixed; inset:0; z-index:60; display:grid (styles.css:2036-2044) with no pointer-events passthrough, and #walkthrough-modal uses it (index.html:983). Steps 4,6,7,8 instruct actions (app.js:227-256). walkthroughEnd handler: stopWalkthrough(); completeWalkthroughForAccount(); setTab('rnd') (app.js:6562-6566); Next on last step does the same (6551-6557). completeWalkthroughForAccount POSTs /walkthrough-complete (5046-5063 -> server/index.js:970).
- **sev 2** · `server/index.js:469` — **Every player's credits, inventory and extractor state, plus every notification, are broadcast to every connected (unauthenticated) socket each tick; the client only filters by payload.accountId, so anyone with devtools can watch all corporations in real time. On Vercel the tickers are inert (known); on the planned Azure host this leak becomes live.**
  <br>Evidence: VERIFIED. miningTick io.emit('mining:updated', {accountId, extractors, inventory, credits}) for every account (server/index.js:469-480); io.emit('notifications:new', {accountId, notification}) at 528, 598, 660, 709, 762, 983, 1002 and ~20 route handlers; io.on('connection') has no auth middleware and emits full getState() (3395-3396). Client creates io() at module load before auth (app.js:399) and filters with payload?.accountId !== appState.accountId (5941, 5952, 5959, 5966, 5980, 5999, 6005).
- **sev 3** · `public/scripts/app.js:5911` — **The Financial Core dashboard never live-updates from the server's 30s snapshot tick: the client's finance:updated handler bails unless profileMode==='dummy' (never set), the finance:snapshot handler is registered twice, and the server never emits finance:snapshot at all.**
  <br>Evidence: VERIFIED. Handler: if (!appState.data || appState.profileMode !== 'dummy') return (app.js:5911-5913). All four enterGame calls pass 'account' (5274, 6048, 6096, 6602). Duplicate socket.on('finance:snapshot') at 5922 and 5931. grep 'finance:snapshot' server/*.js returns nothing; financialSnapshotTick emits finance:updated instead (server/index.js:778-793).
- **sev 3** · `public/scripts/app.js:6059` — **The Aria Voss intro dialogue never plays for a newly registered player; bindAuthControls (6011-6112), which contains the only registration-time call to runIntroDialogue, is dead because every element it queries is absent from index.html.**
  <br>Evidence: VERIFIED. Element lookups login-panel/register-panel/show-login-btn/login-dummy-btn/login-cancel-btn/register-cancel-btn/register-form (app.js:295-301) have no matching ids in index.html (only show-register-btn exists, index.html:93, as an <a>); bindAuthControls returns at 'if (!registerForm) return' (6059). Registration actually happens on register.html -> register-page.js:29-45 -> redirect /?account= -> boot -> restoreAuthenticatedSession -> enterGame (5274-5282) -> promptWalkthroughOffer only. runIntroDialogue call sites: 6095 (dead) and 6499 (Replay Onboarding).
- **sev 3** · `public/scripts/app.js:512` — **Two concurrent authenticated requests that both hit 401 (access token just expired) each call refreshSessionToken with the same rotating refresh token; the server revokes it on first use, so the second refresh gets 401 and handleSessionExpired force-logs the player out.**
  <br>Evidence: PLAUSIBLE (race not reproduced). apiFetch has no in-flight refresh dedupe (app.js:512-531 -> refreshSessionToken 485-510 -> handleSessionExpired on !ok). Server revokes then reissues (server/index.js:928-933); tests/integration/auth.test.js:102 asserts re-use of a rotated token is 401. Concurrent authed calls exist: expedition:completed runs refreshFromServer() and loadMessages() together (6001-6002); the 1s ticker's refreshFromServer (3013) can overlap any user action. Access token TTL 7d (server/index.js:277).
- **sev 3** · `public/scripts/app.js:1215` — **Sidebar identity injects corp.corporationName and corp.ceo into innerHTML unescaped, and the server stores them without stripHtml; today this is self-XSS only, but the same fields are shown to other players elsewhere and tokens live in localStorage, so any future unescaped rendering of another corp's name is account takeover.**
  <br>Evidence: VERIFIED. updateCorpIdentity template `<dd>${corp.corporationName}</dd><dd>${corp.ceo}</dd>` (app.js:1215-1216) while escapeHtml is used for location on 1217. createAccount only trims (server/gameState.js:2186-2190). Other renderings do escape: inbox fromName (app.js:6212), forum author (4019), market seller (3846). renderNotifications also injects title/body/type unescaped (692-703); all current bodies are server-composed (e.g. gameState.js:2205-2209).
- **sev 3** · `public/scripts/app.js:274` — **Walkthrough end state drifts from its own copy and the design docs: the final step ('You're Ready!') is on Overview but Finish/End land on the R&D tab; NEW_PLAYER_EXPERIENCE.md ends on Missions; custom-instructions says the walkthrough cannot be skipped on first run but the offer has 'Skip For Now', and the offer is marked seen before the player answers, so closing the tab during the prompt suppresses it forever on that device.**
  <br>Evidence: VERIFIED. Last step tab:'overview' (app.js:274-280); setTab('rnd') at 6555 and 6565. NEW_PLAYER_EXPERIENCE.md final paragraph: 'It then takes them to the Missions page'. .github/custom-instructions.md:20 'cannot be skipped on first run'. promptWalkthroughOffer calls markWalkthroughOfferSeen first (5114) then offers Skip (5128-5133); hasSeenWalkthroughOffer gates the offer in enterGame (5180-5186).
- **sev 3** · `public/styles.css:2054` — **The amber walkthrough focus ring is invisible for targets inside a tab panel: .walkthrough-focus relies on z-index:61 to rise above the z-60 backdrop, but .tab-panel has backdrop-filter which creates a stacking context, trapping in-panel targets (steps 4 and 6 building buttons) beneath the dimmed backdrop; only the tab buttons in the old tab row could rise.**
  <br>Evidence: INFERRED from CSS stacking rules; not screenshot-verified. .walkthrough-focus {position:relative; z-index:61} (styles.css:2054-2060); .tab-panel shares backdrop-filter: blur(5px) (1027-1036); .modal-backdrop z-index:60 (2036-2044). Building selectors are rendered inside #station.tab-panel (app.js:2323 within renderStation; steps at 227, 239).
- **sev 4** · `public/scripts/app.js:3067` — **renderActionHints (3057-3125) and bindLevel2Controls (4889-4982) are dead: the Overview hire/build/mine form ids they require do not exist in index.html, so both return at their guard; renderMiningCyclePanel is therefore only reached via the 1s ticker.**
  <br>Evidence: VERIFIED. grep of index.html for level2-hire-form|mine-form|hire-action-hint|build-action-hint|mine-btn returns nothing; guards at app.js:3067-3069 and 4900-4902; renderMiningCyclePanel call sites 2971 (ticker) and 3124 (unreachable).
- **sev 4** · `public/scripts/app.js:5314` — **All profileMode==='dummy' branches are unreachable; the state:init dummy branch would wholesale replace appState.data with the global state if it ever ran.**
  <br>Evidence: VERIFIED. 'dummy' checks at 5314, 5865, 5912; enterGame mode argument is 'account' at every call (5274, 6048, 6096, 6602); loginDummyAccount (5286) returns a normal account and callers pass 'account'.
- **sev 4** · `public/scripts/app.js:697` — **Individual notifications cannot be marked read: items render data-notification-id but nothing binds a click, so the server's per-id read route is unused and only Mark All Read works.**
  <br>Evidence: VERIFIED. Rendered at app.js:697; the only notification handlers are toggle (6513-6521) and read-all (6524-6541); server route POST /notifications/:notificationId/read exists at server/index.js:1018.
- **sev 4** · `public/scripts/app.js:754` — **Dialogue typewriter cannot be skipped and choice buttons only appear after it finishes, forcing ~2-3s waits per beat (relevant to the Board's 'rewarding, modern' design pass).**
  <br>Evidence: VERIFIED. setInterval at 14ms/char with no click-to-complete (app.js:754-768); showDialogue appends choices only in the onDone callback (770-792). Aria Voss advice text ~190 chars (app.js:814).
- **sev 4** · `public/scripts/app.js:5083` — **Latent: walkthrough steps 6-8 lose their target when a station building detail view is open, because renderWalkthroughStep only switches tab and renderStation keeps an open building view; matters once the backdrop click-blocking (defect 1) is fixed.**
  <br>Evidence: INFERRED. renderWalkthroughStep never calls showStationOverview (app.js:5083-5105); renderStation preserves overviewView.hidden when #station-building-view is open (2295-2300); step selectors '[data-building-action=...]' live in the overview grid (2323).

### Test coverage, and what it does not cover

There are zero client-side tests: vitest runs in environment 'node', includes only tests/**/*.test.js and measures coverage on server/** (vitest.config.js:4-14); package.json has no jsdom, happy-dom or playwright. Nothing exercises index.html, app.js, login-page.js or register-page.js (setTab, travel lockdown, walkthrough stepping, dialogue, apiFetch 401 retry, session restore, socket handlers, notifications UI). Indirect coverage of the server endpoints the shell depends on: tests/integration/auth.test.js covers register/login/refresh rotation (lines 90-130, including re-use of a rotated token = 401 at 102), logout (132), GET /api/auth/session (147-167), dummy-login/reset (169-185), requireAccountAccess (186-207), and the public bootstrap/stations/buildings routes (209-233); tests/schema/data-files.test.js validates the shape of stations.json/buildings.json (18-64) that loadStationRegistry consumes. NOT covered: /walkthrough-complete, /walkthrough-reset, /notifications, /notifications/:id/read, /notifications/read-all (grep tests/ for these: no match), socket.io connection/emit behaviour, and the /?account= restore flow. There is no CI: .github/ contains only custom-instructions.md.

### Before you touch this in v0.5

- Found-in commit 4f92687 (HEAD, package.json version '0.4'); repo is clean on main. All line numbers above are from that commit.
- app.js is one 6641-line module that queries DOM refs at import time (283-311) and assumes index.html; some functions guard nulls, others do not (updateCorpIdentity 1212-1213 assumes #corp-identity; bindGlobalControls 6511 assumes #map-overlay). Any redesign that renames ids must sweep app.js, and any test harness must load index.html before importing app.js.
- Everything re-renders on every state change (updateAllViews 4789-4837) and a 1s ticker (2964-3017) re-renders queues/refinery/expeditions/starmap progress; updateAllViews has no per-renderer try/catch, so one throw aborts the rest (renderInboxMessageList is last). A richer UI must budget for this or introduce dirty-flag rendering (TODO at 4788).
- Auth model for the Board's review: tokens in localStorage (persistSession 401-413), access 7d / refresh 30d (server/index.js:277-279), rotation on refresh (911-937), JWT_SECRET falls back to a hardcoded dev string (280), sanitizeAccount strips passwordHash/refreshTokens before any response (gameState.js:2049-2058). Login/register are separate static pages duplicating STORAGE_KEYS and IS_DEV_ACCESS (login-page.js:5-14, register-page.js:4-8); the game page treats /?account=<id> as a 'try restore' trigger only (boot 6614-6636). Session-expired UX is a hard redirect to /login.html?reason=expired (427-448).
- Socket is unauthenticated (io() at 399; server 3395) and everything is io.emit broadcast; chat:send trusts a client-supplied author (server/index.js:3398-3414). Moving to Azure App Service with WebSockets makes the tickers live for the first time (they are inert on Vercel), so socket auth + per-account rooms should land in the same pass as the host move.
- Hosting hooks to revisit for Azure: vercel.json routes everything to server/index.js; server/index.js gates persist middleware and listen() on process.env.VERCEL (407, 3419); gameState.js IS_SERVERLESS = Boolean(process.env.VERCEL) (15); tests/setup.js sets VERCEL=1 (20) to suppress disk writes — an Azure branch needs a different flag for that. /kanban is served publicly with no auth (server/index.js:427-434). /api/bootstrap and state:init send the legacy single-player corp/playerProfile/queues/missions from data/state.json to unauthenticated visitors (server/index.js:802-804, 3396; keys verified).
- Walkthrough mechanics: 12 steps (207-280) vs the 11-step NPE doc; step 1's target (ISA charter mail) does exist — createAccount seeds an ISA Settlement Licence message and a 'Corporation Registered' notification (gameState.js:2205-2226). Steps 4/6 need the player docked at a station whose buildingIds include orbital-executive-suites and isa-claims-leases; in open space renderStation renders no buildings (2277-2291). Offer state is per-device localStorage (isp.walkthrough-offer-seen:<id>, 456-477); the server only knows walkthroughCompleted. Replay Onboarding is hidden at level >= 5 (1240-1244).
- Design-system facts for the visual pass: tokens at styles.css:4-22 (void-black #05050f, cold-navy, electric-cyan #00f7ff, muted-amber #ffaa33, panel rgba), fonts Inter/Orbitron/Rajdhani via Google Fonts (index.html:8-13), single dark theme with no prefers-color-scheme handling, no favicon/manifest/theme-color (index.html:4-19). Responsive: .layout-grid collapses to one column at <=960px (2113-2119), the old tab row was 15 wrapping pills (1113-1128), .notification-panel min(420px,86vw) (945-957), #game-shell height:100vh with sticky header (892-908). .tab-panel padding is declared twice (1052 vs 1136). Tab nav has no ARIA tablist/tab/aria-selected semantics (index.html:292-308; setTab only toggles classes 4984-5013).
- Feedback channels today: pushFeedback -> Overview #feedback-log only (616-678; invisible from other tabs), per-form *-status paragraphs, .alert on boot failure (6624/6636), showTradeConfirmation promise modal (575-610), showMissionCompleteOverlay celebration (4461-4515 with particleBurst keyframes at styles.css:4791-4940). There is no global toast/snackbar; a 'rewarding' redesign will need one plus a level-up moment (renderLevel2Progress only adds a just-completed class, 2894-2900).
- Chart.js is loaded from jsdelivr (index.html:16) and guarded by typeof Chart (charts.js:408); /socket.io/socket.io.js is served by the Node server (index.html:17) and io is null when absent (399), so bindRealtimeEvents no-ops silently (5853-5855).
- Dead code safe to delete in v0.5: bindAuthControls (6011-6112), createNewPlayerState (838-896, no call sites), renderActionHints/bindLevel2Controls (3057-3125, 4889-4982), the milestone-list branch in updateCorpIdentity (1224-1237, element absent), profileMode 'dummy' branches (5314, 5865, 5912), duplicate finance:snapshot listener (5931-5938), updateInvestmentPanel/renderCombatReports stubs (2781, 4730).

---

<a id="client-screens"></a>

## client-screens

**Scope.** CLIENT SCREENS — public/scripts/app.js tab renderers (Overview, Station + building/lease/extractor views, Financial Core, Corporate R&D, CEO Insight, Refinery Chains, Galactic Exchange, Assets, Logistics, Comms, Forums, Assignments, Inbox, Travel, Starmap) plus their entry points in starmap.js / charts.js and the DOM contract with public/index.html

All fifteen tabs live in one 6,641-line ES module (public/scripts/app.js) that holds a global `appState` (app.js:4-51), a set of hard-coded catalogs (research techTree 68-188, insightPrograms 191-204, walkthroughSteps 207-280, RESOURCE_CATALOG 3185, MILESTONE_ROADMAP 3191, REPUTATION tables 4309-4322, MISSION_AGENTS 4337-4359, REQ_TAB 2841-2877, LEASE_BODIES 1667-1671) and one render function per tab. Every state change (any POST response, socket `state:init`, the 60 s active-cycle refresh) funnels through `updateAllViews()` (app.js:4789-4835), which unconditionally re-renders all tabs, the sidebar, both R&D queues, the Chart.js finance charts and the starmap, whether or not they are visible; a separate 1 s ticker (`startMiningUiTicker`, 2964-3016) additionally rebuilds the Refinery tab DOM every second (with a focus-restore hack at 3263-3353), re-renders the Assembly Facility view if open, and updates the contract countdown. Tabs are static `<article class="tab-panel">` blocks in index.html (311-956) toggled by `setTab` (4984-5013); travel state hides/locks tabs via `enforceTravelTabLockdown` (2073-2111). Station is the only tab with sub-navigation: NPC building cards dispatch to `showStationBuilding` (1256) → `renderBuildingDetail` (1276), which has bespoke views only for Orbital Executive Suites (1354/1467), ISA Claims & Leases (1612/1720) and the per-lease extractor panel (1766/1942); every other "available" building falls through to a "not yet operational" stub (1318-1330) and the ISA Contracting building redirects to the Assignments tab (1291-1297). The client and index.html have drifted: sixteen element ids app.js renders into no longer exist (level2 hire/build/mine forms, mine-cycle-list, listing-item/quantity/submit, milestone-list, combat-reports), so ~600 lines are silently dead and one call site (`renderInventoryPanel()` at 5719) now throws. The most consequential findings are server-visible from these screens: mission rewards are credited to `corp.credits` instead of `corp.finances.credits` (index.js:2445) while the Assignments overlay tells the player "Reward Credited" (app.js:4480); the Assembly Facility "Construct" button is rendered into one grid and bound in another (2372-2376 vs 2434) so probes/expeditions are unreachable from the UI; the Forums tab cannot create a first thread on a fresh install because `forums.categories` is never seeded (app.js:4239-4245, index.js:2934, data/state.json has no `forums` key); and forum like-handlers stack on a persistent container (4106) so likes toggle N times.

### Entry points

- `updateAllViews` — `public/scripts/app.js:4789` — Orchestrator: applies shared server state then re-renders every tab, sidebar, queues, charts, starmap and inbox list on every state change (verified caller list: every POST handler, socket state:init 5870, refreshFromServer 5308/5321, enterGame 5169).
- `boot / enterGame / refreshFromServer` — `public/scripts/app.js:6569` — Boot binds all static handlers (6572-6582), loads /api/bootstrap + /api/stations + /api/buildings (6585), restores session from localStorage (5263) or dummy-logs-in via ?dummy=1 when IS_DEV_ACCESS (6589-6611); enterGame (5145) always sets profileMode 'account', opens Overview, mounts starmap, prompts walkthrough, starts the 1 s ticker.
- `startMiningUiTicker` — `public/scripts/app.js:2964` — 1 s interval: re-renders dead mine-cycle/action-hint panels, both R&D queues, the whole Refinery tab, the open Assembly Facility view, expedition panels and the contract countdown; every 60 ticks calls refreshFromServer if an extractor/refinery/expedition is active (3007-3015).
- `setTab / bindTabs / enforceTravelTabLockdown` — `public/scripts/app.js:4984` — Tab switching by data-tab; blocks non-allowed tabs during travel (TRAVEL_ALLOWED_TABS 2062); starmap resize on show; inbox lazy-load on show (5001-5003).
- `Overview: updateOverview` — `public/scripts/app.js:2783` — Four cards: Cash Reserves, Net Daily Flow, Conglomerate Status (data.conglomerates, seed has 0), Military Power (corp.military ATK/DEF, non-feature). No empty state; static lede in index.html:312-316.
- `Overview: renderLevel2Progress` — `public/scripts/app.js:2829` — Renders corp.levelProgress[level{N+1}].requirements as clickable cards using client REQ_TAB map (2841-2877); 'just-completed' animation via appState.completedRequirementIds; empty state 2891-2895 when no next level defined.
- `Overview: renderExpeditionPanel / renderFeedbackLog` — `public/scripts/app.js:4839` — Belt expedition progress cards (hidden when none, 4843-4845); Command Feedback list of last 8 pushFeedback entries (664-678).
- `Station: renderStation` — `public/scripts/app.js:2265` — Station header from appState.stationRegistry; NPC building cards filtered to owner==='npc' && available (2318); Operational Facilities (Assembly/Refinery corp buildings + 'Construct Assembly' card, 2343-2393); Licensed Corporate Holdings = extractors whose lease body matches station body (2395-2431). In-space empty state 2277-2291.
- `Station: showStationBuilding / renderBuildingDetail` — `public/scripts/app.js:1256` — Building detail dispatcher: OES → renderOrbitalExecutiveSuites; ISA Claims → renderISAClaimsLeases or renderLeaseManagement when appState.stationActiveLease set; isa-contracting → redirect to missions tab; anything else → 'not yet operational' stub (1318-1330).
- `Station: renderOrbitalExecutiveSuites / bindOfficeActions` — `public/scripts/app.js:1354` — Lease-office panel (cost shown = station.officeCost||20000 'one-time', 1360/1381), office status with expiry countdown, renew form (7/14/21/28 days @ $1,000/day, 1434-1439), hire form ($2,000 + $150/day, 1448). POSTs rent-office (1482, sends only stationId), renew-office (1535), hire (1580).
- `Station: renderISAClaimsLeases / bindISAClaimsLeasesActions` — `public/scripts/app.js:1612` — Lease cards for corp.miningLeases filtered to the station body; purchase blocks from client LEASE_BODIES (Earth/Mars/Luna, 1667-1671) gated on office existence (1629) and (leases+1)*5 employees (1630-1633); POST purchase-lease (1735); 'Manage Lease' sets appState.stationActiveLease (1759).
- `Station: renderLeaseManagement / bindLeaseManagementActions (extractor panel)` — `public/scripts/app.js:1766` — Per-lease extractor rows with static progress bars (active 1832-1859, downtime 1791-1831, idle 1860-1864), per-extractor Start Cycle form (throughput 10-250 default 40, hours 1-72 default 24, 1866-1874), Commission Extractor Yard block ($50,000 / asset $36,000 hard-coded 1772,1900). POSTs lease/:id/build-extractor (1961) and lease/:id/start-mining (2022).
- `Station: renderAssemblyFacility` — `public/scripts/app.js:2454` — Probe fabrication view (probeCount/maxProbes, fabricationQueue progress); gated on tt-asteroid-prospecting (2467-2472); POST build-mining-probe (2526). Reachable only via a corp building named 'Assembly Facility' (2386-2387).
- `Travel: renderTravelPage / updateTravelProgress` — `public/scripts/app.js:2117` — In-space docking buttons from stationRegistry filtered by currentSystemId (2126-2168); in-transit card with 1 s progress timer (2214-2243); on arrival refreshFromServer and switch to Station (2548-2586). Tab button hidden unless traveling/in space (2080).
- `Financial Core: renderFinanceDashboard / renderPnlTable / renderBalanceTable` — `public/scripts/app.js:2661` — KPI strip (net worth, credits, net flow, revenue, costs, runway) from corp.finances + latest snapshot liabilities (2668-2671); P&L from incomeBySource/expensesByCategory/lifetime totals (2701); balance sheet derives 'Lease Commitments' = liabilities − 7×dailyCosts (2748-2779).
- `Financial Core: renderFinanceCharts` — `public/scripts/charts.js:407` — Six Chart.js charts from finances.snapshots (synthesises 12 flat points when <2 snapshots, charts.js:114-137), incomeBySource, credits/assets; inventory bucket hard-coded 0 (charts.js:334). Duration pickers bound at 437.
- `Corporate R&D: renderTechTree / availableTechNodes / renderQueue` — `public/scripts/app.js:1017` — Rows from client techTree (68-188) grouped done/queued/locked/available using corp.unlockedTech + queues.corporateRnD; tier-2 gate requires all tier-1 done (1012, 1043); Enqueue delegates to ghost #rnd-form (1096-1105, submit at 5393 → POST queue-rnd 5407). Queue cards with progress (3152-3183).
- `CEO Insight: renderInsightTree` — `public/scripts/app.js:1110` — Rows from client insightPrograms (191-204) vs corp.completedInsights + queues.ceoInsight; one program at a time (1126); Enroll → POST queue-ceo (1193). Effects other than negotiation tax are display-only (server applies only ceo-negotiation-fundamentals, gameState.js:951-953).
- `Refinery Chains: renderRefinery` — `public/scripts/app.js:3214` — Resource pills from client RESOURCE_CATALOG (3216); active runs from corp.refineries × world.refineryChains (3236-3259); chain cards with quantity input (min max(100,perCycle), step perCycle, 3286-3297), Start Run → POST start-refinery (3368), Build Refinery → POST build-refinery (3399) gated on tt-material-compression+tt-nano-lattice and 2-refinery cap (3228-3230); status banner via undeclared appState.refineryStatus (3231, 3389, 3454).
- `Galactic Exchange: renderMarket` — `public/scripts/app.js:3785` — Filter pills, Sell Orders (others' sell orders, cap 30), NPC Standing Buy Orders, Create Listing grid from current-station inventory with avg-price default (computeAverageMarketPrice 925), My Active Listings, Exchange Inventory Snapshot, Mercenary Rentals (known empty), Trade History. Buy/sell/list handlers live in bindForms (5329 list → POST /api/market/orders; 5725 buy → /orders/:id/buy; 5791 npc sell → /npc-orders/:id/sell) with showTradeConfirmation modal (575).
- `Assets: renderAssets` — `public/scripts/app.js:3467` — Summary bar + two sub-tabs (Inventory table by resource × station from corp.inventory keyed by stationRegistry ids; Infrastructure table of offices/leases/extractors with 'Unassigned' fallback 3582-3595). Read-only; sub-tab kept in contentEl.dataset.activeTab (3479, 3644).
- `Logistics: renderLogistics` — `public/scripts/app.js:3654` — Summary tiles (fee $2/unit hard-coded LOGISTICS_FEE_PER_UNIT 3652) + one card per registry station; remote stations get per-item quantity + transfer button → POST transfer-resources (3764). Empty per-station state 3708; no message if registry empty.
- `Comms: renderChatLog / renderChatChannelTabs` — `public/scripts/app.js:4743` — Renders last 120 messages of data.chatLog[channel]; channel tabs global/local/trade/private from index.html:719-722, 'local' resolves to local:<currentSystemId> (4735-4741); send via socket.emit('chat:send') with client-supplied author (5486-5490). No empty state.
- `Forums: renderForums` — `public/scripts/app.js:3973` — Overview: category pills from data.forums.categories, thread cards, inline new-thread form (POST /api/forums/threads 4278). Thread view: OP + replies with like buttons (POST /like 4117) and bottom reply composer (POST /replies 4154); view state in appState.forumsView/selectedForumThreadId.
- `Assignments: renderMissions / openMissionModal / showMissionCompleteOverlay` — `public/scripts/app.js:4517` — Bureau hub: agent cards from client MISSION_AGENTS filtered to currentStationId (4641), Active Contracts with Abandon, Mission Log. Agent office: portrait/bio/random dialogue line, reputation stars from client REPUTATION tables (4324), available contracts from corp.contractOfferings.missions, countdown. Modal (4361) shows quota vs current-station inventory and gates Complete on being at the agent's station; accept/abandon/complete POSTs in bindForms 5567-5721; celebration overlay 4461.
- `Inbox: loadMessages / renderInboxMessageList / openMessage / bindInboxControls` — `public/scripts/app.js:6114` — Lazy GET /messages on first tab open (6461); folders inbox/sent/draft/archive/trash + official/players subtabs with unread badges (6145); detail view marks read (6278); compose/save-draft/move/delete-draft POSTs (6369-6437, 6440). Compose requires exact recipient corp name (index.html:919-920).
- `Starmap: createStarmapController` — `public/scripts/starmap.js:262` — Canvas cluster/system/body/asteroid views; wired from app.js:318-397 with travel/dock/scout-belt/launch-expedition callbacks; receives world.systems (setSystems 1419), stationRegistry + current station/system (1429), unlockedTech for travel gating (NEAR_STAR_SYSTEMS 292-301), asteroidMining state (1446). Overlays read system.gdpIndex/activityLevel/pirateDensity from systems.json (27-42).
- `Walkthrough: renderWalkthroughStep / promptWalkthroughOffer` — `public/scripts/app.js:5083` — 12 static steps (207-280) that switch tabs and highlight selectors; offer shown once per account via localStorage key (456-477); completion POSTs walkthrough-complete and lands on R&D tab (6551-6566).
- `Socket handlers: bindRealtimeEvents` — `public/scripts/app.js:5852` — state:init (5859), chat:new (5873), market:updated → renderMarket (5889), forums:updated (5898), finance:updated (dead, dummy-gated 5911), finance:snapshot ×2 (never emitted, 5922/5931), notifications:new (5940), ceo/rnd:completed → refresh (5951/5958), travel:arrived (5965), mining:updated → renderAssets+sidebar only (5979), expedition/fabrication:completed → refresh (5999/6005).

### State this subsystem reads or writes

- `corp.corporationName`
- `corp.ceo`
- `corp.location`
- `corp.level`
- `corp.levelCap`
- `corp.employeeCount`
- `corp.employeeCap`
- `corp.buildingSlots`
- `corp.buildings[].{name,tier,status}`
- `corp.unlocks.maxFleetSize`
- `corp.unlocks.maxBasicExtractorYards`
- `corp.milestonesCompleted[] (read by dead milestone-list code only)`
- `corp.levelProgress.level{N}.requirements[].{id,title,progress,target,complete}`
- `corp.finances.credits`
- `corp.finances.assets`
- `corp.finances.dailyRevenue`
- `corp.finances.dailyCosts`
- `corp.finances.snapshots[].{t,credits,assets,liabilities,netWorth,netFlow}`
- `corp.finances.incomeBySource`
- `corp.finances.expensesByCategory`
- `corp.finances.lifetimeRevenue`
- `corp.finances.lifetimeCosts`
- `corp.finances.exchangeSalesTaxPct`
- `corp.military.attackValue / defenseValue`
- `corp.conglomerateId`
- `corp.currentStationId`
- `corp.currentSystemId`
- `corp.travel.{arrivesAt,departedAt,travelType,fromSystemId,toSystemId,fromStationId,toStationId}`
- `corp.offices[].{stationId,name,body,systemId,tier,rentedAt,rentedUntil}`
- `corp.miningLeases[].{id,body,leaseType,issuedAt,buildingSlots,extractorIds[]}`
- `corp.mining.silicateExtractors[].{id,name,tier,active,startedAt,endsAt,throughputPerHour,operationCostPerHour,totalMined,totalSpent,downtimeActive,downtimeStartedAt,leaseId,body}`
- `corp.inventory[stationId][itemName]`
- `corp.refineries[].{id,name,active,chainId,startedAt,endsAt,cycleScale}`
- `corp.unlockedTech[]`
- `corp.completedInsights[]`
- `corp.asteroidMining.{probeCount,maxProbes,maxDeployments,activeExpeditions[],scoutedBelts[],fabricationQueue[]}`
- `corp.contractOfferings.{missions[],nextRefreshAt}`
- `corp.activeMissions[] (mirrored into appState.activeMissions)`
- `corp.completedMissions[]`
- `corp.agentReputation[agentId].completedCount`
- `corp.tradeHistory[]`
- `queues.corporateRnD[].{techId,name,effect,durationHours,startedAt,costCredits}`
- `queues.ceoInsight[].{programId,...}`
- `world.systems[] (+ gdpIndex/activityLevel/pirateDensity/bodies for starmap)`
- `world.refineryChains[]`
- `market.orderBook[]`
- `market.npcBuyOrders[]`
- `market.mercenaryContracts[] (never present in seed)`
- `forums.categories[] (never seeded)`
- `forums.threads[].{id,category,title,author,body,likes,likedBy,createdAt,replies[].{id,author,content,likes,likedBy,createdAt}}`
- `chatLog[channel][]`
- `conglomerates[]`
- `combatReports (copied at 5200, never rendered)`
- `account.walkthroughCompleted`
- `account.email (used for own-order detection 3799)`
- `CLIENT-ONLY: appState.* (4-51), appState.refineryStatus (undeclared, 3231/3389/3454), appState.scoutedBodies (Set, lost on reload), appState.stationRegistry (GET /api/stations), appState.buildingRegistry (GET /api/buildings), appState.beltCompositions (GET belt-compositions), appState.inbox.*, appState.exchangeFilter, appState.refineQuantityOverrides, appState.stationActiveLease, appState.forumsView/selectedForumThreadId/selectedForumCategory, appState.missionsView/selectedAgentId/selectedMissionId`
- `localStorage: isp.accountId, isp.walkthrough-offer-seen:<accountId>; the tokens are the isp_refresh cookie and appState.accessToken (AB#757)`

### TODOs in this code

- `public/scripts/app.js:67` — This should be fetched from db or research.json (techTree)
- `public/scripts/app.js:190` — Store in DB or fetch from insight.json (insightPrograms)
- `public/scripts/app.js:206` — Move to dedicated file (walkthroughSteps)
- `public/scripts/app.js:533` — Ensure all helper functions are consolidated into a single function
- `public/scripts/app.js:558` — Ensure this function is updated when we make asteroid belts dynamic (refreshBeltCompositions)
- `public/scripts/app.js:801` — Expand design of intro dialogue
- `public/scripts/app.js:837` — Remove, we have a duplicate function in gameState.json, and this should be extrapolated based on values in the DB (createNewPlayerState — verified: no callers)
- `public/scripts/app.js:1349` — Move the rendering and functionality of each building to their own dedicated file. Ensure that relevant information is being fetched from the database where applicable.
- `public/scripts/app.js:2061` — Overhaul Travel Page design
- `public/scripts/app.js:2254` — Consolidate all helper functions to singular file (formatDuration)
- `public/scripts/app.js:2606` — Consolidate helper functions to singular file (finance fmt helpers)
- `public/scripts/app.js:2840` — This information should be stored in the database OR in milestones.json (REQ_TAB)
- `public/scripts/app.js:3184` — Remove duplicate. This should be stored in the database (RESOURCE_CATALOG)
- `public/scripts/app.js:3190` — Remove. This is defined within gameState.js but should be fetched from the DB or from milestones.json (MILESTONE_ROADMAP — verified dead: #milestone-list absent)
- `public/scripts/app.js:3885` — Remove mercenary references. Functionality isn't built yet.
- `public/scripts/app.js:4307` — This should be defined in the database (REPUTATION_THRESHOLDS/TITLES)
- `public/scripts/app.js:4336` — This should be in the database (MISSION_AGENTS)
- `public/scripts/app.js:4492` — Should visual effects be moved to their own file? (mission-complete particles)
- `public/scripts/app.js:4788` — Can this be refactored to improve performance? Where is this function called? Do we always need to update every single view? (updateAllViews)
- `public/scripts/app.js:5045` — Duplicate function found in gameState.js (completeWalkthroughForAccount)
- `public/scripts/app.js:5064` — Duplicate function? (resetWalkthroughForAccount)
- `public/scripts/app.js:5285` — Duplicate function possibly exists in gameState.js (loginDummyAccount)
- `public/scripts/app.js:5495` — Move all functionality for the forums to its own dedicated file
- `public/scripts/app.js:5857` — Investigate current socket.io implementation
- `public/scripts/starmap.js:77` — Add detailed images for outstanding planets (only earth/mars/luna have images, 79-83)
- `public/index.html:2` — Content should be fetched from database

### Suspected defects (candidates — unverified, not filed)

- **sev 1** · `server/index.js:2445` — **Mission rewards are never paid: complete-mission adds the reward to `state.corp.credits`, a field nothing else reads, instead of `state.corp.finances.credits`; the Assignments overlay nonetheless tells the player 'Reward Credited'.**
  <br>Evidence: index.js:2445 `state.corp.credits = (state.corp.credits || 0) + rewardCredits;` is the only write to corp.credits in the server (grep); every balance read/write elsewhere uses corp.finances.credits (e.g. index.js:1054-1060, 1133, 1620). Client overlay copy at app.js:4480-4481 and feedback at 5707. The dead client demo branch has the identical bug at app.js:5703, suggesting copy-paste origin. Verified by reading both files; not in the known-defects list.
- **sev 2** · `public/scripts/app.js:2434` — **The Assembly Facility 'Construct (¤60,000)' button is never bound, so an Assembly Facility (and therefore probes and belt expeditions) can never be built from the UI.**
  <br>Evidence: buildAssemblyHtml (2347-2353) is appended to facilityHtml (2372) and written into #station-facility-buildings (2376), but the click binding does `playerGrid.querySelector('#build-assembly-btn')` where playerGrid is #station-player-buildings (2268, 2434). The only caller of POST build-assembly-facility is this handler (2440). renderAssemblyFacility is reachable only via a corp building named 'Assembly Facility' (2386-2387). Verified.
- **sev 2** · `public/scripts/app.js:4239` — **On a fresh install the Forums tab is a dead end: no thread can ever be created because the category select has no options.**
  <br>Evidence: categorySelect.innerHTML is built from data.forums.categories (4238-4245); data/state.json contains no `forums` key (node summary: categories undefined, 0 threads) and the server only creates `{categories: [], threads: []}` lazily on first POST (index.js:2934) with no seed anywhere in gameState.js (grep 'forums' → no seeding). The `<select required>` (index.html:748) therefore blocks submit, and the client check at 4268 rejects an empty category too. Verified.
- **sev 2** · `public/scripts/app.js:4106` — **Forum like clicks fire multiple POSTs and toggle likes back and forth: the like handler is attached to the persistent #forum-thread-detail-body on every thread render and never removed.**
  <br>Evidence: detailBody is a static element (index.html:771); `detailBody.addEventListener('click', ...)` at 4106 runs every time the thread view renders; renderForums is called from updateAllViews (4814) on every state refresh and after every like/reply (4127, 4168). Contrast with the correctly delegated treeWrap.onclick pattern at 1096/1183. Verified by code reading; not executed.
- **sev 2** · `public/scripts/app.js:1360` — **Orbital Executive Suites shows the office as a one-time purchase at station.officeCost (e.g. $20,000) but the server charges $1,000/day for a default 7-day term ($7,000) and the office expires a week later, after which mining is refused.**
  <br>Evidence: Client: officeCost = station?.officeCost || 20000 (1360) rendered as 'credits (one-time)' (1381); rent request body is `{ stationId }` only (1484). Server: VALID_DURATIONS default 7 → officeCost = durationDays*1000 (index.js:1094-1096), rentedUntil = now+7d (1142); start-mining rejects when no office has rentedUntil > now (1671-1675). stations.json officeCost (20000/15000/18000/35000…) is never read by the server. Distinct from the known walkthrough-copy drift, which is about step text. Verified.
- **sev 2** · `data/milestones.json:74` — **Corporation progression hard-stops at Level 5: Level 6-10 requirements reference research ids and buildings that exist in no catalog, and the Overview renders them as 'Go to Rnd →' cards leading nowhere.**
  <br>Evidence: milestones.json:76,90,116,132,134,139 require tt-ferric-core-extraction, tt-multi-stage-refinery, tt-cryo-vapor-extraction, tt-carbonaceous-slurry-recovery, tt-asteroid-belt-mining, tt-extrasolar-expansion; none appear in data/research.json, index.js RESEARCH_LIBRARY (55-176) or app.js techTree (68-188). Buildings 'Ferric Mining Complex' (78), 'Refinery Complex' (91), 'Cryo-vapor Extractor Array' (118) have no build route (route list index.js:802-3359). Client REQ_TAB (2841-2877) maps them to tabs regardless. Verified.
- **sev 2** · `server/index.js:473` — **Every connected socket receives every account's inventory, credits and finances every 5 s / 30 s; the client handlers are dead or filter client-side only.**
  <br>Evidence: miningTick emits mining:updated with accountId, extractors, full inventory and credits for every account to all sockets (index.js:470-478, interval 484); financialSnapshotTick emits finance:updated with each account's finances to all sockets (index.js:780-795). Client filters mining:updated by accountId (app.js:5980) and ignores finance:updated unless profileMode==='dummy' (5912), which no code path sets (every enterGame call passes 'account': 5274, 6048, 6096, 6602). Verified; server-side fix belongs to the tickers subsystem but is observable from these handlers.
- **sev 3** · `public/scripts/app.js:5719` — **Completing a contract throws a TypeError in the click handler, so updateAllViews (5720) never runs and sidebar/overview/assets stay stale.**
  <br>Evidence: renderInventoryPanel (969) dereferences #listing-item, #listing-quantity, #listing-submit (972-974) which are absent from index.html (verified by id grep: MISSING); `listingItem.innerHTML = …` at 981 (empty inventory) or 993 (non-empty) throws on null. Only caller is 5719 inside the async missionCompleteBtn handler. Verified.
- **sev 3** · `public/scripts/app.js:1037` — **Corporate R&D shows '+ Enqueue' for corp-level-gated research and the server then rejects it; the client never checks requiresCorpLevel.**
  <br>Evidence: renderTechTree lock logic is prereqsMet/tierGated only (1042-1044); availableTechNodes likewise (1009-1014). techTree nodes carry requiresCorpLevel 5 and 10 (158, 168). Server rejects with 'requires Corp Level N' (index.js:2679-2682). Verified.
- **sev 3** · `public/scripts/app.js:1766` — **Extractor progress bars, remaining time and fees in the lease-management panel are frozen snapshots: nothing re-renders an open building detail.**
  <br>Evidence: renderLeaseManagement computes pct/hrs/fees at render time (1832-1859); the 1 s ticker re-renders only the Assembly view when a building detail is open (2979-2983); updateAllViews → renderStation touches only the overview grids and explicitly avoids the detail view (2297-2300); mining:updated re-renders Assets + sidebar only (5995-5996). Verified.
- **sev 3** · `public/scripts/app.js:4027` — **Per-post 'Reply' and 'Quote' buttons in forum threads do nothing.**
  <br>Evidence: Buttons with data-action='reply'/'quote' at 4027-4028 (replies) and 4068-4069 (OP); the only delegated handler matches `[data-action="like"]` (4107). Only the bottom composer form (4080-4090, 4136-4178) posts replies. Verified.
- **sev 3** · `public/scripts/app.js:4571` — **Agent office 'completed missions' panel is computed and never rendered; #agent-completed-missions stays hidden.**
  <br>Evidence: Block 4571-4575 filters completedMissions by agent into `completed` and has an empty body; index.html:816 keeps the element `hidden`. Verified.
- **sev 3** · `public/index.html:722` — **The 'Private' comms channel is a globally broadcast public channel, and chat authorship is client-supplied.**
  <br>Evidence: resolveChatChannel returns the tab key verbatim for non-local tabs (app.js:4735-4741); the server appends to whatever channel the payload names and broadcasts chat:new to all sockets with author taken from payload (index.js:3398-3412, io.emit at 3411); the client sends author = corporationName (5488). Verified.
- **sev 3** · `public/scripts/starmap.js:895` — **Planet/asteroid 'composition' readouts are client-side hash-generated numbers presented as game data, and body scouting is a client-only Set lost on reload.**
  <br>Evidence: generatedComposition(body) seeds percentages from hashSeed(body.id) (starmap.js:55-70) and is rendered in the body detail (895-897); asteroidComposition(seedKey) (250) rendered at 1080/1087; onScoutBody only adds to appState.scoutedBodies (app.js:324-329), never POSTed; belt compositions by contrast come from the server (app.js:559-568). Verified.
- **sev 3** · `public/scripts/app.js:2425` — **Extractor cards on the Station overview are dead ends: empty footer, no link to the lease panel where cycles are actually started.**
  <br>Evidence: Card template 2418-2427 renders `<footer class="building-card-footer"></footer>` with no action; the only Start Cycle form lives in renderLeaseManagement (1866-1874), reached via ISA Claims → Manage Lease (1755-1763). Verified.
- **sev 3** · `public/scripts/app.js:1667` — **ISA Claims & Leases offers leases only for Earth/Mars/Luna (client copy of index.js:1256), so every extrasolar station's Claims office reports 'No extraction zones are available'.**
  <br>Evidence: LEASE_BODIES 1667-1671; hasLocalBodies computed against stationBody (1677) → message at 1682; stations.json defines five stations outside Sol (centauri-prime-station, ironwell-depot, halo-anchorage, verde-trade-hub, kestrel-platform) all carrying isa-claims-leases in buildingIds. Server LEASE_COSTS also only Earth/Mars/Luna but defaults unknown bodies to 25000 (index.js:1256-1257). Verified.
- **sev 4** · `public/scripts/app.js:4889` — **Roughly 600 lines of app.js are dead: Overview level-2 forms, action hints, mine-cycle panel, MILESTONE_ROADMAP, createNewPlayerState, travelTimeBetween, login/register panel bindings, and every 'demo fallback' else-branch.**
  <br>Evidence: bindLevel2Controls (4889-4902) and renderActionHints (3057-3069) and renderMiningCyclePanel (3019-3023) return early because #level2-hire-form, #level2-build-btn, #mine-form, #mine-extractor-id, #mine-amount, #mine-hours, #mine-btn, #mine-cycle-list, #hire/build/mine-action-hint are absent (id grep: MISSING); #milestone-list absent so 1224-1237 never runs; createNewPlayerState (838) and travelTimeBetween (2247) have no callers (grep); #login-panel/#register-panel/#login-dummy-btn/#register-form absent so bindAuthControls 6012-6057 and 6059-6109 are inert; appState.accountId is always set by enterGame (5148 with every caller passing it) so else-branches at 1491-1508, 1544-1556, 1588-1600, 1969-1990, 2031-2050, 3406-3452, 5417-5436, 5588-5593, 5621-5626, 5657-5705 never run. Server routes /gameplay/mine (2482) and /gameplay/build-extractor (1767) consequently have no UI caller. Verified.
- **sev 4** · `public/scripts/app.js:4002` — **Thread view shows a fabricated lease-arbitration paragraph as the OP body for any thread lacking body/summary, and the overview excerpt fallback can never fire because replies use `.content` not `.body`.**
  <br>Evidence: opBody fallback string at 4002-4004; excerpt at 4215 reads replies[0]?.body while reply objects are rendered from reply.content (4024) and created with `content` server-side (index.js:2943ff). Server-created threads always have body (index.js:2924) so the fake text only surfaces for legacy/seeded threads. Verified.
- **sev 4** · `public/scripts/app.js:2318` — **The 'Coming Soon' badge branch is unreachable, so 13 of Earth Station Prime's 17 buildings are silently hidden instead of shown as coming soon.**
  <br>Evidence: npcBuildings filters `b.owner === 'npc' && b.available` (2318) and then the template tests `b.available` again (2322-2324); buildings.json marks 13 entries available:false. Also the 'ge-bg' branch tests id 'galactic-exchange' (1286) but the registry id is 'galactic-exchange-hub' with action 'tab:market' (buildings.json:214-225), so it never matches. Verified.
- **sev 4** · `public/scripts/app.js:1215` — **Corporation name and CEO name are inserted unescaped into the sidebar and registration only trims them; notification title/body and queue name/effect are also inserted unescaped.**
  <br>Evidence: updateCorpIdentity 1215-1216 uses ${corp.corporationName}/${corp.ceo} raw; createAccount trims only (gameState.js:2186-2190); renderNotifications 698-699 and renderQueue 3172-3174 raw. All cross-user surfaces checked (chat 4757, forum author 4018/4059, market seller 3846, inbox fromName 6212) do escape, and no server notification embeds another player's name (grep), so today this is self-XSS only. Verified.
- **sev 4** · `public/scripts/app.js:3002` — **Contract countdown ends with 'New contracts available — refresh to update' but there is no refresh control and the client does not re-fetch offerings on its own.**
  <br>Evidence: Ticker text at 3002; refreshFromServer runs only after actions, socket events, or every 60 s while an extractor/refinery/expedition is active (3007-3015); offerings are refreshed server-side on login/accept (gameState.js:2134, index.js:2383). Verified.
- **sev 4** · `public/scripts/app.js:5922` — **finance:snapshot handler is registered twice and is never emitted by the server; finance:updated handler is dead.**
  <br>Evidence: Identical socket.on('finance:snapshot') blocks at 5922-5929 and 5931-5938; server emit list (grep) contains no finance:snapshot; finance:updated gated on profileMode==='dummy' (5912) which is never set. Verified.

### Test coverage, and what it does not cover

No test touches the client. vitest.config.js runs only tests/**/*.test.js in the node environment with coverage restricted to server/**; package.json has no jsdom, happy-dom or playwright dependency. The closest coverage is indirect: tests/schema/data-files.test.js validates the shape of data/buildings.json, stations.json, systems.json, research.json and refinery-chains.json (files the client duplicates rather than consumes), tests/unit/catalogs.test.js checks CEO_INSIGHT_LIBRARY, MISSION_TEMPLATES, BASE_MAX_PROBES etc., and tests/integration/auth.test.js covers the auth routes app.js calls (register/login/refresh/logout/session). Nothing covers: the index.html ↔ app.js element-id contract (16 ids already missing), any tab's render output or empty states, the walkthrough, socket handler behaviour, the market/forum/mission/inbox UI flows, catalog parity between app.js techTree / index.js RESEARCH_LIBRARY / data/research.json (research.json is loaded by no server code — index.js:54-55 still hard-codes RESEARCH_LIBRARY), or the client-side cost/limit constants that mirror server values (hire, extractor, mining formula, refinery, assembly, probe, lease, logistics fee, office renewal).

### Before you touch this in v0.5

- Rendering model: updateAllViews (app.js:4789-4835) rebuilds all 15 tabs + Chart.js + starmap on every state change, and the 1 s ticker (2964-3016) rebuilds the entire Refinery tab DOM every second (hence the focus/caret restore hack 3263-3353 and the refineQuantityOverrides state). Any redesign should render only the active tab and split app.js into per-tab modules; the existing per-tab functions are already the natural seams.
- DOM contract has no guard: app.js references 16 ids that index.html no longer has (level2-hire-form, level2-build-btn, mine-form, mine-extractor-id, mine-amount, mine-hours, mine-btn, listing-item, listing-quantity, listing-submit, mine-cycle-list, combat-reports, hire/build/mine-action-hint, milestone-list). Delete the dead code with the redesign and add a smoke test that every getElementById target exists.
- Catalogs are triplicated and must become server-served before any UI rewrite: research (app.js:68-188 vs index.js:55-176 vs data/research.json which nothing loads), insight programs (app.js:191-204 vs data/ceo-insight.json), resource catalog (app.js:3185 vs refinery-chains.json resourceCatalog), milestone roadmap (app.js:3191, dead), REQ_TAB requirement→tab map (app.js:2841), mission agents + reputation ladder (app.js:4309-4359, no server counterpart at all), lease bodies/costs (app.js:1667 vs index.js:1256). Values currently match except the client omits requiresCorpLevel gating and description/category fields.
- Economics are hard-coded on both sides and the client copies do not show server discounts: hire $2,000/+$150 per day (app.js:1448,1592-1597; index.js:1047,1061), extractor $50,000/asset $36,000 (app.js:1772,1900; index.js:1557-1558, -6% with tt-supply-forecast at 1565 never shown), mining startup/operating formula (app.js:2034-2036 dead branch; index.js:1711-1715), assembly ¤60,000 (2351; 1872), probe ¤8,000 (2499), refinery $75,000 (dead branch; 2162), logistics $2/unit (3652; 1340), office $1,000/day (1435-1438; 1096/1179). Office rental is the one place the two disagree (see defects).
- profileMode is always 'account'; the 'dummy' and no-accountId code paths are dead. IS_DEV_ACCESS (app.js:62-65) is a client-only gate toggled by ?dev=1 or localhost; the real gate is the known ALLOW_DUMMY_AUTH server issue. Tokens live in localStorage (401-424); socket.io connects unauthenticated and chat author is client-supplied (5486-5490).
- Socket events that actually drive UI: state:init (full shared state), chat:new, market:updated, forums:updated (only re-renders if Forums tab active), notifications:new, ceo:completed/rnd:completed/expedition:completed/fabrication:completed (all just refreshFromServer), travel:arrived, mining:updated (Assets + sidebar only). finance:updated/finance:snapshot handlers are dead. Server broadcasts every account's finances/inventory to every socket (see defects).
- Station tab is the only nested navigation and holds most of the core loop (office → hire → lease → extractor → cycle); the Overview requirement cards deep-link only to the tab, not to the building. The starmap has its own docking/travel/scout/expedition UI (starmap.js:886-1075) that duplicates Travel-tab docking. A redesign should decide one home for travel.
- Progression content ends at Level 5 (milestones.json:74-139 reference non-existent research/buildings); refinery chains need tier-2/3 research the walkthrough never mentions; only one mission agent exists (Earth Station Prime) so Assignments is empty everywhere else. Playtest scope should be framed as Levels 0-5.
- Responsiveness: styles.css (5,386 lines) has 15 @media rules but the old tab row is 15 inline buttons (index.html:292-309), the starmap canvas has width/height attributes 1200x680 with a 500px minimum (starmap.js:309), and the landing page in #auth-shell (index.html:23-236) is a separate long marketing layout that duplicates login.html/register.html entry points.
- External assets: Chart.js from cdn.jsdelivr.net and fonts from Google Fonts (index.html:8-16), socket.io served by the server at /socket.io/socket.io.js (17); relevant to CSP and to the Azure hosting decision (socket.io needs a long-lived process, not serverless).
- Overview cards 'Military Power' and 'Conglomerate Status' (app.js:2808-2812, 2795-2807) and the 'Mercenary Rentals' panel are non-features; combatReports is copied into client state (5200) but never rendered; renderCombatReports/updateInvestmentPanel are stubs (4730, 2781).
- Empty states exist for most lists (inventory 980/3900, requirements 2892, refinery 3239, forums 4206/4034, missions 4659/4783/4812, inbox 890, logistics 3708, assets 3498/3605, market via hidden <p> elements 581/604/627/649/680) but Comms has none (4752) and Logistics shows nothing if the station registry fetch fails (5236-5238 is silent).
- Inbox compose requires the exact recipient corporation name (index.html:919-920, gameState.js:2359-2366) with no directory; forum/chat are the only places another corp's name is discoverable.

---

<a id="client-design"></a>

## client-design

**Scope.** VISUAL DESIGN (public/styles.css, public/index.html, public/login.html, public/register.html, public/images, client-side presentation hooks in public/scripts/)

The entire visual layer is one hand-written 5,386-line stylesheet (public/styles.css, first line is `/* TODO: Organize CSS */`) plus three HTML shells (index.html 996 lines = landing page + whole game shell in one document; login.html and register.html share the same CSS). There is no build step, no CSS framework, no component library: every screen is a `.tab-panel` article toggled by `setTab()` (app.js:4984) via an `.active` class, and most in-game content is emitted as template-literal HTML from app.js (261 distinct class names, 100 inline `style=` attributes). Theming is a thin token layer of 10 raw colors plus 6 aliases on `:root` (styles.css:4-23) that the rest of the file largely bypasses: 254 hard-coded `rgba(0, 247, 255, …)` cyan literals, 16 distinct border-radius values, 51 distinct font-size values, 12 z-index values, and 8 references to CSS variables that are never defined. Typography loads Inter/Orbitron/Rajdhani from Google Fonts (index.html:11) but the Finance board is written for "Share Tech Mono"/"Roboto Mono" which are never loaded, and Chart.js keeps its Helvetica default. The layout is a two-column grid (sidebar + main, styles.css:1015-1020) that collapses to one column at 960px, but eleven panels are capped with viewport-percentage or fixed pixel widths (`#inbox 33vw`, `#chat 50vw`, `#missions-board-view 25vw`, `#lease-suite-box 750px`, `.agent-card 30em`, …) that make the Inbox, Comms, Assignments, Starmap details and the office-rental box unusable on a 375px phone and cramped on desktop. Motion is ambient (a permanent starfield rAF loop, a 90s nebula drift, floating logo) plus a handful of feedback animations (button ripple, success pulse, requirement strikethrough, a mission-complete overlay with particles); there is no `prefers-reduced-motion`, no keyboard handling of any kind in the client, no dialog semantics on the four modal implementations, and no `:disabled` styling. Aesthetically the file is a 2010-era "sci-fi HUD" idiom: pure #00f7ff cyan with text-shadow glows, Orbitron uppercase micro-labels at 8.8-9.6px, glossy gradient buttons with inset highlights, blurred glass panels over stock JPEG backgrounds dimmed to 22%, decorative corner brackets and scanlines, Unicode glyphs as icons, and a wrapping cloud of 15 pill tabs for navigation.

### Entry points

- `Design tokens (:root)` — `projects/interstellar-settlement-protocol/public/styles.css:4` — The only token layer: --void-black, --cold-navy, --dark-steel, --electric-cyan, --muted-amber, --text-main, --text-muted, --panel, --panel-border, --danger, plus aliases --accent/--text/--muted/--surface/--border/--warn (lines 17-22). No spacing, radius, type-scale, z-index or motion tokens exist.
- `Base typography` — `projects/interstellar-settlement-protocol/public/styles.css:29` — html/body sets Inter with Segoe UI/Tahoma fallback; no root font-size, no body line-height; h1 sized at line 730-734; NO global h2/h3 rule anywhere, so panel headings render at browser defaults (1.5em/1.17em Inter).
- `Font loading` — `projects/interstellar-settlement-protocol/public/index.html:8` — Google Fonts preconnect + stylesheet for Inter 400-800, Orbitron 400-900, Rajdhani 400-700; identical block duplicated in login.html:8-13 and register.html:8-13. Share Tech Mono / Roboto Mono are referenced in CSS but never loaded.
- `Shared panel surface` — `projects/interstellar-settlement-protocol/public/styles.css:1027` — .panel-block, .chart-card, .form-card, .tab-panel, .side-panel share background var(--panel), 1px --panel-border, 10px radius, backdrop-filter blur(5px). This is the closest thing to a 'card' primitive.
- `Buttons` — `projects/interstellar-settlement-protocol/public/styles.css:992` — .btn / .btn-outline / .btn-accent (992-1012), re-opened at 3703-3716 for ripple + .btn-command; hero variants .btn-hero/-outline/-fill at 433-476. btn-primary/btn-ghost/btn-danger/btn-sm are used in HTML/JS but have no rules.
- `Layout grid + responsive collapse` — `projects/interstellar-settlement-protocol/public/styles.css:1015` — .layout-grid minmax(250px,300px) sidebar + 1fr main; collapses to 1 column at max-width 960px (line 2113). App header is sticky (892-904). #game-shell is height:100vh (906-908).
- `Tab navigation` — `projects/interstellar-settlement-protocol/public/index.html:292` — <nav class="app-nav"> with six .nav-group sections (AB#764): Company (Overview, Inbox, Financial Core, CEO Insight, Assignments), Station, Industry (Corporate R&D, Refinery Chains, Logistics), Market (Galactic Exchange, Assets), Comms (Chat, Forums), Map (Starmap, Travel[hidden]); each a .nav-group__button over its <button class="nav-tab" data-tab> buttons. Styled in styles.css "App shell".
- `setTab()` — `projects/interstellar-settlement-protocol/public/scripts/app.js:4984` — Toggles .active on .nav-tab and .tab-panel by id, sets aria-current on the tab, opens its group (AB#764); blocks locked tabs during travel.
- `Building-detail photo backgrounds` — `projects/interstellar-settlement-protocol/public/scripts/app.js:1281` — Adds oes-bg / icl-bg / ge-bg to #station-building-content, which styles.css:134-224 map to orbital_executive_suites.jpg, isa_claims_leases_division.jpg, galactic_exchange.jpg with a 78%-opacity black overlay.
- `Modal implementations` — `projects/interstellar-settlement-protocol/public/styles.css:2036` — Four separate modal systems: .modal-backdrop/.modal-card (2036-2052, used by trade-confirm, dialogue, walkthrough at index.html:961-994), .starmap-modal-overlay (2568-2648, z 10000), .mission-modal-backdrop (4170-4326, blur + slide-in), .mission-complete-overlay (4791-4937, pop + particles).
- `Reward / feedback animations` — `projects/interstellar-settlement-protocol/public/scripts/app.js:629` — pulseButtonSuccess (629-632, css 3736-3744) and bindRippleEffect (635-645, css 3718-3734); .just-completed strikethrough on requirement cards (app.js:2900-2905, css 830-854); mission-complete overlay with 16/40 particles and level-up glow (app.js:4470-4504, css 4790-4937). No corporation level-up ceremony, no toast system.
- `Starfield background` — `projects/interstellar-settlement-protocol/public/scripts/starfield.js:1` — 260 twinkling stars in two parallax layers redrawn every animation frame on a fixed full-viewport canvas (z-index -2, css 231-236), on every page, never paused; .app-bg nebula gradient with 90s drift keyframes at css 239-254.
- `Chart palette` — `projects/interstellar-settlement-protocol/public/scripts/charts.js:9` — COLOR object and SECTOR_PALETTE (lines 9-34) hard-code the same hex/rgba values as the CSS tokens; no font family set so Chart.js renders Helvetica/Arial; tick font 10px, legend 11px.
- `Planet images for starmap` — `projects/interstellar-settlement-protocol/public/scripts/starmap.js:91` — PLANET_IMAGE_PATHS (exported) maps all 17 Sol planets and moons to NASA public-domain JPEGs in /images/planets/ (512 px, under 150 KB; sources in public/images/planets/CREDITS.md), drawn cover-fit inside a clipped circle (drawPlanet). The asteroid belt has none: it is drawn as a field. tests/unit/planetImages.test.js checks the catalog against it (AB#741).
- `Landing page` — `projects/interstellar-settlement-protocol/public/index.html:23` — #auth-shell: hero (25-97) with inline SVG logo, then six .landing-section blocks of identical .data-card grids (99-229) with 'SECTOR 01..' counters (css 587-682), and a display:none .cta-section (231-234, css 699-701).
- `Login / Register pages` — `projects/interstellar-settlement-protocol/public/login.html:22` — .login-shell/.login-card (css 497-577); four equally weighted full-width .btn-hero actions stacked (login.html:42-47) including 'Temporary: Log In To Dummy Account'; register.html pre-fills real values for CEO/corp name (40, 43).
- `Static serving` — `projects/interstellar-settlement-protocol/server/index.js:425` — express.static(public) with no maxAge/etag/compression options; ~2.4 MB of images under public/images.

### State this subsystem reads or writes

- `DOM: .nav-tab.active / .tab-panel.active (app.js:4984-4995) — the only record of which screen is open`
- `DOM: #station-building-content.classList {ge-bg|icl-bg|oes-bg} (app.js:1252, 1281-1287, 2462)`
- `DOM: .section-toggle[aria-expanded] + [aria-controls] target .hidden (app.js:651-659)`
- `DOM: #notification-toggle[aria-expanded], #notification-panel.hidden (app.js:6518)`
- `DOM: .chat-channel-tab[aria-selected] (app.js:4776)`
- `appState.requirementsInitialized, appState.completedRequirementIds (app.js:2900-2905) — drives .just-completed animation`
- `appState.authenticated / authShell.hidden / gameShell.hidden (app.js:5138-5167)`
- `appState.mapMounted (app.js:5172) — starmap canvas mount/resize on tab switch`
- `CSS custom properties set from JS: --tx, --ty, --delay, --hue on .mission-complete-particle (app.js:4500-4503); --avatar-hue on .thread-avatar (css 3994-3997)`
- `Inline element.style.width on progress fills (app.js:1823, 1851 and similar) and element.disabled on 33 buttons/selects (e.g. app.js:982, 1027, 1189, 1476, 1529)`

### TODOs in this code

- `projects/interstellar-settlement-protocol/public/styles.css:1` — /* TODO: Organize CSS */
- `projects/interstellar-settlement-protocol/public/index.html:2` — <!-- TODO: Content should be fetched from database -->
- `projects/interstellar-settlement-protocol/public/login.html:2` — <!-- TODO: page header should be loaded from a standalone file. Each HTML file should use the same header. --> (identical TODO at register.html:2)
- `projects/interstellar-settlement-protocol/public/scripts/starmap.js:77` — // TODO: Add detailed images for outstanding planets
- `projects/interstellar-settlement-protocol/public/scripts/app.js:2061` — // TODO: Overhaul Travel Page design
- `projects/interstellar-settlement-protocol/public/scripts/app.js:801` — // TODO: Expand design of intro dialogue
- `projects/interstellar-settlement-protocol/public/scripts/app.js:1349` — TODO: Move the rendering and functionality of each building to their own dedicated file (block comment)
- `projects/interstellar-settlement-protocol/public/scripts/app.js:3885` — // TODO: Remove mercenary references. Functionality isn't built yet. (the empty Mercenary Rentals panel is already filed; listed here only as the in-code TODO)

### Suspected defects (candidates — unverified, not filed)

- **sev 1** · `projects/interstellar-settlement-protocol/public/styles.css:3244` — **The office-rental box (#lease-suite-box) is a fixed 750px wide with no max-width, and body has overflow-x:hidden (line 40), so on any viewport narrower than ~800px the right side of the first core action (rent an office) is clipped and unreachable.**
  <br>Evidence: styles.css:3244-3246 `#lease-suite-box { width: 750px; }` — no max-width, no media override; styles.css:38-41 `body { overflow-x: hidden }`; emitted by app.js:1377 `<section id="lease-suite-box" class="form-card action-surface" …>`. Verified rule; clipping is inferred from the two rules together, not screenshot-tested.
- **sev 1** · `projects/interstellar-settlement-protocol/public/styles.css:2143` — **The Inbox panel is capped at one third of the viewport width (33vw): 124px on a 375px phone, 253px on a 768px tablet, 475px on 1440px desktop — the message list, folder nav (6 buttons) and compose form are all squeezed into it.**
  <br>Evidence: styles.css:2143-2145 `#inbox { max-width: 33vw; }` with no media override; #inbox is the tab-panel article at index.html:868. Verified rule; widths are arithmetic.
- **sev 1** · `projects/interstellar-settlement-protocol/public/styles.css:4666` — **The Assignments bureau (#missions-board-view) and every mission card are capped at 25vw: 94px on a 375px phone, 192px on tablet, 480px on 1920px desktop; the agent .card-grid and active-contract grid cannot lay out inside it.**
  <br>Evidence: styles.css:4666-4668 `#missions-board-view { max-width:25vw; }` and 4950 `.mission-card { … max-width:25vw; }`; container at index.html:777. No media override. Verified.
- **sev 2** · `projects/interstellar-settlement-protocol/public/styles.css:1934` — **Comms (#chat), Forums overview (#forum-overview-view) and the Agent office (#agent-office-view) are capped at 50vw, and the Starmap details panel (#map-details) at 25vw — all half- or quarter-width panels with no mobile override.**
  <br>Evidence: styles.css:1934-1936 `#chat { max-width:50vw; }`, 3747-3749 `#forum-overview-view { max-width: 50vw; }`, 4443-4445 `#agent-office-view { max-width: 50vw; }`, 2563-2565 `#map-details { max-width: 25vw; }`. Verified.
- **sev 2** · `projects/interstellar-settlement-protocol/public/styles.css:4408` — **Agent cards are a fixed 30em (480px) wide inside a .card-grid whose columns are minmax(220px,1fr), so they overflow their grid column and the viewport on phones and tablets.**
  <br>Evidence: styles.css:4408-4411 `.agent-card { … width: 30em; }`; grid at 1234-1238; emitted at app.js:4647 into #agent-list (index.html:780). Verified rule; overflow inferred.
- **sev 2** · `projects/interstellar-settlement-protocol/public/styles.css:2895` — **Several auto-fit grids have minimum column widths larger than the ~311px content width available at 375px (375 − layout-grid 2×1rem − tab-panel 2×1rem), so their cards overflow and get clipped: Logistics (360px), Operational Facilities (340px), landing 2-col grid (340px), Finance tables (320px).**
  <br>Evidence: styles.css:2893-2897 `.logistics-grid … minmax(360px, 1fr)`; 2675-2679 `#station-facility-buildings … minmax(340px, 1fr)`; 710-715 `.landing-grid-2 … minmax(340px, 1fr)`; 1455-1460 `.finance-tables … minmax(320px, 1fr)`; paddings at 1019 and 1138; body overflow-x hidden at 40. Verified rules; arithmetic inferred.
- **sev 2** · `projects/interstellar-settlement-protocol/public/styles.css:1277` — **The Financial Control Board is designed around "Share Tech Mono"/"Roboto Mono" (KPI labels/values, meta, chart subtitles, P&L and balance tables) but neither font is loaded, so it renders in the OS monospace fallback (Consolas / Courier New on Windows).**
  <br>Evidence: Nine rules reference the fonts: styles.css:1277, 1292, 1299, 1345, 1353, 1368, 1425, 1436, 1472; index.html:11 loads only Inter, Orbitron, Rajdhani. Verified.
- **sev 2** · `projects/interstellar-settlement-protocol/public/index.html:878` — **Six button variants used in the markup have no CSS rules — btn-primary, btn-ghost, btn-danger, btn-sm, plus layout classes form-actions and card — so Inbox 'Move to Trash' looks identical to 'Archive', Compose/Send/Edit Draft get no primary emphasis, and the forum new-thread action row has no spacing.**
  <br>Evidence: index.html:878 `btn-primary`, 895/904/905/907/915/927 `btn-ghost`, 906 `btn-danger`, 758 `form-actions`, 896/916 `card`; app.js:1917 `btn-sm`. grep of styles.css for each returns 0 (only .card-grid matches 'card'). Verified.
- **sev 2** · `projects/interstellar-settlement-protocol/public/styles.css:992` — **There is no :disabled styling anywhere, while app.js disables submit buttons/selects in 33 places during requests; because .btn sets explicit color, background and cursor:pointer, a disabled button is visually and cursor-wise indistinguishable from an enabled one.**
  <br>Evidence: grep 'disabled' styles.css → none; .btn at styles.css:992-999 sets color/background/cursor; app.js `.disabled = ` at 982, 999, 1027, 1189, 1204, 1476, 1529, 1574 … (33 hits). Verified.
- **sev 2** · `projects/interstellar-settlement-protocol/public/scripts/app.js:4595` — **Mission cards and agent cards are <section role="button" tabindex="0"> but the client has no keyboard handler at all, so keyboard users can focus but never open them; the four modal systems have no role=dialog/aria-modal, focus trap or Escape-to-close.**
  <br>Evidence: app.js:4595, 4647, 4682 emit role="button" tabindex="0"; grep for keydown/keyup/keypress/.key/KeyboardEvent/Escape/role="dialog"/aria-modal/inert across app.js and starmap.js returns nothing. Modal markup at index.html:822, 961, 973, 983 and app.js mission-complete overlay. Verified.
- **sev 2** · `projects/interstellar-settlement-protocol/public/login.html:27` — **The first screens a playtester sees carry prototype/developer copy: login explains 'Authentication has been delegated to the ISP prototype command gateway … dummy account button when developer mode is enabled' and shows a 'Temporary: Log In To Dummy Account' button styled like Register; the landing hero calls the game a prototype and has a whole section 'Why This Prototype Exists'; a dead .cta-section is display:none.**
  <br>Evidence: login.html:27-31 copy, :44 dummy button (.btn-hero-outline, same as Register at :45); index.html:80-84 hero-desc, 209-229 'Why This Prototype Exists', 231-234 .cta-section with styles.css:699-701 `display: none`. Verified. (ALLOW_DUMMY_AUTH itself is already filed; this is the visible copy/hierarchy.)
- **sev 3** · `projects/interstellar-settlement-protocol/public/styles.css:1849` — **Eight var() references point at variables that are never defined and carry no fallback, so those declarations resolve to inherit/currentColor: the forum list category pill is not cyan, the thread-card hover left border takes the text colour, inbox subject/detail text and the trade-confirm total label just inherit.**
  <br>Evidence: Undefined and fallback-less: styles.css:1849 `var(--color-accent)`, 1866 `var(--color-accent)`, 1877 `var(--color-text)`, 2261 `var(--text-primary)`, 2304 `var(--text-primary)`, 2311 `var(--text-secondary)`, 5262 `var(--foreground)`, 5359 `var(--foreground)`; :root defines none of these (4-23). Classes are live: app.js emits forum-thread-card__category (1 hit), inbox-msg-subject (1), trade-confirm-highlight (1); index.html:901-902 inbox-detail-subject/body; starmap.js emits starmap-exp-select. Verified.
- **sev 3** · `projects/interstellar-settlement-protocol/public/styles.css:1717` — **Several text styles fall below WCAG AA 4.5:1 on their dark panels by computation: R&D row meta at 40% alpha (~2.8:1 at 11.7px), locked badge 35% alpha, whole completed R&D rows at opacity .28, travel and starmap stat labels at 35% white, R&D section labels at 50% cyan.**
  <br>Evidence: styles.css:1717-1720 `.rnd-row__meta { color: rgba(185,214,228,0.4) }`, 1743-1746 `.rnd-row__badge--locked … 0.35`, 1693-1696 `.rnd-row--done { opacity: 0.28 }`, 1687-1691 `.rnd-row--locked { opacity: 0.45 }`, 2480 `.travel-route-label … rgba(255,255,255,0.35)`, 2637 `.starmap-modal-stat-label … 0.35`, 1641-1648 `.rnd-panel__label … rgba(0,247,255,0.5)`. Rules verified; contrast ratios are my sRGB computation against ~#0a1f2e, not browser-measured.
- **sev 3** · `projects/interstellar-settlement-protocol/public/styles.css:4253` — **27 rules set text below 0.7rem (11.2px), bottoming out at 0.55rem (8.8px) and a cluster at 0.6rem (9.6px) for status/faction badges and office labels — all uppercase Orbitron with 0.1-0.2em tracking, which is illegible on phones and strains on desktop.**
  <br>Evidence: grep 'font-size: 0.[0-6]' → 27 hits; styles.css:4253 `.mission-modal-img-placeholder … 0.55rem`, 2756 `.faction-code-badge 0.6rem`, 2798 `.building-status-badge 0.6rem`, 2945 `.logistics-current-badge 0.6rem`, 3320 `.office-panel__label 0.6rem`, 4774 `.completed-mission-type 0.62rem`. Verified.
- **sev 3** · `projects/interstellar-settlement-protocol/public/scripts/starfield.js:47` — **Ambient motion never respects prefers-reduced-motion and never pauses: a 260-star canvas is redrawn every frame on every page (including login/register and the whole game session), plus infinite nebulaDrift, logoFloat, levelGlow and downtime-pulse keyframes.**
  <br>Evidence: grep prefers-reduced-motion / matchMedia across public/ → none; starfield.js:47-68 draw() calls requestAnimationFrame unconditionally, mounted by index.html:15, login.html:15, register.html:15; styles.css:248 `animation: nebulaDrift 90s … infinite`, 308 `logoFloat 8s … infinite`, 4908 `levelGlow 1.2s ease infinite`, 3636 `downtime-pulse 2s … infinite`. Verified.
- **sev 3** · `projects/interstellar-settlement-protocol/public/index.html:292` — **The main tab strip is 15 unstructured pill buttons that wrap into 4-6 rows on a phone and 2-3 on a tablet; it carries no tablist/tab/aria-selected/aria-controls semantics (only class toggling), and the sidebar 'Quick Actions' duplicates five of the same destinations.**
  <br>Evidence: index.html:292-309 the old tab row's markup; styles.css:1113-1118 its `display:flex; flex-wrap: wrap` rule; app.js:4984-4995 setTab toggles classes only; index.html:280-286 Quick Actions buttons with data-jump. Chat tabs by contrast do set role=tab/aria-selected (index.html:718-722, app.js:4776). Verified; row counts inferred from ~30px pill height and label lengths.
- **sev 3** · `projects/interstellar-settlement-protocol/public/styles.css:1526` — **Form controls in the game shell have no :focus style (browser default blue ring on a cyan UI), the chart duration picker removes the outline and replaces it with only a faint border change, and interactive pills/tabs are 20-30px tall — below touch-target guidance.**
  <br>Evidence: styles.css:1526-1534 `input, select, textarea` has no :focus rule (grep focus → only 555, 1445, 4414, 4966-4981); 1444-1448 `.chart-duration-picker:focus { … outline: none; }`; heights computed from padding+font: the old tab buttons 1120-1128 (~30px), `.inbox-folder-btn` 2157-2166 (~27px), `.exchange-filter-pill` 5132-5141 (~26px), `.office-nav-btn` 3474-3486 (~20px). Rules verified; pixel heights computed, not measured.
- **sev 3** · `projects/interstellar-settlement-protocol/public/styles.css:3703` — **Ten selectors are defined twice with conflicting declarations (last wins), which is how the file drifted: .btn, .action-surface (gradient vs color-mix), .compact-action-form (max-width vs flex), .action-hint, .chart-card (padding 1rem vs 0.7rem + fixed 280px), .tab-panel (padding 1.15/1.2rem vs 1rem), .forum-thread-full (860 vs 920px), .thread-reply-list, .thread-reply, #market.**
  <br>Evidence: styles.css pairs: .btn 992/3703; .action-surface 1596/3213; .compact-action-form 1603/3218; .action-hint 747/3239; .chart-card 1056/1246; .tab-panel 1051/1136; .forum-thread-full 3794/3837; .thread-reply-list 1919/4121; .thread-reply 1927/4143; #market 71/76. Verified by grep of duplicate top-level selectors.
- **sev 3** · `projects/interstellar-settlement-protocol/public/scripts/charts.js:9` — **The chart palette duplicates the CSS tokens by literal value and sets no font family, so Chart.js renders legends/ticks in Helvetica/Arial at 10-11px inside an Inter/Orbitron UI, and any token change must be made in two places.**
  <br>Evidence: charts.js:9-34 COLOR/SECTOR_PALETTE hard-code #00f7ff, #ffaa33, #d8ebf5, #89a7bd etc.; grep 'family|Chart.defaults' in charts.js → none; font sizes at 66, 77, 81-82, 306, 352-353. Verified.
- **sev 3** · `projects/interstellar-settlement-protocol/public/scripts/app.js:3239` — **Empty states use at least six different patterns (hidden <p class=muted> toggled by JS, centered <td class=assets-empty>, italic .logistics-empty, .thread-reply--empty, a .queue-item wrapper, an always-visible paragraph) and none offer an icon, illustration or call-to-action button; there is no loading state anywhere (no spinner/skeleton; KPIs show '—').**
  <br>Evidence: index.html:581, 604, 627, 649, 680 hidden muted paragraphs toggled at app.js:3854-3970; app.js:3498/3605 assets-empty (css 3188-3193); app.js:3708 logistics-empty (css 2955-2960, italic); app.js:4034 thread-reply--empty; app.js:3239 queue-item wrapper; index.html:783 active-missions-empty. grep loading/spinner/skeleton in app.js → only a placeholder attribute (4084); KPI placeholders index.html:392-415. Verified.
- **sev 3** · `projects/interstellar-settlement-protocol/public/styles.css:76` — **Three ~300 KB JPEGs (galactic_exchange, isa_claims_leases_division, orbital_executive_suites) are loaded as building-page backgrounds and then covered by a 78%-opacity black overlay, so ~987 KB is downloaded for an image that is barely perceptible.**
  <br>Evidence: styles.css:76-83, 98-118, 134-154 (galactic_exchange.jpg, 361 KB), 180-200 (isa…, 321 KB), 202-224 (oes…, 305 KB); each has `::before { background: var(--void-black); opacity: 0.78 }`. File sizes from ls. Verified.
- **sev 3** · `projects/interstellar-settlement-protocol/public/styles.css:2437` — **The full-page travel card and the starmap station modal keep 96px / 80px of horizontal padding on a 375px screen (no mobile override), leaving ~279px / ~257px for content.**
  <br>Evidence: styles.css:2437-2445 `.travel-page-card { padding: 2.5rem 3rem; max-width: 560px; width: 100% }`; 2579-2588 `.starmap-modal-card { padding: 2rem 2.5rem; width: 90% }`; no @media touches either (media list at 172-5285). Verified.
- **sev 3** · `projects/interstellar-settlement-protocol/public/register.html:40` — **Registration pre-fills real values ('New CEO', 'Frontier Protocol Ventures') via value= rather than placeholder=, so playtesters who skip those fields register duplicate-named corporations.**
  <br>Evidence: register.html:40 `<input id="register-ceo" … value="New CEO" />`, :43 `<input id="register-corp" … value="Frontier Protocol Ventures" />` while the email/password fields use placeholder= (34, 37). Verified markup; server-side uniqueness not checked.
- **sev 4** · `projects/interstellar-settlement-protocol/data/buildings.json:13` — **All 17 NPC buildings declare an imageFile under buildings/*.png, but public/images has no buildings/ directory and nothing in server/ or public/scripts/ reads the field — dead data that will 404 the moment a redesign wires it up.**
  <br>Evidence: data/buildings.json:13, 27, 41 … 237 (17 entries); `ls public/images` shows only 8 files + planets/; grep imageFile in server/ public/scripts/ → none. Verified.
- **sev 4** · `projects/interstellar-settlement-protocol/public/images/mining_probe_old.png:1` — **Three image assets (~733 KB) are never referenced: 'asteroid belt.jpg' (243 KB, filename contains a space), cover_image.jpg (295 KB), mining_probe_old.png (195 KB).**
  <br>Evidence: grep -ri for each name across *.js/*.html/*.css/*.json/*.md (excluding node_modules and accounts-snapshot) → no hits; all three arrived in the single squash commit 4f92687 with no prior reference. Verified.
- **sev 4** · `projects/interstellar-settlement-protocol/public/index.html:4` — **No page declares a favicon, <meta name=description>, theme-color or Open Graph tags, so every load 404s /favicon.ico and shared links have no preview.**
  <br>Evidence: grep favicon|rel="icon"|theme-color|name="description"|og: across public/*.html and server/index.js → none. Verified.
- **sev 4** · `projects/interstellar-settlement-protocol/public/styles.css:1519` — **A global `label { display: grid }` turns every label into a block grid, so the starmap toolbar's inline 'Overlay <select>' label stacks the select under its caption.**
  <br>Evidence: styles.css:1519-1524; index.html:941-950 `<label>Overlay <select id="map-overlay">`. Rule verified; layout effect inferred.
- **sev 4** · `projects/interstellar-settlement-protocol/public/styles.css:4562` — **Icons are Unicode glyphs (▾ ⏱ ★ ▲ ⭐ ←) rendered by whatever emoji/symbol font the OS has, so they differ in weight and colour per platform; there is no icon set.**
  <br>Evidence: styles.css:4562 `content: "⏱"`; index.html:267 `▾`, 371/769/797 `&#8592;`; app.js:4029/4070 `▲`, 4487 `⭐`, rep stars css 4621-4630. Verified.

### Test coverage, and what it does not cover

Nothing in tests/ touches the visual layer. vitest.config.js sets `environment: "node"`, includes only `tests/**/*.test.js`, and restricts coverage to `server/**/*.js`; grep for public/, index.html, styles.css, jsdom, happy-dom or playwright across tests/ and the config returns nothing. The suite is tests/unit/* (applyMiningOperations, applyRefineryOperations, catalogs, createCombatReport, finances, getEffectiveExchangeTaxRate, mergeDummyAccount, phase1-3Repositories), tests/integration/auth.test.js and tests/schema/data-files.test.js — all server-side. Not covered: any rendering, responsive layout at 375/768/1440, class-to-CSS consistency (the six undefined button classes would be caught by a 60-line static check), var() references to undefined custom properties, image references resolving to real files (buildings.json imageFile), font loading, keyboard reachability, contrast, or the reward animations.

### Before you touch this in v0.5

- Scope conflict to resolve first: BRIEF.md:50 lists Mobile as out of scope ('desktop browser game and pretending otherwise would cost the density'), and BRIEF.md:25 'not a mobile idle game'; the Board's v0.5 request says the design must be usable on mobile and that should never be a limitation. Amend the BRIEF or scope the mobile story explicitly before the redesign stories are written.
- The docs describing the design are stale: DESIGN_DOCUMENT.md:24 says 'Orbitron (headers), Inter (body)' but no global h2/h3 rule exists (only h1 at styles.css:730); DESIGN_DOCUMENT.md:228-250 lists 8 tokens and 10 'key component classes' out of ~260 in use. README.md:108 promises 'No build step' — keep that promise: tokens + a split into several <link>ed files needs no bundler.
- Start the visual overhaul with a token layer, not with components. 254 literal rgba(0,247,255,…) values, 16 radii, 51 font sizes, 12 z-indexes and 8 undefined variables mean any restyle done component-by-component will drift again within weeks. Define --space-*, --radius-*, --text-*, --z-*, --duration-* and a semantic color set (surface/border/text/accent/success/warn/danger — note --success is used at 4353/4378 but never defined), then replace literals with a scripted search.
- Decide the brand colour before touching components: the current accent is pure #00f7ff (styles.css:8) with text-shadow glows (10 rules) — this, plus Orbitron uppercase micro-labels (35 Orbitron rules, 44 uppercase, 82 letter-spacing), glossy gradient buttons with a 1px white inset highlight (466-470), blurred glass panels (9 backdrop-filter) over dimmed stock JPEGs, corner-bracket and scanline pseudo-elements (600-626, 775-790), and a wrapping cloud of 15 pill tabs, is what reads as 2005-2010. The most contemporary pieces already in the file, worth keeping as the reference for the rest: the KPI strip (1304-1379), mission cards (4939-5100), thread detail (3836-4167) and the mission-complete overlay (4790-4937).
- Reward moments the Board asked for mostly do not exist yet. Present: mission-complete overlay with particles and agent-reputation level-up glow (app.js:4470-4504), btn-pulse-success (629-632), requirement strikethrough (2900-2905). Absent: any ceremony for corporation level-up (the milestone loop the whole game is built on — grep finds only reputation level-up), first office / first hire / first extractor / first sale, R&D completion, and there is no toast/notification layer at all (feedback is `status.textContent = …` into a grey <p>, e.g. app.js:4915, 4934, 4973). Build one toast + one 'milestone reached' overlay primitive and route every completion through them.
- Navigation needs restructuring, not restyling: 15 flat tabs (index.html:292-309) plus a sidebar Quick Actions block duplicating five of them (280-286). A left rail with grouped sections (Command / Industry / Market / Social / Map) that collapses to a bottom bar or drawer under 768px is the conventional answer for this density; it also fixes the 4-6 rows of pills on a phone.
- Mobile is currently broken by a small number of rules, not by the whole layout: remove the vw/px caps at styles.css:1934, 2143, 2563, 3244, 3747, 4408, 4443, 4666, 4950 and lower the grid minimums at 712, 1457, 2677, 2895, and the 960px collapse (2113) does most of the rest. Do this before the redesign so the new components are built mobile-safe from the start. Breakpoints in use are 480/520/580/600/640/700/900/960/1100 — pick three.
- Accessibility starts from zero on the keyboard: no key handlers in the client, no dialog semantics, no :disabled styles, no reduced-motion, and section role=button cards that cannot be activated. Add a shared modal primitive (role=dialog, aria-modal, focus trap, Escape) and replace the four existing implementations (2036, 2568, 4170, 4791); convert role=button sections to <button> or add Enter/Space handling; add a `@media (prefers-reduced-motion: reduce)` block and stop the starfield rAF loop under it.
- Fonts: either load Share Tech Mono (or drop the Finance board's mono stack for Inter with tabular-nums, already set at 1357/1474/5250) and set Chart.defaults.font.family in charts.js; consider self-hosting the three Google Fonts and chart.js@4.4.3 (index.html:11, 16) when moving to Azure so the game works with a CSP and offline dev.
- Assets for the Azure move: public/images is ~2.4 MB served by bare express.static (server/index.js:425) with no cache headers or compression. Delete the three orphans (asteroid belt.jpg — note the space, cover_image.jpg, mining_probe_old.png), decide whether the three 78%-dimmed JPEG backgrounds earn their ~1 MB, and either remove buildings.json imageFile (17 missing PNGs) or produce the 17 images. Add a favicon and meta description/OG tags.
- Hygiene that makes the redesign safer: unify hide mechanisms ([hidden] vs .active vs inline display:none at index.html:890-914); move the 15 inline styles in index.html and 100 in app.js into classes; resolve the ten duplicate selector definitions; fix the 8 undefined var() references; delete the display:none .cta-section (index.html:231-234); keep `.walkthrough-focus` (2054-2060) working against the new components because the onboarding walkthrough targets the tab buttons by `data-tab` (`.nav-tab[data-tab=…]` since AB#764) (app.js:209-275).
- Add a cheap client-side test before the overhaul lands so regressions are caught without a browser: a Node script that (a) collects every class in public/*.html and every class="…" in public/scripts/*.js and asserts each has a rule in styles.css, (b) asserts every var(--x) has a definition, (c) asserts every /images/ and imageFile path exists. That would have flagged 6 undefined button classes, 8 undefined variables and 17 missing images today. If the Board wants visual QA, Playwright screenshots at 375/768/1440 of each tab is the next step (Relic Vault already runs Playwright per CLAUDE.md).
- Copy is part of the visual first impression: strip 'prototype', 'developer mode', 'dummy account' and 'Why This Prototype Exists' from index.html:80-84/209-229 and login.html:27-31/44 before playtesting, and change register.html:40/43 value= defaults to placeholder=.

---

<a id="tests-tooling-docs"></a>

## tests-tooling-docs

**Scope.** TESTS, TOOLING and PRODUCT DOCS (tests/, vitest.config.js, package.json, vercel.json, .github/, kanban/, server/kanban.js, root *.md)

The test layer is vitest 4.1.5 (installed; node_modules present) with 12 files / 139 tests configured by vitest.config.js:7-8 to load tests/setup.js, which blanks every Supabase env var to "" (not delete, because server/loadEnv.js:37 refills undefined keys from .env), sets VERCEL=1 so gameState.js takes its IS_SERVERLESS branch and never writes to disk (all four safeWriteFile call sites at gameState.js:1473/1514/1633/1830 are behind IS_SERVERLESS guards at :1472/:1513/:1631/:1821), sets ISP_DISABLE_TICKERS=1 to skip the nine setInterval registrations in server/index.js (:460,:484,:497,:569,:604,:666,:715,:768,:797), and sets ALLOW_DUMMY_AUTH=1 (which the server ignores; index.js:281 hardcodes it true). I ran `npx vitest run`: 138 pass, 1 FAILS — tests/schema/data-files.test.js:224 expects data/state.json to contain chatLog, but that file is gitignored (.gitignore:2), runtime-generated, and nothing in the server ever seeds chatLog (only appendChatMessage :2011 and the never-called resetChatHistory :2023 reference it), so on a fresh clone the whole schema file errors at collection time and on this checkout the assertion fails. Coverage is confined to auth routes, catalog schemas, three pure-function modules (mining, refinery, finances), tax-rate/combat-report/mergeDummy helpers and the Phase 1-3 Supabase row mappers; no gameplay route, market route, forum route, ticker, socket handler, level-evaluator, client script, or e2e test exists, despite DEVELOPMENT_PHASES.md:56-58 marking "unit, integration, and end-to-end tests" and "coverage reporting to CI pipeline" complete (there is no CI configuration anywhere in the repo; .github/ holds only custom-instructions.md). Tooling: package.json scripts are start/dev/check/test/test:watch/test:coverage (no lint, no engines field, version "0.4" is not semver); vercel.json routes everything to server/index.js and includes public/** and data/** but not kanban/**; kanban/ is a 38-card drag-and-drop board (30 To Do / 3 Doing / 5 QA / 0 Done) mounted inside the game server at index.js:426-434 with an unauthenticated POST /kanban/api (server/kanban.js:32) that overwrites kanban/kanbanState.json and a client that injects card titles via innerHTML unescaped. The nine root docs are heavily drifted from the build: every doc was checked against at least three code anchors below, and the recurring conflicts are the office minimum (docs say 30 days; code index.js:1094 is 7/14/21/28 default 7), the research catalogue (DESIGN_DOCUMENT lists 4 nodes at $18k-$54k; research.json and index.js:55-175 agree on 13 nodes at $2k-$20k), "30-day" finance histories that are actually a 30-minute window (index.js:776 30s interval × finances.js:7 MAX_SNAPSHOTS 60), and LORE's "Earth: no extraction rights" against index.js:1256 selling Earth leases for 20,000. A separate process is running the ISP server on :3000 (PID 20868) in this checkout and is rewriting data/accounts-snapshot.json every few minutes; the test suite cannot write that file, and I did not read it.

### Entry points

- `tests/setup.js env guard` — `tests/setup.js:10` — Blanks SUPABASE_*/NEXT_PUBLIC_* to "" (line 10-15), VERCEL=1 (20), NODE_ENV=test (22), JWT_SECRET fallback (23), ISP_DISABLE_TICKERS=1 (26), ALLOW_DUMMY_AUTH=1 (28); loaded via vitest.config.js setupFiles
- `vitest.config.js` — `vitest.config.js:3` — include tests/**/*.test.js, setupFiles tests/setup.js, v8 coverage over server/**/*.js excluding loadEnv.js and kanban.js; default pool (per-file isolation)
- `getApp` — `tests/helpers/app.js:11` — Dynamic-imports server/index.js once per test file (module cached); relies on ISP_DISABLE_TICKERS to avoid spawning intervals
- `registerAccount` — `tests/helpers/api.js:20` — POST /api/auth/register with a unique email; returns account + access/refresh tokens; accepts 200 or 201
- `authed` — `tests/helpers/api.js:50` — Wraps supertest get/post/put/delete/patch with Authorization: Bearer <token>
- `resetMarketState (UNUSED)` — `tests/helpers/reset.js:8` — Clears market.orderBook and resets npcBuyOrders.remainingQty; no test imports it
- `makeCorp / makeExtractor` — `tests/fixtures/makeCorp.js:7` — Minimal corp fixture (1,000,000 credits, earth-station-prime) with deepMerge overrides; makeExtractor at line 26 gives a 600/h, zero-cost, 1h extractor
- `Auth integration suite` — `tests/integration/auth.test.js:5` — register/login/refresh/logout/session/dummy-login/dummy-reset/requireAccountAccess/bootstrap/stations/buildings/dev set-credits via supertest; contains a real 1100ms sleep at line 108
- `Data catalog schema suite` — `tests/schema/data-files.test.js:18` — Structural checks on buildings/stations/systems/research/refinery-chains/ceo-insight/milestones JSON; line 219-225 also reads gitignored data/state.json (FAILS)
- `applyMiningOperations unit suite` — `tests/unit/applyMiningOperations.test.js:11` — Inactive extractor, throughput math, tech multipliers (+10%, ×1.06), op-cost deduction, affordability scaling, minedRemainder carry, downtime trigger/15-min floor/recovery, industrial-safety; pins Math.random
- `applyRefineryOperations unit suite` — `tests/unit/applyRefineryOperations.test.js:30` — Inactive/no-chain/unknown-chain/before-endsAt/at-endsAt output to station inventory using first REFINERY_CHAINS entry
- `finances.js unit suite` — `tests/unit/finances.test.js:14` — ensureFinanceTracking, recordIncome/Expense, computeLiveLiabilities (7-day forward burden + office leaseDailyCost×daysRemaining), computeAssetBreakdown, buildSnapshot, pushSnapshot cap
- `catalogs unit suite` — `tests/unit/catalogs.test.js:17` — Pins EXPEDITION_LAUNCH_COST=3000, PROBE_BUILD_COST=8000, PROBE_ASSET_VALUE=5000, BASE_MAX_PROBES=2, BASE_MAX_DEPLOYMENTS=1; shape checks on REFINERY_CHAINS, CEO_INSIGHT_LIBRARY, MISSION_TEMPLATES, SYSTEM_DETAILS, BELT_COMPOSITIONS, EXPEDITION_DURATIONS
- `Phase 1/2/3 repository mapper suites` — `tests/unit/phase1Repositories.test.js:75` — Round-trip account<->row mappers for corp/finance/military/unlocks/sets (phase1), buildings/offices/leases/extractors (phase2 :100), refineries/asteroid/inventory/trade/missions/queues/notifications/messages (phase3 :188); persist/hydrate functions asserted as no-ops because USE_NORMALIZED_TABLES is blank
- `createCombatReport / getEffectiveExchangeTaxRate / mergeDummyAccount suites` — `tests/unit/createCombatReport.test.js:4` — Combat report id/createdAt/unshift/cap-50 into global state; tax 8%→2% over three negotiation levels (getEffectiveExchangeTaxRate.test.js:8); dummy-account merge semantics (mergeDummyAccount.test.js:4)
- `package.json scripts` — `package.json:6` — start=node server/index.js; dev=node --watch-path=./server --watch-path=./public; check=node --check; test=vitest run; test:watch; test:coverage. deps express ^4.19.2 (installed 4.22.1), socket.io ^4.8.1 (4.8.3), @supabase/supabase-js ^2.103.3, bcryptjs ^3.0.3, jsonwebtoken ^9.0.3; devDeps vitest ^4.1.5, @vitest/coverage-v8 ^4.1.5, supertest ^7.2.2
- `vercel.json` — `vercel.json:1` — @vercel/node build of server/index.js with includeFiles public/** and data/** (not kanban/**); routes /api/(.*) and catch-all to server/index.js after filesystem
- `Ticker registrations guarded by ISP_DISABLE_TICKERS` — `server/index.js:460` — Nine setInterval calls: npc reset :460 (60s), miningTick :484 (5s), refineryTick :497 (10s), asteroidExpeditionTick :569 (10s), fabricationTick :604 (5s), travelTick :666 (5s), processRndCompletions :715 (5s), processCeoInsightCompletions :768 (5s), financialSnapshotTick :797 (30s); all exported at :3437-3448 but untested
- `IS_SERVERLESS switch` — `server/gameState.js:15` — Boolean(process.env.VERCEL) gates every disk write (state.json at :1472/:1513/:1821, accounts snapshot at :1631/:1643) and the rehydrate/flush middleware at index.js:407 and listen() at :3422
- `Kanban mount in game server` — `server/index.js:426` — Serves kanban/kanban.html at /kanban and static files under it, then mounts kanbanRouter (imported at :3)
- `Kanban API` — `server/kanban.js:27` — GET /kanban/api returns kanban/kanbanState.json; POST /kanban/api (:32) writes req.body straight to that file with no auth or validation
- `Kanban client` — `kanban/kanban.js:306` — main() fetches state and renders drag-and-drop columns; edit/add/delete UI shown only when location.hostname is localhost (:86, :247) — client-side gating only
- `Kanban page` — `kanban/kanban.html:30` — Fetches /package.json for a version badge; express.static only serves public/, so this 404s and the badge falls back to 'v0.1.0'
- `Copilot custom instructions` — `.github/custom-instructions.md:1` — 20KB design brief (starting economy, walkthrough, 40-level progression, conglomerates, market, TDD mandate) plus process rules that name Todos.md and DESIGN_DOCUMENT.md as always-in-context
- `DEVELOPMENT_PHASES v0.5 section` — `DEVELOPMENT_PHASES.md:67` — The roadmap slice this pass implements (reproduced in notesForV05)

### State this subsystem reads or writes

- `process.env.SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / USE_NORMALIZED_TABLES (blanked by tests/setup.js:10-15)`
- `process.env.VERCEL (tests/setup.js:20 → gameState.js:15 IS_SERVERLESS; index.js:407, :3422)`
- `process.env.ISP_DISABLE_TICKERS (tests/setup.js:26 → index.js nine setInterval sites)`
- `process.env.NODE_ENV / JWT_SECRET / ALLOW_DUMMY_AUTH / PORT (tests/setup.js:22-28; index.js:52, :280-281, :3421)`
- `state.market.orderBook (tests/helpers/reset.js:11; index.js:3093)`
- `state.market.npcBuyOrders[].remainingQty / totalQtyPerDay / lastResetDate (reset.js:12-16; index.js:442-456; gameState.js:1487-1510)`
- `state.combatReports (createCombatReport.test.js; index.js:3359-3387)`
- `state.chatLog[channel] (data-files.test.js:224; gameState.js:2011 — never seeded)`
- `state.forums.{categories,threads} (index.js:2914-2939; app.js:4187-4242 — never seeded)`
- `corp.finances.{credits,assets,liabilities,dailyRevenue,dailyCosts,incomeBySource,expensesByCategory,snapshots,lifetimeRevenue,lifetimeCosts} (finances.test.js; server/finances.js)`
- `corp.mining.silicateExtractors[] (applyMiningOperations.test.js; makeCorp.js:19-21)`
- `corp.miningLeases[].{id,body,buildingSlots,extractorIds} (mining test :48; phase2 test :41-50)`
- `corp.inventory[stationId][item] (mining test :59; refinery test :95)`
- `corp.unlockedTech[] (mining test :66-67)`
- `corp.refineries[] (applyRefineryOperations.test.js)`
- `corp.offices[].{leaseDailyCost,daysRemaining,rentedUntil,durationDays} (finances.test.js:116-134; phase2 test :29-40)`
- `corp.completedInsights[] (getEffectiveExchangeTaxRate.test.js)`
- `account refresh-token store (auth.test.js refresh/logout; index.js:911-947)`
- `kanban/kanbanState.json (server/kanban.js:6, :23)`
- `data/state.json (gitignored; read by data-files.test.js:220 and gameState.js:1469)`
- `data/accounts-snapshot.json (gitignored; NOT read by me; written by gameState.js:1633 only when !IS_SERVERLESS)`
- `data/buildings.json, stations.json, systems.json, research.json, refinery-chains.json, ceo-insight.json, milestones.json (data-files.test.js)`

### TODOs in this code

- `DEVELOPMENT_PHASES.md:72` — [ ] Action current set of TODOs (v0.5 first item — the list below is that set)
- `server/index.js:51` — Move this (IS_DEV) to a single file so that we aren't redefining it everywhere
- `server/index.js:54` — RESEARCH_LIBRARY should be extracted from the DB or from research.json
- `server/index.js:180` — Store in DB
- `server/index.js:274` — Remove NEAR_STAR_SYSTEMS, we can simply check for these values when travel beyond is gated
- `server/index.js:500` — Consider implementation of unified tick system where all tick based actions are performed at once
- `server/index.js:800` — Consider moving API to a dedicated api.js file
- `server/index.js:1255` — Should we be storing the lease costs here? And why are we only specifying for Earth, Mars, and Luna?
- `server/gameState.js:132` — This should be fetched from systems.json, see SYSTEMS_DATA
- `server/gameState.js:206` — Update to use SYSTEMS_DATA
- `server/gameState.js:369` — Is this still needed?
- `server/gameState.js:531` — Add force-stop functionality
- `server/gameState.js:746` — Asteroid Belts should be more dynamic. Once they spawn, there is a limited amount of ore to be mined.
- `server/gameState.js:762` — Rarity should be more dynamic
- `server/gameState.js:774` — In addition to rarity improving yields, it should also determine what types of raw resources are available
- `server/gameState.js:874` — Should we really be defaulting to common? In what circumstances is SYSTEM_RARITY[exp.systemId] null?
- `server/gameState.js:943` — Should BASE_EXCHANGE_SALES_TAX_PCT be hardcoded? Or should we store it in the database?
- `server/gameState.js:1078` — Should createStarterCorporationState all be hardcoded? Or should some of it be based upon completed research, etc?
- `server/gameState.js:1176` — Mission templates shouldn't be hardcoded in this way. The values should be more random.
- `server/gameState.js:1336` — Remove legacy data
- `server/gameState.js:1486` — Reevaluate how NPC_BUY_SEED is stored. Should it be hardcoded? Should it be more dynamic?
- `server/gameState.js:1587` — Evaluate account persistence functionality. We are frequently having connection issues which trigger the below errors.
- `server/gameState.js:1615` — Remove all local disk account snapshots. All operations should go through the DB
- `server/gameState.js:1790` — Evaluate if this is needed
- `server/gameState.js:2479` — Evaluate usage of Refresh Tokens
- `server/finances.js:80` — Save a snapshot of financial data every x minutes to Supabase
- `public/index.html:2` — Content should be fetched from database
- `public/login.html:2` — page header should be loaded from a standalone file. Each HTML file should use the same header.
- `public/register.html:2` — page header should be loaded from a standalone file
- `public/scripts/app.js:67` — Research library should be fetched from db or research.json (third copy of RESEARCH_LIBRARY)
- `public/scripts/app.js:190` — Store in DB or fetch from insight.json
- `public/scripts/app.js:206` — Move walkthroughSteps to dedicated file
- `public/scripts/app.js:533` — Ensure all helper functions are consolidated into a single function
- `public/scripts/app.js:558` — Ensure this function is updated when we make asteroid belts dynamic
- `public/scripts/app.js:801` — Expand design of intro dialogue
- `public/scripts/app.js:837` — Remove, we have a duplicate function in gameState.js, and this should be extrapolated based on values in the DB
- `public/scripts/app.js:1349` — Move the rendering and functionality of each building to their own dedicated file
- `public/scripts/app.js:2061` — Overhaul Travel Page design
- `public/scripts/app.js:2254` — Consolidate all helper functions to singular file
- `public/scripts/app.js:2606` — Consolidate helper functions to singular file
- `public/scripts/app.js:2840` — This information should be stored in the database OR in milestones.json
- `public/scripts/app.js:3184` — Remove duplicate. This should be stored in the database
- `public/scripts/app.js:3190` — Remove. This is defined within gameState.js but should be fetched from the DB or from milestones.json
- `public/scripts/app.js:3885` — Remove mercenary references. Functionality isn't built yet.
- `public/scripts/app.js:4307` — This should be defined in the database
- `public/scripts/app.js:4336` — This should be in the database
- `public/scripts/app.js:4492` — Should visual effects be moved to their own file?
- `public/scripts/app.js:4788` — Can updateAllViews be refactored to improve performance? Do we always need to update every single view?
- `public/scripts/app.js:5045` — Duplicate function found in gameState.js
- `public/scripts/app.js:5064` — Duplicate function?
- `public/scripts/app.js:5285` — Duplicate function possibly exists in gameState.js
- `public/scripts/app.js:5495` — Move all functionality for the forums to its own dedicated file
- `public/scripts/app.js:5857` — Investigate current socket.io implementation
- `public/scripts/login-page.js:4` — Move IS_DEV_ACCESS duplicate to a single file
- `public/scripts/register-page.js:10` — Implement email verification
- `public/scripts/starmap.js:77` — Add detailed images for outstanding planets
- `public/styles.css:1` — Organize CSS
- `Todos.md:30` — [ ] Overhaul the guided first-session walkthrough to conform to NEW_PLAYER_EXPERIENCE.md
- `Todos.md:40` — [ ] Market order matching engine — player-created buy orders automatically fill against matching sell orders (the only Todos.md item not already built)

### Suspected defects (candidates — unverified, not filed)

- **sev 2** · `server/gameState.js:2011` — **Chat is broken on any fresh state: state.chatLog is never seeded, so the first appendChatMessage throws TypeError and the message is dropped.**
  <br>Evidence: VERIFIED by execution: importing gameState.js with VERCEL=1 and calling appendChatMessage('global', {...}) threw "TypeError: Cannot read properties of undefined (reading 'global')"; getState().chatLog was undefined beforehand. grep shows chatLog referenced only at :2011-2018 and in resetChatHistory (:2023-2025), which has zero callers in server/*.js; getSeedState (:1436-1462) and normalizeStateShape (:226+) never create it. The socket handler index.js:3412 calls appendChatMessage inside io.on('connection'); the process survives only because of the uncaughtException handler at index.js:390. README.md:78 and DEVELOPMENT_PHASES.md:34 ('Persistent chat history', marked done) both claim working chat.
- **sev 2** · `server/index.js:780` — **financialSnapshotTick broadcasts every corporation's finances to every connected socket every 30 seconds, and dummy-mode clients overwrite their own finance panel with whichever account was iterated last.**
  <br>Evidence: VERIFIED by reading: index.js:780-793 loops getAllAccountIds() and does io.emit('finance:updated', finances) per account with no room/accountId; app.js:5911-5919 accepts the payload whenever appState.profileMode === 'dummy' and assigns appState.data.corp.finances = financeState, then re-renders. Not executed against a multi-account server.
- **sev 2** · `server/kanban.js:32` — **The dev kanban board is shipped inside the production game server with an unauthenticated write endpoint and a stored-XSS sink.**
  <br>Evidence: VERIFIED by reading: server/kanban.js:32-35 writes req.body verbatim to kanban/kanbanState.json for any caller; index.js:3, :426-434 mount it unconditionally; kanban/kanban.js:71-72, :149, :152 inject card.title/description via innerHTML without escaping; the edit/add UI is hidden only by a client-side hostname check (:86, :247). BRIEF.md:70-71 says the board is also served on burkart.dev. Whether any deployment currently exposes it was not verified.
- **sev 3** · `tests/schema/data-files.test.js:220` — **The test suite is red on this checkout and cannot pass on a fresh clone because it reads a gitignored, runtime-generated file.**
  <br>Evidence: VERIFIED by execution: `npx vitest run` → 1 failed / 138 passed; failure at :224 `expect(data.chatLog).toBeDefined()`. data/state.json is ignored (.gitignore:2; absent from `git ls-files data`), so `load('state.json')` at describe scope (:220) throws ENOENT on a clean checkout and fails the whole file. The on-disk file here (mtime 17:47, keys world/corp/queues/missions/combatReports/playerProfile/market) has no chatLog because nothing seeds one. BRIEF.md:60 acceptance ISP-11 ('a clean environment comes up from the repo') is therefore currently red.
- **sev 3** · `server/index.js:776` — **The 'Financial Core' charts hold a 30-minute rolling window, not the '30-day' histories the roadmap and design doc mark as complete; every account is mutated and persisted every 30 s to produce it.**
  <br>Evidence: VERIFIED by reading: FINANCIAL_SNAPSHOT_INTERVAL_MS = 30_000 (index.js:776), MAX_SNAPSHOTS = 60 (finances.js:7), pushSnapshot trims to 60 (finances.js:124-131) → 30 minutes of data. financialSnapshotTick calls mutateAccountState for every account each tick (index.js:780-786), which schedules a Supabase persist. DEVELOPMENT_PHASES.md:62,65 claim '30-day' `finances.cashflowHistory[]` / `finances.creditsHistory[]`; DESIGN_DOCUMENT.md:266,269 repeat it; neither field name exists anywhere in server/ or public/ (grep) — charts.js:140 reads finances.snapshots.
- **sev 3** · `server/index.js:473` — **miningTick broadcasts every player's extractors, station inventory and credit balance to every connected socket every 5 s.**
  <br>Evidence: VERIFIED by reading: index.js:473-479 io.emit('mining:updated', { accountId, extractors, inventory, credits }) inside a loop over all accounts. The client filters by accountId (app.js:5980) but the data is already on the wire to all clients. Information disclosure plus O(accounts) broadcast cost.
- **sev 3** · `server/index.js:3359` — **POST /api/combat/simulate is unauthenticated and writes attacker-supplied strings into global state.combatReports, broadcast to all clients.**
  <br>Evidence: VERIFIED by reading: route at :3359 has no requireAuth (the blanket guard at :958 covers only /api/accounts/:accountId); it calls createCombatReport (:3374) which unshifts into global state (cap 50, per createCombatReport.test.js:42-55) and io.emit('combat:newReport') at :3386. Not in the known-defects list.
- **sev 3** · `server/index.js:3407` — **Chat author identity is client-supplied and the socket is unauthenticated, so any client can post as any corporation name.**
  <br>Evidence: VERIFIED by reading: io.on('connection') at :3395 performs no token check; chat:send builds `author: stripHtml(payload?.author || 'Anonymous')` (:3407) and broadcasts (:3413). Distinct from AB#433 (registration name validation) — this one needs no account at all.
- **sev 3** · `public/scripts/app.js:4241` — **Forum categories are never seeded anywhere, so a fresh install has an empty category list (likely blocking thread creation).**
  <br>Evidence: VERIFIED: getSeedState (gameState.js:1436-1462) has no `forums` key; live import shows getState().forums?.categories === undefined; grep for the six category names in .github/custom-instructions.md:216-222 finds none in app.js/index.html/gameState.js; client builds the select from data.forums?.categories || [] (app.js:4238-4242). INFERRED (not executed): index.js:2896 thread creation with category '' probably 400s. DEVELOPMENT_PHASES.md:61 marks 'Forum posting and replying' done.
- **sev 3** · `DEVELOPMENT_PHASES.md:56` — **v0.4 items 'unit, integration, and end-to-end tests', 'test coverage reporting to CI pipeline' and 'tests for mining, leasing, exchange, R&D' are marked [x] but no e2e framework, no CI config, and no leasing/exchange/R&D tests exist.**
  <br>Evidence: VERIFIED: package.json:21-25 devDeps are vitest, coverage-v8, supertest only; tests/ tree has no e2e directory; .github/ contains only custom-instructions.md (no workflows/), no azure-pipelines.yml at root; the only route tests are auth.test.js; grep of tests/ finds no import of miningTick/processRndCompletions/etc. despite their export at index.js:3437-3448.
- **sev 4** · `tests/integration/auth.test.js:234` — **The auth suite asserts that unauthenticated POST /api/dev/set-credits succeeds, enshrining known defect AB#423; fixing #423 as filed will turn this test red.**
  <br>Evidence: VERIFIED by reading: :234-243 posts { accountId: 'dummy', credits: 1234 } with freshAgent (no bearer) and expects 200. Test debt to rewrite alongside the fix.
- **sev 4** · `kanban/kanban.html:30` — **The kanban version badge always shows 'v0.1.0' because /package.json is not served.**
  <br>Evidence: VERIFIED by reading: express.static mounts only public/ (index.js:425) and no other route serves package.json; fetch(...).json() on the 404 body rejects → catch sets 'v0.1.0' (:32-34). Cosmetic.
- **sev 4** · `tests/setup.js:25` — **Comment says ISP_DISABLE_TICKERS stops '8 setInterval ticker registrations'; there are 9.**
  <br>Evidence: VERIFIED: grep lists nine guarded registrations at index.js:460,484,497,569,604,666,715,768,797. All nine are guarded, so behaviour is correct; the comment is stale.
- **sev 4** · `tests/helpers/reset.js:8` — **resetMarketState is dead code.**
  <br>Evidence: VERIFIED: grep across tests/ finds only its definition; no test imports helpers/reset.js.
- **sev 4** · `README.md:114` — **README says Node.js 18+, but the installed test runner requires Node 20+ and package.json has no engines field.**
  <br>Evidence: VERIFIED: node_modules/vitest/package.json engines '^20.0.0 || ^22.0.0 || >=24.0.0'; `grep engines package.json` is empty; this machine runs v26.7.0.
- **sev 4** · `vercel.json:8` — **includeFiles omits kanban/**, so the /kanban route's sendFile cannot find kanban.html on Vercel.**
  <br>Evidence: VERIFIED includeFiles is ['public/**','data/**'] (:8-11) and index.js:429 sendFile's ../kanban/kanban.html via path, which @vercel/node's tracer will not pick up. INFERRED: the exact failure mode on Vercel was not executed. Moot if hosting moves to Azure.
- **sev 4** · `public/scripts/app.js:5922` — **Duplicate socket.on('finance:snapshot') handlers for an event the server never emits.**
  <br>Evidence: VERIFIED: identical handlers at app.js:5922-5929 and :5931-5938; grep of io.emit(...) in index.js lists finance:updated but no finance:snapshot.
- **sev 4** · `NEW_PLAYER_EXPERIENCE.md:13` — **Docs disagree with each other and with code on the office minimum: NPE, custom-instructions and DEVELOPMENT_PHASES say 30 days; Todos.md says 7; code is 7/14/21/28 with default 7.**
  <br>Evidence: VERIFIED: index.js:1094-1096 VALID_DURATIONS [7,14,21,28], default 7, cost = days × 1000; NEW_PLAYER_EXPERIENCE.md:13, .github/custom-instructions.md:33, DEVELOPMENT_PHASES.md:25,27 say 30-day; Todos.md:25 says 7-day/$7,000; DESIGN_DOCUMENT.md:143 matches code.
- **sev 4** · `LORE.md:101` — **LORE says Earth has 'No extraction rights' but the server sells Earth mining leases and the test fixtures depend on them.**
  <br>Evidence: VERIFIED: index.js:1256 LEASE_COSTS = { Earth: 20000, Mars: 25000, Luna: 30000 }; tests/unit/applyMiningOperations.test.js:48 and tests/unit/phase2Repositories.test.js:44-50 use body 'Earth' leases. Design decision needed before the v0.5 balance pass.
- **sev 4** · `.github/custom-instructions.md:1` — **The Copilot instruction file is probably never auto-loaded and its process rules conflict with hq CLAUDE.md.**
  <br>Evidence: INFERRED: GitHub Copilot reads .github/copilot-instructions.md, not custom-instructions.md (not verified against GitHub docs in this session). VERIFIED: :286-288 mandate Todos.md permission rules and 'DEVELOPMENT_PHASES.md should always be included', which the hq process (Board decisions in ADO, learnings/) supersedes; Todos.md:5 repeats the Copilot rule.

### Test coverage, and what it does not cover

Ran `npx vitest run` on this checkout: 12 files, 139 tests, 138 pass, 1 fail (tests/schema/data-files.test.js:224, data/state.json has no chatLog), ~4.6 s; git status stayed clean and no data/ file was touched by the run (every gameState.js disk write is behind IS_SERVERLESS; tests/setup.js:20 sets VERCEL=1). COVERED: tests/integration/auth.test.js — register (201, duplicate 400, missing fields, short password, bad email), login (200/401/401), refresh (rotate, reuse-after-rotate 401, missing 400, malformed 401), logout revokes, GET session (200/401/401), dummy-login and dummy-reset, requireAccountAccess 403/200 on GET /api/accounts/:id, GET /api/bootstrap|stations|buildings, POST /api/dev/set-credits (200/400/404, unauthenticated). tests/schema/data-files.test.js — shape/unique-id/prereq checks on the seven data/*.json catalogs. tests/unit/applyMiningOperations.test.js — inactive, throughput math, +10% and ×1.06 stacking, cost deduction, affordability scaling (deactivates), minedRemainder, downtime trigger, 15-min floor, recovery, industrial-safety threshold (Math.random pinned). tests/unit/applyRefineryOperations.test.js — 5 branch cases. tests/unit/finances.test.js — all exports of server/finances.js. tests/unit/catalogs.test.js — pinned constants (PROBE_BUILD_COST 8000, BASE_MAX_PROBES 2, etc.) and catalog shapes. tests/unit/createCombatReport.test.js, getEffectiveExchangeTaxRate.test.js (8→6→4→2, capped), mergeDummyAccount.test.js. tests/unit/phase1/2/3Repositories.test.js — pure account<->row mappers and round-trips; persist/hydrate only asserted as no-ops because USE_NORMALIZED_TABLES is blank, so no Supabase client code path is exercised. NOT COVERED (verified by reading every test file and grepping tests/): every /api/accounts/:id/gameplay/* route (hire, rent-office, renew-office, purchase-lease, transfer-resources, travel, build-extractor, start-mining, mine, build-refinery, start-refinery, build-assembly-facility, build-mining-probe, scout-belt, launch-expedition, accept/abandon/complete-mission, queue-rnd, complete-rnd, queue-ceo), notifications, messages, walkthrough-complete/reset; /api/market/orders, /api/market/orders/:id/buy, /api/market/npc-orders/:id/sell (the order-book truncation #425 and NaN quantity paths are untested); /api/forums/*; /api/investments; /api/combat/simulate; all nine tickers (exported at index.js:3437-3448, never imported by a test); socket handlers (chat:send, state:init); evaluateLevelProgress and any cross-catalog check that milestones.json requirement ids/stat keys exist (the #424 ladder break has no test); normalizeStateShape migrations; supabaseClient.js and every Supabase persistence path; walkthrough; rate limiting/input validation (none exists to test); the entire client (app.js 6,641 lines, charts.js, starmap.js, login/register pages) — zero client tests and no e2e/Playwright despite DEVELOPMENT_PHASES.md:56; kanban. Structural notes: helpers/reset.js is unused; auth.test.js:108 sleeps 1100 ms to get a distinct JWT iat; getApp caches the module per file and vitest's default per-file isolation is what keeps accountsStore from leaking across files; coverage config (vitest.config.js:9-14) includes server/**/*.js and excludes loadEnv.js and kanban.js, but no CI runs it.

### Before you touch this in v0.5

- DEVELOPMENT_PHASES.md:67-92, verbatim-ish: '## Version 0.5 — Beta MVP: Polish & Publish — The first publishable beta release. No new major systems — only the polish, persistence, and trust work needed to put the current game in front of real players. **QoL Fixes** [ ] Action current set of TODOs; [ ] Refactor gameState.js and app.js. Split various sections into their own file. Update design documentation to discourage amalgamating all code into a singular file. **Persistence & Reporting** [ ] Full balance sheet / P&L / cash flow statements stored server-side (currently only active-session data in browser); [ ] Market price history and trend display (per-item rolling chart on the Galactic Exchange). **Exchange & Logistics Polish** [ ] Filters and sorting on the Galactic Exchange; [ ] Resource Transportation polish pass — basic transfer endpoint already exists (POST /transfer-resources, flat $2/unit logistics fee, instant). Decide fee model (flat vs. distance-based across system hops), decide instant vs. timed transit, audit UX (bulk transfers, transfer history, error messaging), add tests. **Onboarding & Tutorial** [ ] Tutorial / NEW_PLAYER_EXPERIENCE polish pass against the live build; [ ] First-session UX audit (empty states, error copy, dead ends). **Release Engineering** [ ] Bug bash across all 0.1–0.4 systems; [ ] Balance pass on economy (mining yields, refinery cycles, payroll, office costs); [ ] Performance audit (tick cost at scale, Supabase persistence frequency, client render budget); [ ] Security hardening pass (auth, rate limiting, input validation, secrets handling); [ ] Public beta deployment configuration.'
- A live ISP server is running in this checkout on :3000 (PID 20868, established connections) and is rewriting data/accounts-snapshot.json every few minutes (observed 19:21 → 19:25 → 19:29, size drifting by a few bytes). The vitest suite and read-only imports with VERCEL=1 cannot write that file (gameState.js:1631/:1643 guards, verified). Do not read it (holds password hashes; hq AB#415); do not assume a stale mtime means nobody is using the checkout.
- The git checkout is shallow (`git rev-parse --is-shallow-repository` = true, one commit 4f92687 'Merged PR 41'). DEPTH.md:46 cites commit 00d5d29 and MONETIZATION.md:10 cites b5c060f; neither resolves here, and DEPTH's index.js:1710/1712 anchors have drifted (extractor op-cost is now index.js:1713 `Math.max(600, Math.round(throughputPerHour * 16))` — a 600/h floor DEPTH's linear formula omits). gameState.js:944 (8% tax), :1110 (250,000 credits), :1488 (Silicates 24 × 1,000,000/day) and index.js:1657 (1–72 h cycle, default 24) still match.
- Both critic reviews say 'vitest is not installed / suite did not run' (DEPTH.md:42-44, MONETIZATION.md:66-67). That is stale for this checkout: devDependencies are installed (vitest 4.1.5, @vitest/coverage-v8 4.1.5, supertest 7.2.2) and the suite runs. Installed runtime deps: express 4.22.1, socket.io 4.8.3, @supabase/supabase-js 2.103.3, bcryptjs 3.0.3, jsonwebtoken 9.0.3. Node on this machine: v26.7.0.
- Environment switches that v0.5 hosting work must respect: VERCEL (gameState.js:15 → IS_SERVERLESS; index.js:407 rehydrate/flush middleware; index.js:3422 skips server.listen) is the single 'serverless mode' switch and also the tests' 'no disk writes' switch (tests/setup.js:17-20). On Azure App Service leave it unset so tickers, socket.io and disk state work; if you rename it, update tests/setup.js and the three code sites together. NODE_ENV defaults to dev (index.js:52 IS_DEV), which makes the dummy token 7 days instead of 2 h (index.js:278) and collapses fabrication/expedition timers — set NODE_ENV=production in the Azure config. JWT_SECRET falls back to an in-repo literal (index.js:280, AB#423 family). loadEnv.js reads .env then .env.local and only fills undefined keys (:37); no .env.example exists although .gitignore:10 whitelists one.
- tests/setup.js must keep setting Supabase vars to "" rather than deleting them (setup.js:5-9 explains why: loadEnv.js:37 would repopulate a deleted key from .env and integration tests would hit the live database). Any new env var the server reads should be added there.
- Duplicate catalogs to collapse in the refactor item: RESEARCH_LIBRARY is hardcoded three times — server/index.js:55-175 (TODO :54), public/scripts/app.js:67 (TODO), and data/research.json — and is only loaded from JSON by the schema test; all three currently agree (13 nodes, 2–16 h, $2,000–$20,000; verified by diffing index.js against research.json). CEO insight likewise (app.js:190 TODO). Milestone data is duplicated at app.js:2840/3184/3190 per its TODOs.
- Kanban (kanban/, server/kanban.js): 38 cards, 30 To Do / 3 Doing / 5 QA / 0 Done; nothing else in the repo reads kanbanState.json. It lists 'R&D Tree', 'Resource Refinery', 'Testing Automation', 'Financial Core Realtime Data' as To Do and 'Create Vercel Project w/ Supabase Integration', 'CEO Insight Program', 'Logistics Mission Agent', 'Asteroid Mining', 'Off-world Mining' in QA — all marked done in DEVELOPMENT_PHASES v0.3/v0.4, and the Vercel card is now contrary to the Board's Azure direction. BRIEF.md:70-72 already says reconcile or retire; given the unauthenticated write + XSS (defects above) and that it is mounted in the game server, retiring it (delete kanban/, server/kanban.js, index.js:3 and :426-434, vitest.config.js:13 exclusion) is the smaller change.
- Todos.md is stale: of its six open items, five are already built — facility downtime (gameState.js applyMiningOperations, tested), level-up system (evaluateLevelProgress gameState.js:1020; 10 levels in milestones.json), local chat (client-side channel key 'local:<systemId>' at app.js:4732-4736; server stores whatever channel the client sends, index.js:3406), server-side R&D auto-completion (processRndCompletions index.js:715, ceo :768). The one genuinely open item is 'Market order matching engine' (Todos.md:40): no player buy orders or matching exist (grep buyOrder/matchOrder finds only npcBuyOrders), even though DEVELOPMENT_PHASES.md:30 marks it [x]. Todos.md:5 and custom-instructions.md:288 impose a 'Copilot must ask permission' rule that conflicts with hq CLAUDE.md; pick one source of truth and delete the other.
- Doc drift, README.md (verified anchors): :43 'level (1–40 cap)' vs 10 levels in milestones.json; :46 '16-building' vs 17 entries in buildings.json; :76 'story and bounty missions' vs all 10 templates type 'Logistics' (gameState.js:1182-1272); :78 four chat channels exist as tabs (index.html:719-722) but sending throws (defect above); :106 'Persistence: Local JSON files' contradicts :129 'all account data is persisted in Supabase' (code: Supabase when env set, else disk snapshot, gameState.js:19, :1904-1908); :114 Node 18+ vs vitest's Node 20+; :136-152 project structure omits server/finances.js, kanban.js, loadEnv.js, db/, tests/, migrations/, login/register pages. Accurate: :41-42 bcrypt + refresh rotation (index.js:276-294), :59 daily NPC reset in America/New_York (index.js:437-460), :92-93 version 0.4 (package.json:3), :127 port 3000 (index.js:3421).
- Doc drift, DESIGN_DOCUMENT.md (dated April 4, 2026 at :3): :74 dummy token '2 hours' is 7 days unless NODE_ENV=production (index.js:278); :95 'liabilities always 0 (not yet tracked)' vs computeLiveLiabilities (finances.js:57); :155-171 route table names /gameplay/sell, /buy-npc, /research which do not exist — actual routes are POST /api/market/orders (:3029), /api/market/orders/:orderId/buy (:3100), /api/market/npc-orders/:orderId/sell (:3221), /gameplay/queue-rnd (:2647); :177 'Single ~3,500-line' app.js is 6,641 lines; :198 lists 4 socket events, client handles 13 (app.js:5859-6005); :203-214 lists 10 tabs, index.html has 15 (adds assets, chat, forums, logistics, missions, refinery, travel); :266-271 '30-day' charts and field names (defect above); :296-303 research table (4 nodes, $18k–$54k) vs 13 nodes at $2k–$20k, and 'server-side auto-completion not yet implemented' vs index.js:715; :313 same; :314 'rentedUntil lapse not implemented' is partially wrong — start-mining checks an active office (index.js:1671) but hire (:1038-1062) never checks for an office and purchase-lease checks only offices.length (:1265), not expiry. Accurate: :66 sanitizeAccount shape (gameState.js:2049-2058), :73 7-day/30-day tokens (index.js:277,:279), :75 guard via app.use at index.js:958, :90 durations 7/14/21/28 (index.js:1094), :139-147 economy table (gameState.js:1110; index.js:1047, :1060, :1096, :1557, :1256 — table omits Earth lease 20,000), :232-240 CSS variables (styles.css:5-22).
- Doc drift, DEVELOPMENT_PHASES.md: v0.2 :25/:27 '30-day minimum' vs 7-day default; :30 order matching engine [x] but absent; :32 'NPC corporations populate the exchange with sell orders' [x] but the seed only creates npcBuyOrders (gameState.js:1487-1510) — no NPC sell orders found; :34 persistent chat history [x] but chat throws; v0.3 :50 'Remove the requirement for Accounts.json' [x] but the disk snapshot is still written in non-Supabase mode (gameState.js:1904-1908) with TODO :1615 to remove it; v0.4 :56-58 tests/CI claims (defect above); :60 local chat is client-side only; :61 forum posting exists (index.js:2896-3025) but categories are never seeded; :62-65 four charts are wired to finances.snapshots (30-minute window), not the named 30-day fields. Accurate: :36-37 downtime and R&D auto-completion, :42-49 R&D tree (13 nodes), CEO insight (12 programs), refinery chains (6), asteroid expeditions, Logistics agent Elara Voss (gameState.js:1182+), v0.5 :81 transfer-resources route exists at index.js:1342 (fee value not verified by me).
- Doc drift, NEW_PLAYER_EXPERIENCE.md: :13 30-day minimum (code 7); :19 '$50,000 + logistics fees' — flat 50,000 (index.js:1557), 47,000 with tt-supply-forecast (:1780), no logistics fee anywhere in index.js; :21 'Basic Extraction Analysis' is 'Basic Extraction Analytics' in code (index.js:57). Accurate: $250,000 / $2,000 hire / $150 per day (gameState.js:1110; index.js:1047, :1060), 2 slots per lease (index.js:1298), 5 employees per lease with (leases+1)×5 gate (index.js:1258, :1280). Walkthrough in code (app.js:207+) has 12 steps: inbox → starmap → station overview → rent office → hire (tab 'ceo', the known drift) → lease → extractor → mining cycle → research → market → missions ('Assignments Bureau') → 'You're Ready!'; NPE's 11-step order matches apart from the extra 'Station Overview' step and the missing 'UI orientation' step.
- Doc drift, LORE.md: :59 GEX standing orders 'currently Silicates' — six NPC buyers exist (Silicates 24, Helium-3 92, Nickel 18, Titanium 64, Carbon 12, Rare Earths 140; gameState.js:1487-1494); :101 Earth 'No extraction rights' vs Earth leases at 20,000 (index.js:1256); :114-118 resource tiers — Titanium, Rare Earths, Lithium, Cobalt, Thorium, Uranium and Exotic Matter are raw belt materials in BELT_COMPOSITIONS and Titanium/Rare Earths are refinery inputs (refinery-chains.json), whereas LORE calls them processed/exotic. Accurate: :97-108 Sol bodies all exist in systems.json (18 bodies, including Uranus, Neptune, Io, Europa, Ganymede, Callisto, Enceladus not in the table).
- Doc drift, BRIEF.md: :70 38 cards (verified 30/3/5/0) and :71 R&D/refinery outstanding on the kanban (verified); :73-79 accounts-snapshot untracked/gitignored/recreated (verified .gitignore:19-20, gameState.js:1617-1650, TODO :1615) — and still being written by the running server; :60 ISP-11 'clean environment comes up from the repo' is currently red because `npm test` fails on a fresh clone; :5 and :87 ADO ids (AB#388, AB#400–414, decision #353) are not verifiable from the repo; :80 'dormant since 2026-05-03' not verifiable from a shallow clone.
- Doc verification, DEPTH.md and MONETIZATION.md: every code anchor I checked is correct — DEPTH :48-60 (13 research nodes, 12 CEO programs, 6 chains, 10 levels, 8% tax, 250,000 credits, 24×1M bid), :67 only stat written is silicateSoldOnExchange (index.js:3271; level-6+ research ids absent from research.json; 'Ferric Mining Complex', 'Refinery Complex', 'Cryo-vapor Extractor Array' appear in no source or data file), :69 IS_DEV default, :85-87 ALLOW_DUMMY_AUTH/JWT fallback; MONETIZATION :77 tax reducible to 2% (ceo-insight.json: −2% per level, maxLevels 3; matches getEffectiveExchangeTaxRate.test.js), :157 sink cites index.js:1047/:1096/:1179/:1257/:1557/:1872 (60,000)/:2162 (75,000)/:1715 (35% startup), :181 orderBook.slice(0,200) at :3093, :96 app.js:537 currency USD, :103 index.html:625 and index.js:3239, :117-123 gameState.js:2146/:1079 and index.js:546. Only their 'vitest not installed' statements are stale.
- Doc drift, CONTRIBUTING.md and .github/custom-instructions.md: CONTRIBUTING :29 puts 'UI visual redesigns' out of scope and :17 says redesign is a v1.0 effort — both conflict with the Board's v0.5 graphics direction and should be rewritten alongside DEVELOPMENT_PHASES.md:167 (facelift listed under v1.0); :37 claims no frontend dependencies beyond Chart.js and Socket.io, but index.html:11 loads three Google Fonts families (Inter, Orbitron, Rajdhani) and :16 Chart.js 4.4.3 from jsDelivr; :77-88 GitHub Issues + feature/ branches vs hq's ADO + board/ fix/ process. custom-instructions :33 30-day office, :216-222 six forum categories that exist nowhere in code, :234 'Fonts: Inter or system UI' vs three families loaded, :65 and :101 'Level 40 / 5+ years' vs 10 defined and 5 reachable levels. DESIGN_DOCUMENT.md:24 says Orbitron + Inter (omits Rajdhani).
- Security-hardening item (ISP-10) inputs from this map: unauthenticated surfaces are /api/bootstrap, /api/stations, /api/buildings, all /api/auth/*, /api/dev/set-credits (known), /api/combat/simulate (new), the socket.io connection and chat:send (new), and POST /kanban/api (new). Everything under /api/accounts/:accountId is covered by app.use(requireAuth, requireAccountAccess) at index.js:958; /api/market/*, /api/forums/*, /api/investments carry requireAuth. There is no rate limiting or body-size limit anywhere (express.json() default at :398). The finance and mining tickers broadcast per-account data to all sockets (defects above); rooms keyed by accountId would fix both.
- Performance-audit item inputs: financialSnapshotTick mutates and persists every account every 30 s (index.js:776-797); miningTick every 5 s for every account (index.js:469-484); each mutateAccountState triggers an immediate Supabase persist (gameState.js:1912-1935). This is the 'Supabase persistence frequency' the v0.5 roadmap names.
- When #423 is fixed, rewrite tests/integration/auth.test.js:234-262 to expect 401/404 (or route absence in production) instead of 200; when chatLog is seeded, decide whether data-files.test.js should keep testing a runtime file at all (it should test the seed via getSeedState/normalizeStateShape, not disk).

---

## Totals

- Subsystems read: **10**
- TODOs found in code: **194**
- Suspected defects (candidates): **180**

Already-filed bugs were excluded from the readers' briefs, so the candidates above are additional to
#423, #424, #425, #433, #574–#578, #586, #588 and #589. None of them has been verified; filing any one
means opening the file, confirming the claim, and following `BUGS.md` (file with a proposed fix first).
