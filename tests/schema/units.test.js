import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { BUILD_SITES_OUTSIDE_CATALOGUE, PENDING_BUILD_SITES, UNITS, UNIT_FIELDS, UNIT_IDS, backfillCorpMilitary, ensureCorpMilitary, knownBuildSites, militaryPower, unitCatalogProblems } from "../../server/game/units.js";
import { fleetStatus } from "../../server/game/progression.js";
import { FLEET_COORDINATION_BONUS, FLEET_COORDINATION_TECH } from "../../server/game/catalog.js";

// ISP-167 (AB#861): data/units.json, the unit table of docs/design/v0.10-combat.md. T-019: every research id, build
// site and good a unit names exists in its own catalog, or this fails here rather than in play.

const root = path.resolve(import.meta.dirname, "..", "..");
const json = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const FILE = json("data/units.json");
const RESEARCH = json("data/research.json").nodes;
const ITEMS = json("data/items.json").items;
const BUILDINGS = json("data/player-buildings.json").buildings;

/** The design document's unit table, cell by cell, keyed by the id column. */
function designTable() {
  const doc = fs.readFileSync(path.join(root, "docs/design/v0.10-combat.md"), "utf8");
  const lines = doc.split(/\r?\n/);
  const head = lines.findIndex((l) => l.startsWith("| id | Unit | Credits |"));
  const cols = lines[head].split("|").slice(1, -1).map((c) => c.trim());
  const rows = {};
  for (const line of lines.slice(head + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const row = Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
    rows[row.id.replace(/`/g, "")] = row;
  }
  return rows;
}
const num = (s) => Number(String(s).replace(/,/g, ""));
const minutes = (s) => { const h = /(\d+)\s*h/.exec(s), m = /(\d+)\s*min/.exec(s) ?? /h\s*(\d+)$/.exec(s); return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0); };
const SITE_NAMES = { "Orbital Shipyard": "orbital-shipyard", Headquarters: "headquarters" };

describe("data/units.json (AB#861)", () => {
  it("is sound: every field, known goods, research and sites, and the counters as one five-way cycle", () => {
    expect(unitCatalogProblems(FILE)).toEqual([]);
  });

  it("holds every unit of the design table, with every field equal to the document's", () => {
    const table = designTable();
    expect(Object.keys(table).sort()).toEqual([...UNIT_IDS].sort());
    for (const u of FILE.units) {
      const row = table[u.id];
      for (const field of Object.keys(UNIT_FIELDS)) expect(u, `${u.id} has ${field}`).toHaveProperty(field);
      expect(u.credits, u.id).toBe(num(row.Credits));
      const [qty, ...good] = row.Goods.split(" ");
      expect(u.goods, u.id).toEqual({ [good.join(" ")]: Number(qty) });
      expect(u.buildMinutes, u.id).toBe(minutes(row["Build time"]));
      expect(u.builtAt, u.id).toBe(SITE_NAMES[row["Built at"]]);
      expect(u.research, u.id).toEqual(row.Research === "none" ? [] : [row.Research.match(/`([^`]+)`/)[1]]);
      expect(u.supply, u.id).toBe(num(row.Supply));
      expect(u.upkeepPerDay, u.id).toBe(num(row["Upkeep a day"]));
      expect(u.attack, u.id).toBe(num(row.Attack));
      expect(u.hp, u.id).toBe(num(row["Defense (hp)"]));
      expect(u.accuracy, u.id).toBe(num(row.Accuracy));
      expect(u.evasion, u.id).toBe(num(row.Evasion));
    }
  });

  it("says why it is refused when a unit names research, a good or a site nobody has", () => {
    const broken = structuredClone(FILE);
    broken.units[0].research = ["tt-no-such-thing"];
    broken.units[1].goods = { "Unobtainium": 3 };
    broken.units[2].builtAt = "moon-base";
    const problems = unitCatalogProblems(broken).join(" ");
    expect(problems).toMatch(/lf needs research "tt-no-such-thing"/);
    expect(problems).toMatch(/ds costs "Unobtainium"/);
    expect(problems).toMatch(/se is built at "moon-base"/);
  });

  it("refuses counters that make two cycles, which would leave a composition with no answer", () => {
    const broken = structuredClone(FILE);
    const at = (id) => broken.units.find((u) => u.id === id);
    at("lf").strongAgainst = "ds"; at("ds").strongAgainst = "lf"; // lf <> ds, and se > dt > at > se
    at("at").strongAgainst = "se";
    expect(unitCatalogProblems(broken).join(" ")).toMatch(/more than one cycle/);
  });

  it("names only research the tree has, and each gating node says which units need it", () => {
    const byId = new Map(RESEARCH.map((n) => [n.id, n]));
    for (const u of FILE.units) {
      for (const id of u.research) {
        expect(byId.has(id), `${u.id} needs ${id}`).toBe(true);
        expect(byId.get(id).effect, `${id}'s effect names ${u.name}`).toMatch(new RegExp(u.name));
      }
    }
  });

  it("names only goods the item catalog has", () => {
    const names = new Set(ITEMS.map((i) => i.name));
    for (const u of FILE.units) for (const good of Object.keys(u.goods)) expect(names.has(good), `${u.id}: ${good}`).toBe(true);
  });

  it("names only build sites that exist, or are pending with the story that adds them; a pending site no catalogue has yet", () => {
    const ids = new Set(BUILDINGS.map((b) => b.id));
    for (const u of FILE.units) {
      const known = ids.has(u.builtAt) || u.builtAt in BUILD_SITES_OUTSIDE_CATALOGUE || u.builtAt in PENDING_BUILD_SITES;
      expect(known, `${u.id} is built at ${u.builtAt}`).toBe(true);
    }
    // when ISP-170 adds the Orbital Shipyard to data/player-buildings.json, this fails until it leaves the pending list
    for (const site of Object.keys(PENDING_BUILD_SITES)) expect(ids.has(site), `${site} is catalogued now: take it off PENDING_BUILD_SITES`).toBe(false);
    expect(ids.has("orbital-shipyard")).toBe(true); // ISP-170 (AB#864): a player building now, not a pending site
  });

  it("makes the ship research live, now that the shipyard builds ships (ISP-171, AB#865)", () => {
    for (const id of ["tt-capital-hulls", "tt-siege-ordnance"]) {
      const node = RESEARCH.find((n) => n.id === id);
      expect(node?.status, id).toBeUndefined();
      expect(node.category).toBe("Military");
    }
  });
});

