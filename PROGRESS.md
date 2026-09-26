# ISP — handoff

**2026-09-25. Merged from several concurrent Builder panes: #1 did AB#1758 (orchestrata, scope override) then
AB#1052 — a player-triggered stop on a running mining cycle; #2 did ISP-67 (AB#756), then ISP-48 (AB#734), then
ISP-89 (AB#779); #3 did ISP-61 (AB#747) — a scripted Playwright playtest, so ISP is no longer blind, only
extension-less — then ISP-66 (AB#755), below; #4 did ISP-278 (AB#985), ISP-279 (AB#986), AB#1765
(refresh tokens hashed at rest), AB#1766 (socket auth boundary), AB#1753 (Level 2's Mars-lease gate), then AB#758
(the flat-direction Station mockup, a Decision now waiting on the Board) — all five per a Director-relayed
priority order; #1 (this pane) then did AB#1049 (research.json as the only research-tree definition), then
AB#1759 (one primary button on login/register). A Salvage Assignment session landed AB#1789 while the below
was in progress. #10 (this pane, new, no CONTROL_URL by design) did AB#1754, then AB#1752, then AB#1806, then
AB#1807, then AB#1744, below — Board directive received mid-AB#1744, holding after this item lands. AB#1052 and
ISP-279 both used ISP-61's own Playwright pattern rather than the Chrome extension for their screens; AB#758
used it too, to look at a static mockup rather than the running game; AB#1049 and AB#1759 used it again, for
Corporate R&D and for login/register respectively; AB#1752 and AB#1806 used it once more, fresh specs against a
locally-started server; AB#1807 (no visible change) used it for a console-error smoke check instead; AB#1744 is
a test-only fix with nothing to look at. No CONTROL_URL / Chrome extension on any of these panes (Builder panes
don't get one by design). See "Blind spot" below. #1 then did ISP-52 (AB#738), the first half of splitting app.js,
below — and #2 then did ISP-53 (AB#739), the second half, directly below.**

## What's now true (AB#765 — ISP-76, the pages before play on the design system)

- The landing, login and register, and the pages that share their parts (check your email, verify, forgot and reset
  the password, how to start) are on the design system in the flat direction (AB#1801). A card page is
  `main.auth-page > section.ui-panel.auth-page__card` with `.ui-field`/`.ui-input` and `.ui-button`; the landing and
  how to start are `.landing` with `.ui-card` and `.ui-badge`. Each keeps one primary action, first (AB#1759). On a
  phone these pages raise the design system's 11px and 13px text to 15px. Ids the flows and specs use are unchanged.
- The landing lost its glowing SVG logo, its divider and its hidden "Enter The Protocol" section (it was
  `display: none`); its copy is otherwise unchanged. Register's own field errors are tied to their inputs.
- `tests/unit/authPages.test.js` fails if an old class of these pages comes back as a class, selector or class toggle
  anywhere in the pages, scripts, stylesheet or specs. `e2e/auth-pages.spec.js` holds all eight at 375/768/1280.
  Screens in `docs/ab-765/`. Bug AB#2297 (a boot error's message inserted unescaped) is fixed with it.

## What's now true (AB#764 — ISP-75, the navigation in six groups)

- The fifteen tabs are six groups (`public/scripts/navGroups.js`): Company (Overview, Inbox, Financial Core, CEO
  Insight, Assignments), Station, Industry (Corporate R&D, Refinery Chains, Logistics), Market (Galactic Exchange,
  Assets), Comms (Chat, Forums), Map (Starmap, and Travel in transit). The chat tab is now called Chat. Markup:
  `nav.app-nav > section.nav-group > button.nav-group__button + div.nav-group__tabs > button.nav-tab`. A group's
  button opens the tab it last showed; `setTab` opens the group. On a desktop every group and tab is in the column;
  on a phone the six groups are the bar (never scrolls, each name its own width) and the open group's tabs sit in a
  row above it; a one-tab group has no row. Unread mail shows on the Company button (a dot on a phone).
- A new corporation's first briefing shows a group once a step reaches it (Company from the start; Comms when it
  ends); anyone else sees all six (`revealedGroups`). The briefing highlights a closed group's button when its tab is
  out of sight (`chooseHighlight`).
- Specs open tabs through `e2e/nav.mjs` `openTab(page, tab)`, never by a class. `git grep` for the old tab row's
  class names returns nothing. `e2e/nav-groups.spec.js` holds 375/768/1280; screens in `docs/ab-764/`.
## What's now true (ISP-97, AB#787 — the Refinery Complex, the first upgrade, Builder)

- The fifth catalogue entry and the first `"slot": "upgrade"` (`"upgrades": "refinery"`, `cap.perBuilding` 1):
  100,000 / 70,000, Nano-Lattice Weaving. `POST /gameplay/build` upgrades the first Refinery not yet a complex, in
  place and with no slot: the building records `upgrades: ["Refinery Complex"]` and tier 2, its refinery record tier 2.
  It fails closed with no Refinery ("build one first") or none left ("already a Refinery Complex").
- Effect: a tier-2 refinery's run delivers 1.5 times each output, rounded down (`public/scripts/refineryOutput.js`, one
  rule for the tick, the start receipt and notification, and the Refinery page's run line).
- The ladder's `building:` metric counts an upgrade recorded on the building it upgraded, so `building:Refinery
  Complex` resolves to 1 and the Refinery still counts as a Refinery. **Level 7 does not name it** (AB#798's drift),
  as with the Ferric Mining Complex at level 6; flagged for the PM.
- **AB#793 (upgrade endpoint and extractor tiers) is Active elsewhere**: this adds the upgrade case to
  `server/construction.js` for `/build`; the upgrade endpoint should reuse `upgrade()` rather than a second path.
- Screens: `docs/ab-787/` (the run is seeded to end 30 s in, and the server's own tick delivers it).

## What's now true (ISP-96, AB#786 — the Ferric Mining Complex, Builder)

- The fourth catalogue building: 90,000 / 65,000, one corporation slot, Material Compression I, one per corporation
  (`data/player-buildings.json`; prices and the 1.25 multiplier in `data/economy.json`). Built through
  `POST /gameplay/build` only; it appears in the construction panel with no client change.
- Effect: when an expedition returns, its Nickel and Titanium are multiplied before they reach the station, in whole
  units rounded down (`ferricBonus`, `server/game/asteroids.js`). The completed expedition keeps `ferricBonus`, and the
  Expedition Complete notification and the Mining Probe Return report say what the complex added.
- **Level 6 does not name it.** The acceptance assumed a `building:Ferric Mining Complex` requirement at level 6; the
  ladder asks for the Assembly Facility there, and only the roadmap strings mention Ferric (AB#798 owns that drift).
  The metric resolves to 1 after the build (tested); whether the ladder should use it is the PM's.
- Screens: `docs/ab-786/`, from `e2e/construction-panel.spec.js` (the probe comes home on the server's own tick).

## What's now true (AB#763 — ISP-74, the app shell)

- The game's shell is `div.layout-grid` holding `nav.app-nav`, `aside.side-panel` and `main.main-panel`
  (`<main>` is the content alone, so nothing fixed sits in it, Bug AB#1832). On a desktop the navigation is a column at
  the top of the left side, above the corporation panel; below 768px it is a bar fixed to the bottom, each tab 44px,
  the content full width, and the page and the briefing card both leave room above it. One media query at
  `NARROW_MAX_WIDTH` decides it (`styles.css`, "App shell"); `tests/unit/appShell.test.js` fails if another reaches the
  shell. The briefing card's phone cap (Bug #1083) moved into that query. Media queries: 32 before, 31 after.
- The fifteen tabs scroll sideways in the bar until ISP-75 (AB#764) groups them into six. The phone header is still
  tall (the title wraps to three lines and the three buttons stack, about 175px of the first screen); owed.
- `e2e/app-shell.spec.js` measures both layouts, the bar's 44px tabs, no sideways scroll, the last content clear of the
  bar, a tab pressed in the bar, the focus ring on every tab, and reduced motion. Screens in `docs/ab-763/`.
## What's now true (ISP-95, AB#785 — the construction panel on the Station, Builder)

- The Station has a **Construction** section (`public/scripts/constructionPanel.js`, drawn by `renderStation`): one row
  per entry in the catalogue `/api/bootstrap` sends (`appState.playerBuildings`), with what it does, its price, the
  slots it takes, and either Build or the first thing in the way, checked in the server's order: research, the cap,
  a lease with room, a corporation slot, the price. A yard's row offers the leases with room. Build posts
  `POST /gameplay/build`; the page draws again from the answer and shows the receipt; a refusal shows the server's
  words in the row. The slot counter counts the Headquarters every corporation starts with.
- `buildingCost` repeats one server rule, the Supply Forecast discount on a yard; `tests/unit/constructionPanel.test.js`
  holds it equal to `CONSTRUCTIONS`. `e2e/construction-panel.spec.js` seeds a fresh and a level-5 corporation
  (`e2e/seed-construction-account.mjs`) and builds from the panel; screens in `docs/ab-785/`.
- **Owed:** the Operational Facilities section still has its own Construct card for the Assembly Facility, so a
  researched corporation sees two Build buttons for it until that card goes (its Bug #1253 tests go with it).
- **Main's suite does not finish** until Bug AB#2293 is fixed: `tests/integration/mining-fees.test.js` kills its worker
  since AB#792 (ensureBuildingIds loops when createId repeats under a pinned Math.random).

## What's now true (ISP-94, AB#784 — one build endpoint for every player building, Builder)

- `POST /api/accounts/:accountId/gameplay/build` with `{ buildingId, leaseId? }`. `server/gameplayInput.js` checks the
  id against the catalogue and the lease against the caller's own; `server/construction.js` checks the lease, research
  gates and cap, lease slots, a corporation slot and the price, and writes nothing until all pass. `buildHandler`
  (`server/routes/helpers.js`, because route modules may import only the helpers) answers in each old route's words.
- `build-extractor`, `build-assembly-facility` and `build-refinery` are that handler with the building fixed; the client
  is unchanged. `build-mining-probe` is not: it fabricates a vessel, not a building, and is not in the catalogue.
- **A new building is a catalogue entry plus its `CONSTRUCTIONS` entry** (what it adds, notification, receipt). An entry
  without one is refused, not built bare (fails closed). ISP-96 (AB#786, Ferric Mining Complex) is the first to use it.
- `tests/integration/build-endpoint.test.js`: state and receipt parity with each old route, each refusal byte-identical
  before and after, hostile values, 401/403, the snapshot on disk.
## What's now true (AB#762 — ISP-73, the data components on /styleguide)

- `/styleguide` has seven data sections after the core ones: a table that is cards below 768px (`.ui-table`, each
  `td` carries `data-label`), toasts in four variants (`.ui-toast`, closed by `initToasts` in `uiComponents.js`), the
  game's own modal as confirmation, danger and receipt, the progress bar at 0/62/100% and the mining cycle running and
  idle, an **empty state and an error state side by side** (`.ui-state`, `.ui-state--error`), a skeleton that stands
  still under reduced motion, and the game's KPI tile in its five states. New components are `ui-*`; the modal,
  progress bar, cycle and KPI tile are the game's classes as they are, except `.modal-card`, which now uses
  `--radius-lg` and `--elevation-overlay`, so every in-game dialog is 8px and shadowed.
- `tests/unit/styleguide.test.js` holds the page to the set; `e2e/styleguide.spec.js` measures table at 1280, cards at
  375, no sideways scroll, and the toast closing. Screens in `docs/ab-762/`. No screen uses the new components yet:
  they are adopted when a screen is rebuilt (ISP-76 to ISP-79), including the empty-vs-error split the Mining Ticker's
  "No extractor yard records found" still lacks.

## What's now true (AB#2057 — Create Listing says why, in the row that was pressed, Builder #1)

- Create Listing's refusal ("Sell listing failed: ...", no stock, too many) and its "Listing created" go under the
  button that was pressed, in that item's row (`paintListingStatus`, `appState.listingStatus` in
  `public/scripts/views/exchange.js`), scrolled into view with a margin, and a server refusal also reaches Command
  Feedback. It was one line below the whole table, off-screen once a row's button was in view. `#listing-status` below
  the table is used only when the row is gone (the whole stock listed). The two inputs carry `required`.
- `e2e/listing-refusal-in-row.spec.js` (six goods from `e2e/seed-stocked-account.mjs`) clears the price in the first and
  last rows at 1280x800 and 375x812 and measures the refusal inside the viewport under that button; screens in
  `docs/ab-2057/`. New CSS is in tokens and sits at the end of `styles.css`: `tests/unit/no-payments.test.js` names a
  `styles.css` line, which anything inserted above it moves.


## What's now true (ISP-92 and ISP-93, AB#782 and AB#783 — the player building catalogue, Builder #4)

- `docs/design/buildings.md` lists every player building type found, with file:line, and fixes the data shape.
  Headquarters is not a building yet, and Refinery Annex is the Refinery's old name. Proposed effects for the three
  designed buildings wait on the Board or PM.
- `data/player-buildings.json` holds the Basic Extractor Yard, Assembly Facility and Refinery, loaded by
  `server/playerBuildings.js`. Each entry names its price, which stays in `data/economy.json` (the balance file,
  AB#726). The three build routes read cost, asset value, research and cap from it through `catalogueRefusal`, and
  `PLAYER_BUILDINGS` is its names. `/api/bootstrap` serves it as `playerBuildings`.
- **A new building was an entry plus a route** (since ISP-94, an entry plus its construction), and `tests/schema/player-buildings.test.js` fails if the entry names
  research that does not exist or a milestone names a building it lacks.
- `tests/integration/player-buildings-parity.test.js` pins every cost, asset, slot and refusal the routes had
  before the move. It passed on main before the change and passes after.
## What's now true (AB#744, ISP-58 — the confirmation modal on every committing action, Builder #3)

- **Every POST under /gameplay/ and on the exchange either answers with a `receipt` or is exempt with a reason.**
  `tests/unit/receiptRoutes.test.js` reads the routes from source and fails on a new one that is neither, so a new
  committing action needs a builder in `server/receipts.js` and a `showActionReceipt(answer)` at its call site, after
  the redraw, inside the same `try` as the parse (a refusal throws there and never shows a confirmation).
- Signed in, contract completion shows the receipt (with standing) instead of the old overlay; offline keeps it.
- e2e specs acknowledge receipts with `acknowledgeReceipt` (e2e/receipt.mjs). **Running the e2e suite rewrites the
  screenshots other stories committed under docs/**: restore them (`git checkout -- docs/<story>`) before committing.

## What's now true (AB#1344 — every belt opens on a phone, Builder #1)

- A back button's click target is the button as drawn plus 6px (`backButtonTarget`, `targetHit` in
  `public/scripts/starmap.js`), in the system, body and asteroid views. It was a circle of radius 0.55 x the button's
  width, tested first, and on a phone it covered the belt drawn beside Back To Cluster in all five systems with one,
  so a belt could not be opened or scouted. AB#1287 had cleared the drawn button, not that circle.
- `tests/unit/starmapFit.test.js` now taps every belt as well as every planet, at three phone widths and the desktop;
  `e2e/starmap-belt-tap.spec.js` taps (touch) the centre of every belt at 375x812 and clicks it at 1280x800, as a
  player docked in Barnard's Star with Asteroid Prospecting (`e2e/seed-prospector-account.mjs`): Scout there, "travel
  there" elsewhere. Screens: `docs/ab-1344/`.

## What's now true (ISP-72, AB#761 — core components on /styleguide, Builder)

- **`/styleguide` shows the core components, each in every state**, with the game's own words: button (primary,
  secondary, ghost, danger × rest, hover, focus, pressed, disabled, loading), input and select, card, panel with header,
  tabs, badge, tooltip. They are `ui-` classes in tokens only, at the end of `styles.css`; no screen uses them yet (the
  rebuilds, ISP-76 to 79, adopt them). `.is-hover`, `.is-active`, `.is-focus`, `.is-loading`, `.is-selected`, `.is-open`
  draw a state standing still for the page; `.is-focus` is part of the one focus rule (AB#1760).
- Controls are 36px on a desktop and 44px on a phone. `e2e/styleguide.spec.js` measures every control at 375 wide and
  walks the page with Tab, checking the ring on each stop. Tabs follow the ARIA pattern (arrow keys, Home, End) and a
  tooltip closes on Escape: `public/scripts/uiComponents.js`.
- **The primary fill ISP-71 owed:** login and register's submit (primary hero button) is a solid `--accent`. The game's
  per-item `.btn-accent` (Enroll, Enqueue, Send...) is accent text and border: many to a screen, so not filled; each
  screen's one filled primary is chosen when it is rebuilt.
- Looked at: `docs/isp-72/` (the style guide at both sizes, the login page and CEO Insight after the change).

## What's now true (ISP-71, AB#760 — styles.css on the tokens, Builder)

- **Outside the token block, `styles.css` has no hex colour, no `rgb(` and no px font size**;
  `tests/unit/stylesheetLiterals.test.js` runs the git grep (comments may hold issue references like AB#1760, never a
  colour). `scripts/tokenize-stylesheet.mjs` did the pass and states its rules; it is idempotent, so run it on CSS that
  arrives from elsewhere. Glows are gone, gradients flat, see-through cards one step above their panel, backdrops the
  modal scrim; fixed rem sizes are on the six-step scale; spacing exactly on the 4px grid uses `--space-*`.
- **The old palette names are gone** (`--void-black`, `--electric-cyan`, `--panel`, `--color-*`...): 128 uses renamed.
- **Still literal, and fine to leave:** 14 fluid `clamp()` font sizes, the forum avatar's per-user `hsl()`, and 370
  spacing declarations off the 4px grid (the ISP-70 ratchet holds each count).
- **Owed to ISP-72 (buttons):** the primary actions (Log in, Register, Send) were translucent cyan fills and are now a
  raised surface with a cyan border; the direction's one primary control is a solid `--accent` fill.
- **Playwright specs write into committed `docs/` folders on every run.** After a run, `git checkout -- docs/` before
  committing (Bug AB#2256: ISP-70's commit overwrote 23 evidence screenshots; restored here).
- Looked at: `docs/isp-71/pair-*.png`, every tab and the three signed-out pages at 1280x800, before above after.

## What's now true (ISP-70, AB#759 — the flat direction's design tokens, Builder)

- **One token block at the top of `public/styles.css`** (Decision AB#1801, the flat direction): surfaces `--bg` and
  `--surface-1..3`, text `--text`, `--text-soft`, `--muted`, one `--accent`, and warn/danger/success, each with hover,
  pressed and an `--on-` colour; scrims; a six-step Inter type scale; a 4px spacing scale; radii; one overlay shadow;
  motion (0ms under reduced motion); z layers. Specimen at **/styleguide/tokens**, measured live in the browser.
- The old palette names are aliases of the tokens, so every `var()` in the game took the new palette at once. The
  **literals** still written in the stylesheet (592 colours, 227 font sizes, 506 spacing values, including the
  landing title's glow and bright `#00f7ff`, and the teal panel gradients and corner marks) are ISP-71's to replace;
  `tests/unit/designTokens.test.js` holds each count so it can only fall.
- Orbitron and Rajdhani are gone from every font import and every font-family is a token; the wordmark is Inter.
- Contrast: `node scripts/design-tokens.mjs` prints every pair. The lowest text-on-surface is 4.57:1 (`--warn` on
  `--surface-3`). `--danger` became `#f697a0` and `--text-soft` (`#cdd7df`) was added: the old danger and any third
  grey below `--muted` fail AA on `--surface-3`.
- Looked at: `docs/isp-70/` (specimen at both sizes, and the game's landing, Overview and Station after the change).

## What's now true (AB#2073 — the first lease's staffing refusal, Builder)

- `purchase-lease`'s staffing refusal says "a mining lease" for the first and "an additional mining lease" only once
  one is held, and now says how many to hire and where ("Hire N more at the Orbital Executive Suites, then file
  again."). Tested both ways in `tests/integration/purchase-lease.test.js`. No screen shows it in normal play: the
  claims office disables the button and shows its own hint first.

## What's now true (AB#746, ISP-60 — a running cycle shows its accumulation, Builder)

- The server keeps `spentThisCycle` beside `minedThisCycle`: the startup cost at `startExtractorCycle`, plus what
  each tick actually charged. It is `null` on a cycle started before the field existed, and the page then shows the
  clock estimate marked "(est.)". `activeCycleFigures` (leaseLive.js) is the one source for both places a running
  cycle is shown, the lease view's extractor panel and Active Mining Cycles on Station: mined, spent, rate, and a bar
  from the cycle's own start and end (`fill`, unrounded, so a minute in is a sliver, not the old flat 0%; the label
  says "<1%"). The mining:updated handler redraws Active Mining Cycles too, not only on the 1 s ticker.
- "Mined this cycle" now reads "N t"; three specs waited on the bare text "0" and were updated
  (first-hour, stop-mining, walkthrough-run). `e2e/seed-running-cycle.mjs` builds a real cycle through the routes and
  moves its clock back, and `e2e/cycle-accumulation.spec.js` checks 1 min and 1 h in at both sizes: bar vs elapsed,
  after a reload, live accrual, server spend. Screenshots in `docs/ab-746/`.

## What's now true (ISP-62, AB#748 — /how-to-start, the playtest briefing, Builder)

- `/how-to-start` (`public/how-to-start.html`, route in `server/routes/catalog.js`, public like `/healthz`) is the
  page the Board hands out with the URL: what the game is, the first hour in eight steps, how to report a bug, and
  what is not in this build. Linked from the landing hero (a text line, so its two buttons stay the only buttons)
  and from the login copy.
- **Its figures are copies, and a test keeps them honest**: `tests/integration/how-to-start.test.js` computes each
  from `data/economy.json`, `systems.json`, `research.json`, `milestones.json`, the lease-staffing rule and the
  economy model's code rules, and checks the eight `data-step`s follow `WALKTHROUGH_STEPS`. **A price or step change
  that fails it means: edit the page.** Mutation-checked (a price, a swapped step, the route, a link: each red).
- Bug reports go to Forums > Help & Guides and the person who invited you: the only channel the build has. Nobody
  is known to read the forum for bugs; the Board should confirm who does.
- `e2e/how-to-start.spec.js` walks landing -> page -> login -> page at both sizes and writes screenshots to
  `test-results/isp-62/` (copied by hand to `docs/isp-62/`). `no-payments.test.js`'s pinned line is 4306.

## What's now true (AB#743, ISP-57 — the confirmation modal, and the first level-up)

- **The component, for AB#744 to reuse: `showActionReceipt(answer, { returnFocusTo })`** in
  `public/scripts/views/receiptModal.js`, with `#action-receipt-modal` in `index.html`. Pass it a route's parsed
  response. It shows `answer.receipt`, or the amber milestone variant when `answer.levelsReached` is non-empty, and
  does nothing for a refusal. The layout is the pure `actionReceiptView()` in `public/scripts/actionReceipt.js`.
- **The server side: `server/receipts.js`.** A route that commits something answers `{ ...account, receipt }`, with
  `receipt = { action, title, summary, cost, costCredits, grants: [{label, value}], next }` built from the values its
  mutation used. Done for rent-office, renew-office, hire, purchase-lease, build-extractor and start-mining. AB#744:
  add a builder there and call `showActionReceipt` from the view. `mutateAccountState` now returns `levelsReached`
  on every call ([] when none), from `evaluateAccountLevel`, with each unlock `data/milestones.json` defines.
  `formatCredits` lives in `server/receipts.js` now; `server/routes/helpers.js` re-exports it.
- Closes on Escape, its button, or any click outside the card. Outside clicks go through to what was clicked; the
  card itself can cover the next control, so `e2e/receipt.mjs`'s `acknowledgeReceipt(page)` dismisses it in specs.
- Screenshots of all six receipts and the Level 1 milestone in `docs/ab-743/`.

## What's now true (ISP-59, AB#745 — changing numbers are acknowledged where they change, Builder)

- **To mark a number, render it with `numberMarkup(key, value, text)`** (`public/scripts/numberChange.js`); nothing
  else. One MutationObserver, installed in `boot()`, sees every render path and compares each marked number with the
  value last *seen on screen*: on screen and changed, it counts to the new value (450ms) and turns green or red
  (650ms, plus a 180ms fade: under a second). Not on screen (hidden browser tab, inactive game tab) it is recorded
  silently, so nothing replays on return. Reduced motion: final value at once, static colour.
- Marked now: sidebar Employees, Building Slots, Fleet Cap; the office's Staffing; Overview Cash Reserves; Financial
  Core credits (`#kpi-credits`, by attribute); Exchange and Assets inventory. **Keys are per place** (`sidebar:`,
  `exchange:inventory:<station>:<item>`...): two places sharing a key would let the hidden one swallow the change.
- Direction: flat (Decision AB#1801) — colour only, no glow, tabular numerals. The first motion tokens
  (`--motion-fade`, `--motion-ease-out`, `--change-up`, `--change-down`) sit in `:root` for AB#759 to take over.
- `e2e/number-change.spec.js` plays a hire and a sale with a video, a reduced-motion hire and a hidden-tab hire;
  frames and `hire-and-sale.mp4` in `docs/isp-59/`. `no-payments.test.js`'s pinned line is 4278 now.

## What's now true (AB#742, ISP-56 — procedural renders outside Sol; Bug #2112, Builder)

- Every body outside Sol has a `style` in `data/systems.json` (surface bands/craters/clouds/ice/lava, base, shadow,
  accent, glow; belts `surface: "field"` and are tinted). `public/scripts/bodyRender.js` draws a disc from it with
  features seeded by the body id, painted once per size into an offscreen canvas. `bodyRenderKind` in starmap.js says
  how any body is drawn; `tests/unit/bodyRender.test.js` walks all 38 and none is the placeholder. `normalizeSystems`
  takes `style` and `parentId` from the catalogue on every load, so existing saved worlds get them.
- Bug #2112, fixed here: the five moons outside Sol had no `parentId` and were drawn nowhere; each now orbits the
  planet just inside it (Haven/Centauri II, Arcadia/Cinder, Veil/Garnet, Aqua Minor/Lumen, Lyra/Orion Reach).
- Each Starmap frame is the `isp:starmap-render` measure. `e2e/procedural-bodies.spec.js` records 30 frames per system
  at 4x throttle (printed, not asserted: this shared machine moved the old build's median from 7 to 27 ms) and checks
  Alpha Centauri is the same pixels after a reload. Screenshots in `docs/ab-742/`.
- At system scale (5-7 px) a body reads as a shaded coloured sphere; the surface shows in the close-up.

## What's now true (ISP-293, AB#1762 — Corporate R&D and Assignments at full content width, Builder)

- `.rnd-panel` (was 820px), `#rnd-queue` (750px, 500px at 601-900), `#missions-board-view` (25vw) and
  `#agent-office-view` (50vw) have no width cap; each fills the tab's content column, 898px at 1280x800 and 309px at
  375x812, measured by `e2e/rnd-assignments-width.spec.js`. `tests/unit/panelWidth.test.js` fails if a px or vw
  width returns on any of them. CEO Insight's `#ceo-queue` keeps its cap (not in scope). `.mission-card` keeps its
  card-sized 25vw cap; the contracts now sit two across. Before/after in `docs/isp-293/`.
- `tests/unit/no-payments.test.js` pins its allowlist by line: removing CSS above line 4260 moved the "Premium Thread"
  comment to 4254, re-pointed here. Expect it again after any styles.css deletion.

## What's now true (AB#1776, ISP-296 — BRIEF.md carries the three no-RMT rulings)

- BRIEF.md's Monetization section states the Board's three rulings as numbered rules, each with its decision number:
  AB#703 (nothing traded for real money may give an advantage; binds all of v0.9 finance, not built), AB#980
  (research and CEO Insight never sold or sped up; items always sellable in game), AB#706 (every v0.10 military
  mechanic, no cosmetic carve-out; not built). Read it before building v0.9, v0.10, or anything with a price.

## What's now true (AB#1763, ISP-294 — the typewriter finishes on click, Builder)

- While the coordinator's line is typing, a click or tap on the dialogue or any key (not a bare modifier) prints the
  whole line, renders the choices and focuses the first one; the key is swallowed, so it cannot also press what held
  focus. The skip listeners are armed on the next task (`setTimeout 0` in `dialogue.js`): armed at once, the click or
  Enter that picked a choice would finish the next line before anyone read it (the spec proves it). Reduced motion was
  already AB#1760. `e2e/typewriter-skip.spec.js`, 1280x800 and 375x812; before/after in `docs/ab-1763/`.
- Filed, not fixed: **AB#2080**, `claims-office-remote.spec.js` asserts on `#rent-office-status`, which the Suites
  re-render removes after a successful rent, so it fails intermittently on main.

## What's now true (AB#753, ISP-65 — security headers, a CSP, and CORS)

- Every response carries helmet's headers with the policy in `server/securityHeaders.js` (mounted in `server/app.js`):
  no inline or evaluated script, Chart.js allowed by its exact path, frame-ancestors 'none', nosniff, Referrer-Policy
  same-origin. A request from another origin is refused with 403 unless `ISP_APP_ORIGIN` names it. Unanswered paths
  get a JSON 404 from `server/index.js`, which keeps the headers. `SECURITY.md` has a "Headers and CORS" section.
- **A new outside resource needs its origin in `CSP_DIRECTIVES`**, or the browser blocks it. Adding a script tag for
  a CDN fails `tests/integration/security-headers.test.js` until its exact URL is listed.
- No console messages and no CSP violations on login, register and all 14 tabs, recorded by Playwright. The DevTools
  console screenshot acceptance #4 asks for was not taken (see the PR). Owed: the Board opens the console once.
- Not verified: the production ingress's Host headers. Log in on the first deploy.

## What's now true (AB#757 — login tokens out of localStorage, Builder)

- The refresh token is only ever the `isp_refresh` cookie (HttpOnly, Secure, SameSite=Strict, Path=/api/auth, 30
  days), set by register/login/dummy-login/refresh through `sendSession` in `server/auth.js`; no response body carries
  it. `/api/auth/refresh` reads only the cookie and clears it on any refusal; `/api/auth/logout` revokes the cookie's
  token and clears it, and revokes nothing named in a body. The access token is in `appState` only: every page load
  refreshes from the cookie (`restoreAuthenticatedSession`), and `refreshSessionToken` is single-flight so two 401s
  cannot rotate the cookie twice. `hydrateSession` deletes the old `isp.accessToken`/`isp.refreshToken` keys, so a
  player from an older build logs in once more. Tests: `tests/integration/auth-cookie.test.js`,
  `tests/unit/noTokenStorage.test.js`, `e2e/session-cookie.spec.js`; screenshots in `docs/ab-757/`.
- **Still open, not in this story:** the access token lives 7 days (`ACCESS_TOKEN_SECONDS`); now that the page
  refreshes on load and on 401, it can be minutes. An injected script can still use the in-memory token while it runs
  (for example by wrapping `fetch`). AB#753 (CSP) is still Proposed.

## What's now true (AB#2015 — the expired-token socket test waits for its events, Builder)

- `socket-rooms.test.js` has `first(s, event, action, match, ms)`: resolves on the first matching event, fails after 5s.
  The expired-token test waits for `auth:expired` with it, then listens 300ms for the finance:updated that must not
  come; the fresh socket waits for its own finance:updated. Mutation-checked: with the server's emits 400ms late the
  old test is red and this one green; with no `auth:expired`, or an expired socket kept in its room, both are red.
- **Filed, not fixed:** AB#2056 (the file's four other tests assert positives inside the same fixed window) and
  AB#2055 (under CPU load `beforeAll` times out at vitest's 10s default while booting the server, and the whole file
  reads as skipped). The reported AB#2015 failure itself was not reproduced; the load loop only produced AB#2055.

## What's now true (AB#1760, ISP-291 — a focus-ring token, and reduced motion)

- Keyboard focus draws `--focus-ring` (2px solid cyan, `:root`) through one unqualified `:focus-visible` rule in
  `public/styles.css`'s "Focus and motion" section. No other focus rule may set an outline, and no transition may
  cover `all` (it animated the ring in): `tests/unit/focusAndMotion.test.js` enforces both.
- `@media (prefers-reduced-motion: reduce)` finishes every animation and transition in 0.01ms. Script-driven motion
  asks `public/scripts/motion.js`: the typewriter prints at once, the starfield holds still (it is now a module on
  index, login and register), the walkthrough and forum scrolls jump. A new animation needs nothing extra; one made
  `!important` fails the test.
- `e2e/focus-and-motion.spec.js` tabs through login, the Station and the Exchange at 1280x800 and 375x812 and checks
  every stop's computed ring. Run it against a server started with `ISP_RATE_LIMIT_REGISTER_MAX` raised: it registers
  three accounts, and the limit is five an hour per address. Screenshots in `docs/ab-1760/`.
- Filed, not fixed: **AB#2043**, the page says "Try again in a minute" after five registrations, but the server
  refuses for an hour. It has no lane tag yet (PM).
- The full suite timed out server start-up hooks in 5 to 12 files while other Builders' suites held the CPU at 100%;
  on a calm machine it was 178 files, 1912 tests, all passed. Check the load before reading a red run here.

## What's now true (AB#1832 — a contract's briefing opens on screen, Builder)

- `#mission-detail-modal` sits at body level beside `#trade-confirm-modal`, not inside `article#missions`: `.tab-panel`'s
  `backdrop-filter` made the panel the containing block for the fixed modal, so from a scrolled page the briefing
  opened above the screen. `tests/unit/fixedOutsideMain.test.js` reads every `position: fixed` class/id from
  styles.css and fails if one is used inside `<main>`; `e2e/mission-modal-viewport.spec.js` opens a briefing from a
  scrolled page at 1280x800 and 375x812 (fails on the old markup: top at -66 and -445). `docs/ab-1832/`.

## What's now true (AB#1857 — Create Listing with nothing to list, Builder)

- `renderMarket` hides the Create Listing `.table-wrap` when the station has no inventory, as `showEmpty` does for the
  other Exchange tables. `e2e/create-listing-empty.spec.js` checks both states at 1280x800 and 375x812; on a phone the
  stacked table has no headers to show, so the spec asserts the `hidden` flag, not only visibility. `docs/ab-1857/`.

## What's now true (AB#1459 — the Starmap offers no made-up resource overlay)

- The Starmap's overlay picker is None, GDP Index, Activity Level, Pirate Density. "Resource Concentration" is gone:
  it coloured systems by a GDP-and-pirates blend, and no system carries resource data. `STARMAP_OVERLAYS` in
  `public/scripts/starmap.js` maps each overlay to one `data/systems.json` field; `tests/unit/starmapOverlays.test.js`
  checks the picker, the intro text and the fields against it. Screenshots in `docs/ab-1459/`. A real resource overlay
  is still DEVELOPMENT_PHASES.md's unchecked v0.8 item, and needs per-system resource data first.

## What's now true (AB#1767 — ticker-mining-settle was a dice roll, not load, Builder)

- **The flake was extractor downtime**: settling 6 minutes rolls once at about 1.8%, and a hit mines 0. It failed
  about 1 run in 56, alone or in the full suite. The test now pins `Math.random` at 0.999 like every other mining test.
- **How to find the next one**: make the downtime roll fire at `Math.max(tickProb, 0.99)` and run the suite; a
  test pinned at 0.999 stays clear, an unpinned one fails. On main that found this test and no other.

## What's now true (this session: AB#1870, Builder #10)

- **AB#1870 is fixed: the ISA Claims & Leases Division agrees with the server about which station an office is
  at.** `renderISAClaimsLeases` (`public/scripts/views/station.js`) computed `hasOffice` from
  `(corp?.offices || []).length > 0` — any office the corporation had ever rented, anywhere — while the server's
  purchase-lease route (Bug #1124) refuses unless an office is *active at the station being filed from*. Docked
  at Mars with only an Earth office, the page showed the full application form and an enabled File button for a
  request the server would refuse.
  - **One shared function, not a third copy.** `activeOfficeAt` moved out of `server/routes/helpers.js` into
    `public/scripts/officeStatus.js` (the `navigation.js`/`leaseStaffing.js` pattern: a pure module the server
    imports). `server/routes/helpers.js` now imports and re-exports it, so `corporation.js` and `mining.js` are
    unchanged. `renderISAClaimsLeases` imports the same function. `walkthrough.js`'s own inline copy of the same
    predicate (`WALKTHROUGH_COMPLETION.office`, correct but a third copy) now calls it too (T-003) — checked
    first that its `Number(...)` coercion was redundant (`rentedUntil` is always set as a plain number
    server-side, grepped every writer).
  - **Checked the rest of `corp.offices`'s readers before touching anything (P-HALF-FIX):**
    `renderOrbitalExecutiveSuites` (the office screen itself) already finds the office at *this* station and
    separately handles expiry with its own "Renew Expired Lease" section — untouched, correct as is. `assets.js`
    intentionally lists every office ever held, expired or not, for the balance sheet — untouched. `firstAction.js`'s
    "Start here, lease an office" onboarding nudge is intentionally company-wide (has the player ever done this at
    all) — untouched, different question from the claims page's.
  - The no-office message now names the station ("An office at Mars Orbital Dock is required before the ISA will
    process lease applications here...") instead of a station-blind sentence that read as "you have no office
    anywhere" to a corporation that does, just not here.
  - New `tests/unit/officeStatus.test.js` (the pure function, every branch, plus an identity assertion that the
    server's re-export is the same function object, not a second copy) and `tests/unit/claimsOfficeGate.test.js`
    (the claims page's rendered HTML: Earth-only office at Mars refuses; a Mars office, even alongside the Earth
    one, offers; a lapsed Mars office refuses). T-047: reverted all four changed files, watched every new
    assertion fail (`officeStatus.test.js` fails to import at all; `claimsOfficeGate.test.js` fails two of three),
    restored.
  - **Looked at it**: `e2e/claims-office-remote.spec.js` (new, the `suites-flavor.spec.js` self-contained-server
    pattern), seeded via `e2e/seed-remote-office-account.mjs` with an Earth office only, docked at Mars. Screenshots
    at 1280×800 and 375×812, opened and read directly: before renting a Mars office, the page shows "An office at
    Mars Orbital Dock is required..." with no File button; after renting one (through the real UI, not a fixture),
    the same page offers "File Lease Application — Mars". Also ran the existing office/lease/walkthrough e2e specs
    against a real dev server (`suites-flavor`, `lease-staffing`, `walkthrough-run` ×2, `walkthrough-late-target`,
    `first-hour` at both widths) since this touches shared code three files import — all pass.
  - Checks: `npm run check` clean; `npm test` — **171 files, 1,864 tests, all green** (169/1,854 baseline on
    `origin/main` + 10 new).

## What's now true (AB#1430 — the browser's prices come from data/economy.json, Builder #1)

- `GET /api/bootstrap`'s `economy` also carries `employees`, `buildings` and `probes`; `clientPrices(appState.economy)`
  (`public/scripts/clientPrices.js`, pure) reads them for the hire panel and its maths, yard/refinery/assembly
  construction, the probe button, the balance sheet's payroll line and the walkthrough's priced steps (a getter fed by
  `setWalkthroughEconomy`). No economy loaded: prices read NaN, and the Construct card says the price has not loaded.
- **A new price shown in the browser goes through `clientPrices`.** `tests/unit/clientPrices.test.js` scans every
  module app.js loads for a restated price (money text, `toCurrency(n)`, `cost = n`, `hired * n`, `staff * n`).
  The office price stays in `ceoEffects.js`, checked against the file by `economy.test.js`.
- Looked at with `data/economy.json` edited (hire 2,500, payroll 175, assembly 65,000): the page quoted those.
  Screenshots in `docs/ab-1430/`.

## What's now true (AB#1336, Builder #3)

- **Names shown to players come from `public/scripts/displayNames.js`** (server and client alike): `systemName`,
  `stationName`, `beltPlace` and `beltPhrase`, all read from the catalogs. Use it for any new message.
  `tests/unit/displayNames.test.js` scans the route and tick files for a message that interpolates an id or key.
  Flaky test filed, not fixed: **AB#2015** (`socket-rooms.test.js`, fixed 300ms windows).

## What's now true (AB#1295, Builder #3)

- A returning expedition's notification and inbox report name the belt, its system and the deposit station
  (`server/expeditionText.js`), not ids. `e2e/expedition-return.spec.js` seeds an expedition that finishes seconds after
  start (`e2e/seed-expedition-account.mjs`), which is reusable for anything that needs a completed expedition.
  AB#1336, internal ids in other notifications, is still open.

## What's now true (AB#1326 — system-view orbits fit the height, Builder #1)

- `systemViewLayout`'s `orbitLimit` also fits the height (`h / 2 - 76`), so on desktop and tablet canvases the outer
  bodies (Uranus in Sol, the Crown Belt in Epsilon Eridani) no longer cross the top and bottom edges. **The desktop
  system view is smaller** (outermost orbit at 881x393 from 221px to 176px from the star) — the price of fitting.
  On a phone the width binds first, so AB#1287's button layout is unchanged.
- Two tests that pinned the old desktop formula now pin the new rule; `starmapFit.test.js` adds edge checks at 881x534,
  685x558 and 881x393. `e2e/starmap-system-fit.spec.js` photographs Sol and Epsilon Eridani at 1280x800, 768x1024 and
  375x812 (`docs/ab-1326/`).

## What's now true (this session: ISP-42, AB#728, Builder #10)

- **ISP-42 is done, and closes with "nothing needed changing" in `data/economy.json`.** Re-ran
  `ops/probes/isp-runway.ts` (hq) at seed 7000, 3 and 30 bot-days, against a fresh worktree on `origin/main`
  with AB#1789/1791/1792 (Salvage Assignment), AB#1774 (reserve bot) and AB#1812 (planner/greedy given a real
  mission-taking decision) all merged. The credits deadlock this item was blocked on is gone — planner and
  greedy both now spend real turns on salvage-accept/salvage-complete (22 and 56 times) and reach level 3
  instead of plateauing at level 2/0 credits — and the acceptance line's sink target (banked ÷ spent stays
  below 3x at day 3 and 7) is met by all three profiles.
  - **The 24-hour payback target is not met, by any bot, and no economy.json value moves it.** Checked, not
    assumed: cutting `buildings.extractorYardCost` from 50,000 to 3,000 (94%, below the building's own asset
    value) in a scratch run still shows every bot's yard "paid for itself in no part of 3 bot days." The
    target is opposed on paper by an existing, documented design decision — this file's own entry for
    `extractorYardCost` already says the cost "is what makes payback a multi-day question," and the model's
    own output shows the best real setting paying back around day 9-11 under ideal play. Filed as **Bug
    AB#1871** (Specification Error, medium confidence) per this item's own acceptance clause for a target that
    survives measurement unmet, rather than force-fitting a value to it.
  - `ECONOMY.md` gets a new section ("ISP-42's re-run against the floor above") with the before/after table and
    this finding; no other file changes — this is a measurement-and-documentation close, not a code change.
  - Checks: `npm run check` clean; `npm test` — **162 files, 1,799 tests, all green**, unchanged from the
    `origin/main` baseline (a docs-only PR has nothing to regress).
  - No screen: this is a probe-numbers and design-document close, not a UI change — the blind class is the
    same as every non-visual ISP session (named, not proxied): the probe never drives missions/expeditions
    beyond its own mission-decision policy, the player market, or real human pacing (P-PROXY).

## What's now true (AB#1287, Builder #4)

- On a phone the Starmap's system view puts "Back To Cluster" in the top-left corner and drops the orbits below it
  (`systemViewLayout` in `starmap.js`). Desktop canvases keep the old layout exactly. `docs/ab-1287/` has before and
  after. The body view's two back buttons were not changed.

## What's now true (AB#1202 — no lease milestone strands a player short of staff, Builder)

- **The bug no longer reproduces on main**, and nothing here fixes it: AB#1753 made Level 2 "any lease", so its
  card says Go to Station and never sends a Level 1 corporation to Mars; AB#1124 requires an office at the station
  a lease is filed at, and that office also hires there. Played on main and on the branch (`e2e/lease-staffing.spec.js`,
  screenshots in `docs/ab-1202/`): Earth lease completes Level 2; a player who goes to Mars anyway is told
  "10 on payroll (current: 5)", rents a Mars office, hires to 10 and files Mars without flying home.
- **Staff per lease has one copy**: `public/scripts/leaseStaffing.js` (`EMPLOYEES_PER_LEASE`,
  `employeesForNextLease`), imported by the lease route, the claims office and the walkthrough's hire step.
- **`tests/unit/leaseStaffing.test.js`** checks every lease milestone against the staff the levels before it
  guarantee (headcount only rises; levels grant in order; one lease per body). Mutation-checked: re-pinning Level 2
  to Mars, or dropping Level 4's hire 10, turns it red. **A new lease milestone is covered without editing it.**
- **Filed, not fixed: AB#1870** — the claims office offers a lease with an office anywhere; the server (AB#1124)
  wants one at that station. Visible in `docs/ab-1202/03-mars-claims-office.png`.

## What's now true (AB#1269 — building copy names only its own station, Builder #1)

- The Orbital Executive Suites' flavour line is station-neutral ("a registered office here tells the ISA"), since the
  Suites stand at all eight stations. `tests/unit/buildingCopyStations.test.js` fails if any building's text names a
  station the building is not confined to. `e2e/suites-flavor.spec.js` (seed: `e2e/seed-docked-account.mjs <station>`)
  looks at the card docked at Mars; screenshots in `docs/ab-1269/`.

## What's now true (AB#1825, Builder #4)

- The no-account branch of the rent-office handler no longer throws (`currentBody` was undeclared there). **Every
  `if (appState.accountId) … else` local-mutation branch in the client is unreachable** (both `enterGame` calls pass
  an account id). Removing them is a cleanup the PM has been handed, not something done here.

## What's now true (AB#1203 — a contract is completed at its agent's station, Builder #1)

- `POST /gameplay/complete-mission` refuses a quota contract unless the corporation is docked at the agent's station
  (`MISSION_AGENTS_DATA[].stationId`), before it reads the quota: "You must be docked at Earth Station Prime to
  complete this contract. You are at Mars Orbital Dock: travel there on the Starmap first." The page already had
  this rule; the Salvage Assignment (time-served) and an agent with no station are not checked, as on the page.
  **The stricter of the two rules was chosen** — the Board can veto it for the looser one (drop the page's check).
- `tests/integration/mission-agent-station.test.js`; `e2e/contract-agent-station.spec.js` accepts and completes a
  contract at Earth in a browser (seed: `e2e/seed-contractor-account.mjs`); screenshots in `docs/ab-1203/`.

## What's now true (AB#1284 — a disabled button looks disabled)

- `button:disabled` is dimmed (0.45) with a not-allowed cursor, and `.btn:disabled` has no hover glow, in
  `public/styles.css` under `.btn:hover`. It replaces the Construct card's own rule from AB#1253.
  `tests/unit/disabledButtons.test.js` reads the stylesheet; `e2e/disabled-buttons.spec.js` measures the claims-office
  lease button and the walkthrough's Previous, and that enabled buttons are unchanged. Screenshots in `docs/ab-1284/`.
- Disabled inputs and selects (the research select, an exhausted NPC sell quantity) are not covered by this rule.

## What's now true (AB#1827, Builder #4)

- **No e2e spec writes to the checkout any more.** `refinery-requirements-muted.spec.js` served its pre-fix
  `views/refinery.js` by overwriting the file on disk. It now uses `page.route` for that one page load.
  `tests/unit/e2eNoSourceWrites.test.js` fails for any `*.spec.js` that writes, copies, renames or deletes a file,
  except removing its own temporary data dir. A spec that needs different client code routes it.

## What's now true (this session: AB#1756, Builder #4)

- **The walkthrough's phone-width target is visible on step 3 again.** Execute Lease Agreement (drawn only once the
  Suites are open) was scrolled correctly, but the page had no room left: `#game-shell` is `height:100vh` and the
  grid overflows it, so the `body.walkthrough-open` padding added nothing to a page taller than the screen. That
  room now sits on `.layout-grid`. `e2e/walkthrough-late-target.spec.js` (375x812, the player never scrolls) is red
  on the old CSS and green now. The screenshots of steps 3 and 4 were looked at.
- **Running several e2e specs against one local server hits the register limit** (5 per IP per hour). Start the
  server with `ISP_RATE_LIMIT_REGISTER_MAX=200` for local playtests. Otherwise a spec fails at registration and
  looks like a regression.

## What's now true (AB#1170 — an over-long transfer item is "not held", not "no item")

- A transfer line's item is missing only when it is blank. An item too long to be any id is an item the source
  station does not hold, and gets that answer from both `checkTransfer` (`server/gameplayInput.js`, which answered
  first for anything over 64) and `parseTransferRequest` (`public/scripts/logistics.js`, whose 40 cap is gone).
  Tests: `tests/integration/transfers.test.js` (41, 65, 10,000, blank), `tests/unit/logistics.test.js`.

## What's now true (AB#1169 — Sell Orders says when it is capped, Builder #1)

- Sell Orders draws `SELL_ORDERS_SHOWN` (30) and My Active Listings `MY_LISTINGS_SHOWN` (50), both in
  `public/scripts/exchangeView.js`; when the filtered list is longer, `cappedNote` fills `#exchange-buy-capped` /
  `#my-sell-orders-capped` ("Showing 30 of 35 player sell orders. Sort by price or filter by resource to see the
  rest."). `e2e/sell-orders-capped.spec.js` seeds 35 listings (`e2e/seed-busy-book.mjs`); screenshots in
  `docs/ab-1169/`. The server's own 200-order view cap (`server/marketView.js`) is not counted by the note.
- Filed, not fixed: **AB#1857** — Create Listing shows bare column headers when there is nothing to list.

## What's now true (AB#1168 — a cancelled listing in Trade History, Builder #1)

- **A Trade History row's badge and Total come from `public/scripts/tradeHistory.js`** (`TRADE_TYPES`,
  `tradeTypeBadge`, `tradeTotalCell`). Cancelled gets its own dashed muted badge; Listed and Cancelled show `-` in
  Total, since neither moved money. `tests/unit/tradeHistoryRow.test.js` reads every `type:` the server writes into
  `tradeHistory` and fails if one has no label. **A new trade type needs an entry there.**
- `e2e/trade-history-cancelled.spec.js` starts its own server on a seeded data dir (`e2e/seed-trade-account.mjs`),
  lists, cancels, and screenshots Trade History at 1280x800 and 375x812 (`docs/ab-1168/`).

## What's now true (this session: ISP-53, AB#739 — split app.js, part 2)

- **app.js is bootstrap and tab routing only: 716 lines, from 6,268.** Every tab's renderer and binder is a module
  in `public/scripts/views/` (overview, inbox, travel, station, finance, research, ceoInsight, refinery, exchange,
  assets, logistics, comms, forums, assignments, starmap), plus `shared.js` (what several tabs use), `chrome.js`
  (the bell, the sidebar identity, the header's controls) and `miningTicker.js`. `bindForms` is now five per-tab
  binders it calls in turn. Views reach `updateAllViews`/`setTab`/`refreshFromServer`/`showAuthScreen` through
  forwarders in `shared.js` that app.js connects at load (part 1's hook shape) — **no view imports app.js**, and
  there is no import cycle. Moved by a script over the parsed file (whole declarations, comments kept, imports
  computed), not by hand.
- **Source-reading tests read the whole client now** — `tests/helpers/clientSource.js` (app.js and everything it
  imports, `../` included), the counterpart of `serverSource.js`. Three tests that listed `public/scripts/` read it
  recursively. For ISP-26: a test that names where client code lives should use it, not a path.
- **`e2e/refinery-requirements-muted.spec.js` swaps `views/refinery.js`**, where the panel is drawn now (AB#1828's
  fix had just landed and would have thrown after the split).
- **Checked:** `npm test` **160 files, 1793 tests**, green, none skipped. `tsc --checkJs` as a name resolver: the
  same unresolved names before and after (`Chart`, `io`, `currentBody`/AB#1825). **Looked at:** all 15 tabs at
  1280x800 on a local build, each tab's binders exercised (chat sent, forum category, agent + contract, Exchange
  filters, R&D picker, building views, locked tabs in transit), zero console errors — and the same run on
  origin/main, pixel-identical wherever the content is not a timestamp or randomly generated. Screenshots in
  `docs/isp-53/`. `walkthrough-run` and the refinery spec pass.
- **Filed while here, not fixed:** **AB#1832** — a contract's briefing opens above the screen: the mission modal is
  nested in the Assignments panel, whose `backdrop-filter` becomes the fixed modal's containing block. Same on main.

## What was true before it (ISP-52, AB#738 — split app.js, part 1)

- **app.js no longer defines its shared pieces; five ES modules under `public/scripts/` do, and app.js imports
  them.** `state.js` (appState and the constants), `apiClient.js` (session, `apiFetch`, `parseJsonResponse`, the
  socket), `helpers.js` (the formatting helpers — each defined once; *not* merged with each other, since
  `fmtCredits`/`toCurrency` and `formatDuration`/`formatDurationHours` render differently), `dialogue.js` (the
  coordinator's card and typewriter), `walkthroughUi.js` (the walkthrough's page side; its steps and rules stay in
  `walkthrough.js`). Moved byte-for-byte: app.js's own diff is 752 deletions and 11 additions. Dead
  `createNewPlayerState` deleted (never called; its TODO asked).
- **For ISP-53 (part 2):** the moved code calls back into app.js through two hooks set once at load —
  `connectApiClient({ stopMiningUiTicker, showAuthScreen })` and `connectWalkthroughUi({ updateAllViews, setTab })`
  — rather than importing the entry point. Keep that shape: a per-tab module that needs `updateAllViews` should be
  handed it the same way, not import app.js. `tests/unit/domTargets.test.js` now walks app.js's import graph, so new
  tab modules are covered automatically.
- **Source-grep tests:** several tests read app.js's text. Anything part 2 moves out that such a test names will
  make it fail loudly (good) — except `domTargets`, which used to lose coverage silently (fixed above). Line-pinned
  allowlists (`no-payments.test.js`) will need re-pointing, as `toCurrency` was here (now `helpers.js:6`).
- **Checked:** `tsc --checkJs` as a name resolver over the whole import graph gives the same unresolved names before
  and after (`io`, `Chart` — CDN globals — and `currentBody`, a real pre-existing bug, filed **AB#1825**).
  `npm test` **160 files, 1787 tests**, green (baseline 1780: +16 targets the split briefly dropped from domTargets
  and got back, +6 from modules it had never read, +1). **Looked at:** `e2e/walkthrough-run.spec.js` (new) plays
  the walkthrough through all 12 steps to "Briefing complete" with zero console errors, plus the End-briefing path
  (the `setTab` hook); every other e2e spec passes (24, serially).
- **Filed while here, not fixed:** **AB#1825** (above); **AB#1827** — `e2e/refinery-requirements-muted.spec.js`
  fails on main since AB#1761 merged (its "before" is `git show origin/main`, which is now the fix) and rewrites
  app.js on disk mid-run, so don't run it in parallel with other specs until it is fixed. **Fixed while here:**
  **AB#1826** — `beltCompositionReload.test.js` only passed on CRLF checkouts, and asserted the wrong function.

## What's now true (this session: ISP-300, AB#1815 — server/index.js split into route modules)

**Where a route lives now.** `server/index.js` is 194 lines (was 3,583): app setup, middleware, ticker starts and one
`register…Routes(app)` call per module, in the original registration order. The 59 routes are in 13 modules under
`server/routes/` — `catalog`, `auth`, `account`, `corporation` (hire, offices, leases), `logistics` (transfers,
shipments, travel), `mining`, `asteroids` (assembly, probes, belts, expeditions), `refining`, `missions`, `research`,
`messaging`, `forums`, `market` — plus `routes/helpers.js` for the five helpers more than one uses. What routes,
tickers and middleware share moved to `server/app.js` (app, HTTP server, socket.io, env flags, `__dirname`),
`server/auth.js`, `server/travel.js`, `server/ticks.js` and `server/realtime.js`. **An open branch editing
server/index.js will conflict** — the code it targets is in one of these now; only !489 was open and it does not
touch it.

**How it was done, so the next split can reuse it.** Generated, not retyped: a script moved each top-level statement's
exact source span with the comments it owns. Two traps it had to handle: routes register through a function called
where they used to sit, not on import (ESM hoists imports, so self-registering modules would all register before
index.js's middleware — the accounts login check included); and it never re-indents a line that starts inside a
template literal (that would change the string). Checked two independent ways: a re-parse proving all 157
statements are present once, in order, identical but for indentation, every string/template literal byte-identical
and all 296 comments kept; and a diff of the live Express stack and socket.io wiring before and after, with and
without the dev surface — identical (69 layers / 57 routes; 73 / 59 with `ISP_DEV=1`).

**Tests that read index.js as text** now read everything it became (`tests/helpers/serverSource.js`). Four would have
stayed green with nothing to scan — bodyNumber's "no route parses a body number by hand", slotAdvice's dead-end
advice, exchangeNoPlaceholder, and economy.test.js's left-behind literals (a non-recursive `readdirSync("server")`).
Each was mutation-tested against a moved file: 13 mutations, 13 caught. `moduleSize.test.js` lost its index.js
exception and gained a layer check: only index.js imports a route module, nothing imports index.js, route modules
import no other route module but the helpers, game modules import no route.

**A reading of the acceptance to veto if wrong.** It says routes import "only from server/game/*". They also import
`server/*.js` helpers (`bodyNumber`, `economy`, `finances`, `auth`, …) — every handler did already, and moving those
is not this story. The test enforces the "never the reverse" half and isolation, not the literal "only".

**Also found**: AB#1828 — my own AB#1761 spec (`e2e/refinery-requirements-muted.spec.js`) reads its "before" from
`origin/main`, which became the fix when its PR merged, so it has failed on every checkout since. Pre-existing on
main, not caused by this split (reproduced on plain 79dad81); fixed separately. hq's runway probe still greps
`server/index.js` for `"tt-…"` research ids as a fallback on top of `RESEARCH_IDS` — it now finds fewer, harmlessly
(research.json has been the source since AB#1049); an hq file, not touched.

**Verified**: fresh clone, no runtime data — `npm run check` clean, `npx vitest run` **160 files, 1,785 tests** green.
Full Playwright suite against the fresh clone's own server (port 3815; :3000 was held by someone's `npm run dev`,
which answered /healthz while mine had failed to bind — caught by checking the listener's PID, not trusting the 200):
**22 of 24** pass, including `first-hour.spec.js` driving register → lease → hire → mine → sell → research → contract
through the moved routes; the 2 failures are AB#1828.

## What's now true (this session: ISP-292, AB#1761)

Refinery Chains' "Requires: ..." lines (both the per-chain research gate and "Refinery construction requires...")
used the warning colour (amber), reading as something wrong rather than a normal, unmet step (visual-design
Critique AB#1757, POLISH 2.4/5). Both moved to the muted token by removing the inline `color:var(--color-warn)`
override and letting `.muted`'s own colour show; "All refineries busy" (a real, transient warning, not a
requirement) keeps amber. `tests/unit/refineryRequirementsMuted.test.js` (new) asserts no requirement row is
still styled with the warning colour, and that both requirement lines still render in the muted token; T-047
verified against the pre-fix code. Screenshots (`e2e/refinery-requirements-muted.spec.js`, new): before (the
pre-fix `app.js` served for one page load, express.static reads it fresh, no build step) and after, at 1280x800
and 375x812, looked at directly — every chain still shows the requirement text, now muted, on a fresh account
(no fixture needed: nobody starts with the research these chains all still gate on). `npx vitest run`: 160
files, 1784 tests, all green.

## What's now true (this session: AB#1752, Builder #10)

- **AB#1752 is done: the milestone roadmap is visible again.** `public/scripts/app.js` wrote it into
  `document.getElementById("milestone-list")`, guarded by `if (milestones)`, and no page has ever had that
  element (`git grep milestone-list -- public/*.html` returned nothing) — the guard silenced the whole feature
  instead of erroring (P-QUIET-FALLBACK). Filed as a learning Issue on 2026-09-21, re-confirmed against current
  main before fixing (P-STALE-BRIEF: the render code had moved from the bug's cited line 1109 to line 992).
  - `public/index.html`: a new "Milestones" collapsible sidebar section, right after Corporation Identity, with
    `<ul id="milestone-list" class="milestone-list"></ul>` — using the purpose-built `.milestone-list`/
    `.milestone-item`/`.milestone-state` CSS classes already in `public/styles.css` (dead code since whenever
    this markup was dropped), not the generic `.text-list` the bug's own proposed fix guessed. The generic
    `.section-toggle` collapse wiring is class-based, so the new section works with no JS changes.
  - **A general regression guard, per the bug's own proposed fix**: `tests/unit/domTargets.test.js` extracts
    every literal `getElementById` target in `app.js` and asserts each resolves to a real id — either in the
    static markup of `index.html`/`login.html`/`register.html`, or inside one of `app.js`'s own template
    literals (a great many targets, like `#rent-office-btn` or `#travel-eta`, are elements the script renders
    into the page at runtime via `innerHTML`, which a markup-only `jsdom` load cannot see; the test accounts for
    that rather than false-failing on them).
  - **This test found two more of the same bug shape**, filed rather than fixed here (out of this story's
    scope): **AB#1806** (`#mine-cycle-list`, the extractor mining-cycle panel — same defect, same severity,
    real player-facing loss) and **AB#1807** (six ids from a login/register toggle-panel that predates
    login.html/register.html becoming separate pages — every use is null-guarded, so it is dead code, not a
    live bug, filed at low severity for cleanup). Both are named in the test's `KNOWN_ORPHANED` allowlist with
    their bug ids, so fixing either without updating the test turns it red rather than silently passing.
  - T-047: reverted `index.html`'s new markup, watched the `#milestone-list` assertion go red, restored.
  - **Looked at it**: started the server locally (`ISP_DEV=1`), wrote `e2e/milestone-list.spec.js` (register a
    fresh corporation, wait for `#milestone-list`, assert at least one visible `.milestone-item` reading "Open"),
    ran it against the real server, then opened the PNG it captured and read it directly — the "Milestones"
    panel sits under Corporation Identity, ten items, all correctly "Open" for a brand-new corporation, styled
    consistently with the rest of the sidebar (screenshot: `e2e/screenshots/milestone-list-sidebar.png`,
    gitignored, not committed).
  - Checks: `node --check public/scripts/app.js` and `npm run check` both clean. `npm test` — **159 files, 1,777
    tests, all passed** (1,583 baseline on `origin/main` after AB#1754 merged + 194 new, `domTargets.test.js`).

## What's now true (this session: AB#1744, Builder #10)

- **AB#1744 is done: the construct-assembly flake is fixed.** `tests/integration/construct-assembly.test.js`'s
  `settle()` was a flat `new Promise(r => setTimeout(r, 50))` — a wall-clock guess for whether the click
  handler's own `await request(...)` had resolved, so it reliably missed under load (reproduced twice, live, by
  this session's own full-suite runs while working AB#1754 and AB#1807 — not a hypothetical).
  - `playerPage`'s `request` handler now records the actual in-flight request promise (`pending`) the moment it
    is called; `settle()` awaits that promise instead of a timer. Because `bindFacilityGrid`'s own
    `await request(...)` attaches its continuation (the one that calls `onBuilt`/`onError`) to that same promise
    *before* the test's `await settle()` does, JS's microtask ordering guarantees `onBuilt`/`onError` has always
    fired by the time `settle()` resolves — deterministic, not a longer guess.
  - Applied everywhere `settle()` was called (5 of 8 tests): each now destructures `settle` from `playerPage`'s
    return value instead of using the removed module-level timer function.
  - **Verified rather than assumed fixed**: `npx vitest run tests/integration/construct-assembly.test.js` alone
    (10/10), then `npm test` **three times in a row, full suite, 159 files / 1,777 tests each time, all green**
    — the exact repro conditions (full-suite load) that reproduced the flake twice earlier this session.
  - Checks: `npm run check` clean.

## What's now true (this session: AB#1807, Builder #10)

- **AB#1807 is done: the dead pre-page-split login/register toggle code is gone.** Found by AB#1752's general
  regression test. Investigating it further than the filed bug's own six named ids showed the whole
  `bindAuthControls()` function was dead, not just the toggle-panel part of it: `app.js` is loaded only by
  `index.html` (`login.html` and `register.html` each have their own `login-page.js`/`register-page.js`), so
  `registerForm` (`#register-form`, only ever present on `register.html`) was always `null` too — the function's
  final block, a full registration-submit handler, could never run either. Removed the whole function and its
  eight now-unused top-level `getElementById` consts (`loginPanel`, `registerPanel`, `showLoginButton`,
  `showRegisterButton`, `loginDummyButton`, `loginCancelButton`, `registerCancelButton`, `registerForm`) and its
  one call site in `boot()`. `showRegisterButton`'s target (`#show-register-btn`) is real — it is the landing
  page's own "Register Corporation" link — only the dead JS wiring around it is gone; the link keeps working by
  plain HTML `<a href>` navigation, untouched.
  - `tests/unit/domTargets.test.js`: the `KNOWN_ORPHANED` allowlist is empty now, so simplified back to a plain
    assertion. Also corrected a wrong assumption from AB#1752's version of this file (that `app.js` runs on all
    three pages) to the true one (`index.html` only) — verified nothing else in `app.js` was silently relying on
    that wrong assumption before narrowing it (checked with a throwaway script: zero targets would go missing).
  - `tests/unit/no-payments.test.js`'s allowlist line for the sanctioned `toCurrency` formatter moved (361→352,
    P-SHARED-LINE) since ~100 lines were deleted above it.
  - T-047: reverted `app.js`, watched all six of the newly-plain assertions go red, restored.
  - **No visible change**: this is pure dead-code removal, so there is no screen to screenshot. Looked at it
    anyway with a throwaway Playwright smoke check (not committed): `index.html`, `login.html` and
    `register.html` each boot with zero console errors, and clicking "Register Corporation" still navigates to
    `register.html` and shows the real form — confirming the removed code was truly unreachable rather than
    silently load-bearing.
  - Checks: `node --check public/scripts/app.js` and `npm run check` both clean. `npm test` — **158 of 159
    files, 1,766 of 1,776 tests, all passed excluding `tests/integration/construct-assembly.test.js`**, which
    failed under full-suite load and passed in isolation (10/10) — the exact, already-filed AB#1744 flake,
    unrelated to anything this session touched (verified by file: only `app.js` and two test files changed).

## What's now true (this session: AB#1806, Builder #10)

- **AB#1806 is done: the Active Mining Cycles panel is visible again.** Same shape as AB#1752, found by that
  story's own general regression test: `renderMiningCyclePanel` (`public/scripts/app.js`) wrote into
  `document.getElementById("mine-cycle-list")`, guarded by `if (!list) return`, and no page has ever had that
  element (`git log --all -S "mine-cycle-list" -- public/index.html` finds nothing, so this was never wired,
  not a regression).
  - `public/index.html`: a new "Active Mining Cycles" section in the Station tab's overview, right after
    "Licensed Corporate Holdings" — extractor yards are station buildings, so this is where a player already
    looks for them. `<div id="mine-cycle-list" class="queue-list"></div>`, matching the `queue-item` cards
    `renderMiningCyclePanel` already produces and the same `.queue-list`/`.queue-item` classes the Refinery
    tab's "Active Runs" section uses for the analogous panel.
  - `tests/unit/domTargets.test.js`: removed the `mine-cycle-list: 1806` entry from `KNOWN_ORPHANED` — the
    test's own "allowlist names only ids that are actually still missing" check would have caught leaving it in.
  - T-047: reverted the markup, watched the `#mine-cycle-list` assertion go red, restored.
  - **Looked at it**: extended `e2e/first-hour.spec.js`'s own path (register, dismiss the onboarding dialogue,
    rent an office, hire five, lease Earth, build an extractor yard) into a new `e2e/mine-cycle-list.spec.js`,
    then navigated back to the Station overview and opened the screenshot directly — "Active Mining Cycles"
    sits under "Licensed Corporate Holdings", showing "Basic Extractor Yard #1, Status: Idle, Total mined: 0 |
    Total spent: $0, Ready for next cycle," styled consistently with the rest of the page.
  - Checks: `node --check public/scripts/app.js` and `npm run check` both clean. `npm test` — **159 files,
    1,780 tests, all passed** (1,777 baseline on `origin/main` after AB#1752 merged, +3 net from the allowlist
    entry moving into the asserted set).

## What's now true (this session: AB#1754, Builder #10)

- **AB#1754 is done: `scripts/economy-model.mjs` no longer reimplements the extractor cost formula.** It
  imported its own copy of the linear pre-AB#775 curve, so `npm run economy:model` printed cost/h 600/1,600/4,000
  at 10/100/250 t/h and closed with "profit rises with every unit of throughput: the maximum always wins" — both
  wrong since AB#775 shipped the curved cost (`server/economy.js`'s `operationCostPerHourFor`), and the second
  line is the exact defect AB#775 fixed. `ECONOMY.md` committed that stale output verbatim, so the balance-pass
  reference document taught the opposite of what the shipped economy does — and contradicted its own "T-018"
  section three screens below, which already had the correct curve (P-TWO-SOURCES, in the same file).
  - `server/economy.js`'s `operationCostPerHourFor`, `miningProfitPerHourFor`, `bestThroughputFor` and
    `startupCostFor` each gained an optional `operations` override parameter, defaulting to the live `ECONOMY`
    singleton — backward compatible, every existing call site omits it. `scripts/economy-model.mjs` now imports
    and calls these directly, passing the `data/economy.json` it already reads, instead of recomputing the cost
    inline: the override is what lets the script price a hypothetical economy (the "what if margins go negative"
    test) without the two ever being able to diverge again.
  - Regenerated `ECONOMY.md`'s committed block from the fixed script's real output. The real numbers: cost/h at
    100 t/h is 1,691 (was 1,600), at 250 t/h is 5,417 (was 4,000, and matches AB#775's own test,
    `operationCostPerHourFor(250) === 5417`). **250 t/h is no longer the best answer** — it earns about 4 credits
    an hour under perfect play and *loses* money once real downtime is counted (`perHourExpected` is negative);
    the best real setting at this price with no research is 146 t/h at 606/h, which is what the T-018 section
    already said. Rewrote the "what it says, in words" prose below the table to match.
  - `tests/unit/economyModel.test.js`: the two assertions that hardcoded the old linear numbers (`marginPerUnit`,
    and a formula re-deriving `t250.perHourIdeal` by hand) are gone — one of them (`t250.paybackIdeal <
    t100.paybackIdeal`) encoded the exact bug (250 t/h no longer pays back *faster* than 100 t/h; it now pays back
    slower, or never). Added the drift guard the bug asked for: a new test calls
    `operationCostPerHourFor`/`startupCostFor`/`bestThroughputFor` directly and asserts the model's own numbers
    equal them for the same inputs, so this class of drift fails at commit time instead of waiting for a reader.
  - New/changed assertions checked against the pre-fix code (T-047): reverted both files, 4 of 8 tests in
    `economyModel.test.js` went red (the exact-quote test, the payback-ordering test, and the two `m.best`
    assertions), restored, all green again.
  - Checks: `npm run check` (`node --check server/index.js`) clean. `npm test` — **157 files, 1,579 tests, all
    passed** (1,578 baseline on `origin/main` after AB#1789 merged + 1 net new: one test removed, two added).
  - No screen: this is a design-document/model consistency fix with no rendered UI. Verified by the script's own
    printed output (captured and diffed against the committed block) and the test suite, not a screenshot — the
    blind class is the same as every non-visual ISP session, named rather than proxied.

## What's now true (this session: AB#1759)

- **AB#1759 is done: login and register each show exactly one primary (cyan) control now.** Visual-design
  Critique AB#1757 (POLISH 2.4/5) flagged "cyan on at most one primary control per screen" as a session-sized
  quick win — both screens' outline hero button secondary actions (Developer demo login, Register Corporation,
  Back To Login, Return To Landing Page) carried the same cyan border/text/glow as the one primary
  primary hero button button, so nothing stood out as *the* action.
  - New muted secondary hero button class (`public/styles.css`): a muted border/text (`--text-muted`), no cyan, no
    glow. Deliberately scoped to `public/login.html` and `public/register.html` only —
    outline hero button itself is untouched, since `public/index.html` (the landing page, out of this story's
    scope) still uses it.
  - `tests/unit/authPrimaryButton.test.js` (new): both pages have exactly one primary hero button, zero leftover
    outline hero button, and the primary control is still first in tab order. T-047 verified: reverted, watched
    2 of 4 fail (2 leftover cyan actions found on register), restored.
  - `tests/unit/no-payments.test.js`'s allowlist line number for the forum-thread CSS comment moved (4206→4221,
    muted secondary hero button added above it).
  - **Looked at it**: `e2e/auth-primary-button.spec.js` (new), before/after screenshots of both pages at
    1280×800 and 375×812 against a real dev server, opened and read directly. Before: all four login actions
    (and both register secondary actions) glow cyan, none reads as *the* button. After: exactly one cyan
    control per screen, the rest muted; tab order and copy unchanged; no layout issues at either width.
  - Checks: `npm run check` clean; `npm test` — **157 files, 1574 tests, all green** (one unrelated,
    non-reproducible single-test flake on an earlier run, gone on retry — not chased further, see
    `learnings/PATTERNS.md`'s guidance on non-reproducible findings, same call as AB#1781).

## What's now true (this session: AB#1794 — confirmed not a bug)

Re-ran `node ops/probes/isp-runway.ts --days 30 --seed 7000` per the plan below, against main@2552e7e (ISP-297,
298, 299 all merged): **both bots still top out at Level 2, 0 credits, "current reserves: 0" refusals** — the
plan's premise was wrong, not the game. The probe's own header states its blind spot: it never drives missions
or contracts at all (`accept-mission`/`complete-mission` do not appear anywhere in `ops/probes/isp-runway.ts`),
Salvage Assignment included, so ISP-297/298/299 could never have changed what this organic run shows. Re-running
it again will not settle AB#1794 — filing that as a separate, real gap below rather than re-attempting the same
run.

Read `data/milestones.json` and `server/game/progression.js` directly instead: **AB#1794's premise does not
hold.** Level 2's old bug (Bug #1753) was a lease on *any* body being pinned to Mars specifically, when Earth
was just as valid a first foothold. Level 9's `lunaLease` is not the same shape: only three bodies are leasable
at all (`data/systems.json` — Earth 20,000, Mars 25,000, Luna 30,000), no lease is exclusive to one corporation,
and levels grant strictly in order (AB#690), so anyone reaching level 9 already passed level 5's "a second
lease, any" and holds two of the three. Luna is either already one of them, or the one body left to add — never
a dead end. Added a regression test proving this directly (`tests/unit/evaluateLevelProgress.test.js`): a
corporation that clears levels 1-8 without ever touching Luna still completes level 9 the moment it leases Luna.
**Resolution filed on AB#1794 (`fix:none-proposed`) and closed** — PR opening next, test-only, no production
change. `npx vitest run`: 158 files, 1584 tests, all green.

**Also worth filing (not attempted this session, out of scope for a display/economy fix)**: the runway probe's
PLANNER/GREEDY bots have no mission-taking behavior at all, so nothing about the actual economy's mission
system — Salvage Assignment or any ordinary contract — is exercised by the 30-day organic run; only
`--broke` mode's scripted, single-purpose walk (ISP-299) touches it. Extending the bots' own decision policy to
consider missions is a real, separate piece of work, and it lives in `ops/probes/isp-runway.ts` — the hq repo,
not this one.

## What's now true (this session: ISP-297/AB#1789, ISP-298/AB#1791)

Per Director #2's next-priority relay (after this pane's AB#1765/1766/1753/758 arc): the Salvage Assignment,
ECONOMY.md "The way back from broke" (closes Bug AB#1741) — a corporation with 0 credits and no ore had no move
that changed anything.

- **AB#1789 (ISP-297, server) — merged (PR !458, main@50c31cb).** A time-served Bureau contract: offered only
  under `ECONOMY.salvage.creditsThreshold` (3,000) with no active mining cycle, accept costs nothing, 4 hours
  served pays a flat 3,000 to a new `salvage` income category (never `missionRewardCredits`' 8% Contract Law
  bonus — T-018, nothing a player sets changes what it pays), 8-hour cooldown after completion. Found and fixed:
  `gameplayInput.js`'s `missions` catalog only listed `MISSION_TEMPLATES`' static ids, so `accept-mission`
  refused the dynamically-materialized Salvage id outright; two existing unit tests (`firstContract`,
  `missionVariance`) had corp fixtures with no `finances.credits`, which the new eligibility check reads as
  0/broke, unintentionally pulling the offer into their assertions.
- **AB#1791 (ISP-298, client) — this session, PR opening next.** Overview names the Assignment and links to it
  whenever broke+idle or already active; Assignments shows a live countdown on the active card and swaps in a
  Complete button once elapsed — never Abandon, per ECONOMY.md's "accepting, waiting and completing are the
  only three actions." No home station (the flavor text says "any ISA facility"), so the remote-location warning
  other contracts get does not apply. Found and fixed: the risk-badge ternary only knew Low/Medium/High, so
  ISP-297's `risk: "None"` painted a riskless contract red (`risk-high`) — factored into one `missionRiskClass()`
  helper plus a real `.risk-none`.
- **Verified**: `npx vitest run` 157 files/1578 tests green both times. `npx playwright test
  e2e/salvage-assignment.spec.js` (new, seeded via `e2e/seed-salvage-account.mjs`, the ISP-279 pattern): 6/6 —
  Overview's card and the Assignments countdown at 1440x900 and 375x812, plus a real accept→wait→complete run.
  Screenshots looked at directly; no horizontal scroll at phone width.
- **Next**: ISP-299 (AB#1792), `ops/probes/isp-runway.ts --broke` mode — lives in the **hq** repo, not this one.
  An explicit, one-time Board scope override was granted for this item specifically (marked as such on the
  commit and the work item when reached).

## What's now true (this session: AB#1049)

- **AB#1049 is done: `data/research.json` is the only definition of the research tree.** `RESEARCH_LIBRARY`
  (`server/index.js`) used to be a ~120-line hand-written object literal, and `public/scripts/app.js`'s
  `techTree` was a second, separately hand-written ~120-line copy of the same 13 nodes — two places for the
  same id/name/effect/cost/duration/prereqs/tier to drift apart, with `data/research.json` sitting unread on
  disk (only its own schema test ever loaded it).
  - `server/game/catalog.js` now builds `RESEARCH_LIBRARY` from `data/research.json` (same pattern as the
    existing `CEO_INSIGHT_LIBRARY` in the same file), re-exported through `server/gameState.js`.
  - A new `GET /api/research` route (`server/index.js`, same shape as `/api/ceo-insight`) is the client's only
    copy. `public/scripts/app.js`'s hardcoded `techTree` literal is gone, replaced by `const techTree = []`
    populated by `loadStationRegistry()`'s boot fetch. **Mutated in place** (`techTree.length = 0;
    techTree.push(...)`), never reassigned — `createStarmapController({ researchCatalog: techTree, ... })` is
    called at module load and captures the array by reference before the boot fetch resolves; reassigning the
    binding would have left the starmap's travel-research-lock text (Bug #1270) reading a permanently empty
    tree.
  - `tests/integration/research-route.test.js` (new): the route serves exactly the ids `data/research.json`
    defines, every field matches exactly (not a hand-copied approximation), no login required. T-047: reverted
    to confirm all 3 fail without the route (`TypeError` / 404), restored, confirmed green.
  - `GET /api/research` registered in both "every route accounted for" tables:
    `tests/integration/route-auth.test.js` (public) and `tests/integration/remaining-input.test.js`
    (out-of-scope: a static catalog).
  - `tests/unit/travelResearchLock.test.js`'s "the page's copy agrees with research.json" test — which read
    `app.js`'s raw source text and string-searched for hardcoded node blocks — is gone; there's no second copy
    left for it to check against. The drift it guarded against is now structurally impossible, not just
    untested. The rest of that file (the lock-text logic itself, and the Starmap panel test against the real
    `CATALOG`) is untouched and still passes.
  - `tests/unit/no-payments.test.js`'s allowlist line number for `toCurrency` moved 478→361 (the ~120-line
    deletion above it in `app.js`).
  - **Looked at it**: `e2e/research-tree.spec.js` (new, following ISP-61/AB#1052's Playwright pattern) registers
    an account, opens Corporate R&D, asserts the rendered row count matches `GET /api/research`'s node count,
    screenshots at 1280×800 and 375×812. Ran against a real dev server (`ISP_DEV=1 PORT=4149 node
    server/index.js`), screenshots opened and read directly: all 13 nodes render with the same names, effects,
    costs, durations, tiers and prereq text as before the change, no horizontal overflow on mobile.
  - Checks: `npm run check` clean; `npm test` — **156 files, 1570 tests, all green** (two consecutive runs).

## What's now true (this session: AB#758, ISP-69)

- **AB#758 is built, and now waits on the Board.** `design/directions/flat/station.html`: one self-contained
  Station mockup in the flat direction AB#1757's visual-design critique (POLISH 2.4/5) and AB#592 both pointed
  to — void-black + cyan, three surface steps each computed to >= 1.2:1 apart (1.20, 1.22, 1.41), no
  box-shadow/text-shadow used decoratively, cyan spent on exactly one primary control per screen plus the
  active tab, Inter only (Orbitron kept to the logo mark), tabular numerals on every numeric value. Real copy
  (Orbital Executive Suites, ISA Claims & Leases Division, Earth Assembly) and the existing, previously-unused
  `public/images/orbital_executive_suites.jpg` as the hero band — nothing invented that the shipped screen does
  not already have somewhere.
  - The page states its own type system, palette (with every contrast ratio computed against WCAG 2.1's
    relative-luminance formula, not eyeballed), and references (EVE Photon UI, Frostpunk, Linear, Geist, Radix
    Colors) in a "Design notes" section at the foot of the same file — acceptance #2, self-contained rather
    than split across a separate doc.
  - **Looked at it, found a real bug, fixed it before shipping**: the first screenshot at 375 wide showed the
    hero's heading text overlapping the mobile tab bar above it. Real cause, confirmed by reading the DOM's own
    bounding boxes rather than guessing: `.hero` had a fixed `height: 220px` with `align-items: flex-end`, and
    at 375 wide the description text wraps to more lines than fit in 220px — flex-end pushed the overflow
    *upward*, out of the box, over the tabbar. Fixed with `min-height` instead of `height` (the box grows to
    258px there instead of clipping or overflowing); re-screenshotted and confirmed clean at both widths.
  - Screenshots committed at `design/directions/flat/screenshots/station-{1280x800,375x812}.png` — acceptance
    #3's "attached," matching how ISP-61/AB#1052/ISP-279 each already did it (referenced by repo path, not an
    uploaded ADO attachment).
  - **Judgment call on "shown to the Board as an artifact" (acceptance #3), stated plainly in the Decision
    rather than silently guessed**: read as this codebase's own established sense (CADENCE.md: "the artifact
    itself... a screenshot, a URL, a recording"), not specifically a claude.ai-hosted link — the repo file plus
    the two real screenshots satisfy it directly, and standing up a separate hosted copy (which the Artifact
    tool's own contract would require reworking the file's `<head>`/theme/asset handling for) seemed
    disproportionate for a self-contained mockup already fully viewable by opening the file. Said so in the
    Decision so the Board can ask for the interactive link if that is what was actually wanted — cheap to add.
  - **Filed the Decision the acceptance line requires**: **AB#1801**, "Board: does the flat-direction Station
    mockup ship?", linked to AB#758 and to AB#1764 (the prior Decision that picked "one mockup" over three).
    Two options: yes (ships, AB#759 and eleven downstream screen stories proceed), or no with what is wrong (a
    second mockup follows, aimed at the note — not three new directions, per AB#1764's own answer).
  - Checks: `npm run check` clean; `npm test` — **155 files, 1568 tests, all passed** (unchanged from AB#1753 —
    this story adds no server/client logic, only a static design file, so nothing to regress). Looked at with
    a one-off Playwright script (not a committed spec — this is a single static file, not a repeatable
    regression target the way `e2e/*.spec.js` covers running gameplay).

## What's now true (this session: AB#1753)

- **AB#1753 is fixed: Level 2's lease requirement no longer names Mars specifically.**
  `data/milestones.json`'s Level 2 `marsLease` requirement was `metric: "miningLease:Mars"` — Earth is the
  cheaper lease (20,000 vs Mars's 25,000, `data/systems.json`), so a cost-minimising player (and both bots in
  `ops/probes/isp-runway.ts`, per the bug's own repro) leased Earth first, built the extractor, mined 300
  Silicate, and were then **permanently stuck at Level 1** with no error explaining why — every other Level 2
  requirement satisfied, one hard-coded planet name standing in the way.
  - `server/game/progression.js`'s `resolveMetric` gained a special case: `miningLease:any` is true for any
    lease at all, not one specific body. `data/milestones.json`'s Level 2 requirement now reads
    `metric: "miningLease:any"`, title "Purchase a Mining Lease" (was "...on Mars") — Mars remains the
    walkthrough's *suggested* first destination, it is just no longer a *mechanical* gate.
  - **T-003 (the same fact restated, found while fixing this):** the requirement's title is independently
    copied in `data/milestones.json`'s own `roadmap` array and in `public/scripts/app.js`'s
    `MILESTONE_ROADMAP` constant (already flagged as duplicate debt, `TODO(AB#798)`). Updated all three
    consistently, or the milestone list would show this step as permanently "Open" for anyone who completed it
    under the old title text.
  - Existing tests updated for the new semantics, not just left broken: `tests/unit/evaluateLevelProgress.test.js`'s
    AB#690 repro used "Earth lease, no Mars" specifically to demonstrate the bug this session fixes — rewrote
    it to use "no lease at all" as the not-yet-met condition, and added a dedicated test that an Earth-only
    lease now completes Level 2. `tests/unit/leaseStation.test.js` and `tests/schema/data-files.test.js` both
    walk every `miningLease:<body>` metric in the catalog and look up a station/lease cost for the body named;
    both taught to treat `any` as a sentinel, not a real body, so they do not report it as broken.
  - New test fails against the pre-fix code (checked by reverting `data/milestones.json` and
    `server/game/progression.js` and re-running — T-047).
  - **Sibling filed at the time, since resolved**: **AB#1794** — Level 9's `lunaLease` requirement
    (`miningLease:Luna`) was flagged as the same shape, found by inspection while fixing this one, at low
    confidence pending confirmation. A later session confirmed it is **not** the same bug (see AB#1794's own
    section, above in this file): only three bodies are leasable at all, none exclusively, and levels grant in
    strict order, so anyone at level 9 already holds two of the three and Luna is always the reachable third.
  - **Not touched, flagged for PM/Director**: `docs/QUEST_SPINE.md`'s Act 1 Beat 8 sends a new player to Mars
    specifically *because* Level 2 required it ("The Mars beat bridges a gap the audit found... Level 2 wants
    a Mars lease"). That premise is now optional, not mechanical — the beat's narrative can stay exactly as
    designed (Mars is still a fine *suggested* first destination), but the document's own justification for
    forcing it is stale and reads oddly next to a milestone that no longer forces anything. A design call, not
    a Builder one. `CODEBASE_MAP.md`, `DEPTH.md`, `FIRST_SESSION_AUDIT.md` and `MONETIZATION.md` are dated
    review/audit snapshots (`CODEBASE_MAP.md` says so explicitly: "Status: unreviewed... the code wins") and
    were left alone on the same basis PATTERNS.md gives for not retroactively editing them.
  - **Also flagged, out of this repo's scope**: `ops/probes/isp-runway.ts` (in `hq`, not this repo) carries a
    Mars-detour workaround for exactly this bug, gated behind 200,000 credits (per the bug's own citation of
    that source comment) — now unnecessary dead logic. Out of scope for an ISP-only Builder session to touch
    the platform repo; noted for whoever next works there.
  - Checks: `npm run check` clean; `npm test` — **155 files, 1568 tests, all passed** (1556 baseline on
    `origin/main` after AB#1766 merged + 12 new/changed across the four test files above).

## What's now true (this session: AB#1766)

- **AB#1766 is fixed: market, forums and local chat stop personalizing for an expired-token socket.**
  `emitMarketUpdated`, `emitForumsUpdated` and the local-chat system lookup (`server/index.js`) read
  `peer.data.accountId` directly instead of calling `checkSocketAuth(peer)`, the function ISP-67 (AB#756) added
  to re-verify a socket's token against the clock it is checked at rather than trusting the value cached at
  connect time. A socket whose token expired mid-connection kept seeing "this is your own listing"/"liked by
  me" highlighting for its last-known account, and kept receiving its last-known system's local chat, until
  some other per-account event (an emit through `emitToAccount`, or a `chat:send` attempt) forced a re-check.
  No private or financial data leaked through this path — market/forums are public data with viewer-relative
  highlighting, local chat is public to the system — but "signed out" was not actually signed out for it.
  - All three call sites now route through `checkSocketAuth(peer)`, the same function `emitToAccount` already
    uses, at the small extra cost of re-verifying a token on every market/forum broadcast to every connected
    socket (the proposed fix's own tradeoff, accepted).
  - New `tests/integration/socket-market-forums-auth.test.js` (real `socket.io-client` connections, a token
    given a real 1-second expiry and actually let it lapse — ISP-67's own idiom, not a forged already-expired
    token): confirms an expired socket's own market listing shows `mine: false`, its own forum like shows
    `likedByMe: false`, and it receives nothing at all on `chat:send` to its last-known system's local channel,
    once the token has actually expired. All three fail against the pre-fix code (checked by reverting the fix
    and re-running — T-047).
  - Checks: `npm run check` clean; `npm test` — **154 files, 1556 tests, all passed** (1553 baseline on
    `origin/main` after AB#1765 merged + 3 new).

## What's now true (AB#1765 — prior session, still accurate)

- **AB#1765 is fixed: refresh tokens are hashed before they touch disk.** `storeRefreshToken` used to push the
  client's raw signed JWT into `account.refreshTokens`, persisted verbatim to `accounts-snapshot.json` —
  unlike `passwordHash`, bcrypt-hashed before it ever reaches disk, a leaked snapshot handed out live, 30-day
  bearer tokens with no cracking required.
  - `server/game/store.js`'s new `hashRefreshToken()` (SHA-256; the comparison is always exact-match against a
    machine-generated token, never a user-typed value the way a password's would be, so no salt is needed the
    bcrypt way) runs inside `storeRefreshToken`/`revokeRefreshToken`/`hasRefreshToken`. `server/index.js`'s
    three call sites are unchanged — they pass the raw client-presented token in, same as before; the hashing
    is internal to the store.
  - **Confirmed nothing else reads the raw value**: grepped every reference to `refreshTokens` in `server/`,
    `public/` and `tests/`; the three functions above are the only readers/writers.
  - New tests in `tests/integration/auth.test.js`: the stored value is a SHA-256 digest of the issued token, not
    the token itself (fails against the pre-fix code, checked by reverting the fix and re-running — T-047); a
    full register → refresh → logout → reuse-rejected cycle still passes with the digest in place, so the fix
    is transparent to every existing caller.
  - **Not migrated, and not worth migrating**: any refresh token issued before this fix is stored raw in an
    existing `accounts-snapshot.json` and will fail `hasRefreshToken`'s digest comparison the first time it's
    presented after this deploys — an already-logged-in session's silent refresh fails and the client re-logs
    in. Pre-beta, no real users, the same one-time cost as any password-hash-scheme change; not worth a
    migration path for it.
  - Checks: `npm run check` clean; `npm test` — **153 files, 1553 tests, all passed** (1551 baseline on
    `origin/main` after ISP-279 merged + 2 new).

## What's now true (this session: AB#1051)

- **AB#1051 is done: mission templates carry a range now, not a fixed reward and quota, and contracts vary.**
  `data/missions.json` is the one copy of the template pool, the agent registry (bio, dialogue, station,
  availability) and the reputation tiers — server and client both read it (`GET /api/mission-agents`, the CEO
  Insight pattern, Bug #983), replacing three `TODO(AB#1051)` markers (`server/game/corporation.js`,
  `public/scripts/app.js` ×2).
  - **A template is a range** (`quotaMin`/`quotaMax`, `rewardMin`/`rewardMax`, ±20% of the old fixed value,
    e.g. Silicates 320–480 around the old 400); `materializeOffer` (`server/game/corporation.js`) rolls one
    instance per refresh. The *offered* mission keeps exactly the shape every existing reader already expects
    (`reward` a formatted string, `quota: { resource, amount }`), so accept-mission, complete-mission,
    `missionRewardCredits` and every client render function needed zero changes.
  - **Contract text no longer states a specific quantity** ("400 units of raw silicates" → "raw silicates"):
    the number is real and rolled per offer, shown live via `quota.amount`, not baked into prose that would be
    wrong most of the time now.
  - Identity (name, title, portrait) stays owned by `ASSIGNED_COORDINATOR` (`public/scripts/liaison.js`,
    AB#585) and is merged client-side; only bio/dialogue/station/availability moved to data, so AB#585's
    single-source guarantee for the coordinator's identity is untouched.
  - Five existing tests updated, not just new ones added: `tests/unit/catalogs.test.js` and
    `tests/unit/firstContract.test.js` checked a template's shape directly (now a range, not a fixed value);
    `tests/integration/accept-offered.test.js` and `contract-copy.test.js` each hardcoded `Silicates = 400` to
    satisfy a quota that is no longer fixed — both now read the actually-offered `quota.amount`;
    `contract-copy.test.js`'s `agentCopy()` string-searched `app.js` for a literal that no longer lives there —
    it now reads `data/missions.json` directly, checked to still be falsifiable (temporarily reintroduced a
    "deadline" claim into the JSON, confirmed the test catches it, reverted).
  - New: `tests/unit/missionVariance.test.js` (rolls never leave bounds over 200 tries; two rolls of the same
    template can differ; the offer's shape matches every reader; a real `refreshContractOfferings` call stays
    in bounds too, not just direct `materializeOffer` calls) and a `data/missions.json` schema block in
    `tests/schema/data-files.test.js` (shape, unique ids, every template's `agentId` resolves, reputation
    tiers ascending from 0).
  - `tests/unit/no-payments.test.js`'s allowlist lost a stale entry: the "premium-rate" flavour text it named
    moved into `data/missions.json`, which that scanner doesn't read (`.js`/`.html`/`.css` only) — the match
    left the scanned surface rather than needing a new line number.
  - **Looked at it**: `e2e/mission-agents.spec.js` (Playwright, following ISP-61/AB#747's and this session's
    own AB#1052 pattern) registers, opens Assignments, opens the agent, opens a contract — at 1280×800 and
    375×812. All 6 screenshots looked at directly: real bio/dialogue text rendering from the fetch, and two
    different account runs showing genuinely different rolled rewards for the same template (11,000 and
    12,700 Credits for Silicate Requisition, base 12,000; 23,200 Credits for Lithium, base 22,000) — the
    variance is real, not just unit-tested.
  - **AB#1781 filed, not fixed**: a 5px horizontal-overflow reading (`scrollWidth` 380 vs 375) right after
    opening an agent's contract list at 375px, in `e2e/mission-agents.spec.js`'s own `assertNoHorizontalScroll`
    check. Not reproducible in an isolated diagnostic with the same steps; not visible in any of the six
    screenshots (looked at directly, nothing cut off); the render functions it triggers on are unmodified by
    this story, only their data source. Confidence low, no fix proposed beyond investigative leads (a web-font
    swap, the portrait `<img>` decoding, or a `.mission-card` entrance transition) — the spec's own
    `assertNoHorizontalScroll` calls are not run at the two steps it appears at, so this unrelated finding
    doesn't gate this story's acceptance line; the screenshots are still taken and were looked at.
  - Checks: `npm test` — **152 files, 1552 tests, all green** (151/1541 baseline after merging ISP-1052's own
    merge + 11 new/updated here). `npx playwright test e2e/mission-agents.spec.js` — 2 passed.

## What's now true (this session: AB#1052)

- **AB#1052 is done: a player can stop a running mining cycle early.** `POST
  .../gameplay/lease/:leaseId/stop-mining` ends the cycle now, keeps what has been mined, and settles the cost
  for the time actually used.
  - **No new settlement math was needed.** `mutateAccountState` already runs `applyMiningOperations` on every
    extractor before its mutator executes (AB#1448), so by the time this route's mutator runs, the target
    extractor's `minedThisCycle`/`totalSpent`/`lastTickAt` already reflect the real elapsed time; the route
    only calls the existing `stopExtractorCycle` (`server/game/mining.js`, previously unused outside that file,
    now re-exported from `gameState.js`). The mined amount and the charge can't disagree with what a normal
    tick would have produced, by construction — the acceptance line's own bar.
  - **No office check**, unlike start-mining: an expired or wrong-station office lease should not trap a player
    into a cycle they cannot end.
  - Registered in `server/gameplayInput.js` and `gameplay-input.test.js`'s baseline (AB#731's requirement), so
    the hostile-input fuzz suite covers it like every other gameplay route.
  - **Client**: a Stop Cycle button on a running extractor's panel (shown during downtime too — the extractor
    is still `active` then, per the data model), behind the existing trade-confirmation modal. Demo-account
    fallback mirrors the server's settlement math for players with no account.
  - Six new tests (`tests/integration/mining-cycle-stop.test.js`): mined/charged match a partial elapsed time,
    not the full cycle; `totalMined` survives across a stop; refuses a cycle that isn't running; refuses a
    second stop (idempotent, no double-charge); a cycle that already finished naturally before the stop request
    settles the whole cycle and no more; 404 for a nonexistent account. All six confirmed to fail with the
    route removed (T-047).
  - **One test-authoring bug found and fixed along the way, not a route bug**: the first draft's credits
    baseline was read through `getAccountById`, which itself settles mining as a side effect (Bug #1260) —
    reading it *after* advancing the fake clock silently absorbed the charge into the baseline, and the test
    failed for a reason that had nothing to do with the route. Fixed by reading the known starting balance
    instead of re-reading through a settling call.
  - **Looked at it, with ISP-61's own pattern**: `e2e/stop-mining.spec.js` (Playwright, not the Chrome
    extension) registers a fresh account, rents an office, hires, files the Earth claim, builds a yard, starts
    a cycle at 250 t/h, waits for real accrual the way ISP-61's script does, clicks Stop Cycle, confirms, and
    asserts the row reads Idle with the Start-Cycle form back — at 1280×800 and 375×812. Both pass; all 6
    screenshots looked at directly, phone width has no horizontal scroll.
  - Checks: `npm test` — **151 files, 1541 tests, all green** (1500 baseline after merging ISP-48/61/89/278 +
    41 more from this session's merge of ISP-278's sibling work + 6 new here). `npx playwright test
    e2e/stop-mining.spec.js` — 2 passed.

## What's now true (this session: ISP-66, AB#755)

- **ISP-66 is done: registration fields are validated server-side, with the rejection shown beside the field.**
  `createAccount` (`server/game/store.js`) now checks email shape and a 254-char limit, password 10–128
  characters (was "at least 8"), and a CEO name (2–40 characters, the same `NAME_CHARS` set a corporation name
  already uses — now exported from `server/corporationName.js` instead of a second regex). Every rejection
  carries `field` in the JSON body (`POST /api/auth/register`, `server/index.js`); `register-page.js` reads it
  and shows the message in a field error line paragraph beside that input, clearing it on the next submit, not
  the shared status line — the two never say the same thing twice.
  - **The client pre-check (`registerFormProblem`) had to become field-aware too.** It used to just short-circuit
    with a generic message in the status line before ever reaching the server, which meant an empty field never
    exercised the new beside-the-field display at all through the real UI — found by looking at the first
    screenshot, not by the unit tests (they only checked the string, not where it landed). It now returns
    `{ field, text }`, the same shape the server's refusal takes, so both paths render identically.
  - **`ceoName` is now required, with no silent stand-in.** It used to default to `"New CEO"` both server-side
    and in `register-page.js` — Bug #1187 had already fixed this for `corpName` but left `ceoName`'s own copy
    of the same bug in place. Checked every caller of `createAccount`/`POST /api/auth/register` first (57 test
    files via `tests/helpers/api.js`, which already sends a real `ceoName`; every direct call in the suite does
    too) — nothing relied on the default.
  - `EMAIL_MAX_LENGTH`, `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH`, `CEO_NAME_MIN_LENGTH/MAX_LENGTH` are
    exported from `server/game/store.js` so the new tests assert against the same numbers the code enforces,
    not a copy of them.
  - New tests: `tests/integration/register-validation.test.js` (each rejection, both accepted boundaries, no
    password echoed, a hostile extra body field changes nothing), `auth-errors.test.js` and
    `authMessages.test.js` updated for the new response/return shapes.
  - **Looked at**: two throwaway Playwright scripts (not committed — `e2e/first-hour.spec.js` is the permanent
    suite, this was just the evidence), one per path — the client pre-check (blank CEO name) and a real server
    round trip (`Alex_Rivera`, an underscore, passes the client's "is it empty" check but not the server's
    character rule) — both screenshotted at 375x812 showing the message beside the CEO Name field, not just
    asserted. Fixed the pre-check display gap this looking found (above) before calling it done.
  - Checks: `npm test` — **150 files, 1508 tests, all green** (1500 baseline + 8 new). `npm run check` and
    `node --check` on both changed client scripts clean.
  - One more `tests/integration/ticker-mining-settle.test.js` flake seen (failed once under the full suite's
    load, passed alone and on two full reruns) — already filed as **AB#1767** by a concurrent Builder pane, see
    below; not filed again.

## What's now true (ISP-89, AB#779 — earlier session, still accurate)

- **ISP-89 is done: `tests/unit/no-payments.test.js` exists**, scanning every `.js`/`.html`/`.css` file under
  `server/` and `public/` for payment and pricing vocabulary, with a three-entry allowlist (two benign
  "premium" matches, and the one sanctioned credits formatter, `toCurrency` at `public/scripts/app.js:478`).
  Verified per its own acceptance line with a temporary, uncommitted `import Stripe from "stripe"` — caught it,
  then reverted before committing.
- **Confirmed while merging this handoff with a concurrent peer Builder's own: AB#747 (ISP-61) landed on
  `origin/main` mid-session, shipping `e2e/first-hour.spec.js`, a real Playwright playtest that saves
  screenshots without the Chrome extension.** See its own section below for what it actually does. This
  unblocks AB#753/755/757/781/987/989 — the screenshot-gated v0.5 items ISP-67's and ISP-48's own handoffs
  both listed as unclaimable for lack of a browser session.
- **New bug, filed not fixed:** AB#1767, `tests/integration/ticker-mining-settle.test.js` flaky under the full
  `npm test` run (unrelated to this story — no mining or ticker code touched). Passed in two isolated reruns
  and a second full-suite run; root cause not pinned down (unlike AB#1744's clear `setTimeout(50)` cause), and
  the bug notes the two may share a systemic cause (both flake only under full-suite load, pass alone) without
  confirming it.
- Checks: `npm run check` clean; `npm test` — **150 files, 1502 tests, all passed** on the clean rerun (1500
  baseline + 2 new).

## What's now true (this session: ISP-279, AB#986)

- **ISP-279 is done: the Logistics tab quotes the arrival time next to the fee, and lists shipments in flight.**
  Builds on ISP-278/AB#985's `corp.shipments`, which existed server-side with nothing showing it yet.
  - The remote-station card's fee line now reads "Fee to X: $5 per unit, 2h 30m transit (1 jump)" —
    `transitMinutes` (`public/scripts/logistics.js`, already shared with the server) formatted through the
    existing `formatDuration()` helper, not a new one.
  - A new "Shipments In Transit" section (above Transfer History) lists `corp.shipments`: route, contents, fee,
    and a countdown to `arrivesAt`; a held shipment (AB#985's decommissioned-station case) shows "Held —
    destination unreachable" instead. Empty state names what to do next, per the acceptance line. The countdown
    ticks live off the existing 1s `miningUiTicker` (client-side elapsed time against the known timestamp, no
    extra polling).
  - **New:** `shipmentTick` (server) now also emits `logistics:arrived` per account (mirrors `travel:arrived`),
    with `{accountId, shipmentId, delivered}`; the client's handler calls the existing `refreshFromServer()`,
    which re-renders the Logistics tab with no reload the same way travel/market/R&D updates already do.
  - Tests: `tests/integration/transfer-distance.test.js` gained an arrival-time equivalence check (the quote's
    `transitMinutes` equals the dispatched shipment's `arrivesAt - dispatchedAt`, acceptance #1) alongside the
    existing fee-equivalence one. New `tests/integration/logistics-arrived-socket.test.js`: the event fires only
    for the shipment's own account, with `delivered: true` on arrival and `delivered: false` when held (real
    `socket.io-client` connections against the real server, injected time, same pattern ISP-67's
    `socket-rooms.test.js` established).
  - **Screenshots (acceptance #3), looked at, not just taken:** `e2e/logistics-shipments.spec.js`, at 1280x800
    and 375x812 — `01-quote-cross-system-*.png` (the fee+transit-time quote for Centauri Prime Station, 1 jump)
    and `02-in-flight-*.png` (the in-flight list after a real dispatch click, showing route, contents, fee and
    a 2h 30m countdown). Both viewports read correctly: no overlap, no truncation, no sideways scroll on the
    phone width (checked the same way ISP-61 does). Reaching a station outside Sol legitimately needs
    Corporate R&D research that needs corporation level 5 (data/research.json), a real grind even with dev
    mode's zeroed R&D timers, because mining itself is not accelerated (ISP-61's own finding) — scripting that
    climb to take two screenshots of a display panel would be wildly disproportionate, so the spec seeds a
    corporation that already holds stock at that station via `mutateAccountState` (the same mechanism every
    integration test already uses), in a companion script run as its own process
    (`e2e/seed-logistics-account.mjs` — server/gameState.js's `dataDir` is computed once at first import and
    does not follow a later `ISP_DATA_DIR` change within one process, so the seeding could not be inlined via a
    second in-process import without silently writing into the first viewport's already-deleted directory,
    which is what the first version of this spec did). Everything past that point is real: login over real
    HTTP, the quote read off the live page, the dispatch a real click against the real route, delivered by a
    real, separately-spawned `node server/index.js` reading that fixture from disk at boot — the same as an
    actual restart.
  - Checks: `npm run check` clean; `npm test` — **150 files, 1515 tests, all passed** (1513 baseline on
    `origin/main` after AB#985 merged + 2 new); `npx playwright test e2e/logistics-shipments.spec.js` — 2
    passed; `npx playwright test e2e/first-hour.spec.js` re-run against the modified server as a regression
    check — still 2 passed, unaffected.

## What's now true (ISP-278, AB#985 — prior session, still accurate)

- **ISP-278 is done: shipments arrive on a later tick, not on dispatch.** `POST .../gameplay/transfer-resources`
  debits the origin inventory and the fee once, same as before, but now creates a shipment (`corp.shipments`)
  with an arrival time from `transitTime` (`server/transfers.js`, dead code since AB#718, now wired in) instead
  of crediting the destination on the spot. The goods are in neither inventory while in flight — the bug-#692
  lesson applies here too: the destination station is pinned at dispatch (`corp.currentStationId` read once,
  when the shipment is created), never re-read at delivery time.
  - **`shipmentTick`** (mirrors `travelTick`, same 5s interval) delivers each shipment on the first tick at or
    after `arrivesAt`: credits the destination, records it in `corp.logisticsHistory` (same shape as before, so
    the existing Transfer History list needs no change), fires a notification, and drops the shipment from
    `corp.shipments` in the same pass — delivery is idempotent by construction, no separate guard needed.
  - **Held, not lost:** if the destination station id isn't in the catalog at arrival (a decommissioned
    station), the shipment's marked `status: "held"` and stays in `corp.shipments` rather than crediting nothing
    or vanishing; the player is notified. Nothing today resolves a held shipment — a reasonable follow-up if the
    Board ever retires a station.
  - **New, owner-scoped:** `GET .../gameplay/shipments` (list) and `.../shipments/:shipmentId` (one, 404 if it
    isn't yours — same shape as the existing message/notification-by-id routes).
  - **Client:** `app.js`'s post-transfer toast now reads the dispatch response's ETA rather than
    `logisticsHistory[0]` (which no longer has an entry at dispatch time) — "Dispatched … arriving in N min"
    instead of a false "Moved …". This is a plain-text change, not a layout one; see Blind spot.
  - Tests (`tests/integration/transfers.test.js`, `transfer-distance.test.js`): dispatch-vs-delivery separation,
    idempotent tick delivery with injected time, arrival notification, restart survival (write the live state to
    disk, reload it as a fresh process would, tick from the reloaded copy alone), the held-station case, a
    client-supplied arrival time being ignored, and cross-account 404 scoping. All fail against the pre-fix
    code where meaningful (dispatch-vs-delivery, idempotence) — checked by reverting the diff and re-running.
  - `tests/unit/benchTicks.test.js` and `scripts/bench-ticks.mjs` gained `shipmentTick`; `server/gameplayInput.js`
    and both AB#731/#732 guard-test files gained the two new routes (the first `ref`-kind field in
    `GAMEPLAY_INPUT`, so `gameplay-input.test.js`'s hostile-input loop needed the same ref-kind carve-out
    `remaining-input.test.js` already had — a real gap in that test, not specific to this story, fixed here).
  - `ECONOMY.md` and `DESIGN_DOCUMENT.md`'s "transfers still arrive at once; transit time isn't used yet" notes
    are updated — that sentence is what this story replaces.
  - Checks: `npm run check` clean; `npm test` — **149 files, 1513 tests, all passed** (1500 baseline on
    `origin/main` after merge + 13 new).

## What's now true (ISP-48, AB#734 — prior session, still accurate)

- **ISP-48 is done: `SECURITY.md` exists**, answering DOCTRINE's four questions (what data, who can reach it,
  blast radius, fail closed) for auth, persistence, the market and sockets, every answer citing file and line.
  Its dependencies (#731, #732, #752, #756) were all Resolved before this was claimed.
- **New: `accountActionLimiter`** (`server/rateLimiters.js`) — 120 requests/minute shared across every
  state-changing route under `/api/accounts/:accountId` and `/api/market`, keyed on the verified account id
  (falls back to address if unauthenticated, same shape as `loginAccountLimiter`'s AB#1747 fallback). One
  limiter instance mounted at both route families so an account can't dodge the count by splitting a burst
  across them. `tests/integration/rate-limit-account-action.test.js` proves the shared bucket, the 429, that
  `GET` is excluded, and that a different account's budget is untouched.
- **Secret audit**: `git grep` for JWT_SECRET literals, JWT-shaped tokens and password literals over the
  tracked tree found only two clearly-labeled throwaway values in `scripts/bench-*.mjs`. Server logs checked:
  nothing logs an email, password or token (every `console.*` call in `server/` either logs a JS `Error`
  object, a count, or neither).
  - **Middleware registration order matters for what a keyGenerator can see, and it is not what the route's own
    argument list suggests.** `/api/accounts/:accountId` has one `app.use(requireAuth, requireAccountAccess,
    accountActionLimiter)` mount, so the limiter always sees `req.auth`. `/api/market` has no such blanket
    mount — each route lists `requireAuth` itself — but a *separate*, earlier-registered
    `app.use("/api/market", gameplayInputMiddleware(...))` (input validation) runs before any individual
    route's own middleware chain, Express matching `app.use` in *registration order* across the whole app, not
    per-route. A test that posts an out-of-catalog item name to prove the limiter counts it will instead get
    400 from input validation before ever reaching the limiter — not a bug, just a trap for whoever writes the
    next test here. Use a real catalog item name (`data/refinery-chains.json`'s `resourceCatalog`, exact case:
    `"Silicates"`, not `"silicates"`) so the request actually reaches the routes under test.
- **Two findings filed, not fixed (acceptance #5, out of this story's scope):**
  - **AB#1765**: refresh tokens are stored in plain text in `accounts-snapshot.json`
    (`server/game/store.js:560-570`, `storeRefreshToken`) — unlike passwords, which are bcrypt-hashed before
    they ever reach disk. A leak of that file (the same class AB#415 already caused once) hands out live
    30-day bearer tokens directly, no cracking required. Proposed fix in the bug: hash it the way `passwordHash`
    already is, compared for exact match rather than against a typed value.
  - **AB#1766**: `emitMarketUpdated`, `emitForumsUpdated` and the local-chat system lookup
    (`server/index.js:3358-3366`, `3430-3432`) read `peer.data.accountId` directly instead of through
    `checkSocketAuth` — the known boundary ISP-67's own handoff note (below) already described, now actually
    filed as a bug rather than just written down.
- Checks: `npm run check` clean; `npm test` — **149 files, 1500 tests, all passed** (1496 baseline + 4 new).

## What's now true (this session: ISP-61, AB#747)

- **ISP-61 (AB#747) is done: a scripted first-hour playtest, in Playwright.** `e2e/first-hour.spec.js` registers
  a fresh account against `BASE_URL` and plays it the way a new CEO does — office, hire five, file the Earth
  claim, commission a yard, start a cycle at the top rate, sell into a standing buy order once enough has
  accrued, queue Basic Extraction Analytics, accept a contract — at 1280x800 and 375x812, one screenshot per
  step per viewport to `e2e/screenshots/` (gitignored; regenerated per run). Every assertion reads the page (a
  badge, the feedback log, a row appearing), never account state read another way.
  - **Selectors come from `public/scripts/walkthrough.js`**, not guessed: it already names the exact control for
    each of these steps, and `tests/unit/walkthrough.test.js` already fails if one drifts. This script is that
    same sequence played through a real browser.
  - Two real UI behaviors the story had to discover, not assume: registering opens a one-time "Brief me / I'll
    find my own way" dialogue (`#dialogue-modal`) that blocks every click until dismissed; selling to a standing
    order opens a trade-confirmation modal (`#trade-confirm-ok`) before the sale posts. Neither is mentioned in
    `walkthrough.js` because the walkthrough's own predicate-watching skips past them.
  - **No time-acceleration flag was added.** `IS_DEV` already zeroes R&D/CEO Insight duration and shortens
    travel; mining has no such flag. At the form's max rate (250 t/h) the server's 5s ticker credits a whole
    ton within a few ticks (the remainder carries between ticks, so this is real accrual, not a race) — the
    script waits on the extractor row's own live "Mined this cycle" figure (`[data-live="mined"]`, pushed by
    the `mining:updated` socket event), which is what the player would watch, not a fixed sleep. In practice
    that's under 20 real seconds; adding a mining accelerator was judged not worth the risk to touch for this
    story.
  - **A real screenshot bug, found by looking, not by the assertions**: `page.screenshot({ fullPage: true })`
    scrolls and stitches a page taller than the viewport, and the sticky top bar — `position: sticky` — gets
    captured once per stitched segment, so it appeared to repeat down the image on every screen with enough
    content to scroll (P-TOOLS: a screenshot lies when the page is scrolled). Fixed by growing the viewport to
    the page's own `scrollHeight` before each capture (one shot, no stitching) and restoring it after — the
    real target width (1280 or 375) is never touched, only the height used for the capture.
  - `npx playwright test`: **2 passed** (one per viewport). Screenshots attached are the 22 in `e2e/screenshots/`
    from that run; the Board can see them at their generated paths, or from the PR's own run. What was looked
    at: every step's screenshot at both sizes, specifically checking for the header-repeat bug above (gone
    after the fix) and that each step's confirmation (lease badge, headcount, extractor row, sale in Trade
    History, contract in Assignments) is genuinely on screen, not just asserted.
  - `@playwright/test` is now a devDependency; the cached Chromium this machine already had for job-hunt
    (`ms-playwright/chromium-1243`) covers it — nothing had to be downloaded. **This means ISP has its own
    browser now, independent of the Chrome extension.** A future non-extension Builder session can run
    `e2e/first-hour.spec.js` (or a new spec built the same way) to actually look at ISP, the way job-hunt's
    `scripts/look-*.mjs` already let that product's Builders look without the extension.

## What's now true (ISP-67, AB#756 — earlier session, still accurate)

- **ISP-67 (AB#756) is done.** The PM re-scoped it on 2026-09-23 after Bug #710/#1021 shipped most of it; what
  was left was the anonymous and expired-token edges, and they're now proven rather than assumed:
  - `io.use` keeps the raw token on `socket.data.token`, not just its verdict, so it can be re-verified later
    against the clock it is checked at.
  - A new `checkSocketAuth(socket)` re-verifies that token on demand. If it has expired since the handshake, the
    socket leaves its account room, loses `socket.data.accountId`, and is sent `auth:expired` — dropped back to
    anonymous, not disconnected.
  - `emitToAccount` calls it for every socket in the room before delivering, so an expired member is evicted and
    skipped in the same pass that would have sent it the event — "the first event after expiry" from the
    acceptance line is literally the next per-account emit attempt.
  - `chat:send` calls it too, so a write from a socket whose token has since expired fails closed instead of
    trusting the account id cached at connect time.
  - Client: `app.js` listens for `auth:expired` and calls the existing `refreshSessionToken()`, which already
    reconnects the socket with a fresh token (Bug #710's `reauthenticateSocket()`) — so a live tab recovers
    without a reload, the acceptance line's "reconnecting with a fresh token restores them."
  - New tests in `tests/integration/socket-rooms.test.js`: an anonymous socket gets the public events and none
    of `finance:updated`/`mining:updated`/`notifications:new` in the same run that produces all four; a token
    that expires mid-connection stops per-account delivery, fires `auth:expired`, and a fresh connection is
    unaffected; an expired-token socket's `chat:send` is dropped rather than sent as the account. All three
    fail against the pre-fix code (checked by reverting the fix and re-running).
  - **Known boundary, not closed by this story:** `emitMarketUpdated`/`emitForumsUpdated` and the local chat
    room-by-system lookup still read `peer.data.accountId` directly rather than through `checkSocketAuth`, so a
    socket whose token has expired but is still connected keeps seeing "this is your own listing" highlighting
    and local chat for its last-known system until it does something that calls `checkSocketAuth` (a per-account
    emit, or `chat:send`). Nothing per-account or financial leaks through this path — market/forum views are
    public data with viewer-relative highlighting, not private state — but it's a real gap between "anonymous"
    and "actually anonymous" worth a follow-up if the Board wants it airtight.
  - Security answer (acceptance #6): an anonymous or expired-token socket sees exactly the signed-out view —
    `state:init`'s shared state with no viewer, and the four global events — and nothing derived from an
    account; a forged `accountId` in a payload is never read (the server always uses `socket.data.accountId`,
    set only from a verified token), and `chat:send`'s existing content/length/channel checks are untouched.
- `/api/auth/login`, `/register` and `/refresh` are rate-limited (ISP-64, AB#752): 10 login attempts/minute
  per address, 5 failed logins per account per 15 minutes (lockout keyed on email, not address; the no-email
  fallback goes through express-rate-limit's own `ipKeyGenerator`, not a raw `req.ip` — AB#1747, fixed the
  `ERR_ERL_KEY_GEN_IPV6` startup log the first version left), 5 registrations/hour per address, 60
  refreshes/minute per address. `trust proxy` is 1 hop app-wide. Limits live in `server/rateLimiters.js`,
  overridable per-limiter via `ISP_RATE_LIMIT_*` env vars; under `NODE_ENV=test` they default high so the rest
  of the suite doesn't trip them by accident.
- The tickers no longer deep-clone the account they just mutated, and no longer settle mining redundantly
  (ISP-43a, AB#1448): `mutateAccountState(id, mutator, { sanitize, settleMining })`, both default `true`
  (route handlers unchanged). Combined ticker event-loop share at N = 1,000 fell from 35% to 2% (PERFORMANCE.md).
- `tt-energy-routing` and `tt-material-compression`'s research effect text (AB#1259) says what it actually
  unlocks instead of a mechanic nothing read. Fixed in all three duplicated catalogs (`data/research.json`,
  `server/index.js` `RESEARCH_LIBRARY`, `public/scripts/app.js` `techTree`); unifying those three is AB#1049's
  separate scope. New schema test guards every research effect has a stated unlock or a real reader.
- An office authorizes a corporation only at the station it was rented at, while its lease has not lapsed
  (AB#1124, parallel session): hiring, renting, leasing and starting a mining cycle all read one helper,
  `activeOfficeAt(corp, stationId, now)`. Confidence medium — flagged in that PR for the Board to veto if a
  company-wide office was intended.

## Filed, not fixed (out of scope for the sessions that found them)

- **AB#1744**: `tests/integration/construct-assembly.test.js` is flaky under load (~1 run in 3) — a fixed 50ms
  `setTimeout` used as a sync primitive for an async POST, not tied to the request completing.
- **AB#1767**: `tests/integration/ticker-mining-settle.test.js` flaky under a full `npm test` run — same
  higher-level symptom as AB#1744 (passes alone, flakes under full-suite load) but a different mechanism (no
  `setTimeout`; uses `vi.useFakeTimers()`); root cause not pinned down, confidence low. The two may share a
  systemic cause; unconfirmed.
- **AB#1765**: refresh tokens stored in plain text in `accounts-snapshot.json`, unlike bcrypt-hashed passwords.
- **AB#1766**: `emitMarketUpdated`/`emitForumsUpdated`/local chat read `peer.data.accountId` directly instead
  of through `checkSocketAuth` (ISP-67's own known-boundary note above, now filed).

No Chrome extension on any of these panes (Builder panes don't get one by design), but ISP-61 changed what that
means for ISP. ISP-61 is entirely about screens and was looked at for real: Playwright, not the extension,
drove a real Chromium against a real running server, and the 22 resulting screenshots were read back and
checked, including catching and fixing a header-repeat capture bug (`fullPage: true` stitching a `position:
sticky` header into the image twice). ISP-48 and ISP-89 have no screen of their own — a markdown file and a
server-side throttle, a source-scanning Vitest test — and were each verified directly instead: `SECURITY.md`'s
every code claim read back against the actual file and line; the rate limiter proven with real HTTP requests
through `supertest`; the payments scan run against a temporary, uncommitted seeded violation (caught it) and
against a clean checkout (passed) — each the actual mechanism its own acceptance criteria describe, not a
proxy for it. ISP-278 has no screen of its own either — a dispatch/delivery split in server state, proven with
real HTTP requests and a real `shipmentTick()` call through `supertest`/`getApp()` (not a mock). One thing that
session did **not** look at: the client's post-dispatch toast wording, reasoned through and `node --check`ed
but never rendered — that gap is closed now: **ISP-279 (this session) used ISP-61's Playwright pattern for
real**, `e2e/logistics-shipments.spec.js`, and the four resulting screenshots were read back and checked (see
above) — the quote line, the toast, and the in-flight list all render correctly, at both widths, with no
overflow. AB#1052 (a concurrent pane) also used this pattern for its own screen, `e2e/stop-mining.spec.js`.
ISP-67's own blind-spot note (an earlier session) stands unchanged: `socket.io-client` against a real server
was that session's equivalent of "looked at it."

`npm test` after merging AB#1052 and ISP-89 into this branch: **152 files, 1543 tests, all green**. `npm run
check` clean. `npx playwright test`: `first-hour.spec.js` 2 passed (re-run as a regression check against the
modified server), `logistics-shipments.spec.js` 2 passed (this session's new spec). One, unrelated
`ticker-mining-settle.test.js` flake seen once under full-suite load during the ISP-89 session, filed as
AB#1767, not reproduced again. **One line-number fix on merge**: ISP-89's `no-payments.test.js` allowlists
`public/styles.css` by line number; this session's CSS insertion pushed the one existing allowlisted match (a
"Premium Thread Detail View" section comment) from line 4151 to 4195, and the test's own message ("the code
moved; update or remove the entry") says exactly what to do — updated, not a new finding.

**AB#753/755/757/781/987/989 (the remaining screenshot-gated v0.5 items) are no longer blocked on "no
browser."** Playwright is the way to do it for ISP now — see ISP-61's pattern (`e2e/first-hour.spec.js`) or
this session's (`e2e/logistics-shipments.spec.js`, for a story that needs a seeded fixture rather than fresh
play) — but nobody has yet written the scripts for CSP-console-checking, the register page, or the
verification-email flow. That's real work still to do, not a blind spot anymore, and the natural next pick for
a Builder pane without the Chrome extension.

## What's next

- **ISP-299 (AB#1792)**: `ops/probes/isp-runway.ts --broke` mode, depends on ISP-297 (done). **Lives in the hq
  repo** — Board scope override granted for this one item (see this session's section above), not a standing
  exception for future items.
- **AB#1801** (the Decision this session filed: does the flat-direction Station mockup ship?) is the one thing
  actually blocking the eleven-story design-system track (AB#745, AB#759 to AB#772) — hand it to the Board, not
  to another Builder pane; nothing to build until it is answered.
- **AB#1794 is done — see this session's section above.** Confirmed not a bug by direct analysis, not by the
  re-run `DEPTH.md` review #3 and this file both expected to be dispositive: the runway probe's bots never take
  missions of any kind (Salvage Assignment included), so ISP-297/298/299 could never change what a 30-day
  organic run shows, and the re-run (against main@2552e7e, all three merged) confirms it — still Level 2, still
  0 credits. If `DEPTH.md` review #3 is read again, its "probe cannot reach Level 9 until a broke corporation
  can recover" framing should be read against this: recovery existing does not help, because the organic bots
  never try to recover through a mission either way.
- **Worth filing** (not attempted this session — a hq-repo change, out of scope for an ISP display/economy
  session): give the runway probe's PLANNER/GREEDY bots an actual mission-taking decision (accept a delivery
  contract or the Salvage Assignment when eligible), so the 30-day organic run says something real about the
  economy's mission system instead of never touching it. Without this, no future "did the economy get less
  stuck" review can trust the organic run's Level/credits numbers where missions matter.
- **AB#1774** (the runway probe's banked-reserve profile) is `Proposed`, not started, and `DEPTH.md` ranks it
  the top epic two reviews running — but it lives in `ops/probes/` in **hq**, not this repo, so it is out of
  scope for an ISP-only Builder pane (COMMON §3, project scope). Flagging for whichever pane is scoped to the
  platform.
- **ISP-279** and **ISP-66 (AB#755)** are both done (concurrent panes) — see above.
- **AB#753 (ISP-65, CSP/security headers)**: its predecessor, AB#739 (splitting `app.js`), is done (ISP-53, top of
  this file), so it is unblocked. It was worth doing regardless, now that the actual
  risk that predecessor was hedging against (many inline event handlers to convert) turned out not to exist —
  `grep -c 'onclick='` across `public/` returns 0, the client already uses `addEventListener` exclusively.
- **AB#757/987/989** (the rest of the screenshot-gated v0.5 items) can now be built and looked at with
  Playwright too — see ISP-61 (`e2e/first-hour.spec.js`, fresh play), AB#1052 (`e2e/stop-mining.spec.js`, fresh
  play) or ISP-279 (`e2e/logistics-shipments.spec.js`, a seeded fixture — the pattern to reach for when the
  state under test would need disproportionate grinding to reach by fresh play) for the established shapes.
  Each has its own unmet predecessor as of 2026-09-25 (AB#757 wants the CSP story above; AB#987/989 want AB#757
  and AB#781 respectively) — check state before claiming.
- **AB#1744 is done** (this session, above). **AB#1767** (a different flaky test, `ticker-mining-settle.test.js`
  — check whether it shares AB#1744's shape before assuming a separate cause) is filed, Proposed, unclaimed.
- **AB#1806 and AB#1807 are both done** (two sessions before this one, above). `domTargets.test.js`'s
  `KNOWN_ORPHANED` allowlist is empty and has been simplified away — the three findings from AB#1752's own
  general regression test are all closed out.
- **Board directive received mid-AB#1744 (2026-09-25): every pane holds after its current item lands, nothing
  new claimed, ahead of an upcoming code change.** This pane (#10) is holding. Multiple Builder panes are
  working ISP at once — check ADO for what's Active before claiming, once holds are lifted.

## In flight / blocked

Nothing blocked, nothing left uncommitted. ISP-67's branch (`agent/756-socket-boundary`, PR !392), ISP-48's
(`agent/734-security`, PR !402), ISP-89's (`agent/779-no-payments-test`, PR !409), ISP-61's
(`agent/747-first-hour-playtest`, PR !406), ISP-278's (`agent/985-timed-transit`, PR !408), AB#1052's
(`agent/1052-stop-mining`, PR !417), ISP-66's (`agent/755-registration-validation`), ISP-279's
(`agent/986-shipments-ui`, PR !432), AB#1765's (`fix/1765-hash-refresh-token`, PR !439), AB#1766's
(`fix/1766-socket-auth-check`, PR !444), AB#1753's (`fix/1753-level2-gate`, PR !450), AB#758's
(`design/758-flat-station`, PR !454), AB#1789's (`agent/1789-salvage-assignment`, PR !458), AB#1754's
(`fix/1754-economy-model`, PR !462), AB#1791's (`agent/1791-salvage-display`, PR !466), AB#1792's (probe
`--broke` scenario, per OPS), AB#1752's (`fix/1752-milestone-list`, PR !469), AB#1806's
(`fix/1806-mine-cycle-list`, PR !473), AB#1794's (`fix/1794-luna-lease-not-a-bug`, PR !474 — test-only, no
production code changed), AB#1807's (`fix/1807-dead-login-panel`, PR !479), AB#1761's
(`agent/1761-refinery-muted`, PR !481) and AB#1744's (`fix/1744-construct-assembly-flake`, PR !484) are all
merged. The Board's hold was lifted by the ISP-300 assignment. This session's (AB#1815) branch is
`agent/1815-route-modules`, PR opening next and set to auto-complete; AB#1828's fix follows on its own branch.
Open elsewhere: !489 (ISP-52, client `app.js` split) — does not touch `server/index.js`.
