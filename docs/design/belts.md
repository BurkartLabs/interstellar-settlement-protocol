# Asteroid belts that run out and come back (AB#1050)

Belts are static today. Each system has one, with a fixed composition and its system's fixed rarity label
(data/systems.json), and it never runs out, so scouting one is a decision made once and the expedition loop has no
pressure. The TODOs in server/game/asteroids.js have asked for more since v0.3: a belt with a limited amount of ore
that disappears when mined out and comes back with a 20% chance each hour on the hour, a random composition, and rarity
as a distribution per system, so an exotic belt in Sol is possible but rare. This is that design. The build is three
stories: AB#2329 (belt state, the respawn draw and the spawn rules), AB#2330 (expeditions draw from the reserve) and
AB#2331 (the Starmap shows it).

**Every number here is computed by `npm run belt:model` (scripts/belt-model.mjs)** from data/economy.json,
data/systems.json and the rules in the code it names, and quoted below exactly as it prints it
(tests/unit/beltModel.test.js keeps the two in step, and checks each code rule against the source). The model plays
perfectly and sells at the base bid; it is not a measurement of players (P-PROXY).

## The rules

1. **A belt is finite.** It holds a reserve of units, set by its tier: **14 standard expeditions' yield** at that tier
   (2,520 units for a common belt, 4,032 for an exotic one). An expedition's yield comes out of the reserve tick by
   tick, and every corporation on the belt draws from the same reserve.
2. **A mined-out belt disappears.** The tick that empties it ends every expedition on it: each comes home with what it
   carried, its probe returns, the launch cost is not refunded, and the report says it ended early. The slot is empty.
