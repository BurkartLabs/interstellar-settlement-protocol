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
