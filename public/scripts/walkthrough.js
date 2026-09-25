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
// AB#581: the walkthrough watches the game. Each step is complete when WALKTHROUGH_COMPLETION (below) says so - a
// fact about the corporation, or a named UI event - and it advances by itself when the player does the thing. Next is
// Skip. `actionSelectors` name the control that does the step, most specific first, for when the player is inside a
// building; the card or tab named by `selector` is the way in.
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
    text: "You are docked at Earth Station Prime, above Earth, and your first day happens here. Open the Station tab: it houses the offices you will need: the executive suites, the claims office, the Exchange hub, and my Bureau. The claims office will not file a lease for a corporation with no registered office here. We fix that first.",
    tab: "station"
  },
  {
    id: "office",
    selector: '[data-building-action="building:orbital-executive-suites"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "An office",
    text: "Enter the Orbital Executive Suites and execute a lease. Suites cost $1,000 a day: your first lease runs 7 days ($7,000), and you can extend it by 7, 14, 21 or 28 days from the same office. Do not let it lapse. Without an active office you cannot start a mining cycle.",
    tab: "station",
    actionSelectors: ['[id="rent-office-btn"]']
  },
  {
    id: "hire",
    selector: '[data-building-action="building:orbital-executive-suites"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "Staff",
    text: "With the lease active, hire in the Workforce panel of the same suites. Each hire costs $2,000 and adds $150 a day to payroll. The ISA requires five employees on payroll for each mining lease you hold, so hire at least five.",
    tab: "station",
    actionSelectors: ['[id="office-hire-form"]']
  },
  {
    id: "lease",
    selector: '[data-building-action="building:isa-claims-leases"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "A mining claim",
    text: "Next, the ISA Claims & Leases Division. From Earth Station Prime the lease on offer is Earth, Silicate Extraction, for $20,000. The Division checks your headcount before it files anything, so the five come first.",
    tab: "station",
    actionSelectors: [".purchase-lease-btn"]
  },
  {
    id: "yard",
    selector: '[data-building-action="building:isa-claims-leases"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "Equipment",
    text: "In the same office, open your Earth lease with Manage Lease and commission a Basic Extractor Yard for $50,000. A lease without equipment is paperwork.",
    tab: "station",
    actionSelectors: ['[id="lease-build-extractor-btn"]', ".lease-manage-btn"]
  },
  {
    id: "cycle",
    selector: '[data-building-action="building:isa-claims-leases"]',
    renderedBy: "stationBuildingCardsHtml",
    title: "Your first cycle",
    text: "On that lease, set a throughput in tons per hour and a duration in hours, then start the cycle. Silicates accrue to your Earth Station Prime inventory while it runs. You do not have to wait for it to finish to sell them.",
    tab: "station",
    actionSelectors: [".lease-mine-form", ".lease-manage-btn"]
  },
  {
    id: "sell",
    selector: '.tab-btn[data-tab="market"]',
    renderedBy: "index.html",
    title: "Your first sale",
    text: "When you have silicates in stock, take them to the Galactic Exchange. You can list them for other corporations to buy, or sell straight into a Standing Buy Order from an NPC buyer at the posted price. The standing order settles at once; a listing waits for a buyer.",
    tab: "market",
    actionSelectors: ['.npc-sell-btn[data-npc-item="Silicates"]']
  },
  {
    id: "research",
    selector: '.tab-btn[data-tab="rnd"]',
    renderedBy: "index.html",
    title: "Research",
    text: "Queue Basic Extraction Analytics in Corporate R&D. It is a 2-hour project, and the result is a permanent 10% boost to extraction throughput on every yard you run. It is the first research I would fund.",
    tab: "rnd",
    actionSelectors: ['.rnd-enqueue-btn[data-tech-id="tt-basic-extraction"]']
  },
  {
    id: "bureau",
    selector: '.tab-btn[data-tab="missions"]',
    renderedBy: "index.html",
    title: "My Bureau",
    text: "Open Assignments: the Contracting & Assignments Bureau, where I work. Agents here issue contracts, each with a quota and a reward, and no clock: deliver when you have the goods. Every contract you complete raises your standing with the agent who issued it.",
    tab: "missions"
  },
  {
    id: "overview",
    selector: '.tab-btn[data-tab="overview"]',
    renderedBy: "index.html",
    title: "Your milestones",
    text: "Open your Overview. It is where the ISA tells you what it expects next: your milestones, and the requirements for your next corporation level. When you are unsure what to do, start here.",
    tab: "overview"
  },
  {
    id: "starmap",
    selector: '.tab-btn[data-tab="starmap"]',
    renderedBy: "index.html",
    title: "From here",
    text: "That is the procedure, and you can take it from here. Open the starmap: every system, body and station the ISA administers. When your corporation outgrows Earth Station Prime, this is where you look next. Before that, once your corporation is established, come and see me on Deck 7. I have a Silicate Requisition Order — Batch 4-7A that needs an operator who delivers what they sign for.",
    tab: "starmap",
    handoffContractId: "ms-log-001"
  }
];

