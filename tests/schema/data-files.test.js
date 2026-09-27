// Schema validation for every JSON catalog under /data.
// These guard against regressions in the data files (missing fields,
// duplicate ids, unresolved prereqs).

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "..", "data");

const loaded = new Set();

function load(file) {
  loaded.add(file);
  const raw = fs.readFileSync(path.join(dataDir, file), "utf8");
  return JSON.parse(raw);
}

describe("data/buildings.json", () => {
  const data = load("buildings.json");

  it("has a buildings array", () => {
    expect(Array.isArray(data.buildings)).toBe(true);
    expect(data.buildings.length).toBeGreaterThan(0);
  });

  it("every building has id, name, category", () => {
    for (const b of data.buildings) {
      expect(typeof b.id).toBe("string");
      expect(typeof b.name).toBe("string");
      expect(typeof b.category).toBe("string");
    }
  });

  it("ids are unique", () => {
    const ids = data.buildings.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("data/stations.json", () => {
  const data = load("stations.json");

  it("has a stations array", () => {
    expect(Array.isArray(data.stations)).toBe(true);
    expect(data.stations.length).toBeGreaterThan(0);
  });

  it("every station has id, name, body", () => {
    for (const s of data.stations) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.name).toBe("string");
      expect(typeof s.body).toBe("string");
    }
  });

  it("ids are unique", () => {
    const ids = data.stations.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes earth-station-prime", () => {
    expect(data.stations.find((s) => s.id === "earth-station-prime")).toBeDefined();
  });
});

describe("data/systems.json", () => {
  const data = load("systems.json");

  it("is an array of system entries", () => {
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("includes sol", () => {
    expect(data.find((s) => s.id === "sol")).toBeDefined();
  });

  it("every system has id and name", () => {
    for (const s of data) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.name).toBe("string");
    }
  });

  it("system ids are unique", () => {
    const ids = data.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("data/research.json", () => {
  const data = load("research.json");

  it("contains an array of nodes (or has a nodes key)", () => {
    const nodes = Array.isArray(data) ? data : data.nodes || data.tree;
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.length).toBeGreaterThan(0);
  });

  it("every node has id, durationHours, costCredits, prereqs", () => {
    const nodes = Array.isArray(data) ? data : data.nodes || data.tree;
    for (const n of nodes) {
      expect(typeof n.id).toBe("string");
      expect(typeof n.durationHours).toBe("number");
      expect(typeof n.costCredits).toBe("number");
      expect(Array.isArray(n.prereqs)).toBe(true);
    }
  });

  it("prereqs all reference known node ids", () => {
    const nodes = Array.isArray(data) ? data : data.nodes || data.tree;
    const ids = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      for (const p of n.prereqs) {
        expect(ids.has(p), `prereq ${p} for ${n.id} resolves`).toBe(true);
      }
    }
  });

  it("ids are unique", () => {
    const nodes = Array.isArray(data) ? data : data.nodes || data.tree;
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // AB#1259: two research effects (tt-energy-routing, tt-material-compression) promised a mechanic — an advanced
  // manufacturing lane, +8% refining throughput — that nothing in the game read. Every node's effect must now
  // either say what it unlocks (a real gate: prereqs, requiresTechIds, corp level, system access) or point at a
  // reader that actually applies it. READERS is the same kind of list-and-check TICKERS is for the tickers
  // (scripts/bench-ticks.mjs): keeping it here, beside the data it checks, means a new numeric effect with no
  // reader fails this test instead of shipping quietly.
  const RESEARCH_EFFECT_READERS = {
    "tt-basic-extraction": "public/scripts/miningEfficiency.js", // ISP-98: the tick's efficiency, shared with the panel
    "tt-industrial-safety": "server/game/mining.js",
    "tt-supply-forecast": "public/scripts/miningEfficiency.js",
    "tt-fleet-coordination": "server/game/catalog.js",
    "tt-fire-control": "server/game/combat.js", // AB#863: combatModifiersFor
    "tt-evasive-manoeuvres": "server/game/combat.js"
  };

  it("every effect is a stated unlock, or has a reader that applies it (AB#1259)", () => {
    const nodes = Array.isArray(data) ? data : data.nodes || data.tree;
    const ids = new Set(nodes.map((n) => n.id));
    expect(new Set(Object.keys(RESEARCH_EFFECT_READERS))).toEqual(
      new Set([...Object.keys(RESEARCH_EFFECT_READERS)].filter((id) => ids.has(id)))
    );
    for (const n of nodes) {
      const isStatedUnlock = /^(Unlocks|Enables)\s/.test(n.effect || "");
      const readerFile = RESEARCH_EFFECT_READERS[n.id];
      if (!isStatedUnlock && !readerFile) {
        throw new Error(`${n.id}'s effect "${n.effect}" is neither a stated unlock nor in RESEARCH_EFFECT_READERS`);
      }
      if (readerFile) {
        const src = fs.readFileSync(path.resolve(__dirname, "..", "..", readerFile), "utf8");
        expect(src.includes(`"${n.id}"`), `${readerFile} no longer references ${n.id} (RESEARCH_EFFECT_READERS is stale)`).toBe(true);
      }
    }
  });
});

describe("data/refinery-chains.json", () => {
  const data = load("refinery-chains.json");

  it("has a chains array", () => {
    expect(Array.isArray(data.chains)).toBe(true);
    expect(data.chains.length).toBeGreaterThan(0);
  });

  it("every chain has id, cycleDurationHours, outputs[]", () => {
    for (const c of data.chains) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.cycleDurationHours).toBe("number");
      expect(Array.isArray(c.outputs)).toBe(true);
      expect(c.outputs.length).toBeGreaterThan(0);
    }
  });

  it("each output has item and quantityPerCycle > 0", () => {
    for (const c of data.chains) {
      for (const out of c.outputs) {
        expect(typeof out.item).toBe("string");
        expect(typeof out.quantityPerCycle).toBe("number");
        expect(out.quantityPerCycle).toBeGreaterThan(0);
      }
    }
  });

  it("chain ids are unique", () => {
    const ids = data.chains.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("data/missions.json (AB#1051)", () => {
  const data = load("missions.json");

  it("has templates, agents and reputationTiers", () => {
    expect(Array.isArray(data.templates)).toBe(true);
    expect(data.templates.length).toBeGreaterThan(0);
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.agents.length).toBeGreaterThan(0);
    expect(data.reputationTiers).toBeDefined();
  });

  it("every template has id, type, resource, and a valid quota/reward range", () => {
    for (const t of data.templates) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.type).toBe("string");
      expect(typeof t.risk).toBe("string");
      expect(typeof t.text).toBe("string");
      expect(typeof t.agentId).toBe("string");
      expect(typeof t.resource).toBe("string");
      expect(typeof t.quotaMin).toBe("number");
      expect(typeof t.quotaMax).toBe("number");
      expect(t.quotaMax, t.id).toBeGreaterThanOrEqual(t.quotaMin);
      expect(typeof t.rewardMin).toBe("number");
      expect(typeof t.rewardMax).toBe("number");
      expect(t.rewardMax, t.id).toBeGreaterThanOrEqual(t.rewardMin);
    }
  });

  it("template ids are unique", () => {
    const ids = data.templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every template's agentId resolves to a defined agent", () => {
    const agentIds = new Set(data.agents.map((a) => a.id));
    for (const t of data.templates) expect(agentIds.has(t.agentId), `${t.id} -> ${t.agentId}`).toBe(true);
  });

  it("every agent has id, stationId, missionType, available, bio and dialogue", () => {
    for (const a of data.agents) {
      expect(typeof a.id).toBe("string");
      expect(typeof a.stationId).toBe("string");
      expect(typeof a.missionType).toBe("string");
      expect(typeof a.available).toBe("boolean");
      expect(typeof a.bio).toBe("string");
      expect(Array.isArray(a.dialogue)).toBe(true);
      expect(a.dialogue.length).toBeGreaterThan(0);
    }
  });

  it("agent ids are unique", () => {
    const ids = data.agents.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reputationTiers.thresholds and .titles are the same length, thresholds ascending from 0", () => {
    const { thresholds, titles } = data.reputationTiers;
    expect(Array.isArray(thresholds)).toBe(true);
    expect(Array.isArray(titles)).toBe(true);
    expect(thresholds.length).toBe(titles.length);
    expect(thresholds[0]).toBe(0);
    for (let i = 1; i < thresholds.length; i++) expect(thresholds[i]).toBeGreaterThan(thresholds[i - 1]);
  });
});

describe("data/ceo-insight.json", () => {
  const data = load("ceo-insight.json");

  it("has a programs array", () => {
    expect(Array.isArray(data.programs)).toBe(true);
    expect(data.programs.length).toBeGreaterThan(0);
  });

  it("every program has id, name, durationHours, costCredits", () => {
    for (const p of data.programs) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(typeof p.durationHours).toBe("number");
      expect(typeof p.costCredits).toBe("number");
    }
  });

  it("program ids are unique", () => {
    const ids = data.programs.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ceo-negotiation-fundamentals exists (drives tax math)", () => {
    expect(data.programs.find((p) => p.id === "ceo-negotiation-fundamentals")).toBeDefined();
  });
});

describe("data/milestones.json", () => {
  const data = load("milestones.json");

  it("has a levels array", () => {
    expect(Array.isArray(data.levels)).toBe(true);
    expect(data.levels.length).toBeGreaterThan(0);
  });

  it("every level has level (number) and requirements[]", () => {
    for (const lvl of data.levels) {
      expect(typeof lvl.level).toBe("number");
      expect(Array.isArray(lvl.requirements)).toBe(true);
    }
  });

  it("every requirement has id, title, metric, target", () => {
    for (const lvl of data.levels) {
      for (const req of lvl.requirements) {
        expect(typeof req.id).toBe("string");
        expect(typeof req.title).toBe("string");
        expect(typeof req.metric).toBe("string");
        expect(req.target).toBeDefined();
      }
    }
  });

  it("requirement ids are globally unique", () => {
    const ids = data.levels.flatMap((l) => l.requirements.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// Bug #424: levels 6 to 10 named research, buildings and statistics this build does not have, so the resolver returned
// 0 for them and nobody could pass Level 5. Every requirement must name something the build contains.
describe("data/milestones.json names only what this build has (Bug #424)", async () => {
  const { STAT_KEYS, PLAYER_BUILDINGS } = await import("../../server/gameState.js");
  const { PLAYER_BUILDING_CATALOGUE } = await import("../../server/playerBuildings.js");
  const { tierTableFor } = await import("../../server/buildingTiers.js");
  const milestones = load("milestones.json");
  const researchIds = new Set(load("research.json").nodes.map((t) => t.id));
  const leasable = new Set(load("systems.json").flatMap((s) => (s.bodies || []).filter((b) => b.leaseCost).map((b) => b.name)));
  const requirements = milestones.levels.flatMap((l) => l.requirements.map((r) => ({ level: l.level, ...r })));

  const problem = ({ metric }) => {
    const [kind, ...rest] = metric.split(":");
    const arg = rest.join(":");
    if (metric === "employeeCount") return null;
    if (kind === "stat") return STAT_KEYS.includes(arg) ? null : `no server code keeps the statistic "${arg}"`;
    if (kind === "unlockedTech") return researchIds.has(arg) ? null : `research "${arg}" is not in research.json`;
    if (kind === "building" || kind === "building-count") return PLAYER_BUILDINGS.includes(arg) ? null : `players cannot build "${arg}"`;
    // "any" (Bug #1753) is a sentinel for "a lease on any body", not a body name to look up in systems.json.
    if (kind === "miningLease") return arg === "any" || leasable.has(arg) ? null : `"${arg}" cannot be leased (no leaseCost in systems.json)`;
    // ISP-108 (AB#800): building-tier:<id>:<n>, a catalogue building whose upgrade table reaches tier n.
    if (kind === "building-tier") {
      const [id, n] = rest;
      const entry = PLAYER_BUILDING_CATALOGUE.find((b) => b.id === id);
      if (!entry) return `no catalogue building "${id}"`;
      const top = 1 + (tierTableFor(entry) || []).length;
      return Number(n) >= 1 && Number(n) <= top ? null : `"${id}" has no tier ${n} (its last is ${top})`;
    }
    if (kind === "totalMined") return arg === "silicate" ? null : `the resolver counts only silicate mined, not "${arg}"`;
    return `unknown metric "${metric}"`;
  };

  it("every requirement resolves to something a player can do", () => {
    const broken = requirements.map((r) => ({ r, why: problem(r) })).filter((x) => x.why).map((x) => `L${x.r.level} ${x.r.id}: ${x.why}`);
    expect(broken).toEqual([]);
  });

  it("the research every refinery chain needs exists", () => {
    const chains = load("refinery-chains.json").chains;
    expect(chains.flatMap((c) => (c.requiresTechIds || []).filter((id) => !researchIds.has(id)))).toEqual([]);
  });
});

// Bug #588: this file used to check data/state.json too. That file is the server's gitignored runtime output, so on a
// fresh clone this whole file failed to load and none of the catalog checks ran. The global state's shape is tested
// where it is made, in tests/unit/globalState.test.js; this file reads committed catalogs only.
describe("the schema tests read committed catalogs only (Bug #588)", () => {
  it("loads no file that .gitignore excludes", () => {
    const ignored = fs.readFileSync(path.resolve(dataDir, "..", ".gitignore"), "utf8")
      .split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("data/"));
    expect(ignored).toContain("data/state.json");
    const patterns = ignored.map((glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`));
    expect(patterns.some((p) => p.test("data/accounts-snapshot.json"))).toBe(true);
    expect([...loaded].filter((file) => patterns.some((p) => p.test(`data/${file}`)))).toEqual([]);
  });
});
