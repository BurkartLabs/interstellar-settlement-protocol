# Sol's NPC corporations (ISP-120, AB#812)

v0.7's plan line is "NPC corporations in Sol system (price anchoring + flavour presence)". Today the build has six
standing buy orders whose buyers are names in `data/economy.json` (`npcBuyers`), and no NPC sell orders at all,
although v0.2 is marked done for them. This design replaces the names with a roster of corporations and adds the
missing side: each NPC posts a bid **and** an ask, so "anchoring" means a floor and a ceiling with the market
between them.

It changes no code; a follow-up story implements it. It was read against ISP main `2c97083d`, 2026-09-26. Figures
marked *proposed* are for the PM, with ECONOMY.md, to accept or change.

**One thing this design does not decide.** Decision AB#2324 (Board, open) asks whether NPC demand is one pool for
the whole world or one per corporation. Everything below is written for a **pool** that the Decision chooses: "volume
over the window" means volume sold into the order by that pool. The numbers are sized for one corporation's reach,
which fits either answer. AB#2327 measured a per-corporation Silicate quota; its numbers are on the Decision.

## Prior art

EVE Online seeds NPC orders for only a few item classes (skillbooks, blueprints, some trade goods) and leaves ore and
minerals entirely to players ([EVE University, Economics](https://wiki.eveuniversity.org/Economics)). What that
teaches: an NPC that buys or sells everything at a fixed price *is* the market, and players never trade with each
other. Our own history confirms it: the fixed 24-credit Silicate bid with a million units a day behind it made the
Exchange a sell button (DEPTH.md epic 3; MONETIZATION.md review #1). ISP-87 cut that to 7,000 a day with a falling
bid. This design keeps the principle and adds the ceiling:

- NPCs trade only the six raw goods that already have a standing order. Water Ice, Hydrogen, the rarer tier-2
  metals, and every refined good stay player-to-player, as EVE leaves ore to players.
- An NPC's bid is the worst price a seller can get, and its ask is the most a buyer ever pays. A player trade can
  beat both, so the spread between them is the room the player market lives in.
- NPCs **post** orders; they never take one. No NPC ever buys a player's listing or fills a player's buy order
  (AB#1054). All player-to-player volume is real volume.

## Authorities are not corporations

The GEX and the ISA run the market and the licences. They do not trade in it.

- **GEX Commodities Authority** (LORE.md: settlement, routing, tax) settles every trade and keeps the exchange tax. It
  stops being the Silicates buyer; that order moves to Meridian Glassworks below. LORE.md's line that the GEX
  "maintains daily standing orders" is rewritten in the follow-up to say the GEX lists the corporations' standing
  orders.
- **ISA Materials Exchange** (today's Carbon buyer) is dropped as a trading name. The ISA licenses and regulates,
  and does not buy Carbon. That order moves to Tycho Carbon Works.
- **Earth Assembly, Station Administration (STA) and the IGSA** stay authorities, as LORE.md has them.

## The roster

Six corporations, one per traded good, at Sol's three stations. Each keeps its existing order's id
(`npc-buy-<item>-daily`), so saves, the runway probe and the ladder bot keep working. Each gains an ask with the id
`npc-sell-<item>`.

| NPC corporation | Home station | Flavour | Buys and sells | Absorbs today's buyer name |
|---|---|---|---|---|
| **Meridian Glassworks** | Earth Station Prime | Makes the glass, insulation and aerogel panels every station in Sol is skinned with; always short of Silicates. | Silicates | GEX Commodities Authority (moves to authority) |
| **Lunar Helium Consortium** | Luna Gateway | A cartel of the old Luna fusion operators; buys every litre of Helium-3 that reaches the Gateway and resells to the reactors. | Helium-3 | Lunar Helium Consortium |
| **Belt Refining Cooperative** | Mars Orbital Dock | Smelters owned by the belt crews who sell to them; takes Nickel by the ton at the Dock. | Nickel | Belt Refining Cooperative |
| **Olympus Heavy Industries** | Mars Orbital Dock | Builds hulls and habitat frames in the yards above Olympus Mons; Titanium is its bottleneck. | Titanium | Olympus Heavy Industries |
| **Tycho Carbon Works** | Luna Gateway | Spins carbon fibre for freight hulls at Tycho, fed through the Gateway. | Carbon | ISA Materials Exchange (dropped as a name) |
| **Synthorium Trading House** | Earth Station Prime | An old trading house that brokers Rare Earths to Earth's electronics firms, and buys from anyone. | Rare Earths | Synthorium Trading House |

**Where an order is filled.** The follow-up keeps today's rule: a corporation sells to or buys from a standing order
with goods at the station it is docked at. The home station is where the NPC is shown to be based. *Proposed for
later, not the follow-up:* fill each NPC's orders only at its home station. That would give Logistics a job, but it
changes the core loop's numbers (a Mars miner's Silicates would have to be shipped to Earth), and those belong to
AB#2324's answer and a probe re-run, not to this design.

**Later, not in the follow-up.** Each corporation has a natural refined good it could also buy: Aerogel, Plasma
Conduits, Structural Alloys, Precision Frames, Carbon Fibre Sheets and Sensor Arrays, one per corporation in the order
of the table. Refined goods have no NPC buyer at v0.6 (DEPTH.md), so this would give refining an outlet. It needs its
own story and its own prices.

## The price rule

For each NPC and good there are two standing orders: a **bid** (the NPC buys) and an **ask** (the NPC sells). Both
prices are computed on the server from public inputs only, and nothing in a request sets either.

**Rolling window, not a daily reset.** Today's bid resets at midnight EST and recovers 60% of the gap each night.
Here each order counts the volume traded against it over the last **W = 72 hours** (*proposed*), and old volume ages
out smoothly. A dump pushes the price for three days and then fades; there is no midnight cliff to time trades
against.

For a good with base bid `B` and base ask `A`:

- **bid = max(0.55 × B, B × (1 − 0.50 × S / Qb))**, where S = units sold into the bid over the window, and
  Qb = the bid's window quantity (3 × its daily quantity, below).
- **ask = min(1.60 × A, A × (1 + 0.50 × P / Qa))**, where P = units bought from the ask over the window, and
  Qa = the ask's window quantity.

What those formulas do:

- **Bounds.** The bid never goes below 55% of B, the floor ISP-87 already uses. The ask never goes above 160% of A.
  The base ask is 1.5 × B, so the ask never falls below the bid. At rest Silicates run from 24 to 36; with both
  sides at their bounds, from 13 to 58.
- **No refusal at the quota.** Past Qb the bid stays at its floor and past Qa the ask at its ceiling; the order never
  says "filled for today". The floor is below a yard's running cost at best rate (13 against 17.93 a tonne for
  Silicates at any tier's best rate, docs/design/upgrades.md), so dumping into it loses money and needs no cap. A new player is never stranded (DEPTH:
  "never fake scarcity; the floor stays a floor").
- **The spread is the player market.** A seller with Silicates gets at least the bid. A buyer pays at most the ask.
  Any listing between them is better for both sides than the NPC.

**Starting values** (*proposed*). B is today's `unitPrice` for each good. A = 1.5 × B, rounded. Daily quantities are
about one day of what one well-developed corporation produces of that good, not a million.

| Good | B (bid) | A (ask) | Bid daily qty | Ask daily qty | Where the daily quantity comes from |
|---|---|---|---|---|---|
| Silicates | 24 | 36 | 7,000 | 3,000 | ISP-87's 7,000. A profitable corporation mines about 8,200 t a day under the shared bid (AB#2321, bot) |
| Carbon | 12 | 18 | 1,000 | 400 | 25% of a common belt: about 45 a standard expedition, about 1,080 a day for a player relaunching hourly |
| Nickel | 18 | 27 | 800 | 300 | 20% of a common belt: about 36 an expedition, about 860 a day relaunching hourly |
| Titanium | 64 | 96 | 200 | 80 | 5% of a common belt: about 9 an expedition, about 216 a day relaunching hourly |
| Helium-3 | 92 | 138 | 100 | 40 | no Sol source today: only belts outside Sol carry it (Frost Halo 22%, Tau Ice Cloud 10%); set low until one is reachable |
| Rare Earths | 140 | 210 | 100 | 40 | no Sol source today: only belts outside Sol carry it (Tau Ice Cloud 18%, Crown Belt 15%); set low until one is reachable |

An expedition brings back 3 units a minute (`BASE_YIELD_PER_MIN`, server/game/beltRules.js); a standard one lasts
an hour, 180 units, split by the belt's composition (data/systems.json).

Worked example, Silicates. A corporation sells 10,500 t into the bid over three days (half of Qb = 21,000): the bid
reads 24 × (1 − 0.5 × 0.5) = 18. It stops selling, and three days after its last sale the bid is back to 24. A buyer who takes
4,500 t from the ask over the window (half of Qa = 9,000) moves it to 36 × 1.25 = 45. A player listing at 30 then
beats both.

## Shown as NPC

- Every NPC order is badged **NPC** in the client and carries its corporation's name and home station, in both the
  Standing buy orders panel and a new Standing sell orders panel beside it. NPC asks never appear in the player
  Sell orders table, and NPC bids never appear in the player Buy orders table (AB#1054). A player always knows which
  side of a trade is a machine.
- Each order shows its window volume (S or P) and the published formula (a help line on the panel). A player can work
  out the next price themselves.

## Names are reserved

Registration refuses a corporation name that contains an institution's name as whole words
(`validateCorporationName`, server/corporationName.js, AB#433). Today that list is `SYSTEM_SENDERS` plus the buyer
names in `npcBuyers` (`RESERVED_CORPORATION_NAMES`, server/game/world.js). So **"GEX Commodities Authority" and "ISA
Materials Exchange" are reserved only because they are buyers**, and moving their orders would quietly release them.
The follow-up therefore:

- keeps the roster in one data file (`data/npc-corporations.json`, *proposed*) and derives the reserved list from it,
  so a new NPC is reserved without anyone retyping it;
- adds an authorities list (GEX Commodities Authority, Galactic Exchange, Earth Assembly, Station Administration,
  Intergalactic Stock Exchange Authority, ISA Materials Exchange) that stays reserved whether or not it trades;
- gives existing saves' orders their new buyer names in the same migration that seeds the asks (ensureMarketState,
  server/game/world.js, seeds only missing orders today).

## Two promises

- **No NPC trade is ever sold for money.** Nothing buys a better NPC price, a larger quantity, early access to an
  order, or a reset of the window. NPC orders are the same for every corporation, paying or not (MONETIZATION.md).
- **NPCs never trade against a player with information the player lacks.** An NPC's prices are a published function
  of public inputs: its base, its window volume (shown on the order) and the formula (shown on the panel). NPCs do
  not see any corporation's inventory, listings, buy orders or history. They post standing orders and never react to
  one player's order. They never take a player's listing or fill a player's buy order, so they cannot be on the other
  side of a player trade at all.

## The probe target (bot numbers, P-PROXY)

These measure bot policies against these rules, not players (DEPTH epic 3's own target). With two bot corporations
trading for a simulated week:

1. **At least 25% of filled volume is player to player**: listings bought by the other corporation plus player buy
   orders filled (AB#1054), over all volume including sales into NPC bids and purchases from NPC asks.
2. **The Silicate clearing price moves at least 10% between a low-supply and a high-supply week.** The clearing price
   is the volume-weighted price of player-to-player Silicate trades. Low supply: both bots on the runway probe's
   `--supply low`; high supply: `--supply high`.

No probe does this today. The runway probe runs up to four bots in one world, but its bots mostly sell into the NPC
bid. The follow-up adds a two-corporation trading week to ops/probes/isp-runway.ts. Its bots list between bid and ask
and buy each other's listings when they beat the ask, and it prints both numbers under the probe's BOT NUMBERS banner.

## For the follow-up story

- **Data:** `data/npc-corporations.json` holds the roster. `economy.json` gains, per good: B, A, the two daily
  quantities and W; the global drift, floor and ceiling values move there too.
- **Server:** keep the bid ids; add ask ids; replace the midnight reset with window volume; add an NPC buy route
  that mirrors the NPC sell route; derive the reserved names; migrate saved orders.
- **Client:** the NPC badge, and the Standing sell orders panel beside Standing buy orders, on the Exchange rebuilt in
  AB#769.
- **Probes:** add the two-corporation trading week above. Re-run probe:pacing and the runway probe, since the ask side
  and the rolling window change what a bot can buy and when the bid recovers.
- **Blocked by:** Decision AB#2324 (the pool). The follow-up should not be dispatched before it is answered.