// AB#581: what completes each step, in one table beside the steps. A `state` predicate reads the corporation state the
// client already holds (appState.data), so a returning player who has already done a thing skips its step; an
// `event` names something the player does in the UI that leaves no trace in state (app.js reports "tab:<id>" when a
// tab opens). `means` is the sentence the tests and the PR use for it. tests/integration/walkthrough-predicates.test.js
// performs each action through the real route on a freshly registered corporation and checks its predicate either side.
import { employeesForNextLease } from "./leaseStaffing.js";
const FIRST_LEASE_EMPLOYEES = employeesForNextLease(0); // AB#1202: what the server wants for a first lease
const FIRST_RESEARCH_ID = "tt-basic-extraction";
const extractorsOf = (state) => state?.corp?.mining?.silicateExtractors || [];

export const WALKTHROUGH_COMPLETION = {
  licence: { means: "the inbox was opened", event: "tab:inbox" },
  station: { means: "the Station tab was opened", event: "tab:station" },
  office: {
    means: "an office lease is active at the station the corporation is docked at",
    state: (state, now) => (state?.corp?.offices || []).some(
      (o) => o.stationId === state.corp.currentStationId && Number(o.rentedUntil) > now
    )
  },
  hire: {
    means: `at least ${FIRST_LEASE_EMPLOYEES} employees on payroll`,
    state: (state) => Number(state?.corp?.employeeCount || 0) >= FIRST_LEASE_EMPLOYEES
  },
  lease: { means: "a mining lease is filed", state: (state) => (state?.corp?.miningLeases || []).length > 0 },
  yard: { means: "an extractor yard is commissioned", state: (state) => extractorsOf(state).length > 0 },
  cycle: {
    means: "a mining cycle is running, or has run",
    state: (state) => extractorsOf(state).some((e) => e.active || e.lastCompletedAt || Number(e.totalMined) > 0)
  },
  sell: {
    means: "a sale has settled (to a standing buy order or a player), not merely listed",
    state: (state) => (state?.corp?.tradeHistory || []).some((t) => t.type === "sold" || t.type === "sold-npc")
  },
  research: {
    means: "Basic Extraction Analytics is queued or researched",
    state: (state) => (state?.queues?.corporateRnD || []).some((q) => q.techId === FIRST_RESEARCH_ID)
      || (state?.corp?.unlockedTech || []).includes(FIRST_RESEARCH_ID)
  },
  bureau: { means: "Assignments was opened", event: "tab:missions" },
  overview: { means: "the Overview was opened", event: "tab:overview" },
  starmap: { means: "the Starmap was opened", event: "tab:starmap" }
};

/** Whether the player has done what a step asks. `events` holds the UI events seen since the walkthrough started. */
export function isStepComplete(step, state, events = new Set(), now = Date.now()) {
  const done = WALKTHROUGH_COMPLETION[step.id];
  if (!done) return false;
  if (done.event) return events.has(done.event);
  return Boolean(done.state(state, now));
}

/** The first step at or after `from` that is not yet done; WALKTHROUGH_STEPS.length when every one is. */
export function nextStepIndex(from, state, events = new Set(), now = Date.now()) {
  let i = Math.max(0, from);
  while (i < WALKTHROUGH_STEPS.length && isStepComplete(WALKTHROUGH_STEPS[i], state, events, now)) i += 1;
  return i;
}

/**
 * What to highlight for a step. `find(selector)` returns { exists, visible } for the live page. The step's own
 * `selector` must exist or the step has drifted: then nothing is highlighted and `missing` is true, for app.js to
 * warn about. Otherwise the first visible of: the control that does it, the way in, the way back out of another
 * station building, and the tab it lives on.
 */
export function chooseHighlight(step, find) {
  if (!find(step.selector).exists) return { selector: null, missing: true };
  const candidates = [
    ...(step.actionSelectors || []),
    step.selector,
    ...(step.renderedBy === "stationBuildingCardsHtml" ? ['[id="station-back-btn"]'] : []),
    `.tab-btn[data-tab="${step.tab}"]`
  ];
  return { selector: candidates.find((c) => find(c).visible) || null, missing: false };
}

/** Space kept between the highlighted control and the edges of the band it is scrolled into, in CSS pixels. */
export const WALKTHROUGH_SCROLL_MARGIN = 12;

/**
 * Bug #1083: how far to scroll the page so the highlighted control can be seen. The briefing card sits at the bottom
 * of the screen, over more than half of it on a phone, and the sticky header covers the top; scrolling the control
 * to the centre of the window put it behind the card. The clear band runs from the header's bottom to the card's
 * top, or to the bottom of the window when the card is not in the control's column (a desktop, where the card sits
 * to the right). Returns the pixels to scroll down (negative is up), and 0 when the control is already clear.
 * Every argument is a viewport rectangle or number: { top, bottom, left, right }.
 */
export function walkthroughScrollDelta({ viewportHeight, headerBottom = 0, card = null, target }) {
  const sharesColumn = card && card.right > target.left && card.left < target.right;
  const bandTop = Math.max(0, headerBottom) + WALKTHROUGH_SCROLL_MARGIN;
  const bandBottom = (sharesColumn ? Math.min(card.top, viewportHeight) : viewportHeight) - WALKTHROUGH_SCROLL_MARGIN;
  if (target.top >= bandTop && target.bottom <= bandBottom) return 0;
  const height = target.bottom - target.top;
  if (height >= bandBottom - bandTop) return Math.round(target.top - bandTop); // too tall for the band: show its top
  return Math.round((target.top + target.bottom) / 2 - (bandTop + bandBottom) / 2);
}
