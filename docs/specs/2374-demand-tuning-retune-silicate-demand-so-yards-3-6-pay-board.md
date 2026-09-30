# Demand tuning: retune Silicate demand so yards 3-6 pay (Board answer, AB#2324)

Feature AB#2374 (Proposed) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits. ISP epic AB#388, following the Board's answer on Decision AB#2324 (2026-09-26): "mining quantity shouldn't be a blocker... we'll tune demand more later."
What it is. Retune Silicate (and eventually every NPC-bought item's) demand so a corporation running its yards at the best rate sells its output at a profit at any size, so yards 3 to 6 pay.
Mechanism, given directly by the Board (Advisor relay, 2026-09-26), superseding "chosen then": "So, eventually we are going to be overhauling that portion of it. For now, it's fine as is. We are going to make it so there is constant NPC trade volume. Buy orders get refilled over time. When this game is released, the intention is that the NPC buy orders will be short lived. Their price should not drop while a buy order is active, but may switch between buy orders. Players will rush to sell to the NPC buy orders because they will get a slightly better deal than P2P, which is where the majority of player trade in the game will happen." The design (AB#2376) works out the numbers; AB#2327's scratch 46,000 t/corporation/day remains one measured data point for it, not an adopted value.
Why it matters. Three pieces of real, already-diagnosed work wait on this rather than merging into a demand model about to change under them: AB#2356 and AB#2357 (both correct fixes to the standing-bid pricing under today's design, but PR 820 alone drops the ladder bot to Level 4 after 240 days - neither merges alone; the new design may also supersede them outright, since the Board's model prices a buy order once for its whole life rather than letting it sag - that call belongs to AB#2376); AB#2323 (the sink re-check, since the three sinks tax expansion that does not pay yet under today's demand).
Not scheduled. The Board said "for now, it's fine as is": no session should claim this Feature or its children (including the design, AB#2376) ahead of actually urgent work. ECONOMY.md's "Demand: the Board's rule (AB#2324)" section (AB#2375) is what AB#2376's design extends.

## Acceptance

_To be written: the Feature had no acceptance criteria in Azure DevOps._

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 7 open, 1 resolved.

### The standing bid prices a whole sale at the bid before it: 7,000 t sold in one lot are all paid the opening 24 (Bug AB#2356, Active) (lane: interstellar-settlement-protocol/economy)

What: Where: POST /api/market/npc-orders/:id/sell (server/routes/market.js). What: the route computes one unitPrice, npcBidFor(basePrice, soldToday) before the sale, and pays it for every unit of the lot; soldToday then jumps by the lot. Why it matters: ECONOMY.md (ISP-87) says a corporation that dumps volume 'pays for it twice - in the price it gets and in the price it gets tomorrow'. A seller who sells a day's output in one lot pays neither: the drift only ever hits the next seller. The economy… (the rest: AB#2356)
Symptom: One sale of 7,000 Silicates into a fresh order: traded.unitPrice 24, total 168,000. The order then shows 13 (the floor). Along the published curve, unit by unit, the same 7,000 t pay 126,299 (18.04 a tonne).
Repro: - ISP main 88e0cdf7, fresh data dir. / - A corporation at Earth Station Prime holding 7,000 Silicates sells 7,000 to npc-buy-silicates-daily in one request. / - Response: unitPrice 24, total 168,000. Selling the same 7,000 in five lots of 1,400 pays 24, 22, 19, 17, 14 (134,400).
Proposed fix: Root cause: market.js prices the lot at the bid before it (unitPrice = npcBidFor(base, soldToday); total = qty x unitPrice). Fix: price the lot along the curve, the sum of npcBidFor(base, soldToday + k) for k in 0..qty-1 (in closed form per whole-credit step, or per unit: at most 7,000 steps), report the average as unitPrice and the exact sum as total; keep the quota check. Update the receipt and trade history to show the average. Regression test: one lot of 7,000 pays the same total as 7,000… (the rest: AB#2356)

- [ ] Fixed: The standing bid prices a whole sale at the bid before it: 7,000 t sold in one lot are all paid the opening 24

### The standing bid opens every day at base: the overnight 60% recovery is shown in the table but never paid (Bug AB#2357, Active) (lane: interstellar-settlement-protocol/economy)

What: Where: checkAndResetNpcBuyOrders (server/ticks.js) and the sell route (server/routes/market.js). What: the daily reset sets soldToday = 0 and writes unitPrice = npcBidAfterRecovery(base, close). The sell route prices from basePrice and soldToday only, so the first sale of every day is paid the full base, while the table (and the mining rate advisor, which reads unitPrice since AB#1736) shows the recovered, lower bid. Why it matters: ECONOMY.md says 'a bid driven to the floor opens the next day… (the rest: AB#2357)
Symptom: After 7,000 t sold (order at 13) and the daily reset: the order shows unitPrice 20 with soldToday 0; the next seller of 100 is paid 24.
Repro: - ISP main 88e0cdf7: sell 7,000 Silicates to npc-buy-silicates-daily (order goes to 13). / - Set every order's lastResetDate to a past date and run checkAndResetNpcBuyOrders(). / - The order shows 20 (the 60% recovery). Sell 100: traded.unitPrice is 24.
Proposed fix: Root cause: the recovered bid is stored only as a display field; the price function has no notion of an opening bid below base. Fix: store the day's opening bid (openingPrice = npcBidAfterRecovery(base, close)) at the reset and price from it: bid = max(floor, openingPrice - base x drift x soldToday / quota), with npcBidFor taking the opening as an optional argument (base when absent, so old saves and every other caller are unchanged). The table, the advisor and the sale then read the same… (the rest: AB#2357)

- [ ] Fixed: The standing bid opens every day at base: the overnight 60% recovery is shown in the table but never paid

### Once the overnight recovery is paid (AB#2357), the ladder bot goes broke at Level 3: the climb relied on every day opening at base (Bug AB#2361, Active) (lane: interstellar-settlement-protocol/platform)

What: Symptom. With AB#2357's fix (a day's first sale paid the recovered bid, not the base), tests/probes/ladder-bot.test.js stops at Level 3 after 240 simulated days with 0 credits: it cannot rent the office (7,000) or start a cycle. Without the fix it climbs to Level 20. The bot sells roughly the whole world's 7,000 quota every day, so each day now opens at 20 instead of 24; its morning lot is paid 20 and its evening lot 13 to 16, about 17% less gross, and its two tier-1 yards' running cost (about… (the rest: AB#2361)
Symptom: With AB#2357's fix (a day's first sale paid the recovered bid, not the base), tests/probes/ladder-bot.test.js stops at Level 3 after 240 simulated days with 0 credits: it cannot rent the office (7,000) or start a cycle. Without the fix it climbs to Level 20. The bot sells roughly the whole world's 7,000 quota every day, so each day now opens at 20 instead of 24; its morning lot is paid 20 and its evening lot 13 to 16, about 17% less gross, and its two tier-1 yards' running cost (about 62,800 a… (the rest: AB#2361)
Repro: ISP main b534c2f0 plus branch fix/2357-recovered-bid: npx vitest run tests/probes/ladder-bot.test.js fails at Level 3; revert the two npcBidNow lines in server/routes/market.js and it passes.
Proposed fix: Confidence: medium. An Economist or Director call, one of: (a) keep the designed recovery and change the bot's policy to what the model assumes a player does (sell no more than keeps the opening bid near base, or stop the second yard when the bid is below a threshold), then re-read the climb's timings; (b) raise npcBid.recoveryPerDayPct (100 restores the old effective behaviour) or the tier-1 margins; (c) accept a harder Level 3 and document it. Recommendation: (a) first, because the bot… (the rest: AB#2361)

- [ ] Fixed: Once the overnight recovery is paid (AB#2357), the ladder bot goes broke at Level 3: the climb relied on every day opening at base

### Design the NPC buy-order model: discrete refilling orders, a stable price per order, and an edge over P2P (Board direction) (Requirement AB#2376, Proposed) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. Feature AB#2374 (Demand tuning), ISP epic AB#388. The Board gave this design's mechanism directly (Advisor relay, 2026-09-26), not chosen by a Builder or Director. / The Board's words, verbatim (Advisor tab, 2026-09-26): "So, eventually we are going to be overhauling that portion of it. For now, it's fine as is. We are going to make it so there is constant NPC trade volume. Buy orders get refilled over time. When this game is released, the intention is that the NPC buy orders will… (the rest: AB#2376)

- [ ] docs/design/npc-buy-orders.md states the order lifecycle (created at a price and quantity, price fixed for the order's life, replaced by a new order at its own price when exhausted or expired) and cites the Board's words as the source.
- [ ] It states the refill cadence and per-order size, with the model showing the majority of trade volume still must clear player-to-player at the sizes modelled - not a number that lets NPC absorption dominate.
- [ ] It quantifies "slightly better than P2P" as a real number or formula, with its reasoning (comparable to how ECONOMY.md's 1.15 refining multiplier states why it sits where it does).
- [ ] It explicitly states whether PR 820 (AB#2356) and PR 822 (AB#2357) are superseded by the new model, still needed in some form, or moot, with reasoning either way.
- [ ] It states what changes, if anything, between beta and "when this game is released" (short-lived orders is stated as a release-time intention by the Board, not necessarily a beta requirement) - name what beta should do until then.
- [ ] It names the follow-up implementation stories this design implies (filed once this lands, not guessed now) and which existing items (AB#2356, AB#2357, AB#2323, AB#801, AB#802) each one unblocks or supersedes.
- [ ] No code or data changes; this story is docs only.

### ISP pacing: Level 30 takes 236 to 242 simulated days by seed; decide whether it must fit in 240 (Requirement AB#4774, Proposed) (lane: interstellar-settlement-protocol/platform)

What: ISP economy pacing. Found fixing Bug AB#2360. The ladder bot test (tests/probes/ladder-bot.test.js) caps the climb to Level 30 at 240 simulated days, as a pacing check (Bug #4657). With the server's random draws now seeded, the climb takes 238.4 days at seed 1, 236.2 at seed 2 and 241.8 at seed 3: Level 30 is mission-bound (570 missions), and luck decides which side of 240 it lands. Seed 1 passes, so the test is green and a failure now means the pacing changed. But whether Level 30 is meant to… (the rest: AB#4774)

- [ ] The economy owner states whether Level 30 is meant within 240 simulated days for every seed, in ECONOMY.md or the ladder's design note.
- [ ] If yes, the mission requirement or its supply is retuned so seeds 1 to 10 all reach Level 30 inside 240 days (LADDER_SEED=n LADDER_OUT=file npx vitest run tests/probes/ladder-bot.test.js).
- [ ] If no, the test's cap and its comment say what it does check.

### A broke corporation whose office has lapsed can never rent one again: the Salvage Assignment stops paying at 3,000 and an office costs 7,000 (Bug AB#4868, Proposed) (lane: interstellar-settlement-protocol/economy)

What: ISP economy, the way back from broke (ECONOMY.md, ISP-289; the Salvage Assignment, ISP-297). A corporation with no credits, no goods and no office has one income: the Salvage Assignment, offered only while credits are under salvage.creditsThreshold (3,000) and paying salvage.payoutCredits (3,000). The cheapest office is a 7-day lease at 1,000 a day, 7,000. Without an office it cannot mine, hire or lease, and contracts need goods it has none of. So its credits cycle between under 3,000 and under… (the rest: AB#4868)
Repro: Symptom: rent-office refused "requires 7,000 credits. Current reserves: 2,9xx" (and 3,xxx to 5,xxx) indefinitely. Repro: node ops/probes/isp-progression.ts --repo <isp> --broke-staffed prints FAIL. By hand: a corporation with staff, let its office run out at under 3,000 credits with no goods; take the Salvage Assignment each time it is offered; the office is never affordable.
Proposed fix: Data change: raise salvage.creditsThreshold in data/economy.json from 3,000 to 10,000, payout unchanged, so salvage stays on offer until a corporation can afford a week's office plus a short mining cycle. A 30-staff corporation then nets about 1,500 a day (2 payouts less 4,500 wages) and reaches an office in about a week. Confidence: medium; the threshold also changes who sees salvage (ISP-298's copy says "under 3,000"). Alternative, a rule change: offer salvage while the corporation cannot… (the rest: AB#4868)

- [ ] Fixed: A broke corporation whose office has lapsed can never rent one again: the Salvage Assignment stops paying at 3,000 and an office costs 7,000

### Balance: no bot climbs past level 14 of 30; mining a corporation's own ore is at or below break-even at the bid it drives down (Bug AB#4871, Proposed) (lane: interstellar-settlement-protocol/client-views)

What: ISP economy and level ladder, the v1.0 final balance pass (AB#965 measured it, AB#968 applies changes). The full-progression probe (ops/probes/isp-progression.ts) drives a new corporation up the ladder through the real routes. The target is the top level: 40 in the item's text, but the ladder defines 30 (Bug #424 corrected the cap). Neither bot gets near it. Every number below is a bot number (P-PROXY): 48 looks a bot day, up to 4 moves a look, seed 7000, one corporation alone in its world, ISP… (the rest: AB#4871)
Repro: Symptom: the highest level reached in 120 bot days is 11 (planner) and 4 (greedy) of 30. Repro, from hq: node ops/probes/isp-progression.ts --repo <interstellar-settlement-protocol> --days 120 --bots planner, and again with --bots greedy; about five minutes each. The raw output of both runs is attached to AB#965.
Proposed fix: Data changes, proposed for AB#968 (not applied; the Board and PM decide): / - data/economy.json npcBid.quotaPerDay from 7,000 to 20,000, and driftAtFullQuotaPct from 50 to 30, so that one corporation's own output no longer sinks the bid it sells into below its running cost. Confidence: medium that mining turns profitable for the planner. It also raises every seller's income, which the runway probe's four ECONOMY.md checks must re-judge. / - After 1, re-run this probe. If level 12 onward is still… (the rest: AB#4871)

- [ ] Fixed: Balance: no bot climbs past level 14 of 30; mining a corporation's own ore is at or below break-even at the bid it drives down

### isp-runway probe: the expander bot's bargain-buying rule spends nearly everything on other bots' listings, so check 3 measures starvation, not the sinks (Bug AB#2323, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Symptom. The expander bot (ISP-310, AB#2306) reaches 3 yards and a Mars lease inside 30 days, then ends the run broke: 1,487 credits, its Mars yard never having run a mining cycle because it never had the startup cost at hand. Over the run it paid only 13,414 total across the three ISP-88 sinks (13,000 yard-price-growth, 414 lease-royalty, 0 yard-upkeep) - most of its money, 365,525, instead went to buying other bots' market listings through ops/probes/isp-runway.ts's bargain rule (~line 577:… (the rest: AB#2323)

- [x] Fixed: isp-runway probe: the expander bot's bargain-buying rule spends nearly everything on other bots' listings, so check 3 measures starvation, not the sinks

## Demo script

_To be written._
