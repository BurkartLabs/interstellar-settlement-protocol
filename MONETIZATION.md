# MONETIZATION — interstellar-settlement-protocol

One `## Review #N — <date> · **x.x / 5 · VERDICT**` section per Monetization Critic review, newest first.

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