3. **An empty slot draws on the hour.** At every xx:00 (UTC), each empty slot spawns a belt with a **20%** chance
   (the TODO's number). The wait is geometric: 5 hours on average, and a slot is still empty after 12 hours 6.9% of
   the time.
4. **A new belt's rarity is drawn from its system's distribution.** A system keeps its label as its most likely tier,
   and each tier further away is **0.25 times** as likely: Sol spawns a common belt 75.3% of the time and an exotic one
   1.2% of the time; Epsilon Eridani the reverse. The label in data/systems.json becomes the centre of the distribution,
   not the answer.
5. **A new belt's composition is its tier's template, jittered.** A tier's template is today's belts of that label,
   averaged: every belt in data/systems.json with that label counts, so a system added to the catalog moves its tier's
   template (AB#2336). Each resource's weight is multiplied by a draw in **1 ± 0.25**, then the weights are
   renormalized, so two belts of one tier differ without changing character.
6. **A new belt is unscouted.** Scouting is of a generation: every corporation must scout a respawned belt again
   before it knows what is in it. That makes scouting a recurring decision, as the item asks.
7. **Today's belts carry over.** On the release that builds this, each system's current belt becomes generation 1
   with its current composition and rarity and a full reserve; nothing a player scouted is lost.

## The numbers

<!-- belt-model:start -->
```text
Launch cost 3,000. Credits are what the standing orders pay for the belt's mix, after the 8% tax;
a resource no standing order buys (Water Ice, Hydrogen, Lithium, Cobalt, Thorium, Uranium, Exotic Matter) counts 0.

Per tier, from its template (today's belts of that label, averaged):
  tier     | units/h | sold share | credits/unit | standard: units, credits, net | extended: units, net | reserve (units)
  common   |     180 |        85% |        16.74 |   180,  3,014,     14 |   360,  3,028 |  2,520
  uncommon |     207 |        80% |        21.47 |   207,  4,444,  1,444 |   414,  5,888 |  2,898
  rare     |     243 |        63% |        35.57 |   243,  8,643,  5,643 |   486, 14,286 |  3,402
  exotic   |     288 |        44% |        35.16 |   288, 10,127,  7,127 |   576, 17,254 |  4,032

Rarity of a respawned belt, per system (each tier away from the label 0.25 as likely):
  system          | label    | common | uncommon |  rare  | exotic | mean yield x | vs today | expected net, standard
  Sol             | common   |  75.3% |    18.8% |   4.7% |   1.2% |        1.052 |    +5.2% | 632
  Alpha Centauri  | uncommon |  16.0% |    64.0% |  16.0% |   4.0% |        1.176 |    +2.3% | 2,114
  Barnard's Star  | uncommon |  16.0% |    64.0% |  16.0% |   4.0% |        1.176 |    +2.3% | 2,114
  Wolf 359        | rare     |   4.0% |    16.0% |  64.0% |  16.0% |        1.344 |    -0.4% | 4,983
  Tau Ceti        | rare     |   4.0% |    16.0% |  64.0% |  16.0% |        1.344 |    -0.4% | 4,983
  Epsilon Eridani | exotic   |   1.2% |     4.7% |  18.8% |  75.3% |        1.525 |    -4.7% | 6,496
  Lalande 21185   | uncommon |  16.0% |    64.0% |  16.0% |   4.0% |        1.176 |    +2.3% | 2,114
  Ross 154        | uncommon |  16.0% |    64.0% |  16.0% |   4.0% |        1.176 |    +2.3% | 2,114
  Sirius          | rare     |   4.0% |    16.0% |  64.0% |  16.0% |        1.344 |    -0.4% | 4,983
  Ross 248        | rare     |   4.0% |    16.0% |  64.0% |  16.0% |        1.344 |    -0.4% | 4,983
  Luyten 726-8    | rare     |   4.0% |    16.0% |  64.0% |  16.0% |        1.344 |    -0.4% | 4,983
  Lacaille 9352   | rare     |   4.0% |    16.0% |  64.0% |  16.0% |        1.344 |    -0.4% | 4,983

Respawn: 20% each hour on the hour; mean wait 5.0 h; still empty after 12 h 6.9%, after 24 h 0.47%.

A common belt, mined by N corporations at 2 standard expeditions a day each:
  N =  1: lasts 168.0 h (7.0 days); its slot is empty 2.9% of the time; 51 respawns a year, in Sol 0.6 of them exotic
  N =  5: lasts 33.6 h (1.4 days); its slot is empty 13.0% of the time; 227 respawns a year, in Sol 2.7 of them exotic
  N = 20: lasts 8.4 h (0.4 days); its slot is empty 37.3% of the time; 654 respawns a year, in Sol 7.7 of them exotic

A lone corporation on the ladder (a check-in every 12 h): 14 launches per belt, 0.074 lost waiting for the next, 0.52% of its launches.
A model, not play: perfect play, one belt per system, every unit a standing order buys sold at its base bid.
```
<!-- belt-model:end -->

## What the numbers say

- **A lone corporation barely notices.** On the ladder's pace (two standard expeditions a day, a check-in every 12
  hours; docs/design/ladder-11-40.md), a common belt lasts a week, and depletion costs it 0.52% of its launches while it
  waits for the next belt. Level pacing, which counts expeditions (Levels 7 and 10 today, and the ladder design's later
  expedition targets), does not move by a measurable amount. This is by design: the ladder should not stall on a draw.
- **The pressure is in company.** Five corporations on one common belt empty it in 1.4 days, and its slot is empty 13%
  of the time; twenty empty it in 8.4 hours, and it is empty 37% of the time. That is when travelling to another
  system's belt, or waiting for the draw, is a real choice. The reserve (14 standard expeditions) is the knob: it is
  sized so that a quiet server feels no scarcity and a busy one does, and it should be tuned from what live servers
  show, not from this model.
- **Rarity moves averages a little.** A distribution centred on each label pulls the extremes towards the middle: Sol's
  mean yield rises 5.2% (its rare and exotic draws), Epsilon Eridani's falls 4.7% (its common draws). This design keeps
  that; compensating it would mean per-system multipliers, which is a complication with no player-facing reason.
- **An exotic belt in Sol is about one respawn in 85.** How often that is depends on how fast Sol's belt is mined: a
  lone corporation's weekly respawns give one less than once a year (0.6), five corporations' give two or three (2.7),
  twenty give about eight. That is the "possible but rare" the item asks for, and it grows with the server.

## What this design does not settle (for the Director)

The model shows two things about expeditions today that are not about depletion, and that this design leaves alone:

1. **A Sol expedition breaks even.** A standard expedition on a common belt yields 180 units worth 3,014 credits at the
   standing bids, against a 3,000 launch cost: 14 credits net. A tier-1 extractor yard at its best setting nets about
   606 an hour at ideal uptime (`npm run economy:model`). The TODO's "belts should yield more than extractor yards" is far from true in
   Sol, and depletion makes Sol belts no more attractive. Base yield (`baseYieldPerMin`, 3) or the launch cost is the
   lever.
2. **An exotic belt pays less per unit than a rare one** at the standing bids (35.16 against 35.57 credits), because
   56% of an exotic belt is resources no standing order buys (Thorium, Uranium, Cobalt, Lithium, Exotic Matter). Their
   value is on the player market or in refineries, which the model does not price. AB#822 (which bodies yield which
   resources) is where that belongs.

Both are pricing questions for the economy, not for this design; the belt rules above hold whichever way they go.

## Blind spots

- The model sells at the base bid. Each standing order takes 7,000 units a day for the world and its bid falls as it
  fills (data/economy.json `npcBid`), so a busy belt's buyers pay less than the table says.
- "N corporations on one belt" assumes they share it evenly and relaunch on the ladder's pace. Real players cluster,
  and a belt's life on a live server is the number to watch.
- One belt per system, as the catalog has. A second belt per system (a new Field body) doubles a system's supply
  without changing any rule here.

## Prior art

EVE Online's asteroid belts and ore sites are the familiar version: shared by everyone in a system, mined out by
whoever gets there, and back after a reset, which is what turns mining from a solo loop into a reason to move. This
design keeps EVE's shape and replaces its daily reset with the TODO's hourly draw, so a belt's return is spread across
the day rather than landing at one hour for everyone.
