# Territorial control: an ISA concession, not ownership (ISP-221, AB#916)

v0.13 Corporation Warfare, plan line "Territorial control and system ownership". This is the design that ISP-225 to
ISP-229 (AB#920 to AB#924) build from. Every number is in the table at the end, under the key the warfare catalog
(`data/warfare.json`, ISP-225) uses.

## The problem this settles

The plan line says "system ownership". The game's lore says a system cannot be owned. The ISP Treaty (LORE.md): *"No body in
the Sol system or recognized colonial space may be privately owned. Extraction and occupation rights are leased."* Every
lease is granted by the Interstellar Settlement Authority. So a corporation never owns a system here. It holds an **ISA
administrative concession**: a licence, granted by the ISA to the corporation or conglomerate that already does most of
the work in a system, to collect part of the ISA's fees there and to set some of its terms. The ISA can take the licence
back. The corporation's leases, buildings, fleets and goods were never part of it and are never touched by it.

The second thing to settle is absence. A territory system is the easiest place in a game to build something that
punishes a player for not logging in. DEPTH.md holds ISP to *"nothing may expire in a way that punishes absence"*, and
the Board's answer to D-0.10-1 (AB#705) allows loss in raids but no offline protection scheme. This design keeps to both:
**a concession is a set of benefits, and losing it loses only those benefits.**

## What already exists, and what this design keeps

- **The dominance metric** (docs/design/CONGLOMERATES.md, "The dominance metric", built as ISP-217, AB#912). It gives one
  share per corporation per system, computed daily at 00:00 UTC over the last 7 days, from leases held (0.4),
  tonnes extracted (0.4) and sales settled at the system's stations (0.2). Trades inside one conglomerate are left out.
  A conglomerate's reading is one share, the sum of its members'. The public reading shows the top three, rounded to 5%.
  **This design's control score is that metric**, with per-system weights where a system's rule says so (below). No new
  counter is needed.
- **The systems' `ownerRule` strings** (data/systems.json). Today they are display only (starmap-20.md). This design turns
  each one into a rule. The strings stay as the system's description.
- **ISA Claims & Leases**: every station has one (data/stations.json). A petition is filed there, docked in the system,
  the same way a lease is filed.
- **Leases**: bought once for a body's `leaseCost` (Earth 20,000 to Kestrel 60,000). The ISA lease royalty adds 1 to 3 points
  to the sales tax by leases held (ECONOMY.md, `leases.royaltyPointsByLeasesHeld`). Both are the "ISA lease fees" a
  concession shares.
- **Upkeep that cannot become debt**: military upkeep (v0.10-combat.md section 7) and conglomerate upkeep both lower a
  benefit when unpaid rather than taking assets. Concession upkeep works the same way.

## Prior art, and what ISP takes from each

| Game | What it did | ISP |
| --- | --- | --- |
| **EVE Online, Aegis sovereignty (2015)** | Replaced structure-bashing with Entosis links and capture events. The **Activity Defense Multiplier** (ADM) made a system its holder actually uses (mining, ratting) take longer to contest, up to 6x. | **Adopted**: a challenger must beat the holder's control score by a margin that grows with the holder's own use of the system (`concessionAdmMaxPct`). Holding territory you use is easier than holding territory you merely claim. **Rejected**: capture events. There is no timed fight to attend, which would punish absence. |
| **EVE Online, Equinox (2024)** | Tied the cost of holding a system to what is installed and used there. Systems produce power and workforce, and upgrades consume them, so holding idle space costs more than it returns. | **Adopted**: concession upkeep is discounted by the holder's own activity share (`concessionUseDiscountMaxPct`). A concession over a system the holder barely works costs nearly full price. |
| **Offworld Trading Company (Mohawk Games, 2016)** | An economic-only conquest game: rivals are beaten by owning the market, and a company is taken by buying out its stock. There is no military. | **Adopted**: control is earned only by leases, extraction and sales. Raids and fleets add nothing to a control score directly. **Rejected**: the hostile buyout. A concession cannot be bought, sold or transferred; it is re-petitioned. |

## Who may hold one

- A **corporation not in a conglomerate**, on its own control score; or
- a **conglomerate**, on its one summed share. A member corporation cannot petition in its own name: its activity already
  counts toward its conglomerate's share, and two shares for one group would break Part 1's T-018 rule in
  CONGLOMERATES.md.
- At most **one concession per system**, except in the two condominium systems (below), which hold two.
- A holder may hold concessions in several systems. Upkeep grows with the square of the number held (below).

## The concession's life, as a state list

Each state names what moves the concession out of it. Everything is driven by stored times and the daily control
computation, so it survives a restart and needs nobody online.

| State | Meaning | Leaves by |
| --- | --- | --- |
| `none` | Nobody holds the system and no petition is open. | A petition from an eligible holder -> `petitioned`. |
| **eligible** (a property, not a state) | A corporation or conglomerate whose control score was at least `concessionGrantPct` (40%) **and** at least `concessionLeadRatio` (1.5x) the next holder's, on each of the last `concessionEligibleDays` (14) daily computations. The system's panel shows the viewer its own streak. | Losing the streak ends eligibility, and a petition in review then fails. |
| `petitioned` | A petition filed at the system's ISA Claims & Leases, docked in the system, with the fee `concessionPetitionFee` (25,000, a sink) paid. It is open for `concessionReviewHours` (72). The petition is public: the system panel and the ISA register show who filed and when review ends. | At review end: still eligible -> `granted`. Not eligible -> `none`, fee kept. If a **counter-petition** from another eligible holder arrived during review, the one with the higher control score at review end wins, and the loser's fee is kept. |
| `granted` | The concession is held for a term of `concessionTermDays` (30) from the grant. Its benefits apply, and its upkeep is charged daily at 00:00 UTC. | Term end -> `renewing`. Upkeep unpaid -> `grace`. A successful challenge -> `lapsed`. The holder relinquishes it -> `lapsed`. |
| `renewing` | Checked at the moment the term ends, not a waiting state. The concession renews for another term if the holder's control score is at least `concessionRetainPct` (25%) **on the renewal day** and it is not in `grace`. No new fee, and no petition. The retain line sits below the grant line on purpose: a holder who slips a little does not lose the concession to a bad week. | Renewed -> `granted` (a new term). Not -> `lapsed`. |
| `grace` | Upkeep went unpaid at a daily charge (the holder's credits, or its conglomerate's treasury, could not cover it). Benefits are **suspended**, and nothing is owed or charged while suspended. | A day's upkeep paid in full at the next charge -> `granted`, same term. After `concessionGraceDays` (7) without payment -> `lapsed`. |
| `challenged` (inside `granted`) | Another holder, eligible by the grant rules, files a challenge at the system's ISA Claims & Leases with the petition fee. It must also beat the holder's control score times `concessionLeadRatio x (1 + concessionAdmMaxPct/100 x U)`, where U is the holder's own share of the system's extraction (0 to 1, the metric's X component). That is Aegis's ADM: the more the holder actually mines here, the higher the bar, from the 1.5x lead any petition needs up to 2.25x for a holder that mines everything. (Bug #4667: the margin was first stated on the holder's score alone, which the 1.5x lead already covers, so it never bound.) The challenge is reviewed for `concessionReviewHours`. | At review end: the challenger still clears the bar -> the holder's concession `lapsed` and the challenger's `granted`. Otherwise the challenge fails, the fee is kept, and the holder is untouched. |
| `lapsed` | The concession has ended. Its benefits stop at once. **Nothing else changes**: the former holder keeps every lease, building, fleet, garrison and item, and every figure on its own balance sheet except the next day's fee share. It may not petition this system again for `concessionRepetitionCooldownDays` (7). | The system returns to `none`. |

Every change is recorded in the system's public ISA register (who, when, which state) and told to the holder's members.
The holder is notified when a petition or challenge is filed against it, when grace starts, and when the concession
lapses. **A notification is information. No notification starts a clock on the holder's assets.**

### Absence, checked against each state

A holder that stops playing loses activity, so its control score falls over the metric's 7-day window. What happens:

- If it is in `granted`, nothing happens until the term ends. Then it renews if its score is still at least 25% that day.
  A holder away for a week inside a term usually still renews; one away for most of a month does not.
- Its upkeep keeps being charged from its credits (or treasury). If they run out, `grace` suspends the benefits, and
  after 7 days the concession lapses. It never becomes debt.
- A challenger can take the concession only by out-working the holder in the system over 14 days and clearing the ADM bar.
  An absent holder's bar is low, because its extraction share is low. That is the design working: a system nobody works
  should pass to whoever does. Even then the absent holder loses the concession's benefits and nothing else.

**Charter risk check**: no state, rule or number in this design removes, damages, freezes or transfers a lease, building,
fleet, garrison, item or credit balance. A lapsed concession removes the concession's benefits: the fee share, the
lease-fee modifier and tariff rights. The only money a concession ever takes is its own petition fee and its own upkeep,
both paid knowingly and both stopping when the concession stops.

## What a concession grants

| Benefit | What it is | Paid from |
| --- | --- | --- |
| **Fee share** | `concessionFeeSharePct` (20%) of every ISA lease fee paid in the system by others: new lease filings (a body's `leaseCost`), and the lease-royalty points of the sales tax on sales settled at the system's stations. Paid daily with the upkeep charge, as one ledger line each way. | The ISA's own take, so what goes to the holder no longer reaches the fee sink. The sink shrinks by that much, which ECONOMY.md must count. |
| **Lease-fee modifier** | The holder (and, for a conglomerate, each member) files new leases in the system at `concessionOwnLeaseDiscountPct` (25%) off `leaseCost`. **Nobody else's price rises**: a concession never makes a system dearer for a newcomer. | The ISA takes less. |
| **Tariff rights** | The right to set a tariff on sales settled at the system's stations, within the system's cap (the rule table below). Designed and built by v0.13-10 ("Economic warfare: tariffs"). This design fixes only which systems allow a tariff and how high. | v0.13-10. |
| **The starmap and the register** | The system is drawn in the holder's colour, with its name in the panel (below). | Nothing. |

**A concession never grants**: the right to refuse, evict or reprice anyone else's lease; to deny docking; to block
belts, expeditions, travel or trade; to take goods; or to lower anyone else's control score. The ISA still owns the
licence, and the treaty still holds.

## T-018: why holding every concession you could is not the best play

T-018 (learnings/TRANSFERABLE.md) says a knob whose revenue and cost are both linear has no decision in it. Here the fee
share grows only with the activity in each system, while upkeep grows with the square of the number held:

    daily upkeep for k concessions = concessionUpkeepBase x k²              (before the use discount)
    the k-th concession adds           concessionUpkeepBase x (2k - 1)       = 800, 2,400, 4,000, 5,600, ...
    each concession's upkeep is then discounted by  concessionUseDiscountMaxPct x the holder's control share there

| concessions held | total upkeep a day | the last one added |
| --: | --: | --: |
| 1 | 800 | 800 |
| 2 | 3,200 | 2,400 |
| 3 | 7,200 | 4,000 |
| 4 | 12,800 | 5,600 |
| 5 | 20,000 | 7,200 |

**Worked example.** *These are placeholders for ECONOMY.md to price: activity per system is assumed, not measured.*

Halcyon Mining, an independent corporation, is eligible in three systems with a control share of about 40% in each, so
each concession's upkeep is 20% off (`concessionUseDiscountMaxPct` 50% x 0.40). Others' activity in each:

All three systems are on the standard rules. The lease royalty on others' sales is taken at 1.5 points on average.

| system | others' lease filings | others' sales at the station, and their royalty | fee share a day (20%) | benefit a day |
| --- | --- | --- | --: | --: |
| Luyten 726-8 | one BL Ceti I lease (45,000) every 5 days: 9,000 a day | 150,000 a day: 2,250 | 2,250 | **2,250** |
| Alpha Centauri | none (no leasable body) | 700,000 a day, a busy trade station: 10,500 | 2,100 | **2,100** |
| Barnard's Star | none (no leasable body) | 120,000 a day: 1,800 | 360 | **360** (+ tariffs, v0.13-10, unpriced) |

Taken best first:

| concession | benefit | its marginal upkeep after the 20% discount | worth holding? |
| --- | --: | --: | --- |
| 1st, Luyten 726-8 | 2,250 | 800 x 0.8 = 640 | yes, +1,610 a day |
| 2nd, Alpha Centauri | 2,100 | 2,400 x 0.8 = 1,920 | yes, +180 a day |
| **3rd, Barnard's Star** | 360 | 4,000 x 0.8 = 3,200 | **no, -2,840 a day** |

For Halcyon the third concession costs more than it brings, though it is eligible for it. A corporation that works
Barnard's Star much harder has a higher share, a bigger discount and more sales to share, and may find it worth it. That
is the decision T-018 asks for. It also leaves room for others: a well-run corporation in each system can hold its
own concession, instead of one giant holding them all.

## The systems' rules, and the systems that can never be conceded

Each `ownerRule` string becomes a rule. "Standard" means the rules above, unchanged. The weights are the control score's
(leases L, extraction X, sales S). The tariff cap is v0.13-10's ceiling for the system.

| system | `ownerRule` (today's text) | rule | control weights L/X/S | tariff cap |
| --- | --- | --- | --- | --: |
| **sol** | No direct ownership. Mining rights are leased. | **Never concedable** | n/a | 0% |
| alpha-centauri | Neutral authority oversight with corporate lease competition. | Standard | 0.4 / 0.4 / 0.2 | 3% |
| barnards-star | Frontier charter system with low-regulation extraction rights. | Low regulation: `concessionGrantPct` 30%, eligible after 7 days | 0.4 / 0.4 / 0.2 | 3% |
| wolf-359 | High-risk conflict zone with arbitration-based claims. | Arbitrated: every petition and challenge is reviewed for 7 days (the Galactic Arbitration Council, v0.13, decides ties once it exists) | 0.4 / 0.4 / 0.2 | 3% |
| tau-ceti | Treaty-governed commercial corridor with tariff controls. | Tariff corridor: the highest tariff cap | 0.3 / 0.3 / 0.4 | 5% |
| epsilon-eridani | Semi-private jurisdiction with licensed station authorities. | Licensed: fee share 30% | 0.4 / 0.4 / 0.2 | 3% |
| **lalande-21185** | ISA survey protectorate: the Bureau's second registry, leasing on Sol's terms. | **Never concedable** | n/a | 0% |
| ross-154 | Sagittarius Mining Compact: co-operative claims, one vote per lease. | One vote per lease: control is leases only | 1 / 0 / 0 | 3% |
| sirius | Sirius Exchange Authority: a chartered trading port of brokers, not miners. | Brokers: control is sales only | 0 / 0 / 1 | 3% |
| ross-248 | ISA Northern Survey relay post: a depot, lightly held. | Lightly held: upkeep halved | 0.4 / 0.4 / 0.2 | 3% |
| luyten-726-8 | Unregulated: the twin flare stars' claims go to whoever holds them. | Unregulated: no review. An eligible petition is granted at once, and a challenge is decided at once | 0.4 / 0.4 / 0.2 | 3% |
| lacaille-9352 | Southern Arm Consortium: a members-only lease pool. | Conglomerates only | 0.4 / 0.4 / 0.2 | 3% |
| procyon | Procyon Free Port: tariff-free trade under a single charter. | Free port: no tariff; the fee share is the whole benefit | 0.4 / 0.4 / 0.2 | 0% |
| **ross-128** | Quiet Star Trust: a research reserve that leases sparingly. | **Never concedable** | n/a | 0% |
| 61-cygni | Twin-star condominium under two rival charters. | Condominium: two concessions, the top two eligible holders, each with half the fee share | 0.4 / 0.4 / 0.2 | 3% |
| **kapteyns-star** | A halo drifter with no authority: salvage law applies. | **Never concedable** | n/a | 0% |
| epsilon-indi | Brown-dwarf frontier: survey claims arbitrated by convoy captains. | Arbitrated, as Wolf 359 | 0.4 / 0.4 / 0.2 | 3% |
| kruger-60 | Cassiopeia Reach: claims recorded by whichever convoy arrived first. | First recorded: a counter-petition cannot win a review that is already open; the first eligible petition stands | 0.4 / 0.4 / 0.2 | 3% |
| wolf-1061 | Ophiuchus Frontier Office: an ISA outpost at the edge of its writ. | Edge of the writ: the term is 14 days | 0.4 / 0.4 / 0.2 | 3% |
| altair | Altair Compact: the frontier's own exchange. | An exchange: control is sales-weighted | 0.2 / 0.2 / 0.6 | 3% |
| 70-ophiuchi | Serpent Accord: two stars' claims held in trust by rival consortia. | Condominium, as 61 Cygni | 0.4 / 0.4 / 0.2 | 3% |
| **van-maanens-star** | Remnant field: a dead system's debris, claimed by no one. | **Never concedable** | n/a | 0% |

**Never concedable, and why:**

- **Sol**: every corporation is founded at Earth Station Prime and takes its first lease in Sol. A concession here would
  put a newcomer's first leases, first sales and first royalty inside someone else's fee share from day one. It would also
  let a veteran lock out the whole opening: the thing this design most has to prevent.
- **Lalande 21185**: the ISA's second registry, "leasing on Sol's terms". It is the second step of a new corporation
  that has outgrown Sol, and it stays on Sol's terms for the same reason.
- **Ross 128**: a research reserve held in trust by the Quiet Star Trust. The ISA has leased it sparingly by charter, and
  it cannot license a fee share in a system it has already put in trust.
- **Kapteyn's Star** and **van Maanen's Star**: no authority, and claimed by no one. A concession is an ISA licence, and
  the ISA has no writ to grant one there. These are the lawless systems, and they stay lawless: salvage law, not
  licences.

A never-concedable system still has a control score and a dominance reading. It never shows a holder and never takes a
petition.

## How it surfaces

**On the starmap (ISP-229, AB#924)**, from the public reading only: the dominance metric's privacy rules still apply,
so nobody's leases, tonnes or sales are ever shown, only rounded shares.

- **Cluster view**: a system under concession has its star ringed in the holder's colour. A conglomerate holder also shows
  its emblem, beside the name (on a phone, in the system panel only). Never-concedable systems carry a small ISA mark
  and "ISA administered".
- **System panel**: "ISA concession: *holder* (corporation or conglomerate), term to *date*", then the public top three
  control shares (rounded to 5%). Below that, any open petition or challenge, with who filed it and when review ends.
  For the viewer: "Your control here: 40% (rounded); eligible on 9 of the last 14 days"; and, when it is eligible, the
  way to the system's ISA Claims & Leases. For the holder: the upkeep today, the discount, and the fee share collected
  over the term.
- **ISA Claims & Leases** (in the system's station): the petition and challenge forms, with the fee and the eligibility
  checklist, each line with its figure and whether it is met. The ISP-203 level panel is the pattern: requirements
  with progress bars, and the action drawn disabled with its reasons. Also the system's register (the last 20
  changes), and for the holder, relinquish.
- **The ownerRule text** stays as the system's description, now followed by its rule in one plain line ("Condominium: two
  concessions, each with half the fee share").

## What the server stores (for the implementation stories)

- `concessions.json` in the data directory (like `dominance.json`): per system, `{ systemId, state, holder: { type:
  "corp" | "conglomerate", id }, grantedAt, termEndsAt, graceSince, petitions: [...], register: [...] }`. No account id
  appears anywhere; holders are corporation publicIds and conglomerate ids, as everywhere in v0.12.
- **Eligibility** is derived each day from the stored dominance computations. Keep the last `concessionEligibleDays`
  per system and holder; a streak is never stored as a counter nothing writes (T-019).
- A daily **concession tick** at 00:00 UTC, after the dominance computation: review ends, renewals, upkeep charges,
  fee shares paid, grace and lapse, in that order, each keyed so a repeated tick moves nothing twice.
- Fee shares and upkeep move through `settleTransfer` with their own reasons (`concession-upkeep` to the fee sink,
  `concession-fee-share` from the fee sink), so the ledger and ECONOMY.md's sink counts see both.

## Stories

| Story | What it builds from this design |
| --- | --- |
| ISP-225, AB#920 | `data/warfare.json`: every number in the table below, the system rule table, and the never-concedable list, with a cross-catalog test (every system id exists, every weight row sums to 1, never-concedable systems have no holder rules) |
| ISP-226, AB#921 | Control scores per system with the rule table's weights, and each holder's eligibility streak |
| ISP-227, AB#922 | Petition, counter-petition, review, grant, renewal, upkeep, grace, challenge (with the ADM bar), relinquish and lapse: the state list |
| ISP-228, AB#923 | The fee share and the lease-fee modifier |
| ISP-229, AB#924 | The starmap and ISA Claims & Leases surfaces above |

## Every number this design introduces

Placeholders until ECONOMY.md prices them against the probe (AB#914's pattern). Each one is a Board or Director veto
point.

| key | value | what it is |
| --- | --- | --- |
| `concessionGrantPct` | 40 | Control share (%) a holder needs on each of the eligible days to petition. |
| `concessionLeadRatio` | 1.5 | And at least this multiple of the next holder's share on those days. |
| `concessionEligibleDays` | 14 | Consecutive daily computations the grant conditions must hold before a petition. |
| `concessionDataMaxAgeHours` | 26 | Eligibility reads false when the latest daily computation is older than this (fails closed, AB#921). |
| `concessionPetitionFee` | 25000 | Credits to file a petition, counter-petition or challenge; a sink, never refunded. |
| `concessionReviewHours` | 72 | How long a petition or challenge is open before the ISA decides. |
| `concessionTermDays` | 30 | A concession's term; renewed at its end while the holder keeps `concessionRetainPct`. |
| `concessionRetainPct` | 25 | Control share (%) on the renewal day that renews the term. |
| `concessionGraceDays` | 7 | Days of unpaid upkeep, with benefits suspended, before a concession lapses. |
| `concessionRepetitionCooldownDays` | 7 | Days after a lapse before the former holder may petition the same system again. |
| `concessionUpkeepBase` | 800 | Daily upkeep scale: k concessions cost this x k² a day before the use discount. |
| `concessionUseDiscountMaxPct` | 50 | Upkeep discount at a 100% control share; the discount is this x the holder's share (Equinox). |
| `concessionAdmMaxPct` | 50 | A challenger must beat the holder's score x `concessionLeadRatio` x (1 + this/100 x the holder's extraction share) (Aegis ADM; Bug #4667). |
| `concessionFeeSharePct` | 20 | Share of the ISA's lease fees in the system (others' lease filings, the lease royalty on sales there) paid to the holder. |
| `concessionOwnLeaseDiscountPct` | 25 | Discount on `leaseCost` for the holder's (and its members') own new leases in the system. |
| `concessionTariffCapPct` | 3 | The default tariff ceiling for v0.13-10; per-system caps are in the rule table. |
| `concessionsPerSystem` | 1 | Concessions a system can hold at once (2 in the condominium systems). |
