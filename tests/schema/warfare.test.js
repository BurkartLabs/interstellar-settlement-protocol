import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { MAX_TARIFF_PCT, WARFARE_CATALOG, concessionTermsFor, readSystemIds, readWarfareCatalog, warfareReferenceProblems, warfareSchemaProblems } from "../../server/warfare.js";

// ISP-225 (AB#920): data/warfare.json is docs/design/TERRITORY.md's numbers (AB#916), checked three ways: against the
// design, value for value and row for row; against its own schema and bounds; and against data/systems.json, the
// catalog it names ids from (T-019). And the server refuses to start on a catalog it cannot use.
const DESIGN = fs.readFileSync(new URL("../../docs/design/TERRITORY.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
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
    expect(Object.keys(TABLE).length).toBe(17); // AB#921 added concessionDataMaxAgeHours
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
    expect(warfareSchemaProblems({ ...copy(), patents: { royaltyMaxPct: 40 }, tariffs: { maxPct: 10 } })).toEqual([]);
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