describe("Fleet Coordination Matrix, advertised as +12 fleet cap (AB#861, P-INERT-FEATURE)", () => {
  it("still says +12 fleet cap, and the Fleet Cap the server enforces rises by exactly that", () => {
    const node = RESEARCH.find((n) => n.id === FLEET_COORDINATION_TECH);
    expect(node.effect).toMatch(/^\+12 fleet cap/);
    const corp = (tech) => ({ level: 0, unlocks: { maxFleetSize: 2 }, unlockedTech: tech, asteroidMining: {} });
    expect(fleetStatus(corp([FLEET_COORDINATION_TECH])).cap - fleetStatus(corp([])).cap).toBe(FLEET_COORDINATION_BONUS);
    expect(FLEET_COORDINATION_BONUS).toBe(12);
  });
});

describe("corp.military in the catalog's terms (AB#861)", () => {
  it("keeps a save's fighters, destroyers and siege engines as units, drops the typed figures, and works out power", () => {
    const corp = { military: { lightFighters: 14, destroyers: 2, siegeEngines: 0, attackValue: 284, defenseValue: 219, modifiers: { rdBonusPct: 5, ceoLeadershipPct: 3 } } };
    expect(ensureCorpMilitary(corp)).toBe(true);
    expect(corp.military).toEqual({
      units: { lf: 14, ds: 2, se: 0, at: 0, dt: 0 },
      modifiers: { rdBonusPct: 5, ceoLeadershipPct: 3 },
      power: { attack: 14 * UNITS.lf.attack + 2 * UNITS.ds.attack, defense: 14 * UNITS.lf.hp + 2 * UNITS.ds.hp },
      garrisons: {}, // ISP-172 (AB#866)
      readiness: 100 // ISP-173 (AB#867)
    });
    expect(ensureCorpMilitary(corp)).toBe(false); // its own output changes nothing
  });

  it("gives a corporation with no military the empty shape, and counts what it migrates", () => {
    const accounts = { a: { state: { corp: {} } }, b: { state: { corp: { military: { units: { dt: 3 } } } } }, c: { state: {} } };
    expect(backfillCorpMilitary(accounts).migrated).toBe(2);
    expect(accounts.a.state.corp.military.units).toEqual({ lf: 0, ds: 0, se: 0, at: 0, dt: 0 });
    expect(accounts.b.state.corp.military.power).toEqual({ attack: 3 * UNITS.dt.attack, defense: 3 * UNITS.dt.hp });
    expect(backfillCorpMilitary(accounts).migrated).toBe(0);
  });

  it("never counts a negative, fractional or junk unit count", () => {
    expect(militaryPower({ lf: -4, ds: 1.9, se: "x" })).toEqual({ attack: UNITS.ds.attack, defense: UNITS.ds.hp });
  });
});
