import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { SYSTEMS_DATA } from "../../server/game/catalog.js";
import { STATION_JURISDICTIONS, stationJurisdictionProblems } from "../../server/game/stations.js"; // ISP-209 (AB#904)
import { travelTick } from "../../server/ticks.js";

// ISP-118 (AB#810): every station says who holds it, and each of AB#806's systems has a neutral station a player can
// dock at and rent an office in, as docs/design/starmap-20.md places them.
const STATIONS = JSON.parse(fs.readFileSync(new URL("../../data/stations.json", import.meta.url), "utf8")).stations;
const DESIGN = fs.readFileSync(new URL("../../docs/design/starmap-20.md", import.meta.url), "utf8");

describe("every station's jurisdiction (AB#810)", () => {
  it("is set on all of them, and is a known one", () => {
    expect(STATIONS.length).toBeGreaterThanOrEqual(14);
    for (const s of STATIONS) expect(STATION_JURISDICTIONS, s.id).toContain(s.jurisdiction);
    expect(stationJurisdictionProblems(STATIONS)).toEqual([]);
  });

  it("a station without one, or with one nothing knows, is caught by id", () => {
    expect(stationJurisdictionProblems([{ id: "a" }, { id: "b", jurisdiction: "pirate" }, { id: "c", jurisdiction: "neutral" }]))
      .toEqual(["a: null", 'b: "pirate"']);
  });
});

describe("the new systems' stations (AB#810)", () => {
  const section = DESIGN.split("## Stations (ISP-118, AB#810)")[1].split("\n## ")[0];
  const rows = section.split(/\r?\n/).map((line) => line.split("|").slice(1, -1).map((c) => c.trim())).filter((c) => /^`[a-z0-9-]+`$/.test(c[1] || ""));

  it("are the design's, field by field, and every system in the catalog has at least one station", () => {
    expect(rows.length).toBe(16); // AB#810's six, and AB#807's ten for the second half
    for (const [name, id, designation, systemName, body, tier, jurisdiction] of rows) {
      const station = STATIONS.find((s) => s.id === id.replace(/`/g, ""));
      expect(station, id).toBeDefined();
      expect([station.name, station.designation, station.body, String(station.tier), station.jurisdiction]).toEqual([name, designation, body, tier, jurisdiction]);
      expect(SYSTEMS_DATA.find((s) => s.id === station.systemId).name).toBe(systemName);
    }
    for (const system of SYSTEMS_DATA) expect(STATIONS.some((s) => s.systemId === system.id), system.id).toBe(true);
  });

  it("carry no price of their own: office rent is the one rate (Bug #1032)", () => {
    for (const s of STATIONS) expect(s.officeCost, s.id).toBeUndefined();
  });
});

describe("a player docks at a new station and rents an office there (AB#810)", () => {
  it("jumps to Lalande 21185, docks at Lalande Registry Station, rents a week's office", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const api = authed(app, accessToken);
    const play = (path, body) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body);
    const corp = () => getAccountById(account.id).state.corp;
    // Time passing is the only thing set by hand: each trip's arrival is moved to now, then the server's own tick lands it.
    const arrive = () => { mutateAccountState(account.id, (s) => { s.corp.travel.arrivesAt = Date.now() - 1; }, { settleMining: false }); travelTick(); };
    mutateAccountState(account.id, (s) => { s.corp.unlockedTech = ["tt-proxima-navigation"]; });

    const jump = await play("travel", { toSystemId: "lalande-21185" });
    expect(jump.status, JSON.stringify(jump.body.error)).toBe(200);
    expect(jump.body.receipt.next).toContain("Lalande Registry Station"); // AB#2333's receipt names it now
    arrive();
    expect(corp().currentSystemId).toBe("lalande-21185");

    const dock = await play("travel", { toStationId: "lalande-registry-station" });
    expect(dock.status, JSON.stringify(dock.body.error)).toBe(200);
    arrive();
    expect(corp().currentStationId).toBe("lalande-registry-station");

    const credits = corp().finances.credits;
    const rent = await play("rent-office", { stationId: "lalande-registry-station", durationDays: 7 });
    expect(rent.status, JSON.stringify(rent.body.error)).toBe(200);
    expect(corp().offices.some((o) => o.stationId === "lalande-registry-station" && o.rentedUntil > Date.now())).toBe(true);
    expect(credits - corp().finances.credits).toBe(7_000);
  });
});
