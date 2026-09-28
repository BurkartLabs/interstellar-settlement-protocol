// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// AB#2486 (Board review 2026-09-26, item 35): Assets' Inventory and Infrastructure are filtered to All or one station or
// planet, and sorted by type, location, status or details; the choice is remembered per viewer. Inventory lists goods in
// transit beside stored goods, so its status means something. Seen at 1280x800 and 375x812 in docs/ab-2486.
const inventory = { "earth-station-prime": { Silicates: 4200, Nickel: 900 }, "luna-gateway": { Silicates: 500, "Helium-3": 150 }, "mars-orbital-dock": { Nickel: 400 } };
vi.mock("../../public/scripts/views/shared.js", () => ({ getAllInventory: () => inventory }));
const { appState } = await import("../../public/scripts/state.js");
const { renderAssets, inventoryRows, infrastructureRows, rowMatches, sortRows, filterOptions, ASSETS_STORAGE_KEY } = await import("../../public/scripts/views/assets.js");

const STATIONS = [
  { id: "earth-station-prime", name: "Earth Station Prime", body: "Earth" },
  { id: "luna-gateway", name: "Luna Gateway", body: "Luna" },
  { id: "mars-orbital-dock", name: "Mars Orbital Dock", body: "Mars" }
];
const NOW = Date.UTC(2147, 8, 27);
const corp = {
  offices: [{ stationId: "earth-station-prime", rentedUntil: NOW + 1e9 }, { stationId: "luna-gateway", rentedUntil: NOW - 1 }],
  miningLeases: [{ id: "a", body: "Luna", ref: "LSE-2147-A1B2C3", buildingSlots: 2 }, { id: "b", body: "Mars", ref: "LSE-2147-D4E5F6", buildingSlots: 3 }],
  mining: { silicateExtractors: [
    { id: "x1", name: "Tycho Yard", leaseId: "a", body: "Luna", active: true, totalMined: 5200 },
    { id: "x2", name: "Ares Yard", leaseId: "b", body: "Mars", active: false, totalMined: 900 },
    { id: "x3", name: "Olympus Yard", leaseId: "b", body: "Mars", active: true, downtimeActive: true, totalMined: 12800 }
  ] },
  shipments: [{ toStationId: "earth-station-prime", status: "in-transit", lines: [{ item: "Silicates", quantity: 300 }] }]
};

// the viewer's storage: Node's own localStorage (undefined without --localstorage-file) hides jsdom's, so a plain one
const saved = new Map();
const storage = { getItem: (k) => (saved.has(k) ? saved.get(k) : null), setItem: (k, v) => void saved.set(k, String(v)), clear: () => saved.clear() };
Object.defineProperty(window, "localStorage", { value: storage, configurable: true });

const inv = () => inventoryRows(inventory, STATIONS, corp.shipments);
const infra = () => infrastructureRows(corp, STATIONS, NOW);
const cells = (panel, col) => [...document.querySelectorAll(`#assets-panel-${panel} tbody tr`)].map((tr) => tr.cells[col]?.textContent.trim());

beforeEach(() => {
  storage.clear();
  appState.stationRegistry = STATIONS;
  document.body.innerHTML = '<article id="assets"><div id="assets-content"></div></article>';
});

describe("Assets' rows, filter and sort (AB#2486)", () => {
  it("lists stored goods and goods in transit, each with a station and its planet or moon", () => {
    const rows = inv();
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r.status === "In transit")).toMatchObject({ type: "Silicates", stationId: "earth-station-prime", body: "Earth", amount: 300 });
  });

  it("filters to one station, or to a planet or moon with whatever is at it", () => {
    expect(inv().filter((r) => rowMatches(r, "station:luna-gateway")).map((r) => r.type).sort()).toEqual(["Helium-3", "Silicates"]);
    // Luna: the goods at Luna Gateway, the lease on Luna, the yard on it, and the expired office at Luna Gateway
    expect(infra().filter((r) => rowMatches(r, "body:Luna")).map((r) => r.type).sort()).toEqual(["Extractor", "Mining Lease", "Office Lease"]);
    expect(inv().filter((r) => rowMatches(r, "all"))).toHaveLength(6);
  });

  it("sorts by each of type, location, status and details", () => {
    expect(sortRows(inv(), "type").map((r) => r.type)).toEqual(["Helium-3", "Nickel", "Nickel", "Silicates", "Silicates", "Silicates"]);
    expect(sortRows(inv(), "location").map((r) => r.location)).toEqual(["Earth Station Prime", "Earth Station Prime", "Earth Station Prime", "Luna Gateway", "Luna Gateway", "Mars Orbital Dock"]);
    expect(sortRows(inv(), "status")[0].status).toBe("In transit");
    expect(sortRows(inv(), "details").map((r) => r.amount)).toEqual([4200, 900, 500, 400, 300, 150]);
    expect(sortRows(infra(), "status").map((r) => r.status)).toEqual(["Active", "Active", "Active", "Active", "Downtime", "Expired", "Idle"]);
    expect(sortRows(infra(), "details")[0]).toMatchObject({ type: "Mining Lease", body: "Mars" });
  });

  it("offers the stations and the planets and moons anything is at, each once", () => {
    const o = filterOptions([...inv(), ...infra()], STATIONS);
    expect(o.stations.map((s) => s.label)).toEqual(["Earth Station Prime", "Luna Gateway", "Mars Orbital Dock"]);
    expect(o.bodies.map((b) => b.label)).toEqual(["Earth", "Luna", "Mars"]);
  });
});

describe("the Assets screen's controls (AB#2486)", () => {
  it("filters and sorts both tabs from its two controls, and remembers the choice", () => {
    renderAssets({ corp });
    const pick = (id, value) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event("change")); };
    pick("assets-filter", "body:Mars");
    pick("assets-sort", "details");
    expect(cells("inventory", 0)).toEqual(["Nickel"]);
    expect(cells("infrastructure", 0)).toEqual(expect.arrayContaining(["Extractor"]));
    expect(cells("infrastructure", 2)).toEqual(["Active", "Downtime", "Idle"]); // 13,700 then 12,800 then 900 mined
    expect(JSON.parse(storage.getItem(ASSETS_STORAGE_KEY))).toEqual({ filter: "body:Mars", sort: "details" });

    document.body.innerHTML = '<article id="assets"><div id="assets-content"></div></article>'; // a reload
    renderAssets({ corp });
    expect(document.getElementById("assets-filter").value).toBe("body:Mars");
    expect(document.getElementById("assets-sort").value).toBe("details");
  });

  it("shows All when the remembered place no longer holds anything, and says so when a filter empties a tab", () => {
    storage.setItem(ASSETS_STORAGE_KEY, JSON.stringify({ filter: "body:Titan", sort: "type" }));
    renderAssets({ corp });
    expect(document.getElementById("assets-filter").value).toBe("all");
    const el = document.getElementById("assets-filter");
    el.value = "station:mars-orbital-dock";
    el.dispatchEvent(new Event("change"));
    expect(cells("infrastructure", 0)).toEqual(["No infrastructure at Mars Orbital Dock."]);
  });

  it("draws a shipment as bound for its station", () => {
    renderAssets({ corp });
    const transit = [...document.querySelectorAll("#assets-panel-inventory tbody tr")].find((tr) => tr.textContent.includes("In transit"));
    expect(transit.cells[1].textContent.trim()).toBe("→ Earth Station Prime");
  });
});
