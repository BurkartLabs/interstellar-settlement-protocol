# ISP v1.0 — Facelift, stable release, published

Feature AB#398 (Proposed) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits: v1.0 on the ISP roadmap (DEVELOPMENT_PHASES.md in the product repo), under the product epic.
What it is for: The version that goes public. Mostly presentation and hardening, plus the bureaucratic UI pass that makes the tone land.
What it contains:
- Full visual redesign and UI facelift
- Bureaucratic UI pass: section headers as document codes ("CORP-OPS-7 // Mining Operations"), dry protocol status text, UTC timestamps with reference numbers
- Landing page facelift
- Final performance audit
- Final security hardening and public deployment config
- Final balance pass across economy, combat and progression
- Public 1.0 release
Each line becomes a story when this version is next. They are listed here rather than filed as work items so the backlog shows what is ready to be worked, not everything that has ever been planned (TRACKING.md).

## Acceptance

_To be written: the Feature had no acceptance criteria in Azure DevOps._

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 17 open, 27 resolved.

### ISP-272 Apply the balance changes with before-and-after numbers and player-facing patch notes (Requirement AB#968, Proposed) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final balance pass across economy, combat, and progression". What it is. Applies the data-file changes proposed by the balance bugs from v1.0-25 to 27 (catalog values only; rule changes are separate stories). Re-runs the probes, and writes docs/PATCH_NOTES_1.0.md in the ISA voice, listing every changed number. Why it matters. Balance changes in a player economy must be announced. Players who planned around a… (the rest: AB#968)

- [ ] Each change cites the bug that proposed it, and the probe's before and after output is attached.
- [ ] Every target from v1.0-25 to 27 is met, or the remaining gap is stated and accepted in writing by the Board on this item.
- [ ] The patch notes list every changed value (old and new), and a test asserts the notes and the data files agree.

### Stand up a minimal production environment for launch (Requirement AB#969, Proposed) (lane: interstellar-settlement-protocol/accounts)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final security hardening and public deployment configuration". What it is. The Board answered D-1.0-1 (AB#708): "Registration, minimal, whatever, none", read in the order asked: registration open; hosting spend minimal; domain whatever (no preference, so none is bought: the conservative reading on spend); legal pages and age policy none. A production container app separate from the beta in the existing… (the rest: AB#969)

