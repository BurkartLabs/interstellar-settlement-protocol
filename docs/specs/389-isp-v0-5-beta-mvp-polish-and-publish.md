# ISP v0.5 — Beta MVP: polish and publish

Feature AB#389 (Proposed) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits. v0.5 on the ISP roadmap (DEVELOPMENT_PHASES.md in the product repo), under the product epic #388. The current milestone, and the only one with stories filed underneath it.
What it is for - restated by the Board, 2026-09-20. "This is going to be the Beta MVP pass. This is going to be the one that needs to be released for playtesting. So we need to look at it from start to finish." That sentence is the acceptance for the whole feature: not thirty-two items each closed on their own terms, but a build a stranger can register on, play through the first hour of, come back to on day three, and trade with another stranger on - hosted somewhere real, on a URL the Board can hand out. ISP-23 (the playtest release gate) is where that is checked, last, against the deployed build.
How it is being worked. Interactively, in Board sessions, with the Board reviewing every pull request. Agents do not build this product: the product hold should be mine in the Console so that Builder, Reviewer, QA and PM stay off it while the Critic and the probes keep running read-only, which is the platform functionality worth keeping. No story under this feature is tagged agent-ready, and none should be.
Decisions folded in on 2026-09-20. Hosting moves to Azure, the same way everything else is hosted (Container Apps in rg-orchestrata); Vercel and its serverless branches go, and Supabase is retired in favour of Azure persistence - see #578 and the hosting decision. The authentication system gets a review of its own (ISP-24). The visual design is rebuilt rather than polished: a design system, then every screen, desktop and mobile, with reward moments designed deliberately (ISP-25, ISP-26). The narrator is Elara Voss throughout (#585).
What it contains. 22 requirements (ISP-1 to ISP-22, now ISP-26) and 10 bugs, all children of this item. Rough order of work: the Tier 0 blockers (#577 market delivery, #423 unauthenticated credit setting, #578 hosting), then hosting and auth (ISP-11, ISP-24, ISP-10), then the design system and screens (ISP-25, ISP-26, ISP-20, ISP-19), then onboarding (ISP-22, ISP-16, ISP-17, ISP-18, ISP-5, ISP-6), then the exchange, finance, transport and balance work (ISP-1 to ISP-4, ISP-8), then health (ISP-7, ISP-9, ISP-12, ISP-13), then content (ISP-14, ISP-15), then the gate (ISP-23). ISP-21 is design-only and waits for the Board.
Why it matters. ISP is the company's first multiplayer economy and the first product built by the Board directly. v0.5 decides whether it is a game anyone can be handed.

## Acceptance

_To be written: the Feature had no acceptance criteria in Azure DevOps._

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 2 open, 92 resolved.

### ISP-63 Run the playtest release gate on the deployed build (Requirement AB#750, Proposed)

What: Where it sits. v0.5 Beta MVP (#389), release gate, third of three replacing ISP-23 (#587): the item that says whether v0.5 is done. What it is. On the public URL: the Playwright run from v0.5-s35 at both viewports; a second account on a second device lists an item and the first account buys it; a return after the first cycle completes shows output, credits and something new to do; every dead end or unhelpful error is filed and fixed or deferred by the Board; then the Board plays it. Why it… (the rest: AB#750)

- [ ] The Playwright run passes against the public URL at 1280x800 and 375x812, screenshots attached to this item.
- [ ] A player-to-player trade between two accounts on two devices is completed once, with both sides' trade history screenshots attached (the BRIEF's second measure, shown once; it is not a player number).
- [ ] A return visit after one completed cycle shows output, credits and a next action, screenshot attached.
- [ ] Every finding is a Bug, and each is Closed or explicitly deferred by the Board before this item closes.
- [ ] Access and social features match the Board's answers, checked on the URL: a new account registers with no invitation code, must verify its email before logging in, and can reset its password by email (D-0.5-5, D-0.5-2); chat, forums and player mail work between the two test accounts (D-0.5-4). If the email sender (Decision D-email) is not live, this item says so and does not close.
- [ ] The suite is green on a fresh clone, count stated.
- [ ] The Board has played it and says so on this item.

### ISP-282 Wire the email sender the Board approved into the beta (Requirement AB#989, Active)

What: Where it sits. v0.5 Beta MVP (#389), authentication review; the only part of D-0.5-2 (AB#694) that needs a new paid service, so it is blocked on Decision D-email. What it is. Provision the sender the Board chose in the infrastructure code, add its transport to the mail module, and configure the beta to use it. The connection secret (if any) is a Key Vault reference, set by a command the PR prints for the Board to run. Why it matters. Until this lands, verification and reset work only in tests,… (the rest: AB#989)

- [ ] A verification email and a reset email sent from the deployed beta arrive at a Board-controlled address; a screenshot of each received message (sender shown) is attached.
- [ ] The resource is defined in infrastructure code; no secret is in the repository, the image or the logs.
- [ ] A transport failure makes registration and reset return 503 with nothing half-created, and is logged without the recipient address (test with a failing transport).
- [ ] The PR states the expected monthly cost at playtest volume against what the Board approved on D-email.

### ISP-21 Design the quest spine: why you are a CEO, and what the journey is (Requirement AB#584, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), Onboarding and Tutorial, alongside ISP-5 (#404, tutorial drift) and ISP-6 (#405, first-session UX). Board direction, 2026-09-20, after walking the first session. / What it is. The Board: "I think I'd like the whole game to be quest driven... Friendly popups that guide you along the way with like a story as to WHY you're becoming a CEO and like the journey." / This item is the design, not the build. It is scoped that way deliberately: it reshapes how progression… (the rest: AB#584)

- [x] A design document at docs/QUEST_SPINE.md in the product repo answers the five questions in the description.
- [x] The first act is specified beat by beat, each beat naming the existing system, route or data file it uses; no beat depends on anything not in the build at the time of writing.
- [x] Quest content is specified as data (a schema and one worked example file), and the narrator is a field in that data.
- [x] The design states how quests relate to the milestone ladder (data/milestones.json) after #424 is fixed.
- [x] Anticipation (Depth Critique #426, epic 5): at every point after the first thirty minutes, the design names at least one pending outcome the player can see before logging off (a contract result, an expedition survey, a research completion with a named payoff), and nothing expires in a way that punishes absence.
- [x] Prior art is cited: CCP's new-player experience work on the "what now?" moment when a guided sequence ends (cited in #426).
- [x] The Board signs off the design on this item before any implementation story is written against it.

### The schema test suite reads gitignored runtime state, so it is red on main and cannot load on a fresh clone (Bug AB#588, Resolved, not verified)

What: Where this sits. tests/schema/data-files.test.js validates every catalog under data/. Its last describe block, data/state.json (line 219), is different from the others: state.json is not a catalog, it is the server's runtime global state, and it is gitignored (.gitignore: data/state.json). / Symptom. npm test on main is red: contains market and chatLog sections fails because data.chatLog is undefined. On a fresh clone the file does not exist at all, so load() throws inside the describe callback… (the rest: AB#588)
Symptom: npm test on main is red: the test "contains market and chatLog sections" in tests/schema/data-files.test.js fails because data.chatLog is undefined. On a fresh clone data/state.json does not exist, so load() throws inside the describe callback and the whole file errors before any of its tests run, including the catalog checks that matter. The result depends on what the local server last wrote. / Larger than first reported (Builder, 2026-09-21, while fixing AB#692): without data/state.json,… (the rest: AB#588)
Repro: 1. Fresh clone, npm install, npm test: data-files.test.js errors on ENOENT. / 2. Start the server once so it writes data/state.json, then run npm test again: 138 pass, 1 fails on chatLog.
Proposed fix: Confidence: high. Delete the data/state.json describe block (tests/schema/data-files.test.js:219 onward). If the goal is to guard the shape of the global state, test it at the source: import getSeedState and normalizeStateShape from server/gameState.js and assert the keys on the object they produce. Regression check: the file passes on a clone with no data/state.json present.

- [x] Fixed: The schema test suite reads gitignored runtime state, so it is red on main and cannot load on a fresh clone

### ISP-34 Bug sweep: office, hiring, extraction leases, extractors and mining cycles (Requirement AB#720, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), Release Engineering, one of six sweeps replacing ISP-7 (#406). What it is. A structured pass over the core loop (office rent and renewal, hiring and payroll, extraction leases, extractor yards, starting and stopping cycles) on a local production-mode build of main (NODE_ENV=production, a fresh ISP_DATA_DIR), or on the deployed URL once v0.5-s24 exists, filing what it finds. Why it matters. Four versions of systems have accumulated without a sweep; each bug… (the rest: AB#720)

- [x] Every player action in the core loop (office rent and renewal, hiring and payroll, extraction leases, extractor yards, starting and stopping cycles) is performed at least once with a fresh account, and the PR or item comment lists each action with its result.
- [x] Each finding is an Azure DevOps Bug under hq BUGS.md (symptom, repro, severity, found-in commit, proposed fix with confidence) filed before any fix; known open bugs are linked, not refiled.
- [x] Hostile input is tried on every form in scope (empty, negative, non-numeric, very long) and the result recorded.
- [x] The sweep reports the number of findings per system and the actions that could not be exercised and why, so a quiet area is distinguishable from an untested one.
- [x] One screenshot per screen exercised, at 1280x800, attached to the item.

### ISP-35 Bug sweep: Galactic Exchange, standing orders, trade history and transfers (Requirement AB#721, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), Release Engineering, one of six sweeps replacing ISP-7 (#406). What it is. A structured pass over the Galactic Exchange (listing, buying, selling to standing orders, trade history, the suggested-price helper) and resource transfers on a local production-mode build of main (NODE_ENV=production, a fresh ISP_DATA_DIR), or on the deployed URL once v0.5-s24 exists, filing what it finds. Why it matters. Four versions of systems have accumulated without a sweep;… (the rest: AB#721)

- [x] Every player action in the Galactic Exchange (listing, buying, selling to standing orders, trade history, the suggested-price helper) and resource transfers is performed at least once with a fresh account, and the PR or item comment lists each action with its result.
- [x] Each finding is an Azure DevOps Bug under hq BUGS.md (symptom, repro, severity, found-in commit, proposed fix with confidence) filed before any fix; known open bugs are linked, not refiled.
- [x] Hostile input is tried on every form in scope (empty, negative, non-numeric, very long) and the result recorded.
- [x] The sweep reports the number of findings per system and the actions that could not be exercised and why, so a quiet area is distinguishable from an untested one.
- [x] Two accounts are used, so a player-to-player trade is completed at least once.
- [x] One screenshot per screen exercised, at 1280x800, attached to the item.

### ISP-36 Bug sweep: Corporate R&D, CEO Insight and corporation levels (Requirement AB#722, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), Release Engineering, one of six sweeps replacing ISP-7 (#406). What it is. A structured pass over Corporate R&D, CEO Insight and the milestone ladder (queueing, completion, effects, level-up rewards) on a local production-mode build of main (NODE_ENV=production, a fresh ISP_DATA_DIR), or on the deployed URL once v0.5-s24 exists, filing what it finds. Why it matters. Four versions of systems have accumulated without a sweep; each bug filed before it is fixed… (the rest: AB#722)

- [x] Every player action in Corporate R&D, CEO Insight and the milestone ladder (queueing, completion, effects, level-up rewards) is performed at least once with a fresh account, and the PR or item comment lists each action with its result.
- [x] Each finding is an Azure DevOps Bug under hq BUGS.md (symptom, repro, severity, found-in commit, proposed fix with confidence) filed before any fix; known open bugs are linked, not refiled.
- [x] Hostile input is tried on every form in scope (empty, negative, non-numeric, very long) and the result recorded.
- [x] The sweep reports the number of findings per system and the actions that could not be exercised and why, so a quiet area is distinguishable from an untested one.
- [x] A fake clock or a shortened duration in a dev build is used for queues, and the PR says which.
- [x] One screenshot per screen exercised, at 1280x800, attached to the item.

### ISP-37 Bug sweep: refinery chains, asteroid scouting, probes and expeditions (Requirement AB#723, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), Release Engineering, one of six sweeps replacing ISP-7 (#406). What it is. A structured pass over refinery chains, belt scouting, mining-probe fabrication and asteroid expeditions on a local production-mode build of main (NODE_ENV=production, a fresh ISP_DATA_DIR), or on the deployed URL once v0.5-s24 exists, filing what it finds. Why it matters. Four versions of systems have accumulated without a sweep; each bug filed before it is fixed is also data for the… (the rest: AB#723)

- [x] Every player action in refinery chains, belt scouting, mining-probe fabrication and asteroid expeditions is performed at least once with a fresh account, and the PR or item comment lists each action with its result.
- [x] Each finding is an Azure DevOps Bug under hq BUGS.md (symptom, repro, severity, found-in commit, proposed fix with confidence) filed before any fix; known open bugs are linked, not refiled.
- [x] Hostile input is tried on every form in scope (empty, negative, non-numeric, very long) and the result recorded.
- [x] The sweep reports the number of findings per system and the actions that could not be exercised and why, so a quiet area is distinguishable from an untested one.
- [x] One screenshot per screen exercised, at 1280x800, attached to the item.

### ISP-38 Bug sweep: missions and contracts, travel and the starmap (Requirement AB#724, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), Release Engineering, one of six sweeps replacing ISP-7 (#406). What it is. A structured pass over the Contracting and Assignments Bureau (accept, abandon, complete), personal travel and the starmap on a local production-mode build of main (NODE_ENV=production, a fresh ISP_DATA_DIR), or on the deployed URL once v0.5-s24 exists, filing what it finds. Why it matters. Four versions of systems have accumulated without a sweep; each bug filed before it is fixed is… (the rest: AB#724)

- [x] Every player action in the Contracting and Assignments Bureau (accept, abandon, complete), personal travel and the starmap is performed at least once with a fresh account, and the PR or item comment lists each action with its result.
- [x] Each finding is an Azure DevOps Bug under hq BUGS.md (symptom, repro, severity, found-in commit, proposed fix with confidence) filed before any fix; known open bugs are linked, not refiled.
- [x] Hostile input is tried on every form in scope (empty, negative, non-numeric, very long) and the result recorded.
- [x] The sweep reports the number of findings per system and the actions that could not be exercised and why, so a quiet area is distinguishable from an untested one.
- [x] One screenshot per screen exercised, at 1280x800, attached to the item.

### ISP-39 Bug sweep: chat, forums, in-game mail and notifications (Requirement AB#725, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), Release Engineering, one of six sweeps replacing ISP-7 (#406). What it is. A structured pass over global chat, forums, in-game mail and notifications on a local production-mode build of main (NODE_ENV=production, a fresh ISP_DATA_DIR), or on the deployed URL once v0.5-s24 exists, filing what it finds. Why it matters. Four versions of systems have accumulated without a sweep; each bug filed before it is fixed is also data for the proposal hit rate in hq… (the rest: AB#725)

- [x] Every player action in global chat, forums, in-game mail and notifications is performed at least once with a fresh account, and the PR or item comment lists each action with its result.
- [x] Each finding is an Azure DevOps Bug under hq BUGS.md (symptom, repro, severity, found-in commit, proposed fix with confidence) filed before any fix; known open bugs are linked, not refiled.
- [x] Hostile input is tried on every form in scope (empty, negative, non-numeric, very long) and the result recorded.
- [x] The sweep reports the number of findings per system and the actions that could not be exercised and why, so a quiet area is distinguishable from an untested one.
- [x] The sweep records what one account can see of another account's data over the socket (see v0.5-s41) and files any leak as severity 1.
- [x] One screenshot per screen exercised, at 1280x800, attached to the item.

### ISP-43 Measure server tick and persistence cost at 10, 100 and 1,000 corporations (Requirement AB#729, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), Release Engineering, first of two replacing ISP-9 (#408). What it is. A benchmark script that creates N synthetic corporations with active extractors, refineries and queues, runs each of the eight tickers (server/index.js:460 to :797) once, and times each; then times one full state write to disk at each N and records the file size. Why it matters. The per-second tick is what falls over first under load; the 30-second financial snapshot ticker also emits to… (the rest: AB#729)

- [x] npm run bench:ticks prints a table of milliseconds per ticker at N = 10, 100 and 1,000, and the state file size and write time at each N; the PR quotes it with the machine it ran on.
- [x] The budget is stated: every ticker under 50% of its own interval at N = 1,000, and a state write under 1 second.
- [x] Each over-budget ticker is filed as its own story with its number attached.
- [x] The persistence frequency (debounce interval) is stated with the data-loss window it implies on a crash.

### ISP-44 Measure the client render budget on a throttled mid-range profile (Requirement AB#730, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), Release Engineering, second of two replacing ISP-9 (#408). What it is. Measure first paint, time to interactive, and the cost of one full re-render (public/scripts/app.js:4788 re-renders every view on every update, per its own TODO) under Chrome DevTools 4x CPU throttling, with a corporation that has 5 extractors, a full order book and 50 trades. Why it matters. A vanilla-JS client with no build step and 6,641 lines in one file is where a phone will feel… (the rest: AB#730)

- [x] The PR states first paint, time to interactive, and the median and 95th percentile of a full re-render over 20 socket updates, at 4x throttling, with the trace attached.
- [x] The budget is stated: a re-render under 16 ms median and under 50 ms p95.
- [x] Anything over budget is filed as its own story with its number.

### ISP-51 Write the one-file-per-system rule and split server/gameState.js (Requirement AB#737, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), QoL Fixes, first of three replacing ISP-12 (#411). What it is. Write the rule into DESIGN_DOCUMENT.md and CONTRIBUTING.md (one module per system; a soft cap of about 600 lines; state, rules and I/O separated), then split server/gameState.js (2,594 lines) into modules along system lines: persistence, accounts, corporation and progression, mining, refining, asteroid operations, market, missions, messaging, with gameState.js left as a thin re-export. Why it… (the rest: AB#737)

- [x] DESIGN_DOCUMENT.md and CONTRIBUTING.md state the rule and the reason.
- [x] No module under server/ exceeds 800 lines except server/index.js (handled by a later story if the Board wants it; not in this plan line); gameState.js only re-exports.
- [x] The existing Vitest suite passes with only import paths changed; no assertion is edited.
- [x] The PR lists each new module with its line count.
- [x] npm test is green on a fresh clone (no data/ directory), with the number of tests executed stated in the PR.

### ISP-52 Split public/scripts/app.js, part 1: shared state, API client, helpers, walkthrough and dialogue (Requirement AB#738, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), QoL Fixes, second of three replacing ISP-12 (#411). What it is. Move the shared pieces out of app.js (6,641 lines) into ES modules under public/scripts/: app state, the API and socket client, formatting helpers (consolidating the duplicates its TODOs name at :533, :2254, :2606), the walkthrough and the dialogue system. Why it matters. The screen rebuild (ISP-26) touches every tab; doing it on a single 6,641-line file makes every change a whole-file change.… (the rest: AB#738)

- [x] The listed pieces live in their own modules and app.js imports them; no helper is defined twice.
- [x] The app loads with no console error and the walkthrough runs start to finish on a local build (checked by playing it).
- [x] Screenshot of the Overview tab after the split at 1280x800 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).
- [x] npm test is green on a fresh clone (no data/ directory), with the number of tests executed stated in the PR.

### ISP-53 Split public/scripts/app.js, part 2: one module per tab (Requirement AB#739, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), QoL Fixes, third of three replacing ISP-12 (#411). What it is. Move each tab's renderer (Overview, Inbox, Station and building views, Financial Core, R&D, CEO Insight, Refinery Chains, Exchange, Assets, Logistics, Comms, Forums, Assignments, Starmap) into public/scripts/views/, leaving app.js as bootstrap and routing. Why it matters. It is the shape ISP-26 rebuilds screen by screen. Estimate: 1 session, assuming v0.5-s26 has landed.

- [x] app.js is under 800 lines and contains bootstrap and tab routing only; each tab has its own module.
- [x] Every tab renders with no console error on a local build, checked by opening each.
- [x] Screenshot of every tab (one screenshot each) at 1280x800 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).
- [x] npm test is green on a fresh clone (no data/ directory), with the number of tests executed stated in the PR.

### ISP-56 Procedural renders for every body outside Sol (Requirement AB#742, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), carried over from the kanban (was ISP-14, #413). What it is. The 20 bodies in Alpha Centauri, Barnard's Star, Wolf 359, Tau Ceti and Epsilon Eridani are fictional, so no photograph exists. Render each procedurally on the canvas from a per-body style in data/systems.json (base colour, bands, craters or clouds, atmosphere), deterministic per body. Why it matters. The same placeholder argument as Sol, for the systems the player reaches by research. Estimate: 1… (the rest: AB#742)

- [x] Every non-Sol body has a style entry and renders procedurally; the render is identical across reloads (seeded).
- [x] No body in any system falls back to the placeholder circle (a test iterates every body).
- [x] Rendering the busiest system costs under 16 ms a frame at 4x CPU throttle (measured, number in the PR).
- [x] Screenshot of the Alpha Centauri and Barnard's Star views at 1280x800 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-57 Confirmation modal for the core-loop actions, and the first level-up (Requirement AB#743, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), Onboarding (Board direction 2026-09-20), first of two replacing ISP-19 (#582). What it is. One shared confirmation component (what was bought, what it cost, what it grants, the next action) used by rent office, renew office, hire, file extraction lease, commission extractor yard and start cycle; and a distinct milestone variant for a level-up that names what the level unlocked (hiring the fifth employee: Level 1, employees 5/20, building slots 4, fleet cap… (the rest: AB#743)

- [x] The six actions each show the modal with what, cost, grants and next action, taken from the server response rather than recomputed on the client.
- [x] A level-up shows the milestone variant listing every unlock the server applied (employeeCap, buildingSlots, maxFleetSize, marketSectors).
- [x] The modal closes on Escape, on its button and on a backdrop click, returns focus to the triggering control, and never blocks the next action.
- [x] Copy is in the ISA register (no exclamation marks, no "Congratulations!").
- [x] Screenshot of the modal after hiring, and the Level 1 milestone modal at 1280x800 and 375x812 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-58 Confirmation modal for every remaining committing action (Requirement AB#744, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), Onboarding, second of two replacing ISP-19 (#582). What it is. Wire the component into refinery build and start, probe fabrication, belt scouting, expeditions, R&D and CEO Insight queueing, exchange listing, buying and selling to a standing order, transfers, travel and mission accept and complete. Why it matters. Same reason as v0.5-s31, applied to the rest of the game. Estimate: 1 session, assuming v0.5-s31 has landed.

- [x] Each listed action shows the modal from the server response; a test lists the action routes and asserts each has a confirmation mapping.
- [x] An action that fails shows the error, not a confirmation.
- [x] Screenshot of the modal after an exchange sale and after queueing research at 1280x800 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-59 Acknowledge changing numbers where they change (Requirement AB#745, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), polish (Board direction 2026-09-20), first of two replacing ISP-20 (#583). What it is. When credits, employees, building slots, fleet cap or inventory change, the number animates to its new value and briefly highlights (up and down distinguished), using the design system's motion tokens; prefers-reduced-motion shows the change without motion. Why it matters. The Board: "when we do something it should feel rewarding"; today the only evidence a hire worked is… (the rest: AB#745)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] Each listed number animates on change and highlights for under one second; increases and decreases look different.
- [x] With prefers-reduced-motion the value changes instantly with a static highlight.
- [x] A number updated by a socket event while the tab is hidden does not queue a burst of animations on return.
- [x] A screen recording (GIF or MP4) of a hire and a sale attached to the PR, looked at by the author.

### ISP-60 Show accumulation in an active mining cycle (Requirement AB#746, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), polish, second of two replacing ISP-20 (#583). What it is. The active cycle shows a flat bar at 0% and a countdown while tonnage accrues every five seconds. Show tonnes mined this cycle (from #575's minedThisCycle), the credits spent so far, the rate, and a bar that fills with elapsed time. Why it matters. The core verb is invisible while it happens; accumulation is what makes a running cycle feel like it is working. Estimate: 1 session, assuming #575 has… (the rest: AB#746)

- [x] An active cycle shows tonnes this cycle, credits spent this cycle and t/h, updated on each mining:updated event.
- [x] The bar reflects elapsed fraction of the cycle and is correct after a reload.
- [x] Screenshot of an extractor panel 1 minute and 1 hour into a cycle at 1280x800 and 375x812 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-61 A scripted first-hour playtest in Playwright that saves screenshots (Requirement AB#747, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), release gate, first of three replacing ISP-23 (#587). What it is. A Playwright script that registers a fresh account against BASE_URL and plays the first hour (office, hire to five, lease, yard, cycle, sell to a standing order, queue research, accept a contract) at 1280x800 and 375x812, saving a screenshot per step, with a shortened clock in dev builds. Why it matters. Builder rule 4 and CLAUDE.md: unit tests certify rules, not the product. Every looked-at… (the rest: AB#747)

- [x] npx playwright test e2e/first-hour.spec.ts passes against a local build and writes one screenshot per step per viewport to e2e/screenshots/.
- [x] The script asserts on what the player sees (text and visible elements), not on internal state.
- [x] At 375x812 the script asserts no horizontal scroll on each screen (document.scrollingElement.scrollWidth <= innerWidth).
- [x] The run's screenshots are attached to the PR and the author states what they looked at.

### ISP-62 A one-page how-to-start for playtesters, linked from the landing page (Requirement AB#748, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), release gate, second of three replacing ISP-23 (#587). What it is. A single in-app page (/how-to-start) in the ISA voice: what the game is, the first hour in eight steps, how to report a bug, and what is not in this build. Why it matters. It is the artefact the Board hands out with the URL. Estimate: 1 session, assuming the walkthrough stories (ISP-5, 17, 18, 16) have landed so it describes the real first hour.

- [x] The page exists, is linked from the landing page and the login page, and needs no login.
- [x] Every step it names matches the walkthrough order and the build's figures (checked against ECONOMY.md).
- [x] Screenshot of /how-to-start at 1280x800 and 375x812 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-65 Security headers: helmet, a content security policy the app runs under, and an explicit CORS policy (Requirement AB#753, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), authentication review, replacing point 4 of ISP-24 (#590). What it is. Add helmet with a CSP: script-src 'self' and the Chart.js CDN origin (or Chart.js vendored), no 'unsafe-inline' for scripts, so inline event handlers in rendered HTML are converted to listeners; style-src may keep 'unsafe-inline' until ISP-26 removes inline styles, stated in the PR. CORS allows only the app's own origin. Why it matters. On a public origin, headers are the difference… (the rest: AB#753)

- [x] Response headers include Content-Security-Policy, X-Content-Type-Options, Referrer-Policy and frame-ancestors 'none'; a test asserts them.
- [x] The CSP has no 'unsafe-inline' or 'unsafe-eval' in script-src; every tab loads with zero CSP violations in the console (checked by opening each tab, stated in the PR).
- [x] A cross-origin request from another origin is refused by CORS (tested).
- [x] Screenshot of the browser console on the Overview and Exchange tabs showing no CSP violations at 1280x800 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-66 Validate registration fields on the server with copy that says what to fix (Requirement AB#755, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), authentication review, replacing point 5 of ISP-24 (#590), alongside #433 (corporation names). What it is. createAccount (server/gameState.js:2146) checks password length and duplicate email only. Add: email format and a 254-character limit, email lower-cased before the duplicate check, password 10 to 128 characters, ceoName 2 to 40 characters with the same character rules as corpName. Why it matters. Input validation at the boundary is the first line of… (the rest: AB#755)

- [x] Each rule rejects with a 400 and a message naming the field and the rule; the register page shows it beside the field.
- [x] Unit tests cover each rejection and the accepted boundary values.
- [x] Security: only email, password hash and names are stored; hostile values are rejected before hashing; the error never echoes the password.
- [x] Screenshot of the register page showing one field error at 375x812 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### Move login tokens out of localStorage: refresh token in an HttpOnly cookie, access token in memory (Requirement AB#757, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), authentication review, replacing points 2, 7 and 8 of ISP-24 (#590). The Board answered D-0.5-2 (AB#694): "Login tokens should live where they would normally live. Yes to email verification and password reset." Read as option B, the standard answer (OWASP Session Management and JWT cheat sheets). Email verification and password reset are separate new stories; the Board-only reset script (option C) is dropped because the Board chose reset by email. What it… (the rest: AB#757)

- [x] No token is written to localStorage or sessionStorage (git grep for isp.accessToken and isp.refreshToken returns nothing); a test asserts the refresh cookie's HttpOnly, Secure, SameSite=Strict and Path flags.
- [x] Reloading the page keeps the player logged in; logging out clears the cookie and revokes the refresh token server-side; a logout request without the cookie revokes nothing (test).
- [x] The socket accepts a connection whether or not it carries a valid access token: signed in with one, it gets the account's own events; signed out (no token, or an invalid or expired one), it gets the public-events-only view AB#756/ISP-67 defines, never a per-account event (test). Amended 2026-09-26 (AB#2143): the original line said 'refused without a valid access token', which contradicted AB#756/ISP-67's deliberate, QA-verified anonymous-read design; this line now matches the shipped behavior.
- [x] Security answer in the PR: what is stored where, what an injected script can and cannot read, what fails closed.
- [x] npm test is green on a fresh clone (no data/ directory), with the number of tests executed stated in the PR.

### ISP-69 One flat-direction mockup of the Station screen for the Board's yes or no (Requirement AB#758, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), design system (Board direction 2026-09-20), first of six replacing ISP-25 (#592). Rewritten 2026-09-25 to the Board's answer on Decision AB#1764: one mockup, not three. The visual-design Critique (AB#1757, POLISH 2.4/5) and AB#592 both point to the same direction, so the Board reviews one mockup and answers yes, or no with what is wrong. / What it is. One Station screen as a real HTML page with real copy and the existing station artwork, at 1280 and 375 wide,… (the rest: AB#758)

- [x] One self-contained HTML mockup exists under design/directions/flat/ in the product repo, at both widths.
- [x] It states its type system (Inter only, no Orbitron outside the logo mark), its palette with the WCAG ratios for body text and for each surface step computed and listed, and its references.
- [x] Screenshots at 1280x800 and 375x812 are attached and the mockup is shown to the Board as an artifact.
- [x] The PR files a Board Decision asking yes, or no with what is wrong, with the screenshots and the artifact link, linked from this item and from AB#1764. A no produces a second mockup aimed at the Board's note, not three new directions.

### ISP-70 Design tokens and type for the chosen direction, with contrast checked (Requirement AB#759, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), design system, second of six replacing ISP-25 (#592). What it is. CSS custom properties for colour (background, surface, raised, border, three text weights, accent, warn, danger, success, each with hover and pressed), a six-step type scale with one body face and at most one display face, a 4px spacing scale, radii, elevation, motion durations and easings, and z-index layers, in one token block at the top of styles.css. Why it matters. Tokens are what make a… (the rest: AB#759)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] The token block exists and is the only place colours, font sizes and spacing values are defined in new CSS.
- [x] Orbitron and Rajdhani are removed from the font imports.
- [x] Every text token against each surface token meets WCAG AA (4.5:1 body, 3:1 large), checked with a tool, ratios listed in the PR.
- [x] Screenshot of a token specimen page at /styleguide/tokens at 1280x800 and 375x812 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-71 Replace hard-coded colours, sizes and spacing in styles.css with tokens (Requirement AB#760, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), design system, third of six replacing ISP-25 (#592). What it is. public/styles.css is 5,386 lines with literal colours, sizes and spacing; move every one onto the tokens, removing the glow and 1px cyan borders the direction drops. Why it matters. Until the literals are gone, the tokens are decoration. Direction. The Board closed D-0.5-3 (AB#695) as prematurely opened: the choice is made on the Board Decision that ISP-69 (AB#758) files with the three mockups.… (the rest: AB#760)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] Outside the token block, git grep in styles.css for hex colours, rgb( and px font sizes returns nothing (a test runs the grep).
- [x] Every tab renders with no layout break compared with before (before and after screenshots of each tab at 1280x800 attached).

### ISP-72 Core components on a /styleguide page: buttons, inputs, cards, panels, tabs, badges, tooltips (Requirement AB#761, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), design system, fourth of six replacing ISP-25 (#592). What it is. Button (primary, secondary, ghost, danger; hover, focus, active, disabled, loading), input and select, card, panel with header, tabs, badge/pill and tooltip, each rendered in every state with real ISP copy on an in-app /styleguide page. Why it matters. The Board reviews the system before any screen is touched. Direction. The Board closed D-0.5-3 (AB#695) as prematurely opened: the choice is… (the rest: AB#761)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] Each listed component renders on /styleguide in every listed state.
- [x] Every interactive component has a visible focus ring by keyboard and a 44px touch target at 375px.
- [x] Screenshot of /styleguide at 1280x800 and 375x812 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-73 Data components on the styleguide: table-to-cards, toast, modal, progress and cycle, empty state, skeleton, KPI tile (Requirement AB#762, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), design system, fifth of six replacing ISP-25 (#592). What it is. A data table that becomes cards below 768px, toast, modal and confirmation (restyling v0.5-s31's component), progress bar and the cycle indicator, an empty state that says why it is empty and what to do (distinct from an error state), skeleton loading and the KPI tile. Why it matters. These are the pieces the screens are built from, and the empty-versus-error distinction is how #577 would have… (the rest: AB#762)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] Each listed component renders on /styleguide in every state, including the empty and error variants side by side.
- [x] The table shows as a table at 1280 and as cards at 375, with no horizontal scroll.
- [x] Screenshot of /styleguide data section at 1280x800 and 375x812 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-74 The app shell: sidebar on desktop, bottom navigation on phone, focus and reduced motion (Requirement AB#763, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), design system, sixth of six replacing ISP-25 (#592). What it is. A layout that is sidebar plus content at 1280 and bottom navigation plus full-width content at 375, decided by the layout rather than by the current fifteen media queries; visible focus throughout; prefers-reduced-motion respected. Why it matters. Mobile must never be a limitation (Board, 2026-09-20). Direction. The Board closed D-0.5-3 (AB#695) as prematurely opened: the choice is made on the… (the rest: AB#763)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] The shell is sidebar plus content at 1280 and bottom nav plus content at 375, verified by screenshots of both.
- [x] Keyboard focus is visible on every interactive element; prefers-reduced-motion disables non-essential motion (checked with the DevTools emulation, stated).
- [x] The old media queries that the shell replaces are deleted, with the count before and after in the PR.
- [x] Screenshot of the shell on the Overview tab at 1280x800 and 375x812 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-75 Group the navigation into Company, Station, Industry, Market, Comms and Map (Requirement AB#764, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), screens on the design system (Board direction 2026-09-20), one of nine replacing ISP-26 (#593). What it is. Rebuild the navigation: the fourteen tabs grouped as Company, Station, Industry, Market, Comms, Map, reachable from the bottom nav at 375 without scrolling the nav on the design system at 375, 768 and 1280 wide, with no legacy component or ad-hoc style left. Why it matters. Fourteen top-level tabs is too many for a bottom nav and for a first hour.… (the rest: AB#764)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] Every screen in scope (the navigation: the fourteen tabs grouped as Company, Station, Industry, Market, Comms, Map, reachable from the bottom nav at 375 without scrolling the nav) uses only design-system components and tokens; git grep for its old class names returns nothing.
- [x] No horizontal page scroll at any width, no text below 14px at 375, every control at least 44px at 375.
- [x] Every table in scope is cards below 768px.
- [x] The walkthrough reveals a group when it first becomes relevant, and a returning player sees all groups.
- [x] Screenshots of every screen in scope at 375x812, 768x1024 and 1280x800 attached to the PR, and the author states what they looked at in each (RUBRIC gate).

### ISP-76 Rebuild the landing, login and register pages (Requirement AB#765, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), screens on the design system (Board direction 2026-09-20), one of nine replacing ISP-26 (#593). What it is. Rebuild the landing, login and register pages on the design system at 375, 768 and 1280 wide, with no legacy component or ad-hoc style left. Why it matters. They are the first thing a stranger sees. Direction. The Board closed D-0.5-3 (AB#695) as prematurely opened: the choice is made on the Board Decision that ISP-69 (AB#758) files with the three… (the rest: AB#765)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] Every screen in scope (the landing, login and register pages) uses only design-system components and tokens; git grep for its old class names returns nothing.
- [x] No horizontal page scroll at any width, no text below 14px at 375, every control at least 44px at 375.
- [x] Every table in scope is cards below 768px.
- [x] Screenshots of every screen in scope at 375x812, 768x1024 and 1280x800 attached to the PR, and the author states what they looked at in each (RUBRIC gate).

### ISP-77 Rebuild Overview, Inbox and the Financial Core (Requirement AB#766, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), screens on the design system (Board direction 2026-09-20), one of nine replacing ISP-26 (#593). What it is. Rebuild Overview, Inbox and Financial Core (including the statements view from v0.5-s03) on the design system at 375, 768 and 1280 wide, with no legacy component or ad-hoc style left. Why it matters. They are the Company group, where every session starts. Direction. The Board closed D-0.5-3 (AB#695) as prematurely opened: the choice is made on the… (the rest: AB#766)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] Every screen in scope (Overview, Inbox and Financial Core (including the statements view from v0.5-s03)) uses only design-system components and tokens; git grep for its old class names returns nothing.
- [x] No horizontal page scroll at any width, no text below 14px at 375, every control at least 44px at 375.
- [x] Every table in scope is cards below 768px.
- [x] Screenshots of every screen in scope at 375x812, 768x1024 and 1280x800 attached to the PR, and the author states what they looked at in each (RUBRIC gate).

### ISP-78 Rebuild the Station and building views, with each station's artwork doing the work (Requirement AB#767, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), screens on the design system (Board direction 2026-09-20), one of nine replacing ISP-26 (#593). What it is. Rebuild the Station tab and its building views (Orbital Executive Suites, ISA Claims and Leases, extractor panel) on the design system at 375, 768 and 1280 wide, with no legacy component or ad-hoc style left. Why it matters. The first hour happens here, and the station artwork is the atmosphere the design leans on. Absorbs ISP-15 (#414). Direction. The… (the rest: AB#767)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] Every screen in scope (the Station tab and its building views (Orbital Executive Suites, ISA Claims and Leases, extractor panel)) uses only design-system components and tokens; git grep for its old class names returns nothing.
- [x] No horizontal page scroll at any width, no text below 14px at 375, every control at least 44px at 375.
- [x] Every table in scope is cards below 768px.
- [x] Each station's artwork is visible at full contrast behind or beside its views, and the station a player is in is identifiable from a screenshot alone (ISP-15's criterion).
- [x] Screenshots of every screen in scope at 375x812, 768x1024 and 1280x800 attached to the PR, and the author states what they looked at in each (RUBRIC gate).

### ISP-79 Rebuild Corporate R&D, CEO Insight, Refinery Chains, Assets and Logistics (Requirement AB#768, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), screens on the design system (Board direction 2026-09-20), one of nine replacing ISP-26 (#593). What it is. Rebuild Corporate R&D, CEO Insight, Refinery Chains, Assets and Logistics on the design system at 375, 768 and 1280 wide, with no legacy component or ad-hoc style left. Why it matters. The Industry group is the mid-game. Direction. The Board closed D-0.5-3 (AB#695) as prematurely opened: the choice is made on the Board Decision that ISP-69 (AB#758)… (the rest: AB#768)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] Every screen in scope (Corporate R&D, CEO Insight, Refinery Chains, Assets and Logistics) uses only design-system components and tokens; git grep for its old class names returns nothing.
- [x] No horizontal page scroll at any width, no text below 14px at 375, every control at least 44px at 375.
- [x] Every table in scope is cards below 768px.
- [x] Screenshots of every screen in scope at 375x812, 768x1024 and 1280x800 attached to the PR, and the author states what they looked at in each (RUBRIC gate).

### ISP-80 Rebuild the Galactic Exchange (Requirement AB#769, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), screens on the design system (Board direction 2026-09-20), one of nine replacing ISP-26 (#593). What it is. Rebuild the Galactic Exchange (order book, standing buy orders, my listings, trade history, price charts, filters) on the design system at 375, 768 and 1280 wide, with no legacy component or ad-hoc style left. Why it matters. The exchange is the game's core bet and its densest screen. Direction. The Board closed D-0.5-3 (AB#695) as prematurely opened:… (the rest: AB#769)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] Every screen in scope (the Galactic Exchange (order book, standing buy orders, my listings, trade history, price charts, filters)) uses only design-system components and tokens; git grep for its old class names returns nothing.
- [x] No horizontal page scroll at any width, no text below 14px at 375, every control at least 44px at 375.
- [x] Every table in scope is cards below 768px.
- [x] No scrollbar furniture shows on an empty table (from ISP-20).
- [x] Screenshots of every screen in scope at 375x812, 768x1024 and 1280x800 attached to the PR, and the author states what they looked at in each (RUBRIC gate).

### ISP-81 Rebuild Comms, Forums and Assignments (Requirement AB#770, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), screens on the design system (Board direction 2026-09-20), one of nine replacing ISP-26 (#593). What it is. Rebuild Comms, Forums and Assignments (all of chat, forums and player mail: the Board ruled on D-0.5-4, AB#696, that they ship to the playtest with no safety measures) on the design system at 375, 768 and 1280 wide, with no legacy component or ad-hoc style left. Why it matters. The Comms group and the contract loop. Direction. The Board closed D-0.5-3… (the rest: AB#770)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] Every screen in scope (Comms, including global and local chat and player mail, Forums and Assignments) uses only design-system components and tokens; git grep for its old class names returns nothing.
- [x] No horizontal page scroll at any width, no text below 14px at 375, every control at least 44px at 375.
- [x] Every table in scope is cards below 768px.
- [x] Screenshots of every screen in scope at 375x812, 768x1024 and 1280x800 attached to the PR, and the author states what they looked at in each (RUBRIC gate).

### ISP-82 Rebuild the Starmap, the walkthrough surface and the dialogue (Requirement AB#771, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), screens on the design system (Board direction 2026-09-20), one of nine replacing ISP-26 (#593). What it is. Rebuild the Starmap, the walkthrough overlay and the dialogue (with Elara Voss's portrait) on the design system at 375, 768 and 1280 wide, with no legacy component or ad-hoc style left. Why it matters. They carry the opening and the sense of scale. Direction. The Board closed D-0.5-3 (AB#695) as prematurely opened: the choice is made on the Board… (the rest: AB#771)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] Every screen in scope (the Starmap, the walkthrough overlay and the dialogue (with Elara Voss's portrait)) uses only design-system components and tokens; git grep for its old class names returns nothing.
- [x] No horizontal page scroll at any width, no text below 14px at 375, every control at least 44px at 375.
- [x] Every table in scope is cards below 768px.
- [x] Screenshots of every screen in scope at 375x812, 768x1024 and 1280x800 attached to the PR, and the author states what they looked at in each (RUBRIC gate).

### ISP-83 Accessibility score and a three-width sweep of every screen (Requirement AB#772, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), screens on the design system, last of nine replacing ISP-26 (#593). What it is. Run Lighthouse accessibility on the main app view and the landing page, fix what it finds, and run the Playwright harness (v0.5-s35) at 375, 768 and 1280 over every screen. Why it matters. It is the check that the nine screen stories add up to one product. Direction. The Board closed D-0.5-3 (AB#695) as prematurely opened: the choice is made on the Board Decision that ISP-69… (the rest: AB#772)

- [x] The work applies the direction the Board chose on that Decision (the Board Decision filed by ISP-69, AB#758, presenting the three directions with screenshots); the PR names the chosen direction and links the Decision.
- [x] Lighthouse accessibility is 90 or above on the main app view and the landing page, numbers in the PR.
- [x] No screen has horizontal scroll at any of the three widths (asserted by the harness).
- [x] Screenshots of every screen at all three widths attached, and the author states what they looked at.

### ISP-84 Write ISP's first probe: ladder reachability, content runway and the sink curve (Requirement AB#773, Resolved, not verified)

What: Where it sits. Depth Critique #426 epic 4, merged with Monetization Critique #434 epic 4. hq/ops/probes holds only relic-vault-runway.ts. What it is. hq/ops/probes/isp-runway.ts: a headless planner bot and a greedy bot that drive ISP in-process (ISP_DISABLE_TICKERS, a fake clock, the real route handlers through supertest or the exported rules) for 30 simulated days, printing the highest corporation level reached, the day each research and insight queue empties, and credits banked versus spent… (the rest: AB#773)

- [x] The probe runs with one command documented in its header and prints the three numbers for both bots, deterministic for a given seed.
- [x] Every output line says it is a bot number and states the bot's assumed pace.
- [x] On main before #424 is fixed it reports level 5 as the highest reachable, matching the bug (a check that the probe measures the real thing).
- [x] The nightly probe job picks it up (or the PR says why not), and review #2 can quote its raw output.

### ISP-85 Add decision density and the greedy-versus-planner gap to the ISP probe (Requirement AB#774, Resolved, not verified)

What: Where it sits. Depth Critique #426 epic 4 (second half). What it is. Extend the probe with the Depth RUBRIC's decision density (the share of extractor-start decisions where at least two settings are non-equivalent) and the credit gap between the greedy and planner bots at day 7. Why it matters. It is the measurement the extractor trade-off (v0.5-c03) is judged by. Estimate: 1 session, assuming v0.5-c01 has landed.

- [x] The probe prints decision density for extractor starts and the day-7 greedy/planner credit gap, labelled as bot numbers.
- [x] On main today it reports decision density near 0 for throughput (max is always optimal, T-018), confirming it measures the known problem.

### ISP-86 Give extractor throughput an interior optimum (Requirement AB#775, Resolved, not verified)

What: Where it sits. Depth Critique #426 epic 2; T-018. What it is. Revenue is 24 x T x 0.92 an hour and operating cost 16 x T, both linear in the throughput T the player sets, so 250 t/h is always right. Make the operating cost superlinear in T (for example cost = base x T x (1 + (T / T_ref)^2), constants in data/economy.json) so the best throughput depends on the body, the research owned and the price, and write the optimum into ECONOMY.md. Why it matters. The core verb currently contains no… (the rest: AB#775)

- [x] The cost function is one exported function reading data/economy.json; ECONOMY.md shows the profit curve and its maximum for Earth silicates at the current price.
- [x] Probe target (bot numbers): decision density for extractor starts is at least 40%, and the greedy bot (always max) ends day 7 at least 15% behind the planner.
- [x] The extractor panel shows the projected hourly profit for the chosen throughput before the player starts the cycle, so the curve is visible, not hidden.
- [x] The cost is a tax on rate, never on access: every throughput from 10 to 250 stays startable.
- [x] Screenshot of the extractor start form at two throughputs showing different projected profit at 1280x800 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-87 Make the NPC standing bid a floor that drifts with volume, and stop the price helper pinning to it (Requirement AB#777, Resolved, not verified)

What: Where it sits. Depth Critique #426 epic 3, with the Monetization Critique's note on the suggested-price helper (public/scripts/app.js:920 to 964). What it is. The silicate standing bid is a fixed 24 credits with 1,000,000 units a day of depth (server/gameState.js:1488), which no player reaches, so the rational play is never to trade with another player. Shrink the daily quota to a level a real corporation reaches, let the bid fall with volume sold that day and recover overnight, never below a… (the rest: AB#777)

- [x] Quota, drift rate, recovery and floor live in data/economy.json; the bid for a given volume sold is one tested pure function; the bid never goes below the floor (tested at extreme volume).
- [x] The standing-buy table shows the current bid and today's remaining quota.
- [x] The suggested-price helper suggests from recent trades (v0.5-s04) and can suggest below the NPC bid; a test covers a glutted market.
- [x] Probe target (bot numbers, two bot corporations): at least 25% of filled volume is player-to-player over 7 days, and the silicate clearing price moves by at least 10% between a low-supply and a high-supply week.
- [x] Security: the bid is computed on the server; a hostile seller dumping volume only lowers the bid to the floor, so a new player is never stranded.
- [x] Screenshot of the standing buy orders with a drifted bid and remaining quota at 1280x800 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-88 Design the credit sinks that scale with income past the first session (Requirement AB#778, Resolved, not verified)

What: Where it sits. Monetization Critique #434 epic 2 (the sink half; the ladder half is #424). What it is. Credits pile up after about minute 120 with nothing to want: about 13 sinks, all one-off except payroll and office rent. Write a design in ECONOMY.md for sinks that scale with income (recurring facility upkeep, tiered leases, a capital cost that rises with corporation size), with the numbers the probe will check, and file one implementation story per sink under TRACKING.md. Why it matters.… (the rest: AB#778)

- [x] ECONOMY.md has a sinks section: each proposed sink, its formula, what it scales with, and the banked/spent ratio the probe should show after it lands (target below 3x at day 3, 7 and 30, bot numbers).
- [x] Every sink degrades output when unpaid and never locks a player out of the game (the Critique's charter check), stated per sink.
- [x] Prior art cited: faucet-and-sink design from MMO economics (for example the Game Developer article cited in #434).
- [x] One implementation story per sink is filed with description, acceptance and estimate, linked here.

### ISP-89 A test that fails if payment code appears in ISP before 1.0 (Requirement AB#779, Resolved, not verified)

What: Where it sits. Monetization Critique #434 epic 3 (the test half; the brief paragraph is v0.5-c07). What it is. BRIEF.md says "none before 1.0"; nothing enforces it. Add a Vitest test that fails if payment or pricing vocabulary appears in server/ or public/ (stripe, paypal, paddle, checkout, iap, in-app, subscription, loot box, gacha, real-money currency formatting other than the credits formatter at public/scripts/app.js:537). Why it matters. P-WIRED-NOTHING: a promise in prose is kept by… (the rest: AB#779)

- [x] The test passes on main and fails on a seeded commit that adds import Stripe from "stripe" (shown in the PR by running it against a temporary change, not committed).
- [x] Its allowlist names each benign match with the reason (the credits formatter, the word "premium" in flavour text).
- [x] npm test is green on a fresh clone (no data/ directory), with the number of tests executed stated in the PR.

### ISP-90 Write the monetization constraint into ISP's brief as the Board worded it (Requirement AB#780, Resolved, not verified)

What: Where it sits. Monetization Critique #434 epic 3 (the brief half). The Board closed D-0.5-7 (AB#699) with "I don't know what this means"; it is re-asked in plain words as D-reask-699, and this story waits on that. What it is. Once the re-asked Decision is answered, write the Board's answer into BRIEF.md's Monetization section. If the Board chooses A, name ceo-negotiation-fundamentals (data/ceo-insight.json) as never sold or sped up for real money, and record the 8% GEX sales tax as the house… (the rest: AB#780)

- [x] BRIEF.md's Monetization section states the Board's answer in the Board's words and cites the re-asked Decision's id.
- [x] If the answer names the node: a comment beside the ceo-negotiation-fundamentals loader (JSON has no comments) points to the constraint. If it does not, the PR says so and adds nothing to code.

### Open registration on the beta to anyone, behind one switch the Board can close (Requirement AB#781, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389); from ISP-11's "a stated way in" and D-0.5-5 (AB#697), which the Board answered "Once beta, anybody should be able to register." What it is. Invite codes are dropped. Assumption, stated because the answer leaves it open: the deployed v0.5 build is the beta, so registration is open to anyone. One environment switch (REGISTRATION_OPEN, default open in the beta deployment) lets the Board close registration without a code change. Abuse is handled by the login and… (the rest: AB#781)

- [x] Registration with a valid email, password and names works with no invitation code (test); any invite-code field and code path is removed.
- [x] With REGISTRATION_OPEN=false, POST /api/auth/register returns 403 "Registration is closed for now." and creates nothing (test); an unparseable value is treated as closed and logged once (fails closed).
- [x] RUNBOOK.md says how the Board flips the switch and whether a restart is needed.
- [x] Security answer: no new data is stored; hostile input is rate-limited (AB#752) and validated (email shape, password length, name lengths, each with a test); the switch fails closed.
- [x] Screenshot of the register page open, and of the closed message, at 375x812 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### ISP-280 Verify email addresses at registration, through one mail module with a test transport (Requirement AB#987, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), authentication review. The Board answered D-0.5-2 (AB#694) "Yes to email verification and password reset"; public/scripts/register-page.js:10 had a TODO for it. / What it is (slice 1 of 2, re-scoped 2026-09-26 to match what merged in PR !697). A server mail module with one interface and a test transport that captures messages to an in-memory outbox for tests and local development and refuses to load under NODE_ENV=production; verification tokens (32 random… (the rest: AB#987)

- [x] A server mail module with one interface and a test transport captures messages to an in-memory outbox for tests and local development, and refuses to load under NODE_ENV=production (tests).
- [x] Tokens are 32 random bytes, stored only as a hash, single-use and expiring after 24 hours; the verify endpoint accepts a valid one and a reused or expired token verifies nothing (tests).
- [x] Resend is rate-limited and answers identically whether or not the address exists (no account enumeration, test).
- [x] Security answer: the email address is never logged; links are built from a configured base URL, never the Host header; the verify and resend endpoints fail closed with no real transport configured (test). Registration itself is not yet wired to this module - that is ISP-305 - so registration's own production behavior is not this item's claim.
- [x] Screenshot of the "check your email" page and the verified landing at 375x812 and 1280x800 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3).

### ISP-281 Reset a forgotten password by email (Requirement AB#988, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), authentication review, the second half of the Board's "Yes to email verification and password reset" (D-0.5-2, AB#694). What it is. A "forgot password" link on the login page, a request form, an emailed single-use reset link through the mail module, a set-new-password page, and revocation of every refresh token for the account when the password changes, with an email telling the owner it changed. Why it matters. Without it, a player who forgets a password… (the rest: AB#988)

- [x] The request answers identically whether or not the address exists, and is rate-limited per address and per client (tests).
- [x] The reset token is random, stored hashed, single-use and expires after one hour; a used or expired token changes nothing (tests).
- [x] A successful reset enforces the password rules, revokes every refresh token for the account (a previously issued refresh token then fails, test) and sends a "your password was changed" message.
- [x] Security answer in the PR: data stored, hostile inputs tried, what fails closed.
- [x] Screenshot of the forgot-password and set-new-password pages at 375x812 and 1280x800 attached to the pull request, and the author states what they looked at in it (DOCTRINE constraint 3; a unit test is not looking).

### Two extractor errors tell the player to upgrade a lease tier or the headquarters, which the game cannot do (Bug AB#1057, Resolved, not verified)

What: Symptom. Building a third extractor on a two-slot lease returns 'This lease has used all 2/2 building slots. Upgrade your lease tier or acquire an additional claim to expand capacity.' Running out of corporation slots returns 'No corporation building slots available... Upgrade your headquarters or release an existing building.' No route, button or research upgrades a lease tier, upgrades the headquarters or releases a building (grep of server/ and public/scripts/). / Repro. Fresh account: office,… (the rest: AB#1057)
Symptom: Building a third extractor on a two-slot lease returns 'This lease has used all 2/2 building slots. Upgrade your lease tier or acquire an additional claim to expand capacity.' Running out of corporation slots returns 'No corporation building slots available... Upgrade your headquarters or release an existing building.' No route, button or research upgrades a lease tier, upgrades the headquarters or releases a building (grep of server/ and public/scripts/).
Repro: Fresh account: office, 5 hires, Earth lease, commission two Basic Extractor Yards on it, then a third: lease-slots-full. server/index.js:1655-1656.
Proposed fix: Confidence: high. Rewrite both strings in server/index.js:1655-1656 to real actions: lease-slots-full -> 'This lease has used both of its building slots. File a lease on another body from the station that orbits it (Mars from Mars Orbital Dock, Luna from Luna Gateway).'; no-corp-slot -> 'All N of your corporation building slots are in use. Corporation levels add slots (see Overview milestones).' Add a test that the messages name no verb absent from the routes. Confidence high.

- [x] Fixed: Two extractor errors tell the player to upgrade a lease tier or the headquarters, which the game cannot do

### Gameplay error messages say what failed but not what to do: employee cap, mining credits, mission quota (Bug AB#1058, Resolved, not verified)

What: Symptom. 'Employee cap reached. Current staffing is 20/20.' (seen in play) does not say the cap rises with corporation level. 'Insufficient credits to start the mining cycle. Check your finances.' does not say how much is needed. 'Insufficient resources at this station.' on completing a mission does not say which item, how many, or which station. / Repro. Fresh account with an office: hire 20, then hire 1 (Workforce panel shows the cap message). start-mining with credits below the cycle cost.… (the rest: AB#1058)
Symptom: 'Employee cap reached. Current staffing is 20/20.' (seen in play) does not say the cap rises with corporation level. 'Insufficient credits to start the mining cycle. Check your finances.' does not say how much is needed. 'Insufficient resources at this station.' on completing a mission does not say which item, how many, or which station.
Repro: Fresh account with an office: hire 20, then hire 1 (Workforce panel shows the cap message). start-mining with credits below the cycle cost. complete-mission for a quota mission with too little at the current station.
Proposed fix: Confidence: high. hire: append 'Reaching Corporation Level N raises the cap to X.' from the next milestones.json level's employeeCap; start-mining: use fundingRequirementMessage with the computed cycle cost; complete-mission: 'Deliver 400 Silicates at Earth Station Prime (you have 120 here).' from the mission quota. Unit or route tests assert each message contains the number. Confidence high.

- [x] Fixed: Gameplay error messages say what failed but not what to do: employee cap, mining credits, mission quota

### Register and login errors do not tell a new player what to do, and login steers them to the shared demo account (Bug AB#1059, Resolved, not verified)

What: Symptom. Register with an existing email: 'An account with this email already exists.' with no pointer to Log In. Login with a wrong password: 'Invalid credentials. Use the dummy account button for temporary access.' which sends a real player to a shared sandbox instead of telling them to check the email and password or register. Server failures show 'Registration failed.' / 'Login failed.' with no next step. The login page intro also tells players about a 'prototype command gateway' and a… (the rest: AB#1059)
Symptom: Register with an existing email: 'An account with this email already exists.' with no pointer to Log In. Login with a wrong password: 'Invalid credentials. Use the dummy account button for temporary access.' which sends a real player to a shared sandbox instead of telling them to check the email and password or register. Server failures show 'Registration failed.' / 'Login failed.' with no next step. The login page intro also tells players about a 'prototype command gateway' and a dummy account… (the rest: AB#1059)
Repro: register.html with an existing email; login.html with a wrong password.
Proposed fix: Confidence: high. Duplicate email: 'An account with this email already exists. Log in instead.' with a link to /login.html; invalid login: 'That email and password do not match. Check them, or register a new corporation.'; 500s: '... Try again in a minute.'; remove the prototype/dummy wording from login.html's intro. Whether the dummy button should exist in production is a separate Board decision, not this fix. Confidence high for the copy.

- [x] Fixed: Register and login errors do not tell a new player what to do, and login steers them to the shared demo account

### Empty states on the Exchange, Inbox and Claims blame a filter or state a fact instead of naming the next action (Bug AB#1060, Resolved, not verified)

What: Symptom. Galactic Exchange: 'No sell orders match the current filter.' and 'No standing buy orders match the current filter.' while the filter is All (first boot has no orders at all, #574); 'You have no items in inventory to list.' does not say how to get items. Inbox sub-tabs: 'No messages here.' ISA Claims with no office: 'Submit a lease application below to begin.' directly above 'A registered corporate office is required...'; after the one local lease: 'All extraction zones available from… (the rest: AB#1060)
Symptom: Galactic Exchange: 'No sell orders match the current filter.' and 'No standing buy orders match the current filter.' while the filter is All (first boot has no orders at all, #574); 'You have no items in inventory to list.' does not say how to get items. Inbox sub-tabs: 'No messages here.' ISA Claims with no office: 'Submit a lease application below to begin.' directly above 'A registered corporate office is required...'; after the one local lease: 'All extraction zones available from this… (the rest: AB#1060)
Repro: Fresh account: Galactic Exchange (first and second boot); Inbox > Players; Station > ISA Claims & Leases before and after filing the Earth lease.
Proposed fix: Confidence: high. Exchange: when the filter is All, say 'No player has listed anything yet.' / 'No standing orders today.'; inventory: 'Mine silicates on a lease (Station > ISA Claims & Leases) to have something to list.' Inbox: per folder, e.g. 'No player mail yet. Compose to write to another corporation.' Claims: drop 'Submit a lease application below to begin' while no office exists; after leasing: 'Other bodies are leased from the station that orbits them: Mars from Mars Orbital Dock, Luna… (the rest: AB#1060)

- [x] Fixed: Empty states on the Exchange, Inbox and Claims blame a filter or state a fact instead of naming the next action

### The walkthrough card and the element it highlights overlap: hidden behind the card at 1280x800, drawn over her text at 375x812 (Bug AB#1083, Resolved, not verified)

What: Symptom. At 1280x800, steps that highlight a station office (Staff, A mining claim, Equipment, Your first cycle) scroll the target to the centre of the screen, directly behind the centred briefing card, so the player cannot see what the step points at. At 375x812 the highlighted element (for example the Station tab on step 3) is drawn on top of the briefing card and covers words of the text. / Repro. Local build of the AB#579 branch (walkthrough.js on !144), a fresh account, 1280x800: Brief me,… (the rest: AB#1083)
Symptom: At 1280x800, steps that highlight a station office (Staff, A mining claim, Equipment, Your first cycle) scroll the target to the centre of the screen, directly behind the centred briefing card, so the player cannot see what the step points at. At 375x812 the highlighted element (for example the Station tab on step 3) is drawn on top of the briefing card and covers words of the text.
Repro: Local build of the AB#579 branch (walkthrough.js on !144), a fresh account, 1280x800: Brief me, Next to step 5 (Staff): the Orbital Executive Suites Enter button is behind the card. At 375x812: step 3 (Earth Station Prime): the Station tab button sits over the card's text.
Proposed fix: Confidence: medium. Stop centring the card over the target: position the walkthrough card at the bottom of the viewport (align-items: end on the walkthrough backdrop, a max-height with scroll) and scroll the target into the upper half (scrollIntoView({ block: 'start' }) with a top margin), so they never share the centre; keep the target's z-index above the dimmed backdrop but below the card. Check by screenshot at 1280x800 and 375x812 for every step that highlights a station office. This… (the rest: AB#1083)

- [x] Fixed: The walkthrough card and the element it highlights overlap: hidden behind the card at 1280x800, drawn over her text at 375x812

### Order-book test 'keeps every order past 200' hit vitest's 5s timeout once under load, and five tests after it in the file failed (Bug AB#1092, Resolved, not verified)

What: Symptom. In one full-suite run of a scratch tree merging main b45dbf3 with every open ISP PR plus fix/575, tests/integration/order-book.test.js (from !154, AB#425) failed 6 tests: 'keeps every order past 200, and every seller's goods are either in stock or listed' took 5010ms (vitest's default 5000ms timeout), then five 'player sell order refuses quantity ...' tests failed. The same file passed 20/20 run alone on that tree, and the full suite passed 442/442 on a rerun; the tree without fix/575… (the rest: AB#1092)
Symptom: In one full-suite run of a scratch tree merging main b45dbf3 with every open ISP PR plus fix/575, tests/integration/order-book.test.js (from !154, AB#425) failed 6 tests: 'keeps every order past 200, and every seller's goods are either in stock or listed' took 5010ms (vitest's default 5000ms timeout), then five 'player sell order refuses quantity ...' tests failed. The same file passed 20/20 run alone on that tree, and the full suite passed 442/442 on a rerun; the tree without fix/575 passed… (the rest: AB#1092)
Repro: Merge every open ISP PR into one tree, npm ci, run npm test while the machine is busy. Intermittent; seen once in three full runs.
Proposed fix: Confidence: medium. In tests/integration/order-book.test.js, give the 200-order test an explicit timeout sized to the work (it(..., 20_000)) or reduce the order count to the smallest number that still crosses the 200 boundary, and make each later test set up its own order book in beforeEach so one timed-out test cannot fail the rest. Then run the file under load (npm test with a second suite running) three times. Confidence medium: the timeout is measured; the cascade cause is inferred from the… (the rest: AB#1092)

- [x] Fixed: Order-book test 'keeps every order past 200' hit vitest's 5s timeout once under load, and five tests after it in the file failed

### Payroll is never charged: hiring adds $150 a day to dailyCosts, and nothing ever deducts it (Bug AB#1097, Resolved, not verified)

What: Symptom. DESIGN_DOCUMENT.md and .github/custom-instructions.md set payroll at $150 a day per employee, and the hire route adds hired * 150 to finances.dailyCosts (server/index.js, the hire handler). No code ever deducts dailyCosts from credits or books it with recordExpense. A corporation with 200 employees pays nothing after the one-time $2,000 hire fee. The Financial Core still projects 7 days of this rate as a liability ('Forward Operating (7d)'), and until Bug #1022 it was the whole cost… (the rest: AB#1097)
Symptom: DESIGN_DOCUMENT.md and .github/custom-instructions.md set payroll at $150 a day per employee, and the hire route adds hired * 150 to finances.dailyCosts (server/index.js, the hire handler). No code ever deducts dailyCosts from credits or books it with recordExpense. A corporation with 200 employees pays nothing after the one-time $2,000 hire fee. The Financial Core still projects 7 days of this rate as a liability ('Forward Operating (7d)'), and until Bug #1022 it was the whole cost side of Net… (the rest: AB#1097)
Repro: ISP main b45dbf3. Hire 10 employees: dailyCosts becomes 1,500. Let a day pass, or grep: dailyCosts has writers only in the hire handler and the defaults in server/gameState.js and public/scripts/app.js, and no reader deducts it. Credits do not fall by 1,500 a day, and expensesByCategory has no payroll entry.
Proposed fix: Confidence: medium. Charge payroll continuously in the existing mining/operations tick. Deduct employeeCount * 150 * elapsedDays from credits and book it with recordExpense(corp, 'payroll', amount), so it reaches Net Daily Flow and the P&L through the path Bug #1022 built. Decide what happens when credits cannot cover it: the extractor pattern scales output by affordability, but payroll has no output, so the options are to floor credits at 0 and accrue arrears as a liability, or to let… (the rest: AB#1097)

- [x] Fixed: Payroll is never charged: hiring adds $150 a day to dailyCosts, and nothing ever deducts it

### Two gameplay routes nothing in the game calls still work and skip the core loop: a corporation with no office, staff or lease builds an extractor yard and runs a 250 t/h cycle (Bug AB#1121, Resolved, not verified)

What: Symptom. POST /api/accounts/:id/gameplay/build-extractor builds a Basic Extractor Yard for $50,000 on a brand-new corporation with no office, no employees and no mining lease; the yard belongs to no lease. POST /api/accounts/:id/gameplay/mine then starts a 250 t/h, 72-hour cycle on it with no office check. The lease-based routes the game uses (lease/:leaseId/build-extractor and lease/:leaseId/start-mining) refuse all of this. Any player with their own access token can skip office, staffing and… (the rest: AB#1121)
Symptom: POST /api/accounts/:id/gameplay/build-extractor builds a Basic Extractor Yard for $50,000 on a brand-new corporation with no office, no employees and no mining lease; the yard belongs to no lease. POST /api/accounts/:id/gameplay/mine then starts a 250 t/h, 72-hour cycle on it with no office check. The lease-based routes the game uses (lease/:leaseId/build-extractor and lease/:leaseId/start-mining) refuse all of this. Any player with their own access token can skip office, staffing and claim.
Repro: Local production-mode build of main b45dbf3 (NODE_ENV=production, fresh data dir). Register a fresh account (POST /api/auth/register) and, with its access token: 1. POST /api/accounts/<id>/gameplay/build-extractor with {}: 200, credits -50,000, buildings [Headquarters, Basic Extractor Yard], extractor leaseId none. 2. POST /api/accounts/<id>/gameplay/mine with {amount: 250, hours: 72}: 200, extractor active at 250 t/h. Compare: POST .../gameplay/lease/<id>/start-mining with an expired office… (the rest: AB#1121)
Proposed fix: Confidence: high. Delete POST /gameplay/build-extractor and POST /gameplay/mine from server/index.js, delete bindLevel2Controls and runLevel2Action from app.js, and drop unlocks.maxBasicExtractorYards, which only they read. Add a test that both paths return 404. AB#731 (hostile input on every gameplay route) already deletes the similar legacy POST /gameplay/complete-rnd and could take these in the same pass. Confidence high: no client caller, and the replacements cover both actions.

- [x] Fixed: Two gameplay routes nothing in the game calls still work and skip the core loop: a corporation with no office, staff or lease builds an extractor yard and runs a 250 t/h cycle

### A blank or unreadable number on the core-loop forms is replaced by a default and the action goes through and is charged: a blank Head Count hires one employee for $2,000 (Bug AB#1122, Resolved, not verified)

What: Symptom. In the Orbital Executive Suites, clearing Head Count and pressing Hire Personnel hires one employee and charges $2,000. On a mining lease, clearing Throughput and pressing Start Cycle starts a 40 t/h, 24-hour cycle and charges $500. The API does the same for every unparseable value. Hire count '', 'abc', -5, 0, 1.5, [3], {n:3} or a 400-digit string hires one employee for $2,000. For start-mining, amount '' / 'abc' / 400 digits runs 40 t/h, and -5 or 0 runs 10 t/h; hours '' or 'abc'… (the rest: AB#1122)
Symptom: In the Orbital Executive Suites, clearing Head Count and pressing Hire Personnel hires one employee and charges $2,000. On a mining lease, clearing Throughput and pressing Start Cycle starts a 40 t/h, 24-hour cycle and charges $500. The API does the same for every unparseable value. Hire count '', 'abc', -5, 0, 1.5, [3], {n:3} or a 400-digit string hires one employee for $2,000. For start-mining, amount '' / 'abc' / 400 digits runs 40 t/h, and -5 or 0 runs 10 t/h; hours '' or 'abc' runs 24 h,… (the rest: AB#1122)
Repro: Local production-mode build of main b45dbf3, fresh account on the demo login, 1280x800. 1. Station, Orbital Executive Suites, Execute Lease Agreement. 2. Workforce: select Head Count, delete it, press Hire Personnel: Staffing 0/8 becomes 1/8 and credits fall by 2,000. Typing 'abc' into the number field leaves it blank and does the same. 3. With a lease and a yard: Manage Lease, clear Throughput, Start Cycle: an ACTIVE 40 t/h cycle, $500 charged. API: POST .../gameplay/hire {count:'abc'} and the… (the rest: AB#1122)
Proposed fix: Confidence: high. Reject, do not substitute. This is AB#731's acceptance (one validator; 400 with unchanged state for 'abc', NaN, Infinity, -5, 0, 2.5, missing and 10,000-character values on every gameplay route), so fix it there and close this Bug with that PR. Also have the forms refuse to submit a blank field (the required attribute), and quote at most 60 characters of an unknown id in an error. Confidence high: AB#731's test table covers every case here.

- [x] Fixed: A blank or unreadable number on the core-loop forms is replaced by a default and the action goes through and is charged: a blank Head Count hires one employee for $2,000

### Chat has no length limit on the server, and deletes anything a player types between < and > (Bug AB#1127, Resolved, not verified)

What: Symptom. Two defects in the chat:send socket handler (server/index.js). First, a chat line has no length limit on the server. The 300-character limit exists only as the input box's maxlength, so any socket client can store a line of any size in the shared chat log, which every client downloads in /api/bootstrap. Second, every line goes through stripHtml, which deletes anything between '<' and '>' and collapses whitespace: 'buying 10 < price < 30, selling > 50' arrives as 'buying 10 50'. The… (the rest: AB#1127)
Symptom: Two defects in the chat:send socket handler (server/index.js). First, a chat line has no length limit on the server. The 300-character limit exists only as the input box's maxlength, so any socket client can store a line of any size in the shared chat log, which every client downloads in /api/bootstrap. Second, every line goes through stripHtml, which deletes anything between '<' and '>' and collapses whitespace: 'buying 10 < price < 30, selling > 50' arrives as 'buying 10 50'. The client… (the rest: AB#1127)
Repro: ISP main b45dbf3. Connect a logged-in socket and emit chat:send { channel: 'global', content: 'x'.repeat(1000000) }: it is stored and broadcast. Emit { content: 'buying 10 < price < 30, selling > 50' }: every client receives 'buying 10 50'.
Proposed fix: Confidence: high. In chat:send, keep the content as sent (trimmed) and drop a line longer than 300 characters, the input box's own limit, the way the handler already drops a line with no content: nothing is stored or broadcast. Keep stripping the author (corporation names cannot contain < or > since Bug #433 anyway). Test: a 301-character line is neither stored nor received; 'a < b > c' arrives exactly as sent; '<script>' arrives as sent and renders inert through the chat line template.

- [x] Fixed: Chat has no length limit on the server, and deletes anything a player types between < and >

### Forum threads, replies and likes publish players' account ids to anyone, including sockets with no login (Bug AB#1134, Resolved, not verified)

What: Symptom. Every forum thread and reply carries authorAccountId, and every liked post carries likedBy, a list of account ids. The forums are sent to every socket in state:init and forums:updated, including sockets with no login, and to anyone through GET /api/bootstrap. So anyone can read the internal account id of every player who has posted or liked, and which posts each one liked. Mail was changed so that account ids never leave the server (Bug #711); the forums still publish them. Filed as… (the rest: AB#1134)
Symptom: Every forum thread and reply carries authorAccountId, and every liked post carries likedBy, a list of account ids. The forums are sent to every socket in state:init and forums:updated, including sockets with no login, and to anyone through GET /api/bootstrap. So anyone can read the internal account id of every player who has posted or liked, and which posts each one liked. Mail was changed so that account ids never leave the server (Bug #711); the forums still publish them. Filed as severity 1… (the rest: AB#1134)
Repro: Post a forum thread and like a reply from one account. Connect a socket with no token, or GET /api/bootstrap with no login: forums.threads[].authorAccountId, replies[].authorAccountId and likedBy[] hold account ids.
Proposed fix: Confidence: medium. Publish a forum view, not the stored state: replace authorAccountId with the author corporation's publicId, and replace likedBy with a like count, plus likedByMe per viewer where the response is per account (the like route's answer). Keep the account ids on the server for one-like-per-account. Apply it in state:init, forums:updated, /api/bootstrap and the forum routes' responses. Test: no forum payload any client receives contains an account id. Look: likes and 'Liked' still… (the rest: AB#1134)

- [x] Fixed: Forum threads, replies and likes publish players' account ids to anyone, including sockets with no login

### Chat does not follow the conversation: a new line arrives out of view, and switching channel shows the oldest lines (Bug AB#1135, Resolved, not verified)

What: Symptom. With the Global log scrolled to the newest line, a line from another player is added below the visible area, so the player does not see it. Switching channel (Trade, then Global) opens the log at the top, on the oldest of up to 120 lines, not the newest. / Repro. Comms with a long Global log, scrolled to the bottom: another player posts; the log's scrollTop stays where it was while its height grows (4452 of 4512 in the sweep). Click Trade, then Global: scrollTop is 0. / System info.… (the rest: AB#1135)
Symptom: With the Global log scrolled to the newest line, a line from another player is added below the visible area, so the player does not see it. Switching channel (Trade, then Global) opens the log at the top, on the oldest of up to 120 lines, not the newest.
Repro: Comms with a long Global log, scrolled to the bottom: another player posts; the log's scrollTop stays where it was while its height grows (4452 of 4512 in the sweep). Click Trade, then Global: scrollTop is 0.
Proposed fix: Confidence: high. In renderChatLog, record whether the log was at (or within a line of) the bottom before replacing it and keep it there afterwards; on a channel switch, scroll to the bottom. Test: a pure helper decides whether to stick to the bottom from the scroll values. Look: lines from another player come into view, and a switched channel shows its newest line.

- [x] Fixed: Chat does not follow the conversation: a new line arrives out of view, and switching channel shows the oldest lines

### Opening a mail does not lower the Inbox unread count until the page is reloaded (Bug AB#1136, Resolved, not verified)

What: Symptom. Opening an unread mail marks it read on the server, but the subtab badge (for example 'System & NPC (1)') still counts it after going back to the list. It drops only after a reload. / Repro. Fresh account: Inbox shows 'System & NPC (1)'. Open the settlement licence, click Back: still (1). The server's readAt is set. Reload: the badge is gone. / System info. interstellar-settlement-protocol main b45dbf3, run with NODE_ENV=production and a fresh data directory; Edge 1280x800 through… (the rest: AB#1136)
Symptom: Opening an unread mail marks it read on the server, but the subtab badge (for example 'System & NPC (1)') still counts it after going back to the list. It drops only after a reload.
Repro: Fresh account: Inbox shows 'System & NPC (1)'. Open the settlement licence, click Back: still (1). The server's readAt is set. Reload: the badge is gone.
Proposed fix: Confidence: high. Call updateInboxSubtabBadges() (and re-render the list) when the read request completes, or set readAt locally before sending it. Look: the count drops on Back.

- [x] Fixed: Opening a mail does not lower the Inbox unread count until the page is reloaded

### A saved draft cannot be deleted: opening it goes to Compose, which has no Delete, and the Delete Draft button is on a view drafts never open (Bug AB#1137, Resolved, not verified)

What: Symptom. Drafts can be saved, edited and sent, but not deleted. Opening a draft goes straight to Compose, whose buttons are Back, Send and Save Draft. The Delete Draft and Edit Draft buttons exist in the message view, which drafts never reach, so they never show. A draft a player does not want stays in Drafts for good. / Repro. Inbox → Compose → Save Draft; open Drafts; open the draft: Compose opens with Back, Send and Save Draft. No Delete Draft button is visible anywhere. / System info.… (the rest: AB#1137)
Symptom: Drafts can be saved, edited and sent, but not deleted. Opening a draft goes straight to Compose, whose buttons are Back, Send and Save Draft. The Delete Draft and Edit Draft buttons exist in the message view, which drafts never reach, so they never show. A draft a player does not want stays in Drafts for good.
Repro: Inbox → Compose → Save Draft; open Drafts; open the draft: Compose opens with Back, Send and Save Draft. No Delete Draft button is visible anywhere.
Proposed fix: Confidence: high. Show a Delete Draft button in the compose view when it is editing a saved draft (appState.inbox.composeDraftId set), calling the existing DELETE /messages/draft/:draftId, and remove the unreachable detail-view buttons. Test: the compose view offers Delete when a draft is open and not otherwise. Look: delete a draft and see Drafts empty.

- [x] Fixed: A saved draft cannot be deleted: opening it goes to Compose, which has no Delete, and the Delete Draft button is on a view drafts never open

### Trade History shows a cancelled listing as a bare 'cancelled' with no badge, and a total that reads as money moved (Bug AB#1168, Resolved, not verified)

What: Symptom. After cancelling a listing, Trade History gains a row whose Type is plain text CANCELLED with none of the badge styling the other rows have, and whose Total shows the listing's value ($50) although nothing was paid. / Repro. 1. List 2 Silicates at $25, then Cancel it in My Active Listings. / 2. Trade History: the newest row reads 'CANCELLED Silicates 2 $25 $50 Market' without a badge. / Screenshot: sweep721-r2-10-trade-history-after-cancel.png. / Build:ddd4d7e, a scratch merge of origin/main… (the rest: AB#1168)
Symptom: After cancelling a listing, Trade History gains a row whose Type is plain text CANCELLED with none of the badge styling the other rows have, and whose Total shows the listing's value ($50) although nothing was paid.
Repro: 1. List 2 Silicates at $25, then Cancel it in My Active Listings. / 2. Trade History: the newest row reads 'CANCELLED Silicates 2 $25 $50 Market' without a badge. / Screenshot: sweep721-r2-10-trade-history-after-cancel.png. / Build:ddd4d7e, a scratch merge of origin/main 8feae88 with !161, the one ISP PR open at the time. !161 merged afterwards as 4d305f4; git diff 4d305f4 ddd4d7e changes one test file and nothing in public/ or server/.
Proposed fix: Confidence: high. Add cancelled to both maps (label 'Cancelled', a neutral badge class), and show '-' in Total for listed and cancelled rows, which moved no money. Test: a unit test of the row label for every type the server writes, derived from the server's list of types so a new one fails the test.

- [x] Fixed: Trade History shows a cancelled listing as a bare 'cancelled' with no badge, and a total that reads as money moved

### Sell Orders shows at most 30 listings and does not say there are more (Bug AB#1169, Resolved, not verified)

What: Symptom. With 50 listings on the book from player B, player A's Sell Orders table showed 30 rows and nothing said 20 more existed. Sorting reaches the cheapest or dearest 30, but a buyer on the default sort (newest) cannot tell an older, cheaper listing is hidden. / Repro. 1. B creates 50 one-unit Silicates listings at $41 to $90. / 2. A opens Galactic Exchange: 30 rows in Sell Orders, no count or hint. / Screenshot: sweep721-r9-01-A-busy-book.png. / Build:ddd4d7e, a scratch merge of origin/main… (the rest: AB#1169)
Symptom: With 50 listings on the book from player B, player A's Sell Orders table showed 30 rows and nothing said 20 more existed. Sorting reaches the cheapest or dearest 30, but a buyer on the default sort (newest) cannot tell an older, cheaper listing is hidden.
Repro: 1. B creates 50 one-unit Silicates listings at $41 to $90. / 2. A opens Galactic Exchange: 30 rows in Sell Orders, no count or hint. / Screenshot: sweep721-r9-01-A-busy-book.png. / Build:ddd4d7e, a scratch merge of origin/main 8feae88 with !161, the one ISP PR open at the time. !161 merged afterwards as 4d305f4; git diff 4d305f4 ddd4d7e changes one test file and nothing in public/ or server/.
Proposed fix: Confidence: high. When the slice drops rows, show 'Showing 30 of 50 player sell orders. Sort by price or filter by resource to see the rest.' under the table. Test: unit test of the caption for 29, 30 and 31 orders, if viewOrders and the caption can be pure in exchangeView.js.

- [x] Fixed: Sell Orders shows at most 30 listings and does not say there are more

### A contract can be completed at any station through the route, though the page allows it only at the agent's station (Bug AB#1203, Resolved, not verified)

What: Symptom. The page lets a player complete a contract only while docked at the issuing agent's station ('You must be docked at Earth Station Prime to complete this contract.', and the Complete button hidden). POST /gameplay/complete-mission checks only that the quota is held at the corporation's current station, wherever that is. Anyone calling the route directly can complete a contract away from the agent. The two rules also make it unclear which one the game means. / Repro. On main b2c0310:… (the rest: AB#1203)
Symptom: The page lets a player complete a contract only while docked at the issuing agent's station ('You must be docked at Earth Station Prime to complete this contract.', and the Complete button hidden). POST /gameplay/complete-mission checks only that the quota is held at the corporation's current station, wherever that is. Anyone calling the route directly can complete a contract away from the agent. The two rules also make it unclear which one the game means.
Repro: On main b2c0310: accept an Elara Voss contract (agent station Earth Station Prime), travel to Mars Orbital Dock with the quota in stock there, then POST /api/accounts/:id/gameplay/complete-mission with the missionId. It answers 200 and pays the reward, while the page at Mars hides the Complete button and shows the docking warning.
Proposed fix: Confidence: medium. Move MISSION_AGENTS to a shared module in public/scripts, and have complete-mission refuse unless currentStationId is the agent's station, with the page's wording ('You must be docked at X to complete this contract.'). Test: the route refuses away from the agent's station and accepts there. Confidence medium: the PM may prefer the looser rule, in which case the page should drop its check instead.

- [x] Fixed: A contract can be completed at any station through the route, though the page allows it only at the agent's station

### Every station's Orbital Executive Suites card says 'An Earth Station Prime office tells the ISA... that you are serious', at Mars and in other star systems too (Bug AB#1269, Resolved, not verified)

What: Symptom. The Suites card's flavour text reads 'The prestige is in the address. An Earth Station Prime office tells the ISA, and everyone else, that you are serious.' All eight stations have the Suites and show the same line, so a player docked at Mars Orbital Dock or Centauri Prime Station is told about an Earth Station Prime office they are not leasing. / Repro. Reproduces on the combined build and on main b2c0310. Fresh account on 127.0.0.2 at 1280x800: Starmap, Sol, Mars, Dock at Mars Orbital… (the rest: AB#1269)
Symptom: The Suites card's flavour text reads 'The prestige is in the address. An Earth Station Prime office tells the ISA, and everyone else, that you are serious.' All eight stations have the Suites and show the same line, so a player docked at Mars Orbital Dock or Centauri Prime Station is told about an Earth Station Prime office they are not leasing.
Repro: Reproduces on the combined build and on main b2c0310. Fresh account on 127.0.0.2 at 1280x800: Starmap, Sol, Mars, Dock at Mars Orbital Dock; after arrival, open Station. The Orbital Executive Suites card, under 'Docked at Mars Orbital Dock', carries the Earth Station Prime line.
Proposed fix: Confidence: high. Make the line station-neutral ('The prestige is in the address: a registered office here tells the ISA, and everyone else, that you are serious.'), or render it with the docked station's name. Test: no building's flavor names a station unless the building exists only at that station. Confidence high.

- [x] Fixed: Every station's Orbital Executive Suites card says 'An Earth Station Prime office tells the ISA... that you are serious', at Mars and in other star systems too

### On a desktop and a tablet the Starmap's outer planets touch or cross the top and bottom edges (Uranus in Sol, the Crown Belt in Epsilon Eridani) (Bug AB#1326, Resolved, not verified)

What: Symptom. In a system view at 1280x800 the outermost bodies reach the canvas's top and bottom edges. In Sol, Uranus sits on the top edge with its label half outside. In Epsilon Eridani, the Crown Belt is cut by the top edge. The same happens at 768x1024 (Uranus on the top edge in Sol). Phones are not affected once #1315 fits the orbits to the width. / Repro. Main b2c0310 with !203, 127.0.0.2, production mode, the app in a same-origin iframe at 1280x800 (canvas 881x534) and 768x1024 (685x558):… (the rest: AB#1326)
Symptom: In a system view at 1280x800 the outermost bodies reach the canvas's top and bottom edges. In Sol, Uranus sits on the top edge with its label half outside. In Epsilon Eridani, the Crown Belt is cut by the top edge. The same happens at 768x1024 (Uranus on the top edge in Sol). Phones are not affected once #1315 fits the orbits to the width.
Repro: Main b2c0310 with !203, 127.0.0.2, production mode, the app in a same-origin iframe at 1280x800 (canvas 881x534) and 768x1024 (685x558): Starmap > Sol, and Starmap > Epsilon Eridani. Screenshots b5/b6 (before) and a9/aa (after #1315, unchanged) on the AB#1315 PR.
Proposed fix: Confidence: high. Fit the orbits to the height as #1315 fits them to the width: orbitLimit = min(min(w, h) * 0.42, w / 2 - 76, h / 2 - 76), using the same ORBIT_INNER and ORBIT_EDGE_MARGIN constants. This changes the desktop system view: at 881x534 the outermost orbit goes from 280 to 247 px from the star (about 12% closer). The layout change is the point, so it needs a before/after look at 1280x800 in each system. Test: extend tests/unit/starmapFit.test.js so every body's y +/- its reach is… (the rest: AB#1326)

- [x] Fixed: On a desktop and a tablet the Starmap's outer planets touch or cross the top and bottom edges (Uranus in Sol, the Crown Belt in Epsilon Eridani)

### On a phone, with !212, a body label moved to the left of its planet can run across the system's star ('Centauri Prime' over Alpha Centauri's sun) (Bug AB#1337, Resolved, not verified)

What: Symptom. At 375x812 with !212 (AB#1315), in Alpha Centauri the label 'Centauri Prime' is drawn to the left of its planet because it would pass the right edge, and it runs across the star's glow. It is readable but crowded. Found in review of my own open PR; not on main, because main's labels run off the edge instead. / Repro. Look-only merge of fix/1270 + !212 (which contains !203), 127.0.0.2, production mode, the app in a same-origin iframe at 375x812: Starmap > Alpha Centauri. Screenshot… (the rest: AB#1337)
Symptom: At 375x812 with !212 (AB#1315), in Alpha Centauri the label 'Centauri Prime' is drawn to the left of its planet because it would pass the right edge, and it runs across the star's glow. It is readable but crowded. Found in review of my own open PR; not on main, because main's labels run off the edge instead.
Repro: Look-only merge of fix/1270 + !212 (which contains !203), 127.0.0.2, production mode, the app in a same-origin iframe at 375x812: Starmap > Alpha Centauri. Screenshot x-375-212-label-over-star.png on the AB#1270 PR.
Proposed fix: Confidence: medium. When the right side does not fit, prefer drawing the label above or below the body (x centred on it, y -/+ 12) and keep it inside [4, width - 4]. Use the left side only when that is clear of the star (x - gap - textWidth > cx + starHaloR). Test in tests/unit/starmapFit.test.js: at 292px no body label's box intersects the star's halo circle (60px) in any system. Look at Alpha Centauri and Sol at 375x812. Confidence medium: labels above and below can meet the orbit lines, so… (the rest: AB#1337)

- [x] Fixed: On a phone, with !212, a body label moved to the left of its planet can run across the system's star ('Centauri Prime' over Alpha Centauri's sun)

### On a phone, Barnard's Star's belt is drawn at the top edge of the Starmap and cannot be tapped, even with !203 (Bug AB#1344, Resolved, not verified)

What: Symptom. At 375x812, opening Barnard's Star on the Starmap draws the Rift Debris Ring at the very top edge of the 309px canvas, at about (62, 5), just above the Back To Cluster button. Taps at eight points on and around it never open the belt; the panel stays on the system, then returns to the cluster view. Dragging does not pan the solar view. So a phone player cannot open that belt, scout it or launch an expedition to it. It reproduces on main (with AB#1287's squeezed drawing) and on a… (the rest: AB#1344)
Symptom: At 375x812, opening Barnard's Star on the Starmap draws the Rift Debris Ring at the very top edge of the 309px canvas, at about (62, 5), just above the Back To Cluster button. Taps at eight points on and around it never open the belt; the panel stays on the system, then returns to the cluster view. Dragging does not pan the solar view. So a phone player cannot open that belt, scout it or launch an expedition to it. It reproduces on main (with AB#1287's squeezed drawing) and on a scratch merge… (the rest: AB#1344)
Repro: 1. Production mode, 127.0.0.2, a phone viewport 375x812, an account with Asteroid Prospecting. / 2. Starmap > tap Barnard's Star (about 106,228 on the canvas with !203): the system opens, and the belt is drawn at the top edge. / 3. Tap the belt at (62,6), (62,12), (58,16) and nearby: no belt panel, no Scout button. / Screenshots: H-map-canvas-1.png and H-map-panned.png (with !203), attached.
Proposed fix: Confidence: low. Fit the solar view inside the canvas with a margin (scale orbits to min(width, height)/2 minus the largest body radius and a label, not to the width alone), and keep click targets for bodies ahead of the Back button, or move Back out of the drawing into an HTML button above the canvas. Test: for each system at 309x320, every body's position and hit radius lies inside the canvas and outside the Back button's target. Look: every belt tappable at 375x812.

- [x] Fixed: On a phone, Barnard's Star's belt is drawn at the top edge of the Starmap and cannot be tapped, even with !203

### After ISP-40, a balance change in data/economy.json would not reach the browser: app.js still quotes and computes hire, payroll, build and operating costs from its own literals (Bug AB#1430, Resolved, not verified)

What: Symptom. ISP-40 (AB#726, !245 pending) moves the server's economy constants into data/economy.json so a balance pass is a diff of one file. The browser does not read that file. public/scripts/app.js repeats the same numbers as literals: the hire panel says each hire costs 2,000 and adds 150/day (app.js:1357) and computes them (1501, 1506); the build-extractor and refinery panels use 50000 (1681, 1881); the start-mining panel recomputes max(600, 16 x throughput) and max(500, 35%) (1944-1945);… (the rest: AB#1430)
Symptom: ISP-40 (AB#726, !245 pending) moves the server's economy constants into data/economy.json so a balance pass is a diff of one file. The browser does not read that file. public/scripts/app.js repeats the same numbers as literals: the hire panel says each hire costs 2,000 and adds 150/day (app.js:1357) and computes them (1501, 1506); the build-extractor and refinery panels use 50000 (1681, 1881); the start-mining panel recomputes max(600, 16 x throughput) and max(500, 35%) (1944-1945); the probe… (the rest: AB#1430)
Repro: 1. On the ISP-40 branch, change employees.hireCost in data/economy.json from 2000 to 2500 and restart the server. / 2. Open the Operations tab's hire panel: it still says 'Each hire costs 2,000 credits'. / 3. Hire one employee: the server charges 2,500.
Proposed fix: Confidence: high. Serve the economy to the client once, in the bootstrap payload the client already loads (GET /api/bootstrap gains economy: ECONOMY), keep it in the client's state, and replace each literal in app.js with the value from it: hire cost and payroll text and maths, build costs, the operating and startup formulas (import operationCostPerHourFor/startupCostFor logic into a shared public/scripts module fed the numbers), and the probe price. Test: a grep test over public/scripts/app.js… (the rest: AB#1430)

- [x] Fixed: After ISP-40, a balance change in data/economy.json would not reach the browser: app.js still quotes and computes hire, payroll, build and operating costs from its own literals

### ISP-43a Tickers deep-clone every account they touch: 35% of the event loop at 1,000 corporations (Requirement AB#1448, Resolved, not verified)

What: Where it sits. ISP v0.5 Beta MVP (#389), Release Engineering, found by AB#729 (ISP-43). / What it is. Every ticker (mining, refinery, expeditions, fabrication, travel, R&D, CEO, finance snapshot) calls mutateAccountState on every account. That runs applyMiningOperations twice, refreshContractOfferings, ensureCorpMiningModel and evaluateLevelProgress, schedules a save, and returns sanitizeAccount(account): a deep clone of the whole account that the tickers throw away. AB#729's benchmark (npm run… (the rest: AB#1448)

- [x] npm run bench:ticks at N = 1,000, before and after on the same machine, is quoted in the PR; the combined event-loop share falls by at least half.
- [x] No ticker returns or builds a sanitized clone it does not use.
- [x] Every existing test still passes, with the count stated; mining still advances exactly once per elapsed interval (a test with a fake clock).

### ISP-44a A full re-render takes 155-180 ms at 4x throttling; the budget is 16: the market and the finance charts redraw while hidden (Requirement AB#1452, Resolved, not verified)

What: Where it sits. ISP v0.5 Beta MVP (#389), Release Engineering, found by AB#730 (ISP-44) with scripts/bench-render.mjs: Edge, CPU throttled 4x, a corporation with 5 extractors, 200 open orders and 50 trades. / What it is. updateAllViews (public/scripts/app.js) runs after every action and refresh and redraws every view, visible or not. Measured over 20 re-renders: median 153-178 ms, p95 192-228 ms, against a budget of 16 ms median and 50 ms p95. Broken down by view (median ms): renderMarket 73.6… (the rest: AB#1452)

- [x] node scripts/bench-render.mjs (same machine, same seed) before and after is quoted in the PR: full re-render median under 16 ms and p95 under 50 ms, or the remaining gap stated with its breakdown.
- [x] Opening the Market or Financial Core tab shows current data (a test or a look at both, stated which).
- [x] npm test green, with the count stated.

### ISP-44b The page keeps the main thread 40% busy while idle at 4x throttling; the starfield animation is half of it (Requirement AB#1453, Resolved, not verified)

What: Where it sits. ISP v0.5 Beta MVP (#389), Release Engineering, found by AB#730 (ISP-44) with scripts/bench-render.mjs: Edge, CPU throttled 4x, a corporation with 5 extractors, 200 open orders and 50 trades. / What it is. Left alone for 60 s with live socket updates, the page kept the main thread busy 40-41% of the time. With public/scripts/starfield.js blocked, 20%: the animated background costs about half of all idle CPU, drawing every animation frame forever. The rest is the page's 1-second… (the rest: AB#1453)

- [x] node scripts/bench-render.mjs before and after is quoted in the PR: idle main-thread share at 4x under 10%, or the remaining cost broken down.
- [x] The starfield still animates for a player who has not asked for reduced motion (a look, with a screenshot).
- [x] npm test green, with the count stated.

### ISP-289 Design the way back from broke: what a corporation with no credits and no ore can always do (Requirement AB#1740, Resolved, not verified)

What: Where it sits. ISP v0.5 (AB#389), Release Engineering. It replaces the next attempt at ISP-42 (AB#728), which the probe shows cannot be fixed by retuning values. What it is. A design, in ECONOMY.md or a doc it points to, for the affordance a corporation reaches for when it has spent its way to zero: what it can always do to earn its way back, what that pays, how long it takes, and why it cannot be farmed forever. Candidates to weigh, not a decision made in advance: an ISA salvage or survey… (the rest: AB#1740)

- [x] The design names one recovery affordance for v0.5, says why it beat the others, and states its numbers: what it pays, how often it may be used, and what stops it becoming the optimal way to play (T-018: if its payoff is linear in something the player sets, it is arithmetic, not a decision).
- [x] It is falsifiable before anything is built: it states the probe assertion that will prove it, in the form "no corporation is ever in a state where every available action changes nothing", and names the seeds and the day counts to run.
- [x] It says what the current probe cannot see (two bots are the whole market, so player-to-player demand is thin by construction, P-PROXY) and whether the deadlock would still happen with deeper NPC demand. If deeper NPC demand alone fixes it, that is the cheaper answer and the design says so.
- [x] It lists the implementation stories, each session-sized, and what ISP-42 (AB#728) then retunes, if anything.
- [x] Anything that changes what a player can earn is flagged in the PR for the Board, since it changes the economy every later balance number rests on.

### ISP-290 Login and register: one primary button per screen (Requirement AB#1759, Resolved, not verified)

What: Where it sits. ISP v0.5 (AB#389), a session-sized quick win from visual-design Critique AB#1757 (POLISH, 2.4/5, against the rubric ratified on main at 950d9f1), which says it needs no direction decision and so does not wait on the design system (AB#758 to AB#772). What it is. Give the login and register screens a single primary control each, with every other action secondary or a link, as the Critique's "cyan on at most one primary control per screen" rule asks. Why it matters. It is visible on… (the rest: AB#1759)

- [x] Each of login and register has exactly one primary (cyan) control; the others are secondary or links. A test or a grep over the two templates asserts one primary class per screen.
- [x] Tab order and labels are unchanged; the primary control is still the one a keyboard user reaches first.
- [x] Screenshots of the changed screens at 1280x800 and 375x812 attached to the PR, before and after.

### ISP-291 A focus-ring token, and a prefers-reduced-motion block (Requirement AB#1760, Resolved, not verified)

What: Where it sits. ISP v0.5 (AB#389), a session-sized quick win from visual-design Critique AB#1757 (POLISH, 2.4/5, against the rubric ratified on main at 950d9f1), which says it needs no direction decision and so does not wait on the design system (AB#758 to AB#772). What it is. Add one focus-ring token used by every interactive element, so keyboard focus is visible everywhere, and a @media (prefers-reduced-motion: reduce) block that turns off the animations for anyone who asks for less motion.… (the rest: AB#1760)

- [x] A single --focus-ring token is defined once and used by buttons, links, inputs and tabs; tabbing through login, the Station and the Exchange shows a visible ring on every stop (screenshots).
- [x] With reduced motion requested, animations and transitions are disabled or reduced to an instant change, including the walkthrough and the typewriter; a test asserts the media block covers the animation rules.
- [x] Screenshots of the changed screens at 1280x800 and 375x812 attached to the PR, before and after.

### ISP-293 Corporate R&D and Assignments at full content width (Requirement AB#1762, Resolved, not verified)

What: Where it sits. ISP v0.5 (AB#389), a session-sized quick win from visual-design Critique AB#1757 (POLISH, 2.4/5, against the rubric ratified on main at 950d9f1), which says it needs no direction decision and so does not wait on the design system (AB#758 to AB#772). What it is. Both panels sit narrower than the content column, so they look unfinished beside the others. Give them the same width as their siblings at every breakpoint. Why it matters. It is visible on a screen a player meets early,… (the rest: AB#1762)

- [x] Both panels match the content width used by the neighbouring panels at 1280 and at 375, with no fixed pixel width left behind; a test asserts no vw or px cap remains on those two containers.
- [x] Screenshots of the changed screens at 1280x800 and 375x812 attached to the PR, before and after.

### ISP-294 The typewriter finishes on click (Requirement AB#1763, Resolved, not verified)

What: Where it sits. ISP v0.5 (AB#389), a session-sized quick win from visual-design Critique AB#1757 (POLISH, 2.4/5, against the rubric ratified on main at 950d9f1), which says it needs no direction decision and so does not wait on the design system (AB#758 to AB#772). What it is. The typewritten briefing text makes a reader wait. A click, tap or key press completes the text immediately; with reduced motion requested it is complete from the start. Why it matters. It is visible on a screen a player… (the rest: AB#1763)

- [x] Clicking, tapping or pressing a key while the text is typing shows the whole text at once and leaves the next control ready; a test drives it.
- [x] With prefers-reduced-motion, the text renders complete with no animation.
- [x] Screenshots of the changed screens at 1280x800 and 375x812 attached to the PR, before and after.

### ISP-295 The runway probe gets a third bot that banks a reserve (Requirement AB#1774, Resolved, not verified)

What: Where it sits. ISP v0.5 (AB#389), ops/probes/isp-runway.ts (ISP-84, AB#773), epic 1 of Monetization review #2 (AB#1773, 1.8/5 REPRICE). What it is. A third bot profile alongside planner and greedy that keeps a safety margin rather than reinvesting every credit. Why it matters. Review #2 measured banked÷spent at 0.00x at day 3, 7 and 30 in all four runs, with both bots refused start-mining between 900 and 1,700 times per run for want of a four-figure sum. That reads as an economy too tight to… (the rest: AB#1774)

- [x] A third profile (a banked-reserve bot) runs alongside planner and greedy from the same command, deterministic for a given seed, and is documented in the probe header like the others.
- [x] The bot keeps a stated reserve floor and will not spend below it; the floor is a named constant with a comment saying what it represents, not a magic number.
- [x] The probe reports banked÷spent per profile at day 3, 7 and 30 under both supply settings, and the three profiles' ratios are shown side by side so divergence is readable off the output.
- [x] The pull request states which profile the economy actually rewards, and says in one line whether the 0.00x result reflects the economy or the bot policy — that is the question this story exists to answer.
- [x] Every output line still says it is a bot number and states the bot's assumed pace (P-PROXY). No economy constant, cost curve or bid rule changes in this story.

### ISP-296 BRIEF.md carries the Board's three no-RMT rulings by decision number (Requirement AB#1776, Resolved, not verified)

What: Where it sits. ISP v0.5 (AB#389), BRIEF.md Monetization section. Epic 3 of Monetization review #2 (AB#1773); its other half, the code-side guard test, shipped as AB#779 (ISP-89). What it is. Fold the Board's three explicit no-RMT rulings into BRIEF.md itself, each named with its decision number. Why it matters. The rulings exist only as decision comments on closed Issues. P-WRITE-ONLY: written once, read by the session that closed the ticket, and by nobody since. BRIEF.md is the one document a… (the rest: AB#1776)

- [x] BRIEF.md's Monetization section names all three rulings with their decision numbers: AB#980 — research and CEO Insight effects are never sellable, items are always sellable; AB#703 — no player may gain an unfair advantage by trading anything in game for real money, covering all v0.9 financial mechanics; AB#706 — all v0.10 military mechanics may never be sold or accelerated.
- [x] Each is written as a rule a builder can apply without opening Azure DevOps, not as a citation: the sentence says what is forbidden, and the decision number follows it.
- [x] The section says which of them bind mechanics that do not exist yet (v0.9 financial, v0.10 military), so a builder starting one of those knows the constraint precedes the code.
- [x] No other section of BRIEF.md changes, and nothing in the repo's behaviour changes — this is a documentation story on purpose.

### ISP-299 Probe: a broke corporation always has a way back, checked on every economy change (Requirement AB#1792, Resolved, not verified)

What: Where it sits. ISP v0.5 Beta MVP (AB#389). One of three implementation stories from ISP-289 (AB#1740), whose design is ECONOMY.md The way back from broke (PR !437). Together they close Bug AB#1741: a corporation with no credits and no ore is permanently stuck, which both probe bots hit in every run of the 2026-09-25 Systems Audit. The design's Board flag (a new, permanent credits faucet) was accepted by the Director on 2026-09-25, open to Board veto: it is deliberately worse than any real… (the rest: AB#1792)

- [x] --broke forces the starting state and reports, in actions and simulated hours, when the bot accepted and completed a Salvage Assignment and when its credits rose above 0.
- [x] Run at seeds 7000 and 7001 over 7 and 30 simulated days: all four runs show credits above 0 within 4 simulated hours of the floor; the output is pasted in the PR as bot numbers, not player time (P-PROXY).
- [x] If any run is still refused on every action after reaching 0, the story files a Bug against the design rather than tuning the probe to pass.

### Registration accepts non-string fields by coercing them: a password sent as {"x":1} creates an account whose password is literally "[object Object]" (Bug AB#2050, Resolved, not verified)

What: Symptom. POST /api/auth/register coerces every field with String(x || "") before validating, so a value of the wrong type is accepted rather than rejected. Observed live: password {"x":1} returned 201, and that account then logs in with the password "[object Object]" (200 with an access token). A password, CEO name or corporation name sent as a one-element array also returned 201, with the element's text stored. An email of 12345 or of a two-element array is refused only because the coerced… (the rest: AB#2050)
Symptom: POST /api/auth/register coerces every field with String(x || "") before validating, so a value of the wrong type is accepted rather than rejected. Observed live: password {"x":1} returned 201, and that account then logs in with the password "[object Object]" (200 with an access token). A password, CEO name or corporation name sent as a one-element array also returned 201, with the element's text stored. An email of 12345 or of a two-element array is refused only because the coerced string fails… (the rest: AB#2050)
Repro: origin/main 8d04c77, npm start. POST /api/auth/register {"email":"t1@example.test","password":{"x":1},"ceoName":"Al Rivera","corpName":"Type Corp One"} returns 201. POST /api/auth/login {"email":"t1@example.test","password":"[object Object]"} returns 200. Arrays: {"password":["Sup3rSecret-Echo-Me"]}, {"ceoName":["Al Rivera"]} and {"corpName":["Type Corp Four"]} each return 201.
Proposed fix: Confidence: high. In createAccount (server/game/store.js:402), before normalizing, refuse any of email, password, ceoName or corpName whose typeof is not "string" with the same 400 shape and field name the length rules use (for example "Enter a valid email address." / field email; "Password must be 10 to 128 characters." / field password), never echoing the value. Apply the same typeof check in the login route so a non-string password is a plain 401, not a coerced comparison. Test: add to… (the rest: AB#2050)

- [x] Fixed: Registration accepts non-string fields by coercing them: a password sent as {"x":1} creates an account whose password is literally "[object Object]"

### ISP-301 Yard upkeep for every extractor yard after the first (Requirement AB#2284, Resolved, not verified, under Requirement AB#778)

What: Where it sits. ISP-88's sink design (AB#778), sink 1 of 3, ECONOMY.md "Sinks that scale with income". / What it is. Add buildings.extractorYardUpkeepPctPerDay = 2 to data/economy.json; operationCostPerHourFor adds 50,000 x 2% / 24 per hour (41.67 credits/hour) after the existing 600 floor, for every yard but the corporation's first; the Station's cycle-cost line shows it. / Why it matters. It is the first of the three sinks meant to make expansion cost something past the first yard, closing the… (the rest: AB#2284)

- [x] A one-yard corporation's cost per hour is unchanged at every throughput setting (existing tests extended, not replaced).
- [x] A second yard's cost per hour is exactly 41.67 credits higher than the first's, at every throughput.
- [x] With too little credit, the second yard mines in proportion to what can be paid (existing affordabilityRatio), records no debt, and is never locked out; the first yard is unaffected.
- [x] ECONOMY.md's key table gains buildings.extractorYardUpkeepPctPerDay = 2.
- [x] Probe target, a bot number (ops/probes/isp-runway.ts, seeds 7000 and 7001): banked/spent stays below 3x for planner, greedy and reserve at day 3/7/30 - a guard that this sink alone did not break ISP-42's floor. The full four-check pass is ISP-304's; this story only must not regress it.
- [x] Screenshot: the Station's cycle-cost line for a two-yard corporation, showing the added upkeep, attached to the PR.

### ISP-302 The ISA lease royalty: a tiered sales tax by leases held (Requirement AB#2285, Resolved, not verified, under Requirement AB#778)

What: Where it sits. ISP-88's sink design (AB#778), sink 2 of 3. / What it is. Add leases.royaltyPointsByLeasesHeld = {2: 1, 3: 2, 5: 3} to data/economy.json, applied in getEffectiveExchangeTaxRate (server/game/progression.js) by leases held; the Negotiation Fundamentals discount still applies on top, and the rate never goes below 0. The Exchange's rate breakdown shows the royalty as its own line. / Why it matters. The sink funded purely by sales, so a corporation that sells nothing pays nothing - the… (the rest: AB#2285)

- [x] Effective tax is 8% at 1 lease, 9% at 2, 10% at 3-4, 11% at 5+, each less the Negotiation Fundamentals discount, never below 0; a unit test sweeps 0-6 leases held.
- [x] NPC sales and player-to-player trades see the same rate (both call the one function).
- [x] ECONOMY.md's key table gains leases.royaltyPointsByLeasesHeld.
- [x] The royalty is booked under its own AB#712 ledger category (not lumped into the general tax category), named consistently with ISP-307's (AB#2299) upkeep and price-growth categories, so ISP-304's probe can read it as a category of its own. Added 2026-09-26: found while shaping ISP-304, before this story's branch existed.
- [x] Probe target, a bot number: with --supply low (one yard/lease each), each bot's royalty spend is exactly 0 at every checkpoint - the design's "zero for the squeezed" claim. The full four-check pass is ISP-304's.
- [x] Screenshot: the Exchange page's tax-rate breakdown for a corporation holding 3+ leases, attached to the PR.

### ISP-303 Each extractor yard costs more than the last (Requirement AB#2286, Resolved, not verified, under Requirement AB#778)

What: Where it sits. ISP-88's sink design (AB#778), sink 3 of 3. / What it is. Add buildings.extractorYardPriceGrowth = 1.25 to data/economy.json; the n-th yard's price becomes 50,000 x 1.25^(n-1) rounded to the nearest 1,000 (50,000 / 63,000 / 78,000 / 98,000 / 122,000 / 153,000 for yards 1-6), with Supply Forecast's discount applied after. The build route, its receipt and the Station's next-yard price all read the escalated number. / Why it matters. The sink that gives a corporation at the top of the… (the rest: AB#2286)

- [x] Prices for yards 1-6 are exactly 50,000 / 63,000 / 78,000 / 98,000 / 122,000 / 153,000 before Supply Forecast; a refusal for insufficient credit quotes the escalated price, not the base one.
- [x] An existing yard's book/sale value is unchanged by a later yard's rising price - only the next purchase escalates.
- [x] ECONOMY.md's key table gains buildings.extractorYardPriceGrowth = 1.25.
- [x] Probe target, a bot number: the probe (landing with ISP-304) prints the reserve bot's next-yard price at its highest reached level, and it is a real number, not a cap - checkable only once the ladder passes Level 3 (AB#1753). Until then the probe reports the price and names the check as waiting, not skipped silently.
- [x] Screenshot: the build-yard confirmation/receipt showing the escalated price for a corporation's 3rd+ yard, attached to the PR.

### ISP-304 The runway probe reports and checks the three scaling sinks (Requirement AB#2287, Resolved, not verified, under Requirement AB#778)

What: Where it sits. ISP-88's sink design (AB#778), the probe half of ECONOMY.md's "What the probe checks after each lands". Lives in hq's ops/probes/, not the ISP repo, per ISP-299's same split. / What it is. Give ops/probes/isp-runway.ts the three sinks from ISP-301/302/303 as their own ledger categories (from the AB#712 ledger) and the four checks ECONOMY.md names: banked/spent still below 3x; --supply low bots pay 0 in all three categories and their Salvage Assignment counts stay within 10% of 22… (the rest: AB#2287)

- [x] The probe prints each of the four checks as PASS or FAIL, at seeds 7000 and 7001, run after ISP-301/302/303 land.
- [x] Check 2 (the squeezed pay 0) is the one the design says reverses the approach if it fails: a failure on either seed is written down and the responsible sink named, not patched around silently.
- [x] ECONOMY.md's "What the probe checks" section is updated to quote the actual PASS/FAIL output.
- [x] Probe target: this story's own subject is the four checks above; no further target beyond making them real.
- [x] No screen: this is a probe script's console output, not a player-visible surface. State that plainly in the PR rather than a look-alike proxy for one.

### ISP-305 Wire email verification into registration and login, and migrate the tests that assume none (Requirement AB#2288, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), authentication review, slice 2 of ISP-280's email verification (AB#987, slice 1 merged in PR !697). / What it is. Wire registration to send the verification link through the merged mail module; refuse login on an unverified account with 403 and "Check your email to verify your account." plus a resend action (AB#987's original clause 1); prompt an account that existed before this story to verify at its next login instead of locking it out retroactively; and… (the rest: AB#2288)

- [x] A newly registered account cannot log in until its verification link is followed (test transport's outbox in tests; the real one once ISP-282 lands); the attempt before that returns 403 with "Check your email to verify your account." and a resend action.
- [x] An account that existed before this story is prompted to verify at its next login rather than refused outright; state the mechanism (a flag set once, at migration, checked at login) and test it.
- [x] All test files and e2e specs that register then act are updated to complete verification (via GET /api/dev/outbox) before proceeding; npm test and the e2e suite are green, with the number of files and tests touched stated in the PR.
- [x] Do not deploy to production before ISP-282 (AB#989) exists and is live - see this item's description for why; the PR names this ordering explicitly rather than leaving it to be inferred.
- [x] Production registration still returns 503 and creates nothing with no real transport configured, now genuinely exercised since registration calls the mail module (test).
- [x] Screenshot of the 403 "check your email" page reached from a real login attempt, and the verify-then-log-in path, at 375x812 and 1280x800, attached to the PR.

### ISP-306 Shorten the access token lifetime now that refresh is automatic (Requirement AB#2294, Resolved, not verified)

What: Where it sits. v0.5 Beta MVP (#389), authentication review; a follow-up named in AB#2291's fix, not a defect on its own - AB#2291 already closes the real hole (an access token issued before a password reset now gets 401 via passwordChangedAt). / What it is. server/auth.js:8's ACCESS_TOKEN_SECONDS is 7 * 24 * 60 * 60 (7 days), chosen when the token still lived in localStorage (AB#757's own predecessor). Since AB#757, the access token lives in memory only and the client refreshes it silently and… (the rest: AB#2294)

- [x] ACCESS_TOKEN_SECONDS is changed from 7 days to a value the PR states and justifies (target: 15-60 minutes); DUMMY_ACCESS_TOKEN_SECONDS and REFRESH_TOKEN_SECONDS are unchanged.
- [x] A session that stays open past the new, shorter expiry keeps working with no visible interruption - the existing silent-refresh path renews it automatically (test: advance past the new expiry mid-session, assert the next authenticated call still succeeds with no re-login).
- [x] A refresh token stolen alongside an old access token still only grants the shorter access-token window per use, unchanged from before - this story does not touch refresh-token handling or AB#2291's passwordChangedAt check.
- [x] Security answer: what changed (the exposure window for a bare stolen access token, not the refresh token or the reset behavior) and what did not (no new secret, no new storage location).
- [x] npm test green, with the tests touched named in the PR.

### ISP-307 Book yard upkeep and rising yard price under their own AB#712 ledger categories (Requirement AB#2299, Resolved, not verified, under Requirement AB#778)

What: Where it sits. ISP-88's sink design (AB#778), a follow-up found building ISP-304 (AB#2287). / What it is. ISP-301 (AB#2284, yard upkeep, merged) and ISP-303 (AB#2286, yard price growth, merged) book their charges under the existing mining-ops and construction ledger categories, not a category of their own. Give both their own AB#712 ledger category (name them for what they are - upkeep and price-growth, not a generic sink bucket) and update the two applyCredits call sites to use them. / Why it… (the rest: AB#2299)

- [x] Yard upkeep's charge (AB#2284) is booked under its own ledger category instead of mining-ops, at the applyCredits call the running-cost debit makes.
- [x] Yard price growth's charge (AB#2286) is booked under its own ledger category instead of construction, at its applyCredits call in server/construction.js.
- [x] Existing tests asserting on the mining-ops/construction category totals are updated for the split; a corporation's total spend is unchanged, only the categorization is finer.
- [x] ECONOMY.md's ledger-category list names the two new categories.
- [x] No probe target and no screen of its own: this is plumbing for ISP-304's probe, not a player-visible or bot-measured change. State that plainly rather than inventing either.

### ISP-308 Yard upkeep exempts the first two yards, not just the first (Director ruling, AB#2287) (Requirement AB#2304, Resolved, not verified, under Requirement AB#778)

What: Where it sits. ISP-88's sink design (AB#778); reworks ISP-301 (AB#2284, merged) per the Director's ruling on AB#2287 (2026-09-26). / What it is. The Director found the 'zero for the squeezed' line belongs at the corporation's actual starting kit, not a hypothetical one-yard corporation: a new lease grants two building slots (server/routes/corporation.js:365, "Two building slots have been allocated to your lease"), and the starting 250,000 credits pays for both up front. Move… (the rest: AB#2304)

- [x] A one-lease, two-yard corporation (the starting kit) pays 0 upkeep at every throughput (unit test).
- [x] The third yard onward pays 41.67 credits/hour, unchanged from AB#2284's formula.
- [x] AB#2284's existing tests are updated: the case that asserted "the second yard pays it" now asserts the third does and the first two do not.
- [x] ECONOMY.md's per-day model table ("What they add up to") is recomputed from yard 3 onward to reflect this exemption; if ISP-309's price-growth rework has already landed, this recompute includes its numbers too rather than only upkeep's.
- [x] Probe target, a bot number: the AB#2299 upkeep ledger category reads 0 for a one-lease, two-yard corporation, at both seeds.
- [x] Screenshot: the Station's cycle-cost line for a three-yard corporation, showing yards 1-2 free and yard 3 paying, replacing AB#2284's original two-yard screenshot.

### ISP-309 Yard price growth starts at the third yard, not the second (Director ruling, AB#2287) (Requirement AB#2305, Resolved, not verified, under Requirement AB#778)

What: Where it sits. ISP-88's sink design (AB#778); reworks ISP-303 (AB#2286, merged) per the Director's ruling on AB#2287 (2026-09-26). / What it is. Same rework as ISP-308, applied to the price curve: buildings.extractorYardPriceGrowth's formula changes from 50,000 x 1.25^(n-1) to 50,000 x 1.25^max(0, n-2), rounded to the nearest 1,000. Yards 1 and 2 both cost the flat 50,000; the curve starts climbing at yard 3: 63,000 (62,500 rounded), then 78,000, 98,000, 122,000, 153,000, continuing the same… (the rest: AB#2305)

- [x] Yards 1 and 2 both cost exactly 50,000, no escalation.
- [x] Yard 3 costs 62,500 rounded to 63,000; yards 4-8 continue 50,000 x 1.25^max(0, n-2) rounded to the nearest 1,000 (78,000 / 98,000 / 122,000 / 153,000 / 191,000).
- [x] AB#2286's existing tests are updated for the new formula; a refusal for insufficient credit quotes the price at the new boundary.
- [x] An existing yard's book/sale value is unchanged by a later yard's rising price, as before.
- [x] ECONOMY.md's key table's buildings.extractorYardPriceGrowth entry describes the max(0, n-2) exemption, and the per-day model table ("What they add up to") is recomputed from yard 3 onward - shared with ISP-308's recompute; whichever of the two PRs lands second reconciles both changes into one table rather than each doing it alone.
- [x] Screenshot: the build-yard receipt for a corporation's 3rd yard, showing 63,000, replacing AB#2286's original 3rd-yard screenshot (which showed the old, unshifted price).

### ISP-310 Relabel ISP-304 check 3 as WAIT and add a probe scenario that expands (Director ruling, AB#2287) (Requirement AB#2306, Resolved, not verified, under Requirement AB#778)

What: Where it sits. ISP-88's sink design (AB#778), follow-up to AB#2287 (probe checks, merged) per the Director's ruling (2026-09-26). Lives in hq's ops/probes/, not the ISP repo, per ISP-299's and AB#2287's own split. / What it is. Two changes to ops/probes/isp-runway.ts and ECONOMY.md's "What the probe printed" section: (1) check 3 (reserve bot spend in the three sink categories) is relabeled WAIT, not FAIL, matching check 4's own existing pattern - no bot in 30 days holds 3+ yards or 2+ leases, so… (the rest: AB#2306)

- [x] Check 3's outcome for the existing bot profiles (none of which expand) reads WAIT, with the same stated reasoning as check 4, not FAIL.
- [x] A new probe bot profile exists that acts to expand (a second lease, a third yard, once affordable) and completes within the probe's existing day budget; its seed and day count are stated in ECONOMY.md.
- [x] With that profile, checks 2, 3 and 4 report a real PASS or FAIL, not WAIT, at seeds 7000 and 7001; ECONOMY.md's "What the probe printed" section quotes the actual output.
- [x] If the new profile still cannot reach 3+ yards or 2+ leases in the time budget, that is written down as its own finding (per the Director's "the problem is not reproduced" note) rather than patched by loosening the checks' thresholds.
- [x] No screen: probe console output only, stated plainly rather than proxied with a look-alike.

## Demo script

_To be written._
