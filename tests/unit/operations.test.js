import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { operationsHtml, operationsRows, operationsSummary } from "../../public/scripts/operations.js";
import { bindSubnav, selectSubpage, showSubpageOf } from "../../public/scripts/subnav.js";
import { stationBuildingCardsHtml } from "../../public/scripts/html.js";

// AB#2471 (Board review items 29 and 30; DOCTRINE P-010): the Operations list of everything in progress, the subpage bar
// the Station and Operations use, and the Offices directory without its lore.
const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 1, 12, 0);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const DATA = {
  corp: {
    mining: { silicateExtractors: [{ name: "Yard A", active: true, startedAt: NOW - H, endsAt: NOW + 3 * H }, { name: "Yard B", active: true, endsAt: NOW - H }] },
    asteroidMining: { activeExpeditions: [{ beltKey: "sol:main-belt", resource: "Silicates", completesAt: NOW + 5 * H }], fabricationQueue: [{ completesAt: NOW + 30 * 60_000 }] },
    refineries: [{ name: "Refinery #1", active: true, chainId: "pressure-vessel-chain", endsAt: NOW + 2 * H }, { name: "Refinery #2", active: false }],
    shipments: [{ status: "in-transit", toStationId: "luna-gateway", arrivesAt: NOW + H }, { status: "delivered", arrivesAt: NOW - H }],
    travel: { toSystemId: "tau-ceti", arrivesAt: NOW + 20 * H },
    training: { queue: [{ unitId: "at", quantity: 3, startsAt: NOW + H, completesAt: NOW + 4 * H }] },
    military: { fleets: [{ name: "Vanguard", transit: { raidId: "raid-1", toStationId: "frost-relay-depot", arrivesAt: NOW + 6 * H } }, { name: "Home", transit: null }] }
  },
  queues: { corporateRnD: [{ techId: "tt-a", name: "Deep Survey", startedAt: NOW - H, durationHours: 3 }, { techId: "tt-b", name: "Queued", durationHours: 2 }], ceoInsight: [{ id: "p1", name: "Leadership", startedAt: NOW, durationHours: 10 }] }
};

describe("the Operations view (AB#2471)", () => {
  it("lists every thing in progress, one row each, soonest first, and nothing finished or merely queued", () => {
    const rows = operationsRows(DATA, NOW, { chainName: () => "Nickel-Iron Alloy Refining", stationName: (id) => ({ "luna-gateway": "Luna Gateway", "frost-relay-depot": "Frost Relay Depot" })[id], systemName: (id) => ({ sol: "Sol", "tau-ceti": "Tau Ceti" })[id], unitName: () => "Attack Troops" });
    expect(rows.map((r) => [r.kind, r.what])).toEqual([
      ["probe", "Survey probe fabrication"],
      ["shipment", "Shipment to Luna Gateway"],
      ["refining", "Refinery #1: Nickel-Iron Alloy Refining"], // ends with the research, and was listed first
      ["research", "Deep Survey"],
      ["mining", "Yard A cycle"],
      ["training", "3 × Attack Troops"],
      ["expedition", "Silicates expedition in Sol"],
      ["raid", "Vanguard raiding Frost Relay Depot"],
      ["program", "Leadership"],
      ["travel", "Travel to Tau Ceti"]
    ]);
    expect(rows.find((r) => r.kind === "training").startsAt).toBe(NOW + H);
  });

  it("draws each row with its time left in UTC and a way to the tab it is run from", () => {
    const rows = operationsRows(DATA, NOW);
    const html = operationsHtml(rows, NOW);
    expect(text(html)).toContain("Probe Survey probe fabrication ends in 30 min (2147-10-01 12:30 UTC)");
    expect(html).toMatch(/data-op-kind="mining"[\s\S]*?data-op-tab="operations" data-op-sub="mining"/);
    expect(html).toMatch(/data-op-kind="research"[\s\S]*?data-op-tab="rnd"/);
    expect(text(html)).toContain("starts in 1 h 0 min (2147-10-01 13:00 UTC), ends in 4 h 0 min");
    expect(operationsSummary(rows)).toMatch(/^10 in progress: 1 Probe, 1 Shipment, 1 Refining, 1 Research/);
    expect(text(operationsHtml([], NOW))).toContain("Nothing in progress.");
  });
});

describe("a screen's subpages (AB#2471)", () => {
  const dom = () => new JSDOM(`<nav id="n" role="tablist">
      <button role="tab" aria-selected="true" aria-controls="p1" data-subpage="one">One</button>
      <button role="tab" aria-selected="false" aria-controls="p2" data-subpage="two" tabindex="-1">Two</button>
    </nav><div id="p1" role="tabpanel">a</div><div id="p2" role="tabpanel" hidden><button id="deep">b</button></div>`).window.document;

  it("shows one panel at a time, by click, by the arrow keys, or by name, and tells who listens", () => {
    const doc = dom();
    const seen = [];
    bindSubnav(doc.getElementById("n"), { onChange: (id) => seen.push(id) }, doc);
    const [one, two] = doc.querySelectorAll('[role="tab"]');
    two.dispatchEvent(new doc.defaultView.MouseEvent("click", { bubbles: true }));
    expect([doc.getElementById("p1").hidden, doc.getElementById("p2").hidden, two.getAttribute("aria-selected"), two.tabIndex]).toEqual([true, false, "true", 0]);
    two.dispatchEvent(new doc.defaultView.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(one.getAttribute("aria-selected")).toBe("true");
    selectSubpage(doc.getElementById("n"), "two", doc);
    expect(seen).toEqual(["two", "one", "two"]);
  });

  it("opens the subpage that holds an element a link or a walkthrough step points to", () => {
    const doc = dom();
    expect(showSubpageOf(doc.getElementById("deep"), doc)).toBe(true);
    expect(doc.getElementById("p2").hidden).toBe(false);
    expect(showSubpageOf(doc.getElementById("deep"), doc)).toBe(false); // already open
  });
});

describe("the Offices directory (AB#2471)", () => {
  it("names each office and its agency with Enter; the lore is behind Enter", () => {
    const html = stationBuildingCardsHtml([{ id: "x", name: "Orbital Executive Suites", faction: "Station Administration", factionCode: "STA", owner: "npc", available: true, action: "building:x", description: "Long description.", flavor: "Long lore." }]);
    expect(text(html)).toContain("STA Orbital Executive Suites Station Administration Enter");
    expect(html).not.toContain("Long lore.");
    expect(html).not.toContain("Long description.");
  });
});
