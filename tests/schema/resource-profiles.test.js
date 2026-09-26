import { describe, it, expect } from "vitest";
import fs from "node:fs";
import request from "supertest";
import { getApp } from "../helpers/app.js";

// ISP-132 (AB#826): every body in data/systems.json carries a resource profile, the items an extraction on it yields
// with each one's concentration, from docs/design/tier3-resources.md (AB#822). The design's own tables are parsed
// here, so the data and the document cannot drift apart unnoticed.
const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const SYSTEMS = JSON.parse(read("data/systems.json"));
const ITEMS = new Set(JSON.parse(read("data/items.json")).items.map((i) => i.name));
const DESIGN = read("docs/design/tier3-resources.md");
const bodies = SYSTEMS.flatMap((s) => s.bodies.map((b) => ({ system: s, body: b })));

/** "Silicates 45, Iron Ore 30" -> [["Silicates", 45], ["Iron Ore", 30]] */
const shares = (text) => text.split(",").map((part) => part.trim().match(/^(.+?) (\d+)$/)).filter(Boolean).map((m) => [m[1], Number(m[2])]);
const CLASS_LABELS = {
  "Crater planet": "crater planet", "Lava planet or moon": "lava", "Clouds planet or moon": "clouds", "Ice world or ice moon": "ice",
  "Gas giant (bands)": "gas giant", "Ice giant": "ice giant", "Crater moon": "crater moon"
};
const CLASS = Object.fromEntries([...DESIGN.matchAll(/^\| ([^|]+?) \| ([^|]+?) \| [^|]+ \|$/gm)]
  .filter((m) => CLASS_LABELS[m[1]]).map((m) => [CLASS_LABELS[m[1]], shares(m[2])]));
const SOL_LABELS = { "Crater planet": "crater planet", "Clouds planet": "clouds", "Gas giant": "gas giant", "Ice giant": "ice giant", "Ice moon": "ice", "Lava moon": "lava", "Crater moon": "crater moon" };
const SOL = {};
for (const m of DESIGN.matchAll(/^\| ([^|]+?) \| ([^|]+?) \|$/gm)) {
  const label = m[1].startsWith("Clouds moon") ? "titan" : SOL_LABELS[m[1]];
  if (label) for (const name of m[2].split(",")) SOL[name.trim()] = label;
}

/** What the design says a body yields, as shares of 100. */
function designed(system, body) {
  if (["earth", "mars", "luna"].includes(body.id)) return [["Silicates", 100]]; // until their tracks are built (section 3)
  if (body.type === "Field") return Object.entries(body.composition);
  let cls = system.id === "sol" ? SOL[body.name] : null;
  if (!cls) {
    const surf = body.style?.surface;
    cls = { craters: body.type === "Planet" ? "crater planet" : "crater moon", lava: "lava", clouds: "clouds", ice: "ice", bands: "gas giant" }[surf];
  }
  if (cls === "titan") return CLASS.clouds.map(([i, s]) => [i === "Bauxite" ? "Carbon" : i, s]).reduce((acc, [i, s]) => { const e = acc.find((x) => x[0] === i); if (e) e[1] += s; else acc.push([i, s]); return acc; }, []);
  let out = CLASS[cls].map(([i, s]) => [i, s]);
  if (["rare", "exotic"].includes(system.rarity) && (cls === "lava" || cls === "crater planet")) {
    const extra = cls === "lava" ? "Thorium" : "Cobalt";
    out = out.map(([i, s]) => [i, i === "Iron Ore" ? s - 10 : s]);
    const e = out.find(([i]) => i === extra);
    if (e) e[1] += 10; else out.push([extra, 10]);
  }
  return out;
}
const asMap = (list) => Object.fromEntries(list.map(([i, s]) => [i, Math.round(s * 1000) / 1000]));

describe("resource profiles on every body (AB#826)", () => {
  it("the design's class tables were read: seven classes and Sol's fourteen unstyled bodies", () => {
    expect(Object.keys(CLASS).sort()).toEqual(Object.values(CLASS_LABELS).sort());
    expect(Object.keys(SOL)).toHaveLength(14);
  });

  it("every body has a profile of catalog items, each concentration between 0 and 1, adding to 1, no item twice", () => {
    expect(bodies.length).toBeGreaterThan(50);
    for (const { body } of bodies) {
      expect(Array.isArray(body.resourceProfile), body.id).toBe(true);
      const items = body.resourceProfile.map((p) => p.item);
      expect(new Set(items).size, body.id).toBe(items.length);
      for (const { item, concentration } of body.resourceProfile) {
        expect(ITEMS.has(item), `${body.id}: ${item}`).toBe(true);
        expect(concentration > 0 && concentration <= 1, `${body.id}: ${item} ${concentration}`).toBe(true);
      }
      if (body.resourceProfile.length) expect(body.resourceProfile.reduce((s, p) => s + p.concentration, 0), body.id).toBeCloseTo(1, 9);
    }
  });

  it("matches docs/design/tier3-resources.md for every body: its class, the rarity rule, Titan, the belts and the three leases", () => {
    for (const { system, body } of bodies) {
      const got = asMap(body.resourceProfile.map((p) => [p.item, p.concentration * 100]));
      expect(got, `${system.id}/${body.id}`).toEqual(asMap(designed(system, body)));
    }
    const byId = Object.fromEntries(bodies.map(({ body }) => [body.id, body]));
    expect(byId["ee-lyra"].resourceProfile.find((p) => p.item === "Thorium")?.concentration).toBe(0.1); // exotic lava moon
    expect(byId["lc-b"].resourceProfile.find((p) => p.item === "Cobalt")?.concentration).toBe(0.1); // rare crater planet
    expect(byId["bn-iron"].resourceProfile.find((p) => p.item === "Cobalt")).toBeUndefined(); // uncommon: no Tier 2
  });

  it("is served read-only with the system catalog", async () => {
    const { app } = await getApp();
    const res = await request(app).get("/api/systems");
    expect(res.status).toBe(200);
    const served = res.body.systems.flatMap((s) => s.bodies);
    expect(served.length).toBe(bodies.length);
    for (const b of served) expect(b.resourceProfile, b.id).toEqual(bodies.find((x) => x.body.id === b.id).body.resourceProfile);
    for (const method of ["post", "put", "patch", "delete"]) expect((await request(app)[method]("/api/systems").send({})).status, method).toBe(404);
  });
});
