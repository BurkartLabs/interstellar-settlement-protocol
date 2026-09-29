# SECURITY, v0.6 to v0.13 — interstellar-settlement-protocol

ISP-261 (AB#957), v1.0. The root [SECURITY.md](../SECURITY.md) answers DOCTRINE's four questions for what v0.5 built:
auth, persistence, the market, sockets, headers and rate limits. This file answers them for every system added since:

1. **What data does this touch, and does it need to?**
2. **Who can reach it, and what happens if they are hostile?**
3. **What is the blast radius** of a leak or, in an economy, of an exploit?
4. **Does it fail closed** when a check cannot run?

A security answer per story is not a view across stories, and exploits in an economy live between features. So this
file starts with what the systems share, then takes each version in turn, then the economic abuse that crosses them.
Every anchor is `file:line` at commit `dca49ba5`. It goes stale when the code moves, and whoever reads it can tell.

**Method.** Five read-only passes, one per group of systems, each asked the four questions and a fixed list of attack
classes: another account's id in a request, negative/NaN/fractional/huge numbers, a race between a check and a debit,
reward farming, unbounded input, text shown to other players, and fail-open defaults. Every finding below was then
re-read in the source before it was filed. Two candidates did not survive that (under "Checked and ruled out").

**Result.** 8 bugs filed: 1 High, 4 Medium, 3 Low (#4797 to #4804). None is a way to act on another account or to
corrupt state. All eight are about value moving between accounts that one person controls, or a limit one sibling
has and another lacks.

---

## What every system here stands on

These four controls carry most of the answers below, so they are stated once.

- **Your account only.** Every route below is mounted under `/api/accounts/:accountId`, behind `requireAuth`,
  `requireAccountAccess` (the token's account must be the URL's) and `accountActionLimiter` (`server/index.js:142`).
- **Input is checked before a handler runs.** `gameplayInputMiddleware` (`server/index.js:168`) applies one table
  (`server/gameplayInput.js`): every quantity, price and term is a whole number in a stated range (`int()`), and every
  id that names something you own (a building, lease, refinery, fleet) is checked against your own lists. An id that
  is not yours answers the same 400 as one that does not exist, so it cannot be used to probe. Each instrument checks
  its numbers a second time where it uses them.
- **No race between a check and a debit.** Balance and stock checks and the writes after them run inside one
  synchronous `mutateAccountState` call (`server/game/store.js`), with no `await` between them. Node runs one handler
  at a time, so two requests cannot both pass a "has enough" check. The blind spot is two server processes sharing one
  data directory, which the deployment does not do.
- **Money moves through one door.** Credits between parties move only through `settleTransfer`
  (`server/settlement.js:152-217`), which checks the parties, takes whole positive amounts, and keys every transfer so
  it cannot happen twice. No route calls it directly (enforced by a test).

**What none of them has: a notion of one person with several accounts.** Every self-dealing check in the code is an
identity test on one account or one corporation (bonds `server/bonds.js:216`, loans `server/playerLoans.js:161-163`,
equity `server/shareOfferings.js:169`, mercenaries `server/mercenaries.js:183`, raids `server/raids.js:146`,
arbitration `server/arbitration.js:62-67`). Two accounts one person runs look like two players everywhere. The market
makes that cheap (#4797), and plus-address aliases make accounts cheap (#4798). Most findings follow from that pair,
which is why they are ranked first.

---

## v0.6 — Industrial Expansion: buildings, upgrades, milestones 11-40

**Data.** Your own corporation's buildings, credits, leases, extractors and refineries
(`server/construction.js:152-216`, `server/upgrades.js:59-118`). Nothing another account owns is read.

**Reach and hostility.** `POST /gameplay/build` (`server/routes/construction.js:9`) and
`POST /gameplay/buildings/:buildingId/upgrade` (`server/routes/upgrades.js:10`). The building and lease ids are checked
against your own before the handler runs (`server/gameplayInput.js:73`, `:94`). Upgrade goods and tiers are whole
numbers, checked twice.

**Blast radius.** Your own credits and assets. There is no player route that demolishes a building for a refund
(`server/buildingRemoval.js:8`, "No route calls it"; the only caller is default recovery), so build-then-sell-back
cannot turn a profit. If a demolition route is added later, it must be checked against `paid`, the cost basis a
refund would use.

**Fail closed.** A catalogue entry with no construction data is "not-constructible" (`server/construction.js:155`);
an upgrade whose table cannot be resolved is "no-upgrades" (`server/upgrades.js:66`). Level unlocks apply with
`Math.max` (`server/game/progression.js:226-245`), so re-evaluating a level never grants a reward twice or takes one away.

## v0.7 — World Expansion: 20+ systems, neutral stations, NPC corporations, Rats

**Data.** The station registry (`server/game/stations.js`), each system's pirate density, and your own fleets and
expeditions. The NPC catalogue (`server/npcCorporations.js`) is loaded once and only read.

**Reach and hostility.** `POST /gameplay/launch-expedition` (`server/routes/asteroids.js:175`) checks that an escort
fleet is your own inside the handler (`:250`). Station names and ids built by players must match fixed patterns
(`server/game/stations.js:39-40`), so no markup or oversized string reaches another player's map.

**Blast radius.** An under-escorted expedition can lose cargo to Rats. The encounter roll is seeded on the server from
a secret (`server/game/rats.js:80-82`); nothing a client sends changes it.

**Fail closed.** No seed secret of at least 16 characters, no encounter roll (`server/game/rats.js:81`). A system with
no pirate density reading refuses the launch (`server/routes/asteroids.js:246`, "no-danger-reading"). If the NPC
catalogue fails to load, registration answers 503 instead of allowing every name (`server/npcCorporations.js:33-36`).
A malformed built-stations file stops the server from starting (`server/game/stations.js:66-72`).

## v0.8 — Energy and Metals: the Tier 3 chains, off-world mining, the resource overlay

**Data.** Station inventories, your refineries and leases.

**Reach and hostility.** `POST /gameplay/start-refinery` (`server/routes/refining.js:24`): the refinery must be yours
(`server/gameplayInput.js:107`); input quantity and batches are whole numbers from 1 to 10,000,000 and 1 to 168
(`:111-112`), and batches are cut again to what fits in a week (`public/scripts/refineryRun.js:47-83`), so no request
can queue unbounded work.

**Blast radius.** Every input is checked against the station's stock and taken in one pass before the run starts
(`server/routes/refining.js:92-95`), so a start never leaves half its inputs spent. The overlay is a public, rounded
reading.

**Fail closed.** A chain with no input list, a duplicate item or a non-whole quantity per cycle is refused
(`public/scripts/refineryRun.js:19-24`). Every chain is gated by the research it requires
(`server/game/researchGates.js:14-17`).

## v0.9 — Financial Markets: bonds, loans, equity, credit ratings

**Data.** An instrument's terms and the two corporations' public ids. A player loan stores no account id at all
(`server/playerLoans.js:12-14`). The credit rating reads only the corporation's own closed daily statements and its own
debts (`server/creditRating.js:5-7`, `41-50`), never a value from a request.

**Reach and hostility.**
- **Bonds.** Terms are bounded twice (`server/gameplayInput.js:197-220`, `server/bonds.js:63-66`). A corporation cannot
  subscribe to its own series (`:216`), past what is left (`:220`), after it closes (`:217`), or while it is under a
  default-recovery hold (`:222-223`). Missing: any limit on one holder or one pair (#4799).
- **Player loans.** The same account or corporation cannot be on both sides (`server/playerLoans.js:161-163`). The rate
  has a floor of 2.0% per 30 days, so there are no free gift loans (`:30`, `:68-71`). Each pair is capped at 100,000
  credits per 30 days in both directions, counting repaid loans (`:78-88`). Principal is held in escrow before an offer
  exists (`:128`).
- **Equity.** Buyers must be Level 8 or above (`server/shareOfferings.js:173`), the issuer cannot buy its own shares
  (`:169`), and no holder may pass 20% of outstanding shares (`:177-181`). The price is the server's own formula
  (`:52`), never read from a request.
- **Ratings.** Everyone who lends or invests prices from them, so a cheap way to raise one is the risk here (below,
  "Wash trading").

**Blast radius.** Credits move only through `settleTransfer`, so a bug can misprice or misdirect a payment but cannot
create credits outside the ledger. Dividends come only from the issuer's own profit (`server/dividends.js:55`), never
from trading. Selling out is limited to 1% of outstanding shares a day across all sellers
(`server/shareOfferings.js:354-360`). Default recovery takes credits, goods, holdings, buildings and leases, but not
ships or troops (#4803).

**Fail closed.** A corporation with no rating (NR) cannot issue or list (`server/bonds.js:98`,
`server/shareOfferings.js:71`), and borrows only from an offer that explicitly accepts NR (`server/playerLoans.js:166`).
Statements that cannot be rated give NR, never a default grade (`server/creditRating.js:67-72`). Long arrears or a
recent default forces a D (`:118-120`). An offer whose escrow no longer holds the exact principal is refused with
nothing moved (`server/playerLoans.js:174`).

## v0.10 — Warfare: shipyard, troops, fleets, combat, mercenaries, raids

**Data.** Your own credits, inventory, units, fleets and garrisons. Mercenary offers and contracts store public
corporation ids, never an account id or email (`server/mercenaries.js:19`). The unauthenticated `/api/combat/simulate`
an early code map mentioned is gone (ISP-166, `server/game/world.js:185`).

**Reach and hostility.**
- **Shipyard and training.** A unit id and a quantity from 1 to 100 are checked first (`server/gameplayInput.js:120-121`).
  A job can be cancelled only from your own queue (`server/production.js:98-101`). Each job is at most 100 units and
  each queue at most 10 jobs (`:13-14`).
- **Fleets.** Every change goes through `fleetRoute` (`server/routes/fleets.js:41-51`): a fleet that is not yours is a
  404 with nothing changed. Splits and merges move units between your own fleets and reserve; totals never change
  (`server/fleets.js:5-8`).
- **Garrison and a hired fleet.** Deploying a hired fleet is the one place a route writes another account's state. It
  requires the fleet in your own hired list and an offer whose renter is you (`server/garrison.js:120-121`).
- **Mercenaries.** You cannot hire your own fleet (`server/mercenaries.js:183`). The offer is marked "taking" before the
  escrow and reopened if the hold fails, so it cannot be hired twice (`:187-189`). Missing: a collateral floor (#4800).
- **Raids.** `declareRaid` checks, before anything changes (`server/raids.js:137-191`): both sides' 14-day new-player
  protection, the target's 24-hour cooldown after a raid, 6 raids an hour, 2 on one target in 7 days, that the target
  holds something there, and that the fleet is yours (or hired for raids) and free. The target list shows eligibility,
  never holdings (`:218`).

**Blast radius.** Loot comes only from the target's inventory at one station. Never credits, research, levels, leases
or the Headquarters (`server/raidResolution.js:212`). It is capped at 20% above a 10,000 floor and by what survivors
can carry (`:66-74`). Combat has no randomness (`server/game/combat.js:106-129`), so there is nothing to re-roll. A
raid can be recalled only before it arrives (`server/raids.js:197-211`). After a battle the attacker sees the
defender's starting force. That is designed ("revealed by the battle, not before",
`docs/design/v0.10-raids-mercenaries.md`), and it costs a fleet and falls under the raid limits.

**Fail closed.** Every production and fleet function returns a named refusal before it changes anything. An empty fleet
order changes nothing (`server/fleets.js:46-49`). Combat throws on an unknown unit id (`server/game/combat.js:56-75`),
and every caller builds forces from the fixed unit lists (`server/raidResolution.js:117`, `196-198`). The raid ticker
has no try/catch (`server/index.js:215`), but the process-level handler (`server/index.js:80-82`) logs an exception
without stopping the server.

## v0.11 — Tier 4 production and the last five resources

**Data.** Your unlocked research, synthesis arrays and station inventory.

**Reach and hostility.** `POST /gameplay/queue-rnd` (`server/routes/research.js:20`) looks the node up in the research
library and refuses an unknown one (`:26-28`). Synthesis Array chains use the same checked `start-refinery` route
(`server/routes/refining.js:52-57`).

**Blast radius.** Research is a credit sink. Tier 4 outputs follow the same all-or-nothing input rule as v0.8.

**Fail closed, with one open default.** `canRecover` treats an item no research node claims as recoverable by everyone
(`server/game/researchGates.js:20-22`). That is right for ordinary resources, but a Tier 4 item left out of every node
would be free to all. None is today. A load-time check is filed (#4804).

## v0.12 — Conglomerates: membership, levels, treasury, intel, co-owned stations, messaging, dominance

**Data.** A corporation's public id, role and join dates, invitations and applications. Never an account id or email
(`server/game/membership.js:1-13`). The treasury ledger holds corporation ids and whole amounts. Private messages are
free text by the Board's decision (AB#707, AB#696), capped at 8,000 characters and 32 KB
(`server/game/conversations.js:22-23`, `140-147`).

**Reach and hostility.**
- **Roles.** Every route runs through `guarded()` (`server/routes/conglomerates.js:38-52`), which reads your role from
  the server, never from the request, and asks the one permission table (`can()`, `server/conglomerates.js:134-139`).
  Each role change, removal, founder transfer and dissolution asks again inside the function
  (`server/game/conglomerateRoles.js:39`, `61`, `79`, `96`, `116`). A conglomerate you are not in answers 404 (so
  membership is not revealed), and its id gets you a null role, not someone else's permissions.
- **Treasury.** Any member may contribute. Only founders and directors may withdraw (`server/game/treasury.js:59`,
  `82`). Amounts must be safe whole numbers from 1 to 10^12 (`:31-33`), withdrawals no more than is held (`:89`), and
  `moveTreasury` throws on any balance that would go negative (`server/conglomerates.js:270-278`).
- **Shared intel.** Only belts a current member scouted, and sell listings shaped like the public order book
  (`server/game/intel.js:5-8`, `64-72`). Membership is re-read on every call, so a member who leaves loses access on
  their next request. No balance, inventory or account id is included.
- **Co-owned stations.** Projects are founder-only. Contributions are checked amounts, capped at what the project still
  needs (`server/game/stationProjects.js:147-174`). Votes need a stake, one per corporation
  (`server/game/stationGovernance.js:182-183`).
- **Private messages.** The sender is always the token's account (`server/routes/conversations.js:33`). A conversation
  is read only if it is in your own inbox (`memberFor`, `server/game/conversations.js:250-253`), and its id is a keyed
  hash of both accounts (`:51-53`), so guessing one gets nothing. Limits are 30 a minute, 600 an hour, and 60 new
  conversations an hour (`server/rateLimiters.js:163-186`). Bodies render through `markdownHtml`, which escapes every
  text fragment and allows only http, https and mailto links (`public/scripts/markdown.js:5-27`, `48-72`). There is no
  block or report feature, by the same Board decision.
- **Dominance.** It is fed only by leases held, tonnes extracted in real mining ticks, and settled sales
  (`server/game/dominanceCounters.js:34-47`). The public reading is the top three names and shares in 5% steps
  (`server/game/dominance.js:12-13`).

**Blast radius.** A compromised director is limited by the role table. A treasury cannot be emptied at once:
withdrawals are capped per role per day against the opening balance (founder 20%, director 5% up to 50,000), and
anything over 10% is announced and delayed 24 hours, blockable by two directors or the founder
(`server/game/treasury.js:43-51`, `90-142`). A spam account is bounded by the message limits, and a compromised account
can send but cannot read anyone else's threads.

**Fail closed.** `can()` refuses any role or action not in its table (`server/conglomerates.js:135`, `138`). A malformed
catalogue stops the server (`:112-121`). An error inside a withdrawal's checks answers 503 with nothing moved
(`server/game/treasury.js:91-95`). A governance tally whose stakes do not sum to 100% refuses to decide
(`server/game/stationGovernance.js:43-94`). A project re-checks its materials at completion and builds nothing if short
(`server/game/stationProjects.js:252`). A dominance computation that throws keeps the last good reading
(`server/dominanceService.js:32-45`). A message write that fails rolls back both inboxes
(`server/game/conversations.js:190-203`).

## v0.13 — Corporation Warfare: territory, tariffs, dumping, patents, lobbying, arbitration

**Data.** Public corporation or conglomerate ids and names, control scores, rates, sale records, patent and campaign
records. No account id anywhere in this layer. Lobbying pledge amounts are never shown publicly
(`server/lobbyingService.js:162`). An arbitration case has no free text at all (`server/arbitration.js:2`).

**Reach and hostility.**
- **Territory.** Who is acting is always your own corporation or conglomerate, worked out on the server
  (`callerHolder`, `server/concessions.js:57-67`). A request never names a holder. Percentages are whole numbers within
  their ranges (`:350`).
- **Tariffs.** Only the holder in force, or its conglomerate's founder or a director, may set a rate, and only while
  docked in the system (`server/tariffService.js:152-167`). `rateProblem` refuses anything non-numeric, out of range or
  off-step (`server/game/tariffs.js:14-20`). The cap itself is at most 25% (`server/warfare.js:26`). The holder's own
  trades are exempt ("paying yourself would only feed the levy", `server/tariffService.js:10`, `85-87`). A shipment
  that cannot pay its fee and tariff is refused before it leaves (`server/routes/logistics.js:60-64`), so goods are
  never trapped.
- **Dumping.** Sales are recorded only from server settlement (`recordOwnSale`), never from a request. The duty is
  capped at the dumping margin (`public/scripts/dumping.js:55`). Bot floods priced just above the dumping line are
  #4672.
- **Patents.** Only the server-recorded first corporation to complete a thing may file, inside a window
  (`server/patents.js:77-90`), and a tie or a completion with no record refuses filing (`:83-84`, `88`, `108`), so
  nobody can patent what everyone already uses. One patent per subject (`:102-104`). The rate is a whole number up to
  the cap (`:99-101`). Royalties come from server-computed values (`public/scripts/patentRoyalty.js:14-16`), and the
  holder pays none on its own use (`server/patents.js:231`).
- **Lobbying and standing.** A pledge is limited to credits and standing you actually hold
  (`server/lobbyingService.js:118-125`). No route writes standing directly; only the listed writers do, and each write
  is bounded to [0, max] (`server/game/standing.js:19`, `29-34`).
- **Arbitration.** The claimant is always your own corporation. The evidence functions check that you are the actual
  party to the record (`server/arbitration.js:90`, `143`, `167`), and a claim against your own side is refused
  (`:224`, "own-side").

**Blast radius.** Fees go to a sink or a treasury. Pledges are pure sinks: a campaign moves a system setting within its
bounds and mints nothing (`server/lobbyingService.js:130-131`). Arbitration moves only money that already exists (below).

**Fail closed.** Stale control readings refuse petitions, challenges and renewals (`server/concessions.js:122`, `173`,
`211`). A tariff lookup that errors charges 0 and never an unbounded amount (`server/tariffService.js:101-113`). No
normal value means no dumping finding (`public/scripts/dumping.js:33-39`). A lobbying curve that cannot be evaluated is
refused before any charge (`public/scripts/lobbying.js:11-17`). An unknown claim type is a 400
(`server/arbitration.js:213`), evidence that cannot be read is a 503 with nothing charged (`:219-222`), and a rule that
throws leaves the case pending with an alert, never decided for the claimant (`:421-429`).

---

## Economic abuse across the systems

### Multi-account funnelling into a conglomerate treasury

**The scenario.** One person registers many accounts, each with its starting credits, puts them all into one
conglomerate's treasury, and a founder or director withdraws.

**What limits it.**
- Registration is 5 an hour per IP, and login waits for a verified email (root SECURITY.md,
  `server/game/verificationPolicy.js:20-24`, which treats an unknown policy as "required").
- Deposits pay a 2% custody fee (`server/game/treasury.js:64`).
- Withdrawals are daily-capped and announced above 10% (above).

**What does not.**
- Verification costs nothing more per account, because plus-address aliases of one inbox are separate accounts
  (#4798).
- Each account starts with 250,000 credits (`server/game/corporation.js:44`).
- Joining has no age gate. Founding does (7 days), joining does not (#4801).

**The bigger point.** The treasury is not needed at all: the market moves credits between any two accounts directly
(#4797). The withdrawal caps slow a payout. They do not stop the pool from filling.

### Wash trading to game ratings and dominance

**The scenario.** Two accounts trade or lend between themselves so that one looks profitable, creditworthy or dominant.

**What limits it.**
- A corporation cannot buy its own listing (`server/routes/market.js:233-237`), subscribe to its own bonds, borrow
  from itself, or buy its own shares.
- Sales between two members of one conglomerate do not count toward dominance or ITC standing
  (`server/marketSettlement.js:41-47`, `server/standingService.js:6`).
- Loans between one pair are capped at 100,000 per 30 days at a 2% floor. Holders of one issuer's equity are capped
  at 20%.
- Dividends come from real profit, never from trading.

**What does not.**
- A market order can be priced up to 1,000,000,000 a unit. An overpriced sale between two unaffiliated accounts books
  the gross as the seller's revenue (which the credit rating scores), dominance sales and ITC standing (#4797).
- A second account can take an entire bond series and book its coupons as income (#4799).
- Dominance credits a new member's whole week to its new conglomerate (#4802).

### Collusion to farm arbitration damages

**The scenario.** Two players, or a main and an alt, stage a dispute so that damages are minted or moved between them.

**What limits it: it is closed by design, and the controls are specific.**
- **No amount field.** A filing names only a claim type and a record (`server/arbitration.js:32`). Each type's evidence
  function computes the amount from server records: a mercenary readiness log, a tariff settlement, a patent-use log.
- **Damages come from money that already exists.**
  - A readiness refund comes out of the renter's own escrowed price (`server/mercenaries.js:223-231`), which is net
    zero for a colluding pair and costs real combat readiness.
  - An overcharged tariff or royalty is repaid from the holder's held accrual, or withheld from the holder's future
    sales (`server/tariffService.js:285-297`, `server/patents.js:187-195`, `server/arbitration.js:344-365`).
  - A concession case pays 0 (`:158`).
  - Nothing is minted.
- **No suing your own side.** A claim against your own corporation or conglomerate is refused (`:224`).
- **One case per record, ever.** A pair may have only so many cases open at once (`:80`, `:225-228`).
- **The fee is forfeit if dismissed.** It is escrowed and goes to the fee sink unless the claim is upheld or cured
  (`:433-439`).
- **An unevaluable rule decides nothing.** It leaves the case pending (`:421-429`).

**Residual, not filed.** The per-pair limit counts open cases only, so a colluding pair can file again on every new
record. Because every award is money one of them already put in, repetition moves nothing of value between them. It
only looks like activity. If awards ever come from a pool rather than a party, this must be revisited.

### Other paths checked

- **Mercenary contracts** transfer the price between two accounts when the fleet is never used (#4800).
- **Raiding your own alt** moves goods to the main. It is limited to inventory, capped at 20% over a floor, twice a
  week per target, after 14 days' protection on both sides (`server/raids.js:146-154`). Credits are never loot. It is
  bounded, and not filed separately from the multi-account findings.
- **Borrowing and sheltering in ships** before a default (#4803).
- **Tariff and patent self-dealing** is closed: both exempt the holder's own side (above).

---

## Findings filed (8)

All are area `Orchestrata\interstellar-settlement-protocol`, tagged `security` and `economy`, Proposed, with a
proposed fix. None was fixed here. Fixes are separate work.

| Bug | Severity | Finding |
|---|---|---|
| #4797 | 2 High | Market orders take any price up to 1,000,000,000 a unit: unlimited transfer between accounts, and the gross books as revenue, dominance and standing |
| #4798 | 3 Medium | Plus-address aliases let one inbox verify unlimited accounts, each with 250,000 starting credits |
| #4799 | 3 Medium | Bonds have no pair or holder cap (loans and equity do), so an alt can take a whole series and lift its rating on coupons |
| #4800 | 3 Medium | Mercenary collateral from 1 credit: an unused hire is a 10,000,000-credit transfer every 12 hours per fleet |
| #4801 | 3 Medium | Joining a conglomerate has no account-age gate, so new accounts can pool their starting credits |
| #4802 | 4 Low | Dominance credits a member's whole 7-day window to the conglomerate it just joined |
| #4803 | 4 Low | Default recovery never reaches ships or troops (intent to confirm against AB#702) |
| #4804 | 4 Low | An item no research node claims is recoverable by all: a forgotten Tier 4 gate fails open (load-time check) |

The order to fix them in is not the severity order. #4797 and #4798 are the channel and the supply behind most of the
rest. Bounding what an overpriced sale can mean closes the rating, dominance and standing gains at once. After that,
#4800 is the next channel, and #4801 matters less.

## Checked and ruled out

- **Acting on another account's objects.** Every id-bearing route in these systems is checked against the caller's own
  lists, before the handler or inside it. None was found that is not.
- **Bad numbers.** Every quantity, price, rate and term passes a whole-number range check, most of them twice.
- **Double spending and double payment.** Every check-then-debit is synchronous, and every transfer and item move is
  keyed to happen once.
- **Rewards claimed twice.** Level unlocks are idempotent, and there is no refund-on-demolish route.
- **Script injection in messages.** Every text fragment is escaped, and link schemes are restricted.
- **Choosing a combat outcome.** Combat is deterministic, and no preview reveals a defender's force.
- **Candidate: the raid ticker crashes the process.** Ruled out. The process-level `uncaughtException` handler logs
  and continues (`server/index.js:80-82`).
- **Candidate: the extractor-yard price curve can be gamed through forced sales.** Ruled out. The forced sale returns
  40% of cost, so rebuilding is a net loss (`server/defaultRecovery.js:118`).
- **Candidate: a dividend can be captured by buying just before the tick.** Not a finding. It reads current holders
  (`server/dividends.js:71-89`), but offerings run on the issuer's schedule, once in 30 days, and dividends are paid
  from real profit, so an issuer's own alt would be paid the issuer's own money.
