// The New CEO walkthrough: what each step says, which tab it opens, and which element it highlights.
//
// AB#404: every figure here was checked against the server, not against NEW_PLAYER_EXPERIENCE.md, which had drifted
// with it. If a price or a place changes in the build, change it here in the same commit.
//
// AB#579: it is a briefing from Elara Voss, the coordinator the Bureau assigns every new corporation
// (public/scripts/liaison.js). Her voice follows her bio in MISSION_AGENTS: precise, procedural, unsentimental.
// Nothing here promises what the build does not do.
//
// AB#580: the order follows what a new CEO does first. Their whole first session is at Earth Station Prime, where they
// already are: office, staff, claim, yard, cycle, sale. The Starmap comes last, as orientation for later - travel is
// open from the start (no ship or fleet gate), it is simply not what the first hour is about.
//
// `id` is stable for code and tests; titles are copy and may change. `renderedBy` names where the highlighted element
// comes from: "index.html" for static markup, or the exported render function in html.js that draws it.
// tests/unit/walkthrough.test.js renders each one and fails if a selector matches nothing, so a moved element fails
// the suite instead of silently highlighting nothing, and asserts the order by id. The last step's
// `handoffContractId` is the contract she promises; server/gameState.js FIRST_CONTRACT_ID guarantees a new
// corporation is offered it.
export const WALKTHROUGH_STEPS = [
  {
    id: "licence",
    selector: '.tab-btn[data-tab="inbox"]',
    renderedBy: "index.html",
    title: "Your licence",
    text: "Elara Voss, Contracting & Assignments Bureau. I have been assigned to your corporation, and I will take you through your first day on the station. Start with your inbox: your settlement licence is there, with your Founding Charter reference. Keep it. The ISA will ask for it.",
    tab: "inbox"
  },
  {
    id: "station",
    selector: '.tab-btn[data-tab="station"]',
    renderedBy: "index.html",
    title: "Earth Station Prime",
    text: "You are docked at Earth Station Prime, above Earth, and your first day happens here. The station houses the offices you will need: the executive suites, the claims office, the Exchange hub, and my Bureau. The claims office will not file a lease for a corporation with no registered office here. We fix that first.",
    tab: "station"
  },
  {
    id: "office",
    selector: '[data-building-action="building:orbital-executive-suites"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "An office",
    text: "Enter the Orbital Executive Suites and execute a lease. Suites cost $1,000 a day: your first lease runs 7 days ($7,000), and you can extend it by 7, 14, 21 or 28 days from the same office. Do not let it lapse. Without an active office you cannot start a mining cycle.",
    tab: "station"
  },
  {
    id: "hire",
    selector: '[data-building-action="building:orbital-executive-suites"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "Staff",
    text: "With the lease active, hire in the Workforce panel of the same suites. Each hire costs $2,000 and adds $150 a day to payroll. The ISA requires five employees on payroll for each mining lease you hold, so hire at least five.",
    tab: "station"
  },
  {
    id: "lease",
    selector: '[data-building-action="building:isa-claims-leases"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "A mining claim",
    text: "Next, the ISA Claims & Leases Division. From Earth Station Prime the lease on offer is Earth, Silicate Extraction, for $20,000. The Division checks your headcount before it files anything, so the five come first.",
    tab: "station"
  },
  {
    id: "yard",
    selector: '[data-building-action="building:isa-claims-leases"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "Equipment",
    text: "In the same office, open your Earth lease with Manage Lease and commission a Basic Extractor Yard for $50,000. A lease without equipment is paperwork.",
    tab: "station"
  },
  {
    id: "cycle",
    selector: '[data-building-action="building:isa-claims-leases"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "Your first cycle",
    text: "On that lease, set a throughput in tons per hour and a duration in hours, then start the cycle. Silicates accrue to your Earth Station Prime inventory while it runs. You do not have to wait for it to finish to sell them.",
    tab: "station"
  },
  {
    id: "sell",
    selector: '.tab-btn[data-tab="market"]',
    renderedBy: "index.html",
    title: "Your first sale",
    text: "When you have silicates in stock, take them to the Galactic Exchange. You can list them for other corporations to buy, or sell straight into a Standing Buy Order from an NPC buyer at the posted price. The standing order settles at once; a listing waits for a buyer.",
    tab: "market"
  },
  {
    id: "research",
    selector: '.tab-btn[data-tab="rnd"]',
    renderedBy: "index.html",
    title: "Research",
    text: "Queue Basic Extraction Analytics in Corporate R&D. It is a 2-hour project, and the result is a permanent 10% boost to extraction throughput on every yard you run. It is the first research I would fund.",
    tab: "rnd"
  },
  {
    id: "bureau",
    selector: '.tab-btn[data-tab="missions"]',
    renderedBy: "index.html",
    title: "My Bureau",
    text: "This is the Contracting & Assignments Bureau, where I work. Agents here issue contracts, each with a quota and a deadline. I keep a record of which corporations meet their terms, and I remember it.",
    tab: "missions"
  },
  {
    id: "overview",
    selector: '.tab-btn[data-tab="overview"]',
    renderedBy: "index.html",
    title: "Your milestones",
    text: "This Overview is where the ISA tells you what it expects next: your milestones, and the requirements for your next corporation level. When you are unsure what to do, start here.",
    tab: "overview"
  },
  {
    id: "starmap",
    selector: '.tab-btn[data-tab="starmap"]',
    renderedBy: "index.html",
    title: "From here",
    text: "That is the procedure, and you can take it from here. This is the starmap: every system, body and station the ISA administers. When your corporation outgrows Earth Station Prime, this is where you look next. Before that, once your corporation is established, come and see me on Deck 7. I have a Silicate Requisition Order — Batch 4-7A that needs an operator who delivers on schedule.",
    tab: "starmap",
    handoffContractId: "ms-log-001"
  }
];
