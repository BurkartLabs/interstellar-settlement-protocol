import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { layoutPrereqs, prereqChain, waitingOn } from "../../public/scripts/prereqGraph.js";

// AB#2477 (Board review item 24): research prerequisites drawn as a connected tree. Rows by depth, so every link points
// down, and a locked node's chain says what it still waits on.
const NODES = [
  { id: "a", prereqs: [], met: true },
  { id: "b", prereqs: ["a"], met: true },
  { id: "c", prereqs: ["a"] },
  { id: "d", prereqs: ["b", "c"] },
  { id: "e", prereqs: ["d", "a"] },
  { id: "f", prereqs: [] }
];

describe("the tree's layout (AB#2477)", () => {
  it("puts each node one row below its deepest prerequisite, so every link points down", () => {
    const { rows, depth } = layoutPrereqs(NODES);
    expect(rows.map((r) => [...r].sort())).toEqual([["a", "f"], ["b", "c"], ["d"], ["e"]]);
    for (const n of NODES) for (const p of n.prereqs) expect(depth.get(p)).toBeLessThan(depth.get(n.id));
  });

  it("lays out the real research tree and CEO programs with every node once and no link pointing up", () => {
    for (const [file, key] of [["research.json", "nodes"], ["ceo-insight.json", "programs"]]) {
      const nodes = JSON.parse(fs.readFileSync(new URL(`../../data/${file}`, import.meta.url), "utf8"))[key];
      const { rows, depth } = layoutPrereqs(nodes);
      expect(rows.flat().sort()).toEqual(nodes.map((n) => n.id).sort());
      for (const n of nodes) for (const p of n.prereqs) expect(depth.get(p)).toBeLessThan(depth.get(n.id));
    }
  });

  it("orders a row so a node sits under what it links to: fewer crossings than the data's own order", () => {
    const nodes = [
      { id: "l", prereqs: [] }, { id: "r", prereqs: [] },
      { id: "under-r", prereqs: ["r"] }, { id: "under-l", prereqs: ["l"] }
    ];
    expect(layoutPrereqs(nodes).rows[1]).toEqual(["under-l", "under-r"]);
  });

  it("survives a cycle or a prerequisite missing from the data", () => {
    const { rows } = layoutPrereqs([{ id: "x", prereqs: ["y"] }, { id: "y", prereqs: ["x"] }, { id: "z", prereqs: ["gone"] }]);
    expect(rows.flat().sort()).toEqual(["x", "y", "z"]);
  });
});

describe("what a locked node waits on (AB#2477)", () => {
  it("walks the whole chain, not only the direct prerequisites", () => {
    expect([...prereqChain("e", NODES)].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("lists the unmet part of the chain, shallowest first, and which of it can start now", () => {
    expect(waitingOn("e", NODES)).toEqual({ waiting: ["c", "d"], next: ["c"] });
    expect(waitingOn("b", NODES)).toEqual({ waiting: [], next: [] });
  });
});
