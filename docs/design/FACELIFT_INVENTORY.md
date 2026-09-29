# Facelift inventory (ISP-245, AB#941)

Every screen of the game at 375, 768 and 1280, as of this branch, held against the design system ISP-25 built (tokens,
components, the app shell) and ISP-26 put every v0.5 screen on. It is made by one command, `npm run look:facelift`:
scripts/facelift-sweep.mjs looks at every screen and records what it finds, and scripts/facelift-inventory.mjs
writes this file and the contact sheets from that. Rerun it after a change; v1.0-31 reuses it.

**62 screens**, each at three widths: the pages before play, the shell, every tab, each tab's subpages,
every building the Station opens and a corporation facility. 50 are on the system;
**12 are not**.

Contact sheets (first screenful of each screen), in docs/ab-941/:
- `contact-375.png`: 61 screens at 375px
- `contact-768.png`: 61 screens at 768px
- `contact-1280.png`: 61 screens at 1280px
- `contact-1280-raids.png`: 50 screens at 1280 with raids's records
- `contact-1280-bond-board.png`: 50 screens at 1280 with bond-board's records
- `contact-1280-loan-board.png`: 50 screens at 1280 with loan-board's records
- `contact-1280-stock-exchange.png`: 50 screens at 1280 with stock-exchange's records
- `contact-1280-arbitration.png`: 50 screens at 1280 with arbitration's records
- `contact-1280-patents.png`: 50 screens at 1280 with patents's records
- `contact-1280-concessions.png`: 43 screens at 1280 with concessions's records
- `contact-1280-conglomerate-level.png`: 53 screens at 1280 with conglomerate-level's records

## How each column is decided

