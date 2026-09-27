# BRIEF — interstellar-settlement-protocol

Size: **L**, which the template forbids for a new bet. This one is exempt because it is not a new bet: versions
0.1 to 0.4 are already built and the remaining work is sliced into versions that are each S or M.
Stage: **Build** · Rank: **3** · Onboarded 2026-09-20 by Board decision #353 · Epic **AB#388**

## One sentence

You run a corporation in 2147: hire people, lease mining rights across Sol, refine what you extract, and trade it
on an exchange where the other side of the order is another player.

## The verb (what the finger does)

**Allocate.** Every session is the same shape at a different scale: you have credits, employees and building
slots, and you decide where they go. Early it is "which body do I lease"; later it is "do I issue a bond or sell
the refinery". The game is a spreadsheet that argues back.

## Who it is for, how they find it

People who like the *management* half of strategy games and are bored by the combat half — the EVE player who
lives in the market window, the Gaia Project player, the person who plays Football Manager without watching the
matches. They find it the way text-first browser games have always been found: a forum post, a subreddit, a
friend who is already in a conglomerate and needs members.

Explicitly **not** a mobile idle game. It asks for attention and repays it with detail.

## What we will measure first

**Do players come back on day 3 without being reminded?** The corporation levels, the R&D queue and the refinery
chains all pay out on a delay, so the entire design is a bet that a delayed payout brings someone back. If D3
return is low, the loop is not compelling and no amount of new systems will fix it — that is the number that
keeps or kills this after 200 sessions.

Second number, once there are enough players for it to mean anything: **orders filled by another player rather
than by an NPC anchor**. A player-driven economy where players only ever trade with NPCs is a single-player game
with extra steps.

## Monetization

**None yet, and none before 1.0.** No pricing decision has been made and none should be made while the game is
pre-beta. When it is asked, the Monetization Critic reviews it like any other product (RUBRIC), and the honest
answers to explore first are cosmetic (station and corporate identity) and convenience that does not sell
advantage in a player-versus-player economy. Selling power in a market game breaks the market.

