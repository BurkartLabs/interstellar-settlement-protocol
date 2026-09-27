import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  CONGLOMERATE_CATALOG,
  conglomerateReferenceProblems,
  conglomerateSchemaProblems,
  readConglomerateCatalog,
  readReferenceCatalogs
} from "../../server/conglomerates.js";

// ISP-196 (AB#890): data/conglomerates.json is docs/design/CONGLOMERATES.md's numbers, checked three ways: against the
// design, value for value; against its own schema; and against every catalog it names ids from (T-019).
const DESIGN = fs.readFileSync(new URL("../../docs/design/CONGLOMERATES.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const C = CONGLOMERATE_CATALOG;
const num = (s) => Number(String(s).replace(/,/g, ""));
const copy = () => JSON.parse(JSON.stringify(C));
const REFS = readReferenceCatalogs();

describe("the conglomerate catalog holds the design's numbers (AB#890)", () => {
  // The design's number table: | `key` | value | what it is |
  const table = Object.fromEntries([...DESIGN.matchAll(/^\| `([A-Za-z]+)` \| ([^|]+) \| ([^|]+) \|$/gm)].map((m) => [m[1], { value: m[2].trim(), what: m[3].trim() }]));

  it("has every key the design's table lists, and every number with the same value", () => {
    expect(Object.keys(table).length).toBeGreaterThanOrEqual(40);
    for (const [key, { value, what }] of Object.entries(table)) {
      expect(C, key).toHaveProperty(key);
      if (/^[\d,.]+$/.test(value)) expect(C[key], key).toBe(num(value));
      else if (key === "stationCostGoods") {
        const items = what.split(" (")[0].split(" / ").map((s) => s.trim());
        const counts = value.split(" / ").map(num);
        expect(C.stationCostGoods).toEqual(Object.fromEntries(items.map((it, i) => [it, counts[i]])));
      } else if (key === "stationTaxOptions") expect(C.stationTaxOptions).toEqual(value.split(",").map(num));
      else if (key === "dominanceWeights") expect(C.dominanceWeights).toEqual(Object.fromEntries(value.split(",").map((p) => { const [k, v] = p.trim().split(" "); return [k, num(v)]; })));
      else if (key === "levels") expect(C.levels).toHaveLength(13);
      else expect(typeof C[key], key).toBe("string"); // stakeGoodsPriceBasis: a rule, not a number
    }
  });

  it("holds the level ladder row for row: cap, cost, the members needed (80% of the last cap) and the days", () => {
    const rows = [...DESIGN.matchAll(/^\| (\d+) \| (\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)].map((m) => m.slice(1).map((s) => s.trim()));
    expect(rows).toHaveLength(13);
    for (const [i, [level, cap, cost, needed, days]] of rows.entries()) {
      const l = C.levels[i];
      expect(l.level).toBe(num(level));
      expect(l.maxMembers, `level ${level}`).toBe(num(cap));
      if (i === 0) { expect(cost).toMatch(/charter/); expect(l.cost).toBe(0); continue; }
      expect(l.cost, `level ${level}`).toBe(num(cost));
      expect(l.minDaysAtPrevious, `level ${level}`).toBe(num(days));
      expect(Math.ceil((C.levels[i - 1].maxMembers * C.levelFillPct) / 100), `level ${level}`).toBe(num(needed));
    }
  });

  it("holds the roles table row for row, and no permission the design does not have", () => {
    const section = DESIGN.slice(DESIGN.indexOf("| Permission | Founder | Director | Member |"));
    const rows = [...section.split("\n\n")[0].matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)].slice(2).map((m) => m.slice(1).map((s) => s.trim()));
    expect(rows).toHaveLength(C.permissions.length);
    for (const [label, founder, director, member] of rows) {
      const p = C.permissions.find((x) => x.label === label);
      expect(p, label).toBeDefined();
      expect([p.founder, p.director, p.member], label).toEqual([founder, director, member].map((v) => v.startsWith("yes")));
    }
  });
});

describe("the catalog's schema (AB#890)", () => {
  it("passes as it is", () => {
    expect(conglomerateSchemaProblems(C)).toEqual([]);
  });

  it("fails on a missing field", () => {
    const c = copy(); delete c.charterFee; delete c.levels[4].cost;
    expect(conglomerateSchemaProblems(c)).toEqual(expect.arrayContaining(["charterFee is missing", "levels[4].cost is missing"]));
  });

  it("fails on a member cap that does not rise", () => {
    const c = copy(); c.levels[3].maxMembers = 15;
    expect(conglomerateSchemaProblems(c)).toContain("level 4's cap (15) is not above level 3's (15)");
  });

  it("fails on a cap above 100", () => {
    const c = copy(); c.levels[12].maxMembers = 120;
    expect(conglomerateSchemaProblems(c)).toContain("level 13's cap (120) is above 100");
  });

  it("fails when the first level is not 5 members", () => {
    const c = copy(); c.levels[0].maxMembers = 6;
    expect(conglomerateSchemaProblems(c)).toContain("the first level's cap is 6, not 5");
  });

  it("fails on dominance weights that do not sum to 1, and a permission missing a role", () => {
    const c = copy(); c.dominanceWeights.sales = 0.3; delete c.permissions[0].member;
    const problems = conglomerateSchemaProblems(c);
    expect(problems.some((p) => /dominanceWeights sum to/.test(p))).toBe(true);
    expect(problems).toContain("permission view does not say whether a member holds it");
  });
});

describe("every id the catalog names resolves in its own catalog (T-019, AB#890)", () => {
  it("resolves as it is", () => {
    expect(conglomerateReferenceProblems(C, REFS)).toEqual([]);
  });

  it("fails on a deliberately broken copy, naming each missing building, station, item and research id", () => {
    const c = copy();
    c.bureauBuildingId = "no-such-bureau";
    c.homeStationId = "atlantis-station";
    c.stationCostGoods = { ...c.stationCostGoods, unobtainium: 10 };
    c.levels[1].researchRequired = ["tt-basic-extraction", "tt-no-such-research"];
    expect(conglomerateReferenceProblems(c, REFS)).toEqual([
      'bureauBuildingId names building "no-such-bureau", which data/buildings.json does not define',
      'homeStationId names station "atlantis-station", which data/stations.json does not define',
      'stationCostGoods names item "unobtainium", which data/items.json does not define',
      'level 2\'s researchRequired names research "tt-no-such-research", which data/research.json does not define'
    ]);
  });
});

describe("the server refuses to start on a catalog it cannot use (fails closed, AB#890)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "congl-catalog-"));
  const broken = path.join(dir, "conglomerates.json");
  const bad = copy(); bad.levels[0].maxMembers = 6; bad.bureauBuildingId = "no-such-bureau";
  fs.writeFileSync(broken, JSON.stringify(bad));

  it("reading it throws, naming every problem", () => {
    expect(() => readConglomerateCatalog(broken)).toThrow(/the first level's cap is 6, not 5; bureauBuildingId names building "no-such-bureau"/);
    expect(() => readConglomerateCatalog(path.join(dir, "missing.json"))).toThrow();
  });

  it("server/index.js exits before it listens, and says why", async () => {
    const child = spawn(process.execPath, ["server/index.js"], {
      cwd: path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", ".."),
      env: { ...process.env, ISP_CONGLOMERATE_CATALOG: broken, ISP_DATA_DIR: dir, PORT: "0", ISP_DISABLE_TICKERS: "1", ISP_DEV: "", NODE_ENV: "test", JWT_SECRET: "conglomerate-catalog-test-secret-0123456789" }
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve("still running"); }, 20_000);
      child.on("exit", (c) => { clearTimeout(timer); resolve(c); });
    });
    expect(code).not.toBe("still running");
    expect(code).not.toBe(0);
    expect(out).toMatch(/data\/conglomerates\.json cannot be used \(AB#890\)/);
    expect(out).not.toMatch(/listening/i);
  }, 30_000);
});
