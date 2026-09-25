# MONETIZATION — interstellar-settlement-protocol

One `## Review #N — <date> · **x.x / 5 · VERDICT**` section per Monetization Critic review, newest first.

## Review #2 — 2026-09-25 · **1.8 / 5 · REPRICE**

Reviewer: Monetization Critic (Claude Sonnet 5; `personas/models.json` lists `opus` for the Critic. Context not fresh:
this session had already run a depth review and an ad hoc systems audit of this same product before the Board
assigned the metric change to monetization. The Board was told so and directed the review to proceed anyway rather
than wait for a `/clear`.) · probes: `ops/probes/isp-runway.ts` (ISP-84/AB#773, built since review #1 — epic 4 is
done)
Stage: Build (v0.5 Beta MVP, AB#389)
Previous score: 1.8/5 (review #1, 2026-09-20; evaluable-only 3.5, same as this review)
Build read: `origin/main` at `edf1b7a`, clean worktree, `npm ci`. Origin moved twice while this review was being
written (`c341c96` → `edf1b7a`, four PRs); the second move landed exactly one of this review's own findings before
it could be filed — see epic 3 and "then the history" below, both written against the final commit.

**Read the headline against the last one, not instead of it.** The number is unchanged — still no SKU exists, so
four of six gates still fail closed — but three of review #1's five epics have shipped since, and the gate that
matters most for whether this product can ever be monetized (Sink depth) failed for the **opposite reason** this
time. That is the finding worth reading past the number for.

### What is already known

Review #1's research still stands and is not re-run: EVE's PLEX precedent (indirect monetization is tolerated,
direct is not, and both are inflationary), the transaction-fee model for trading games, and "sinks before taps" as
the balance instrument. One addition, from this session's own systems-audit pass earlier today, cited again here
because it bears directly on Sink depth: EVE's and RuneScape's retention both rest on **permanent, uncapped
progression that a player spends years and money-equivalents pursuing** — which is exactly the resource this
product's sink curve needs to point at, and exactly what it does not yet have past Level 1.

### Probe numbers

**Epic 4 from review #1 is done.** `ops/probes/isp-runway.ts` now reports the RUBRIC's own probe column for this
table — "gems banked vs spent per day, by profile" — from a real bot run against the real HTTP handlers, not read
from source. Run today, 30 simulated days, seed 7000, two supply settings, against a clean `origin/main` worktree
(the same run this session already used for a systems audit; reused here rather than re-run, since nothing has
changed on `origin/main` in between):

```text
                    HIGH SUPPLY                          LOW SUPPLY
PLANNER  credits banked/spent, day 3/7/30: 0.00x / 0.00x / 0.00x     0.00x / 0.00x / 0.00x
         credits at end: 0  (earned 42,598 / spent 206,702)         0  (earned 1,112,956 / spent 1,033,276)
GREEDY   credits banked/spent, day 3/7/30: 0.00x / 0.00x / 0.00x     0.00x / 0.00x / 0.00x
         credits at end: 0  (earned 20,832 / spent 208,137)         0  (earned 15,870 / spent 265,902)
highest corporation level reached, every run: 1 (of 10 defined)
```

Review #1's acceptance target for the next review was **"banked ÷ spent stays below 3× at day 3, 7 and 30"** and
**"the bot reaches the documented maximum corporation level and still has purchases available at it."** The first
number is met by an enormous margin — 0.00x is below 3x — and that is exactly the wrong way to meet it. Review #1's
economy accumulated credits **without bound** past minute 120, because nothing was worth buying. This economy's
bots reach **zero credits and stay there**, refused on `start-mining: requires [900–1,900] credits, current
reserves: 0` between 900 and 1,700 times per run, in every one of the four runs. The second target — reaching the
maximum defined level — fails outright: every run stops at Level 1 of 10, and this session already traced why and
filed it (AB#1753, below): Level 2 requires a lease specifically on Mars, and Earth is the cheaper lease every bot
and the game's own documented cheapest path picks first.

**One caveat on the zero-balance number, stated because the RUBRIC asks what a probe measures and not just what it
reports:** the probe's bots appear to reinvest every available credit rather than ever choosing to bank a reserve,
so "ends at 0" may be a property of the bot policy rather than of the economy. I have not yet built a bot that
banks a margin and can tell the two apart — that is epic 1 below, and until it exists, Sink depth's score below is
bounded by this uncertainty on both sides.

### Honesty audit (pass/fail, judged first)

Re-run rather than assumed. Whole-repo grep for the same payment/pricing vocabulary as review #1
(`stripe|paypal|paddle|checkout|real.?money|\$[0-9]|usd|subscription|premium|microtransaction|iap|in-app|paywall|
donat|patreon|ko-fi|battle ?pass|season pass|loot ?box|gacha`), excluding `node_modules` and `package-lock.json`:
same three categories of hit as before (in-game credits formatted with `$`, "premium" as flavour text, `Intl.
NumberFormat` currency code), nothing new, nothing touching real money. No payment library, no ad SDK, no analytics
vendor. **Zero real-money SKUs, zero offer surfaces — same as review #1.**

One surface materially changed and worth re-auditing: the **suggested-listing-price helper** review #1 flagged as
quietly steering every seller toward the NPC bid (`public/scripts/app.js:920–964` at the time) has been rewritten
(`public/scripts/suggestedPrice.js`, AB#1166/ISP-87). It now suggests the most recent traded close, and its own
comment states the fix plainly: *"it no longer floors itself at the standing bid... a seller who wants to move
stock before the bid recovers needs to be able to undercut it."* The price-discovery problem review #1 declined to
score against is resolved.

| Surface | Fake urgency/scarcity | Inflated baseline | Fabricated social proof | Odds shown | Paid random rewards | Pass? |
|---|---|---|---|---|---|---|
| Real-money offers (any) | n/a — none exist | n/a | n/a | n/a | n/a | **PASS** (vacuously) |
| NPC standing bids | Real daily quota, now much smaller and drifting with volume (AB#777) rather than 1,000,000 units/day; still not theatre — it moves because it was traded against | No baseline claimed; the bid drifts down under supply and recovers, shown as what it is | Own table, own heading, separate from player listings | n/a — deterministic | n/a | **PASS** |
| Player sell listings | No countdowns, no "N others viewing" | No strike-through pricing | Unchanged from review #1 — no fabricated proof | n/a | n/a | **PASS** |
| Suggested-price helper | none | Fixed since review #1 — no longer artificially floors at the bid | n/a | Client-side, but changes nothing a player pays | n/a | **PASS** |
| Missions, research, CEO insight | Durations stated up front; 2 of 12 CEO Insight programs still labelled "planned" and refused rather than sold (AB#983) — an honesty improvement over review #1, which had all 12 sellable and 11 inert | Costs stated in credits | Institutional senders (ISA, GEX) | Deterministic | n/a | **PASS** |

**Honesty: PASS**, on the same grounds as review #1 and slightly stronger evidence: the one thing that could have
been a quiet dishonesty (selling a program that does nothing) is now refused rather than sold.

### What each SKU is worth in play time

No SKU exists. Unchanged from review #1; the table is still empty by design, not by omission.

### Scores (RUBRIC Monetization table)

Scored blind against the probe and the code, before re-reading review #1's own scores (its narrative history was
read earlier in this session, for the bug-status checks P-STALE-VERDICT requires — noted here rather than left
implied, since strict ordering was not possible in a non-fresh context).

| Gate | Score | Evidence |
|---|---|---|
| Value perception | **1 (n/s)** | No SKU. Fails closed. |
| Sink depth | **2** | Real subject, opposite failure from review #1. Then: credits accumulated without bound past minute 120 because nothing was worth buying — "gems pile up with nothing to want," the RUBRIC's own definition of a 1, scored 2 for a real first-session squeeze. Now: the probe's own banked/spent ratio is 0.00x at every checkpoint in all four runs, and both bots sit refused to mine for want of a four-figure sum for the rest of a 30-day run. Neither state is "something worth buying most sessions" (a 3): one had money with nothing to spend it on, the other has nothing to spend. Scored 2, not 1, because — as with review #1 — a real, structural squeeze exists (the curved cost from AB#775 makes the core loop tight by design); it is scored no higher because the squeeze has gone from "loose" to "possibly too tight to ever exit," which is not yet distinguishable from a probe artifact (see caveat above), and because the ladder gate (AB#1753) means no run has ever reached the point past Level 2 where the RUBRIC's later sinks (13 research nodes, 12 CEO-insight programs, larger facilities) would even be reachable to test. |
| Price ladder | **1 (n/s)** | No prices. |
| Spend moments | **1 (n/s)** | No offers. Still the product's honest strength: nothing can interrupt the good part because nothing interrupts at all. |
| Free path | **5** | Unchanged. The whole game is still free in the strongest sense: no content, system, station, body, research node or exchange function sits behind money. |
| Spending runway | **1 (n/s)** | Nothing to buy with money past $0. |
| **Average, headline** | **1.8** | (1+2+1+1+5+1) ÷ 6 = 1.83 → 1.8. Identical to review #1's headline; the sameness is coincidence, not stagnation — see "then the history" below. |
| **Average, evaluable only** | **3.5** | (2+5) ÷ 2 = 3.5, same two gates as review #1, same figure. Not the headline, for the same reason DOCTRINE gives: it would open the Live gate on a question nobody has asked. |
| Honesty | **PASS** | No offer surface exists to violate it; the one near-miss from review #1 (selling a CEO Insight program with no effect) is now refused, not sold (AB#983). |

### Then the history (read in full before this section was written)

- **Epic 1 (currency and order-book integrity) is done.** AB#423 (unauthenticated credit setter), AB#425
  (order-book truncation destroying goods) and AB#433 (unvalidated corporation names) are all `Resolved`, verified
  by re-reading each work item rather than trusting the tag (P-STALE-VERDICT). The specific worry review #1 named —
  *"the day ISP charges for anything, this is a refund event and a chargeback event"* — no longer has these three
  open doors.
- **Epic 4 (the probe) is done**, and its output is what this review is built on instead of source-reading.
- **The suggested-price fix (noted, not scored, in review #1) is done** — see the Honesty audit above.
- **Epic 3 is half done, as of the commit this review closes on.** `tests/unit/no-payments.test.js` (AB#779,
  ISP-89) landed on `origin/main` while this review was being written, citing this product's Critique #434 epic 3
  by number, and does exactly what was asked: it scans every `server/` and `public/` file for payment vocabulary,
  fails on anything outside a named, checked allowlist, and asserts it scans a real number of files rather than
  passing vacuously. Confirmed by reading the test, not by trusting its name. The other half of the same epic —
  writing the constraint into `BRIEF.md` — is still outstanding: the Monetization section is byte-for-byte what
  review #1 quoted, and the Board has since given an **explicit, general rule** that supersedes review #1's
  narrower ask, in a decision comment nobody has copied anywhere it would be read again — **"Research and Insight
  should never be sellable. Items should always be sellable"** (AB#980, answering the re-asked AB#699). That
  sentence is exactly what P-WRITE-ONLY describes: written once, read by the PM session that closed the ticket, and
  by nobody since — including, until now, this test.
- **Epic 5 (repo privacy, AB#415 remediation) is partially settled by Board decision, not by the fix it asked for.**
  AB#415 is `Closed`, and I verified directly — `git log --all` for `data/accounts-snapshot.json` across every
  ref in the current checkout returns nothing, which is consistent with a history purge having actually happened
  rather than the file merely being gitignored going forward. Repo privacy itself was answered separately and
  differently than the epic assumed: **"Not for the time being"** (AB#698, Board decision) — a legitimate Board
  call, not a defect, and epic 5 should be considered closed rather than carried forward.
- **Sink depth's acceptance target is not met, and not met for a new reason.** Traced to a cause shared with the
  Depth loop: **AB#1753** (filed by this session earlier today, severity 2) — Level 2's requirement is pinned to a
  lease specifically on Mars, and Earth is the cheaper lease every bot and the game's own economy model picks
  first, so nothing in this build has ever been played past Level 2 by simulation. Sink depth cannot be honestly
  scored above the level this defect permits reaching, and it will not move until that gate does.

### Security (scored as part of this review, per role)

Re-verified rather than re-filed (P-STALE-VERDICT): #423, #425, #433 confirmed `Resolved` above. Two new findings
from this session's earlier systems-audit pass bear directly on monetization readiness and are cross-referenced
rather than re-filed:

- **AB#1753** — the Mars-lease gate — is the reason Sink depth cannot be scored past what a broken tutorial permits.
  It is a Depth-shaped bug with a Monetization consequence, exactly the shape review #1's own process note
  anticipated ("epics 1 and 2 below are the same body of work as Depth epic 1").
- **AB#1754** — `ECONOMY.md`'s own model script still claims the pre-AB#775 economy ("the maximum always wins"),
  which means anyone pricing a future SKU against the *documented* economy rather than the *shipped* one would be
  pricing against a economy that no longer exists.
- **Currency integrity has a new, positive foundation not in review #1's scope**: `server/finances.js`'s ledger
  (AB#712) now routes every credit movement through one recorder, and daily P&L/cash-flow/balance-sheet statements
  exist per corporation (AB#713/714). Neither was audited line-by-line this session — noted as the money-plumbing
  layer to check first in review #3, ahead of any pricing work, the same way #423/#425/#433 were checked first here.
- Data collected remains proportionate; AB#415's remediation is resolved per above. Repo privacy remains a live,
  answered Board choice, not an open item.

### What a player feels, in money terms, at minute 5 / 30 / 120 / day 3 / day 14

Materially different from review #1 past minute 30, now that a real bot has actually played it rather than a model
being read.

- **Minute 5–30.** Unchanged and still the product's best sequence: weighty starting capital, a real cash-flow
  squeeze once mining starts, nothing for sale for real money anywhere in it.
- **Minute 120 onward.** Review #1 predicted a dominant strategy that prints money forever. It does not: the curved
  cost (AB#775) and the drifting bid (AB#777) together mean a corporation that keeps mining without managing its
  throughput **runs itself to zero and stays there**, refused a four-figure restart for the rest of the month. The
  future offer review #1 worried about — "buy your way out of the minute-30 constraint" — is now a live temptation
  at every later point too, not just once, because the constraint never fully releases.
- **Day 3–30.** Never observed by simulation past Level 1–2. Review #1's "day 14: rich and stuck" is now, provisionally,
  "day 3: broke and stuck" — the opposite wallet, the same verdict: nothing exists for a shop to sell into, because
  the game has not yet demonstrated it can carry a corporation past its own tutorial.

### Charter / Soul risks

- **Charter "energy/cooldown gates that exist only to sell clocks"** — still passes; nothing shortens a wait for
  money, and nothing is proposed to.
- **The Board has pre-committed, in writing, to the PvP-advantage constraint review #1 recommended**, and gone
  further than asked. Since review #1: **"we don't want any player to be able to gain an unfair advantage by
  trading anything in game for real money — this would be a violation of the Real Money Trading rule"** (AB#703,
  covering all v0.9 financial mechanics); **"all" v0.10 military mechanics may never be sold or accelerated**
  (AB#706); and the sharper, general rule already quoted above (AB#980). This is the single best sign in this
  review: the company is writing its no-RMT line before any revenue pressure exists to test it, exactly as T-021
  asks. The gap is that none of it lives anywhere a builder under deadline would read it — it is ADO comments, not
  `BRIEF.md` and not a test. Closing that gap is epic 3 below.
- **A new financial mechanic is Board-approved in principle and not yet built**: corporate shares, priced at
  company value ÷ share count (AB#704). This is the first mechanic in this product where real value could route
  through something other than the credit ledger, and it should be designed against the RMT rulings above from its
  first commit, not audited afterward.
- **Charter "infinite scope,"** in money terms: the ladder still advertises a multi-year, 40-level arc and cannot
  currently be simulated past Level 1. Any future pricing referencing progression prices against content that is,
  by measurement, unreachable.

### Verdict: **REPRICE**

Not HEALTHY, for the same reason as review #1: no SKU has ever been priced, and calling it HEALTHY would open the
Live gate on a question nobody has asked. Not COERCIVE: Honesty passes cleanly, and the Board's own pre-emptive
RMT rulings are the opposite of coercive design.

REPRICE still means "not cleared, and here is ranked work," not "your prices are wrong" — there are still no
prices. Three of review #1's five epics shipped; the work below is what is left, plus what today's probe run found.

### Epics (≤5, ranked)

| # | Epic | Hypothesis | Probe target (acceptance) | Size | Charter risk check |
|---|---|---|---|---|---|
| 1 | **Give the runway probe a bot that banks a reserve, alongside planner and greedy** | Sink depth cannot be honestly scored while "ends at zero" might describe the bot's spending policy rather than the economy; a third profile that keeps a safety margin (or none) tells them apart | The three profiles' banked/spent ratios diverge measurably by day 7; review #3 reports which one the economy actually rewards | S | None; measurement only |
| 2 | **Fix AB#1753 (the Mars-lease gate) as a monetization precondition, not only a depth one** | No sink past Level 2 has ever been exercised by simulation; Sink depth's score is bounded by this until it moves, whatever the economy's real shape turns out to be | The runway probe reaches at least Level 5 in the same run that reports Sink depth | S–M | None; already filed, cross-referenced here |
| 3 | **Write the Board's RMT rulings into `BRIEF.md` by name** — the guard test half of this epic is done (AB#779); fold AB#703, #706 and #980 into the Monetization section itself (research and CEO Insight effects never sellable; all v0.9 financial and v0.10 military mechanics never sellable or accelerable for real money; items always sellable) | P-WRITE-ONLY: three explicit Board rulings exist and none of them is in the one document a session under deadline reads before shipping a shop, even though the code-side guard against it now exists | `BRIEF.md`'s Monetization section names all three rulings verbatim, each with its decision number | XS | None; constrains scope only |
| 4 | **Design the shares mechanic (AB#704) against the RMT rulings from its first commit**: share price derives only from in-game company value, no path from real money to share ownership or price, before any code exists | Cheapest possible moment to bind a Charter constraint to a mechanic is before it is built (T-020); a shares system built first and constrained after is exactly how #433 and the CEO-insight tax edge happened | A story for the shares system cannot merge without an acceptance line citing AB#703 and AB#980 by number | S, Board-adjacent | Is the constraint itself; nothing to check against |

Epics 1 and 2 are the same measurement work the Depth loop needs and should be one story set, not two, per review
#1's own process note. Epic 3 is cheap and overdue. Epic 4 is a design gate on work that has not started yet, not
a fix.

### Next review

At the v0.5 Preview gate, or immediately if a payment surface or the shares mechanic appears in the repo. What
review #3 must show: the runway probe reaching past Level 2 (AB#1753 fixed), a banked-reserve profile distinguishing
bot policy from economy shape (epic 1), and `BRIEF.md`/a test actually carrying the Board's RMT rulings (epic 3). If
any of those three is still missing, review #3 should say so in the same words rather than restate this review.

### Transferable (for the Sunday fold)

- A sink-depth failure can flip from "too shallow" to "too tight" between two reviews of the same gate, and the
  RUBRIC's 1/3/5 anchors only describe one direction of it. A probe that reports a single ratio (banked ÷ spent)
  cannot by itself distinguish "nothing to buy" from "nothing to buy with" — both read as a low, flat number. Score
  the mechanism, not just the ratio, and say which failure mode the evidence shows.
- An explicit Board ruling recorded as a decision comment and never copied into the document a builder actually
  reads is a promise nobody keeps, by construction — this is P-WRITE-ONLY applied to policy rather than to code.
  Three separate no-RMT rulings (AB#703, #706, #980) exist for this product and none of them is in `BRIEF.md`.
- Design a new financial mechanic's abuse-resistance before it exists, not after: the cheapest moment to bind a
  Charter constraint (T-020) is the first commit, and every prior violation on this product (the CEO-insight tax
  edge, corporation-name impersonation) was found after the mechanic shipped rather than before.

---

## Review #1 — 2026-09-20 · **1.8 / 5 · REPRICE**

Reviewer: Monetization Critic (fresh context, session `critic-mu98dmgc-8f8aa0`) · probes: **none exist**
Stage: **Build** (onboarded 2026-09-20, Board decision #353; Preview acceptance is v0.5, AB#389)
Previous score: — (first monetization review)
Commit read: `b5c060f`. Run reason: Board ran "Monetization Critic review" from the Console — this is not the
weekly sweep, which would not have selected this product (`ops/control-plane/src/policy.ts:163` filters the sweep
to Preview/Deepen/Live). A Board-initiated baseline on a Build-stage product is a legitimate thing to ask for and
I have treated it as one; it is not a dispatcher defect and no bug is filed for it.

**Read the score as a gate state, not as a quality judgement.** This product sells nothing. There are no SKUs, no
prices, no currency purchases, no ads, no subscription, no payment integration and no offer surface of any kind,
and the brief says there should not be any before 1.0. The low number is what happens when four of the six gates
have no subject and DOCTRINE's "fail closed" is applied to them (arithmetic below). Nothing here says "your
prices are wrong". It says "this gate is not open yet, and here is the work that decides whether it ever can be".

---

### What is already known

Searched before scoring, per DOCTRINE ("look for the existing answer before generating your own").

- **A player-driven market tolerates monetization filtered *through* the market, and refuses it sold directly.**
  EVE's own long-running argument is the worked example: players "absolutely will not stand for CCP selling things
  like ships directly for cash, but they're OK with CCP selling PLEX that can be traded for ships"
  ([Engadget, *Do PLEX make EVE pay-to-win?*](https://www.engadget.com/2013-03-10-eve-evolved-do-plex-make-eve-pay-to-win.html),
  [CCP, *ISK and PLEX*](https://support.eveonline.com/hc/en-us/articles/14141550499612-ISK-and-PLEX)). The same
  sources record the cost: PLEX volatility feeds inflation and "mak[es] the climb steeper for new and returning
  players", and PLEX is now reckoned at more than half of the New Eden economy
  ([The Ancient Gaming Noob, 2025](https://tagn.wordpress.com/2025/04/26/more-ripples-in-the-eve-online-plex-market/)).
  Carry into ISP: the indirection that makes it *acceptable* is also what makes it *inflationary*, and ISP is
  aimed squarely at EVE's market-window players, who will apply exactly this test.
- **The transaction fee is the published non-advantage model for trading games.** Publishers routinely take a cut
  of every player-to-player trade rather than selling goods, alongside cosmetics and subscriptions
  ([Wikipedia, *Video game monetization*](https://en.wikipedia.org/wiki/Video_game_monetization);
  [Gamasutra/Game Developer, *Virtual Economic Theory: How MMOs Really Work*](https://www.gamedeveloper.com/business/virtual-economic-theory-how-mmos-really-work)).
  This matters more than it looks: **ISP already has the house cut.** The 8% GEX sales tax
  (`server/gameState.js:944`) is structurally the same instrument, currently pointed at a credit sink rather than
  at revenue. The monetization design question for this product is therefore not "what do we add" but "what do we
  do with the lever already in the build".
- **Sinks, not sources, are the balance instrument.** The same MMO-economy literature describes healthy virtual
  economies as soft and hard currencies with *sinks that drain* them, and prescribes designing the drains before
  the taps. This is the gate ISP fails today and the reason the review's one genuinely low scored gate is Sink
  depth, below.
- **Nothing relevant found** on the narrow question of whether a fixed-price NPC bid with unbounded depth
  suppresses monetizable demand in a small player economy; searched, and found only general commentary on
  auction-house behaviour ([arXiv 1603.07610](https://arxiv.org/pdf/1603.07610)). The argument I make about the
  24-credit bid below is **our own reasoning from this build's numbers**, and the Depth Critic reached the same
  conclusion independently five hours earlier — which is agreement between two readings of the same source, not
  two pieces of evidence.

### Probe numbers

**There are no probes for this product**, and none for monetization specifically on any product: `hq/ops/probes/`
contains one file, `relic-vault-runway.ts`. The Depth review of this morning said the same thing and made writing
them epic 4 of its DEEPEN verdict; that epic is still the right one and this review does not duplicate it.

Consequence, stated plainly rather than buried: **every number below is read out of `data/*.json` and `server/*.js`,
not measured from play.** The RUBRIC's Monetization probe column asks for "minutes of planner-bot play to earn each
SKU's contents" and "gems banked vs spent per day" — I can produce neither, and I have deliberately not converted
anything into minutes, because no human pace has ever been measured for this product (T-002, P-PROXY). I also could
not run the test suite: `npx vitest run` cannot start, `node_modules` has no `vitest`, and devDependencies are not
installed in this container. "Did not run" is not "passed" (T-008), so this review reports nothing about test state.

Numbers used below, each hand-checkable from the cited line:

| Quantity | Value | Where |
|---|---|---|
| Real-money SKUs in the build | **0** | whole-repo grep for payment/pricing vocabulary, below |
| Payment integrations | **0** | no `stripe`/`paypal`/`paddle`/`checkout`/IAP anywhere outside `package-lock.json` |
| Currencies | **1** (credits, earned only) | `server/gameState.js:1110` |
| Starting credits | 250,000 | `server/gameState.js:1110` |
| GEX sales tax (the house cut) | **8%**, reducible to **2%** | `server/gameState.js:944`; `data/ceo-insight.json:6` |
| Silicate NPC standing bid | 24 credits, 1,000,000 units/day, fixed | `server/gameState.js:1488` |
| Credit sinks in the build | ~13 distinct, 500 – 75,000 each | `server/index.js` (enumerated under Sink depth) |
| Research + CEO insight queued cost | 13 + 12 nodes | `data/research.json`, `data/ceo-insight.json` |
| Corporation levels reachable / defined / advertised | **5 / 10 / 40** | Depth review #1, `data/milestones.json` |

### Honesty audit (pass/fail, judged first)

The RUBRIC says audit *every offer surface in the build*. In this build the set of commercial offer surfaces is
empty, so the audit is in two parts: I verified that emptiness rather than assuming it, and then audited the
surfaces that **do** present a price to a player — the exchange order book, the NPC standing bids and the
in-fiction copy — because those are the surfaces a future SKU would attach to and they are where dishonesty would
first appear.

Verification of "no monetization" (the negative claim, so the method matters): whole-repo grep, excluding
`node_modules` and `package-lock.json`, for `stripe|paypal|paddle|checkout|real.?money|\$[0-9]|usd|subscription|
premium|microtransaction|iap|in-app|paywall|donat|patreon|ko-fi|battle ?pass|season pass|loot ?box|gacha`. Every
hit was one of three things: in-game credits formatted with a `$` sign in the design docs; the word "premium" as
set dressing (a CSS section header; an insurance building's flavour text about premiums; one mission describing a
"premium-rate contract" paid in credits); and `currency: "USD"` at `public/scripts/app.js:537`, which is
`Intl.NumberFormat` being used to render **credits** with a dollar sign and a thousands separator. Nothing
touches real money. There is no ad SDK, no analytics vendor, no payment library.

| Surface | Fake urgency / scarcity | Inflated baseline | Fabricated social proof | Odds shown | Minors: no paid random rewards | Pass? |
|---|---|---|---|---|---|---|
| Real-money offers (any) | n/a — none exist | n/a | n/a | n/a | n/a | **PASS** (vacuously) |
| NPC standing buy orders (`Standing Buy Orders`, `public/index.html:625`) | The daily quota and "Only N units remaining in today's order" (`server/index.js:3239`) are real limits on a real reset (`checkAndResetNpcBuyOrders`, `server/index.js:442`), not theatre — and at 1,000,000 units/day the limit is far beyond reach, so it never pressures anyone | Bid is a flat 24, never marked down from anything | Rendered in its own table under its own heading, separate from player listings — a player can tell an NPC bid from a corporation's listing | n/a — deterministic | n/a — nothing paid | **PASS** |
| Player sell listings (`market-sell-grid`) | No countdowns, no expiry, no "N others viewing" | No strike-through or "was" price anywhere | **Weak** — see finding below | n/a | n/a | **PASS, with a filed defect** |
| Suggested-price helper (`public/scripts/app.js:920–964`) | none | The suggestion is weighted 5× toward the NPC bid and then **floored at it**, and the code comment calls that bid the "published 'fair value' floor" set by "the GEX commodities authority" | n/a | The weighting is in client source a player cannot see, but nothing is hidden that changes what they pay | n/a | **PASS**, noted below |
| Missions, mail, research, CEO insight | Durations are stated up front and fixed; nothing expires punitively | Costs stated in credits, no discount framing | System mail is clearly institutional (ISA, GEX) | Yields are deterministic | n/a | **PASS** |
| Random reward mechanics anywhere | — | — | — | Asteroid expedition yields vary; no purchase can influence them and nothing is bought | **PASS** — no paid random rewards exist, so the minors question does not arise | **PASS** |

**Honesty: PASS.** Not a grudging pass. There is no energy gate, no streak, no loss timer, no countdown on an
offer, no inflated "was" price, no paid random reward, no ad and nothing sold. The one daily reset in the game is
1,000,000 units wide and therefore never bites. A product that has deliberately built no offer surface before 1.0
is the most honest monetization state a product can be in, and the brief's line — *"Selling power in a market game
breaks the market"* — is the correct instinct written down before it could be violated. Worth saying plainly.

**One defect found by this audit, filed before writing this file (AB#433) — a corporation name is never
validated, so a player can impersonate the exchange authority on the order book** (severity 2).
`createAccount` (`server/gameState.js:2146`) checks the email and the password length and rejects a duplicate
email; `corpName` passes through untouched — no length bound, no character filter, no uniqueness check, no
reserved names — and `createStarterCorporationState` (`:1079`) stores it verbatim. That string is then the
counterparty identity on every offer surface: the order book's seller column (`server/index.js:3086` →
`public/scripts/app.js:3846`), trade history (`:3188`), forum authors (`:2911`, `:2955`) and in-game mail
(`server/gameState.js:2373`). A player can register as "GEX Commodities Authority" or as "ISA Mineral Survey
Division" — a name the server itself sends mail as (`server/index.js:546`) — or simply duplicate a rival's name,
and list goods that no reader can distinguish from the exchange's own bids shown in the table directly beneath.
`escapeHtml` stops markup injection; it does not stop impersonation, because the attack is the plain text. In a
game whose stated second metric is "orders filled by another player rather than by an NPC anchor", the
counterparty's name is the *only* trust signal the order book carries.

This does **not** fail the Honesty gate, and the distinction is worth being precise about: the RUBRIC's Honesty
gate audits what *we* do to a player, and we are doing nothing dishonest. #433 is a hole through which a player
can be dishonest to another player. It is filed as a bug and ranked first in the epics because it is on the
critical path to the thing this product wants to be, not because it is a monetization sin.

**Noted, not scored against:** the suggested-price helper floors its suggestion at the NPC bid, so the UI will
never suggest a price below 24 even when the market is glutted and a seller would rationally undercut. It nudges
every seller to the same number and hides the one signal a market is supposed to produce. That is a price-discovery
problem (and reinforces Depth epic 3), not a dishonesty; the number it shows is a real bid a player really can take.

### What each SKU is worth in play time

| SKU | Price | Contents | Minutes of play to earn them, when offered | Verdict |
|---|---|---|---|---|
| — | — | — | — | **No SKU exists.** Nothing in this build can be bought with money. The table is empty because the product is pre-monetization by design (BRIEF: "None yet, and none before 1.0"), not because I could not price it. |

### Scores (RUBRIC Monetization table)

Four of the six gates have no subject: there is nothing to value, no ladder to compare, no offer to time, and no
runway to spend down. I will not invent scores for them and I will not quietly drop them, because dropping them
would let the average float up to a number that reads like a passing grade. DOCTRINE is explicit about the case:
*"Fail closed. When a check cannot run — no budget, no verdict, no gate — the answer is no, not 'probably'."* So
those four score **1, meaning "cannot be evaluated; fails closed"**, and this review says so in the row rather
than leaving a reader to guess that a 1 meant the RUBRIC's "earned in minutes of play".

| Gate | Score | Evidence |
|---|---|---|
| Value perception | **1 (n/s)** | No SKU exists, so there is no contents-to-play-time ratio to judge. Fails closed; not a finding about a price. |
| Sink depth | **2** | The one gate with a real subject and a real answer. Credits have ~13 distinct sinks — hire $2,000 (`server/index.js:1047`), payroll $150/day, office $1,000/day (`:1096`, `:1179`), leases $25–30k (`:1257`), extractor yard $50,000 (`:1557`), refinery $60,000 (`:1872`), probe and expedition launches (`:1970`, `:2053`), a $75,000 building (`:2162`), cycle startup at 35% of hourly operating cost (`:1715`), 13 research nodes and 12 CEO-insight programs at $2,000–$20,000 (`:61–171`), and the 8% exchange tax on every sale. At minute 30 that is genuinely tight: the Depth review's arithmetic has ~135,000 credits against a 96,000/day full-tilt operating cost, so the player wants more money than they have. It collapses after that. Once the extractor has paid back, revenue is `24 × T × 0.92`/h against `16 × T`/h cost with no ceiling and a million-unit-a-day buyer, the queues total 13 + 12 one-off purchases, and the ladder stops at Level 5 (#424) so the late sinks the milestones point at are unreachable. **Credits pile up with nothing to want**, which is the RUBRIC's own definition of a 1 — I score 2 rather than 1 because the first session's squeeze is real and well made. Nothing can be sold honestly into an economy whose currency has no destination; this is the gate that decides whether this product can ever be monetized, and it is the one to fix first regardless of monetization. |
| Price ladder | **1 (n/s)** | No prices. (The *internal* credit ladder is coherent — costs rise roughly with commitment from a $2,000 hire to a $75,000 facility — but that is not what this gate measures and I am not going to launder it into a passing score.) |
| Spend moments | **1 (n/s)** | No offers, so there is nothing to time. Recorded as the product's strength in the Charter section: there is no offer director, no interstitial, nothing that can interrupt the good part (T-004) because nothing interrupts at all. |
| Free path | **5** | The only gate that earns its score on the merits. **The whole game is free**, in the strongest sense available: not "completable without paying" but "there is no paying". No content, system, station, body, research node or exchange function is behind money. A player who never spends gets 100% of what exists. |
| Spending runway | **1 (n/s)** | Nothing to buy past $0, let alone past $20. Fails closed. |
| **Average** | **1.8** | (1 + 2 + 1 + 1 + 5 + 1) ÷ 6 = 1.83 → **1.8**. Mean of the two gates that have a subject is 3.5; that figure is on record here and is deliberately **not** the headline, because a 3.5 computed from two gates would open the Live gate for a product that has never priced anything. |
| Honesty | **PASS** | No fake urgency, no fake scarcity, no inflated baseline, no fabricated social proof by us, no hidden odds, no paid random rewards — because there are no paid anything. Verified by whole-repo grep plus a surface-by-surface audit, both shown above. |

### Security (scored as part of this review, per role)

The Depth Critic filed three findings this morning; I re-checked each against the tracker before writing
(P-STALE-VERDICT) — **#423, #424 and #425 are all still `Proposed`, none fixed.** I am not refiling them. What I
add is the monetization reading of two of them, which changes their priority:

- **#423 (`POST /api/dev/set-credits`, unauthenticated, account id taken from the request body,
  `server/index.js:869`) is a currency-integrity hole, not only an auth hole.** Confirmed still present at
  `b5c060f`: the guard is `const ALLOW_DUMMY_AUTH = true` (`:281`), so its own message "Dev endpoints are disabled
  in production" is unreachable code, and the route carries no `requireAuth`. Any caller on the internet sets any
  corporation's balance to any number. In a single-player game that is a cheat; in a game with a **shared order
  book**, minted credits are spent against other players' listings, so one caller can drain every seller's goods
  and arbitrarily move every price the suggested-price helper then anchors to. `JWT_SECRET` falling back to the
  in-repo literal `"isp-dev-insecure-secret-change-me"` (`:280`) is the same fail-open shape. The day ISP charges
  for anything, this is a refund event and a chargeback event, not a bug report. Fix it before monetization is
  even designed, not as part of it.
- **#425 (order-book truncation destroys goods, `server/index.js:3093`)** — confirmed: the seller's inventory is
  debited first, then `draft.market.orderBook.slice(0, 200)` silently discards the oldest order and everything in
  it. 200 one-unit listings clear every other player's goods off the exchange. This is the marketplace's
  settlement layer losing property. No money needs to be involved for that to be the single worst thing that can
  happen to a trading game's reputation, and it is a ~10-line fix (cap per seller, reject when full, or evict only
  after refunding the evicted seller's inventory).
- **Data collected is proportionate** to the product: email, bcrypt hash, corporation state. I found no personal
  data in logs or URLs. The accounts snapshot recorded in the brief (AB#415) is gitignored but **still in public
  git history** with 129 password hashes and 106 refresh tokens; the brief's remediation list (rotate the two real
  passwords, invalidate every refresh token, purge from history) is the right one and none of it is marked done.
  This bears on monetization directly and it is worth being blunt: a payment provider's onboarding review will ask
  about credential handling, and "we leaked our own token store to a public repository and did not rotate" is an
  answer that ends the conversation. Repo privacy is still an open Board question in the brief; it should be
  closed before any payment integration is scoped.
- **No new payment-surface risk to report**, because there is no payment surface. The relevant security work here
  is entirely about protecting the currency and the order book *before* either acquires a cash value.

### What a player feels, in money terms, at minute 5 / 30 / 120 / day 3 / day 14

The Depth review covered how this feels as play. This is the same timeline read as a wallet.

- **Minute 5.** Weighty. 250,000 credits, and the guided first four purchases take 115,000 of it. Money means
  something here, and nothing is for sale for real money, so there is no moment where the fiction breaks. Best
  five minutes in the product.
- **Minute 30.** The one real financial decision: ~135,000 credits against an extractor that costs 96,000/day at
  full tilt, so you must choose a throughput you can fund until the ore sells. This is the only point in the game
  where a player would plausibly *want* to buy their way out of a constraint — which makes it the natural home of
  a future offer and, equally, the moment that a future offer would destroy. Flagged now so the decision is made
  deliberately later, not discovered.
- **Minute 120.** The constraint dissolves. A fixed 24-credit bid with a million units of daily depth buys
  everything you can produce, and the dominant strategy is max throughput, longest cycle, sell to the NPC. From
  here credits accumulate faster than the game has anywhere to put them.
- **Day 3.** The research and CEO-insight queues absorb 25 purchases, most of them $2,000–$20,000 against a
  balance now growing by six figures a day. They are consumed faster than they were meant to be, and a sink you
  can clear is a sink that has stopped working.
- **Day 14.** Rich and stuck. Level 5, with the Level 6 bar unable to fill (#424), buildings the milestones name
  that do not exist, and a balance with nothing to buy. If a shop existed at this point there would be nothing in
  it a player wanted, because the game has already given them everything it has. **This is the finding that
  matters most for monetization**: the product does not yet have a late game to sell into, and adding a shop before
  it does would produce exactly the "$1.99 pack of relics a player makes in thirty seconds" that OPERATIONS names
  as the reason this loop exists.

### Charter / Soul risks

- **Charter "we refuse: energy / cooldown gates that exist only to sell clocks"** — passes, emphatically. The
  delays in this game (research 2–18 h, refinery 4–8 h, mining 1–72 h) gate *nothing*; a player can act at any
  moment, and no mechanism exists or is proposed to shorten a wait for money. Worth recording as the baseline the
  next review will check, because "buy your way past the wait" is the single most likely first bad idea for this
  product, and it is the one the Charter already forbids.
- **DOCTRINE "monetize advantage, collection, space, and convenience — not access"** — nothing is monetized, so
  nothing violates it. But the Charter's list includes *advantage*, and this is a player-versus-player market
  game, where advantage sold to one player is taken from another. **The Charter's general permission does not
  survive contact with a PvP economy**, and the brief already says so. This review recommends the brief's sentence
  be promoted from a preference to a stated constraint, and names the specific node it protects: CEO Insight's
  `ceo-negotiation-fundamentals` line grants a permanent **−6% GEX sales tax** (`data/ceo-insight.json:6`), which
  is a direct, permanent, compounding edge over every other trader on the same order book. Earned, it is a fine
  progression reward. Sold or accelerated for money, it is the clearest pay-to-win node in the build, and its
  effect is exactly the house cut that any transaction-fee model would depend on. It should be written down as
  never-monetizable before anyone is choosing SKUs under deadline.
- **Charter "infinite scope"** — the monetization-shaped version of the Depth Critic's warning. The README
  advertises 40 corporation levels; 10 are defined and 5 are reachable. Any future pricing that references
  progression would be pricing against content that does not exist. Do not sell a season pass on a 40-level ladder
  that stops at 5.
- **Board-preference check:** every figure above is in credits, units, hours or counts a person can recompute from
  the cited line. Nothing is converted into "minutes of play", because no human pace has been measured for this
  product (T-002, P-PROXY). No price is set or suggested anywhere in this review — that is the Board's call, and
  the Monetization Critic is explicitly forbidden from making it.

### Verdict: **REPRICE**

By elimination and on the merits. **Not HEALTHY**: HEALTHY is the gate that, with a Depth DEEP ENOUGH, makes a
product a Live candidate (GOVERNANCE), and stamping it on a product that has never priced anything would leave
the monetization gate permanently green before the question was ever asked — the same shape as P-DONE-ON-MERGE,
where a state nobody meant to assert gets asserted by a mechanism. **Not COERCIVE**: Honesty passes cleanly and
factually, and COERCIVE would be a false alarm on the one product in the portfolio that has coerced nobody.

REPRICE here means **"not cleared, and here is ranked work"** — not "your prices are wrong". There are no prices.
The work below is the work that decides whether prices are possible, and every epic is something worth doing even
if the Board decides ISP never charges anyone a penny.

One process note for the Director: monetization and depth epics share one product cycle at ≤ 3 epics (OPERATIONS
§4), and this product already has five DEEPEN epics from this morning. **These are a ranked menu to interleave,
not five more items.** Epics 1 and 2 below are the same body of work as Depth epic 1 — currency and ladder
integrity — and should be merged into one story set rather than filed twice.

### Epics (≤5, ranked)

| # | Epic | Hypothesis | Probe target (acceptance) | Size | Charter risk check |
|---|---|---|---|---|---|
| 1 | **Make the currency and the order book un-forgeable, before they are worth anything** — fix #423 (`requireAuth` + `requireAccountAccess` on `/api/dev/set-credits`, or delete the route; derive `ALLOW_DUMMY_AUTH` from `NODE_ENV` so it fails closed; make a missing `JWT_SECRET` refuse to boot rather than fall back to the in-repo literal), #425 (never debit inventory before an insert that can be discarded; cap or reject rather than silently evict; validate quantity so `NaN` cannot reach persistence) and #433 (validate and reserve corporation names) | These are three ways to mint, destroy or misrepresent value on a shared market. Each is cheap now and each becomes a refund, a chargeback or a trust incident the moment money is attached — and the order-book one destroys players' goods today, with no money involved at all | A test suite asserting: an unauthenticated `set-credits` returns 401/404 and the route is absent when `NODE_ENV=production`; boot fails with no `JWT_SECRET`; 250 sequential listings from two accounts lose no inventory and no order; `quantity: 'abc'` is rejected and no `NaN` reaches persistence; every `fromName` the server emits is refused as a corporation name, iterating the exported sender list rather than a copy | S–M | None. Removes capability, adds no scope |
| 2 | **Give credits somewhere to go past Level 5** — merge with Depth epic 1 (the ladder, #424) and treat the sink curve as its acceptance: sinks that scale with income (recurring facility upkeep, tiered leases, a capital cost that rises with corporation size) rather than 25 one-off purchases | Sink depth is the only scored gate with a subject and it scores 2. Nothing can be honestly sold into an economy whose currency already has nothing to buy; this gate is a precondition for *every* later monetization epic, and it is worth doing on its own merits for retention whether or not ISP ever charges | Sink probe: credits banked ÷ credits spent per day stays below 3× on a planner-bot profile at day 3, day 7 and day 30 (today it grows without bound after ~minute 120); the bot reaches the documented maximum corporation level and still has purchases available at it | M | Sinks must never gate *access* — an upkeep a player cannot pay must degrade output, never lock them out of the game |
| 3 | **Write the monetization constraint into the brief and into a test, so "none before 1.0" is code rather than prose** — a one-paragraph constraint (no sold advantage in a PvP market; `ceo-negotiation-fundamentals`' −6% tax edge named explicitly as never-monetizable; the 8% GEX tax identified as the house cut that any future model would use), plus a repo test that fails if payment or pricing vocabulary appears anywhere in `server/` or `public/` | P-WIRED-NOTHING: the brief's monetization paragraph is a promise no code keeps, and a builder under deadline in six months will not read it. A red test is a reader. It also makes review #2 trivially verifiable rather than requiring a fresh grep | The test fails on a seeded commit containing a Stripe import or a `price` field with a currency symbol, and passes on `main`; the brief's constraint paragraph exists and names the tax node | S | None. Constrains scope |
| 4 | **Write the monetization probe alongside the depth probes** — extend Depth epic 4's `hq/ops/probes/isp-*.ts` with a sink-and-banked-credits profile, so review #2 can open with raw output instead of this section's apology | Every number in this review is read from source, which is the weakest evidence the RUBRIC accepts. Review #2 cannot show movement without a baseline, and the sink number in epic 2 has no meaning until something measures it | The probe prints credits banked vs spent per day, time-to-clear for the research and insight queues, and highest reachable corporation level; review #2 quotes its output | S | None |
| 5 | **Close the two open Board questions that block any future payment work** — make the repository private (already open in the brief), and complete the AB#415 remediation: rotate the two real accounts' passwords, invalidate all 106 refresh tokens, purge `data/accounts-snapshot.json` from git history | Untracking a file does not remove it from history. A public repo containing 129 password hashes and 106 refresh tokens is a conversation-ending answer during payment-provider onboarding, and the cost compounds the longer it sits | The file is absent from `git log --all -- data/accounts-snapshot.json`; every refresh token issued before the purge is rejected; the Board's repo-privacy decision is recorded either way | S, but Board-gated | None. This is remediation the brief already committed to |

Epics 1, 3 and 4 are small and should go first; 1 overlaps nothing and removes real harm that exists today. Epic 2
is the substantial design work and is a cycle on its own. Epic 5 needs the Board and should be raised as a Decision
rather than queued as a story.

### Next review

At the v0.5 Preview gate, or when any monetization design is proposed — whichever comes first, and **immediately**
if a payment surface appears in the repo. This review is a pre-monetization baseline, so the usual "+0.5 per cycle
or kill review" rule should **not** be applied mechanically to it: the score is a fail-closed gate state, and it
cannot rise until either SKUs exist (making four gates scorable) or the Board records that ISP will never charge
(at which point the right move is to retire this review loop for the product, not to keep scoring an empty table).
What review #2 must show instead: **Sink depth ≥ 3 against probe output**, Honesty still PASS, and #423, #425 and
#433 resolved. If a shop has appeared without epic 2 landing first, that is a REPRICE on arrival.

### Transferable (for the Sunday fold)

- A monetization gate scored on a product with no monetization must **fail closed**, not pass vacuously: four
  empty gates averaged away leave a "HEALTHY" that opens the Live gate before anyone ever asked the question. Score
  the unevaluable gates at the floor, say in the row that the floor means "cannot be evaluated", and publish the
  evaluable-only average separately so nobody has to reverse-engineer the arithmetic.
- The first monetization review of a pre-revenue product is worth running **early** and is not a formality: its
  useful output is not prices, it is the list of things that must be true before prices are possible — currency
  integrity, counterparty identity, and a sink curve. Those are all cheaper to fix before money exists, and all of
  them are worth fixing even if the product never charges.
- In a player-versus-player economy, the Charter's general permission to "monetize advantage" does not hold:
  advantage sold to one player is taken from another at the same order book. Name the specific mechanic that must
  never be sold (ISP: the CEO-insight line granting a permanent −6% exchange tax) while nobody is under deadline
  to hit a revenue number.
- Check whether the house cut already exists before designing a monetization model. ISP has an 8% exchange tax
  built as a credit sink; the published non-advantage model for trading games is a cut of player-to-player trades.
  The lever was already in the build and pointed the other way.