- [ ] Production is reachable over HTTPS at its default Container Apps hostname, with its own data store and secrets; a test request shows beta and production return different build ids.
- [ ] Replica count is exactly one; the PR states the monthly cost estimate and compares it with the beta's (the Board asked for minimal; anything above the beta's cost is explained).
- [ ] Health probes and at least two alerts (error rate, restart loop) are configured, and a triggered test alert reached the Board (screenshot attached).
- [ ] Security. Secrets are Key Vault references only, set by commands the PR prints for the Board to run (no secret is handled by the agent). NODE_ENV=production. Dummy and dev routes are absent (v1.0-16's test runs against production config). Fails closed: the app refuses to boot without its production secrets, and registration returns 503 if the email sender is not configured.

### Start everyone fresh at 1.0: archive the beta and open production empty (Requirement AB#970, Proposed) (lane: interstellar-settlement-protocol/accounts)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Public 1.0 release". What it is. The Board answered D-1.0-2 (AB#709): "Everyone starts fresh." Read literally and as the reading that moves the least personal data: nothing carries into production, not progress, not corporation names, not accounts; no beta-tester title (option B's recognition was not chosen). Beta players register again on 1.0. A script archives the beta data with restricted access and a stated… (the rest: AB#970)

- [ ] Production opens with zero beta accounts, corporations or progress (a count query in the PR shows 0).
- [ ] The beta archive exists, is readable once in a restore test, lists who can access it (the Board only), and has a deletion date stated in RUNBOOK.md.
- [ ] Beta players receive an in-game notice at least 7 days before the change, with the date in UTC and a line saying they will need to register again.
- [ ] Security. No beta personal data (emails, password hashes, tokens) is copied into production (verified by query); the archive is not reachable from either app's runtime identity.

### ISP-275 Run the 1.0 release-candidate gate on the production-like build (Requirement AB#971, Proposed) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Public 1.0 release". The ISP-23 gate again, at 1.0 scope. It is the evidence the Board decides D-1.0-1 on, so it is not blocked by it. What it is. A start-to-finish run of the release candidate: a fresh account through the first hour, then every navigation group; a second account trading and fighting with the first; a phone at 375px; and a return visit. Screenshots of every screen from v1.0-01's script. It also… (the rest: AB#971)

- [ ] The run is on a production-like deployment, with screenshots of every step and every screen attached here, and a human has looked at them.
- [ ] The v1.0-02 allowlist is empty, and no placeholder is visible (RUBRIC).
- [ ] The telemetry events from v1.0-12 are seen in the store for the run.
- [ ] The full test suite and Playwright smoke are green on a fresh clone, with counts stated (T-008).
- [ ] A Critic review of the build returns SHIP, linked here. Every finding of the run is filed and fixed, or explicitly deferred by the Board.
- [ ] The Board has played it and says so on this item.

### ISP-276 Open ISP to the public (Requirement AB#972, Proposed) (lane: interstellar-settlement-protocol/accounts)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Public 1.0 release". What it is. The Board answered D-1.0-1 (AB#708): "Registration, minimal, whatever, none", read in the order asked: registration open; hosting spend minimal; domain whatever (no preference, so none is bought: the conservative reading on spend); legal pages and age policy none. The cutover: production opens registration to anyone (with the email verification the Board chose on D-0.5-2), with… (the rest: AB#972)

- [ ] Registration on the production URL works for a new external account, including the verification email, shown with screenshots of the register page and the verified landing at 375x812 and 1280x800.
- [ ] No announcement is posted by the agent; the PR tells the Board the URL is ready to announce.
- [ ] A 48-hour summary is posted on this item with sign-ups, D1 where available, error rate and incidents, each labelled with what it measures (P-PROXY).
- [ ] Rollback to closed registration is the REGISTRATION_OPEN switch from ISP-91 (AB#781), documented, and was tested on production before cutover.

### ISP-277 Write the 1.0 LEARNING.md and record the video overview (Requirement AB#973, Proposed) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Public 1.0 release". The Charter's ship artifacts. What it is. projects/interstellar-settlement-protocol/LEARNING.md covers: what 1.0 taught, the numbers that mattered, what the probes said against what players did, and a Doctrine patch proposal ("merge, rewrite or no change"). Also a short video overview from the live build. Why it matters. CHARTER: shipping without a LEARNING writeup, a video and a Doctrine… (the rest: AB#973)

- [ ] LEARNING.md exists with the sections above and at least three learnings, each tied to evidence (an item id, a metric or a probe output).
- [ ] A Doctrine patch proposal is filed in DOCTRINE's patch-log format, even if "no change".
- [ ] The video exists, is linked here, and was watched by the Board.

### register-rate-limit.spec's 1280x800 case fails under the full Playwright run: page.goto register.html is net::ERR_ABORTED (Bug AB#2363, Active) (lane: interstellar-settlement-protocol/platform)

What: Symptom. In a full `npx playwright test` run, 'a refused registration says to wait an hour at 1280x800' fails at its first line, page.goto(`${url}/register.html`) -> net::ERR_ABORTED. Run alone, repeated three times, it passes every time. / Repro. On agent/834-cross-track (8da56159, main 8c40b137 plus AB#834), start a scratch server and run BASE_URL=... npx playwright test --reporter=line: 218 passed, 4 failed, this one among them. npx playwright test e2e/register-rate-limit.spec.js --repeat-each… (the rest: AB#2363)
Symptom: In a full `npx playwright test` run, 'a refused registration says to wait an hour at 1280x800' fails at its first line, page.goto(`${url}/register.html`) -> net::ERR_ABORTED. Run alone, repeated three times, it passes every time.
Repro: On agent/834-cross-track (8da56159, main 8c40b137 plus AB#834), start a scratch server and run BASE_URL=... npx playwright test --reporter=line: 218 passed, 4 failed, this one among them. npx playwright test e2e/register-rate-limit.spec.js --repeat-each 3: all pass.
Proposed fix: Confidence: low. Before the first goto, wait for the spec's server to answer (poll GET /register.html with the request fixture until 200), and retry the goto once on ERR_ABORTED. Confidence low: the cause is a guess until the error-context of a failing run is read.

- [ ] Fixed: register-rate-limit.spec's 1280x800 case fails under the full Playwright run: page.goto register.html is net::ERR_ABORTED

### ISP: a flood priced just above the ITC line (85-95% of normal value) that takes a full day of demand beats the standing bid: 4 of 28 damaging bot floods profit (Bug AB#4672, Proposed) (lane: interstellar-settlement-protocol/finance-politics)

What: Symptom. The AB#929 tariff and dumping probe (npm run probe:tariffs) misses its target: a flood that damages a rival by 20%+ of its daily revenue should be net-negative for the flooder after duty. 4 of 28 damaging floods profit against the flooder selling the same units to the standing bid; none of the 4 is found by the watch (all priced at 85%, 90% or 95% of normal value, at or above the 85% line). Every flood the watch finds is net-negative. BOT NUMBERS (P-PROXY): bots in an assumed market,… (the rest: AB#4672)
Symptom: The AB#929 tariff and dumping probe (npm run probe:tariffs) misses its target: a flood that damages a rival by 20%+ of its daily revenue should be net-negative for the flooder after duty. 4 of 28 damaging floods profit against the flooder selling the same units to the standing bid; none of the 4 is found by the watch (all priced at 85%, 90% or 95% of normal value, at or above the 85% line). Every flood the watch finds is net-negative. BOT NUMBERS (P-PROXY): bots in an assumed market, not… (the rest: AB#4672)
Repro: In projects/interstellar-settlement-protocol on the AB#929 branch: npm run probe:tariffs. Part B: Platinum-Group Metals, normal value 400, book demand 2,000/day filled by an incumbent rival at 400; the flooder lists 2,000 or 4,000 units/day at 95/90/85% for the 3-day window; its twin week sends the same units to the NPC standing bid in lots of 100.
Proposed fix: Confidence: medium. A Board/Director call. Recommended: amend the AB#929 target to read 'a flood the watch finds' (P_d below 85% of N), which passes: every found flood loses between 72,900 and 2,154,132 against its twin. Undercutting above the line is price competition that the design bounds at 15% on purpose, and a rival can answer it. The alternative, if legal undercutting should also cost the flooder: raise priceThresholdPct to 95 (a 5% band). By the grid that catches the 90% and 85% rows at… (the rest: AB#4672)

- [ ] Fixed: ISP: a flood priced just above the ITC line (85-95% of normal value) that takes a full day of demand beats the standing bid: 4 of 28 damaging bot floods profit

### Release gate: the AB#415 accounts snapshot (password hashes, 142 refresh-token JWTs) is still in ISP's git history on origin/main (Bug AB#4805, Proposed) (lane: interstellar-settlement-protocol/platform)

What: Symptom. AB#959 (ISP-263) requires the AB#415 accounts snapshot to be gone from git history before the public release. It is not. `git log --remotes=origin -- data/accounts-snapshot.json` returns 4 commits (bee26cd6, 30581db2, 2e80d03d, 00d5d29e), all ancestors of origin/main and contained in 178 remote branches; each still holds the 6.6 MB file. gitleaks 8 over all refs (842 non-merge commits scanned, secrets redacted) reports 226 findings: 142 `jwt` in data/accounts-snapshot.json and 60 `jwt`… (the rest: AB#4805)
Symptom: AB#959 (ISP-263) requires the AB#415 accounts snapshot to be gone from git history before the public release. It is not. `git log --remotes=origin -- data/accounts-snapshot.json` returns 4 commits (bee26cd6, 30581db2, 2e80d03d, 00d5d29e), all ancestors of origin/main and contained in 178 remote branches; each still holds the 6.6 MB file. gitleaks 8 over all refs (842 non-merge commits scanned, secrets redacted) reports 226 findings: 142 `jwt` in data/accounts-snapshot.json and 60 `jwt` in… (the rest: AB#4805)
Repro: In any clone with origin fetched: `git log --remotes=origin --oneline -- data/accounts-snapshot.json data/accounts.json` (non-empty = fails). Full scan, values redacted: `docker run --rm -v <clone>:/repo:ro zricethezav/gitleaks:latest git /repo --log-opts="--all" --redact --no-banner` (in Git Bash prefix MSYS_NO_PATHCONV=1).
Proposed fix: Confidence: high. A Board call, one of two. (A) Purge: on a fresh mirror clone, `git filter-repo --invert-paths --path data/accounts-snapshot.json --path data/accounts.json`, force-push every ref to Azure DevOps and the public GitHub copy, have every checkout (Board's tree, agent worktrees) re-clone, and treat the old shas as public forever (GitHub caches, forks). Then rotate JWT_SECRET in Key Vault so no refresh token from the file can be honoured, and change the passwords behind the two real… (the rest: AB#4805)

- [ ] Fixed: Release gate: the AB#415 accounts snapshot (password hashes, 142 refresh-token JWTs) is still in ISP's git history on origin/main

### ISP-255c Rewrite status and notification copy in protocol language: Comms and Map (chat, conversations, inbox memoranda, Forums, Starmap, travel, concessions) (Requirement AB#4825, Active) (lane: interstellar-settlement-protocol/social)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Bureaucratic UI pass - reinforce the cold corporate sci-fi tone." Slice 951c of the original AB#951 scope, split out for the same reason as 951a. / What it is. Every status label, notification, inbox system message and error in Chat, conversations, the inbox's memoranda, Forums, Starmap and travel, concessions and the map overlays is rewritten against the v1.0-03 bureaucratic-voice guide, with the plain meaning… (the rest: AB#4825)

- [ ] A list of every changed string (old, new, file) is attached to the PR.
- [ ] Every error still says what the player should do next (ISP-6's rule), checked by reading each changed error.
- [ ] No string names Aria Voss.
- [ ] Screenshots of five representative notifications and statuses at 1280px are attached to the PR and looked at by a human.

### The client ships 180 unbundled, unminified modules: no build step (Bug AB#4837, Proposed) (lane: interstellar-settlement-protocol/platform)

What: ISP, the client's first load. Found measuring AB#964 (ISP-268): Lighthouse mobile profile, three runs a page, scratch server, Chromium. After AB#964's fixes (compression, images, self-hosted fonts and Chart.js, cache headers) the landing page scores 66 and the main app view 61, against the 85 AB#964 asks. Every page loads each ES module as its own request, unminified (Lighthouse: ~55 KB of minification and ~89 KB of unused script left after gzip). Its import depth makes a waterfall of round… (the rest: AB#4837)
Symptom: Main app view Lighthouse mobile performance 61; 179 requests on a first load.
Repro: - Sign in, open the app with the cache empty. / - Count the /scripts/ requests.
Proposed fix: An esbuild step (npm run build) that bundles scripts/app.js with code splitting per view and minifies, writing public/dist/ with hashed names; index.html loads the bundle; the static cache keeps hashed files a year (server/staticCache.js already has the immutable rule for versioned paths). Keep the unbundled modules for tests. Confidence medium: a build step changes the Dockerfile and the dev loop; a Board call on the tooling.

- [ ] Fixed: The client ships 180 unbundled, unminified modules: no build step

### The research and CEO prerequisite trees, and the sidebar's toggles, are buttons outside the design system's components (Bug AB#4845, Proposed) (lane: interstellar-settlement-protocol/client-shell)

What: ISP, Corporate R&D and CEO Insight (the prerequisite tree, AB#2473/AB#2474: button.prereq-node) and the shell's sidebar (button.side-panel__toggle). They are <button>s with bespoke classes and no .ui-* component class. Their CSS uses tokens only, so this is a components question, not a colour one: the design system has no tree-node or disclosure component. Found by the facelift inventory's component check.
Repro: Repro: npm run look:facelift; FACELIFT_INVENTORY.md lists them under Components for rnd, ceo and shell.
Proposed fix: Either add the two to the design system (a .ui-tree-node and a .ui-disclosure in /styleguide, with focus and target sizes) and move these onto them, or record them in the styleguide as sanctioned screen-specific controls. Confidence: medium; a design decision for the PM or Director.

- [ ] Fixed: The research and CEO prerequisite trees, and the sidebar's toggles, are buttons outside the design system's components

### HTTP p95 is over its 500 ms budget because tickers hold the event loop for a whole pass over every account: financialSnapshotTick up to ~700 ms, miningTick ~420 ms (Bug AB#4859, Active) (lane: interstellar-settlement-protocol/platform)

What: Symptom. At 200 corporations (unprofiled, tmpfs), GET /api/accounts/:id p95 is 591 ms against a 500 ms budget. It was 596 ms before Bug #4849's fix, which halved p50 (123 -> 63 ms), so the handler is not what sets p95. What a request waits on is a synchronous ticker run already holding the event loop: financialSnapshotTick p95 663 ms per run, miningTick 488 ms, a snapshot write 239 ms. A request that arrives during one waits for the whole of it. Event-loop worst p99 286 ms. / Repro. npm run… (the rest: AB#4859)
Symptom: At 200 corporations (unprofiled, tmpfs), GET /api/accounts/:id p95 is 591 ms against a 500 ms budget. It was 596 ms before Bug #4849's fix, which halved p50 (123 -> 63 ms), so the handler is not what sets p95. What a request waits on is a synchronous ticker run already holding the event loop: financialSnapshotTick p95 663 ms per run, miningTick 488 ms, a snapshot write 239 ms. A request that arrives during one waits for the whole of it. Event-loop worst p99 286 ms.
Repro: npm run load:test -- --corps 200 --minutes 5 --data tmpfs (and --profile for the store-query table). Compare the HTTP p95 with the p95 per run of financialSnapshotTick and miningTick.
Proposed fix: Confidence: medium. Walk the accounts in slices, yielding to the event loop between them (await a setImmediate after every ~20 accounts, or a time budget of ~10 ms). Keep the run's single now so every account is settled at the same instant, as today, and never start a run while the last is still walking. Do this for financialSnapshotTick and miningTick first. The results per account are unchanged; only the interleaving with requests is. Measure the HTTP p95 and the event-loop p99 with… (the rest: AB#4859)

- [ ] Fixed: HTTP p95 is over its 500 ms budget because tickers hold the event loop for a whole pass over every account: financialSnapshotTick up to ~700 ms, miningTick ~420 ms

### After verifying their email, a new player types their email and password again to log in (Bug AB#4863, Proposed) (lane: interstellar-settlement-protocol/accounts)

What: ISP, a stranger's path from the landing to the first extractor. AB#955's scripts/first-verb-path.mjs walks it in a real browser and counts it: 23 clicks and 7 fields at 375 and at 1280 (every step, with screenshots, in docs/ab-955). Registering gives no session (AB#2288), so after Verify My Email the player presses Log In and re-enters both fields: 1 click and 2 fields of the 23 and 7, the last ones before the game.
Symptom: Clicks or fields on the way to the first extractor that do not decide anything.
Repro: - node scripts/first-verb-path.mjs 375 812 / - Read the actions list.
Proposed fix: A Board call, because it touches the session rule: either the verify step (a POST with the one-time token, from the address's own inbox) issues the session itself, as a password reset's confirmation could; or the login page is opened with the verified address filled in (the player's own, from the token's account, not a stored default), saving one field. Confidence medium; the first needs a security review.

- [ ] Fixed: After verifying their email, a new player types their email and password again to log in

### Four receipts to acknowledge on the way to the first extractor (Bug AB#4864, Proposed) (lane: interstellar-settlement-protocol/client-shell)

What: ISP, a stranger's path from the landing to the first extractor. AB#955's scripts/first-verb-path.mjs walks it in a real browser and counts it: 23 clicks and 7 fields at 375 and at 1280 (every step, with screenshots, in docs/ab-955). Renting the office, hiring, filing the lease and commissioning the yard each open a receipt modal the player must press Acknowledge on (AB#744): 4 of the 23 clicks, each after the action has already succeeded.
Symptom: Clicks or fields on the way to the first extractor that do not decide anything.
Repro: - node scripts/first-verb-path.mjs 375 812 / - Read the actions list.
Proposed fix: A Board call on AB#744's receipts: during the walkthrough, show the receipt as a card the next step replaces (no press needed), or let the next committing action close it. The server's receipt is unchanged; only the extra press goes. Confidence medium.

- [ ] Fixed: Four receipts to acknowledge on the way to the first extractor

### The walkthrough sends a new player to controls one level down: the Station group and the Offices subpage (Bug AB#4865, Proposed) (lane: interstellar-settlement-protocol/client-shell)

What: ISP, a stranger's path from the landing to the first extractor. AB#955's scripts/first-verb-path.mjs walks it in a real browser and counts it: 23 clicks and 7 fields at 375 and at 1280 (every step, with screenshots, in docs/ab-955). Opening the Station group (the nav's group button) and then the Offices subpage are 2 of the 23 clicks; the walkthrough highlights each in turn but the player does the navigating. At 375 the Offices tab was also left under the card (Bug #4858, fixed in AB#955).
Symptom: Clicks or fields on the way to the first extractor that do not decide anything.
Repro: - node scripts/first-verb-path.mjs 375 812 / - Read the actions list.
Proposed fix: When a step's target is on a subpage or in a closed group, the walkthrough's highlight names the whole route ('Station, then Offices') and the Station tab opens on Offices for a corporation with no office yet. Confidence medium.

- [ ] Fixed: The walkthrough sends a new player to controls one level down: the Station group and the Offices subpage

### Selectable display styles: the sixteen redesign directions on the live game (Requirement AB#4880, Proposed) (lane: interstellar-settlement-protocol/client-shell)

What: Where: the game's client (public/). What: a display-style picker in the app header that switches the whole UI between the current look (the default) and sixteen styles from the Board's 2026-09-27 redesign round (design/mockups: Round 1 v2 — Constructivist, Phosphor Terminal, Stellar Deco, Blueprint Blue, Blueprint Graphite, Zaibatsu — and Round 2 — Monolith, Annual Report, Deep Glass, Command & Control, Settlement Gazette, Bearer Instrument, Megaproject, Director, Keynote, Lightline). / Why: the… (the rest: AB#4880)

- [ ] The header has a style picker listing Current (default) and the sixteen styles; choosing one restyles the page at once, with no reload.
- [ ] With nothing chosen, the game looks exactly as it does today.
- [ ] No text, label, number or element is added, removed or reworded by any style: styles change look and layout only.
- [ ] The choice survives a reload and applies to the login and landing pages too.
- [ ] Every style is looked at on the Overview, Station, Galactic Exchange and a phone width, with screenshots attached to the PR; no sideways scroll, no unreadable text.
- [ ] npm test and check:design pass.

### ISP-245 Screenshot every screen at three widths and inventory what is off-system (Requirement AB#941, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Full visual redesign and UI facelift". The first story of the version. It builds on ISP-25 (AB#592, the design system: tokens, components, app shell, /styleguide) and ISP-26 (AB#593, every v0.5 screen rebuilt on it at 375/768/1280 with grouped navigation) and does not redo them. What it is. A scripted Playwright run captures every screen and building view at 375, 768 and 1280, reusing ISP-26's screenshot script… (the rest: AB#941)

- [x] A contact sheet of every screen at 375, 768 and 1280 is attached to this item (the screen count is stated), and a human has looked at it.
- [x] docs/design/FACELIFT_INVENTORY.md lists every screen with: added in version, on-system (yes/no, with the offending selectors or components), and defects seen. v1.0-06 to 08 are re-sized by the PM from this list if any group has more than about 6 off-system screens.
- [x] The screenshot script runs from one command and is committed, so v1.0-31 can reuse it.

### ISP-246 Add a CI check that keeps every screen on the design system (Requirement AB#942, Resolved, not verified) (lane: interstellar-settlement-protocol/client-shell)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Full visual redesign and UI facelift". It builds on ISP-25 (AB#592, the design system: tokens, components, app shell, /styleguide) and ISP-26 (AB#593, every v0.5 screen rebuilt on it at 375/768/1280 with grouped navigation) and does not redo them. What it is. A Node check in CI (no bundler, per the README's no-build-step rule) that fails when: a colour, font size, spacing, radius or z-index literal appears… (the rest: AB#942)

- [x] The check runs in CI and fails the build on each of the four violation kinds; the PR shows a seeded failure for each.
- [x] It passes on main after the violations it finds are either fixed in this PR (if 20 or fewer) or listed in an allowlist file with a v1.0-06/07/08 reference, which those stories empty.
- [x] An empty allowlist is asserted by v1.0-31's release gate.

### ISP-247 Design the bureaucratic voice: document codes, protocol phrasing, UTC and reference numbers (Requirement AB#943, Resolved, not verified) (lane: interstellar-settlement-protocol/client-shell)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Bureaucratic UI pass — reinforce the cold corporate sci-fi tone: section headers as for...". What it is. A guide at docs/design/BUREAUCRATIC_UI.md and a registry at data/section-codes.json. The registry defines the document-code scheme (for example, DEPT-FUNC-N as in "CORP-OPS-7 // Mining Operations") and assigns a unique code to every screen and section from v1.0-01's inventory. The guide covers: a status… (the rest: AB#943)

- [x] data/section-codes.json assigns a unique code to every screen and section in the inventory, and a test asserts uniqueness and format.
- [x] The guide's status vocabulary covers at least: pending, active, complete, failed, expired, refused, and insufficient funds. Each has plain meaning, protocol phrasing and one example.
- [x] The timestamp format is ISO 8601 in UTC (for example, 2147-03-14 09:42 UTC). The guide decides whether the in-fiction year replaces the real year, and states the offset if so.
- [x] Prior art cited: Papers, Please (Lucas Pope, 2013) for diegetic bureaucratic interface, and ISO 8601 for timestamps. The guide says what ISP takes from each.
- [x] Accessibility rule written: codes are secondary visual text; the accessible name of every section is its plain title.

### ISP-248 Add the document-code section header to the design system and apply it everywhere (Requirement AB#944, Resolved, not verified) (lane: interstellar-settlement-protocol/client-shell)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Bureaucratic UI pass — reinforce the cold corporate sci-fi tone: section headers as for...". Extends ISP-25's "panel with header" component rather than adding a parallel one. What it is. ISP-25's panel header gains a code slot rendering "CODE // Title" from data/section-codes.json. It is shown on /styleguide in every state and then applied to every screen and section, using the design system's optional display… (the rest: AB#944)

- [x] /styleguide shows the header with a code, and the component reads codes only from the registry.
- [x] A test fails if any screen or section in the registry lacks a header, or any header uses a code not in the registry.
- [x] Screen-reader names are the plain titles (checked with an accessibility snapshot in Playwright for three screens).
- [x] Screenshots of three representative screens at 1280px and 375px are attached to the PR and looked at by a human.

### ISP-249 Show every timestamp in UTC and give records reference numbers (Requirement AB#945, Resolved, not verified) (lane: interstellar-settlement-protocol/social)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Bureaucratic UI pass — reinforce the cold corporate sci-fi tone: section headers as for...". What it is. One client formatter for all timestamps in the guide's UTC format, replacing about 70 toLocale* date and time call sites in public/scripts/app.js (count at 4b6d1cf). The server also assigns a reference number to notifications, inbox items, transactions, leases, rulings and receipts, in the guide's format,… (the rest: AB#945)

- [x] A grep-based test fails if any toLocaleString, toLocaleDateString or toLocaleTimeString on a date remains outside the formatter module.
- [x] New records of each listed type carry a reference number, and existing records get one lazily on read, persisted (tested on a used save).
- [x] Security. Reference numbers are opaque, not sequential counters and not derived from account ids, so they reveal neither player identity nor game-wide volume. No route looks up a record by reference number without the owner's authorisation (a test).
- [x] Screenshots of the Inbox and the Financial Core with UTC times and reference numbers at 1280px are attached to the PR and looked at by a human.

### ISP-250 Bring the Company and Station screens added since v0.5 onto the design system (Requirement AB#946, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Full visual redesign and UI facelift". It builds on ISP-25 (AB#592, the design system: tokens, components, app shell, /styleguide) and ISP-26 (AB#593, every v0.5 screen rebuilt on it at 375/768/1280 with grouped navigation) and does not redo them. What it is. For every screen in the Company and Station navigation groups that v1.0-01 marked off-system (for example, conglomerate headquarters, co-owned stations,… (the rest: AB#946)

- [x] Every Company and Station screen in the inventory is on-system, and v1.0-02's allowlist has no entries for them.
- [x] Screenshots of each changed screen at 375, 768 and 1280 are attached to the PR and looked at by a human; no horizontal scroll, no text under 14px on mobile, and 44px touch targets.
- [x] No token or component is changed per screen. Any needed change is made in the ISP-25 system and shown on /styleguide in this PR.

### ISP-251 Bring the Industry and Market screens added since v0.5 onto the design system (Requirement AB#947, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Full visual redesign and UI facelift". It builds on ISP-25 (AB#592, the design system: tokens, components, app shell, /styleguide) and ISP-26 (AB#593, every v0.5 screen rebuilt on it at 375/768/1280 with grouped navigation) and does not redo them. What it is. As v1.0-06, for the Industry and Market groups: Tier 3 and Tier 4 chains, bonds, loans, equity and credit ratings, tariffs, patents and the flood alerts.… (the rest: AB#947)

- [x] Every Industry and Market screen in the inventory is on-system, and the allowlist has no entries for them.
- [x] Every data table collapses to cards below 768px.
- [x] Screenshots of each changed screen at 375, 768 and 1280 are attached to the PR and looked at by a human.
- [x] No per-screen token or component changes.

### ISP-252 Bring the Comms, Map and warfare screens added since v0.5 onto the design system (Requirement AB#948, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Full visual redesign and UI facelift". It builds on ISP-25 (AB#592, the design system: tokens, components, app shell, /styleguide) and ISP-26 (AB#593, every v0.5 screen rebuilt on it at 375/768/1280 with grouped navigation) and does not redo them. What it is. As v1.0-06, for Comms, Map and the warfare screens: fleets and deployment, raids, mercenary contracts, memoranda, dominance and concession overlays,… (the rest: AB#948)

- [x] Every screen in these groups is on-system, and v1.0-02's allowlist is now empty.
- [x] Starmap overlays keep a legend and a non-colour cue.
- [x] Screenshots of each changed screen at 375, 768 and 1280 are attached to the PR and looked at by a human.

### ISP-253 Pay off the placeholder and art debt, or name what must be bought (Requirement AB#949, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Full visual redesign and UI facelift". Applies the RUBRIC gate "Nothing placeholder is visible". What it is. An inventory and resolution of every placeholder visible in the build. Known at 4b6d1cf: 17 building imageFile entries in data/buildings.json point at PNGs that do not exist; planets beyond Earth, Mars and Luna use procedural gradients (ISP-14 covers active systems only, and v0.7 adds 20+ systems); and… (the rest: AB#949)

- [x] docs/design/ART_DEBT.md lists every placeholder with its screen and its resolution.
- [x] No data file references an image that does not exist (v1.0-02's check enforces this).
- [x] Anything left as "needs art" is listed with a count and a rough size of work, and the PM files it as a Board Decision (a spend decision) rather than leaving it in a doc.
- [x] Screenshots of every resolved screen at 1280px are attached to the PR and looked at by a human.

### ISP-254 Rewrite status and notification copy in protocol language: Company, Station and Industry (Requirement AB#950, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Bureaucratic UI pass — reinforce the cold corporate sci-fi tone: section headers as for...". What it is. Every status label, notification, inbox system message and error in the Company, Station and Industry groups (server strings in routes and tickers, client strings in renderers) is rewritten against v1.0-03's guide, with the plain meaning kept. Also a consistency pass on the narrator (Elara Voss throughout,… (the rest: AB#950)

- [x] A list of every changed string (old, new, file) is attached to the PR.
- [x] Every error still says what the player should do next (ISP-6's rule), checked by reading each changed error.
- [x] No string names Aria Voss.
- [x] Screenshots of five representative notifications and statuses at 1280px are attached to the PR and looked at by a human.

### ISP-255a Rewrite status and notification copy in protocol language: Exchange (Galactic Exchange, Assets, Stock Exchange, ITC/tariff/dumping notices) (Requirement AB#951, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Bureaucratic UI pass - reinforce the cold corporate sci-fi tone." Slice 951a of the original AB#951 Market/Comms/Map/warfare scope, split out because the full group measured ~373 strings against the 150 threshold - same discipline as AB#950's slices. / What it is. Every status label, notification, inbox system message and error in Galactic Exchange trades and orders, Assets, Stock Exchange and share… (the rest: AB#951)

- [x] A list of every changed string is attached to the PR.
- [x] Every error says what to do next.
- [x] Screenshots of five representative notifications and statuses at 1280px are attached to the PR and looked at by a human.

### ISP-256 Instrument the minimum telemetry so day-3 return can be measured (Requirement AB#952, Resolved, not verified) (lane: interstellar-settlement-protocol/social)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Public 1.0 release". A precondition of release: TELEMETRY.md does not allow a product to leave Preview without it. What it is. The TELEMETRY.md minimum events (app_open, verb_first, verb_repeat, session_end, error and funnel_step, plus rank_up for level-ups) are sent to a small self-hosted endpoint on the existing Azure deployment. There is no third-party processor. Nothing in the build sends telemetry today… (the rest: AB#952)

- [x] Each listed event fires at its trigger in a Playwright run, and the stored rows are shown in the PR.
- [x] D3 return is computable from the stored events with one documented query.
- [x] Security. Data: an anonymous distinct id (not the account id and not the email), session id, app version, platform and the event properties TELEMETRY.md lists. No PII, no IP address stored, retention stated. Hostile input: the endpoint accepts only the listed event names and property types, is rate-limited, and rejects oversized bodies. Fails closed: an invalid event is dropped and never stored raw.
- [x] The BRIEF names the telemetry store, as TELEMETRY.md requires.

### ISP-257 Rewrite the landing page for a public audience (Requirement AB#953, Resolved, not verified) (lane: interstellar-settlement-protocol/social)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Landing page facelift (visual redesign, messaging polish, improved first-use UX)". ISP-26 rebuilt the landing page on the design system for the beta; this is the messaging and first-impression pass for strangers. What it is. The landing page shows: a hero with a real in-game screenshot, the verb ("Allocate") in one sentence, who it is for, three proof points that show systems rather than listing them, and one… (the rest: AB#953)

- [x] A silent screenshot of the landing page shows what the game is and what you do, and a person who has not seen ISP says so when shown it (their words quoted in the PR).
- [x] No occurrence of "prototype", "dummy" or "developer" in public/*.html (a test).
- [x] There is one primary call to action above the fold at 375px and 1280px.
- [x] Screenshots at 375, 768 and 1280 are attached to the PR and looked at by a human.

### ISP-258 Make the landing page shareable and findable: favicon, meta and link previews (Requirement AB#954, Resolved, not verified) (lane: interstellar-settlement-protocol/social)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Landing page facelift (visual redesign, messaging polish, improved first-use UX)". What it is. Adds a favicon, a meta description, theme-color, Open Graph and Twitter card tags with a real screenshot image, a canonical URL and robots.txt. At 4b6d1cf, no page declares a favicon or preview tags, so every load returns a 404 for /favicon.ico and shared links have no preview. Why it matters. The BRIEF says players… (the rest: AB#954)

- [x] A link preview renders with title, description and image in at least one real unfurler (a screenshot is attached, for example from a chat app).
- [x] Lighthouse SEO is 90 or above on the landing page (the number is stated in the PR).
- [x] There are no 404s in the network log for the landing page load.
- [x] The canonical URL comes from one configuration value, not hard-coded in several files.

### ISP-259 Measure and shorten the path from landing page to the first verb (Requirement AB#955, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Landing page facelift (visual redesign, messaging polish, improved first-use UX)". What it is. A Playwright script walks a stranger's path: land, register, the opening, and the first core action (rent an office and build an extractor). It counts clicks and fields, and records funnel_step events. Friction it finds in this path (confusing fields, validation copy, dead ends) is fixed in this story up to the… (the rest: AB#955)

- [x] The PR states the before and after click count and field count from landing to the first extractor, and after is not higher than before.
- [x] Registration errors say what to fix, field by field, with server-side validation unchanged or stricter.
- [x] Security. The registration path keeps ISP-24's rate limits and validation. No new data is collected, and no field is pre-filled with real values (the value= defaults in register.html noted in CODEBASE_MAP are placeholders).
- [x] Screenshots of each step at 375px are attached to the PR and looked at by a human.

### ISP-260 Prove every route and socket event is authenticated or deliberately public (Requirement AB#956, Resolved, not verified) (lane: interstellar-settlement-protocol/social)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final security hardening and public deployment configuration". Builds on ISP-24 and ISP-10, the v0.5 auth review and hardening pass, extended to every surface added since. What it is. A test that enumerates every Express route and every socket.io event handler at runtime. Each must be either behind requireAuth and account scoping, or on an explicit public allowlist with a written reason. Any unlisted route… (the rest: AB#956)

- [x] The test lists every route and socket event, the count is stated in the PR, and it fails on a seeded unauthenticated route.
- [x] The public allowlist file gives a reason per entry, and every entry is reviewed in the PR.
- [x] For every account-scoped route, a second account's token is refused (403), checked generically by the test across all routes with an :accountId parameter.
- [x] Any route found unprotected is filed as a bug (the BUGS.md way) before it is fixed.

### ISP-261 Refresh the threat model for every system added since v0.5 (Requirement AB#957, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final security hardening and public deployment configuration". What it is. docs/SECURITY.md answers DOCTRINE's four questions (what data and does it need it, who can reach it and what if they are hostile, blast radius, and what fails closed) for each system added in v0.6 to v0.13. It also covers economic abuse: multi-account funnelling into a conglomerate treasury, wash trading to game dominance or ratings, and… (the rest: AB#957)

- [x] Every v0.6 to v0.13 system has a section with all four answers.
- [x] Each economic abuse scenario names the control that limits it, or is filed as a bug with a proposed fix.
- [x] Every finding is filed as a Bug with severity before this closes; the count is stated.

### ISP-262 Rate-limit every mutating route and throttle abusive account creation (Requirement AB#958, Resolved, not verified) (lane: interstellar-settlement-protocol/accounts)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final security hardening and public deployment configuration". Extends ISP-24's rate limits on login, register and refresh to everything else. What it is. Per-account and per-address rate limits on every mutating route, grouped by cost (trade, chat and memoranda, filing, construction), plus a registration throttle per address. Limits come from one configuration and appear in 429 responses with a retry time. Why… (the rest: AB#958)

- [x] v1.0-16's route list is used to assert that every mutating route has a limiter, and the test fails on a new unlimited route.
- [x] One test per group trips its limit.
- [x] Security. Data: counters keyed by account id and forwarded address, held in memory or the store with a TTL, never logged with the address. Hostile input: spoofed X-Forwarded-For, handled by trusting only the platform's proxy hop. Fails closed: if the limiter store is unavailable, mutating requests are refused with 503, not waved through.

### ISP-263 Audit dependencies, secrets and git history before going public (Requirement AB#959, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final security hardening and public deployment configuration". What it is. npm audit with high and critical findings fixed or justified. A secret scan of the full git history with gitleaks, including confirmation that the AB#415 accounts snapshot is gone from history (DEPTH and MONETIZATION both flagged this). A check that the production CSP runs with zero violations in a full Playwright run. Why it matters. A… (the rest: AB#959)

- [x] npm audit --omit=dev reports no high or critical findings, or each remaining one is justified in the PR.
- [x] The gitleaks scan of all refs reports no secrets; git log --all -- data/accounts-snapshot.json returns nothing. If either fails, it is filed as a severity 1 bug for the Board and this story stays open.
- [x] The CSP report shows zero violations across the full Playwright suite.
- [x] No secret value is printed in the PR or logs; commands are given for the Board to run where a secret is needed.

### ISP-264 Let players delete their account and export their data (Requirement AB#960, Resolved, not verified) (lane: interstellar-settlement-protocol/accounts)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final security hardening and public deployment configuration". Included because a public release with email accounts needs it; see notes. What it is. A delete-account flow (re-authenticate, confirm, then erase email, password hash, refresh tokens, notifications and memoranda; the corporation is anonymised in market and docket history rather than deleted, so other players' records stay consistent). Also a data… (the rest: AB#960)

- [x] After deletion, no table holds the email, hash or tokens (a test queries every account-keyed table). The corporation's name in shared history reads as a stated anonymous label.
- [x] Export returns every account-keyed record, and a test compares its keys with the schema's account-keyed tables.
- [x] Security. Deletion requires the password (or a fresh login) plus confirmation, and is rate-limited. Export is available only to the authenticated owner and is never cached publicly. Fails closed: a failure part-way rolls back rather than leaving a half-deleted account.
- [x] Screenshots of the delete and export flow at 1280px and 375px are attached to the PR and looked at by a human.

### ISP-265 Back up the production data and prove a restore works (Requirement AB#961, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final security hardening and public deployment configuration". What it is. Scheduled backups of the database and the data volume, with retention stated. A restore drill brings a copy up in a scratch environment from a backup, and the drill is written into the runbook. ISP-11 documented and performed a rollback of the app, not a restore of data. Why it matters. A public economy with no tested restore is one bad… (the rest: AB#961)

- [x] Backups run on schedule, and the latest backup's timestamp is visible to the Board in a documented place.
- [x] A restore of a real backup into a scratch environment was performed. Its time to restore and data age are stated, and a known account's state matches the source.
- [x] The runbook has a restore section a person can follow without asking.
- [x] Security. Backups are encrypted at rest and not publicly reachable. Scratch copies are deleted after the drill, and this is stated in the PR.

### ISP-266 Load-test the server at release scale and file what breaks (Requirement AB#962, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final performance audit and optimisation". Builds on ISP-9 (the v0.5 performance audit), now covering v0.6 to v0.13's tickers. What it is. A load harness simulates N concurrent corporations (default 200, and the Board's expected launch number from D-1.0-1 if different) with sockets, against a production-like container. It measures tick duration p95 per ticker, event-loop delay… (the rest: AB#962)

- [x] The harness runs from one command, and its output (the four measures at N) is in the PR.
- [x] Targets: tick p95 below 100 ms per ticker, event-loop delay p99 below 200 ms, and no memory growth over 30 minutes. Each missed target is filed as a bug with the numbers.
- [x] The socket.io scaling question is answered in writing: whether one replica suffices for N, and if not, that more than one replica needs sticky sessions and an adapter (socket.io's multi-node docs). That becomes a hosting input to D-1.0-1.

### ISP-267 Measure database query and write cost at release scale (Requirement AB#963, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final performance audit and optimisation". What it is. Under the v1.0-22 load, capture slow queries, write amplification per request (CODEBASE_MAP found that read endpoints persisted the whole account store), and the missing indexes. Add the indexes whose benefit is measured in this session. Why it matters. Persistence frequency was already a v0.5 audit item. Nine versions of new tables make it again the… (the rest: AB#963)

- [x] The PR lists the top 10 queries by total time before and after, from the database's own statistics.
- [x] No GET route writes to the database (a test runs every GET under a write-counting wrapper).
- [x] Each remaining slow query over 50 ms p95 is filed as a bug.

### ISP-268 Bring the client within a performance budget on a phone (Requirement AB#964, Resolved, not verified) (lane: interstellar-settlement-protocol/accounts)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final performance audit and optimisation". What it is. Lighthouse performance on the landing page and the main app view (mobile profile). Also: image weights (responsive and compressed; CODEBASE_MAP found about 1 MB of backgrounds dimmed to near-invisible), self-hosted fonts and chart library (also needed for the CSP), the starfield animation paused when hidden and under reduced motion, and cache headers on… (the rest: AB#964)

- [x] Lighthouse mobile performance is 85 or above on the landing page and the main app view (numbers stated before and after).
- [x] Total transferred bytes for a first load of the landing page are stated before and after, and after is lower.
- [x] The starfield animation stops when the tab is hidden and under prefers-reduced-motion (a test).
- [x] Static assets carry cache headers (checked in the PR).
- [x] Screenshots of the landing page and the main app view at 375px after the image changes are attached to the PR, and a human has checked them for compression artefacts or missing imagery.

### ISP-269 Run the full-progression economy probe and report where the curve breaks (Requirement AB#965, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final balance pass across economy, combat, and progression". Builds on ISP-8, the v0.5 balance pass, now over every system. What it is. The ISP probe runs a planner bot and a greedy bot from a new corporation to the maximum level (40, per v0.6), across all resources and markets. It reports level reached per day, credits banked against spent per day (MONETIZATION epic 2's sink measure), and decision density… (the rest: AB#965)

- [x] The probe reports, as bot numbers: the highest level reached (target 40, the documented maximum; T-019), credits banked divided by credits spent per day at days 3, 7 and 30 (target below 3), and decision density (target 40% or more).
- [x] Every missed target is filed as a balance bug with the probe output and a proposed data change.
- [x] The raw output is attached to this item.

### ISP-270 Simulate fleet compositions against each other and check for a dominant one (Requirement AB#966, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final balance pass across economy, combat, and progression". What it is. A combat simulation tournament over the v0.10 unit set (fighters, destroyers, siege engines, rock-paper-scissors counters, accuracy and evasion). Every composition from a stated grid fights every other many times, and the harness reports win rates. The same harness checks station raid outcomes against defence investment. Why it matters.… (the rest: AB#966)

- [x] The tournament report lists win rates per composition against the field (bot numbers).
- [x] Target: no composition wins more than 60% against the field, and each unit type is part of at least one composition in the top quartile. Misses are filed as balance bugs with the data.
- [x] Raid success rate falls monotonically as defence investment rises (a chart attached), and a fully invested defender is never guaranteed safe or guaranteed lost.

### ISP-271 Check warfare-economy balance: concessions, tariffs, patents, lobbying and arbitration together (Requirement AB#967, Resolved, not verified) (lane: interstellar-settlement-protocol/combat)

What: Where it sits. v1.0 Facelift, stable release, published (Feature AB#398), plan line "Final balance pass across economy, combat, and progression". What it is. Runs v0.12's conglomerate profile and v0.13's tariff and dumping profile together in one world with rival bot factions, adding patents, lobbying and arbitration. It reports the share of concessions held by the top faction over 30 days, and whether any warfare strategy strictly dominates. Why it matters. Each v0.13 system was balanced… (the rest: AB#967)

- [x] The report gives, as bot numbers: the top faction's share of concedable systems at days 7 and 30, and the return on each warfare lever.
- [x] Target: the top faction holds no more than 50% of concedable systems at day 30, and no lever has a return that grows without bound in spend. Misses are filed as balance bugs.
- [x] The raw output is attached to this item.

## Demo script

_To be written._
