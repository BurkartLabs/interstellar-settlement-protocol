// The New CEO walkthrough: what each step says, which tab it opens, and which element it highlights.
//
// AB#404: every figure here was checked against the server, not against NEW_PLAYER_EXPERIENCE.md, which had drifted
// with it. If a price or a place changes in the build, change it here in the same commit.
//
// `renderedBy` names where the highlighted element comes from: "index.html" for static markup, or the exported
// render function in html.js that draws it. tests/unit/walkthrough.test.js renders each one and fails if a selector
// matches nothing, so a moved element fails the suite instead of silently highlighting nothing.
export const WALKTHROUGH_STEPS = [
  {
    selector: '.tab-btn[data-tab="inbox"]',
    renderedBy: "index.html",
    title: "Welcome, Agent",
    text: "You’ve just received your ISA settlement license. Check your mailbox for the official charter from the Interstellar Settlement Authority.",
    tab: "inbox"
  },
  {
    selector: '.tab-btn[data-tab="starmap"]',
    renderedBy: "index.html",
    title: "Explore the Starmap",
    text: "The starmap shows every system, planet, moon, and station. You’ll manage operations across multiple locations. You start docked at Earth Station Prime, above Earth, which is where you’ll establish your first office.",
    tab: "starmap"
  },
  {
    selector: '.tab-btn[data-tab="station"]',
    renderedBy: "index.html",
    title: "Station Overview",
    text: "Stations are your base of operations. Here you’ll rent offices, hire personnel, file mining leases, and manage extraction. Your corporation needs a registered office to operate.",
    tab: "station"
  },
  {
    selector: '[data-building-action="building:orbital-executive-suites"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "Rent Your First Office",
    text: "Enter the Orbital Executive Suites and lease an office. Suites cost $1,000 a day: your first lease runs 7 days ($7,000), and you can extend it by 7, 14, 21 or 28 days from the same office. This establishes your corporate presence at the station.",
    tab: "station"
  },
  {
    selector: '[data-building-action="building:orbital-executive-suites"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "Hire Employees",
    text: "With an office lease active, hire personnel in the Workforce panel of the Orbital Executive Suites. Each employee costs $2,000 to recruit and $150/day in payroll. Hire at least 5 employees — you’ll need them for your first mining lease.",
    tab: "station"
  },
  {
    selector: '[data-building-action="building:isa-claims-leases"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "File a Mining Lease",
    text: "Visit the ISA Claims & Leases Division to file an extraction rights application. From Earth Station Prime the lease on offer is Earth, Silicate Extraction, for $20,000. Each lease requires 5 employees on payroll.",
    tab: "station"
  },
  {
    selector: '[data-building-action="building:isa-claims-leases"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "Commission an Extractor Yard",
    text: "In the ISA Claims & Leases Division, open your Earth lease with Manage Lease and commission a Basic Extractor Yard for $50,000. This gives you the equipment needed to mine silicates from the surface.",
    tab: "station"
  },
  {
    selector: '[data-building-action="building:isa-claims-leases"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "Start Your First Mining Cycle",
    text: "On the same lease, set your extraction parameters — throughput (tons/hour) and duration (hours) — then start the cycle. Your extractor mines silicates into your Earth Station Prime inventory as it runs.",
    tab: "station"
  },
  {
    selector: '.tab-btn[data-tab="rnd"]',
    renderedBy: "index.html",
    title: "Research Basic Extraction",
    text: "Queue ‘Basic Extraction Analytics’ in your Corporate R&D lab. This 2-hour research project gives a permanent 10% boost to all extraction throughput.",
    tab: "rnd"
  },
  {
    selector: '.tab-btn[data-tab="market"]',
    renderedBy: "index.html",
    title: "Sell on the Galactic Exchange",
    text: "Once you have silicates in stock, head to the Galactic Exchange. Sell them by creating a listing, or into a Standing Buy Order from an NPC buyer for immediate credits.",
    tab: "market"
  },
  {
    selector: '.tab-btn[data-tab="missions"]',
    renderedBy: "index.html",
    title: "Visit the Assignments Bureau",
    text: "The ISA Contracting & Assignments Bureau is where mission agents post field contracts. Visit Coordinator Voss in her office to review available logistics assignments.",
    tab: "missions"
  },
  {
    selector: '.tab-btn[data-tab="overview"]',
    renderedBy: "index.html",
    title: "You’re Ready!",
    text: "You now know the core loop: mine resources, research upgrades, trade on the market, and climb the corporate ladder. Keep expanding, keep researching, and check your milestones. Good luck, Agent.",
    tab: "overview"
  }
];