- **Added in**: the version of the work item that built the screen (its AB# in the markup or its view's header, and
  that item's version tag). "≤ v0.5" is a screen ISP-26 already put on the system. A "v1.0 subpage" is one the Board's
  review of 2026-09-26 split out (AB#2468 to AB#2474); what is on it may be older, and says so.
- **On the system** is "no" when anything below is seen on the screen at any width, for the base corporation or one of
  the seeds with v0.6 to v0.13 records:
  - **tokens**: a style rule applied on the screen that sets a colour, a shadow, a font size or a font family written
    out instead of a design token (the rule's selector is listed);
  - **components**: a control not built from the system's components: a `<button>` with no `.ui-` component class, an `<input>`
    without `.ui-input`, a `<select>` without `.ui-select`, a `<textarea>` without `.ui-textarea`, a `<table>`
    without `.ui-table`;
  - **inline**: an inline style that sets a colour or a font.
- **Defects**, prefixed by width, are the shared checks (e2e/screenFindings.mjs): sideways scroll, a box off screen,
  words wider than their control, a legacy component, and at 375 text under 14px and a control under 44px.
- **Seen with**: `base` is a busy corporation with a conglomerate and a fleet (seed-industry-account +
  seed-company-station). The others are the seeds of the v0.6 to v0.13 screens, each looked at at 375 and 1280 with its
  records in it.

## What a person looked at, and what that found

The contact sheets were looked at, every screen, at every width, by the Builder that made them (2026-09-29), and the
screens they flag were opened full size. The Board's own look is still owed: the acceptance asks for a human's.
- Every screen has a title with its document code, the shell around it, and nothing outside the system's look at
  thumbnail size; the v0.6 to v0.13 screens (conglomerates, the Fleet, the Development Bank, the Stock Exchange, the
  Council, lobbying, patents) read as the same product as the v0.5 ones.
- **On a phone, every in-game screen starts below three collapsed sidebar panels** (Corporation Identity, Milestones,
  Quick Actions): the screen's own title sits under the header and the panels, a third or more of the way down the
  812px viewport, on all 53 in-game screens.
- **Logistics** scrolls sideways at 375 (169px) and 768 (24px): its in-flight table is wider than the screen.
- **Operations** scrolls sideways at 768 (18px): a row's Open button is past the edge.
- An earlier run's phone shots lost the sticky header in two places (the Conglomerate Affairs Bureau and the Orbital
  Executive Suites at 375); their full-page shots had it at the top, so it was the capture, not the game. The sweep now
  waits for the repaint, and these sheets have the header in place.

Filed from this inventory (2026-09-29), none fixed here:
- Bug #4841: Logistics scrolls sideways at 375 and 768 (the in-flight table).
- Bug #4842: Operations scrolls sideways at 768 (a row's Open button).
- Bug #4843: the Loan Board's selects are .ui-input, not .ui-select.
- Bug #4844: page and header titles use clamp(), not a type token.
- Bug #4845: the prerequisite trees' nodes and the sidebar toggles are buttons outside the components.
- Bug #4846: on a phone every screen starts below the three collapsed sidebar panels.

## Off the system, by group

| Group | Screens | Off the system |
|---|---|---|
| Before play | 8 | 8 |
| Shell | 1 | 1 |
| Company | 16 | 1 |
| Station | 7 | 0 |
| Station building | 9 | 1 |
| Industry | 3 | 1 |
| Market | 7 | 0 |
| Comms | 10 | 0 |
| Map | 1 | 0 |

## Every screen

| Screen | Group | Added in | On the system | Tokens (selectors) | Components | Inline | Defects | Seen with |
|---|---|---|---|---|---|---|---|---|
| page-check-email | Before play | ≤ v0.5 (on the system since ISP-26) | **no** | `h1` |  |  |  | base |
| page-forgot-password | Before play | ≤ v0.5 (on the system since ISP-26) | **no** | `h1` |  |  |  | base |
| page-how-to-start | Before play | ≤ v0.5 (on the system since ISP-26) | **no** | `h1` |  |  |  | base |
| page-landing | Before play | ≤ v0.5 (on the system since ISP-26) | **no** | `h1` |  |  |  | base |
| page-login | Before play | ≤ v0.5 (on the system since ISP-26) | **no** | `h1` |  |  |  | base |
| page-register | Before play | ≤ v0.5 (on the system since ISP-26) | **no** | `h1` |  |  |  | base |
| page-reset-password | Before play | ≤ v0.5 (on the system since ISP-26) | **no** | `h1` |  |  |  | base |
| page-verify-email | Before play | ≤ v0.5 (on the system since ISP-26) | **no** | `h1` |  |  |  | base |
| shell | Shell | v0.5 (ISP-74, ISP-83) | **no** | `h1`<br>`.app-header__title` | `a <button> without .ui-button`<br>at `button.side-panel__toggle` |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| ceo | Company | ≤ v0.5 (on the system since ISP-26) | **no** |  | `a <button> without .ui-button`<br>at `button.prereq-node.prereq-node--available.prereq-node--selected`<br>`button.prereq-node.prereq-node--planned`<br>`button.prereq-node.prereq-node--queued`<br>and 5 more |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| conglomerate | Company | v0.12 (ISP-200) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| conglomerate--hangar | Company | v0.12 (ISP-205) | yes |  |  |  |  | base, conglomerate-level |
| conglomerate--station | Company | v0.12 (ISP-213) | yes |  |  |  |  | base, conglomerate-level |
| conglomerate--treasury | Company | v0.12 (ISP-204) | yes |  |  |  |  | base, conglomerate-level |
| finance | Company | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| finance--daily | Company | v1.0 subpage (AB#2470); statements v0.8 (AB#714), rating v0.9 (ISP-148) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| finance--statements | Company | v1.0 subpage (AB#2470); statements v0.8 (AB#714), rating v0.9 (ISP-148) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| finance--trends | Company | v1.0 subpage (AB#2470); statements v0.8 (AB#714), rating v0.9 (ISP-148) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| inbox | Company | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| inbox--archive | Company | v0.12 (conversations, AB#910) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| inbox--drafts | Company | v0.12 (conversations, AB#910) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| inbox--outbox | Company | v0.12 (conversations, AB#910) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| inbox--trash | Company | v0.12 (conversations, AB#910) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| missions | Company | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| overview | Company | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| fleet | Station | v0.10 (ISP-175) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| operations | Station | v1.0 (AB#2471) | yes |  |  |  | `768: sideways scroll 18px`<br>`768: off screen button.ui-button.ui-button--secondary 718..786` | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| operations--mining | Station | v1.0 (AB#2471) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| station | Station | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| station--construction | Station | v1.0 subpage (AB#2471); the panel v0.6 (ISP-95) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| station--holdings | Station | v1.0 subpage (AB#2471) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| station--offices | Station | v1.0 subpage (AB#2471) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| building-conglomerate-affairs-bureau | Station building | v0.12 (ISP-200) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, conglomerate-level |
| building-corporate-registry-charters | Station building | v0.13 (ISP-237, the patent office) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, conglomerate-level |
| building-deep-space-development-bank | Station building | v0.9 (ISP-151) | **no** |  | `a <select> without .ui-select`<br>at `select.ui-input` |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, conglomerate-level |
| building-earth-assembly | Station building | v0.13 (ISP-240, lobbying) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, conglomerate-level |
| building-galactic-arbitration-council | Station building | v0.13 (ISP-243) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, conglomerate-level |
| building-intergalactic-stock-exchange | Station building | v0.9 (ISP-161) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, conglomerate-level |
| building-interplanetary-trade-commission | Station building | v0.13 (ISP-233, ISP-240) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, conglomerate-level |
| building-isa-claims-leases | Station building | ≤ v0.5 (on the system since ISP-26); concessions v0.13 (ISP-229) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| building-orbital-executive-suites | Station building | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| logistics | Industry | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  | `375: sideways scroll 169px`<br>`375: off screen td 67..544`<br>`375: off screen td.ui-figure 67..544`<br>`375: off screen span.protocol-line 327..544`<br>`768: sideways scroll 24px`<br>and 9 more | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| refinery | Industry | ≤ v0.5 (on the system since ISP-26); Tier 4 v0.11 (ISP-189) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| rnd | Industry | ≤ v0.5 (on the system since ISP-26) | **no** |  | `a <button> without .ui-button`<br>at `button.prereq-node.prereq-node--done.prereq-node--lit`<br>`button.prereq-node.prereq-node--done`<br>`button.prereq-node.prereq-node--available`<br>and 7 more |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| assets | Market | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| assets--infrastructure | Market | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| market | Market | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| market--mercenary-rentals | Market | v1.0 subpage (AB#2472) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| market--my-listings | Market | v1.0 subpage (AB#2472) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| market--player-orders | Market | v1.0 subpage (AB#2472) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| market--trade-history | Market | v1.0 subpage (AB#2472) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| chat | Comms | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| chat--local-alpha-centauri | Comms | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | concessions |
| chat--local-sol | Comms | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, conglomerate-level |
| chat--trade | Comms | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| forums | Comms | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| forums--conglomerates-diplomacy | Comms | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| forums--general | Comms | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| forums--help-guides | Comms | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| forums--mining-industry | Comms | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| forums--trade-exchange | Comms | ≤ v0.5 (on the system since ISP-26) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
| starmap | Map | ≤ v0.5 (on the system since ISP-26); overlays v0.12-v0.13 (ISP-218, ISP-229) | yes |  |  |  |  | base, raids, bond-board, loan-board, stock-exchange, arbitration, patents, concessions, conglomerate-level |
