# ISP — handoff

**2026-09-25. Merged from several concurrent Builder panes: #1 did AB#1758 (orchestrata, scope override) then
AB#1052 — a player-triggered stop on a running mining cycle; #2 did ISP-67 (AB#756), then ISP-48 (AB#734), then
ISP-89 (AB#779); #3 did ISP-61 (AB#747) — a scripted Playwright playtest, so ISP is no longer blind, only
extension-less — then ISP-66 (AB#755), below; #4 did ISP-278 (AB#985), ISP-279 (AB#986), AB#1765
(refresh tokens hashed at rest), AB#1766 (socket auth boundary), AB#1753 (Level 2's Mars-lease gate), then AB#758
(the flat-direction Station mockup, a Decision now waiting on the Board) — all five per a Director-relayed
priority order; #1 (this pane) then did AB#1049 (research.json as the only research-tree definition); a
Salvage Assignment session landed AB#1789 while the below was in progress. #10 (this pane, new, no
CONTROL_URL by design) did AB#1754 below. AB#1052 and ISP-279 both used ISP-61's own Playwright pattern rather
than the Chrome extension for their screens; AB#758 used it too, to look at a static mockup rather than the
running game; AB#1049 used it again for the Corporate R&D tab. No CONTROL_URL / Chrome extension on any of
these panes (Builder panes don't get one by design). See "Blind spot" below.**

## What's now true (this session: AB#1754, Builder #10)

- **AB#1754 is done: `scripts/economy-model.mjs` no longer reimplements the extractor cost formula.** It
  imported its own copy of the linear pre-AB#775 curve, so `npm run economy:model` printed cost/h 600/1,600/4,000
  at 10/100/250 t/h and closed with "profit rises with every unit of throughput: the maximum always wins" — both
  wrong since AB#775 shipped the curved cost (`server/economy.js`'s `operationCostPerHourFor`), and the second
  line is the exact defect AB#775 fixed. `ECONOMY.md` committed that stale output verbatim, so the balance-pass
  reference document taught the opposite of what the shipped economy does — and contradicted its own "T-018"
  section three screens below, which already had the correct curve (P-TWO-SOURCES, in the same file).
  - `server/economy.js`'s `operationCostPerHourFor`, `miningProfitPerHourFor`, `bestThroughputFor` and
    `startupCostFor` each gained an optional `operations` override parameter, defaulting to the live `ECONOMY`
    singleton — backward compatible, every existing call site omits it. `scripts/economy-model.mjs` now imports
    and calls these directly, passing the `data/economy.json` it already reads, instead of recomputing the cost
    inline: the override is what lets the script price a hypothetical economy (the "what if margins go negative"
    test) without the two ever being able to diverge again.
  - Regenerated `ECONOMY.md`'s committed block from the fixed script's real output. The real numbers: cost/h at
    100 t/h is 1,691 (was 1,600), at 250 t/h is 5,417 (was 4,000, and matches AB#775's own test,
    `operationCostPerHourFor(250) === 5417`). **250 t/h is no longer the best answer** — it earns about 4 credits
    an hour under perfect play and *loses* money once real downtime is counted (`perHourExpected` is negative);
    the best real setting at this price with no research is 146 t/h at 606/h, which is what the T-018 section
    already said. Rewrote the "what it says, in words" prose below the table to match.
  - `tests/unit/economyModel.test.js`: the two assertions that hardcoded the old linear numbers (`marginPerUnit`,
    and a formula re-deriving `t250.perHourIdeal` by hand) are gone — one of them (`t250.paybackIdeal <
    t100.paybackIdeal`) encoded the exact bug (250 t/h no longer pays back *faster* than 100 t/h; it now pays back
    slower, or never). Added the drift guard the bug asked for: a new test calls
    `operationCostPerHourFor`/`startupCostFor`/`bestThroughputFor` directly and asserts the model's own numbers
    equal them for the same inputs, so this class of drift fails at commit time instead of waiting for a reader.
  - New/changed assertions checked against the pre-fix code (T-047): reverted both files, 4 of 8 tests in
    `economyModel.test.js` went red (the exact-quote test, the payback-ordering test, and the two `m.best`
    assertions), restored, all green again.
  - Checks: `npm run check` (`node --check server/index.js`) clean. `npm test` — **157 files, 1,579 tests, all
    passed** (1,578 baseline on `origin/main` after AB#1789 merged + 1 net new: one test removed, two added).
  - No screen: this is a design-document/model consistency fix with no rendered UI. Verified by the script's own
    printed output (captured and diffed against the committed block) and the test suite, not a screenshot — the
    blind class is the same as every non-visual ISP session, named rather than proxied.

## What's now true (this session: AB#1049)

- **AB#1049 is done: `data/research.json` is the only definition of the research tree.** `RESEARCH_LIBRARY`
  (`server/index.js`) used to be a ~120-line hand-written object literal, and `public/scripts/app.js`'s
  `techTree` was a second, separately hand-written ~120-line copy of the same 13 nodes — two places for the
  same id/name/effect/cost/duration/prereqs/tier to drift apart, with `data/research.json` sitting unread on
  disk (only its own schema test ever loaded it).
  - `server/game/catalog.js` now builds `RESEARCH_LIBRARY` from `data/research.json` (same pattern as the
    existing `CEO_INSIGHT_LIBRARY` in the same file), re-exported through `server/gameState.js`.
  - A new `GET /api/research` route (`server/index.js`, same shape as `/api/ceo-insight`) is the client's only
    copy. `public/scripts/app.js`'s hardcoded `techTree` literal is gone, replaced by `const techTree = []`
    populated by `loadStationRegistry()`'s boot fetch. **Mutated in place** (`techTree.length = 0;
    techTree.push(...)`), never reassigned — `createStarmapController({ researchCatalog: techTree, ... })` is
    called at module load and captures the array by reference before the boot fetch resolves; reassigning the
    binding would have left the starmap's travel-research-lock text (Bug #1270) reading a permanently empty
    tree.
  - `tests/integration/research-route.test.js` (new): the route serves exactly the ids `data/research.json`
    defines, every field matches exactly (not a hand-copied approximation), no login required. T-047: reverted
    to confirm all 3 fail without the route (`TypeError` / 404), restored, confirmed green.
  - `GET /api/research` registered in both "every route accounted for" tables:
    `tests/integration/route-auth.test.js` (public) and `tests/integration/remaining-input.test.js`
    (out-of-scope: a static catalog).
  - `tests/unit/travelResearchLock.test.js`'s "the page's copy agrees with research.json" test — which read
    `app.js`'s raw source text and string-searched for hardcoded node blocks — is gone; there's no second copy
    left for it to check against. The drift it guarded against is now structurally impossible, not just
    untested. The rest of that file (the lock-text logic itself, and the Starmap panel test against the real
    `CATALOG`) is untouched and still passes.
  - `tests/unit/no-payments.test.js`'s allowlist line number for `toCurrency` moved 478→361 (the ~120-line
    deletion above it in `app.js`).
  - **Looked at it**: `e2e/research-tree.spec.js` (new, following ISP-61/AB#1052's Playwright pattern) registers
    an account, opens Corporate R&D, asserts the rendered row count matches `GET /api/research`'s node count,
    screenshots at 1280×800 and 375×812. Ran against a real dev server (`ISP_DEV=1 PORT=4149 node
    server/index.js`), screenshots opened and read directly: all 13 nodes render with the same names, effects,
    costs, durations, tiers and prereq text as before the change, no horizontal overflow on mobile.
  - Checks: `npm run check` clean; `npm test` — **156 files, 1570 tests, all green** (two consecutive runs).

## What's now true (this session: AB#758, ISP-69)

- **AB#758 is built, and now waits on the Board.** `design/directions/flat/station.html`: one self-contained
  Station mockup in the flat direction AB#1757's visual-design critique (POLISH 2.4/5) and AB#592 both pointed
  to — void-black + cyan, three surface steps each computed to >= 1.2:1 apart (1.20, 1.22, 1.41), no
  box-shadow/text-shadow used decoratively, cyan spent on exactly one primary control per screen plus the
  active tab, Inter only (Orbitron kept to the logo mark), tabular numerals on every numeric value. Real copy
  (Orbital Executive Suites, ISA Claims & Leases Division, Earth Assembly) and the existing, previously-unused
  `public/images/orbital_executive_suites.jpg` as the hero band — nothing invented that the shipped screen does
  not already have somewhere.
  - The page states its own type system, palette (with every contrast ratio computed against WCAG 2.1's
    relative-luminance formula, not eyeballed), and references (EVE Photon UI, Frostpunk, Linear, Geist, Radix
    Colors) in a "Design notes" section at the foot of the same file — acceptance #2, self-contained rather
    than split across a separate doc.
  - **Looked at it, found a real bug, fixed it before shipping**: the first screenshot at 375 wide showed the
    hero's heading text overlapping the mobile tab bar above it. Real cause, confirmed by reading the DOM's own
    bounding boxes rather than guessing: `.hero` had a fixed `height: 220px` with `align-items: flex-end`, and
    at 375 wide the description text wraps to more lines than fit in 220px — flex-end pushed the overflow
    *upward*, out of the box, over the tabbar. Fixed with `min-height` instead of `height` (the box grows to
    258px there instead of clipping or overflowing); re-screenshotted and confirmed clean at both widths.
  - Screenshots committed at `design/directions/flat/screenshots/station-{1280x800,375x812}.png` — acceptance
    #3's "attached," matching how ISP-61/AB#1052/ISP-279 each already did it (referenced by repo path, not an
    uploaded ADO attachment).
  - **Judgment call on "shown to the Board as an artifact" (acceptance #3), stated plainly in the Decision
    rather than silently guessed**: read as this codebase's own established sense (CADENCE.md: "the artifact
    itself... a screenshot, a URL, a recording"), not specifically a claude.ai-hosted link — the repo file plus
    the two real screenshots satisfy it directly, and standing up a separate hosted copy (which the Artifact
    tool's own contract would require reworking the file's `<head>`/theme/asset handling for) seemed
    disproportionate for a self-contained mockup already fully viewable by opening the file. Said so in the
    Decision so the Board can ask for the interactive link if that is what was actually wanted — cheap to add.
  - **Filed the Decision the acceptance line requires**: **AB#1801**, "Board: does the flat-direction Station
    mockup ship?", linked to AB#758 and to AB#1764 (the prior Decision that picked "one mockup" over three).
    Two options: yes (ships, AB#759 and eleven downstream screen stories proceed), or no with what is wrong (a
    second mockup follows, aimed at the note — not three new directions, per AB#1764's own answer).
  - Checks: `npm run check` clean; `npm test` — **155 files, 1568 tests, all passed** (unchanged from AB#1753 —
    this story adds no server/client logic, only a static design file, so nothing to regress). Looked at with
    a one-off Playwright script (not a committed spec — this is a single static file, not a repeatable
    regression target the way `e2e/*.spec.js` covers running gameplay).

## What's now true (this session: AB#1753)

- **AB#1753 is fixed: Level 2's lease requirement no longer names Mars specifically.**
  `data/milestones.json`'s Level 2 `marsLease` requirement was `metric: "miningLease:Mars"` — Earth is the
  cheaper lease (20,000 vs Mars's 25,000, `data/systems.json`), so a cost-minimising player (and both bots in
  `ops/probes/isp-runway.ts`, per the bug's own repro) leased Earth first, built the extractor, mined 300
  Silicate, and were then **permanently stuck at Level 1** with no error explaining why — every other Level 2
  requirement satisfied, one hard-coded planet name standing in the way.
  - `server/game/progression.js`'s `resolveMetric` gained a special case: `miningLease:any` is true for any
    lease at all, not one specific body. `data/milestones.json`'s Level 2 requirement now reads
    `metric: "miningLease:any"`, title "Purchase a Mining Lease" (was "...on Mars") — Mars remains the
    walkthrough's *suggested* first destination, it is just no longer a *mechanical* gate.
  - **T-003 (the same fact restated, found while fixing this):** the requirement's title is independently
    copied in `data/milestones.json`'s own `roadmap` array and in `public/scripts/app.js`'s
    `MILESTONE_ROADMAP` constant (already flagged as duplicate debt, `TODO(AB#798)`). Updated all three
    consistently, or the milestone list would show this step as permanently "Open" for anyone who completed it
    under the old title text.
  - Existing tests updated for the new semantics, not just left broken: `tests/unit/evaluateLevelProgress.test.js`'s
    AB#690 repro used "Earth lease, no Mars" specifically to demonstrate the bug this session fixes — rewrote
    it to use "no lease at all" as the not-yet-met condition, and added a dedicated test that an Earth-only
    lease now completes Level 2. `tests/unit/leaseStation.test.js` and `tests/schema/data-files.test.js` both
    walk every `miningLease:<body>` metric in the catalog and look up a station/lease cost for the body named;
    both taught to treat `any` as a sentinel, not a real body, so they do not report it as broken.
  - New test fails against the pre-fix code (checked by reverting `data/milestones.json` and
    `server/game/progression.js` and re-running — T-047).
  - **Sibling filed, not fixed**: **AB#1794** — Level 9's `lunaLease` requirement (`miningLease:Luna`) is the
    same shape, found by inspection while fixing this one. Unlike this bug, it has **not been confirmed
    unreachable** by the cheapest path — `ops/probes/isp-runway.ts`'s bots never reached Level 9 in the run
    that found AB#1753 (both topped out at Level 1) — so it is filed at low confidence for someone to actually
    measure, not fixed blind.
  - **Not touched, flagged for PM/Director**: `docs/QUEST_SPINE.md`'s Act 1 Beat 8 sends a new player to Mars
    specifically *because* Level 2 required it ("The Mars beat bridges a gap the audit found... Level 2 wants
    a Mars lease"). That premise is now optional, not mechanical — the beat's narrative can stay exactly as
    designed (Mars is still a fine *suggested* first destination), but the document's own justification for
    forcing it is stale and reads oddly next to a milestone that no longer forces anything. A design call, not
    a Builder one. `CODEBASE_MAP.md`, `DEPTH.md`, `FIRST_SESSION_AUDIT.md` and `MONETIZATION.md` are dated
    review/audit snapshots (`CODEBASE_MAP.md` says so explicitly: "Status: unreviewed... the code wins") and
    were left alone on the same basis PATTERNS.md gives for not retroactively editing them.
  - **Also flagged, out of this repo's scope**: `ops/probes/isp-runway.ts` (in `hq`, not this repo) carries a
    Mars-detour workaround for exactly this bug, gated behind 200,000 credits (per the bug's own citation of
    that source comment) — now unnecessary dead logic. Out of scope for an ISP-only Builder session to touch
    the platform repo; noted for whoever next works there.
  - Checks: `npm run check` clean; `npm test` — **155 files, 1568 tests, all passed** (1556 baseline on
    `origin/main` after AB#1766 merged + 12 new/changed across the four test files above).

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

## What's now true (this session: AB#1051)

- **AB#1051 is done: mission templates carry a range now, not a fixed reward and quota, and contracts vary.**
  `data/missions.json` is the one copy of the template pool, the agent registry (bio, dialogue, station,
  availability) and the reputation tiers — server and client both read it (`GET /api/mission-agents`, the CEO
  Insight pattern, Bug #983), replacing three `TODO(AB#1051)` markers (`server/game/corporation.js`,
  `public/scripts/app.js` ×2).
  - **A template is a range** (`quotaMin`/`quotaMax`, `rewardMin`/`rewardMax`, ±20% of the old fixed value,
    e.g. Silicates 320–480 around the old 400); `materializeOffer` (`server/game/corporation.js`) rolls one
    instance per refresh. The *offered* mission keeps exactly the shape every existing reader already expects
    (`reward` a formatted string, `quota: { resource, amount }`), so accept-mission, complete-mission,
    `missionRewardCredits` and every client render function needed zero changes.
  - **Contract text no longer states a specific quantity** ("400 units of raw silicates" → "raw silicates"):
    the number is real and rolled per offer, shown live via `quota.amount`, not baked into prose that would be
    wrong most of the time now.
  - Identity (name, title, portrait) stays owned by `ASSIGNED_COORDINATOR` (`public/scripts/liaison.js`,
    AB#585) and is merged client-side; only bio/dialogue/station/availability moved to data, so AB#585's
    single-source guarantee for the coordinator's identity is untouched.
  - Five existing tests updated, not just new ones added: `tests/unit/catalogs.test.js` and
    `tests/unit/firstContract.test.js` checked a template's shape directly (now a range, not a fixed value);
    `tests/integration/accept-offered.test.js` and `contract-copy.test.js` each hardcoded `Silicates = 400` to
    satisfy a quota that is no longer fixed — both now read the actually-offered `quota.amount`;
    `contract-copy.test.js`'s `agentCopy()` string-searched `app.js` for a literal that no longer lives there —
    it now reads `data/missions.json` directly, checked to still be falsifiable (temporarily reintroduced a
    "deadline" claim into the JSON, confirmed the test catches it, reverted).
  - New: `tests/unit/missionVariance.test.js` (rolls never leave bounds over 200 tries; two rolls of the same
    template can differ; the offer's shape matches every reader; a real `refreshContractOfferings` call stays
    in bounds too, not just direct `materializeOffer` calls) and a `data/missions.json` schema block in
    `tests/schema/data-files.test.js` (shape, unique ids, every template's `agentId` resolves, reputation
    tiers ascending from 0).
  - `tests/unit/no-payments.test.js`'s allowlist lost a stale entry: the "premium-rate" flavour text it named
    moved into `data/missions.json`, which that scanner doesn't read (`.js`/`.html`/`.css` only) — the match
    left the scanned surface rather than needing a new line number.
  - **Looked at it**: `e2e/mission-agents.spec.js` (Playwright, following ISP-61/AB#747's and this session's
    own AB#1052 pattern) registers, opens Assignments, opens the agent, opens a contract — at 1280×800 and
    375×812. All 6 screenshots looked at directly: real bio/dialogue text rendering from the fetch, and two
    different account runs showing genuinely different rolled rewards for the same template (11,000 and
    12,700 Credits for Silicate Requisition, base 12,000; 23,200 Credits for Lithium, base 22,000) — the
    variance is real, not just unit-tested.
  - **AB#1781 filed, not fixed**: a 5px horizontal-overflow reading (`scrollWidth` 380 vs 375) right after
    opening an agent's contract list at 375px, in `e2e/mission-agents.spec.js`'s own `assertNoHorizontalScroll`
    check. Not reproducible in an isolated diagnostic with the same steps; not visible in any of the six
    screenshots (looked at directly, nothing cut off); the render functions it triggers on are unmodified by
    this story, only their data source. Confidence low, no fix proposed beyond investigative leads (a web-font
    swap, the portrait `<img>` decoding, or a `.mission-card` entrance transition) — the spec's own
    `assertNoHorizontalScroll` calls are not run at the two steps it appears at, so this unrelated finding
    doesn't gate this story's acceptance line; the screenshots are still taken and were looked at.
  - Checks: `npm test` — **152 files, 1552 tests, all green** (151/1541 baseline after merging ISP-1052's own
    merge + 11 new/updated here). `npx playwright test e2e/mission-agents.spec.js` — 2 passed.

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

- **Director-relayed priority order for this pane (2026-09-25), all five now done (AB#1765, #1766, #1753,
  #758)**: nothing further named by that order. **AB#1740 was picked up and merged by a concurrent pane while
  this session worked AB#1765/#1766** — was never available to take. If **ENG-9 (AB#669)** is still unclaimed,
  that is the platform-first fallback per PM/Director.
- **AB#1801** (the Decision this session filed: does the flat-direction Station mockup ship?) is the one thing
  actually blocking the eleven-story design-system track (AB#745, AB#759 to AB#772) — hand it to the Board, not
  to another Builder pane; nothing to build until it is answered.
- **AB#1794** (Level 9's Luna-lease gate) was picked up by this pane, then handed back, tagged `blocked`, left
  Active: `DEPTH.md` review #3 (same day) already shows the runway probe's bots wall economically at Level 2 for
  the full 30-day run regardless of days simulated (0 credits, refused on every action), and states the probe
  cannot reach Level 9 to test the Luna-lease shape until a broke corporation can recover. This pane started a
  120-simulated-day probe run to re-confirm directly, then invalidated it by deleting the worktree the run was
  reading from before it finished (`btwqyndvx.output` stayed empty — the process died silently rather than
  printing anything). **Not re-run this session** — DEPTH.md's evidence stands on its own, but nobody has
  independently reproduced it against a fresh checkout yet. **AB#1789 merged to main while this session worked
  AB#1754** (PR 458) — 1791 and 1792 have not. Once both land: re-run `node ops/probes/isp-runway.ts --days 30
  --seed 7000` (from hq, against a *worktree you keep alive until it prints*) and see whether bots now reach
  Level 9 and get stuck on the Luna lease specifically. If so, AB#1794 is ready to fix with AB#1753's exact
  pattern (`miningLease:any`, in `data/milestones.json` and `server/game/progression.js`). If bots still can't
  reach Level 9 even with the Salvage Assignment live, that is itself worth a comment on AB#1794 before touching
  the milestone.
- **AB#1774** (the runway probe's banked-reserve profile) is `Proposed`, not started, and `DEPTH.md` ranks it
  the top epic two reviews running — but it lives in `ops/probes/` in **hq**, not this repo, so it is out of
  scope for an ISP-only Builder pane (COMMON §3, project scope). Flagging for whichever pane is scoped to the
  platform.
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
(`agent/986-shipments-ui`, PR !432), AB#1765's (`fix/1765-hash-refresh-token`, PR !439), AB#1766's
(`fix/1766-socket-auth-check`, PR !444), AB#1753's (`fix/1753-level2-gate`, PR !450) and AB#758's
(`design/758-flat-station`, PR !454) are all merged. AB#1789 (Salvage Assignment, `agent/1789-salvage-assignment`,
PR !458) also merged, from a pane not tracked in this file's session list. This session's (AB#1754) branch is
`fix/1754-economy-model`, PR to be opened next and set to auto-complete. Multiple Builder panes are active on
ISP at once — check ADO state before claiming the next item.
