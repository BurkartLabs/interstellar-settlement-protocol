# First-session UX audit (ISP-6, AB#405)

Audited 2026-09-21 on a local build of main `b45dbf3`, as a freshly registered account, at 1280x800 and 375x812.
This file finds gaps and fixes nothing: it is the list ISP-20 and ISP-26 are checked against. The code wins where
the two disagree; re-run the audit rather than trusting a row after the screens change.

**How it was looked at.** The account was registered through `POST /api/auth/register`; its state, inbox and
notifications were then copied onto the credential-free demo login so the browser could play it without anyone
typing a password. Each screen was opened and, where it has one, its next action was taken with real
clicks. The browser window could not be resized, so each size is an iframe of exactly that viewport; below-the-fold
parts were reached by offsetting a taller frame, which measures `vh`-sized and sticky elements against the taller
frame. **Boot matters:** a fresh data dir's first boot has no standing buy orders (#574, fixed by !143, not yet on
main); observations are second boot unless marked *first boot*.

**Columns.** *Empty state*: what a new player sees and whether it names the next action. *Errors*: every
player-facing string the screen can produce, from the server route's outcome strings (file:line), and whether the
copy says what to do. *Leave*: whether the player can get off the screen. A cell that fails carries its Bug id.

| Screen | Empty state names next action? | Error copy says what to do? | Can leave? |
|---|---|---|---|
| Landing `/` | Partly. Log In / Register Corporation exist but are below the fold at 1280x800; at 375x812 Log In is at the bottom edge and Register is cut. **#1056** | No server errors. | Yes: Log In, Register. |
| Register `register.html` | Yes: the form, Register and Continue. | Mostly. "A valid email is required.", "Password must be at least 8 characters." say what to do (gameState.js createAccount). "An account with this email already exists." does not say Log In; "Registration failed." (index.js:855) gives no next step. **#1059** | Yes: Back to Login. |
| Login `login.html` | Yes: the form. The intro talks about a "prototype command gateway" and a dummy account "when developer mode is enabled". **#1059** | No. "Invalid credentials. Use the dummy account button for temporary access." (login-page.js:83, server index.js:915) steers a real player to the shared demo account instead of checking the email and password or registering; "Login failed." (:923). **#1059** | Yes: Register Corporation, Return to Landing Page. |
| Inbox | Yes: the ISA Settlement Licence ends "Your first recommended action is to secure office space at Earth Station Prime." Empty folders say only "No messages here." (index.html:889). **#1060** At 375 the inbox is a ~120px column and subjects are cut. **#1055** | Yes. Send: "Recipient corporation is required.", "No corporation has that name.", "N corporations share that name. Choose which one you mean.", "Message body cannot be empty." (gameState.js mail send). | Yes: tabs; an open message has Back. |
| Station | No. Three office descriptions; every Enter button is below the fold at 1280x800 and nothing says to start with the Orbital Executive Suites. **#1056** | No actions of its own. | Yes: tabs. |
| Orbital Executive Suites: office | Yes: "Lease an Office Suite ... Execute Lease Agreement". The quoted $20,000 is not what is charged: **#1032** (open, linked). At 375 the card runs off the screen and hides the price. **#1055** | Yes. rent-office: "Your corporation already maintains an office at X.", "Leasing an office at X for N days requires $... Current reserves: $..." (index.js:1171-1172); renew: :1246-1247. | Yes: Back to Station. |
| Orbital Executive Suites: workforce | Yes: "Staffing: 0 / 8" beside Hire Personnel; below the fold at 1280x800 after Office Status and Extend Lease. **#1056** | No. "Employee cap reached. Current staffing is 20/20." (index.js:1089, seen in play) does not say the cap rises with corporation level. **#1058** Funding: fundingRequirementMessage, says the amount. | Yes: Back to Station. |
| ISA Claims and Leases | Mostly. With no office: "Submit a lease application below to begin." sits above "A registered corporate office is required ... Visit the Orbital Executive Suites first." After the one local lease: "All extraction zones available from this station have been claimed" with no word that other stations lease other bodies. **#1060** | Yes. purchase-lease: no-office, duplicate-lease, insufficient-employees (states the headcount needed), funding (index.js:1342-1345). | Yes: Back to Station. |
| Extractor panel (Manage Lease) | Yes: "No extraction facilities on this claim yet. Commission a yard below to begin operations." | No. lease-slots-full says "Upgrade your lease tier", no-corp-slot says "Upgrade your headquarters or release an existing building"; none of those exist (index.js:1655-1656). **#1057** start-mining "Insufficient credits to start the mining cycle. Check your finances." gives no amount (:1771). **#1058** Others (no-office, office-lease-expired, already-active, :1764-1770) say what to do. | Yes: Back to Claims and Leases, Back to Station. |
| Galactic Exchange | No. *First boot*: no standing buy orders at all (**#574**, open, linked). Every boot: "No sell orders match the current filter." and "No standing buy orders match the current filter." while the filter is All; "You have no items in inventory to list." does not say how to get items. **#1060** Tables scroll sideways inside their cards at 1280x800. **#1055** | Mostly. npc-order sell: "Insufficient Silicates at this station (have N, need M).", "This order has been fully filled for today. It resets at midnight EST." (index.js:3279-3300); listing and buy: "Quantity exceeds available inventory at this station.", "Insufficient credits to execute this buy order.", "You cannot buy your own sell order." (:3095-3185). | Yes: tabs. |
| Corporate R&D | Yes: "No queued items yet." beside Basic Extraction Analytics' + Enqueue. | Yes. queue-rnd names the prerequisite, level or tier needed and the cost (index.js:2739-2744). | Yes: tabs. |
| Assignments | Yes: "No active contracts. Visit an agent's office to accept assignments." with Elara Voss's card. At 375 the heading wraps a word per line, the card runs off the screen and the text leaves its box. **#1055** | Partly. accept: "Mission not found in current offerings.", "Mission already accepted." (index.js:2423-2424); complete: "Insufficient resources at this station." names no item, amount or station (:2502). **#1058** | Yes: tabs; an agent's office has Back to Assignments Bureau. |
| Overview | Yes: "Corporation Level 1 Milestones" with Go to Station links, but at the bottom edge at 1280x800 and below four stat cards at 375x812 (**#1056**). The Level 2 card "Purchase a Mining Lease on Mars - Go to Station" leads to a station that cannot lease Mars. **#1061** | No actions of its own. | Yes: tabs. |

**Across screens at 375x812 (#1056).** The first screen after login is the corporation sidebar only; a Quick Action or
tab tap changes a panel below the fold, so nothing visible happens.

**Not player screens, noted for completeness.** `POST /api/auth/dummy-reset` returns 500 on a first boot (missing
`market.orderBook`), the same fault as #588 and #574, fixed by !143. Every screen can be left; no dead-end screen
was found, only dead-end *advice* (#1057, #1061).

## Bugs filed by this audit

| Bug | Severity | What |
|---|---|---|
| #1055 | 3 | Narrow-width layout: Inbox, Assignments, office and lease cards; Exchange tables at 1280 |
| #1056 | 3 | First action below the fold on Landing, Station, Overview; phone tab taps show nothing |
| #1057 | 3 | Extractor errors advise upgrades that do not exist |
| #1058 | 3 | Gameplay errors without a next step: employee cap, mining credits, mission quota |
| #1059 | 3 | Register and login copy; login steers to the demo account |
| #1060 | 4 | Empty states on the Exchange, Inbox and Claims |
| #1061 | 3 | Level 2 Mars lease link leads to a station that cannot lease Mars |

Linked, not refiled: #574 (no standing orders on first boot), #1032 (office price). #575, #576, #577 and #586 were
not reached by this first-session pass.

Screenshots of every screen at both sizes, with what was looked at in each, are attached to the pull request.
