# New Player Experience

The build is the reference for every figure below. The walkthrough's own copy lives in `public/scripts/walkthrough.js`; if the two disagree, the code is right and this file is stale. Figures last checked against the server on 2026-09-21 (AB#404).

## Initial Walkthrough

The walkthrough is a briefing from Elara Voss, the Contracting & Assignments Bureau coordinator assigned to every new corporation (AB#579). It follows what a new CEO does first (AB#580): the whole first session happens at Earth Station Prime, where they already are, so the station work comes first and the starmap comes last, as orientation.

The walkthrough watches what the player does (AB#581). Each step is done when the player does the thing it asks: opens the tab, leases the office, hires the five, and so on, and then it moves on by itself. It highlights the control that does the step, or the way to it, and never changes tab for the player. Its card sits in the bottom-right corner and lets the game be played around it. Skip moves past a step; a step the corporation has already done is skipped, so a returning player starts where they left off. What completes each step is the `WALKTHROUGH_COMPLETION` table in `public/scripts/walkthrough.js`.

When a player first joins the game, the walkthrough starts on their mailbox, highlighting a message they had just received from the "Interstellar Settlement Authority" granting them a license to begin off-world operations. 

The player is then guided to the station, where a new corporation starts docked (Earth Station Prime, above Earth), and shown how to rent an office in the Orbital Executive Suites. The claims office will not file a lease until the corporation has an office there.

To start, the player's corporation has $250,000, no assets, and no employees; thus they have no operating expenses. Renting an office costs $1,000/day: the first lease runs 7 days ($7,000), and it can be extended by 7, 14, 21 or 28 days from the same office. Employees cost $2,000 to hire, and cost $150/day. Hiring happens in the Workforce panel of the Orbital Executive Suites, once an office lease is active.

Now that the player has an office, and some employees, now the corporation needs something to do that makes the company money. To start, that will be mining silicates with a "Basic Extractor Yard". 

To build a basic extractor yard, the corporation will need a mining lease on a suitable planet. The walkthrough will navigate the player to the "ISA Claims & Leases Division" to file a mining lease. A station offers leases only on the body it orbits, so from Earth Station Prime the lease on offer is Earth, Silicate Extraction, for $20,000 (Mars, $25,000, is filed from Mars Orbital Dock). Mining leases have enough space (to start) for 2 buildings. For each mining lease purchased, you need at least 5 employees. If you have 23 employees, you can purchase up to 4 mining leases. 

After this, the walkthrough then guides the player to their new mining lease (Manage Lease, in the ISA Claims & Leases Division) to build a Basic Extractor Yard, which costs $50,000 (6% less with the Supply Forecast Engine research). Then, they will be shown how to start their first mining cycle, choosing a throughput and a duration. Silicates collect at the station as the cycle runs.

After the mining cycle starts, the walkthrough takes the player to the Galactic Exchange to sell their silicates, either by creating a listing or into one of the Standing Buy Orders listed by an NPC buyer. 

It then takes them to the Corporate R&D page to queue "Basic Extraction Analytics", a 2-hour project which yields a 10% boost to all extraction throughput, then to the Assignments page, the ISA Contracting & Assignments Bureau, where Voss works, and to the Overview, where the milestones say what the ISA expects next.

The last step is the starmap, shown as orientation: every system, body and station the ISA administers, where the corporation goes once it outgrows Earth Station Prime. Travel is open from the start; it is simply not what the first hour is about. There Voss hands off: the player can take it from here, and once the corporation is established she has a Silicate Requisition Order for them (contract ms-log-001, which every new corporation is offered). From here, the first walkthrough ends. 