**Three Board rulings bind every shop, pack, pass or paid feature this game will ever have** (AB#1776). Each is a
rule to apply as written; the decision number after it is where the Board's own words are, not something to look
up first. Two of them bind systems that are not built yet, so whoever starts v0.9 or v0.10 starts under them.

1. **Nothing in the game may be traded for real money in a way that gives one player an advantage over
   another.** Not credits, resources, goods, buildings, leases, employees, levels, time, or a better price on the
   exchange; nor anything bought with real money and then traded to another player. It is a rule for the whole
   game, not only the v0.9 finance features it was first asked about, because a general rule written in one place
   is read as permission everywhere it isn't repeated (T-021). **It binds all of v0.9's financial mechanics before
   any of them exists:** bond issuance, loans, equity in other corporations, investment returns, and credit
   ratings may never be sold, sped up or improved for real money. (Board decision **AB#703**, 2026-09-21, verbatim:
   *"We don't want any player to be able to gain an unfair advantage by trading anything in game for real money.
   This would be a violation of the Real Money Trading rule"*.)

   **The v0.9 never-sell list** (AB#857). The Board's answer is read conservatively, so it forbids both ways money
   could buy an advantage: **(a)** the game selling, speeding up or improving any of these for real money, and
   **(b)** players trading any of them, or the credits, goods, loans, bonds or shares they move, with each other for
   real money. Every financial mechanic v0.9 built is on it:

   - **The credit grade and every rating input:** the score, the grade and its caps, the statements it reads, and
     the not-rated threshold (`server/creditRating.js`, `data/credit-rating.json`).
   - **Loans:** the Development Bank's rates, spreads, principal limits, origination fee, quotes and their expiry
     (`data/loan-products.json`); player loan offers, their rates, and the per-pair cap.
   - **Bonds:** issuing and its level and grade gate, the coupon, the subscription window, the underwriter's fill,
     coupons and redemption (`data/bond-terms.json`).
   - **Shares:** listing, its gate and fee, offering size and allocation, the share price (company value divided by
     shares outstanding), the holder cap and the founder floor, and the market maker's fill and exit
     (`data/share-terms.json`).
   - **Dividends:** the payout ratio, the pool, and each holder's share of it.
   - **Arrears relief and default recovery:** late fees, penalty interest, the grace period, what is sold, at what
     price and in what order.
   - **The conglomerate treasury:** deposits, withdrawals, pooling, the charter fee and its levels
     (`data/conglomerates.json`).

   **No cosmetic carve-out.** The Decision offered one (convenience that changes no number, option B); the answer did
   not take it, so none is open. **Not listed is not permitted:** anything v0.9 or later adds that could give one
   player an advantage over another needs a Board Decision before it is sold, not a reading of this list.
   `tests/unit/no-payments.test.js` also fails when any of those data files gains a price or currency field.

2. **Research and CEO Insight may never be sold or sped up for real money: not a node, a level, a completion, or
   the wait for one. Items may always be sold**, meaning a player can always put an item up for sale in the game;
   rule 1 still decides whether anything may be sold for real money. This binds systems that exist today: the
   research tree (`data/research.json`) and the CEO Insight programs (`data/ceo-insight.json`). (Board decision
   **AB#980**, 2026-09-21, verbatim: *"Research and Inisght [sic] should never be sellable. Items should always be
   sellable"*.) The example the Decision was asked about: CEO Insight's Negotiation Fundamentals program
   (`ceo-negotiation-fundamentals` in `data/ceo-insight.json`; applied in `server/game/progression.js`'s
   `getEffectiveExchangeTaxRate`) cuts a player's Galactic Exchange sales tax from 8% to as low as 2%, earned only
   with in-game credits and time. Because every player sells on the same market, that discount is taken straight
   out of other players' trades: sold or sped up for real money, it would be the plainest pay-to-win item in the
   game.

3. **No v0.10 military mechanic may ever be sold or accelerated for real money: all of them.** Units, troops,
   fleets and their ships, the shipyard, build or training time, shields or protection, upkeep and readiness, fleet
   cap, raid cooldowns and mercenary terms, and anything else v0.10 adds that makes one corporation stronger in a
   fight, because whatever is sold to the raider is taken from the corporation it raids. **It binds v0.10 before any
   of it exists.** The Decision also offered to leave cosmetic fleet naming or livery open (its option B); the
   answer did not take it, so that is not open either without a new decision. (Board decision **AB#706**,
   2026-09-21, answering "which v0.10 military mechanics may never be sold or accelerated for real money?"
   verbatim: *"All"*.)

   **The v0.10 never-sell list** (AB#876). As with v0.9's, the answer forbids both ways money could buy an
   advantage: **(a)** the game selling, speeding up or improving any of these for real money, and **(b)** players
   trading any of them, or the units, goods and credits they move, with each other for real money. Every military
   mechanic v0.10 built is on it:

   - **Units and troops:** every ship and troop type, its stats and its cost (`data/units.json`), and the Fleet Cap.
   - **Build and training time:** the Orbital Shipyard's queue, Headquarters troop training, and the shipyard's
     levels (`server/shipyard.js`, `server/training.js`).
   - **Combat:** the resolver, the counters, accuracy and evasion, and every modifier (Fire Control, Evasive
     Manoeuvres, CEO leadership) (`server/game/combat.js`).
   - **Upkeep and readiness:** the daily upkeep, the logistics capacity, and readiness lost when it is unpaid; there
     is no paid way to restore readiness.
   - **Fleets:** forming, splitting, deploying, travel time, and the garrison and its posture.
   - **Shields and protection:** the 14-day new-player protection, the post-raid cooldown, the repeat and rate
     limits, and the raid warning window (`server/raids.js`).
   - **Raids:** declaring, what a raid takes (the loot cap, its floor and the hold), losses, reinforcing in the
     window, and the battle report (`server/raidResolution.js`, `server/garrison.js`).
   - **Building damage and repair:** a damaged building's condition and output, and the repair price.
   - **Mercenary contracts:** offering and hiring a fleet, the term, price, collateral, allowed use, and the
     settlement of losses (`server/mercenaries.js`).

   **Anything military not named here is covered too**: the answer was "All", so a mechanic v0.10 or later adds
   that makes one corporation stronger in a fight is on this list the day it is built, without a new decision.
   **No cosmetic carve-out**: the Decision offered fleet naming or livery (option B) and the answer did not take it.
   `tests/unit/no-payments.test.js` also fails when `data/units.json` gains a price or currency field.

The 8% base exchange tax is where a future business model would take its cut, a small fee on trades between
players, instead of selling advantages (T-022). `tests/unit/no-payments.test.js` (AB#779) fails on payment code
before 1.0, but it reads vocabulary, not intent: these three rules are what stop a shop that sells the wrong thing.

## Out of scope

- Anything in v0.6 and beyond, until v0.5 ships. The roadmap is long and the temptation to build the fun parts
  first is exactly how this project went dormant in May.
- Combat. It is v0.10 and deliberately late: an economy has to be worth raiding before raiding is interesting.
- Mobile. It is a desktop browser game and pretending otherwise would cost the density that makes it work.

## Player-to-player text in the playtest (Board ruling, AB#696)

Global chat, local chat, the forums and player mail ship to the playtest as they are, with **no word filter, no
report button, no block or mute, no moderator tool, no removal script and no age statement**. That is the Board's
accepted risk. The Board's ruling on Decision AB#696, 2026-09-21, verbatim:

> *"no safety measures. And yes ship in playtest"*

That is option C, "ship as is", of the three the Decision set out. The Decision recommended A (turn player text
off for the playtest); B was a minimal safety kit.

What that means in the build (AB#733):

- Nothing is hidden and nothing is behind a flag: there is no social feature flag.
- Player text is stored and relayed as it was typed, and every screen renders it as text, never as HTML: chat
  lines and forum posts escape every field, and a mail's subject and body are set as text. Chat used to delete
  anything between < and >; it no longer does (AB#1127).
- The author is always the logged-in account's corporation, never a name the request supplies. The defects that
  made this untrue were fixed before this ruling was applied: chat took unauthenticated posts and trusted the
  client's author (AB#710), mail was routed by corporation name (AB#711), and chat was dead on a fresh install
  (AB#749).
- Length is bounded where the input boxes already bound it: 300 characters for a chat line, 200 for a title or
  subject, 8,000 for a post or message body, 4,000 for a reply. Every route refuses other input before it changes
  state (AB#731, AB#732, AB#1127). Those limits are input safety, not moderation.

If the playtest widens beyond invited players, AB#696's option B is the shape to revisit.

## Acceptance for Preview (v0.5, AB#389)

- [ ] A stranger can register, rent an office, hire, lease a body, build an extractor and sell on the exchange
      without anyone explaining anything (ISP-5, ISP-6)
- [ ] Financial statements survive the tab closing (ISP-1)
- [ ] The exchange shows price history, filters and sorts (ISP-2, ISP-3)
- [ ] Every 0.1–0.4 system has been swept for bugs, each one filed before it was fixed (ISP-7)
- [ ] Auth, rate limiting, input validation and secrets answered against the four security-first questions (ISP-10)
- [ ] A clean environment comes up from the repo and the migrations, and rollback has been done once (ISP-11)

## Known gaps, recorded at onboarding

- **Licence: proprietary, all rights reserved** (Board decision #416, 2026-09-20: *"this needs to be protected.
  It's not a project I want anyone taking"*). A LICENSE file now says so explicitly, because "no licence file"
  and "all rights reserved" mean the same thing legally but not to a reader, and CONTRIBUTING.md no longer
  invites pull requests the licence cannot accept. **Still open for the Board:** making the GitHub repository
  private is the stronger protection and costs nothing — a public repository can be read, scraped and trained on
  whatever the licence says.
- **The public kanban disagrees with the docs.** `kanban/kanbanState.json` (38 cards, also served on
  burkart.dev) lists R&D and refineries as outstanding where `DEVELOPMENT_PHASES.md` marks them complete in v0.3.
  The roadmap file is treated as the source of truth here; the board needs reconciling or retiring.
- **`data/accounts-snapshot.json` holds two real accounts** (Orchestrata AB#415, severity 1). Decision #354 had
  answered "not real user data", and that is true for 127 of the 129 records — but two are real addresses, and
  all 129 carry a password hash, with 106 carrying refresh tokens. The file is now untracked and gitignored, and
  `server/gameState.js` recreates it locally and copes with its absence. **Untracking does not remove it from
  history**: the passwords behind those two accounts need changing, every refresh token needs invalidating, and
  the file needs purging from the public history. The code already carried a TODO to stop writing account
  snapshots to disk at all.
- **Dormant since 2026-05-03.** Nothing has been verified against a running instance in four months; ISP-7 and
  ISP-9 exist partly to find out what has rotted.

## Estimated load

| Phase | Sessions | Calendar |
|---|---|---|
| v0.5 Beta MVP (15 stories, AB#400–AB#414) | ~18–25 Builder sessions | Weeks, not days — it shares a queue with Relic Vault, which is rank 2 |
| v0.6–v0.8 | not estimated until v0.5 ships | — |

Agents will reach this product only when Relic Vault has nothing agent-ready, because rank decides the order.
That is intended: this is onboarded so the queue exists, not so it competes tonight.
