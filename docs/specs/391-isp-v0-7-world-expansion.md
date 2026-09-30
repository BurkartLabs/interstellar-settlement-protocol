# ISP v0.7 — World expansion

Feature AB#391 (Proposed) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits: v0.7 on the ISP roadmap (DEVELOPMENT_PHASES.md in the product repo), under the product epic.
What it is for: Scale the universe so progression past Sol feels like it means something. Today the starmap is small enough that reaching the edge of it is an anticlimax.
What it contains:
- Starmap expanded to 20+ solar systems
- Neutral stations shown on the map
- NPC corporations in Sol for price anchoring and flavour
- Pirate (Rats) NPC enemies in asteroid fields
Each line becomes a story when this version is next. They are listed here rather than filed as work items so the backlog shows what is ready to be worked, not everything that has ever been planned (TRACKING.md).

## Acceptance

_To be written: the Feature had no acceptance criteria in Azure DevOps._

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 1 open, 13 resolved.

### ISP-123 NPC bids and asks drift with traded volume, inside fixed bounds (Requirement AB#817, Active)

What: Where it sits. v0.7 World Expansion (Feature AB#391), NPC corporations line. What it is. Replace the fixed NPC prices with the design's rule: price moves with volume traded over the rolling window, between the floor and ceiling, and daily quantities come from the design rather than 1,000,000. Why it matters. A fixed bid with unbounded depth is the reason DEPTH found no player ever needs another player; drift is what makes the exchange a market. Estimate: 1 session, assuming v0.7-11 is merged.

- [ ] A test sells a large volume to an NPC bid and sees the bid fall by the design's amount, and never below the floor; the same for asks and the ceiling.
- [ ] The probe from v0.7-09 exists as a test and the PR quotes its two numbers (share of player-to-player volume, silicate price movement), labelled as bot numbers.
- [ ] Price state is server-side only and persisted; a restart does not reset prices (test).

### ISP-112 Make data/systems.json the one source for every per-system fact (Requirement AB#804, Resolved, not verified)

What: Where it sits. v0.7 World Expansion (Feature AB#391), plan line "Starmap: expand to 20+ solar systems". Groundwork: adding fourteen systems today means editing seven places. What it is. Per-system facts live in data/systems.json and also in SYSTEM_DETAILS, BELT_COMPOSITIONS and SYSTEM_RARITY (server/gameState.js, with a TODO saying so), SYSTEM_ADJACENCY (server/index.js), and CLUSTER_LAYOUT and NEAR_STAR_SYSTEMS (public/scripts/starmap.js). Move adjacency, map position, rarity, belt composition… (the rest: AB#804)

- [x] grep finds none of the seven constants above left in server or client code; each value comes from systems.json.
- [x] A test asserts: adjacency is symmetric; every system is reachable from Sol; every moon's parentId resolves; every station's systemId and body resolve; every belt composition's system and body exist.
- [x] Travel hop counts and belt yields for the six existing systems are unchanged (test comparing before and after).
- [x] The catalog is served read-only to the client and contains no player data.
- [x] Screenshot of the starmap cluster view, before and after, showing no difference at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### ISP-113 Design the 20+ system map: which stars, how they connect, and how each one is reached (Requirement AB#805, Resolved, not verified)

What: Where it sits. v0.7 World Expansion (Feature AB#391), starmap line. Design before data. What it is. Choose at least fourteen new systems to join the six that exist, using real nearby stars (RECONS, the 100 nearest star systems), and give each its gdpIndex, pirateDensity, activityLevel, ownerRule, rarity, access gate (research id and/or corporation level), bodies, belt composition, adjacency and map position. Why it matters. "Progression past Sol feels meaningful" (the Feature's own words) only… (the rest: AB#805)

- [x] docs/design/starmap-20.md lists 14 or more new systems with every field above; the total is at least 20.
- [x] It groups them into access tiers and names the research node or level that opens each tier; every gate named exists in data/research.json or is specified for v0.7-06 to add.
- [x] It shows the adjacency graph (a table or a diagram) and states the longest hop count from Sol.
- [x] It explains, per access tier, what a player gains by going there that they cannot get closer to home (a resource, a rarity, a price), so distance is a trade-off and not only a wait.
- [x] Map positions are chosen so the cluster view stays legible; the doc includes a rough sketch at the target size.

### ISP-114 Add the first half of the new systems to the catalog (Requirement AB#806, Resolved, not verified)

What: Where it sits. v0.7 World Expansion (Feature AB#391), starmap line. What it is. Add the first half of the systems in docs/design/starmap-20.md to data/systems.json with every field the design specifies. Why it matters. Split in two so each batch can be checked on the map in one session. Estimate: 1 session, assuming the design and v0.7-01 are merged.

- [x] The systems are in the data and match the design (diffable).
- [x] The cross-catalog tests from v0.7-01 pass with the new systems.
- [x] The server starts against a saved world state from before the change and the new systems appear (normalisation test).
- [x] Screenshot of the cluster view with the new systems present at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### ISP-115 Add the second half of the new systems to the catalog (Requirement AB#807, Resolved, not verified)

What: Where it sits. v0.7 World Expansion (Feature AB#391), starmap line. What it is. Add the second half of the systems in docs/design/starmap-20.md to data/systems.json with every field the design specifies. Why it matters. Split in two so each batch can be checked on the map in one session. Estimate: 1 session, assuming the design and v0.7-01 are merged.

- [x] The systems are in the data and match the design (diffable).
- [x] The cross-catalog tests from v0.7-01 pass with the new systems.
- [x] A test asserts the catalog holds at least 20 systems.
- [x] Screenshot of the cluster view with the new systems present at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### ISP-116 Starmap cluster view that stays legible at 20+ systems (Requirement AB#808, Resolved, not verified)

What: Where it sits. v0.7 World Expansion (Feature AB#391), starmap line. The visible result of the line. What it is. The canvas cluster view was laid out for six systems by hand. Make it render twenty or more from catalog positions with lanes from adjacency, labels that do not overlap, locked systems shown distinctly with the reason on hover or tap, and the existing list fallback covering every system. Why it matters. A map of twenty illegible dots is worse than a map of six readable ones. Estimate:… (the rest: AB#808)

- [x] Every catalog system is drawn with its name; no two labels overlap at 1440x900 (checked by a test on the computed label boxes and by looking).
- [x] Lanes are drawn only between adjacent systems.
- [x] A locked system shows its gate in words ("requires Deep-Star Cartography Suite") when selected.
- [x] The list fallback lists every system.
- [x] Screenshot of the cluster view at 1440x900 and at 390x844 with one locked system selected at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### ISP-117 Travel to the new systems: hop distance from the catalog and access gates enforced on the server (Requirement AB#809, Resolved, not verified)

What: Where it sits. v0.7 World Expansion (Feature AB#391), starmap line. What it is. The travel route computes hops from the catalog adjacency and enforces each system's access gate on the server; add the research node(s) the design names if they do not exist (tt-deep-star-navigation already promises "all future systems"). Why it matters. If the gate is only drawn on the map, any client can travel anywhere. Estimate: 1 session, assuming v0.7-04 is merged.

- [x] Travel to each access tier succeeds with its gate met and returns 400 with the gate named without it (test per tier).
- [x] Hop count and travel time for a sample of new routes match the design (test).
- [x] Security (DOCTRINE constraint 1): the route sits behind requireAuth and requireAccountAccess; it touches the caller's location and travel state and nothing else; every id in the request is checked against the server catalog and every quantity is a bounded positive integer, so an unknown id, a negative, NaN, a float or an oversized number returns 400 with no state change (a test sends each); costs, effects and outcomes are computed on the server, never read from the request; if the catalog entry… (the rest: AB#809)

### ISP-118 Mark neutral stations in the station catalog and give new systems their stations (Requirement AB#810, Resolved, not verified)

What: Where it sits. v0.7 World Expansion (Feature AB#391), plan line "Starmap: neutral stations shown on map". What it is. "Neutral" is defined here as a station no corporation owns, open to every corporation to dock and rent an office, as distinct from the conglomerate-owned stations of v0.12. Add a jurisdiction (or neutral: true) field to data/stations.json, set it on all eight existing stations, and add stations for the new systems where docs/design/starmap-20.md places them (add a short section… (the rest: AB#810)

- [x] Every station has the new field; a schema test rejects a station without it.
- [x] Each new system has the stations the design specifies, with designation, tier and office cost; the cross-catalog test passes.
- [x] A player can dock and rent an office at one new station end to end (integration test).

### ISP-119 Show neutral stations on the cluster and system views (Requirement AB#811, Resolved, not verified)

What: Where it sits. v0.7 World Expansion (Feature AB#391), neutral stations line. What it is. Stations appear today only after zooming into a body. Show a station count badge per system on the cluster view and a marker per neutral station on the system view, with a legend, and open the existing station modal on click. Why it matters. A player choosing where to expand needs to see where they can operate before clicking into each planet. Estimate: 1 session, assuming v0.7-05 and v0.7-07 are merged.

- [x] The cluster view shows a system's neutral station count only where it exceeds the baseline of one every system has (today Sol's 3), and the legend says every system has at least one neutral station; each neutral station has a marker on its system view. (Amended by AB#2349, PR 821, per the Director's ruling of 2026-09-26; it read: "Each system with neutral stations shows the count on the cluster view".)
- [x] Clicking a marker opens that station's modal; the legend explains the marker.
- [x] Markers come from the catalog field, not from a client list (test with a fixture).
- [x] Screenshot of the cluster view and the Sol system view with station markers at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### ISP-120 Design Sol's NPC corporations: who they are, what they trade, and how their prices move (Requirement AB#812, Resolved, not verified)

What: Where it sits. v0.7 World Expansion (Feature AB#391), plan line "NPC corporations in Sol system (price anchoring + flavour presence)". What it is. The build has named NPC buyers (Lunar Helium Consortium, Belt Refining Cooperative, Olympus Heavy Industries, Synthorium Trading House) as strings on six standing buy orders, and no NPC sell orders at all, although v0.2 is marked done for them. Design a roster of Sol NPC corporations with home stations, what each buys and sells, and a price rule.… (the rest: AB#812)

- [x] docs/design/npc-corporations.md lists each NPC corporation with name, home station, flavour line, items bought and sold, and which of the existing buyer names it absorbs; GEX and ISA are treated as authorities, not corporations.
- [x] It specifies the price rule: a bid floor and an ask ceiling per item that drift with volume traded over a rolling window, with bounds, and daily quantities a real corporation can reach.
- [x] It states the probe target, labelled as bot numbers (P-PROXY): with two bot corporations trading for a simulated week, at least 25% of filled volume is player to player, and the silicate clearing price moves at least 10% between a low-supply and a high-supply week (DEPTH epic 3).
- [x] It confirms NPC names are reserved against player registration (AB#433) and that NPC orders are shown as NPC to the player.
- [x] It states that no NPC trade is ever sold for money and that NPCs never trade against a player with information the player lacks.

### ISP-121 NPC corporation catalog, and their names reserved at registration (Requirement AB#813, Resolved, not verified)

What: Where it sits. v0.7 World Expansion (Feature AB#391), NPC corporations line. What it is. Add data/npc-corporations.json from the design, and make registration (and any rename) reject a corporation name that matches an NPC corporation or authority after normalising case, whitespace and look-alike characters. Why it matters. AB#433 showed a player can register as "GEX Commodities Authority" and list goods as the exchange; adding more NPC names adds more names to impersonate. Estimate: 1 session,… (the rest: AB#813)

- [x] The catalog holds every corporation in the design; a schema test checks every home station resolves.
- [x] Registering as any NPC name, in any case, with extra spaces, or with a Cyrillic look-alike letter, returns 400 and creates no account (a test per variant).
- [x] Security: registration touches only the submitted name and email; the rejection message does not echo the submitted name back unescaped; if the reserved list cannot be loaded, registration fails closed with 503 rather than allowing every name.

### ISP-122 NPC sell orders on the exchange, kept apart from player listings (Requirement AB#815, Resolved, not verified)

What: Where it sits. v0.7 World Expansion (Feature AB#391), NPC corporations line. What it is. The server places and refreshes NPC asks per docs/design/npc-corporations.md, flagged npc: true with the NPC corporation as seller. They never count against, displace or truncate player listings (AB#425 was a global cap that destroyed player goods), and buying from one goes through the existing buy path. Why it matters. Price anchoring on the sell side is the half of the market that does not exist at all.… (the rest: AB#815)

- [x] After a refresh each NPC corporation has the asks the design specifies; a player can buy from one and receives the goods at their station with tax applied (integration test).
- [x] With 200 player listings present, NPC refresh leaves every player listing and its goods intact (test).
- [x] The NPC refresh runs on the server tick only; no route lets a client create, edit or cancel an NPC order (test that the order routes reject npc: true).
- [x] NPC orders survive a restart without duplicating (idempotence test on the seed/refresh).

### ISP-124 NPC corporations visible: badge on the order book and a profile card for each (Requirement AB#818, Resolved, not verified)

What: Where it sits. v0.7 World Expansion (Feature AB#391), NPC corporations line: the "flavour presence" half. What it is. On the exchange, NPC orders carry an NPC badge next to the corporation name; clicking the name opens a profile card with the NPC corporation's flavour line, home station and what it trades. Why it matters. The order book's counterparty name is its only trust signal (MONETIZATION review #1); a player must be able to tell an NPC from a player at a glance. Estimate: 1 session,… (the rest: AB#818)

- [x] Every NPC order row shows the badge; no player row does (test from a fixture with both).
- [x] The profile card shows the catalog fields and is reachable from the order book.
- [x] Screenshot of the exchange with NPC and player orders side by side, and one profile card open at 1440x900 and at 390x844, taken from the running game after performing the action (not a mock), attached to the PR (DOCTRINE constraint 3).

### Cluster view: show a station badge only where a system exceeds the baseline of one station (Director ruling, AB#811) (Requirement AB#2349, Resolved, not verified)

What: Where it sits. v0.7 World Expansion (Feature AB#391), neutral stations line. Follow-up to AB#811 (ISP-119, merged PR !794), per the Director's ruling on AB#811 (2026-09-26). / What it is. Since AB#807/PR !804 brought the cluster to 22 systems and AB#810 gave every system a neutral station, 21 of 22 cluster-view badges read "1", telling a player nothing about where to expand - which is this feature's whole purpose - and on a phone these badges crowd out system names (only 4 of 22 legible today,… (the rest: AB#2349)

- [x] The cluster view shows a station-count badge only for a system whose station count exceeds the baseline of one; every other system (21 of 22 today) shows no badge.
- [x] The legend states once, in plain language, that every system has at least one neutral station.
- [x] The system view is unchanged: one marker per neutral station, click opens its modal (AB#811's existing behavior, untouched).
- [x] AB#811's own acceptance clause 1 is updated to record this rule once this item merges.
- [x] Screenshot from the running game (not a mock) at 1440x900 and 390x844, showing at least one system with a badge (Sol) and at least one without, so the rule is visibly demonstrated.
- [x] The PR states whether this eases AB#2343's crowding at phone width; it does not need to fully resolve that bug, which stays open on its own.

## Demo script

_To be written._
