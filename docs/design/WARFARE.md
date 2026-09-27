# Corporation warfare (v0.13)

The v0.13 plan lines, one section each. Territorial control is its own document, docs/design/TERRITORY.md (ISP-221,
AB#916); the sections here build on it. Every number is in the warfare catalog (`data/warfare.json`, ISP-225, AB#920),
under the key each section's number table uses, and `tests/schema/warfare.test.js` holds the catalog to these tables.

## Economic warfare: tariffs with an optimum, and dumping as a calculated risk (ISP-222, AB#917)

Plan line "Economic warfare: market flooding, tariffs". The build stories are ISP-230 to ISP-234 (AB#925 to AB#929).

Two weapons, each with a cost the user of it can calculate:

- **Tariffs.** A concession holder may charge a tariff on sales settled at the system's stations and on goods shipped
  into the system. It keeps what it collects, less an ISA levy that grows with the rate. The rate that earns the
  holder the most is below the cap (worked below), so "set it to the cap" is a mistake, not the default (T-018).
- **Dumping.** Selling far below the trailing price to hurt a rival is legal. The Interplanetary Trade Commission, which
  today is only a placeholder building at Earth Station Prime (`interplanetary-trade-commission`, "coming soon"), runs a
  daily dumping watch. When a corporation's cheap sales cross a published price line and a published volume line, the
  Commission levies a duty equal to the dumping margin. A flood is therefore a priced weapon: a flooder can compute
  in advance what it will cost.

### What this keeps from TERRITORY.md and the warfare catalog

- **Tariff rights belong to a concession holder only**, in `granted` (TERRITORY.md, "What a concession grants"). In
  `grace` the benefits are suspended, so no tariff is charged. A lapsed concession's tariff ends with it.
- **Each system's cap is the rule table's `tariffCapPct`**, unchanged: 0% in Sol, Lalande 21185, Ross 128, Kapteyn's
  Star and van Maanen's Star (never concedable) and in Procyon (free port), 5% in Tau Ceti (tariff corridor), and 3%
  everywhere else (`concessionTariffCapPct`). `server/warfare.js` already refuses any cap above 25%
  (`MAX_TARIFF_PCT`, AB#920). This design's own ceiling, `tariffs.maxPct`, is 5%, the highest cap any system has, and
  sits inside that 25%. **No system's cap changes here.**
- A concession never lets its holder refuse, block or reprice anyone else's trade. A tariff is a charge on trade that
  goes ahead. It is never a ban.

### Prior art

| Source | What it says | ISP |
| --- | --- | --- |
| **Bickerdike, "The Theory of Incipient Taxes" (Economic Journal, 1906)**, the optimum-tariff argument | A country that can move its terms of trade gains from a small tariff, and loses from a large one. The optimum tariff is finite and falls as foreign supply becomes more elastic. In the modern form, t* = 1 / (elasticity of foreign export supply). | **Adopted**: traders' ability to take goods elsewhere is the elasticity. Where it is high (valuable goods, cheap to move), the best tariff is low. Where it is near zero (bulk ore that cannot pay to leave), Bickerdike's t* is unbounded, and the cap would always bind. The ISA levy below supplies the missing curvature for captive trade. |
| **WTO Anti-Dumping Agreement (1994)** | Art. 2.1: a product is dumped if its export price is less than its *normal value*, the comparable price in the ordinary course of trade. Art. 5.8: a margin under 2% of the export price, or a volume under 3% of imports, is *de minimis* and ends the investigation. Art. 9.3: the duty must not exceed the margin of dumping. | **Adopted**: normal value is the trailing volume-weighted price. The price line and the volume line are ISP's *de minimis* tests. The duty is the margin itself and never more. |
| **Offworld Trading Company (Mohawk Games, 2016)** | Every resource's price moves with what is bought and sold, so market manipulation is the game's central tactic. A company can dump a resource to crash its price and starve a rival that depends on selling it. | **Adopted**: flooding is a legal, real weapon, now that ISP's price moves (below). **Rejected**: an unpriced crash. Here the Commission prices a crash that crosses its lines. |
| **EVE Online, player-owned customs offices** | The owner of a planet's customs office sets the tax on goods moved through it, per standing. Owners who set it high see their customers go to another planet. | **Adopted**: a holder-set rate, with leaving as the check on it. **Rejected**: a rate per standing (a different rate for friends and rivals). ISP's tariff is one rate for everyone but the holder. |

### Tariffs

**What is charged, and on whom.**

- **Sales**: every exchange sale settled from goods held at a station in the system. That covers a listing filled, a
  sale into a player's buy order, and a sale to the NPC standing bid. The base is the sale's gross value, the same
  base as the GEX sales tax (8%, `exchange.salesTaxPct`), and the tariff is charged beside that tax.
- **Transfers in**: every logistics transfer whose destination is a station in the system and whose origin is outside
  it. The base is units × the item's normal value (below). If the item has no normal value, its NPC standing bid's
  base price is used, and if it has neither, the tariff is zero. The tariff is charged beside the logistics fee, at
  dispatch. Transfers within the system and transfers out are never tariffed.
- **The holder is exempt**, as are, for a conglomerate holder, its members. A tariff paid to yourself would only feed
  the levy.
- One rate covers every item in the system. The ISA does not license a tariff per good, so a holder cannot tax only
  what its rivals sell.

**Bounds, steps and notice.**

- The rate is set at the system's ISA Claims & Leases, docked in the system, in steps of `tariffs.stepPct` (0.25
  points), from 0 to the system's `tariffCapPct`. A new concession starts at 0%.
- **An increase takes effect `tariffs.noticeHours` (72) after it is filed.** Until then it is public as a pending rate
  (API, starmap panel, sell and transfer forms; ISP-231). A decrease takes effect at once: it can only help a trader.
  Only one change may be pending at a time. Filing another replaces it and starts its own notice.
- **Nobody is charged a rate they were not shown.** A listing is charged the lower of the rate in force when it was
  posted and the rate in force when it fills. A transfer is charged the rate in force at dispatch.

**Where the money goes.** Of every tariff collected, the ISA keeps a levy of `tariffs.isaLevyAtCapPct` (75%) × the rate
÷ the system's cap. That is 0% of a tariff at 0, 37.5% at half the cap, and 75% at the cap. The levy goes to the fee
sink (`settleTransfer` reason `tariff-levy`), and the rest to the holder (`tariff-revenue`), both daily with the
concession's other lines. A conglomerate holder's share goes to its treasury.

**Fails closed** (ISP-230): if the holder's rate cannot be read, the tariff is zero and an error is logged. It is never
an unbounded charge.

### Why the best tariff is below the cap

To escape a tariff on a sale, a trader ships the goods to a station in a neighbouring system and sells there. The
exchange's prices are the same at every station, so leaving costs only the logistics fee and the transit time. One
jump costs `logistics.sameSystemFeePerUnit` + `logistics.perJumpFeePerUnit` = 2 + 3 = **5 credits a unit**, and 150
minutes. A trader leaves when the tariff on a unit exceeds that: tariff rate × unit price > 5. Eleven of the sixteen
concedable systems border a system whose cap is 0% (never concedable, or Procyon). The other five (Ross 248, Lacaille
9352, 61 Cygni, Altair and 70 Ophiuchi) border only systems capped at 3%. From those, the escape is one jump to a
neighbour, whose own tariff (if any) is added to the 5, or two jumps (8 a unit) to a 0% system. A holder there can
charge a little more before goods leave, and the cap still bounds it.

| good | unit price (NPC base) | leaves above a tariff of |
| --- | --: | --: |
| Silicates | 24 | 20.8% |
| Titanium | 64 | 7.8% |
| Helium-3 | 92 | 5.4% |
| Rare Earths | 140 | 3.6% |
| Fusion Pellets | 198 | 2.5% |
| Rare-Earth Magnets | 276 | 1.8% |
| Platinum-Group Metals | 400 | 1.25% |
| Ion Thrusters | 1,283 | 0.39% |
| Antimatter Drives | 4,869 | 0.10% |

So each good stays until the rate reaches its line and then leaves at once. The tariff base shrinks in steps as the rate
rises: the Laffer shape. **Rerouting alone does not put the optimum below the cap wherever bulk ore dominates**,
because bulk cannot pay 5 a unit to escape a 3% or 5% tariff. The worked examples show it. That is Bickerdike's
point: with no elasticity, the best tariff is as high as allowed. The ISA levy (keeping 75% × rate ÷ cap) is the
curvature the captive part needs. On captive trade alone the holder keeps t × (1 − 0.75 × t ÷ cap), which peaks at
**two thirds of the cap**. Rerouting then pulls the peak lower wherever valuable goods are sold.

**Worked examples.** *Placeholders for ECONOMY.md to price: each system's trade mix is assumed, not measured.* "Others'
sales" is a day's sales at the system's stations by everyone but the holder. The escape is one jump.

*Tau Ceti (cap 5%), a trading corridor, 570,000 a day*: Silicates 120,000, Titanium 60,000, Helium-3 40,000, Rare
Earths 40,000, Fusion Pellets 30,000, Rare-Earth Magnets 40,000, Platinum-Group Metals 40,000, Ion Thrusters 60,000,
Superconducting Coils 60,000, Antimatter Drives 80,000.

| tariff | sales that stay | tariff paid | ISA levy | holder keeps |
| --: | --: | --: | --: | --: |
| 0.25% | 490,000 | 1,225 | 46 | 1,179 |
| 1.25% | 370,000 | 4,625 | 867 | 3,758 |
| 2.00% | 290,000 | 5,800 | 1,740 | 4,060 |
| **2.50%** | 290,000 | 7,250 | 2,719 | **4,531** |
| 3.50% | 260,000 | 9,100 | 4,778 | 4,323 |
| 5.00% (cap) | 220,000 | 11,000 | 8,250 | 2,750 |

*Alpha Centauri (cap 3%), bulk-heavy, 700,000 a day*: Silicates 300,000, Titanium 150,000, Helium-3 100,000, Fusion
Pellets 50,000, Platinum-Group Metals 50,000, Catalyst Beds 50,000.

| tariff | sales that stay | tariff paid | ISA levy | holder keeps |
| --: | --: | --: | --: | --: |
| 0.50% | 650,000 | 3,250 | 406 | 2,844 |
| 1.50% | 600,000 | 9,000 | 3,375 | 5,625 |
| **2.00%** | 600,000 | 12,000 | 6,000 | **6,000** |
| 2.50% | 600,000 | 15,000 | 9,375 | 5,625 |
| 3.00% (cap) | 550,000 | 16,500 | 12,375 | 4,125 |

Without the levy, both systems' best rate is the cap (11,000 and 16,500 a day), since each step the rate rises gains
more on the goods that stay than it loses on the ones that leave. With it, the best rate is 2.5% of 5% and 2% of 3%,
and it moves with the system's own trade. More valuable goods in the mix lower it, and more bulk raises it towards two
thirds of the cap. A holder has to read its own system to find it, which is the decision T-018 asks for. The levy
also makes the tariff a sink: the ISA keeps 2,719 and 6,000 a day at those optima.

The optimum is also good for traders. At Tau Ceti's best rate, bulk pays 2.5% instead of 5%, and the valuable goods
have mostly left for Lalande 21185, one jump away at 5 a unit.

### Dumping, and the Trade Commission's watch

**The dependency, checked.** Flooding only hurts a rival if a price moves. DEPTH.md's "unpin the exchange" (review #1
epic 3, review #3 epic 5) **has shipped**. The NPC standing bid is a floor that drifts: it falls with the day's
volume, 50% at the full daily quota, to a floor of 55% of its base, and it recovers 60% of the gap each night
(`npcBid` in data/economy.json; server/economy.js `npcBidFor` and `npcBidAfterRecovery`; AB#777, and AB#2365 for one
quota per item). The player order book (server/buyOrders.js) fills at the listing's price. So a flood has two
channels, and **this line is not blocked**. Two caveats:

- The Board's demand retune (AB#2374, from AB#2324) will change the bid's quota and prices. Every line below is
  relative to the item's own trailing price and volume, so it survives a retune without new numbers.
- DEPTH's check that at least 25% of filled volume is player-to-player has not been measured. A flood through the
  order book only reaches as far as players trade with each other. ISP-234's probe reports the share.

**Which sales the watch reads.** A corporation's exchange sales **at a price it chose**: its listings filled, and its
sales into other corporations' buy orders. Two kinds of sale are left out:

- **Sales to the NPC standing bid.** The seller does not set that price; the ISA's bid does. That channel is already
  bounded: whoever floods the bid sells down the curve first, the floor stays a floor, and it recovers overnight.
- **Trades inside one conglomerate**, as the dominance metric leaves them out. They cannot hurt a rival.

**The formula**, for each corporation c and item i, at the daily 00:00 UTC tick:

    W   = the last dumping.windowDays (3) complete UTC days
    N_i = normal value: the volume-weighted average price of every exchange trade in i (standing-bid sales included)
          over the dumping.normalValueDays (7) complete UTC days before W
    V_i = the average daily volume of i over those same 7 days
    Q_d = the units c sold of i in W, at a price below dumping.priceThresholdPct (85%) x N_i, not in an earlier finding
    P_d = the volume-weighted average price of those Q_d units

    c is found dumping i when all three hold:
      price   P_d  <  0.85 x N_i                              (true of every unit counted in Q_d, by construction)
      volume  Q_d  >= dumping.volumeThresholdPct (10%) x V_i x 3     a tenth of the market's normal volume for the window
      size    Q_d x N_i  >= dumping.minValue (25,000)          a small clearance sale is never an investigation

    duty = dumping.dutyMarginPct (100%) x (N_i - P_d) x Q_d          the dumping margin, never more (WTO Art. 9.3)

**Fails closed** (ISP-232): if fewer than `dumping.minTradedDays` (3) of the 7 normal-value days had trades in i,
there is no normal value, and no finding. The watch never levies a duty on missing data.

**The investigation.** A finding opens an ITC investigation and notifies the corporation that same tick, in the ISA's
voice and with its numbers: the item, N_i, the 85% line, Q_d, P_d, the volume line, and the duty. The duty is levied
`dumping.levyAfterHours` (24) later, at the next tick, on exactly those sales. They are marked, so no later window
counts them again: **one duty per investigation**. The notice gives a day's warning, and the Commission's numbers are
final. There is nothing to contest, because every input is a server-held trade record.

**Paying the duty.** The duty is charged from the corporation's credits, and never below zero. Any remainder is recorded
as ITC duty owed, and `dumping.withholdPct` (50%) of the net proceeds of each later exchange sale is withheld toward it
until it is paid. It carries no interest. It never takes goods, buildings, leases or fleets, and it never blocks trading.
The P&L shows the duty as its own expense line, "Anti-dumping duty" (`settleTransfer` reason `anti-dumping-duty`, to
the fee sink).

**Why a flood is a calculated risk, not free.**

- **A legal flood is bounded.** To stay under the watch, a flooder sells at 85% of normal value or more, taking at
  most 15% off the price a rival must match. Or it sells less than a tenth of the market's normal volume for any three
  days, which diverts at most that much demand. Either way, a rival can still sell to the NPC standing bid, whose floor
  is 55% of its base. So a flood can never take more from a rival, per unit, than the gap between the order book and
  the bid.
- **A flood the Commission finds costs twice its margin.** It sells Q_d units at P_d instead of N_i, and then pays the
  margin again as duty. It nets 2P_d − N_i a unit, and less than nothing below half of normal value.
- *Placeholder example*: Rare-Earth Magnets trade 1,000 units a day at a normal value of 270. A flooder sells 600 in
  one day at 160 (59% of 270). The window's volume line is 10% × 1,000 × 3 = 300, and 600 ≥ 300. The size test gives
  600 × 270 = 162,000 ≥ 25,000. So it is found. Duty = (270 − 160) × 600 = **66,000**. It received 96,000 for goods
  worth 162,000 and pays 66,000 back, so the flood cost it 132,000 against selling normally. The same flood at 290
  units stays under the volume line: it costs the flooder (270 − 160) × 290 = 31,900 in price given away and no duty,
  and diverts at most 290 units of demand, fewer than a tenth of the three days' market.

ISP-234's probe checks the target against bots: a flood that takes 20% or more of a rival's daily revenue is net-negative
for the flooder after duty. The numbers above are the lines it tests. If the probe finds a profitable flood, the lines
move (a balance bug), not the formula.

**How it surfaces** (ISP-233). The sell form warns before a listing would count toward Q_d, with that item's line (85% of
N_i, in credits) and what the duty would be if the volume line were crossed. The warning's numbers come from the same
function the watch uses. The exchange's item view shows an alert when an item's last day closed more than 15% under
N_i, with the volume behind it. The ITC building at Earth Station Prime becomes the place to read the watch: open
investigations against you, and the public register of findings (corporation, item, date and duty; never the volumes
of anyone not found).

### What the server stores (for the build stories)

- **The tariff**, in `concessions.json` beside the concession (TERRITORY.md): `{ tariffPct, pending: { pct, filedAt,
  effectiveAt } | null, history: [...] }`. The rate at a listing's posting is stored on the listing, and the rate at
  dispatch on the shipment.
- **One settlement function** for the tariff (ISP-230). Every sale path and every transfer path calls it, and a test
  lists the call sites. That is P-HALF-FIX: a sale path that forgets the tariff is a hole in the rule.
- **Normal value and volume**: the price-history buckets (server/priceHistory.js, 90 days) keep volume but not value.
  ISP-232 adds a `value` field (Σ price × units) to each day's bucket, so N_i is Σ value ÷ Σ volume, with no
  per-sale log needed.
- **Findings**: `itc.json` in the data directory, one record per investigation: `{ id, corporation publicId, item,
  window, N, Q_d, P_d, duty, openedAt, leviedAt }`. It also holds each corporation's duty owed. The dumped sales are
  marked with the finding id. No account id appears, as in v0.12.

### Every number this section introduces

The catalog's `tariffs` and `dumping` sections (`data/warfare.json`, ISP-225). They are placeholders until ECONOMY.md
prices them against the probe (ISP-234), and each one is a Board or Director veto point.

| key | value | what it is |
| --- | --- | --- |
| `tariffs.maxPct` | 5 | The highest tariff any holder may set anywhere: Tau Ceti's cap. Every system's `tariffCapPct` is at or below it, and it is inside AB#920's 25% ceiling. |
| `tariffs.stepPct` | 0.25 | The step a holder sets the rate in, in points. |
| `tariffs.noticeHours` | 72 | Hours between filing an increase and its taking effect. A decrease takes effect at once. |
| `tariffs.isaLevyAtCapPct` | 75 | The ISA's levy on tariff collected, at the cap. At rate t it is this × t ÷ the system's cap. |
| `dumping.priceThresholdPct` | 85 | Sales below this share (%) of normal value count toward a finding. |
| `dumping.volumeThresholdPct` | 10 | A finding needs at least this share (%) of the market's normal volume for the window. |
| `dumping.windowDays` | 3 | The complete UTC days the watch reads each tick. |
| `dumping.normalValueDays` | 7 | The complete UTC days before the window that normal value and normal volume are taken over. |
| `dumping.minTradedDays` | 3 | Of those days, how many must have trades before there is a normal value at all. |
| `dumping.minValue` | 25000 | A finding needs dumped units worth at least this at normal value (credits). |
| `dumping.dutyMarginPct` | 100 | The duty as a share (%) of the dumping margin. The WTO's ceiling is 100. |
| `dumping.levyAfterHours` | 24 | Hours between the finding's notice and the duty's levy. |
| `dumping.withholdPct` | 50 | Share (%) of each later sale's net proceeds withheld toward duty owed. |
