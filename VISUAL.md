# VISUAL — interstellar-settlement-protocol

Visual-design reviews (RUBRIC.md "Visual design"), one section per review, newest last. Review #1
(2026-09-25, POLISH 2.4/5) was filed as Critique AB#1757 and is copied here from it, so every review is in this file.

## Review #1 — 2026-09-25 · **2.4 / 5 · POLISH**

Reviewer: Critic (interstellar-settlement-protocol), Claude Fable 5.1.
Build: `origin/main` a271151 (Merge PR 392).

**PROVISIONAL, unratified rubric.** RUBRIC.md has no visual-design table; the gates below are a Critic's draft for the Director to ratify. Nothing downstream should treat this score as a gate result.

**Where it sits.** v0.5 Beta MVP (AB#389), the design-system work split from ISP-25 (AB#592): AB#758 mockups, AB#759 to AB#772 the system and each screen, all Proposed and waiting on AB#758 and Decision AB#695 (closed 2026-09-21 as prematurely opened). Build reviewed: origin/main a271151, Merge PR 392.

**Verdict and score: POLISH, 2.4 / 5** (draft verdicts: FINISHED avg ≥ 3.5 with no gate below 2 and both person-judged gates ≥ 3; POLISH otherwise, at most five epics; PROTOTYPE if any gate is 1 or anything placeholder is visible). Gates 1–5, one sentence of evidence each, in the linked review. First impression 3, hierarchy 2, typography 2, colour and elevation 2, consistency 3, responsive 2, motion and states 2, art 3. Every gate had a subject; no floor scores.

**The full review, with 20 screenshots, the draft rubric table and the instruments:** https://claude.ai/artifact/8oRjjjnwkzAxaywc8edGKg

**Ranked epics** (product-scale sizes; the PM splits):

1. **Flat surfaces, one accent, no glow** — keep void-black and cyan, remove the 62 box-shadows and 10 text-shadows, depth from three surface steps each ≥ 1.2:1; cyan on at most one primary control per screen plus the active tab; box-shadow rules ≤ 10. Size M. Existing: AB#759, AB#760.
2. **One type system** — Inter only with weight and size doing hierarchy, tabular numerals in every numeric column, Orbitron at most in the logo mark; ≤ 2 families and ≤ 8 sizes in the stylesheet; the Assets 0 reads as a zero. Size S. Existing: AB#759.
3. **An app shell that decides the layout** — sidebar with the corporation strip and nav grouped Company / Station / Industry / Market / Comms, a 56 px header, bottom nav on phones; first content ≤ 120 px from the top at 375; zero walkthrough steps where the card covers its target; no truncated nav label. Size M. Existing: AB#763, AB#764, AB#771.
4. **Data screens as one instrument** — one KPI tile and one table component (sticky header, right-aligned tabular figures, hover row, empty state naming the next action) on Overview, Finance, Assets, Logistics and the Exchange; charts on ≤ 4 series colours plus one negative. Size M. Existing: AB#766, AB#769.
5. **Let the art carry the atmosphere** — NASA planets at ≥ 64 px in the system view, the Voss portrait style extended to other agents, station interiors as a consistent header band, landing trimmed to hero plus three sections; an asset sheet with a style note per image. Size M. Existing: AB#767, AB#771, AB#949; AB#741 done.

**Session-sized quick wins needing no direction decision:** login and register with one primary button; a focus-ring token and a prefers-reduced-motion block; Assets tiles off Orbitron (Bug AB#1755); the walkthrough scroll on a late-appearing target (Bug AB#1756); Refinery Chains requirements in muted text rather than amber; Corporate R&D and Assignments panels at full content width.

**Bugs filed:** AB#1755 (Assets tiles show a checkbox-like glyph for 0), AB#1756 (phone walkthrough step 3 covers the lease button; a gap left after AB#1083).

**What is already known:** EVE Photon UI (2022) solved readability at the same density by reskinning components and changing the font; dark-surface guidance puts depth in surface luminance, not shadow; tabular numerals for money columns. Sources in the review. Secondary web sources, not primary research.

**Evidence:** npm test 148 files, 1,496 tests, all passed; contrast script over the tokens (text all AA, surfaces 1.12:1 apart, borders 1.57:1); stylesheet counts (4 families, 39 sizes, 74 literal hex, 0 reduced-motion, 4 focus-visible); 170 screenshots from a scripted first day and the demo account at 1440 and 375; a re-test of the walkthrough overlap with no scripted scrolling.

**Blind class:** nobody moved a pointer: hover, scroll feel, pan and zoom, motion timing and the typewriter cadence were captured at rest only; headless Chromium at 1x and 2x, not a monitor; one reviewer's eye against an unratified rubric. The Board's own look outranks every number here.

**Charter and Soul:** checked, no energy gates, fake urgency, inflated baselines or fabricated social proof. No monetization surface exists. Security in proportion: the visual layer touches no data; the developer login shows only on localhost. The Voss portrait and the station interiors carry no credit line in the repo; worth one each before Preview.

**Read after scoring:** AB#592 diagnosed the same two tells (Orbitron, glow borders) on 2026-09-20 and named the same references. Nothing here disagrees with that plan; the evidence says the direction is not really open, so AB#758 could produce one Station mockup in the flat direction for a yes or no rather than three. That is the Board's call.

Critic tab (interstellar-settlement-protocol), Claude Fable 5.1, 2026-09-25.

_Backfilled on 2026-09-27 (hq AB#2501) from Critique AB#1757, where this review was filed: its text as filed, unedited. The full review, with 20 screenshots, the draft rubric table and the instruments, is the artifact linked above._

## Review #2 — 2026-09-27 · **2.9 / 5 · POLISH**

Reviewer: Critic (fresh context), Claude Fable 5.1 at high effort, at the Board's request (item 15 of the
2026-09-26 Board review; COMMON §4, Fable for a Critic's design review at a milestone).
Build: `origin/main` c176b25c (Merge PR 880), run locally with `ISP_DEV=1` on a scratch data directory.
Scope: the Board's items 15, 26, 27, 31, 32, 42 and 48 (hq `docs/board-reviews/interstellar-settlement-protocol-review-2026-09-26.md`).
Core goal: **a unified design across every screen** (RUBRIC, Board 2026-09-26; DOCTRINE P-010).
Previous score: 2.4 / 5 (review #1, read after scoring, see "History").
Screenshots and instruments: the artifact linked from Critique AB#2500 (26 screenshots at 1440×900 and 375×812).

### What is already known

- **Scrolling.** NN/g's eye-tracking work (Scrolling and Attention, updated) finds most viewing time above the
  fold and that people scroll only when the page gives them a reason. A page that hides its one action six
  screens down is asking for that reason every time. Source: https://www.nngroup.com/articles/scrolling-and-attention-original-research/
- **Navigation shape.** Material 3's navigation-rail guidance: a persistent rail at medium and larger widths holds
  3–7 destinations; a bottom bar only under 600dp; more than five destinations wants an expandable rail, not a
  longer list. ISP's six groups fit a rail; its 13 tabs plus three sidebar blocks do not.
  Source: https://m3.material.io/components/navigation-rail/guidelines
- **Targets.** WCAG 2.2 SC 2.5.8 sets a 24px floor; Apple's HIG and Material both put comfortable one-finger
  targets at 44–48px. ISP's phone controls are already at 44px on 13 of 14 tabs (measured below).
  Source: https://www.allaccessible.org/blog/wcag-258-target-size-minimum-implementation-guide
- **Star maps.** CCP's EVE Online map rework ("A Map To Treasure") put the map in a real space scene and reworked
  colouring, highlighting and labelling for readability; the recurring complaint on the old map was that marks and
  lines merged in clusters. The lesson for a system view: legibility comes from sizing and labelling, not from
  glow. Source: https://www.eveonline.com/news/view/a-map-to-treasure
- Secondary web sources, not primary research; our own evidence is one build and one reviewer.

### Instruments, and what each one measures

- **Screenshots** (Playwright, headless Chromium, 1440×900 at 1x and 2x, 375×812 at 2x, seeded level-5 accounts):
  what the page looks like at rest. Judged by looking. Blind to hover, motion and a real monitor.
- **Page height / viewport height per tab** ("screens"): how much scrolling a page needs (P-010). A proxy for
  hierarchy, not hierarchy itself.
- **Visible `.ui-button--primary` per screen**: whether one action leads. Counts a class, not the eye.
- **Chrome above first content** (px from the top of the page to the active panel): what a phone shows before
  the page itself. Measured, not felt.
- **Contrast script over the tokens**: every text token against the four surfaces (WCAG relative luminance).
  Says nothing about text painted from a literal hex or on a canvas.
- **Stylesheet counts** (`font-family`, `font-size`, literal hex, `box-shadow`, `text-shadow`, `focus-visible`,
  `prefers-reduced-motion`): evidence for a score, never the score (RUBRIC amendment, P-LOOK-NOT-MEASURE).
- **Canvas label recorder** (the e2e `recordCanvas` hook): where the Starmap drew each label, used to drive the
  map; it cannot see what the map looks like.

### Scores

| Gate | Score | Evidence (one sentence, instrument beside it) |
|---|---|---|
| First impression | **3** | The landing at 1440 reads as a finished dark product (one headline, one cyan Register) but a text-only "ISP" wordmark and three tag pills read as template, and the first app screen (Overview) is four equal cards with the verb hidden in an 11px "Go to Station →" link; 0 primary controls visible on Overview. |
| Hierarchy and layout | **2** | No desktop tab is under 1.9 screens at 1440×900 because the sidebar's 58-row Milestones list alone runs to 1,745px; Station is 2.8 screens, Finance 3.5, Refinery 4.2, Galactic Exchange 6.1; Station shows four equal cyan Build primaries and Refinery none among 43 controls (P-010 lowers this gate). |
| Typography | **4** | One face (Inter, 3 `font-family` values, all tokens), 8 `font-size` values, `tabular-nums` in 16 rules and the Corporation Identity column aligns; the mono face carries four things (Finance stat strip, Logistics stat strip, station code, claim ID) where the 5 allows two. |
| Colour and elevation | **3** | Every text token passes AA on all four surfaces (worst: muted on surface-3, 5.11:1), surfaces step 1.20 / 1.22 / 1.41, `box-shadow` down to 10 rules (was 62) and `text-shadow` to 0; but borders sit at 1.83–2.68:1 (5 asks 3:1 or absent), 65 literal hex remain outside `:root`, and the Starmap canvas paints its own glow palette (sun bloom, glowing station diamonds, glowing pill buttons) that Decision AB#1801 removed everywhere else. |
| Consistency | **2** | The same thing does not look the same: money is "¤63,000" on Construction and Facilities cards and "$631,000" on Overview, Finance and Logistics (`¤` in three scripts); a headline number is an Inter card on Overview and a mono uppercase box on Finance and Logistics; there are two back-button designs (flat "← Back to Station", glowing canvas "◂ Back To Cluster"); the fourth office card sets its badge inline where three stack it; refinery cards come in two shapes with two requirement formats ("Inventory: 0 Titanium (need 160)" against "Needs 40 · holds 0 · Short by 40"), which is the Board's item 31. |
| Responsive | **3** | No page scrolls sideways at 375 (`scrollWidth` 375 on all 14 tabs) and 0 controls under 44px on 13 of 14 tabs (Refinery: 10); but 320px of chrome sits above the content on every phone screen (header 123px, three sidebar blocks 165px), Station runs 7.1 screens, Refinery 15.3, Exchange 24.1, the Starmap's two canvas back buttons overlap each other in the Earth view at 375, and the tab strips on Inbox, Exchange and Forums run past the right edge ("Trade & Exchange M" is cut). |
| Motion and states | **3** | A focus-ring token and 5 `:focus-visible` rules (the keyboard walk shows the cyan ring on the Inbox tab), 15 hover, 21 disabled and 3 `prefers-reduced-motion` blocks; loading is a progress bar on R&D and refinery runs; hover, active, motion timing and the starfield were captured at rest only (blind class), so this gate cannot go above 3 from here. |
| Art and atmosphere | **3** | Real assets in three unrelated styles (NASA planet photos, credited; a painted ISA office hero; a procedural sun bloom on the canvas) and a text-only wordmark; in the Sol view Earth is about 14px and Jupiter 24px of photo on a 1,058×560 canvas, so the empty canvas carries the mood rather than the art. |
| **Average** | **2.9** | 23 / 8 = 2.875. Every gate had a subject; no floor scores, so the evaluable-only average is the same number. |

Verdict rule: FINISHED needs ≥ 3.5 with no gate below 2 and both looked-at gates ≥ 3. Nothing placeholder is
visible and no gate is a judged 1, so not PROTOTYPE. **POLISH.**

### Against the core goal: one design, every screen

The flat direction (Decision AB#1801) has landed on the shell, the Station, Finance, R&D, Inbox and the Exchange,
and it holds: one face, one accent, surfaces instead of glow. Where it has not landed is where the Board looked:

- **The Starmap is a second product.** Its canvas draws glow, its own button style, its own label type and its
  own colour set, inside a page whose chrome is flat. The two back buttons are the clearest tell: a flat
  secondary button above the map ("Reset View") and a glowing pill inside it ("◂ Back To Cluster").
- **Numbers have three idioms.** Overview: Inter card with a sentence heading. Finance and Logistics: mono,
  uppercase label, coloured left border. Construction: "¤" where every other screen says "$".
- **Cards have as many shapes as screens.** Office cards (badge, title, body, quote, Enter), building cards
  (title, body, meta, a field and a primary), refinery cards (two shapes), station cards on Logistics (a form
  inside a card), all different in badge position, footer, and which control leads.
- **The sidebar is four things.** Navigation, an identity table, a 58-row checklist and five buttons that
  repeat the navigation. On a phone the same four things become three collapsed bars above every page.

### The Board's items

**15 · Starmap, our solar system.** What I saw at 1440: nine photo discs of 10–24px scattered around a 40px sun
bloom on a 1,058×560 canvas, orbit rings so faint they read as noise, a dotted ring for the belt, 11px white
labels with no halo, cyan and amber glowing diamonds for stations, and a glowing pill for "Back To Cluster".
Nothing is wrong with any single part; together it is a 2013 browser-game map on a 2026 flat page, and at
375 the Earth view's two back buttons overlap each other. What would change it: draw on the tokens (flat
diamonds in the accent, labels in `--text-soft` at `--font-size-2`, hairline orbits at ≥ 3:1 against `--bg`, no
shadowBlur); size bodies on a compressed scale with a legible floor (≥ 24px at 1,058 wide, ≥ 64px for the
selected body, which review #1 asked for and which was not done); place each body on its orbit at a stable
angle so the layout stops looking random; move the back controls out of the canvas into the app's own
secondary buttons above it (one back-button design, and the 375 overlap disappears), with "Back to Planet"
from a moon (item 14). Bug AB#2499 records the overlap.

**26 · Authority and Regulatory Offices.** Four equal cards of lore, each with an italic quote, each ending in a
secondary "Enter"; the eye lands on nothing, and the fourth card puts its badge inline where the other three
stack it. The office's own page already has the hero band and the quote, so the Station does not need them
twice. What would change it: a directory, one row per office (badge, name, one line of what you do there,
Enter), and the four rows fit in one screen, which also removes the first 500px of the Station's length.

**27 · Construction, Basic Extractor Yard, "On lease".** The "On lease" label is drawn as a field: a black box
with the label text hugging its top edge (4.8px gap, no side padding) and the select nested inside it, so it
reads as two inputs stacked, then a cyan Build under it. Every other building card carries either a cyan Build or
an amber "blocked" line, so the Station shows four equal primaries at once. What would change it: one control
per card, and the lease choice folded into it ("Build on Mars lease (0 of 2 in use) · ¤63,000") with a picker
only when more than one lease has room; blocked cards say why in muted text, not amber, because amber is also
the Milestones "Open" colour and the refinery "Short by" colour. The "¤" glyph is Bug AB#2498.

**31 · Refinery Chains.** "Available chains" lists all 19 chains, including ones that need research the
corporation does not have; every card carries "Build 2nd Refinery", which is not what the card is about;
short cards and tall cards state requirements in two formats. What would change it: two sections, *Can run now*
and *Unavailable* (one line each: the one thing missing), one card shape for both, and one inputs table
(Needs / Holds / Short) on every chain, including Silicates, so the Board's Fusion-Pellets-versus-Silicates
inconsistency cannot recur. "Build 2nd Refinery" appears once, at the top.

**32 · Logistics.** A form and 27 station cards, 24 of which say "No assets stored at this station", under a
strip of four mono stat boxes that match Finance and nothing else. The page's whole job is "move N of X from A
to B", which is an action on an inventory row, not a destination. Answer to the Board's question: it does not
need its own page. What would change it: a Move action on every inventory row in Assets (item 35 already wants
Assets filtered by station) and on the Station's holdings; shipments in transit and the transfer history under
the Operations view (item 30); the tab removed.

**42 · The sidebar as a whole.** At 1440 it is navigation (13 tabs in 6 groups, 780px), Corporation Identity
(7 rows), Milestones (58 rows, about 1,400px) and Quick Actions (5 buttons that repeat five of the tabs). It
is the reason no page is shorter than 1.9 screens. What would change it: navigation only (the six groups are a
rail-sized set); identity as a strip in the header (corporation · level · credits · location, which also gives
the Board item 17's "cash near the top" on every screen); Milestones on the Overview, where "Level 5 of 30"
already lives; Quick Actions removed.

**48 · The whole mobile layout.** Before any page content a phone shows 320px of chrome: a two-line header, a
row of two buttons (Notifications, Log Out), then three collapsed bars (Identity, Milestones, Quick Actions).
The bottom bar (six groups) with the open group's tabs above it is sound; the first screen is not. What would
change it: content within 120px of the top (one-row header: wordmark, bell, menu; the Board's item 45), the
three bars as the Board's three bottom buttons (item 46), page sections collapsed by default (item 47), and the
P-010 splits, which matter most here (Station 7.1 screens, Refinery 15.3, Exchange 24.1).

### Ranked epics (POLISH: at most five, product-scale sizes; the PM splits, P-EPIC-SIZE)

| # | Epic | Board items | Measurable target | Size |
|---|---|---|---|---|
| 1 | **One shell.** Sidebar is navigation only; identity strip in the header; Milestones on Overview; Quick Actions removed; phone header one row; the three phone bars become the bottom buttons; P-010 splits for Station, Finance, Refinery, Exchange | 42, 45–48, 17, 20, 29, 34 | First content ≤ 120px from the top at 375 (today 320) and ≤ 110 at 1440; every tab ≤ 1.5 screens at 1440×900 (today min 1.94, max 6.14) and ≤ 4 at 375 (today max 24.1); measured by the look script | M |
| 2 | **One card, one control.** One `ui-card` anatomy (badge top-left, title, one-line body, meta line, one footer control) for offices, buildings and chains; the office directory; the lease choice folded into Build; Refinery split into *Can run now* / *Unavailable* with one Needs/Holds/Short table | 26, 27, 31 | ≤ 1 cyan primary per screen at 1440 (Station today 4); one requirement format on all 19 chains; "Build 2nd Refinery" once per page; four office rows in one screen | M |
| 3 | **One number.** One stat component (Inter, tabular) replaces the mono boxes on Finance and Logistics and the Overview cards; one currency glyph; mono only for identifiers | 17, 20 | `¤` count in `public/` is 0 or `$` count is 0 (today both); mono digits appear in 0 stat components; the KPI crop at 2x shows one face | S |
| 4 | **Starmap on the tokens.** Flat marks, token type, legible sizing, back controls above the canvas, Back to Planet from a moon | 15, 14, 16 | Body diameter ≥ 24px (selected ≥ 64px) at 1,058 wide; orbit lines ≥ 3:1 against `--bg`; 0 `shadowBlur` in the system view; back controls are `.ui-button--secondary` and at 375 no two controls intersect; acceptance is the Board's own look at a before/after | M |
| 5 | **Logistics folded.** Move on inventory rows and station holdings; shipments and history under Operations; the tab removed | 32, 30, 35 | Nav tabs 13 → 12; moving goods from Assets takes ≤ 3 clicks (today 4 plus scrolling through 27 cards) | S |

### History (read after scoring)

Review #1 (2026-09-25, AB#1757): 2.4 / 5, gates 3 · 2 · 2 · 2 · 3 · 2 · 2 · 3. This review: 3 · 2 · 4 · 3 · 2 · 3
· 3 · 3, **+0.5**, the Deepen rule's minimum. What moved and why, from evidence and not from the old score:
typography +2 (Orbitron and 39 sizes are gone: Inter, 8 sizes, tabular numerals); colour +1 (62 box-shadows
to 10, 10 text-shadows to 0, surfaces from 1.12 to 1.20:1 apart); responsive +1 and motion +1 (the app shell
with a bottom bar, 44px targets, a focus-ring token and reduced-motion blocks now exist). Consistency **−1**:
review #1 saw one old idiom on every screen; now the flat system covers most screens and the seams between it
and what was not converted (the Starmap, the mono stat boxes, the currency glyph) show. Hierarchy and first
impression are flat because the sidebar and page lengths are what they were. Of review #1's five epics, three
landed (flat surfaces, one type system, the shell) and two did not: "data screens as one instrument" (the stat
idiom split is the evidence) and "let the art carry the atmosphere" (Earth is still 14px in the Sol view). A
verdict is a photograph (P-STALE-VERDICT): the bugs review #1 filed (AB#1755, AB#1756) were not re-tested here.

### Charter and Soul risks

Checked: no energy gates, no fake urgency, no inflated baselines, no fabricated social proof, no monetization
surface. Security in proportion: the visual layer touches no data; the developer login shows only with
`ISP_DEV=1`; the Starmap and stat strips render server numbers without user input. Nothing to patch in a spec.

### Blind class

Nobody moved a pointer: hover, active, scroll feel, pan and zoom on the map, motion timing and the starfield's
animation were captured at rest. Headless Chromium at 1x and 2x, not a monitor or a phone. Seeded level-5
accounts, not a player's own corporation, so the walkthrough, the empty first day and Levels 6–30 were not
seen. The tab strips' horizontal scrolling at 375 was not exercised, so "cut" above may be "scrolls". One
reviewer's eye against the ratified rubric; **the Board's own look outranks every score here.**

### Lessons for other products

- A design system that converts screen by screen scores *lower* on consistency in the middle of the conversion
  than at the start, because seams are more visible than a uniform old idiom. Plan the last screens (canvases,
  stat strips, glyphs) before calling the system done.
- A sidebar checklist is a page-length bug on every page. Put progress where the level lives, not beside
  everything.
- Count currency glyphs. One helper, one glyph (T-003, derived not restated).

### Bugs filed

- AB#2498: "¤" on Construction and Facilities cards where every other screen shows "$" (severity 3, fix proposed).
- AB#2499: Starmap at 375 draws "Back To System" and "Back To Cluster" over each other in a body view (severity 3, fix proposed).

Fable 5.1 was used for this review at the Board's request (item 15) under COMMON §4's design-review clause.
