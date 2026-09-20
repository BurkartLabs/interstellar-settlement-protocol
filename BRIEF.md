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

## Out of scope

- Anything in v0.6 and beyond, until v0.5 ships. The roadmap is long and the temptation to build the fun parts
  first is exactly how this project went dormant in May.
- Combat. It is v0.10 and deliberately late: an economy has to be worth raiding before raiding is interesting.
- Mobile. It is a desktop browser game and pretending otherwise would cost the density that makes it work.

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
