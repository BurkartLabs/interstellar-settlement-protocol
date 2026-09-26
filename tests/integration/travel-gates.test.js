import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { NAVIGATION, SYSTEMS_DATA } from "../../server/game/catalog.js";
import { interstellarTravelMs } from "../../server/travel.js";

// ISP-117 (AB#809): travel to the new systems. Each system's gate is enforced by the server's travel route, from the
// catalog; hops and time come from the catalog's lanes; and a hostile request changes nothing.
const RESEARCH = JSON.parse(fs.readFileSync(new URL("../../data/research.json", import.meta.url), "utf8")).nodes;
const DESIGN = fs.readFileSync(new URL("../../docs/design/starmap-20.md", import.meta.url), "utf8");

async function corporation(unlockedTech = [], changes = {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => { state.corp.unlockedTech = unlockedTech; Object.assign(state.corp, changes); });
  const travel = (body) => authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/travel`).send(body);
  const corp = () => getAccountById(account.id).state.corp;
  return { travel, corp };
}
const place = (corp) => JSON.stringify({ travel: corp.travel || null, system: corp.currentSystemId || "sol", station: corp.currentStationId || null });

describe("each access tier's gate, on the server (AB#809)", () => {
  const TIERS = [
    { tier: "Near-Star", system: "lalande-21185", gate: "tt-proxima-navigation", name: "Near-Star Navigation Array" },
    { tier: "Near-Star", system: "ross-154", gate: "tt-proxima-navigation", name: "Near-Star Navigation Array" },
    { tier: "Deep-Star", system: "sirius", gate: "tt-deep-star-navigation", name: "Deep-Star Cartography Suite", has: ["tt-proxima-navigation"] },
    { tier: "Deep-Star", system: "lacaille-9352", gate: "tt-deep-star-navigation", name: "Deep-Star Cartography Suite", has: ["tt-proxima-navigation"] }
  ];
  for (const t of TIERS) {
    it(`${t.tier}: ${t.system} is refused, naming ${t.name}, without it, and changes nothing`, async () => {
      const c = await corporation(t.has || []);
      const before = place(c.corp());
      const res = await c.travel({ toSystemId: t.system });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(t.name);
      expect(place(c.corp())).toBe(before);
    });
    it(`${t.tier}: ${t.system} is reached with ${t.gate}`, async () => {
      const c = await corporation([...(t.has || []), t.gate]);
      const res = await c.travel({ toSystemId: t.system });
      expect(res.status, JSON.stringify(res.body.error)).toBe(200);
      expect(c.corp().travel).toMatchObject({ travelType: "interstellar", fromSystemId: "sol", toSystemId: t.system });
    });
  }

  it("every system's gate is a research node that exists, and the design's tiers 3 and 4 have theirs, level-gated", () => {
    const byId = Object.fromEntries(RESEARCH.map((n) => [n.id, n]));
    for (const s of SYSTEMS_DATA) if (s.accessResearch) expect(byId[s.accessResearch], s.id).toBeDefined();
    expect(byId["tt-long-baseline-navigation"]).toMatchObject({ prereqs: ["tt-deep-star-navigation"], requiresCorpLevel: 28, tier: 4 });
    expect(byId["tt-frontier-cartography"]).toMatchObject({ prereqs: ["tt-long-baseline-navigation"], requiresCorpLevel: 34, tier: 5 });
    // The Deep-Star node no longer promises "all future systems": the design gives those to the two new nodes.
    expect(byId["tt-deep-star-navigation"].effect).not.toMatch(/all/i);
    for (const id of ["tt-long-baseline-navigation", "tt-frontier-cartography"]) expect(DESIGN, id).toContain(`\`${id}\``);
  });
});

describe("the design's tier 3 gate, on the server (AB#809)", () => {
  it("Long-Baseline Jump Plotting is refused below Level 28, naming the level, with its prerequisite held", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    mutateAccountState(account.id, (state) => {
      state.corp.level = 12;
      state.corp.finances.credits = 1_000_000;
      state.corp.unlockedTech = ["tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast", "tt-energy-routing", "tt-fleet-coordination", "tt-proxima-navigation", "tt-deep-star-navigation"];
    });
    const res = await authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/queue-rnd`).send({ techId: "tt-long-baseline-navigation" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("28");
    expect(getAccountById(account.id).state.corp.unlockedTech).not.toContain("tt-long-baseline-navigation");
  });
});

describe("hops and time from the catalog's lanes (AB#809)", () => {
  it("sample routes count the design's hops, and an hour each", () => {
    const routes = [["sol", "lalande-21185", 1], ["sol", "ross-154", 1], ["sol", "sirius", 2], ["sol", "ross-248", 2],
      ["sol", "luyten-726-8", 2], ["sol", "lacaille-9352", 2], ["sol", "epsilon-eridani", 3], ["sirius", "lacaille-9352", 4], ["ross-248", "sirius", 4]];
    for (const [from, to, hops] of routes) {
      expect(NAVIGATION.systemHops(from, to), `${from} -> ${to}`).toBe(hops);
      expect(interstellarTravelMs(NAVIGATION.systemHops(from, to)), `${from} -> ${to}`).toBe(hops * 3_600_000);
    }
  });

  it("a jump with no route through the lanes is refused, not a 99-hour trip; the way home to Sol stays open", async () => {
    const c = await corporation(["tt-proxima-navigation", "tt-deep-star-navigation"], { currentSystemId: "retired-system", currentStationId: null });
    const before = place(c.corp());
    const res = await c.travel({ toSystemId: "sirius" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("No jump route");
    expect(place(c.corp())).toBe(before);
    const home = await c.travel({ toSystemId: "sol" });
    expect(home.status).toBe(200);
  });
});

describe("a hostile travel request changes nothing (AB#809, DOCTRINE constraint 1)", () => {
  const BAD = [
    ["an unknown system", { toSystemId: "vega" }],
    ["an unknown station", { toStationId: "nowhere-dock" }],
    ["a number", { toSystemId: 5 }],
    ["a negative", { toSystemId: -1 }],
    ["NaN", { toSystemId: Number.NaN }],
    ["a float", { toSystemId: 2.5 }],
    ["an oversized string", { toSystemId: "x".repeat(10_000) }],
    ["an array holding a real id", { toSystemId: ["sirius"] }],
    ["an object", { toSystemId: { id: "sirius" } }],
    ["both destinations", { toSystemId: "lalande-21185", toStationId: "earth-station-prime" }],
    ["neither", {}]
  ];
  for (const [what, body] of BAD) {
    it(`${what}: 400, and the corporation is where it was`, async () => {
      const c = await corporation(["tt-proxima-navigation", "tt-deep-star-navigation"]);
      const before = place(c.corp());
      const res = await c.travel(body);
      expect(res.status).toBe(400);
      expect(place(c.corp())).toBe(before);
    });
  }
});
