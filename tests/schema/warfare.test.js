import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { CLAIM_TYPES, LOBBY_PARAMETERS, MAX_TARIFF_PCT, WARFARE_CATALOG, concessionTermsFor, readSystemIds, readWarfareCatalog, warfareReferenceProblems, warfareSchemaProblems } from "../../server/warfare.js";

// ISP-225 (AB#920): data/warfare.json is docs/design/TERRITORY.md's numbers (AB#916), checked three ways: against the
// design, value for value and row for row; against its own schema and bounds; and against data/systems.json, the
// catalog it names ids from (T-019). And the server refuses to start on a catalog it cannot use.
const DESIGN = fs.readFileSync(new URL("../../docs/design/TERRITORY.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
// ISP-222 (AB#917): the tariffs and dumping sections are docs/design/WARFARE.md's number table: | `section.key` | value | ... |
const WARFARE = fs.readFileSync(new URL("../../docs/design/WARFARE.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
// ISP-224 (AB#919): the Council's numbers, and its claim table's rows: | `claim-type` | record | ... (reserved rows say so)
const ARBITRATION_TABLE = [...WARFARE.matchAll(/^\| `arbitration\.([A-Za-z]+)` \| ([^|]+) \| ([^|]+) \|$/gm)].map((m) => [m[1], m[2].trim()]);
const CLAIM_ROWS = [...WARFARE.matchAll(/^\| `([a-z]+(?:-[a-z]+)+)` \| ([^\n]+)$/gm)].map((m) => ({ id: m[1], open: !/\*\*reserved\*\*/.test(m[2]) }));
const SECTION_TABLE = [...WARFARE.matchAll(/^\| `(tariffs|dumping)\.([A-Za-z]+)` \| ([^|]+) \| ([^|]+) \|$/gm)].map((m) => [m[1], m[2], m[3].trim()]);
const SYSTEMS = (() => { const raw = JSON.parse(fs.readFileSync(new URL("../../data/systems.json", import.meta.url), "utf8")); return Array.isArray(raw) ? raw : raw.systems; })();
const C = WARFARE_CATALOG;
const num = (s) => Number(String(s).replace(/,/g, ""));
const copy = () => JSON.parse(JSON.stringify(C));
const IDS = readSystemIds();

// The design's number table: | `concessionKey` | value | what it is |
const TABLE = Object.fromEntries([...DESIGN.matchAll(/^\| `(concession[A-Za-z]+)` \| ([^|]+) \| ([^|]+) \|$/gm)].map((m) => [m[1], m[2].trim()]));
// The design's system rule table: | system | ownerRule | rule | weights L/X/S | tariff cap |
const RULES = [...DESIGN.matchAll(/^\| (\**[a-z0-9-]+\**) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| (\d+)% \|$/gm)].map((m) => ({
  id: m[1].replace(/\*/g, ""), ownerRule: m[2].trim(), rule: m[3].trim(), weights: m[4].trim(), cap: num(m[5])
}));

/** How a rule's text states an override: "30%", "7 days", "halved", ... (so the data cannot drift from the prose). */
function stated(key, v) {
  if (/Pct$/.test(key)) return [`${v}%`];
  if (/Days$/.test(key)) return [`${v} days`];
  if (key === "concessionReviewHours") return v === 0 ? ["no review", "at once"] : [`${v / 24} days`];
  if (key === "upkeepFactor") return v === 0.5 ? ["halved"] : [`${v}`];
  if (key === "feeShareFactor") return v === 0.5 ? ["half the fee share"] : [`${v}`];
  if (key === "concessionsPerSystem") return v === 2 ? ["two concessions"] : [`${v}`];
  if (key === "holders") return v.includes("corp") ? [] : ["Conglomerates only"];
  if (key === "counterPetitions") return v ? [] : ["counter-petition cannot win"];
  return [String(v)];
}

describe("the warfare catalog holds the territory design's numbers (AB#920)", () => {
  it("has every key the design's number table lists, with the same value, and no scalar the table lacks", () => {
    expect(Object.keys(TABLE).length).toBe(19); // AB#921 added concessionDataMaxAgeHours; AB#923 the lease modifier's cap and notice
    for (const [key, value] of Object.entries(TABLE)) {
      expect(C, key).toHaveProperty(key);
      expect(C[key], key).toBe(num(value));
    }
    expect(Object.keys(C).filter((k) => /^concession/.test(k)).sort()).toEqual(Object.keys(TABLE).sort());
  });

  it("holds the system rule table row for row: every system, its rule, weights and tariff cap", () => {
    expect(RULES).toHaveLength(SYSTEMS.length);
    for (const row of RULES) {
      const never = row.rule.startsWith("**Never concedable**");
      if (never) {
        expect(C.neverConcedable.map((n) => n.systemId), row.id).toContain(row.id);
        expect(C.systemRules[row.id], row.id).toBeUndefined();
        expect(row.cap, row.id).toBe(0);
        continue;
      }
      const r = C.systemRules[row.id];
      expect(r, row.id).toBeDefined();
      expect(r.rule, row.id).toBe(row.rule);
      expect([r.weights.leases, r.weights.extraction, r.weights.sales], row.id).toEqual(row.weights.split("/").map(num));
      expect(r.tariffCapPct, row.id).toBe(row.cap);
      // a rule written "as <system>" states its terms through that system's row ("Arbitrated, as Wolf 359")
      const as = row.rule.match(/, as ([A-Z0-9][\w' ]+)$/)?.[1];
      const text = as ? RULES.find((x) => x.id === SYSTEMS.find((s) => s.name === as)?.id)?.rule ?? "" : row.rule;
      if (as) expect(r.overrides, `${row.id} is as ${as}`).toEqual(C.systemRules[SYSTEMS.find((s) => s.name === as).id].overrides);
      for (const [key, v] of Object.entries(r.overrides || {})) {
        const words = stated(key, v);
        if (words.length) expect(words.some((w) => text.includes(w)), `${row.id}: the rule text states ${key} = ${JSON.stringify(v)}`).toBe(true);
      }
    }
  });

  it("quotes each system's ownerRule exactly as data/systems.json has it", () => {
    for (const row of RULES) expect(row.ownerRule, row.id).toBe(SYSTEMS.find((s) => s.id === row.id).ownerRule);
  });

  it("names the same never-concedable systems in its list of reasons as in the rule table", () => {
    const section = DESIGN.slice(DESIGN.indexOf("**Never concedable, and why:**"), DESIGN.indexOf("## How it surfaces"));
    const named = [...section.matchAll(/^- \*\*([^*]+)\*\*(?: and \*\*([^*]+)\*\*)?/gm)].flatMap((m) => [m[1], m[2]].filter(Boolean));
    const byName = (name) => SYSTEMS.find((s) => s.name === name)?.id;
    expect(named.map(byName).sort()).toEqual(C.neverConcedable.map((n) => n.systemId).sort());
  });

  it("gives each system its terms: the standard ones with its overrides, and none for a never-concedable system", () => {
    expect(concessionTermsFor("sol")).toBeNull();
    expect(concessionTermsFor("alpha-centauri")).toMatchObject({ concessionGrantPct: 40, concessionTermDays: 30, upkeepFactor: 1, holders: ["corp", "conglomerate"] });
    expect(concessionTermsFor("barnards-star")).toMatchObject({ concessionGrantPct: 30, concessionEligibleDays: 7 });
    expect(concessionTermsFor("61-cygni")).toMatchObject({ concessionsPerSystem: 2, feeShareFactor: 0.5 });
    expect(concessionTermsFor("lacaille-9352").holders).toEqual(["conglomerate"]);
  });
});

describe("the catalog's schema and bounds (AB#920)", () => {
  it("passes as it is", () => {
    expect(warfareSchemaProblems(C)).toEqual([]);
  });

  it("fails on a missing number or a never-concedable list without Sol", () => {
    const c = copy(); delete c.concessionTermDays; c.neverConcedable = c.neverConcedable.filter((n) => n.systemId !== "sol");
    expect(warfareSchemaProblems(c)).toEqual(expect.arrayContaining(["concessionTermDays is missing", "neverConcedable must include sol"]));
  });

  it(`fails on a tariff cap above ${MAX_TARIFF_PCT}%, weights that do not sum to 1, and a retain line at or above the grant line`, () => {
    const c = copy();
    c.systemRules["tau-ceti"].tariffCapPct = 30;
    c.systemRules.sirius.weights.sales = 0.9;
    c.concessionRetainPct = 40;
    const p = warfareSchemaProblems(c);
    expect(p).toContain("tau-ceti's tariffCapPct is 30%, above the 25% ceiling");
    expect(p).toContain("sirius's weights sum to 0.9, not 1");
    expect(p.some((x) => /concessionRetainPct \(40\) must be below concessionGrantPct \(40\)/.test(x))).toBe(true);
  });

  it("fails on an override a rule may not make, and on a never-concedable system that has a rule", () => {
    const c = copy();
    c.systemRules.altair.overrides = { concessionPetitionFee: 0 };
    c.systemRules.sol = { ...c.systemRules.altair };
    const p = warfareSchemaProblems(c);
    expect(p).toContain("altair overrides concessionPetitionFee, which a system rule cannot change");
    expect(p).toContain("sol is never concedable and has a concession rule");
  });

  it("holds the later sections to their bounds once they exist: a royalty below 100%, a tariff at most 25%", () => {
    expect(warfareSchemaProblems({ ...copy(), patents: { royaltyMaxPct: 100 } })).toContain("patents.royaltyMaxPct is 100; it must be below 100%");
    expect(warfareSchemaProblems({ ...copy(), tariffs: { maxPct: 26 } })).toContain("tariffs.maxPct is 26; it must be at most 25%");
    expect(warfareSchemaProblems({ ...copy(), patents: { ...C.patents, royaltyMaxPct: 40 }, tariffs: { ...C.tariffs, maxPct: 10 } })).toEqual([]); // AB#918: the whole section
  });
});

describe("the tariffs and dumping sections hold WARFARE.md's numbers (ISP-222, AB#917)", () => {
  it("has every key the design's number table lists, with the same value, and no key the table lacks", () => {
    expect(SECTION_TABLE.length).toBe(13);
    for (const [section, key, value] of SECTION_TABLE) expect(C[section][key], `${section}.${key}`).toBe(num(value));
    for (const section of ["tariffs", "dumping"]) {
      expect(Object.keys(C[section]).sort(), section).toEqual(SECTION_TABLE.filter((r) => r[0] === section).map((r) => r[1]).sort());
    }
  });

  it("holds the Arbitration Council's numbers and claim types to the design (ISP-224, AB#919)", () => {
    expect(ARBITRATION_TABLE.length).toBe(5);
    for (const [key, value] of ARBITRATION_TABLE) expect(C.arbitration[key], `arbitration.${key}`).toBe(num(value));
    expect(Object.keys(C.arbitration).filter((k) => k !== "claimTypes").sort()).toEqual(ARBITRATION_TABLE.map((r) => r[0]).sort());
    expect(C.arbitration.claimTypes).toEqual(CLAIM_ROWS);
    expect(CLAIM_ROWS.map((r) => r.id)).toEqual([...CLAIM_TYPES]);
  });

  it("fails on a claim type the design lacks, one listed twice or without its flag, and a Council with no withholding", () => {
    const c = copy();
    c.arbitration.claimTypes = [...c.arbitration.claimTypes, { id: "defamation", open: true }, { id: "tariff-overcharge" }];
    c.dumping.withholdPct = 0;
    delete c.arbitration.responseHours;
    const p = warfareSchemaProblems(c);
    expect(p).toContain('arbitration.claimTypes names "defamation", which the design does not define');
    expect(p).toContain('arbitration claim type "tariff-overcharge" has no open flag');
    expect(p).toContain("arbitration.claimTypes lists tariff-overcharge twice");
    expect(p).toContain("arbitration.responseHours is missing");
    expect(p).toContain("arbitration debts are collected by dumping.withholdPct, which is 0 or missing");
  });

  it("keeps every system's cap inside the tariff ceiling, and the ceiling inside AB#920's 25%", () => {
    const caps = Object.values(C.systemRules).map((r) => r.tariffCapPct);
    expect(Math.max(...caps)).toBe(C.tariffs.maxPct);
    expect(C.tariffs.maxPct).toBeLessThanOrEqual(MAX_TARIFF_PCT);
  });

  it("fails on a missing key, a cap above the ceiling or off its steps, a duty above the margin, and a normal value that can never exist", () => {
    const c = copy();
    delete c.tariffs.noticeHours;
    c.systemRules["tau-ceti"].tariffCapPct = 6;
    c.systemRules.altair.tariffCapPct = 3.1;
    c.dumping.dutyMarginPct = 150;
    c.dumping.minTradedDays = 8;
    const p = warfareSchemaProblems(c);
    expect(p).toContain("tariffs.noticeHours is missing");
    expect(p).toContain("tau-ceti's tariffCapPct (6%) is above tariffs.maxPct (5%)");
    expect(p).toContain("altair's tariffCapPct (3.1%) is not a whole number of 0.25-point steps");
    expect(p).toContain("dumping.dutyMarginPct is 150, which is not a valid value");
    expect(p).toContain("dumping.minTradedDays (8) is more than dumping.normalValueDays (7), so there would never be a normal value");
    expect(warfareSchemaProblems({ ...copy(), tariffs: { ...C.tariffs, isaLevyAtCapPct: 100 } })).toContain("tariffs.isaLevyAtCapPct is 100, which is not a valid value");
  });
});

describe("every id the catalog names resolves (T-019, AB#920)", () => {
  it("passes as it is: every system has a rule or is never concedable, and each id exists", () => {
    expect(warfareReferenceProblems(C, IDS)).toEqual([]);
  });

  it("fails on a system data/systems.json does not define, and on a system the catalog forgets", () => {
    const c = copy();
    c.systemRules["no-such-star"] = c.systemRules.altair;
    delete c.systemRules.procyon;
    expect(warfareReferenceProblems(c, IDS)).toEqual(expect.arrayContaining([
      'systemRules names system "no-such-star", which data/systems.json does not define',
      'system "procyon" has neither a concession rule nor a place in neverConcedable'
    ]));
  });
});

describe("the server refuses to start on a catalog it cannot use (fails closed, AB#920)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "warfare-catalog-"));
  const broken = path.join(dir, "warfare.json");
  const bad = copy(); bad.neverConcedable = bad.neverConcedable.filter((n) => n.systemId !== "sol"); bad.systemRules["no-such-star"] = bad.systemRules.altair;
  fs.writeFileSync(broken, JSON.stringify(bad));

  it("reading it throws, naming every problem", () => {
    expect(() => readWarfareCatalog(broken)).toThrow(/neverConcedable must include sol.*systemRules names system "no-such-star"/);
    expect(() => readWarfareCatalog(path.join(dir, "missing.json"))).toThrow();
  });

  it("server/index.js exits before it listens, and says why", async () => {
    const child = spawn(process.execPath, ["server/index.js"], {
      cwd: path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", ".."),
      env: { ...process.env, ISP_WARFARE_CATALOG: broken, ISP_DATA_DIR: dir, PORT: "0", ISP_DISABLE_TICKERS: "1", ISP_DEV: "", NODE_ENV: "test", JWT_SECRET: "warfare-catalog-test-secret-0123456789" }
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
    expect(out).toMatch(/data\/warfare\.json cannot be used \(AB#920\)/);
    expect(out).not.toMatch(/listening/i);
  }, 30_000);
});

// ISP-223 (AB#918): the patents, standing and lobbying sections are WARFARE.md's Lawfare number table, and the lobbyable
// parameters its lobbying table; the worked example's pulls follow from the curve and the catalog's spend scale.
const LAWFARE = WARFARE.slice(WARFARE.indexOf("## Lawfare"));
const LAWFARE_TABLE = [...LAWFARE.matchAll(/^\| `(patents|standing|lobbying)\.([A-Za-z]+)` \| ([^|]+) \| ([^|]+) \|$/gm)].map((m) => [m[1], m[2], m[3].trim()]);
const PARAM_TABLE = [...LAWFARE.matchAll(/^\| `([A-Za-z]+)` \([^)]*\) \| (Earth Assembly|ITC) \| [^|]+ \| ([\d.]+) \| ([\d.]+) \| (\d+) to (?:`[^`]+` \()?(\d+)\)? \| ([\d,]+) \|$/gm)]
  .map((m) => ({ key: m[1], faction: m[2] === "ITC" ? "interplanetary-trade-commission" : "earth-assembly", step: num(m[3]), maxShift: num(m[4]), min: num(m[5]), max: num(m[6]), spendScale: num(m[7]) }));
const ECONOMY_DATA = JSON.parse(fs.readFileSync(new URL("../../data/economy.json", import.meta.url), "utf8"));

describe("the patents, standing and lobbying sections hold WARFARE.md's numbers (ISP-223, AB#918)", () => {
  it("has every key the Lawfare number table lists, with the same value, and no key the table lacks", () => {
    expect(LAWFARE_TABLE.length).toBe(21);
    for (const [section, key, value] of LAWFARE_TABLE) expect(C[section][key], `${section}.${key}`).toBe(num(value));
    for (const section of ["patents", "standing"]) {
      expect(Object.keys(C[section]).sort(), section).toEqual(LAWFARE_TABLE.filter((r) => r[0] === section).map((r) => r[1]).sort());
    }
    expect(Object.keys(C.lobbying).filter((k) => k !== "parameters").sort()).toEqual(LAWFARE_TABLE.filter((r) => r[0] === "lobbying").map((r) => r[1]).sort());
  });

  it("has the lobbying table's four parameters, each as the table gives it, and every base inside its bounds", () => {
    expect(PARAM_TABLE.map((p) => p.key)).toEqual(LOBBY_PARAMETERS);
    for (const { key, ...p } of PARAM_TABLE) expect(C.lobbying.parameters[key], key).toEqual(p);
    const P = C.lobbying.parameters;
    expect(P.tariffCapPct.max).toBe(C.tariffs.maxPct);
    expect(ECONOMY_DATA.exchange.salesTaxPct).toBeGreaterThanOrEqual(P.salesTaxPct.min);
    expect(ECONOMY_DATA.exchange.salesTaxPct).toBeLessThanOrEqual(P.salesTaxPct.max);
    for (const cap of Object.values(C.systemRules).map((r) => r.tariffCapPct)) expect(cap >= P.tariffCapPct.min && cap <= P.tariffCapPct.max, String(cap)).toBe(true);
    expect(C.patents.royaltyMaxPct).toBeLessThan(100); // AB#920's bound
  });

  it("the worked example's pulls are the curve's, E = M(1 - e^(-I/K)), at the tariff cap's K", () => {
    const rows = [...LAWFARE.matchAll(/^\| (?:\*\*)?([\d,]+)(?:\*\*)? \| ([\d.]+) \| ([\d.]+) \| [\d.]+% \|/gm)].map((m) => [num(m[1]), num(m[2]), num(m[3])]);
    expect(rows.length).toBe(8);
    const { maxShift: M, spendScale: K, step } = C.lobbying.parameters.tariffCapPct;
    for (const [spend, pull, cap] of rows) {
      expect(pull, String(spend)).toBeCloseTo(M * (1 - Math.exp(-spend / K)), 3);
      expect(cap, String(spend)).toBe(3 + Math.floor(pull / step + 1e-9) * step); // Alpha Centauri's 3%, rounded down to a step
    }
  });

  it("fails on a missing key, a royalty at 100%, a parameter nobody may lobby, a reach wider than its bounds, and a cap above the ceiling", () => {
    const c = copy();
    delete c.patents.termDays;
    c.patents.chainRoyaltyMaxPct = 100;
    c.lobbying.parameters.landingFee = { faction: "earth-assembly", step: 1, maxShift: 1, min: 0, max: 2, spendScale: 1 };
    c.lobbying.parameters.salesTaxPct.maxShift = 5;
    c.lobbying.parameters.tariffCapPct.max = 6;
    c.lobbying.parameters.dumpingPriceThresholdPct.min = 90;
    const p = warfareSchemaProblems(c);
    expect(p).toContain("patents.termDays is missing");
    expect(p).toContain("patents.chainRoyaltyMaxPct is 100, which is not a valid value");
    expect(p).toContain("lobbying.parameters.landingFee is not a parameter a campaign may move");
    expect(p).toContain("lobbying.parameters.salesTaxPct.maxShift (5) is wider than its bounds");
    expect(p).toContain("lobbying.parameters.tariffCapPct.max (6) is above tariffs.maxPct (5)");
    expect(p).toContain("lobbying.parameters.dumpingPriceThresholdPct: the base 85 is outside 90 to 95");
  });
});
