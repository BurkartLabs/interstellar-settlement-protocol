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

**As built (ISP-230, AB#925).** Where the build differs from the text above:
- **The tariff lives in its own file**, `tariffs.json`, not in `concessions.json`. The concession register (ISP-227)
  was built in parallel, and each file has one owner. A rate is kept against the grant it was filed under, so a holder
  that lapses and is granted the system again starts at 0%.
- **Condominium systems** (61 Cygni, 70 Ophiuchi), which this section did not cover: each holder files its own rate,
  and the system charges the lower of the two, so raising it takes both. The revenue is split between them. For
  the Board's veto.
- **A transfer's normal value** is the volume-weighted daily close over the last 7 complete days, until the dumping
  watch (ISP-232) adds each day's traded value to the price history.
- **The levy** is one function, `levyOf` in `server/game/tariffs.js`, so the Board's answer on it changes one line.
  The ISA's share is counted as a sink in `tariffs.json`.
- **Where traders and holders see it** (ISP-231, AB#926): the sale and listing confirmations show the tariff and any
  pending change, and the net they show is the settlement's (one arithmetic, `public/scripts/tariffs.js`). Logistics
  quotes the tariff on goods shipped in, per item and for the picked lines. The starmap's system panel shows a held
  system's rate and pending change to everyone, and to the holder its schedule, what it collected and is owed, and
  (docked there) the form that files a rate. `GET /api/accounts/:id/tariffs` serves all of it.

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

**As built (ISP-232, AB#927).** The rule is `server/game/dumping.js` and the watch is `server/itcService.js`, which
runs at the first minute after 00:00 UTC. The own-priced sales are logged as they settle (`paySeller`), in `itc.json`
beside the findings. The duty owed is on the corporation itself (`corp.itcDuty`), so the sale confirmation shows what
will be withheld before the trader commits, using the same arithmetic as the settlement (`public/scripts/itcDuty.js`). Price history buckets now keep each day's traded `value`; a bucket saved before
counts its close x volume. Duty is booked as `anti-dumping-duty` through `applyCredits` inside the payer's own state
change, as the exchange tax is, rather than through `settleTransfer`, because a withholding happens in the middle of a
sale's settlement. The Commission's sink is counted in `itc.json`. Both sale paths call the one `withholdDuty`, and a
test holds them to it.

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
| `dumping.withholdPct` | 50 | Share (%) of each later sale's net proceeds withheld toward duty owed, and toward Arbitration Council debts (below): one withholding for both. |

## The Galactic Arbitration Council: structured claims decided by rules on server evidence (ISP-224, AB#919)

Plan line "Galactic Arbitration Council system". The build stories are ISP-241 to ISP-243 (AB#937 to AB#939). The
Council is an existing NPC building, `galactic-arbitration-council` ("coming soon" today), at Earth Station Prime and
at Wolf 359's anchorage.

A case at the Council is a form with no words in it. The claimant picks a **record** (a contract, a sale, a transfer,
a petition) and a claim type. The server attaches the evidence that claim type's query returns. After a response
window, the claim type's rule decides the case, and the ruling is enforced through money the ISA already holds.
Nothing in a case is written by a player, so nothing needs a moderator. No ruling needs a judge, and nobody can argue
with one.

### What the Council hears, and what it does not

**The Council hears what the server can observe but does not stop at the moment it happens.** A rule the server
enforces when the act is attempted needs no court: the act simply fails. Checked against every system the item names:

| System | Enforced at the act? | So |
| --- | --- | --- |
| Tariff bounds and notice (WARFARE.md, ISP-230) | Yes: one settlement function charges the lawful rate. | A claim type that *audits* it (`tariff-overcharge`). It should always be dismissed, and an upheld case is a bug report as well as a refund. |
| Mercenary contracts (v0.10, server/mercenaries.js) | Mostly: the owner cannot order a hired fleet, and a use outside `allowedUse` is refused. **Readiness is not**: it falls 10 points a day while the owner leaves upkeep unpaid (v0.10-combat.md section 7), so a hired fleet can fight weaker than the readiness the renter was shown. | A claim type (`mercenary-readiness`). |
| Concession petitions and challenges (TERRITORY.md) | Yes, by the state list, except where the rule table says a system is **arbitrated** (Wolf 359, Epsilon Indi), whose ties "the Galactic Arbitration Council decides". | A claim type (`concession-arbitrated`) that runs TERRITORY's rules with a published tie-break. |
| Patents (v0.13-03, ISP-223, AB#918: in design) | Not known yet. | A claim type (`patent-royalty`), **reserved**. It opens when AB#918's royalty records exist. Until then a filing is refused with that reason (ISP-241). |
| Loan and bond default (v0.9, server/defaultRecovery.js) | Yes: arrears for 7 days, 24 h of grace, then recovery in stages; the shortfall stays owed. | No player files it. The ISA dockets every recovery as a case (`credit-default`), so that, as the Bank's own text says, "a corporation that falls behind answers to the Arbitration Council". |
| Dumping (WARFARE.md) | The Trade Commission's watch levies the duty itself. | No claim. A claim would charge the same sales twice. |
| Raids, conglomerate treasury and hangar caps | Yes: who may raid whom is checked at declaration, and a withdrawal over its cap is refused. | No claim. |

### Why a court that reads records, and why it fits the Treaty

EVE Online, and most MMOs with player contracts, leave disputes to the players. CCP's standing rule is that in-game
scams are legal, and nothing in the game adjudicates a broken promise; players police each other by reputation.
ISP does the opposite, deliberately. The ISP Treaty is a legal framework, not a government (LORE.md). The ISA
"arbitrates resource disputes", every interaction with it "has a reference number", and the Council's rulings "carry
binding authority across all ISA-registered jurisdictions" (data/buildings.json). A world whose whole premise is
that space is run by leases, licences and registries should have disputes settled by registry. It also suits ISP's
players: a corporation that is away for a week should find its contracts honoured by rule, not lose them to whoever
was online to argue.

The Council's building text also says it "has no enforcement arm of its own — it relies on the ISA and SolSec to
execute its rulings, which means judgements can be delayed, challenged, or occasionally ignored by the powerful." This
design keeps that honestly. A ruling is enforced through money the ISA holds, and a ruling against a corporation that
routes no money through the ISA is recorded and waits (Enforcement, below).

### Prior art

| Source | What it does | ISP |
| --- | --- | --- |
| **EVE Online, courier contracts** | The courier posts collateral when accepting the contract. If the goods are not delivered by the deadline, the collateral goes to the issuer automatically. The contract enforces itself, because the money was posted up front, not collected after a judgment. | **Adopted**: a ruling is paid first from the underlying contract's escrow, and a case filed while that escrow is still held freezes its release until the ruling. ISP's mercenary contracts already escrow price and collateral this way. |
| **EVE Online, "scams are legal"** | No in-game adjudication of player promises. | **Rejected**, for the Treaty reason above. |
| **eBay Money Back Guarantee** | An "item not received" case is decided on tracking evidence, not on either party's story. If the buyer is refunded, eBay recovers the money from the seller's later payouts. | **Adopted**: rulings on records only, and a debt collected from the respondent's later proceeds through the platform's own settlement. |
| **Judgment-proof defendants (common law)** | A judgment against a party with no reachable assets collects nothing. That is why commercial contracts demand security up front. | The reason escrow comes first, and why a debt ruling is a second best (Enforcement). |

### A case, as a state list

Everything is driven by stored times and the daily tick, so it survives a restart and needs nobody online.

| State | Meaning | Leaves by |
| --- | --- | --- |
| `filed` | The claimant chose a record it is a party to, and a claim type that applies to that record, and paid the filing fee. The respondent is **the other party to the record**, derived, never typed. The evidence query ran and its result is attached, and the case has a reference number (`GAC-2026-000123`). Any escrow the record still holds is frozen. The respondent is notified in the ISA's voice. | At once to `answering`. If the evidence query fails, the case is not filed and the fee is not taken (fails closed, ISP-241). |
| `answering` | The response window, `arbitration.responseHours` (72). The respondent may **cure**: pay the claimed amount plus the claimant's filing fee, in one action. There is nothing else to answer, because the evidence is the server's. | Cured -> `closed` (cured). Window ends -> `ruled`. |
| `ruled` | At the first daily tick after the window, the claim type's rule is applied to the evidence, re-read at that moment. The ruling is `dismissed` or `upheld`, with an amount or an order. | Dismissed -> `closed`, fee forfeited to the fee sink, and any escrow freeze lifted. Upheld -> `enforcing`. |
| `enforcing` | The remedy is applied: from escrow first, then from ISA-held income, then as a recorded debt (Enforcement). | Paid in full -> `closed`. |
| `closed` | Final. Rulings are not appealed: the rule is public and the evidence is the server's, so a wrong ruling is a bug to fix, not a case to reargue. | — |

**Limits on filing.** One case per record and claim type: filing on the same evidence twice is refused. At most
`arbitration.maxOpenCasesPerPair` (3) open cases from one claimant against one respondent. A corporation cannot file
against itself or inside its own conglomerate, because the record has no other party.

**Public and private.** The docket is public: reference number, claim type, the two parties' names, state, the ruling,
and the amount. The evidence is shown only to the two parties. Battle reports stay private to the two sides (v0.10
section 5), and trade records are never public (the dominance metric's rule).

### The claim types

No field in any case is free text. "Who may file" is always a party to the record.

| id | record it is filed on | who may file | evidence the server attaches | ruling rule | remedy | fee |
| --- | --- | --- | --- | --- | --- | --- |
| `mercenary-readiness` | a mercenary contract, `hired` or ended in the last 7 days | the renter | the contract's terms, the readiness shown at hire (stored on the contract), and the owner's readiness for each hour of the term | Upheld if the owner's readiness was below the hire readiness in any hour of the term. Refund = price × Σ over the term's hours of (hire readiness − that hour's readiness) ÷ hire readiness, ÷ the term's hours. | The refund. If the case is filed before the term ends, it comes from the contract's escrow, which the filing holds past the end. Filed after the end, it comes from the owner's ISA-held income, then as a debt. | Council fee |
| `tariff-overcharge` | one of the claimant's sales or transfers that paid a tariff, in the last 30 days | the seller or shipper | the settlement record (rate charged, base, amount), the concession's state and tariff history at that moment, and the listing's posting rate | The lawful rate is 0 if the concession was not `granted`; otherwise the lower of the rate at posting and at fill (dispatch, for a transfer), capped at the system's `tariffCapPct`, with any increase counted only after its notice ended. Upheld if the rate charged was higher. Excess = (charged − lawful) × base. | The excess, repaid by those who received it, in the shares they received it: the holder (from its next tariff revenue, then as a debt) and the ISA's levy (from the fee sink, at once). **An upheld case is also filed as a Bug by the server**, because the settlement function should have prevented it. | Council fee |
| `concession-arbitrated` | a petition, counter-petition or challenge in an arbitrated system (Wolf 359, Epsilon Indi) | the petitioner or challenger, filed at the Council instead of ISA Claims & Leases | the control scores and eligibility streaks TERRITORY.md's rules read, for both parties | TERRITORY.md's rules, with 7-day review. A **tie**, two scores within `arbitration.tieMarginPts` (1 point) at review end, goes to the higher extraction share over the eligible days, then to the earlier filing. | An order: the concession granted, kept or lapsed, as TERRITORY's state list says. | `concessionPetitionFee` (25,000), as everywhere else |
| `patent-royalty` | **reserved** for a use of a patented node or chain (AB#918) | the patent holder | AB#918's use and royalty records | Royalty due = Σ uses × the patent's rate − royalty paid. Upheld if positive. | The shortfall, from ISA-held income, then as a debt. | Council fee |
| `credit-default` | a v0.9 loan or bond series in default | nobody: the ISA files it when recovery starts (server/defaultRecovery.js) | the loan or series record and the recovery's result | Always upheld. The ruling is the recovery's result, stated. | None beyond v0.9's own recovery. The docket makes it public, and any shortfall is a Council debt from then on. | none |

**The Council fee** is `max(arbitration.filingFeeMin, arbitration.filingFeePct × the amount claimed)`: 1,000, or 5%
of the claim when that is more. The amount claimed is what the evidence shows at filing. On an upheld ruling or a
cure, the respondent repays it to the claimant. On dismissal it is forfeited to the fee sink.

### Enforcement

A ruling is only as good as the money behind it. The Council has no enforcement arm, so this design never pretends it
does. An upheld amount is paid from, in order:

1. **The record's own escrow.** A mercenary contract's price and collateral sit in `escrow:merc-<id>` until the term
   ends. A case filed before release freezes them, so the ruling is paid from money that already exists. This is
   EVE's courier model, and it is certain.
2. **Income the ISA pays the respondent.** Tariff revenue and concession fee shares (TERRITORY.md) pass through the
   ISA's daily settlement. The Council takes what it is owed before paying them out.
3. **A recorded debt**, for the rest. It is collected by the ITC's withholding (`dumping.withholdPct`, 50% of the net
   proceeds of each later exchange sale; WARFARE.md above). Council debts and ITC duty owed share that one 50%, oldest
   first, so a sale is never withheld more than half, and there is one withholding rate to tune, not two. The debt carries no interest, never takes goods, buildings,
   leases or fleets, never pushes a balance below zero, and never blocks trading. It counts as debt in the v0.9 credit
   rating's leverage and solvency inputs, so a corporation that ignores a ruling loses its credit standing, as the
   Bank's own text says.

Every payment goes through `settleTransfer` (reasons `arbitration-award`, `arbitration-fee`), so what the respondent
loses equals what the claimant gains plus any fee sink (ISP-242's invariant).

**Why a judgment without escrow would be unenforceable.** A ruling that only says "pay 20,000" reaches a respondent
whose credits can be spent, contributed to a conglomerate treasury, or never earned again. A corporation that stops
selling on the exchange and holds no concession routes nothing through the ISA, so a debt against it collects nothing,
for as long as it chooses. That is the "occasionally ignored by the powerful" of the Council's lore, and the design
leaves it visible rather than inventing a seizure: the docket shows the debt unpaid, and the credit rating falls.
Where a claim can be backed by escrow, it is. That is why the one player-to-player contract with a real breach
(mercenary readiness) has its remedy paid from escrow, and why any future contract type that wants the Council's
protection should escrow at signing.

### When filing is worth it

The ruling is a published rule on evidence the claimant sees before paying: the wizard's evidence preview (ISP-243)
shows exactly what will be attached, with the rule beside it. So the fee deters mistakes and harassment, and the real
question is **collection**. A claimant who is upheld recovers D + F only as far as the respondent pays; dismissed, it
loses F. With q the share it expects to collect, filing is worth it when q × (D + F) − F > 0, i.e. **q > F ÷ (D + F)**.

*Placeholder example, from escrow.* A renter hires a fleet for 72 hours at 60,000, with 30,000 collateral, at readiness
90. The owner misses two upkeep days: the fleet sits at 80 for 24 hours and at 70 for the last 24. Refund = 60,000 ×
(24 × 10/90 + 24 × 20/90) ÷ 72 = **6,667**. The fee is max(1,000, 5% × 6,667) = 1,000. The price is in escrow, so
q = 1. Filing is worth it: the renter gets 6,667 plus its 1,000 back, and the owner is paid 53,333.

*Placeholder example, a debt.* A trader was charged 600 too much tariff by a holder whose concession has since
lapsed, so there is no tariff revenue to take it from. D = 600, F = 1,000, and it is worth filing only if q > 1,000 ÷
1,600 = 62.5%. The docket shows whether the former holder still sells on the exchange. If it does, the 50%
withholding collects the 1,600 within its next few thousand credits of sales. If it has stopped, the trader should not
file, and the server's own Bug filing for the overcharge still gets it fixed. The same 600 against a holder that still
holds the concession is certain (q = 1), because the ISA pays that holder tariff revenue every day.

*Frivolous.* A renter files `mercenary-readiness` on a contract where readiness never moved. The evidence preview shows
a flat line, and the rule reads it at the end of the window. The ruling is dismissed, and the 1,000 is gone. The
respondent was named on the public docket for three days, which is why the fee exists and why a claimant may hold
only three open cases against any one respondent.

### How it surfaces (ISP-243)

The Council's chambers read like a court registry, in the ISA's voice, and every screen carries the reference number.

- **File**: claim type, then the record (only records the viewer is a party to, and only those the type applies to),
  then the evidence preview with the rule written beside it, then the fee to confirm.
- **Docket**: every case, newest first, with its public fields. A viewer's own cases are pinned at the top.
- **Case**: the evidence (parties only), the window's end in UTC, the cure action for the respondent, and the ruling,
  written as the rule applied to the numbers: *"GAC-2026-000123. Readiness below hire readiness (90) for 48 of 72
  contract hours. Refund 6,667 credits from contract escrow. Filing fee 1,000 credits returned to the claimant."*

### What the server stores (for the build stories)

- `arbitration.json` in the data directory: per case, `{ ref, type, recordRef, claimant, respondent, filedAt,
  windowEndsAt, evidence, state, ruling: { outcome, amount, order } | null, paid, feePaid }`. Parties are corporation
  publicIds. No account id appears.
- **Council debts** per corporation, beside ITC duty owed (WARFARE.md), with one withholding function for both.
- **New records the evidence queries need**: the readiness shown at hire, stored on the mercenary contract; the owner's
  readiness each hour of a hire (a readiness change log, since readiness moves only at the daily upkeep charge); the
  tariff rate at posting on each listing (WARFARE.md already asks for it). Patent records come with AB#918.
- **One adjudication tick**, after the daily concession tick: window ends, rulings, enforcement, each keyed so a
  repeated tick moves nothing twice (ISP-242: final and idempotent).

### Every number this section introduces

The catalog's `arbitration` section (`data/warfare.json`). They are placeholders, and each one is a Board or Director
veto point.

| key | value | what it is |
| --- | --- | --- |
| `arbitration.responseHours` | 72 | The respondent's window to cure before the rule is applied. |
| `arbitration.filingFeeMin` | 1000 | The smallest Council fee, in credits. |
| `arbitration.filingFeePct` | 5 | The Council fee as a share (%) of the amount claimed, when that is more than the minimum. |
| `arbitration.tieMarginPts` | 1 | Control scores within this many points at an arbitrated review's end are a tie. |
| `arbitration.maxOpenCasesPerPair` | 3 | Open cases one claimant may hold against one respondent. |

The claim type ids, in the order the table above lists them, are the catalog's `arbitration.claimTypes`, each with
whether it is open: `mercenary-readiness`, `tariff-overcharge`, `concession-arbitrated` and `credit-default` are open;
`patent-royalty` is reserved until AB#918's records exist.

## Lawfare: patents that earn royalties, and lobbying that moves bounded rules (ISP-223, AB#918)

Plan line "Lawfare: patents, NPC faction lobbying". The build stories are ISP-235 to ISP-240 (AB#930 to AB#935), with
ISP-271 (AB#967) balancing them against the rest of v0.13.

Two instruments, each a lever a corporation pulls with in-game credits and standing, never with real money:

- **Patents.** The first corporation to complete a patentable research node or refinery chain may file a patent at
  Corporate Registry & Charters. For the term, every other corporation that researches the node or runs the chain pays
  the holder a royalty. **A patent never prevents use.** Nobody is ever refused the node or the chain because of it,
  and a user who cannot pay the royalty still gets what it paid for (below).
- **Lobbying.** A corporation with standing at the Earth Assembly or the Interplanetary Trade Commission opens a
  campaign to move one bounded parameter in one system for 28 days. Others pledge for or against it. What each side
  spends moves the parameter along a curve of diminishing returns, and the two sides net against each other. The
  parameter never leaves its bounds, and it reverts when the campaign ends.

### What this keeps from TERRITORY.md, the warfare catalog and the economic-warfare section

- **A royalty is below 100%.** The warfare catalog already refuses a `patents.royaltyMaxPct` at or above 100
  (`server/warfare.js`, AB#920). This design's own ceiling is 25% for a node and 5% for a chain run, inside that
  bound.
- **The never-concedable systems are not lobbied**: Sol, Lalande 21185, Ross 128, Kapteyn's Star and van Maanen's
  Star (TERRITORY.md, `neverConcedable`). They are where a new corporation starts and takes its first leases. A rule
  there that a veteran could move would reach into the opening, which TERRITORY.md keeps out of anyone's hands. Procyon's
  tariff cap is not lobbied either: 0% is what makes it a free port.
- **A tariff cap moved by lobbying stays inside `tariffs.maxPct`** (5%) and AB#920's 25% ceiling. The holder still
  sets its own rate under the cap, and the ISA levy is computed on the cap in force that day. **A lobbied cap is
  temporary**: no system's rule-table cap changes, which is what the economic-warfare section promised.
- **The dumping watch reads the system's lines in force.** A campaign may move `dumping.priceThresholdPct` or
  `dumping.volumeThresholdPct` in one system, within bounds. The catalog's values are the base the watch uses
  everywhere else.
- **Never a ban.** A patent is a charge on use that goes ahead, as a tariff is a charge on trade that goes ahead
  (ECONOMY.md and the monetization review: "never gate access").
- **The Arbitration Council's `patent-royalty` claim** (AB#919, reserved until these records exist) reads the use and
  royalty records below: royalty due = Σ uses × the rate − royalty paid. Most royalty is collected without a claim
  (charged at completion, the rest withheld from sales). The claim is the holder's remedy for what withholding has
  not yet recovered, and the Council's ruling then collects it as its section describes. ISP-235 and ISP-236 write
  those records; the claim type opens when they exist (ISP-241).

### Prior art

| Source | What it says | ISP |
| --- | --- | --- |
| **EVE Online, blueprint originals and copies (BPOs and BPCs)** | The owner of a blueprint original can research it and make copies with a limited number of runs, and sells or contracts the copies. Others build from the copies; the original's owner earns on each. | **Adopted**: the discoverer earns from others' use. **Rejected**: exclusion. In EVE, a corporation without a copy cannot build the item at all. Here everyone can; they pay the holder while the patent runs. |
| **FRAND licensing** (fair, reasonable and non-discriminatory terms; for example the ETSI IPR Policy, Annex 6, clause 6.1, for standard-essential patents) | The holder of a patent on a standard must license it to anyone on the same reasonable terms. It may not refuse a licensee or charge rivals more. | **Adopted**: one royalty rate for every user but the holder, under a published ceiling, and no right to refuse. A royalty rate may rise only on notice, as a tariff may. |
| **Victoria 3 (Paradox, 2022), interest groups** | Interest groups have clout, and their support or opposition sets the chance that a law passes. Several groups pull for and against the same law at once, and enactment is a contest, not a purchase. | **Adopted**: campaigns for and against one parameter at once, netted. **Rejected**: a random roll. Here the outcome is a formula anyone can compute. |
| **Democracy series (Positech Games), policy pressure** | Voter groups push on each policy slider. A policy's effect builds up over turns and saturates, and every policy has a bounded range. | **Adopted**: a bounded parameter, pressure that saturates (the curve below), and an effect that lasts a set time. |

### Patents

**What is patentable.** Everything a corporation works for past the opening:

| kind | patentable | not patentable | count today |
| --- | --- | --- | --: |
| Research node | tier 3 and above (`patents.minResearchTier`) | tiers 1 and 2: the ladder's first years, which every corporation needs | 18 |
| Refinery chain | stage 2 and above (`patents.minChainStage`), in a Refinery or the Synthesis Array | stage 1: the first refining of a raw resource | 12 |

**Who may file, and when.** The first corporation to complete the node (research done) or the chain (its first
production run delivered) may file within `patents.filingWindowHours` (72) of completing it. It files at Corporate
Registry & Charters and pays `patents.filingFee` (5,000 credits), which is a sink to the ISA. The second corporation to
complete it may not file, whether or not the first did. A thing nobody patents in its window is public for good.

**The term.** `patents.termDays` (28) from filing. When it ends, nothing more is charged, and it cannot be renewed.

**The royalty.** The holder sets one rate for everyone, in whole points, and may change it. A rise takes effect
`patents.rateNoticeHours` (72) after filing it, and a cut at once, as tariffs do.

| used how | charged when | royalty | bound |
| --- | --- | --- | --- |
| researching a patented node | the research completes | rate × the node's `costCredits` | 0 to `patents.royaltyMaxPct` (25%) |
| running a patented chain | each production run delivers | rate × its outputs at their standing bids' base | 0 to `patents.chainRoyaltyMaxPct` (5%) |

The holder never pays its own royalty. A conglomerate partner pays like anyone else, because FRAND means one rate.

**A user who cannot pay still gets what it used.** The royalty is charged at completion, never at the start, so
nothing is refused for it. It comes out of credits. What credits cannot cover is owed to the holder, and
`patents.withholdPct` (50%) of each later sale's net proceeds is withheld toward it, the same mechanism as a dumping
duty owed. Research finishes; the run delivers its full output.

**Worked example.** Helios holds a patent on Antimatter Confinement (60,000 research cost) at 20%, and on
`breeder-core-chain` at 5%. Kestrel researches the node: at completion it pays Helios 12,000. Kestrel then runs one
batch of Breeder Reactor Cores: four units at the 2,708 base is 10,832, and 5% is 542. One licensee repays the 5,000
filing fee two times over. The patent is worth filing when others will follow within the term, and the rate is the
holder's decision (T-018). At 25% a researcher pays 15,000 more for the node. Waiting 28 days for the term to end
saves it that, at the cost of 28 days without the node.

### Faction standing (ISP-238)

A standing value per corporation with the **Earth Assembly** and with the **Interplanetary Trade Commission**, between 0
and `standing.max` (100). It is private to the corporation. The ISA has no lobbyable parameters here, so there is no ISA
standing. **Lobbying spends standing** (next section). Without it, lobbying would be a credit auction won by whoever is
richest. Standing is earned only in play, never bought, and it decays.

| faction | earned by | lost by |
| --- | --- | --- |
| Earth Assembly | +1 per `standing.eaTaxPerPoint` (10,000) credits of Exchange sales tax paid | spending it on a campaign |
| Interplanetary Trade Commission | +1 per `standing.itcTradePerPoint` (20,000) credits of goods sold at or above the item's normal value | a dumping finding: `standing.itcFindingPenalty` (10); spending it |

Standing is kept to two decimals and decays by `standing.decayPctPerDay` (2%) of the value each day, so a corporation
that stops trading drifts back. A corporation selling 1,000,000 credits a week (80,000 of tax) reaches 26 in a
month, and levels off near 57.

### Lobbying

**What can be lobbied.** One parameter, in one system, at a time. Every parameter has a step, the most one campaign can
move it, and bounds the result never leaves:

| parameter | faction | base | step | most a campaign moves it | bounds | spend scale K |
| --- | --- | --- | --: | --: | --- | --: |
| `tariffCapPct` (the system's tariff cap) | Earth Assembly | the rule table's `tariffCapPct` | 0.25 | 1 | 0 to `tariffs.maxPct` (5) | 20,000 |
| `salesTaxPct` (the Exchange's sales tax on sales settled at the system's stations) | Earth Assembly | `exchange.salesTaxPct` (8) | 0.5 | 1 | 6 to 10 | 50,000 |
| `dumpingPriceThresholdPct` (the ITC's price line in the system) | ITC | `dumping.priceThresholdPct` (85) | 1 | 5 | 75 to 95 | 30,000 |
| `dumpingVolumeThresholdPct` (the ITC's volume line in the system) | ITC | `dumping.volumeThresholdPct` (10) | 1 | 5 | 5 to 20 | 30,000 |

Only concedable systems can be lobbied, and Procyon's tariff cap cannot, as above.

**A campaign.** A corporation with at least `lobbying.openStandingMin` (20) standing with the parameter's faction opens a
campaign: which parameter, which system, which direction. Opening spends `lobbying.openStandingCost` (5) standing.
For `lobbying.pledgeHours` (72) after it opens, any corporation with at least `lobbying.pledgeStandingMin` (5)
standing with that faction may pledge to either side: credits, standing, or both. Campaigns are public (who pledged,
which side, when it closes), because a registered intermediary's filings are public. Pledges are final and are a sink
to the faction. A refundable pledge would be a free threat. One campaign per parameter per system runs at a time, and
another may not open on it for `lobbying.cooldownDays` (7) after the last ends.

**The curve.** Each side's influence is its credits plus `lobbying.creditsPerStandingPoint` (2,500) for each standing
point it pledged. A side's pull on the parameter is

> **E(I) = M × (1 − e^(−I / K))**

where M is the most a campaign moves the parameter, and K is the parameter's spend scale. At I = K a side has 63% of
M; at 2K, 86%; at 3K, 95%. Doubling a spend never doubles its effect. When the pledging closes, the parameter moves by

> **E(for) − E(against)**, rounded toward zero to the parameter's step, then held inside its bounds,

for `lobbying.durationDays` (28). Then it returns to its base. Each side's curve is taken on the side's total, not per
pledger, so splitting a pledge across corporations earns nothing extra. Standing is where a small corporation
counts: 20 points of standing is 50,000 of influence that no amount of money buys.

**Worked example: a holder and a trader.** *Placeholders for ECONOMY.md, on the economic-warfare section's Alpha
Centauri mix and levy rule (cap 3%, best rate 2%, holder keeps 6,000 a day).* A raised cap lowers the levy at any
rate, and it lets the holder charge a little more. At a cap of 3.5% the best rate is 2.25%, and the holder keeps 6,991
a day; at 3.75%, 2.5% and 7,500. Helios holds Alpha Centauri's concession and lobbies the cap up; nobody opposes it.
Its gain is over the campaign's 28 days:

| Helios pledges | E (points) | cap | best rate | keeps a day | gain in 28 days | net of the pledge |
| --: | --: | --: | --: | --: | --: | --: |
| 0 | 0 | 3 | 2% | 6,000 | 0 | 0 |
| 5,000 | 0.221 | 3 | 2% | 6,000 | 0 | −5,000 |
| 10,000 | 0.393 | 3.25 | 2.25% | 6,490 | 13,720 | 3,720 |
| **15,000** | 0.528 | 3.5 | 2.25% | 6,991 | 27,748 | **12,748** |
| 20,000 | 0.632 | 3.5 | 2.25% | 6,991 | 27,748 | 7,748 |
| 30,000 | 0.777 | 3.75 | 2.5% | 7,500 | 42,000 | 12,000 |
| 40,000 | 0.865 | 3.75 | 2.5% | 7,500 | 42,000 | 2,000 |
| 60,000 | 0.950 | 3.75 | 2.5% | 7,500 | 42,000 | −18,000 |

**Extra spending stops paying at 15,000.** The next step, 0.75, costs 15,000 more for 14,252 more of gain. The full
point of M is never reached before the pledge costs more than the point is worth.

Now Kestrel, which sells 150,000 of Titanium a day in Alpha Centauri, opposes. Titanium stays until 7.8%, so Kestrel
pays whatever rate Helios sets. Each quarter point of rate costs it 10,500 over the campaign. Against Helios's 15,000,
Kestrel's best reply is **10,000**: E(15,000) − E(10,000) = 0.528 − 0.393 = 0.135, under one step, so the cap does not
move. Helios, facing 10,000, does best to pledge 5,000 (keeping the cap from falling costs less than the fall), and so
on. With both sides answering, the pledges cancel, both corporations are down what they pledged, and the Assembly keeps
it. That is the arms race opposing campaigns are meant to be. The curve's steep start is what lets the smaller
side hold the line for less than the larger side spends. A campaign pays when nobody who loses by it is paying
attention.

### What the server stores (for the build stories)

- **Patents**: `patents.json` in the data directory. One record per patent: `{ id, kind: "research"|"chain",
  subjectId, holder publicId, filedAt, endsAt, ratePct, pending: { pct, effectiveAt } | null }`. Also the first
  completion of each patentable subject, `{ subjectId, corporation publicId, completedAt }`, which is what decides who
  may file. And one **use record** per use in the term, `{ patentId, user publicId, at, base, ratePct, royalty, paid }`:
  what the Council's `patent-royalty` claim sums (AB#919). Royalties settle through `settleTransfer` with a reason `patent-royalty` (both P&Ls, a named source). Debt
  owed goes on the payer, as dumping duty does.
- **Standing**: on each corporation, `standing: { "earth-assembly": n, "interplanetary-trade-commission": n }`. It is
  written by server code only: the sales-tax booking, the sale settlement and the ITC's finding.
- **Campaigns**: `lobbying.json`. `{ id, parameter, systemId, direction, openedBy, opensAt, closesAt, pledges: [{
  corporation publicId, side, credits, standing }], result: { shift, from, to, endsAt } | null }`. The value in force
  for a system's parameter is its base plus any active campaign's shift, read by one function that the tariff, the sales
  tax and the dumping watch all call.

### Every number this section introduces

The catalog's `patents`, `standing` and `lobbying` sections (`data/warfare.json`), held to these tables by
`tests/schema/warfare.test.js`. They are placeholders until ECONOMY.md prices them against the probe (ISP-271), and
each one is a Board or Director veto point.

| key | value | what it is |
| --- | --- | --- |
| `patents.minResearchTier` | 3 | The lowest research tier that can be patented. |
| `patents.minChainStage` | 2 | The lowest chain stage that can be patented. |
| `patents.filingWindowHours` | 72 | Hours after completing a subject in which its first completer may file. |
| `patents.filingFee` | 5000 | Credits to file, a sink to the ISA. |
| `patents.termDays` | 28 | Days a patent runs from filing. It cannot be renewed. |
| `patents.royaltyMaxPct` | 25 | The highest royalty on a node, as a share (%) of its research cost. AB#920 requires it below 100. |
| `patents.chainRoyaltyMaxPct` | 5 | The highest royalty on a chain run, as a share (%) of its outputs at base. |
| `patents.rateNoticeHours` | 72 | Hours between filing a royalty rise and its taking effect. A cut takes effect at once. |
| `patents.withholdPct` | 50 | Share (%) of each later sale's net proceeds withheld toward royalty owed. |
| `standing.max` | 100 | The most standing a corporation can hold with a faction. |
| `standing.decayPctPerDay` | 2 | Standing lost each day, as a share (%) of the value (kept to two decimals). |
| `standing.eaTaxPerPoint` | 10000 | Credits of Exchange sales tax paid per point of Earth Assembly standing. |
| `standing.itcTradePerPoint` | 20000 | Credits of goods sold at or above normal value per point of ITC standing. |
| `standing.itcFindingPenalty` | 10 | ITC standing lost to a dumping finding. |
| `lobbying.openStandingMin` | 20 | Standing needed with the faction to open a campaign. |
| `lobbying.openStandingCost` | 5 | Standing opening a campaign spends. |
| `lobbying.pledgeStandingMin` | 5 | Standing needed with the faction to pledge. |
| `lobbying.creditsPerStandingPoint` | 2500 | Influence one pledged standing point adds, in credits. |
| `lobbying.pledgeHours` | 72 | Hours a campaign takes pledges. |
| `lobbying.durationDays` | 28 | Days a campaign's shift holds. |
| `lobbying.cooldownDays` | 7 | Days before another campaign may open on the same parameter in the same system. |

The lobbyable parameters are `lobbying.parameters`, one entry each, as in the lobbying table above: `faction`, `step`,
`maxShift`, `min`, `max` and `spendScale`.
