# P-010 scroll audit: which ISP pages need subpages (AB#2469)

DOCTRINE P-010 (Board, 2026-09-26): *on a desktop screen, a page should need little or no scrolling; when it needs a
lot, break it into subpages.* This is the punch list for Feature AB#2468 (Subpages and Operations): AB#2470 Financial
Core, AB#2471 Station and Operations, AB#2472 Galactic Exchange, and AB#2481 sidebar sections. No page is changed here.

## How it was measured

- `e2e/scroll-audit.spec.js` opens every page before play, every tab, and every view inside a tab (Inbox's folders
  and sub-tabs, Assets' two views), plus Travel mid-journey. It runs at **1440×900** (the stated desktop viewport)
  and 1920×1080. For each screen it records the page's height, where the tab's own content ends, and the tab's
  sections with their heights. It also takes a full-page screenshot, and I looked at the long ones.
- **The corporation** is `e2e/seed-industry-account.mjs`: Level 5, with research, a refinery run, two leases, stock
  at three stations and shipments.
- **What the measurement cannot see:** a real mid-game corporation has more of everything that is a list. The
  numbers below are therefore a *floor* for anything that grows with play: Fleet's fleets and garrisons, Station's
  holdings and mining cycles, Logistics' history, Assignments, Inbox, trade history and the Conglomerate views. The
  corporation is not in a conglomerate, so only Conglomerate's join view was measured.
- **Scale:** *screens* is height ÷ 900. **Little** means up to 1.25 screens, **some** means 1.25 to 2, and **a lot**
  means over 2.

## The finding on every tab: the left column sets the page length

Every signed-in tab is at least **1,825px (2.03 screens)** at 1440×900, even Forums, whose content ends at 264px.
The left column stacks two things:

- the navigation, 17 tabs in six groups, about 890px tall;
- the Corporation Identity and Milestones sidebar under it, capped at `100vh − 110px` (790px), with Milestones
  scrolling inside its box.

So on a desktop the player scrolls past the navigation to reach their identity card, and every short tab gets a page
it does not need.

**For AB#2481:**
- Show only the open group's tabs, with the other groups collapsed to their headings. That is six headings plus at
  most six tabs, about 450px.
- Start Milestones collapsed on desktop, or move it to Overview, which already shows "Level 5 of 30" and the
  milestone list.

This audit predicted that either change alone would bring most tabs under one screen. That was an estimate, and it
was too hopeful.

**As built (AB#2481),** measured by the same spec:
- Collapsing the closed groups took the navigation to 494px. Milestones and Quick Actions now start collapsed, and
  Corporation Identity stays open (about 300px).
- At 1440×900 the short tabs went from 2.03 screens to between 1.13 and 1.26 (Inbox 1.13, Forums 1.26).
- At 1920×1080 they fit in one screen (1.00 to 1.05).

The long tabs below are unchanged: their own content is what sets their length.

## Every screen, by the tab's own content

Figures are at 1440×900; the second figure is the same measure at 1920×1080.

| Screen | Content ends (px) | Screens | At 1920×1080 | Verdict |
|---|---:|---:|---:|---|
| **Galactic Exchange** (`market`) | 6,600 | 7.33 | 5.94 | **A lot**: split (AB#2472) |
| **Refinery Chains** | 5,586 | 6.21 | 3.69 | **A lot**: split |
| **Station** | 3,541 | 3.93 | 2.87 | **A lot**: split (AB#2471) |
| **Financial Core** | 3,231 | 3.59 | 2.90 | **A lot**: split (AB#2470) |
| **Corporate R&D** | 2,679 | 2.98 | 1.87 | **A lot**: split |
| **Fleet** | 1,958 | 2.18 | 1.81 | **A lot**, and it grows with play: split |
| **Logistics** | 1,951 | 2.17 | 1.58 | **A lot**: tighten |
| Landing (`/`) | 2,206 | 2.45 | 2.04 | A lot; a public front page, so exempt (see below) |
| How to Start | 1,607 | 1.79 | 1.49 | Some; a guide read once, so leave it |
| CEO Insight | 1,174 | 1.30 | 1.04 | Some; leave it |
| Overview | 1,069 | 1.19 | 0.99 | Little |
| Starmap | 1,065 | 1.18 | 0.97 | Little |
| Conglomerate (join view) | 871 | 0.97 | 0.79 | Little; the member views were not measured |
| Assets (Inventory, Infrastructure) | 853, 676 | 0.95 | 0.79 | Little |
| Chat | 773 | 0.86 | 0.72 | Little |
| Assignments | 524 | 0.58 | 0.49 | Little; grows with play |
| Travel | 446 | 0.50 | 0.41 | Little |
| Inbox (every folder and sub-tab) | 350 to 411 | 0.45 | 0.38 | Little |
| Forums | 264 | 0.29 | 0.24 | Little |
| Login, Register, Forgot, Reset, Check email, Verify | 900 | 1.00 | 1.00 | Little (a full-height form) |

## What to split, page by page

The section heights come from the audit's JSON; ⟶ marks a move into the **Operations** view that AB#2471 creates
(Board review item 30: *one view where we can see ALL of our mining operations, our research, travel, probes,
attacks*).

### Galactic Exchange: 7.3 screens (AB#2472; Board items 33 and 34)

**The problem.** Twelve sections in one column:
- Standing buy orders alone is **3,147px**: every NPC buyer of all ~50 resources, one row each.
- The resource filter at the top narrows the player order books but not the standing orders under them.

**Recommended subpages:**
1. **Trade.** The resource filter, price history, sell orders and buy orders, all for the selected resource. Standing
   buy and sell orders are filtered by the same selection, so the ~50-row table becomes one or two rows.
2. **My orders.** Create listing, place a buy order, my active listings, and inventory at this station.
3. **History.** Trade history.
4. **Mercenary Rentals** moves out of the Exchange to Fleet's subpages, where the fleets it hires out already are, or
   gets a subpage of its own. It is a contract market for fleets, not goods.

**As built (AB#2472).** Five subpages. It differs from the recommendation above in three places:
- **Standing orders is the default page.** Selling Silicates to a standing buy order is the first hour's sale.
- **Inventory at this station** sits on the Standing orders page, where a sale counts it down (AB#745).
- **Mercenary Rentals** got a subpage of its own rather than moving to Fleet.

Measured at 1440×900, in screens:

| Page | Screens |
|---|---:|
| Standing orders | 5.0 |
| Player orders | 2.0 |
| My listings | 1.0 |
| Mercenary Rentals | 0.9 |
| Trade history | 0.7 |

Standing orders is still long: with All picked, the standing buy orders are about 50 rows. The filters narrow them,
but only once the player picks something. Making the table short by default is its own story, AB#4710.

### Refinery Chains: 6.2 screens

**The problem.** "Available chains" is **4,832px**: 29 chain cards, each with its inputs, outputs and uses.

**Recommended:**
- Subpages by tier: Raw refining / Alloys and components / Cross-track / Synthesis (Tier 4). Alternatively, a default
  view of **Runnable here** (researched, with a Refinery), with the rest behind **All chains**.
- The resource catalog becomes its own subpage (it is reference material).
- ⟶ **Active runs** also appear in Operations.

### Station: 3.9 screens (AB#2471; Board items 29 and 30)

**The problem, section by section:**
- **Authority & Regulatory Offices** is **1,537px**: eleven office cards, each with its lore paragraph.
- Operational Facilities: 434px.
- Construction: 610px.
- Licensed Corporate Holdings: 174px (grows with play).
- Active Mining Cycles: 348px (grows with every yard).

**Recommended subpages:**
1. **Overview.** The station header and Operational Facilities.
2. **Offices.** The eleven offices, as a compact directory: name, agency and **Enter**. The lore moves behind
   Enter, with the office itself.
3. **Construction.** Unchanged.
4. **Holdings.** Licensed Corporate Holdings.

⟶ **Active Mining Cycles moves to Operations**, as the Board asked.

### Financial Core: 3.6 screens (AB#2470; Board item 20)

**The problem.**
- The headline cards and credit rating take about 480px.
- Then six charts stacked in **1,578px**: cash reserves, net cash flow, assets vs liabilities, income by source,
  asset composition and daily P&L.
- Then the P&L and balance sheet (744px), and daily statements (240px).

This is the Board's "no seemingly logical order": state, then history, then statements, interleaved.

**Recommended subpages:**
1. **Summary.** The headline cards, credit rating and the one cash chart.
2. **Trends.** The other charts.
3. **Statements.** P&L, balance sheet and daily statements, with the ledger if it has a home here.
4. **Credit.** The rating card, with loans and bonds as those screens land (AB#842 to AB#848).

### Corporate R&D: 3.0 screens

**The problem.** The research grid is **2,007px**: 30 cards across tiers T1 to T5, in no grouping.

**Recommended:**
- Subpages by track (Extraction and Industry / Travel / Military / Synthesis), or tier tabs.
- The default view is **Available now**; Complete and Locked cards sit behind their own filter.
- ⟶ **Active and queued** stays at the top here and also appears in Operations.

### Fleet: 2.2 screens, the floor, since it grows with fleets and stations

**The problem.** Forces, Fleets, Raids and HQ Troop Training in one column. Garrisons show one card per station
(three here), and fleets and raid reports add rows.

**Recommended subpages:**
1. **Forces and fleets.**
2. **Raids and garrisons.**
3. **Headquarters** (training).
4. **Mercenary Rentals**, if it moves here from the Exchange.

⟶ Raids in flight and troops in training also appear in Operations.

### Logistics: 2.2 screens

**The problem.** 27 station cards, of which 24 say "No assets stored at this station".

**Recommended (tighten rather than split):**
- Show only the stations holding stock, as cards.
- Put the others behind one "Show all stations" disclosure, or drop them.
- Shipments in Transit and Transfer History then sit within the first screen.

⟶ Shipments in transit also appear in Operations.

### Leave as they are

- **Landing** (2.45 screens): the public front page, where a long read is the convention. P-010 is about the screens
  a player uses. Flagged for the Board to veto.
- **How to Start** (1.8): a guide read once.
- **CEO Insight** (1.3): one active card and one grid of 12 programs.

## What Operations would hold (for AB#2471)

Each item below appears on its own tab today:
- mining cycles (Station);
- expeditions and probes (Starmap's belt panel);
- refinery runs (Refinery);
- research, and CEO programs (R&D, CEO);
- shipments in transit (Logistics);
- travel (Travel);
- troop training, and raids in flight and their reports (Fleet).

One row per thing in progress, with its time left and a link to its tab, is the view the Board described in item 30.

## For the Board to veto

- The scale above (little ≤ 1.25 screens, a lot > 2) is my reading of "little" and "a lot".
- The landing page is exempted.
- Mercenary Rentals moves from the Exchange to Fleet.
