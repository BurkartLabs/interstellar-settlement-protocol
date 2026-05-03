// Schema validation for every JSON catalog under /data.
// These guard against regressions in the data files (missing fields,
// duplicate ids, unresolved prereqs).

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "..", "data");

function load(file) {
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

describe("data/state.json", () => {
  const data = load("state.json");

  it("contains market and chatLog sections", () => {
    expect(data.market).toBeDefined();
    expect(data.chatLog).toBeDefined();
  });
});
