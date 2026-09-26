// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { availableTechNodes, researchLockReason } from "../../public/scripts/views/research.js";
import { techTree } from "../../public/scripts/state.js";

// Bug AB#2338: a research card below its node's corporation level offered Enqueue, and the server refused the click
// ("requires Corp Level 28"). The card is locked with what opens it, in the server's order of refusals: prerequisites,
// then corporation level, then Tier 1.
const TREE = JSON.parse(readFileSync(path.join(process.cwd(), "data", "research.json"), "utf8")).nodes; // jsdom: no file URL
const node = (id) => TREE.find((n) => n.id === id);
const TIER_1 = TREE.filter((n) => n.tier === 1).map((n) => n.id);
const DEEP_STAR = node("tt-deep-star-navigation"); // Level 10, after Proxima navigation
const withPrereqs = (n) => new Set([...TIER_1, ...n.prereqs]);

describe("a research card below its level (AB#2338)", () => {
  it("is locked, saying the level it needs and the corporation's own", () => {
    expect(DEEP_STAR.requiresCorpLevel).toBe(10);
    expect(researchLockReason(DEEP_STAR, { done: withPrereqs(DEEP_STAR), corpLevel: 5, tree: TREE })).toBe("Requires Corporation Level 10 (you are level 5)");
    expect(researchLockReason(DEEP_STAR, { done: withPrereqs(DEEP_STAR), corpLevel: undefined, tree: TREE })).toBe("Requires Corporation Level 10 (you are level 0)");
  });

  it("opens at the level, and the level of every gated node in the catalog is honoured", () => {
    expect(researchLockReason(DEEP_STAR, { done: withPrereqs(DEEP_STAR), corpLevel: 10, tree: TREE })).toBeNull();
    for (const n of TREE.filter((t) => t.requiresCorpLevel)) {
      const done = withPrereqs(n);
      expect(researchLockReason(n, { done, corpLevel: n.requiresCorpLevel - 1, tree: TREE }), n.id).toMatch(/^Requires Corporation Level /);
      expect(researchLockReason(n, { done, corpLevel: n.requiresCorpLevel, tree: TREE }), n.id).toBeNull();
    }
  });

  it("names a missing prerequisite first, as the server refuses it first", () => {
    const reason = researchLockReason(DEEP_STAR, { done: new Set(TIER_1), corpLevel: 1, tree: TREE });
    expect(reason).toBe(`Requires: ${node(DEEP_STAR.prereqs[0]).name}`);
  });

  it("is not offered in the picker below its level, and is at it", () => {
    techTree.length = 0;
    techTree.push(...TREE); // as the page's boot fetch fills it (AB#1049)
    const data = (level) => ({ corp: { unlockedTech: [...withPrereqs(DEEP_STAR)], level }, queues: { corporateRnD: [] } });
    expect(availableTechNodes(data(5)).map((n) => n.id)).not.toContain(DEEP_STAR.id);
    expect(availableTechNodes(data(10)).map((n) => n.id)).toContain(DEEP_STAR.id);
    techTree.length = 0;
  });
});
