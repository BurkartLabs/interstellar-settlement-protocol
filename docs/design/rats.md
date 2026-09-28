# Rats in asteroid fields: encounters, escorts, hunts (AB#819)

**Where it sits.** This is v0.7's plan line "Pirate (Rats) NPC enemies in asteroid fields", moved after v0.10 so players
can fight Rats with the v0.10 units, resolver and fleets. It reads with `docs/design/v0.10-combat.md`, whose unit
catalog (`data/units.json`) and resolver (`server/game/combat.js`) it uses unchanged.

**The stories that implement it:**
- AB#820: resolve encounters on the server, with an escort.
- AB#821: the launch screen.
- AB#991: hunts.
- AB#992: pirates on the map.

**The arithmetic below is reproducible:** `node scripts/rats-model.mjs` prints every figure, with `--belt <system>` for
one belt and `--table` for all of them. The model fights every escort battle with the real resolver. If a number here
changes, it changes in the data file AB#820 creates first (`data/rats.json`), then in this file (P-TWO-SOURCES).

## The Board's answer, and the one assumption

The Board answered D-0.7-1 (AB#701): **"We should be able to fight pirates by the time they're added."** So Rats arrive
with a way to fight them: an escort fleet on an expedition, or a fleet sent to hunt a belt.

The answer leaves open what an **unescorted** expedition suffers. This design takes the option the decision
recommended (option A), and states it as an **assumption**:

> **Assumption.** An unescorted expedition that meets Rats loses part of its haul, never its probe and never anything
> already stored. The table in section 4 sets how much.

## What never happens

- **Nothing happens to a player's property while they are away, beyond the risk they accepted at launch.** An
  expedition's risk is fixed when it launches: its belt, its length and its escort.
- **Probes are never destroyed or taken.** An expedition always comes home with its probe, even when stripped.
- **Stored goods are never taken.** Rats never raid a station, an inventory or a hangar. They meet expeditions in belts,
  and nothing else.
- **An escort loses units only in a fight at the belt,** as the resolver says, the same as any v0.10 battle.
- **The chance is shown before launch, as a percentage,** without an escort and with the chosen one (section 7). What
  the player sees is what the server rolls against.

## 1. The encounter formula

A belt's danger is its system's `pirateDensity` in `data/systems.json`, which nothing read before this. Density `d`
runs from 9 (Sirius) to 47 (van Maanen's Star).

**The rate rises through an expedition.** The longer a probe sits in a belt, the more attention it draws. At `t`
hours in, Rats arrive at a rate of

    rate(t) = (d / 100) × (1 + t / τ)        τ = 1 hour

so an expedition of `T` hours expects

    μ(T) = (d / 100) × (T + T² / 2τ) × deterrence

encounters. The number that happens is Poisson with mean `μ`. The chance of meeting Rats at least once, the figure
the launch screen shows, is `1 − e^(−μ)`.

**An escort deters.** Rats pick easier prey:

    deterrence = 1 / (1 + P_escort / P_rats)

Here `P` is a force's strength, the sum over its units of count × attack × hp. An escort as strong as the belt's
group halves the encounter rate; no escort leaves it unchanged.

**Why the rate rises.** Today every launch pays a flat 3,000 credits and the haul grows linearly with time, so the
longest expedition is always best: the same answer every time (T-018). A flat risk per hour would not change that. A
rising one does. Expected losses then grow faster than the haul, so the best length depends on the belt's value, its
danger, and the escort the player can field (section 6).

**Seeded, on the server.**
- At launch the server draws the number of encounters and their times from a seed: an HMAC of the server's secret and
  the expedition's id.
- It stores them on the expedition, and never sends them to the client before they happen.
- The expedition tick resolves each encounter when its time is reached. Each one has an id, and is applied once
  however often the tick runs.
- For a fixed seed, the encounters, the battles and the outcome are the same every time. That is AB#820's test.

## 2. Each belt's Rat group

Rats fly the v0.10 catalog's own ships: Light Fighters and Destroyers. There are no troops, which are for boarding and
garrisons, and no Siege Engines, which are for stations.

    group(d) = round(d / 3) Light Fighters + floor(d / 10) Destroyers

**Rats gather.** A later encounter in the same expedition meets a larger group: the `i`-th after the first (i = 1, 2, …)
has its counts × (1 + 0.5 × i), rounded. A long stay meets a crowd.

**The counters decide the right escort, not the size of the fleet.** Rats bring Destroyers, and in the catalog
Destroyers are strong against Light Fighters. Attack Troops are strong against Destroyers, and fleets carry them. So a
fighter screen is shredded, and the escort that works is Destroyers with Attack Troops. At Wolf 359, 14 Light Fighters
and 4 Destroyers only draw with the group, where 6 Destroyers and 6 Attack Troops win.

| Belt | System | Density | Rat group | Short (½ h) | Standard (1 h) | Extended (2 h) | Best setting (one probe) | Per slot-hour |
|---|---|---:|---|---:|---:|---:|---|---:|
| Asteroid Belt | Sol | 11 | 4 LF + 1 DS | 7% | 15% | 36% | extended, no escort | 1,670 |
| Centauri Belt | Alpha Centauri | 15 | 5 LF + 1 DS | 9% | 20% | 45% | extended, 4 DS + 4 AT | 3,930 |
| Rift Debris Ring | Barnard's Star | 22 | 7 LF + 2 DS | 13% | 28% | 59% | extended, 6 DS + 6 AT | 4,289 |
| Shard Belt | Wolf 359 | 31 | 10 LF + 3 DS | 18% | 37% | 71% | extended, 6 DS + 6 AT | 13,916 |
| Tau Ice Cloud | Tau Ceti | 18 | 6 LF + 1 DS | 11% | 24% | 51% | extended, 4 DS + 4 AT | 24,183 |
| Crown Belt | Epsilon Eridani | 25 | 8 LF + 2 DS | 14% | 31% | 63% | extended, 6 DS + 6 AT | 48,820 |
| Halley Drift | Lalande 21185 | 14 | 5 LF + 1 DS | 8% | 19% | 43% | extended, 4 DS + 4 AT | 4,120 |
| Flare Ring | Ross 154 | 19 | 6 LF + 1 DS | 11% | 25% | 53% | extended, 4 DS + 4 AT | 4,759 |
| Canis Debris Disk | Sirius | 9 | 3 LF | 5% | 13% | 30% | extended, 4 LF | 10,236 |
| Frost Halo | Ross 248 | 27 | 9 LF + 2 DS | 16% | 33% | 66% | extended, no escort | 4,777 |
| Twin Flare Belt | Luyten 726-8 | 38 | 13 LF + 3 DS | 21% | 43% | 78% | standard, 6 DS + 6 AT | 22,055 |
| Southern Reef | Lacaille 9352 | 21 | 7 LF + 2 DS | 12% | 27% | 57% | extended, 6 DS + 6 AT | 16,271 |
| Procyon Scatter | Procyon | 17 | 6 LF + 1 DS | 10% | 23% | 49% | extended, 4 DS + 4 AT | 31,288 |
| Quiet Belt | Ross 128 | 24 | 8 LF + 2 DS | 14% | 30% | 62% | extended, 6 DS + 6 AT | 16,365 |
| Swan's Wake | 61 Cygni | 16 | 5 LF + 1 DS | 10% | 21% | 47% | extended, 4 DS + 4 AT | 21,569 |
| Halo Drift | Kapteyn's Star | 41 | 14 LF + 4 DS | 23% | 46% | 81% | standard, 6 DS + 6 AT | 61,373 |
| Indus Belt | Epsilon Indi | 33 | 11 LF + 3 DS | 19% | 39% | 73% | extended, 6 DS + 6 AT | 47,881 |
| Kruger Stream | Kruger 60 | 36 | 12 LF + 3 DS | 20% | 42% | 76% | extended, 6 DS + 6 AT | 46,280 |
| Wolf Reach | Wolf 1061 | 29 | 10 LF + 2 DS | 17% | 35% | 69% | extended, 6 DS + 6 AT | 30,128 |
| Aquila Ring | Altair | 22 | 7 LF + 2 DS | 13% | 28% | 59% | extended, 6 DS + 6 AT | 50,005 |
| Serpent Belt | 70 Ophiuchi | 32 | 11 LF + 3 DS | 18% | 38% | 72% | extended, 6 DS + 6 AT | 31,407 |
| Remnant Field | van Maanen's Star | 47 | 16 LF + 4 DS | 25% | 51% | 85% | standard, 6 DS + 6 AT | 81,091 |

The three length columns are the chance of meeting Rats at least once, unescorted. "Best setting" and "Per slot-hour"
are the optimising bot's (section 6), for one probe in one deployment slot, over the escort menu the model tries: none;
4 LF; 6 LF + 2 DS; 4 DS + 4 AT; 6 DS + 6 AT; 12 LF + 4 DS + 6 AT.

## 3. Escorts

- **Choosing one.** `launch-expedition` takes an optional fleet id. The fleet must be:
  - the caller's own, or a hired one whose contract allows `pve` or `raids` (`mercenaryUseAllowed`, AB#870);
  - stationed in the belt's system;
  - not in transit, not on offer, and not already escorting or raiding.

  Anything else is refused with nothing changed.
- **Committed.** An escort is committed for the expedition's duration. It cannot be deployed, split, merged, offered,
  sent on a raid or assigned to a second escort. It is released when the expedition ends.
- **Provisions.** An escort costs **30 credits per supply point per hour** of the expedition, paid with the launch cost
  and booked as a sink. This is what makes a bigger escort a real choice rather than a free one.
- **The fight.** Each encounter is fought by what is left of the escort, against the belt's group (gathered, section 2),
  through `resolveBattle(escort, rats)`. The escort takes its owner's combat modifiers and readiness (v0.10); the Rats
  take neutral ones.
  - **The Rats win** (the resolver says `defender`): the escort is beaten. Its survivors stay committed but no longer
    protect the haul, and this and every later encounter rolls on the unescorted table.
  - **The escort wins, or it is a draw:** the Rats break off and the haul is safe. They must beat the escort to reach
    the haul.
- **Losses are real.** Units the resolver removes leave the owner's forces, as in a raid. Kills made by an escort earn no
  bounty; bounties are for hunts (section 5).

**As built (AB#820).**
- The numbers are `data/rats.json`, and the rules are `server/game/rats.js`. The expedition tick resolves encounters
  (`settleRats`), and launch takes `escortFleetId`.
- An escort is one of the caller's own fleets (`escortFleetId`) or, since AB#4678, a hired one (`escortContractId`): its
  contract must allow pve or raids, its fleet stays committed on its owner's books (`server/hiredEscort.js`), it fights
  with what it has left and its owner's modifiers, and its losses are recorded on the contract (`recordContractLosses`),
  paid from the collateral when the contract settles, which waits until the escort is home, as it does for a raid.
- An expedition's `rats` record holds its danger, its escort, the chances shown at launch, and each encounter as it
  happens: the Rats met, the escort's fight with the resolver's rounds and losses, and the unescorted roll with the
  haul it took.
- The launch receipt states the chance of meeting Rats. The launch screen that shows it **before** launch is AB#821.

## 4. The unescorted outcome table

Each encounter an expedition meets without a holding escort rolls once on this table. It takes a share of the haul
carried at that moment:

| Roll | Chance | Haul lost |
|---|---:|---:|
| Harried | 40% | 10% |
| Raided | 40% | 25% |
| Stripped | 20% | 40% |

- The mean loss per encounter is **22%**. Losses compound: two encounters keep 0.78² of the haul on average.
- The haul never falls below 0. The probe always returns, and nothing already stored is touched.
- Three stripped rolls in a row keep 22% of the haul. That is a real risk where Rats are thick: an unescorted extended
  run at van Maanen's Star expects 1.88 encounters and meets three or more on 29% of runs. That is why the best setting
  there is shorter and escorted, and the launch screen says so before the probe leaves.
- The losses are within the 10% to 40% the decision proposed for option A.

## 5. Hunts (AB#991)

A hunt sends a fleet to a belt to fight its Rat group. The fleet must be stationed in the belt's system, with the same
eligibility as an escort. The group is fought at its base size: gathering is for expeditions that stay.

- **Win.** The ISA pays a **bounty of 40% of the destroyed Rats' value**, where value is catalog credits plus goods at
  the NPC bid, the value v0.10 uses for losses. The belt then goes **quiet for 24 hours**: its encounter rate is ×0.25
  for everyone, and the group regrows at the end.
- **Draw or loss.** No bounty, no quiet period, and the units lost are lost.
- **Bounded.** A bounty creates credits, so it is capped by the regrowth: one group per belt per 24 hours, 22 belts.

**The numbers,** fought with the resolver. Provisions are 30 per supply point for a one-hour hunt.

| Belt | Hunting fleet | Result | Units lost | Rats destroyed | Bounty | Net |
|---|---|---|---:|---:|---:|---:|
| Sol | 6 DS + 6 AT | win | 946 | 9,734 | 3,894 | +2,048 |
| Wolf 359 | 6 DS + 6 AT | win | 8,078 | 26,482 | 10,593 | +1,615 |
| Wolf 359 | 4 DS + 4 AT | draw | 12,372 | (17,894) | 0 | −12,972 |
| van Maanen's Star | 8 DS + 8 AT | win | 14,264 | 38,936 | 15,574 | +110 |

Hunting pays thinly where Rats are few and roughly breaks even where they are many. Its real return is the quiet
period for whoever mines that belt, rivals included. A hunt is a public good bought by the hunter, so whether to hunt
depends on how much a corporation mines there.

## 6. The arithmetic: why no single launch setting wins (T-018)

For each belt, the model tries every length and every escort on the menu. It scores each by its expected result per
**slot-hour**, since a deployment slot is the scarce resource:

    expected profit = haul × expected share kept − launch cost − provisions − expected escort losses

The haul is `3 units/min × minutes × rarity multiplier × the belt's value per unit` (its composition at NPC bid prices).

**Sol**, value 19.4 a unit, density 11. The figures are per slot-hour.

| Length | No escort | 4 LF | 6 LF + 2 DS | 4 DS + 4 AT | 6 DS + 6 AT |
|---|---:|---:|---:|---:|---:|
| Short | −2,560 | −3,267 | −3,125 | −3,140 | −3,430 |
| Standard | 368 | −418 | −168 | −149 | −435 |
| Extended | **1,670** | 782 | 1,238 | 1,329 | 1,055 |

In Sol the best setting is **extended with no escort**. Worked through: the haul is 3 × 120 × 1.0 × 19.4 = 6,984. The
expected encounters are μ = 0.11 × (2 + 2) = 0.44, so the share kept is e^(−0.44 × 0.22) = 0.908. That gives
6,339 − 3,000 = 3,339 a launch, or 1,670 an hour. Rats are too few and the haul too cheap to pay for any escort.

**Wolf 359**, value 76.7 a unit (rare, ×1.35), density 31. The figures are per slot-hour.

| Length | No escort | 4 LF | 6 LF + 2 DS | 4 DS + 4 AT | 6 DS + 6 AT |
|---|---:|---:|---:|---:|---:|
| Short | 11,856 | 9,997 | 8,036 | 9,795 | 10,516 |
| Standard | **13,821** | 11,915 | 9,991 | 12,336 | 13,191 |
| Extended | 12,683 | 10,980 | 9,463 | 12,747 | **13,916** |

At Wolf 359, **without a fleet, the best length is standard, not extended**. Extended unescorted keeps only
e^(−1.24 × 0.22) = 0.761 of a 37,266 haul: 12,683 an hour, against 13,821 for standard. **With 6 DS + 6 AT the best is
extended.** That escort holds through 99% of runs, and it pays for its provisions and losses: 13,916 an hour.

So between the two belts, the best length and the best escort both differ. Sol wants extended with no escort. Wolf 359
wants standard without a fleet, or extended with the right one. The escort that wins is the counter mix, not the
biggest fleet: 12 LF + 4 DS + 6 AT holds as well but pays more in provisions (12,764).

**Across all 22 belts** there are five different best settings:

| Best setting | Belts |
|---|---:|
| extended, 6 DS + 6 AT | 10 |
| extended, 4 DS + 4 AT | 6 |
| standard, 6 DS + 6 AT | 3 |
| extended, no escort | 2 |
| extended, 4 LF | 1 |

No single launch setting is best in all of them.

**Probe target (a bot number, not a measure of players).** `scripts/rats-model.mjs`'s optimising bot, across the belts,
must find **at least four distinct best settings, with none best in more than half the belts**. Today it finds five,
the most common best in 10 of 22. `tests/probes/rats-model.test.js` asserts it, so a change to the numbers that
collapses the choice to one answer fails. The bot scores one probe in one slot against an escort menu. It says nothing
about what players do, and nothing here should be quoted as a player figure (P-PROXY).

## 7. What the player sees at launch (AB#821)

Before launching, the belt panel shows:
- **the chance of meeting Rats**, unescorted and with the chosen fleet, as percentages (the figures in the table);
- **the chance the escort holds**: the share of runs in which the Rats never beat it;
- **the expected share of the haul kept**;
- **the provisions cost**.

These are the server's own numbers for that launch, from the same functions the tick uses.

## 8. The numbers (for `data/rats.json`, AB#820)

| Name | Value | Meaning |
|---|---|---|
| `hazardPerDensityHour` | 0.01 | Base encounter rate: density `d` gives `d / 100` encounters an hour at the start |
| `attentionHours` | 1 | τ: the rate rises by the base each τ hours in the belt |
| `groupPerDensity` | LF 1/3 (round), DS 1/10 (floor) | A belt's Rat group from its density |
| `gathering` | 0.5 | Each later encounter in one expedition meets a group this much larger |
| `deterrence` | 1 | An escort as strong as the group halves the rate |
| `unescorted` | 40% / 10%, 40% / 25%, 20% / 40% | Chance / haul lost: harried, raided, stripped |
| `escortCostPerSupplyHour` | 30 | Provisions, credits per supply point per hour |
| `bountyPctOfValue` | 40 | A hunt's bounty, % of destroyed Rats' value |
| `quietHours` | 24 | After a won hunt: the belt's rate ×`quietRateFactor`, and its group regrows |
| `quietRateFactor` | 0.25 | |

## 9. Prior art

**EVE Online belt rats** (EVE University, *Belt rat*):
- **Taken:** Rats spawn per belt, more often and stronger in less secure systems, which is our `pirateDensity`. They
  pay a bounty on kill. They come back after being cleared: EVE respawns them in about 20 minutes, ours regrow over a
  24-hour quiet period, to match a game played in hours rather than minutes.
- **Not taken:** EVE rats attack ships in any belt, at any time. Here they meet only expeditions, and only with the
  risk shown at launch (the Board's answer on AB#701).

## Out of scope, noted

- **The Short Sweep loses money before any Rat.** In Sol and the other low-value belts it doesn't cover the 3,000
  launch cost: Sol's is −1,254 a launch with no Rats at all. That is an ECONOMY.md question about the launch cost
  against the haul, not this design's.
- **No loot from Rats, and no Rats outside belts.** Stations, logistics and the starmap routes are untouched.
