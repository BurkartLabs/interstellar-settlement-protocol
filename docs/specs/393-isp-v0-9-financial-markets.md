# ISP v0.9 — Financial markets

Feature AB#393 (Proposed) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits: v0.9 on the ISP roadmap (DEVELOPMENT_PHASES.md in the product repo), under the product epic.
What it is for: A coherent debt and equity layer. Grouped deliberately: each instrument needs the others, and all of them need a price-history substrate, so shipping one alone would be a toy.
What it contains:
- Corporate bond issuance
- Loans, player-to-player and from NPC underwriters
- Real equity investment in other player corporations
- Investment returns driven by target corp performance
- Credit rating and risk model exposed to lenders and investors
Each line becomes a story when this version is next. They are listed here rather than filed as work items so the backlog shows what is ready to be worked, not everything that has ever been planned (TRACKING.md).

## Acceptance

1. Two corporations on the running build can issue and buy a bond, make and repay a loan, and hold equity in each other, and each sees the other's credit rating.
2. On a default the lender recovers what the Board allowed (AB#702: anything liquid, then assets force-sold), and nothing more.
3. No instrument can be bought or sped up with real money (AB#703).

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 2 open, 22 resolved.

### Default recovery never reaches ships or troops, so a borrower can move principal into units before defaulting (Bug AB#4803, Proposed) (lane: interstellar-settlement-protocol/finance-politics)

PM note (2026-10-01): build the first option: fleets and reserve units join saleableAssets after buildings, salvaged at the same 40% of cost, with a regression test. The Board's answer on AB#702 is "anything liquid, assets force sold if not able to cover", and ships and troops are assets. The file is server/defaultRecovery.js, so the lane is finance-politics, not combat.

What: ISP v0.9 debt. saleableAssets lists buildings (not the Headquarters) and leases (server/defaultRecovery.js:121-131); recovery also takes credits, goods, bond holdings and shares. Fleets and troops are neither sold nor named as protected in docs/design/v0.9-debt.md (its 'never sold' list is the office, research, the level and the Headquarters). A borrower who turns a loan's principal into ships and then defaults keeps them; the lasting cost is a D grade. Filed to confirm the intent with the… (the rest: AB#4803)
Symptom: Units bought with borrowed credits are out of reach of recovery.
Repro: - Take a player loan. / - Spend the principal at the shipyard. / - Let the loan fall into default: recovery sells buildings and leases but leaves the fleet.
Proposed fix: Either add fleets and reserve units to saleableAssets after buildings (salvaged at the same 40% of cost), or write the exclusion into the design doc as intended. Confidence medium: the gap is certain, the intent is not.

- [ ] Fixed: Default recovery never reaches ships or troops, so a borrower can move principal into units before defaulting

### ISP-144 Design the debt layer: loans, bonds and the credit rating, with the numbers (Requirement AB#838, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. A design doc, docs/design/v0.9-debt.md, that fixes the state shapes, formulas and tunable numbers for NPC loans, player-to-player loans, bond issuance and the credit rating before any code is written. The roadmap says these instruments only make sense together (the Feature says "shipping one alone would be a toy"), so they are designed together. / Why it matters. Without a spec, each story would invent… (the rest: AB#838)

- [x] docs/design/v0.9-debt.md exists and defines: the loan, loan-offer and bond-series records (every field, type and bound); the daily servicing formula (amortising payment, arrears, penalty rate); and the credit-rating function with its inputs taken only from server-side fields that exist on main (name each field, e.g. corp.finances.snapshots, the ISP-1 statements).
- [x] Rating output is a letter grade (AAA to D, plus NR for "not rated") and a numeric score; the doc states the exact grade boundaries and what NR means (too little history), and that NR fails closed: no player may lend to or buy bonds of an NR corporation without an explicit confirmation, and NPC underwriters quote only their highest-rate product to it.
- [x] An interior-optimum argument (T-018) for each player-set knob: borrowing amount (rate rises as leverage worsens the grade), bond coupon (a higher coupon fills the issue but costs more), loan term. For each, a worked example with numbers showing that neither the minimum nor the maximum setting is best.
- [x] A tap/sink table: NPC loan principal is a credit tap, interest and fees are sinks; the doc sets a target (e.g. interest paid to NPCs over a 30-day loan <= 5% of principal) and says which probe story checks it (v0.9-19). Unblocked 2026-09-26, noted not resolved: this tap/sink table's numbers assume today's pre-tuning demand model (ECONOMY.md's new "Demand: the Board's rule" section, AB#2375) and the Feature AB#2374 demand retune has not landed. State the tap/sink target as provisional and name… (the rest: AB#838)
- [x] An abuse section: an alt account lending to its owner at 0% to move wealth is closed by a floor rate and a per-pair principal cap; self-dealing (lender = borrower account) is rejected; every term field is a number or an enum, no free text anywhere (the Board chose no player free text for all-ages play).
- [x] Default handling is written as the options in Decision D-0.9-1, marked "pending Board"; NPC-loan default is specified with non-destructive consequences only (arrears, penalty rate, grade drop to D, no new credit).
- [x] Prior art cited: credit-rating letter scales, the Altman Z-score as a published model of default risk from balance-sheet ratios, and EVE Online's player-run bank collapses (EBank, 2009) as the known failure of unsecured player-to-player lending.

### ISP-145 Design equity: the share registry, offerings and performance-linked returns (Requirement AB#839, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. The equity half of the spec, docs/design/v0.9-equity.md: how many shares a corporation has, how they are offered through the Intergalactic Stock Exchange (an NPC building in data/buildings.json that is "coming-soon" today), how holders are paid from the target's performance, and how an investor exits. / Why it matters. The existing POST /api/investments (server/index.js:3310) takes an investor's… (the rest: AB#839)

- [x] The doc defines the cap-table record, the offering record and the holding record (every field and bound), and states the fixed share count per corporation and the level gate for listing (the LORE says the IGSX is "deliberately inaccessible to small operators": name the level).
- [x] Returns are defined as a formula over server-side performance fields (e.g. trailing 7-day net income from the ISP-1 statements) with a worked example; a loss-making target pays nothing and its holding value falls.
- [x] The issuer's payout-ratio knob has an interior optimum (T-018) argued with numbers: paying out more raises demand and price for the next offering, paying out less keeps capital for growth.
- [x] The doc states the investor's exit (sell back at a formula price, list on a secondary book, or hold only). If the answer needs a secondary market, the doc says so and the PM files it as a new story rather than it being built inside another one.
- [x] What control an outside holder gets (none, votes, takeover) and the per-holder stake cap are written as the options in Decision D-0.9-3, marked "pending Board".
- [x] Prior art cited: dividend payout policy (Dividend payout ratio) and one game precedent for player-owned corporation shares (EVE Online corporation shares and dividends), with what went wrong there.

### ISP-146 Build the settlement ledger: one audited path for credits moving between two corporations (Requirement AB#840, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. A server module (e.g. server/settlement.js) with one function that moves credits between two corporations, validates everything, writes a ledger entry, and is the only way any v0.9 or v0.10 instrument moves value between players. / Why it matters. Today every cross-corp transfer is hand-written inside a route (the exchange buy path does three separate mutations at server/index.js:3100-3200), and ISP… (the rest: AB#840)

- [x] settleTransfer({ fromAccountId, toAccountId, credits, reason, idempotencyKey }) exists; reason is an enum exported from the module (loan-disbursal, loan-repayment, bond-subscription, coupon, dividend, share-purchase, escrow-hold, escrow-release, fee) and any other value is rejected.
- [x] Security. what data: two account ids, an integer amount, a reason, a key. Hostile input: a test sends negative, zero, fractional, NaN, string and above-Number.MAX_SAFE_INTEGER amounts, an unknown account, and from = to; every one is rejected and no balance changes (assert both balances before and after). Fails closed: if either account cannot be loaded, or the debit would go below zero, nothing moves.
- [x] Replaying the same idempotencyKey moves credits once; a test calls it twice and asserts one ledger entry.
- [x] Conservation test: after 1,000 random valid transfers among 5 fixture corps, the sum of all balances is unchanged; fees (reason fee) go to a named sink account total, not to nowhere.
- [x] Each ledger entry (id, time, from, to, amount, reason, key) is persisted through the persistence layer in use on main (Azure Files JSON or Postgres per Decision #591) and survives a restart in an integration test.
- [x] Not reachable from any HTTP route directly; a grep test asserts no route file imports it except through the instrument modules.

### ISP-147 Compute a credit rating for every corporation from its server-side financial history (Requirement AB#841, Resolved, not verified) (lane: interstellar-settlement-protocol/platform)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. A pure function computeCreditRating(corp, now) implementing the formula in docs/design/v0.9-debt.md, recomputed on the financial snapshot tick and stored on the corporation. / Why it matters. Every lender and investor decision in v0.9 is priced off this number; if it is computed in the client or from state the player can influence directly, the market is forgeable. / Estimate: 1 session, assuming v0.9-01… (the rest: AB#841)

- [x] The function reads only the server-side fields the design names and returns { grade, score, inputs, computedAt }; it is called from the existing financialSnapshotTick and the result is persisted.
- [x] Unit tests with fixture corps cover each grade boundary, a corp with too little history (returns NR), a corp in arrears (grade drops per the design), and non-identity inputs for every weight (P-IDENTITY-BLIND: no test only checks a zero-debt corp).
- [x] Security. no client-supplied value reaches the function; a test posts a crafted creditRating in a request body to every account route and asserts the stored rating is unchanged. Missing or malformed history yields NR, never a good grade.
- [x] The rating inputs table in the design doc and the function agree: a test iterates the design's exported weight table rather than a copy (P-TWO-SOURCES).

### ISP-148 Show credit ratings to lenders and investors: a read-only endpoint and a rating card (Requirement AB#842, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. A read endpoint returning any corporation's public rating, and a rating card on the player's Finance tab and wherever another corporation is shown as a counterparty (loan board, bond board, stock exchange). / Why it matters. The plan line says the model is "exposed to lenders and investors"; a rating nobody can see prices nothing. / Estimate: 1 session, assuming v0.9-04 is merged.

- [x] GET /api/corporations/:corpId/credit-rating requires auth and returns grade, score band and the design's published inputs rounded to bands; it does not return another corporation's raw credits balance or statements.
- [x] Security. data exposed is another player's game finances, so only the banded fields the design lists are returned; a test asserts the response has exactly those keys. Unknown or malformed corpId returns 404 without timing or message differences that reveal which ids exist.
- [x] The Finance tab shows the player's own grade with a one-line "why" (the weakest input), and NR shows "Not rated: N more days of history needed".
- [x] Screenshot of the Finance tab rating card for a rated corporation and for an NR corporation at 1440×900 and at 390×844 attached to the PR, taken from the running app (not a mock or a DOM dump).

### ISP-149 Originate NPC loans from the Deep Space Development Bank (Requirement AB#843, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. A loan-product catalog (data/loan-products.json) and two routes: quote a loan for my corporation, and accept a quote. The Development Bank already exists as an NPC building ("issues corporate bonds, expansion loans") marked coming-soon. / Why it matters. NPC underwriters give every player a lender on day one, before any player has spare capital, and the rate spread by grade is what makes borrowing a… (the rest: AB#843)

- [x] The catalog has at least three products (e.g. 7, 30 and 90 day) with base rate, spread per grade, and a maximum principal expressed as a multiple of trailing revenue; a schema test loops every product.
- [x] POST .../loans/quote returns the rate and payment schedule for the requested principal and term; POST .../loans/accept re-quotes server-side and rejects if the terms changed, then disburses through settleTransfer with reason loan-disbursal from the bank's tap account.
- [x] Security. a client cannot supply the rate: a test posts a lower rate in the accept body and the stored loan has the server's rate. Principal above the product maximum, a D-grade or NR corp above its limit, non-integer or negative principal, and a second concurrent accept of the same quote are all rejected with nothing disbursed.
- [x] A test shows the interior optimum from the design: the marginal rate quoted rises with requested principal for a fixture corp.

### ISP-150 Service loans on the tick: repayments, arrears, penalties and early payoff (Requirement AB#844, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. A servicing step on the existing server tick that takes each loan's scheduled payment, handles a corporation that cannot pay, and lets a borrower repay early. Written for NPC loans; v0.9-08 and the bond stories reuse it with a player as the counterparty. / Why it matters. A loan that is never collected is a free-credit tap; a loan whose failure destroys a player's corporation is an irreversible loss the… (the rest: AB#844)

- [x] Each tick due payments are collected through settleTransfer (reason loan-repayment); interest goes to the sink the design names and appears in the corp's expenses under a named category in the ISP-1 statements.
- [x] If credits are short the loan enters arrears: the unpaid amount accrues the penalty rate, the rating recomputes, and a notification is sent. Arrears never delete buildings, leases, inventory or the corporation (that escalation is D-0.9-1's question). A test asserts the corp's buildings and inventory are identical before and after 30 days of arrears.
- [x] Early payoff route repays the outstanding balance plus the design's fee and closes the loan; paying off twice is rejected.
- [x] Time-travel tests use injected time (not wall clock, P-TEST-TIME) across a full 30-day term and assert total paid equals the schedule to the credit.

### ISP-151 Open the Development Bank: quote, borrow and track NPC loans in the station (Requirement AB#845, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. Turn the Deep Space Development Bank from a coming-soon card into a working building view: product list, a quote form, the accept confirmation, and a list of the corporation's loans with next payment and arrears state. / Why it matters. This is where a player first meets the debt layer; if the quote does not show the total cost of the loan, borrowing looks free. / Estimate: 1 session, assuming v0.9-07 is… (the rest: AB#845)

- [x] The building's available flag is true and its action opens the view; the quote shows principal, rate, term, daily payment and total repayable before the player commits.
- [x] Accepting shows the committing-action confirmation (ISP-19 pattern) naming what was borrowed and the first payment date.
- [x] The loan list shows each loan's balance, next payment, and an arrears badge; early payoff is available from it.
- [x] Copy is in the ISA/bank fiction voice and names no real bank or rating agency.
- [x] Screenshot of the Development Bank view with one active loan and one quote open at 1440×900 and at 390×844 attached to the PR, taken from the running app (not a mock or a DOM dump).

### ISP-152 Player-to-player loans: post a loan offer, accept it, service it with a player as lender (Requirement AB#846, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. A loan board where a corporation posts a structured offer (principal, rate, term, minimum grade) and another accepts it; disbursal, servicing and arrears reuse v0.9-03 and v0.9-07 with the lender as counterparty. / Why it matters. This is the plan's player-to-player half and the first instrument where one player can lose credits to another's default, so what a lender may recover is the Board's call. The… (the rest: AB#846)

- [x] Offers have only numeric and enum fields (no free text); the offer's principal is held in escrow through settleTransfer (escrow-hold) when posted and released on cancel.
- [x] Security. self-dealing (same account both sides) is rejected; the design's floor rate and per-pair principal cap are enforced server-side, and a test attempts a 0% loan between two fixture accounts and asserts rejection. Accepting an offer whose escrow is gone, or a stale offer, moves nothing.
- [x] Default follows the Board's answer on AB#702 through the default-recovery function: a test defaults a fixture borrower holding some credits, some inventory and one building, and asserts the lender receives exactly the amount owed, taken in the stated order, and the borrower keeps any surplus.
- [x] Anti-abuse probe: two bot accounts cannot transfer more than the per-pair cap per 30 days by any sequence of offers and accepts (a test loops the sequences).

### ISP-153 Loan board screen: browse offers by rating and rate, post an offer, see who owes you (Requirement AB#847, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. The client screen for v0.9-09, inside the Development Bank or Finance tab: offers sortable by rate and minimum grade, a post-offer form, and a lender view of loans outstanding with each borrower's grade. / Why it matters. A lender who cannot see the borrower's grade next to the rate cannot price risk, which is the whole point of the rating. / Estimate: 1 session, assuming v0.9-09 is merged.

- [x] Each offer row shows principal, rate, term, minimum grade and the lender's corporation name; each outstanding-loan row shows the borrower's current grade and arrears state.
- [x] Posting an offer shows the escrow that will be held before confirming.
- [x] Empty states say what to do ("No offers match your grade").
- [x] Screenshot of the loan board with at least three offers and the lender view with one loan in arrears at 1440×900 and at 390×844 attached to the PR, taken from the running app (not a mock or a DOM dump).
- [x] A loan in default shows the lender what was recovered and from what (credits, sold inventory, force-sold assets), and shows the borrower the warning and the date before any asset is force-sold.

### ISP-154 Issue a corporate bond series and run its subscription window (Requirement AB#848, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. A rated corporation above the design's level gate issues a bond series (face value, coupon, maturity, quantity); players and an NPC underwriter subscribe during a fixed window; unsold units lapse and the issuer receives the proceeds. / Why it matters. Bonds are the plan's first instrument and the way a large corporation raises capital from many players at once; bondholders are player lenders, so default… (the rest: AB#848)

- [x] Issuance rejects NR and D-grade issuers and issuers below the level gate; all fields are numeric or enum.
- [x] The NPC underwriter's subscription is a function of the coupon versus the grade-implied yield (from the design), so a coupon below that yield fills little and one above it fills fully: a test shows the fill rises with coupon.
- [x] Security. subscription moves credits only through settleTransfer (bond-subscription); oversubscription beyond the quantity is rejected, not truncated; an issuer cannot subscribe to its own bond; a subscription after the window closes moves nothing.
- [x] Probe target (bot number, P-PROXY): in the v0.9-19 probe, the planner bot's chosen coupon is neither the minimum nor the maximum allowed in at least 80% of issues.

### ISP-155 Pay bond coupons and redeem at maturity, with arrears handled like loans (Requirement AB#849, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. Coupon payments on the tick to every holder pro rata, principal redemption at maturity, and the missed-payment path reusing the v0.9-07 arrears logic. / Why it matters. A bond that does not pay is a donation; this makes the instrument real and shows up in both sides' statements. / Estimate: 1 session, assuming v0.9-11 is merged.

- [x] Coupons are paid through settleTransfer (coupon) to each holder; the rounding rule is stated and a test with 7 holders of uneven sizes shows total paid equals the coupon to the credit.
- [x] At maturity the face value is redeemed and the series closes; a test runs a full series from issue to redemption with injected time.
- [x] Missed coupon: arrears, penalty and rating drop per the design; on default, the default-recovery function (Board answer AB#702) recovers what is owed and distributes it to holders pro rata, with a test that total distributed equals total recovered to the credit.
- [x] A defaulting player's own bond holdings count as liquid in default recovery, valued at the design's rule (test).
- [x] Both issuer and holders see coupon income and expense under named categories in the ISP-1 statements.

### ISP-156 Bond board screen: issue a series, subscribe, and see holdings and coupons (Requirement AB#850, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. The client for bonds: open series with issuer grade, coupon and time left in the window; an issue form for eligible corporations; and a holdings list showing next coupon and maturity. / Why it matters. The coupon decision only exists if the issuer can see what similar grades are paying; the board shows that next to the form. / Estimate: 1 session, assuming v0.9-12 is merged.

- [x] The issue form shows the grade-implied yield for the issuer beside the coupon field and previews total coupon cost over the life of the bond before confirming.
- [x] Each open series shows issuer name, grade, coupon, maturity, units left and window countdown; each holding shows next coupon date and amount.
- [x] Ineligible issuers see why (level gate, NR, D grade) instead of a disabled button.
- [x] Screenshot of the bond board with two open series, the issue form, and a holdings list at 1440×900 and at 390×844 attached to the PR, taken from the running app (not a mock or a DOM dump).

### ISP-157 Give every corporation a share registry, founder-owned, with a migration for existing accounts (Requirement AB#851, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. The cap table from docs/design/v0.9-equity.md: a fixed share count per corporation, 100% held by the founder, persisted, with a one-off migration for existing accounts and a read route for the public cap table. / Why it matters. Equity needs a single authoritative record of who owns what before anyone can buy a share; the current corp.investments array stores a free-text target name, which cannot be… (the rest: AB#851)

- [x] New corporations are created with the registry; a migration adds it to every existing account and is idempotent (a test runs it twice).
- [x] Invariant test: for every corporation, shares held across all holders equal the fixed share count, checked after every mutation in the equity test suite.
- [x] Security. the public cap-table route returns holder corporation names and percentages only (no account ids or emails) and requires auth; ids that do not exist return 404.
- [x] Nothing is sold yet: no route in this story can move shares away from the founder.

### ISP-158 Primary share offerings on the Stock Exchange, replacing the inert investments route (Requirement AB#852, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. The Board answered D-0.9-3 (AB#704): "A company can issue shares. The value of these shares is equal to the company value divided by the number of shares. As the company value increases, the share price increases. This is a way for a company to raise money. But they can lose money." Assumption for the half it leaves open (control and caps): shares are economic only, with no votes and no control, an… (the rest: AB#852)

- [x] The offering price per share equals company value ÷ shares outstanding at the moment the offering opens, computed server-side; a request carrying a price is ignored (test). Because proceeds raise company value by what was paid, issuing at that price leaves the price per share unchanged (test with a fixture).
- [x] An offering is rejected if it would take any outside holder above 20% or the founder below 51% (the assumed caps); tests cover both limits exactly at and one share over. Shares carry no vote or control (nothing in the code reads a holder's stake to grant an action).
- [x] Security. Share purchase moves credits only through settleTransfer (share-purchase) and shares only through the registry, in one mutation; a buyer cannot buy its own shares; quantity must be a positive integer within the offering. A test asserts both the credit and the share invariant after 200 random purchases.
- [x] POST /api/investments returns 404 and the vestigial corp.investments array is migrated or cleared with a note in the PR of what was there (credits previously sunk are listed, not silently refunded, so the PM can decide).
- [x] The level gate from the design is enforced for issuers.

### ISP-159 Pay shareholders from the target corporation's performance (Requirement AB#853, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. The returns formula from the equity design: on the tick, the issuer's payout ratio of positive trailing net income is paid pro rata to holders; a loss-making corporation pays nothing. / Why it matters. This is the plan line "investment returns based on target corp performance": without it, a share is a donation. / Estimate: 1 session, assuming v0.9-15 is merged.

- [x] Dividends are paid through settleTransfer (dividend) using the ISP-1 trailing net income; a test with a fixture target that earns, then loses, then earns shows payouts of the formula amount, zero, then the formula amount.
- [x] The issuer can set its payout ratio within the design's bounds; a change takes effect from the next period only.
- [x] Holder rounding: total paid equals the formula to the credit across 7 uneven holders.
- [x] Probe target (bot number): in the v0.9-19 probe the planner issuer's chosen payout ratio is interior (neither bound) in at least 80% of runs, evidencing T-018.

### ISP-160 Value holdings from the target's performance and implement the investor exit (Requirement AB#854, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. A holding value per share equal to the target's company value ÷ shares outstanding, the Board's formula on D-0.9-3 (AB#704), computed server-side, shown in the investor's statements as an asset, plus the exit mechanism the equity design chose. / Why it matters. Returns are dividends plus change in value; if value never moves with performance, the only strategy is "buy the highest dividend", and an… (the rest: AB#854)

- [x] Holding value per share equals company value ÷ shares outstanding (Board answer AB#704); a test shows it rising when the fixture target's value rises and falling, below the investor's cost, when it falls (investors can lose money).
- [x] Holdings appear in the investor's balance sheet assets (ISP-1) at that value.
- [x] The exit works end to end in an integration test: the investor exits and receives credits by the design's rule, and the registry invariant holds.
- [x] Security. exit price is computed server-side only; a client-supplied price is ignored (test).
- [x] A defaulting player's share holdings count as liquid in default recovery (Board answer AB#702), valued by this rule (test).

### ISP-161 Open the Stock Exchange: offerings, portfolio with returns, and my cap table (Requirement AB#855, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. Turn the Intergalactic Stock Exchange from coming-soon into a working view: open offerings with issuer grade and trailing performance, the investor's portfolio with value and dividends received, and the issuer's cap table and payout-ratio control. / Why it matters. An investor choosing where to put credits needs performance and grade on the same row as the price. / Estimate: 1 session, assuming v0.9-17 is… (the rest: AB#855)

- [x] Offerings show issuer, grade, company value, shares outstanding and the price per share they produce, shares left, trailing net income and payout ratio.
- [x] Portfolio shows each holding's value, cost, dividends received and the exit action.
- [x] Issuer view shows the cap table and the payout-ratio control with the current value and bounds.
- [x] Screenshot of the Stock Exchange offerings list, a portfolio with two holdings, and an issuer cap table at 1440×900 and at 390×844 attached to the PR, taken from the running app (not a mock or a DOM dump).

### ISP-162 Extend the ISP probe with a financial-markets profile: leverage, coupons, payout, taps and sinks (Requirement AB#856, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. A headless bot profile in the ISP probe (hq/ops/probes/, alongside the runway probe the Depth Critic asked for) that plays borrowing, issuing and investing and prints the numbers the v0.9 stories cite. / Why it matters. Each v0.9 story claims a knob has an interior optimum; only a probe can show it, and review #2 must report probe output, not source reading (T-023). / Estimate: 1 session, assuming the ISP… (the rest: AB#856)

- [x] The probe prints, labelled as bot numbers: net worth at day 30 for no-borrow, max-borrow and planner-borrow bots; the planner's chosen coupon and payout ratio distribution; credits created by NPC loans versus destroyed by interest and fees over 30 days.
- [x] Target: the planner-borrow bot beats both the no-borrow and the max-borrow bot by at least 10% net worth at day 30 (evidence the leverage knob is a decision, T-018). If it does not, the PR says so and files the tuning as a follow-up; the target is not quietly lowered.
- [x] Target: interest plus fees destroyed at least 5% of NPC principal created over 30 days (the design's sink target).
- [x] The probe runs in CI and fails on a run that executed zero bot days (T-008, P-GREEN-AND-EMPTY).

### ISP-163 Write the Board's never-sell list for financial instruments into the brief (Requirement AB#857, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. / What it is. Write the Board's answer to D-0.9-2 (AB#703) into the monetization section of the ISP BRIEF.md: "We don't want any player to be able to gain an unfair advantage by trading anything in game for real money. This would be a violation of the Real Money Trading rule." Read conservatively, it forbids both ways of turning money into advantage: the game selling or speeding up an advantage, and players selling… (the rest: AB#857)

- [x] BRIEF.md quotes the Board's answer with AB#703, states both readings (no sold or accelerated advantage; no player trading of in-game value for real money), and names each v0.9 mechanic listed above.
- [x] It says that anything not listed that could give an advantage needs a Board Decision before it is sold, rather than being permitted by omission.
- [x] The ISP monetization guard test (Monetization epic 3), if it exists, gains a case: a seeded commit adding a price or currency field to data/loan-products.json fails it. If the guard does not exist yet, the PR says so rather than claiming coverage.

### ISP-286 Recover a defaulted player debt: credits, then liquid holdings, then force-sold assets (Requirement AB#993, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393), under the ISP epic AB#388. The Board answered D-0.9-1 (AB#702): "Anything liquid, assets force sold if not able to cover." / What it is. One server function, recoverDefault(debtor, creditors, amountOwed), used by player loans and bonds: it takes credits first, then station inventory sold at the NPC standing bid, then force-sells buildings and leases to the ISA at the design's salvage value, stopping at the amount owed. Assumptions for what… (the rest: AB#993)

- [x] A fixture debtor with credits, inventory and two buildings, owing more than its credits, pays in the stated order and stops exactly at the amount owed; the surplus stays with the debtor (test).
- [x] No asset is sold before the grace period after the warning; paying during the grace period cancels the sale (tests with injected time).
- [x] The office, research and level are never touched (test).
- [x] Security. Every credit moves through settleTransfer and every sale in one mutation, so a crash leaves either nothing or everything done (test); sale prices are computed on the server; a debtor cannot move assets out during the grace period to dodge recovery beyond what the design allows (test transfers during grace are blocked or counted).
- [x] The design section in docs/design/v0.9-finance.md (or the repo's equivalent) states the order, salvage values and grace period, and quotes AB#702.

### ISP: remove a building cleanly (its extractor or refinery, lease slot and assets), so default recovery can force-sell it (Requirement AB#2569, Resolved, not verified) (lane: interstellar-settlement-protocol/finance-politics)

What: Where it sits. v0.9 Financial markets (Feature AB#393). A prerequisite of AB#993 (ISP-286, default recovery), which AB#846 (player loans) needs for its default line. / What it is. One server function that removes a building from a corporation cleanly, so that default recovery can force-sell buildings and leases to the ISA at 40% of what was paid (docs/design/v0.9-debt.md, section 10). Nothing in ISP has ever removed a building, and the model relies on that: server/game/buildingIds.js pairs the… (the rest: AB#2569)

- [x] removeBuilding(corp, buildingId) removes an extractor yard, a refinery and one other building type in fixture corporations; after each, the mining model, refining and lease slots agree with what is left, and the next ticks run without error (tests).
- [x] corp.finances.assets drops by the building's asset value; a running cycle or batch is settled by the rule the PR states (test).
- [x] Every new building records what it cost (paid); the design names the salvage base used for buildings built before that.
- [x] No route removes a building yet: the function is for default recovery (AB#993); the office, research and level are never removable.

## Held back

Not dispatched: each of these waits on something a Builder session cannot supply, named on its "Held" line. Its lines stay as its acceptance for when it opens. The headings are level 4 so that dispatch, which reads level-3 headings as slices, skips them (PM, 2026-10-01).

#### ISP v0.9: tune leverage so the planner's borrowing is a decision the probe can see (AB#856 target failed) (Requirement AB#4648, Proposed) (lane: interstellar-settlement-protocol/economy)

Held (2026-10-01): balance tuning: it changes the leverage numbers until the planner's borrowing shows in the probe, and needs a call on which knob moves. Waits for the Board's economy review (AB#4779, AB#4881).

What: Where it sits. v0.9 Financial markets (Feature AB#393). This is the follow-up AB#856 promised: the probe target failed, and the target was not lowered. / What the probe showed (npm run probe:markets; bot numbers, P-PROXY: bots on the design's assumed business, not players). Over 8 corporation profiles and 30 days, the planner-borrow bot never beat both the no-borrow and the max-borrow bot by 10% of net worth. The spread was -1.8% to +1.9% against no-borrow, and it lost to max-borrow by about 1%… (the rest: AB#4648)

- [ ] A design note (v0.9-debt.md section 8 or 5) names what changes: the principal caps as a multiple of income, the origination fee, the rate spread, how a building bought with a loan is booked, or the 10% target itself, as a Board or Director call with the probe table as evidence.
- [ ] After the change, npm run probe:markets shows the planner-borrow bot beating both the no-borrow and the max-borrow bot by at least 10% at day 30 in most profiles, or the design records why that target was replaced.
- [ ] The planner's payout ratio is interior in at least 80% of the runs that reach an offering, or the design says why not.
- [ ] The sink target stays between 5% and 10%.

## Demo script

_To be written._
