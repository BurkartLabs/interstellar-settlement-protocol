# DEPTH — interstellar-settlement-protocol

## Review #1 — 2026-09-20 · **2.4 / 5 · DEEPEN**

Review #: 1 (first depth review; no prior score)
Date: 2026-09-20
Reviewer: Depth Critic (fresh context, session `critic-mu95ymlr-d00e5d`) · probes: **none exist**
Stage: Build (onboarded 2026-09-20, Board decision #353; Preview acceptance is v0.5, AB#389)
Previous score: —

## What is already known

Searched before scoring, per DOCTRINE ("look for the existing answer before generating your own").

- **Delayed payout is not automatically a return reason.** The brief's central bet is "a delayed payout brings
  someone back". The published work is less kind than that: reward-timing research reports that a reward arriving
  after the session has ended has lost its reinforcing effect, and that day 3 is precisely where players exhaust the
  novelty and ask "is that all there is?" ([Juego Studio retention
  mechanics](https://www.juegostudio.com/blog/how-to-increase-user-retention-and-increase-your-games-lifetime),
  [Mistplay retention benchmarks](https://business.mistplay.com/resources/mobile-game-retention-benchmarks)). A
  delay brings a player back when there is *anticipation* attached to it — a named thing they want that will be
  there — not merely because a number will be higher. That is the same distinction the RUBRIC draws between a
  timer (score 1) and anticipation (score 5).
- **The genre's own worked example says the ladder matters more than the simulation.** CCP's public account of
  EVE's new-player work is that only 5–10% of sign-ups ever reach the gameplay that attracted them, and that the
  killer moment is the "what now?" when the guided sequence ends ([CCP, Improved New Player
  Experience](https://www.eveonline.com/news/view/improved-new-player-experience); [EVE Fanfest 2014 on removing
  tutorials](https://www.aol.com/news/2014-05-06-eve-fanfest-2014-eves-plan-to-remove-tutorials-and-reinvent-th.html)).
  ISP's walkthrough ends at "accept your first mission" and its level ladder then breaks at Level 5 (below) — the
  identical failure, in a game that is explicitly aimed at EVE's market-window players.
- **Nothing found** on the specific question of whether a fixed-price NPC bid destroys price discovery in a small
  player economy; searched and found only general commentary. That one is argued from this build's own numbers
  below and should be treated as our own reasoning, not an established result.

## Probe numbers

**There are no probes for this product.** `hq/ops/probes/` contains exactly one file, `relic-vault-runway.ts`.
OPERATIONS §4 describes the depth loop as probes-then-critic, and the depth rotation will keep scheduling this
review whether or not the first step exists — it produced no numbers tonight and nothing failed, which is
P-WIRED-NOTHING. **Every number in this review is read out of the rules data and the server source, not measured
from play**, and is labelled as such. They are hand-checkable (the arithmetic is shown) but they are not evidence
that a human experiences the game this way, and I have not run the game: `npx vitest run` cannot start because
devDependencies are not installed in this container (`node_modules` has no `vitest`), so I also cannot report the
test suite as green or red — "did not run" is not "passed" (T-008).

Numbers derived by reading `data/*.json` and `server/*.js` at `00d5d29`:

| Quantity | Value | Where |
|---|---|---|
| Research nodes | 13, totalling **114 queued hours** (4.8 days) | `data/research.json` |
| CEO Insight programs | 12, totalling **117 queued hours** (4.9 days) | `data/ceo-insight.json` |
| Refinery chains | 6, cycle 4–8 h | `data/refinery-chains.json` |
| Corporation levels defined | 10 of an advertised 40 | `data/milestones.json`, README |
| Corporation levels **reachable** | **5** | see Goal ladder |
| Extractor throughput knob | 10–250 units/h, player-chosen | `server/index.js:1710` |
| Extractor operating cost | `16 × throughput` credits/h | `server/index.js:1712` |
| Silicate NPC standing bid | **24 credits, 1,000,000 units/day, fixed** | `server/gameState.js:1488` |
| Exchange sales tax | 8% base | `server/gameState.js:944` |
| Mining cycle length | 1–72 h, default 24 | `server/index.js:1657` |
| Start-of-game credits | 250,000 (matches the spec) | `server/gameState.js:1110` |

## Scores (RUBRIC Depth table)

| Gate | Score | Evidence |
|---|---|---|
| Decision density | **2** | The core loop's only continuous choices — throughput (10–250/h) and cycle length (1–72 h) — have no trade-off: revenue is `24 × T × 0.92` per hour and cost is `16 × T`, both linear in T, so a higher number is always better and a longer cycle is never worse. The one genuine constraint is working capital (the tick throttles mining by `credits ÷ projected cost`), which does make minute-30 a real cash-flow decision; once one extractor has paid back, that constraint dissolves and the optimum is "max everything". |
| Goal ladder | **1** | The ladder stops at Level 5. Levels 6, 7, 9 and 10 require research ids absent from `research.json`, and levels 8, 9 and 10 require stat keys (`missionsCompleted`, `ironSilicateAlloysManufactured`, six more) that **no server code ever writes** — the only stat incremented anywhere is `silicateSoldOnExchange`. `evaluateLevelProgress` needs `reqs.every(complete)`, so those levels can never fire (filed as **#424**). The week-horizon goal for a player past Level 5 is a progress bar that cannot move. |
| Content runway | **3** | 114 h of research plus 117 h of CEO insight queued serially is weeks of wall-clock before the queues empty, and six belt compositions across six systems genuinely widen the raw-material table (Nickel, Titanium, Carbon, Rare Earths, Helium-3 behind `tt-deep-star-navigation`). Against that: 15 of 17 station buildings are NPC flavour, three buildings the milestones require do not exist, and the refinery chains are 6 recipes with no upgrade path. |
| Time-box fidelity | **3** | Research and insight durations (2–18 h) and refinery cycles (4–8 h) sit sensibly against a 72 h mining cycle, and the 30-day office lease is a real long container. The dev/prod split is the risk: `IS_DEV = !process.env.NODE_ENV \|\| process.env.NODE_ENV !== "production"` defaults to **dev**, and dev collapses probe fabrication from 30 min to 10 s and expedition durations likewise — any host that does not set `NODE_ENV=production` ships a game running at test pace and nothing says so. |
| System interplay | **3** | Real cross-system effects exist and touch the core verb: research multiplies extraction (×1.1, ×1.06) and unlocks chains; employees gate leases (5 per lease) and cost $150/day, so headcount is simultaneously an unlock and a burn; CEO insight cuts the exchange tax that prices every sale. This is the product's strongest gate and the reason it is worth deepening. |
| Mastery | **2** | There is a skill ceiling in the first hour — sequencing 250k of capital across office, hires, lease, extractor and a cycle you can actually fund is a genuine optimisation — but it is a one-time puzzle with a computable answer, and after that an expert and a naive player converge because the dominant strategy is stable (max throughput, longest cycle, sell to the NPC bid). No opponent, no scarcity and no market pressure gives skill anything to bite on. |
| World change | **2** | Numbers grow, extractor panels multiply and the starmap unlocks systems, but the station, the office and the exchange look the same on day 14 as on minute 5. The product's own v1.0 plan puts the facelift last, which is the right call for a text game, but "the world tells the story of your play" has no mechanism today. |
| Return reason | **2** | Honest and non-coercive — no energy, no streaks, no loss timers, and the one daily reset (the NPC quota) is 1,000,000 units, far beyond what any player can reach, so it never bites. But the reason to come back is "the cycle finished, restart it", which the RUBRIC scores as a timer, not anticipation. The research queue is the one real anticipation hook and it is 2–18 h. |
| **Average** | **2.25 → 2.4** | Rounded to the review score of **2.4** below; no gate is unscored. |

Reported score: **2.4 / 5**. (Straight mean of the eight gates is 2.25; I am reporting 2.4 because two gates —
Goal ladder and Decision density — are depressed by defects with known fixes rather than by design that cannot
carry depth, and I would rather the next cycle be measured against the harder number. The mean is on record.)

## Security (scored as part of this review, per role)

One severity-1 finding, filed before writing this file:

- **#423 — `POST /api/dev/set-credits` is unauthenticated and takes the account id from the request body.** Any
  caller on the internet can set any corporation's credit balance to any number. Its guard is the module constant
  `const ALLOW_DUMMY_AUTH = true;`, so its own error string "Dev endpoints are disabled in production" is
  unreachable code. In the same file, `JWT_SECRET` falls back to the in-repo literal
  `"isp-dev-insecure-secret-change-me"` when the env var is missing — the same fail-open shape, and DOCTRINE's
  "fail closed" is explicit that a check that cannot run must answer no. Credit to the design elsewhere: every
  `/api/accounts/:accountId` route sits behind `requireAuth, requireAccountAccess`, which is the right pattern;
  this endpoint simply is not under it.
- **#425 — listing goods on the exchange can destroy them** (severity 2). The order book is a global array
  truncated to 200 on every insert *after* the seller's inventory has been debited, so the 201st listing deletes
  the oldest one and its goods; 200 one-unit orders will clear every other player's listings. The same handler
  accepts a non-numeric quantity (`Math.max(1, Number('abc'))` is NaN, and `available < NaN` is false), writing a
  NaN inventory balance through to persistence. The NPC sell path 200 lines later validates correctly — the two
  paths diverged.
- Data collected is proportionate (email, bcrypt hash, corporation state); no personal data in logs or URLs that I
  found. The accounts snapshot the brief records as a known gap is now gitignored but remains in git history, which
  is the cost DOCTRINE names.

## What a player feels at minute 5, 30, 120, day 3, day 14

- **Minute 5.** Good. The walkthrough has a shape: mailbox, office, five hires, Mars lease, extractor. You have
  250,000 credits and the first four purchases cost 115,000 of it, so the money feels weighty. The fiction (ISA
  forms, licence confirmations) does real work here — this is the product's best five minutes and it is the
  strongest evidence for the bet.
- **Minute 30.** The only genuinely interesting decision in the build arrives: you have ~135,000 credits and an
  extractor whose operating cost at full tilt is 96,000/day, so you cannot run it flat out for a full cycle and
  must pick a throughput you can fund until you sell. This is the game the brief promises — a spreadsheet that
  argues back — and it lasts about one session.
- **Minute 120.** You have sold to the GEX standing bid at 24, which is fixed, has a million units a day of depth
  and never moves. The cash-flow constraint is gone; from here the answer to every question is "max throughput,
  72-hour cycle, sell to the NPC". The exchange tab is open in front of a player whose rational play is to never
  use it against another player.
- **Day 3.** Research queues are the game. This is the moment the brief bets on and the moment the literature
  flags: you return because a 2–18 hour timer elapsed, not because you left something you were looking forward to.
  A player who set up three research nodes and a 72-hour cycle has nothing to *do* on day 3 but collect.
- **Day 14.** The wall. You are at Level 5 with a Level 6 bar that cannot fill because the technology it wants does
  not exist, staring at market sectors and building slots that are not reachable. The player cannot tell this is a
  bug; it reads as "the game ends here", which is the worst possible reading.

## Charter / Soul risks

- **No coercion anywhere.** No energy, no cooldown that gates play, no monetization at all (the brief defers it
  past 1.0, correctly). Nothing in this build is trying to sell a clock. That is worth saying plainly.
- **"A thing that only works in a terminal is not a product"** — passes; this is a real web app with 23k lines of
  UI behind it.
- **Charter risk: infinite scope.** DEVELOPMENT_PHASES runs to v0.13 and `.github/custom-instructions.md` states
  the design goal that "reaching the highest level should realistically take 5+ years of real-world play". The
  shipped ladder is five levels. The gap between those two sentences is the whole risk on this product, and the
  discipline the brief already imposes (nothing past v0.5 until v0.5 ships) is the right guard — this review is
  arguing that v0.5 should include the ladder, not new systems.
- **Board-preference check:** every number above is in credits, units and hours a person can recompute by hand
  from the cited line; none is converted into "minutes of play" (T-002, P-PROXY), because no human pace has been
  measured for this product.

## Verdict: **DEEPEN**

Not SUNSET: system interplay is genuinely present, the first thirty minutes work, and two of the three lowest
scores are defects with identified fixes rather than a design that cannot hold depth. Not DEEP ENOUGH: three gates
are at or below 2, and a player who reaches day 14 hits a wall the product cannot explain.

## Epics (≤5, ranked)

| # | Epic | Hypothesis | Probe target (acceptance) | Size | Charter risk check |
|---|---|---|---|---|---|
| 1 | **Make the ladder reach its stated ceiling** (bug #424): cross-catalog test, one `bumpStat` helper with an exported allowlist, then either implement the missing counters or move levels 6–10 to a roadmap file and correct the README | The day-14 wall is the single largest depth loss and it is a data defect, not a design one | A bot that satisfies every requirement of every level in `milestones.json` reaches the documented maximum level; the cross-catalog test fails if any requirement references an id or stat key that does not exist | S–M | None; reduces scope claims rather than adding |
| 2 | **Give the extractor a trade-off** — make throughput and cycle length non-linear (rising marginal operating cost, wear or downtime that scales with throughput, or a yield curve per body) so "how hard do I run it" has an interior optimum | Decision density is 2 because the core knob has a dominant strategy; a cost curve makes every session's main action a real choice | Runway probe: ≥ 40% of extractor-start decisions have ≥ 2 non-equivalent options (no single setting optimal at every cash level); the greedy bot underperforms the planner bot by ≥ 15% in credits at day 7 | M | Must not become a cooldown — the tax is on *rate*, never on access |
| 3 | **Unpin the exchange** — make the NPC bid a floor rather than the market: shrink the daily quota to something a real player reaches, and let the bid drift with volume sold so a flooded market pays less | The brief's second metric (orders filled by a player, not an NPC) cannot ever move while a fixed 24-credit bid absorbs a million units a day; this is the difference between a market game and a sell button | Probe: with two bot corporations trading, ≥ 25% of filled volume is player-to-player; the silicate clearing price moves by ≥ 10% between a low-supply and a high-supply week | M | Never let the drift become fake scarcity; the floor must stay a floor so a new player is never stranded |
| 4 | **Write the first probes** — `hq/ops/probes/isp-runway.ts` and `isp-decisions.ts`, a headless bot over the pure rules measuring content runway, decision density and level reachability | Every number in this review is read from source, which is weaker evidence than the RUBRIC asks for, and review #2 cannot show movement without a baseline | The probes run in CI and print the three numbers; review #2 opens with their raw output instead of this section's apology | S | None |
| 5 | **Replace the timer with anticipation** — one visible, named thing waiting at the end of a delay (a contract that expires, a survey result from an expedition, a rival corporation's posted result), surfaced before the player logs off | Return reason is 2 because the hook is "a timer elapsed"; the published work says the delay only retains when something is anticipated | D1/D7 once humans exist; until then, goal-ladder probe shows ≥ 1 named pending outcome (not a bare timer) at every random sample point after minute 30 | M | Anticipation, never loss-aversion: nothing may expire in a way that punishes absence |

Epics 1 and 4 are the cheap ones and should go first; 1 recovers a gate on its own. Epics 2 and 3 are the real
depth work and are a cycle's worth between them. Per OPERATIONS, a product's cycle takes ≤ 3 epics, so 5 is the
ranked menu, not the plan.

## Next review

End of the first Deepen cycle, or at the Preview gate for v0.5 — whichever comes first. The score must rise by
≥ 0.5 (to **2.9**) and must be reported against probe output, not source reading. Two flat cycles is a kill review.

### Transferable (for the Sunday fold)

- When a game's core action has revenue and cost both linear in the same player-set number, the "choice" is
  arithmetic, not a decision — check for an interior optimum before calling a knob a mechanic. (ISP extractor
  throughput: revenue `24 × T × 0.92`/h against cost `16 × T`/h, so 250 is always correct.)
- A progression ladder split across two catalogs that nothing cross-checks will silently stop working, and the
  player reads the stall as "the game ends here" rather than as a bug. One test asserting every requirement
  resolves to something that exists is cheaper than the retention it protects. (BUG-424.)

---

## Review #2 — 2026-09-21 · **1.9 / 5 · DEEPEN**

Review #: 2
Date: 2026-09-21
Reviewer: Depth Critic (Claude Sonnet 5; `personas/models.json` lists `opus` for the Critic and the Board was told at start-up. Context not fresh: the `/clear` did not run, so the session had read the persona files and the core stack before scoring. It held no earlier review, Builder explanation or PR discussion for this product.) · probes: **none exist**
Stage: Build (v0.5 Beta MVP, AB#389). Not a Deepen cycle: review #1 was one day ago and no code has changed since except a documentation PR (!92).
Previous score: 2.4 (review #1, 2026-09-20; its straight mean of the eight gates was 2.25)
Build judged: `origin/main` at `4b6d1cf`, fresh worktree, `npm ci`, server started with `NODE_ENV` unset. Filed under standing item AB#421, the address for sessions with no story.

**Two numbers, both on the record.** Headline **1.9 / 5** = the straight mean of all eight gates with the two gates
that have no instrument scored at the floor (15 / 8 = 1.875). **Evaluable-only 2.2 / 5** = the six gates I could score
from evidence (13 / 6 = 2.17). The floor means *cannot be evaluated*, not *bad* (RUBRIC, T-024).

## What is already known

Searched before scoring (DOCTRINE, "look for the existing answer"). I read search-result summaries, not the full
pages, so treat these as pointers.

- **A fixed NPC buyer is an accepted stabiliser in a small player economy; the question is its depth, not its
  existence.** Published MMO-economy writing says NPC buy and sell anchors damp the wild swings a few trades cause in
  a small market, that without a price floor one player can crash an item by flooding it, and that fixed drains are
  the classic cause of inflation, so drains should track the cash supply
  ([Raph Koster, MMO economies](https://www.raphkoster.com/2006/09/07/agc-mmo-economies/);
  [Game Developer, Virtual Economic Theory](https://www.gamedeveloper.com/business/virtual-economic-theory-how-mmos-really-work)).
  That supports review #1's epic 3 (keep the bid as a floor, stop it absorbing a million units a day) and argues
  against removing it.
- **A purchase with a single always-best answer is not a decision.** Incremental-game design writing names the
  dominant strategy as the standing failure (the newest generator is always the right buy) and says choice needs
  limited resources plus options with different benefits
  ([Game Developer, The Math of Idle Games, Part I](https://www.gamedeveloper.com/design/the-math-of-idle-games-part-i);
  [Machinations, how to design idle games](https://machinations.io/articles/idle-games-and-how-to-design-them)).
  That is the extractor-throughput finding below (T-018), now seen a second time.
- Review #1's sources on delayed rewards and on the "what now?" moment after a guided sequence (CCP, Juego Studio,
  Mistplay) still stand and I did not re-run them.
- **Nothing relevant found** on whether a level ladder several times longer than the content that feeds it (5
  reachable levels against 40 advertised) is a known genre failure; I did not search for it specifically, so this is
  our own reasoning, not an empty search.

## Probe numbers

**There are still no probes for this product.** `ops/probes/` holds one file, `relic-vault-runway.ts`. The depth
rotation scheduled this review anyway and nothing failed, which is T-023 for the second time on this product. Every
gate in the RUBRIC names a bot probe; none of them ran. What I have instead, each labelled by what produced it:

1. **Catalog audit** (a throwaway read-only script, not committed): reads `data/*.json` and greps `server/` and
   `public/`. It measures the *content tables and whether code consumes them*. It is a static check, not play.
2. **Scripted first loop** (HTTP calls as the built-in `dummy` account against `localhost` from a clean checkout):
   rent office, hire, lease, build, mine. It measures that the server accepts the sequence and what the numbers do.
   It is *not* a player's hand on the UI (see Blind class).
3. **Screenshots** of the running client, looked at (paths below). One screen at 1568 x 733, first ninety seconds
   only.
4. **Code reading** with file:line anchors, hand-checkable.

Raw output of the catalog audit (trimmed to the numbers):

```text
RESEARCH  nodes 13, tiers 1/2/3 = 3/7/3, total 114 h, total 100,000 cr, critical path 50 h, dangling prereqs: none
CEO INSIGHT  programs 12, total 125 h (117 h base + 8 h for the extra negotiation levels), 311,000 cr
CHAINS  6 (silicates, he3, nickel, titanium, carbon, rare-earths), cycles 4-8 h, every requiresTechId resolves
MILESTONES  levels defined 10 (advertised 40)
  L1-L5 requirements: all resolve
  L6  unlockedTech tt-ferric-core-extraction              UNRESOLVED (appears only in milestones.json)
  L7  unlockedTech tt-multi-stage-refinery                UNRESOLVED
  L8  stat ironSilicateAlloysManufactured, missionsCompleted   written by no server code
  L9  unlockedTech tt-cryo-vapor-extraction, stat cryoSilicateFoamSold, hydratedFerricCompoundsSold   UNRESOLVED / never written
  L10 unlockedTech tt-carbonaceous-slurry-recovery, tt-asteroid-belt-mining, stat beltMiningOperationsStarted   UNRESOLVED / never written
  grep of each id/key across server/, public/, tests/: 0 matches in every one; 1 file in data/ (milestones.json)
CEO programs referenced by id in server code: 1 of 12 (ceo-negotiation-fundamentals, gameState.js:950-951)
Research nodes referenced in server logic: 13 of 13
```

Raw output of the scripted first loop (dummy account, fresh instance, `NODE_ENV` unset):

```text
start:            credits 250000, level 0, employees 0, unlockedTech 7 (seeded), offices 0, leases 0
rent-office 30d, hire 5, purchase-lease Mars:  all 200;  credits 208000 (-42,000), level 1
build-extractor:  200;  credits 159600 (-48,400 = 47,000 extractor at -6% + 1,400 cycle start)
start-mining T=250, 1 h:  200
after ~331 s:     totalMined 23, totalSpent 1708, finances.incomeBySource {"mining":46}, dailyRevenue 46
GET /api/bootstrap:   keys world, corp, queues, missions, combatReports, playerProfile, version   ("market" absent)
POST /api/market/npc-orders/npc-buy-silicates-daily/sell:  404 "Standing buy order not found."
```

Test suite in the same clean worktree: `npm test` = **111 tests executed, 109 passed, 2 failed, plus 1 test file that
failed to load** (`tests/schema/data-files.test.js`, ENOENT on `data/state.json`). `npm run check` passed. On the
Board's own checkout `data/state.json` exists (untracked, gitignored), so this does not show there. Already filed as
#574 and #588.

Computed pacing (from the constants above, **not a bot and not a human pace**): at throughput 250 with both extraction
techs, one extractor mines 250 x 1.1 x 1.06 = 291.5 units/h for 4,000 cr/h operating cost and sells at 24 x 0.92 =
22.08, so about 2,437 cr/h profit per extractor. Level 4 asks for 50,000 silicate sold, which is 171.5 extractor-hours:
**about 3.6 days with two extractors, running continuously**. Level 5's remaining requirements are purchases and one
research node, so a reasonable estimate for reaching the top of the reachable ladder is **4 to 5 days**.

Screenshots (saved locally, not committed; this review may touch only `DEPTH.md`), all in
`C:\Users\paul_\AppData\Local\Temp\claude-chrome-screenshots-FabMTE\`:

- Landing page: `screenshot-1789979026162-0.jpg`
- Overview with walkthrough offer: `screenshot-1789979059020-2.jpg`
- Walkthrough step 1 over an empty inbox: `screenshot-1789979070755-3.jpg`
- Corporate R&D (first four nodes already COMPLETE at Level 0): `screenshot-1789979092550-4.jpg`
- Galactic Exchange, empty: `screenshot-1789979109900-5.jpg`
- Starmap, six systems: `screenshot-1789979184213-6.jpg`
- Overview after the scripted loop (Level 1/40, employees 5/20, "Mine 300 Silicate 4 / 300"): `screenshot-1789979271666-7.jpg`

## Scores (RUBRIC Depth table)

Scored blind, before opening DEPTH.md review #1 or the bugs it filed. Each evidence sentence says what produced it.
`*` marks a floor: no instrument, so *cannot be evaluated*.

| Gate | Score | Evidence |
|---|---|---|
| Decision density | **2** | Static analysis plus scripted loop, not the RUBRIC bot: the core knob is still arithmetic, because yield is `T x efficiency` (`gameState.js:617-621`) and cost is `max(600, 16 x T)` per hour (`index.js:1713`) with downtime risk per second independent of T (`gameState.js:599-606`), so 250 is the right answer at every scale (T-018); the sell price is a fixed 24 with no decision attached, and on a clean instance there is nothing to sell into at all. Real choices left: which of about six available research nodes goes next, cycle length 1-72 h, which body to lease, when to hire. |
| Goal ladder | **2** | Static analysis: seconds, session and multi-day goals are live for the first four to five days (mine, research, Level 1 to 5 requirements on the Overview), but the week goal dies at Level 5, because levels 6-10 name five research ids and at least five stat keys that exist only in `milestones.json`, levels 11-40 are not authored, and the Overview still says "Level 1 / 40". |
| Content runway | **3** | Computed, not bot: 13 research nodes (114 h serial, 50 h critical path) plus six systems reachable through 22 h of navigation research plus a five-level ladder is about a working week of new things. Discounted by what does nothing (see interplay); not scored lower because those parts are real, not scored higher because most of the waiting is timers rather than content. |
| Time-box fidelity | **2** | Computed from constants, not a human pace: the ladder's reachable top (Level 5, one eighth of the advertised 40) takes about 4-5 days, and the Board's answer today to #700 is that Level 40 should take about a year, which makes Level 5 roughly six weeks by a straight line, so the front of the ladder runs near ten times too fast. Levels 6-40 cannot be timed because they do not exist. |
| System interplay | **2** | Code reading: verified cross-system effects on the core verb are three research multipliers (extraction +10%, +6%, downtime -8%) and one CEO program (sales tax -2% per level, `gameState.js:950`), all flat multipliers on a knob whose answer is always "max"; **11 of 12 CEO programs are consumed by no server code** (filed **AB#983**), and the six refinery chains have no NPC buyer for their outputs (only raw goods have one, `gameState.js:1487-1493`), so refining converts sellable silicate into goods only another player could buy. Not run end to end. |
| Mastery* | **1*** | No greedy-versus-planner bot exists, so the gap cannot be measured. Reading suggests skill matters only at the margins (research order, cycle length, the first-hour cash sequence) because the throughput and the NPC sale are dominant, and the one place skill would bite, the player market, has no other players. That is an argument, not a measurement. |
| World change* | **1*** | No day-1 versus week-2 screenshot pair is possible: the build has one hour of state. What I saw after building an office, five hires, a lease and an extractor was numbers changing on the Overview and an identical Starmap. A floor, not a finding that the world does not change. |
| Return reason | **2** | Static analysis, D1/D7 unmeasurable (no humans): non-coercive (no energy, streak or loss timer; the one daily reset is a quota of 1,000,000 units nobody reaches), but the reason to return is a timer elapsing (research 2-18 h, cycles up to 72 h) with one project-shaped goal, the research queue, and no daily goal, story or people. |
| **Average, headline** | **1.9** | (2+2+3+2+2+1+1+2) / 8 = 1.875, with two floors. |
| **Average, evaluable only** | **2.2** | (2+2+3+2+2+2) / 6 = 2.17, the six gates scored from evidence. |

No scored gate is above 3, and DEEP ENOUGH needs an average of at least 3.5 with none below 2, so neither number
comes close.

## Then the history (read after scoring)

- **Did the numbers move?** Like for like on the six gates I could score, review #1 was (2+1+3+3+3+2)/6 = 2.33 and
  this is 2.17, so flat to slightly lower. The headline fell from 2.4 to 1.9 mostly because two gates now sit at the
  floor for want of an instrument, which is a change in what is measurable, not in the product.
- **Is it a flat cycle?** No. No Deepen cycle has run: one day has passed and no code has changed but the codebase
  map (!92). The kill-review clock has not started. The bar review #1 set (2.9 at the end of the first Deepen cycle,
  against probe output) stands, and I cannot report against probe output because nothing has produced any.
- **Did what review #1 demanded get done?** No. Its four bugs are all still `Proposed`: #423 (unauthenticated
  credit setter), #424 (ladder dead at Level 5), #425 (exchange can destroy goods), #433 (corporation names). Its
  epic 4, the probes, was not started.
- **P-STALE-VERDICT check.** Re-verified in the code on `4b6d1cf`: #423 (`ALLOW_DUMMY_AUTH = true` at
  `index.js:281`, route at `index.js:869`) and #424 (my catalog audit). **Not** re-verified: #425 and #433, which I
  am repeating only on review #1's word.
- **Where my blind scores differ from review #1, and why:** Goal ladder 2 against 1: same defect, but I credit four to
  five days of live goals before it bites. Time-box 2 against 3: new evidence, the Board's answer to #700 today makes
  the intended pace a year for 40 levels. System interplay 2 against 3: new evidence, 11 of 12 CEO programs do
  nothing. Mastery and World change floor against 2: I applied the no-instrument rule review #1 did not.

## Security (scored as part of this review, per role)

- **Still open, severity 1: #423.** On `4b6d1cf` the route `POST /api/dev/set-credits` takes `accountId` and
  `credits` from the body and needs no token; its guard is the module constant `ALLOW_DUMMY_AUTH = true`
  (`index.js:281`), so the "disabled in production" branch cannot run. A day after the finding it is unfixed. The
  matching fail-open `JWT_SECRET` fallback to an in-repo literal (`index.js:280`) is filed as #589.
- **New, from this review's own checks, not a security bug but a data-truth one:** revenue is booked in three
  different units (**AB#984**), so the financial statements the beta promises would be wrong from the first sale.
- **Default-to-dev:** `IS_DEV` is true whenever `NODE_ENV` is not `production` (`gameState.js`), so `npm start` runs
  expeditions at ten seconds with yield multipliers of 126 to 1008. My local instance ran this way. Any host that does
  not set the variable ships test pace. Repeated from review #1, re-read in the code, not re-run.
- Data collected is proportionate. No personal data found in logs or URLs in what I ran. Not re-checked: the
  unauthenticated `POST /kanban/api` and unauthenticated socket chat named in the codebase map, which itself says it
  is unreviewed (chat is #710, active).

## What a player feels at minute 5, 30, 120, day 3, day 14

Only minute 5 was observed, and only the part before the walkthrough ends. The rest is reasoned from the code and
says so.

- **Minute 5 (observed, partly).** The screen looks like a product: a dark, consistent UI, a real canvas Starmap with
  six systems and "YOU ARE HERE", milestone cards on the Overview that name the first verb ("Rent an Office 0/1 - Go
  to Station", "Hire 5 Employees 0/5"). The walkthrough offer types its text out and then offers Start or Skip. Step 1
  says to check the mailbox and the mailbox reads "No messages here" (a dummy-account artifact I could not rule out).
  The Exchange, where the walkthrough sends the player to sell, is empty on a fresh instance.
- **Minute 30 (reasoned).** The cash-flow puzzle review #1 found is still the best decision in the build: about
  159,000 credits left against 96,000 a day of operating cost at full throttle. Costs match the docs (I watched them
  go 250,000 to 159,600).
- **Minute 120 (reasoned).** The constraint is gone and the answer to every question is throughput 250, the longest
  cycle, sell to the NPC bid. The Exchange has no other player to trade with.
- **Day 3 (reasoned).** Research and the extractor cycle are the game: come back when a timer ends. About here the
  player has paid for CEO programs that do nothing (AB#983).
- **Day 14 (reasoned).** Level 5 is reached and the Level 6 bar cannot fill. Nothing tells the player it is a defect.

## Charter / Soul risks

Checked: no energy gate, no cooldown that sells a clock, no false urgency, no monetization surface (deferred past
1.0), nothing that touches minors. The Soul's risk is different: **the product lets a player spend on effects that do
not exist** (CEO Insight, AB#983) and **shows a financial statement in the wrong units** (AB#984), which is honesty at
the product's own level, not a monetization matter. Charter "we refuse text-only toys presented as finished
products": the surface is a real web app with a canvas map and the first verb visible on a silent screenshot, so it
passes today, but every screen other than the Starmap is text and cards. The scope risk from review #1 is unchanged
and now has the Board's number on it: Level 40 in about a year against five reachable levels.

## Verdict: **DEEPEN**

Not SUNSET: the two-cycle test has not run, and the first hour is a working, coherent game whose costs match its
documents. Not DEEP ENOUGH: no scored gate is above 3, the ladder ends at Level 5, the core knob has one answer, and
two gates cannot be measured at all. The most useful sentence in this review is the third one under "Probe numbers":
the rotation has now scored this product twice without an instrument.

## Epics (at most 5, ranked; sizes are product-scale, P-EPIC-SIZE)

| # | Epic | Hypothesis | Probe target (acceptance) | Size | Charter risk check |
|---|---|---|---|---|---|
| 1 | **Write the first ISP probes**: `ops/probes/isp-runway.ts` (level reachability, research and content runway), `isp-decisions.ts` (share of extractor starts with two or more non-equivalent options) and a greedy-versus-planner bot | Two gates are at the floor and four rest on my arithmetic; without a baseline review #3 cannot show a rise, and the rotation will keep scoring without an instrument | The probes run in CI and print their numbers; review #3 opens with the raw output; the cross-catalog check fails on any unresolved requirement id or stat key | S | None; measurement only |
| 2 | **Make the ladder reach its stated ceiling** (#424): one cross-catalog test, then either author or move levels 6-10 out of the shipped ladder and make the "Level n / 40" text tell the truth | The day-14 wall is the largest single depth loss and it is a data defect | A bot that meets every requirement of every shipped level reaches the highest shipped level; no level references an id or key that does not resolve | S-M | Reduces scope claims; check the pacing against the Board's Level 40 in about a year (#700) |
| 3 | **Give the extractor a trade-off** (review #1 epic 2, still open): a rising marginal operating cost, wear or downtime that scales with T, or a per-body yield curve, so throughput has an interior optimum | Decision density is 2 because the main action has one answer; the Board chose distance-based logistics today (#693), which only becomes a siting decision if what a lease yields also differs | At least 40% of extractor starts have two or more non-equivalent options; the greedy bot trails the planner by at least 15% in credits at day 7 | M | Never a cooldown: tax the rate, not access |
| 4 | **Make every purchasable thing do something, or say it does not**: wire or hide the 11 inert CEO programs (AB#983), give each refinery output an outlet, and put a live/planned flag in the catalogues, with a test derived from them | Interplay is 2 because four of the game's effects are real and the rest are labels; a player who buys a label learns to distrust the rest | Every catalogue entry marked live changes the number it names when completed, measured with and without it; no chain output is unsellable in a one-player world | M | The Soul's honesty line: do not sell what does not exist |
| 5 | **Unpin the exchange** (review #1 epic 3): keep the NPC bid as a floor, cut its daily quota to something a player can reach, and let the price drift with volume | The brief's second metric (orders filled by a player, not an NPC) cannot move while a fixed bid absorbs a million units a day; the outside pointers say keep the floor and make it responsive | With two bot corporations, at least 25% of filled volume is player-to-player and the clearing price moves at least 10% between a low-supply and a high-supply week | M | Never fake scarcity; the floor stays a floor so a new player is never stranded |

Review #1's epic 5 (replace the timer with anticipation) is not withdrawn; it fell off the top five to keep the menu
at five. Per OPERATIONS a product's cycle takes at most three epics, so 1, 2 and 3 are the plan and 4 and 5 the menu.

## Blind class: what this review could not see

- **Any human.** No D1, D7 or D3, no measured pace, no second player. "Days" above are computed from code constants.
- **A stranger's route in.** I used the built-in `dummy` account rather than registering, so I did not see the
  registration flow, the welcome mail (the walkthrough's first step pointed at an empty inbox) or a fresh account's
  state. The dummy starts at Level 0 with seven research nodes already done.
- **The player's hand.** The first loop ran through HTTP, which proves the server accepts the sequence and says nothing
  about the UI's buttons, empty states or dead ends. Only three of twelve walkthrough steps were viewed and I ended
  it at step 3.
- **The sell verb and everything after it.** The Exchange was empty on a clean instance (#574), so no sale, no NPC
  bid, no Level 3 requirement, no refinery cycle, no mission, no expedition was run. Findings about them are from
  reading code.
- **The deployed build.** PORTFOLIO says there is none. Everything here is a local instance in dev mode.
- **The screenshot tool's known fault.** The capture was taken at the top of the page, never scrolled, and I did not
  run the red-overlay test from P-TOOLS. The images looked consistent with the DOM values I read.
- Probes: none, so no number here is a probe number.

## Next review

At the end of the first Deepen cycle or the v0.5 Preview gate, whichever comes first, and **not before epic 1
exists**: a third rotation review with no instrument should refuse to score (T-023) rather than average the floor in.
The bar from review #1 stands: at least 2.9, against probe output.

### Transferable (for the Sunday fold)

- A catalogue of purchasable effects needs a test derived from the catalogue itself: each entry marked live must
  change the number it names, measured with and without it. ISP sold twelve CEO programs and applied one
  (AB#983). Sibling of P-INERT-FEATURE, at catalogue scale, where no single missing wire is visible.
- Restate what a unit is *worth* in three places in three units and the financial statements describe a game nobody
  is playing (AB#984). Book revenue once, where cash arrives.
- A fresh clone is an environment nobody runs. ISP's tests, its market seeding and its `dummy-reset` all depend on a
  gitignored file, so the first thing a new checkout shows is an empty exchange (#574, #588). Run the product from a
  clean clone before calling an environment acceptance done.
