import { describe, it, expect } from "vitest";
import { researchGateProblems, canRecover, GATED_TIER } from "../../server/game/researchGates.js";
import { ITEMS } from "../../server/game/items.js";
import { REFINERY_CHAINS_DATA, RESEARCH_DATA, SYSTEMS_DATA } from "../../server/game/catalog.js";

// Bug #4804: canRecover lets any item no node names be recovered by everyone. Right for ordinary resources; silent for
// a Tier 4 item left out of every node's `recovers`. researchGateProblems holds the data to it, and the server does
// not start while it finds anything.
const items = [
  { name: "Silicates", tier: 1 }, { name: "Uranium", tier: 4 }, { name: "Unobtainium", tier: 4 },
  { name: "Antimatter", tier: 4 }, { name: "Steel", tier: 3 },
];
const nodes = [{ id: "tt-actinide-handling", recovers: ["Uranium"] }];
const body = (over) => ({ systems: [{ id: "sol", bodies: [{ id: "b1", ...over }] }] });

describe("the research gates are held to the data (Bug #4804)", () => {
  it("today's data has no problem, so the server starts", () => {
    expect(researchGateProblems({ items: ITEMS, systems: SYSTEMS_DATA, chains: REFINERY_CHAINS_DATA.chains, nodes: RESEARCH_DATA.nodes })).toEqual([]);
  });

  it("a Tier 4 item a belt yields that no node recovers is refused; a gated one and an ordinary one are not", () => {
    const problems = researchGateProblems({ items, nodes, chains: [], ...body({ composition: { Silicates: 0.6, Uranium: 0.3, Unobtainium: 0.1 } }) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/sol:b1 composition yields Tier 4 "Unobtainium", which no research node recovers/);
  });

  it("the same for what an extractor mines from a body's resource profile", () => {
    const problems = researchGateProblems({ items, nodes, chains: [], ...body({ resourceProfile: [{ item: "Unobtainium", concentration: 1 }] }) });
    expect(problems).toEqual([expect.stringMatching(/sol:b1 resourceProfile yields Tier 4 "Unobtainium"/)]);
  });

  it("a chain that makes a Tier 4 item must name research; one that makes Tier 3 need not", () => {
    const chains = [
      { id: "free-antimatter", outputs: [{ item: "Antimatter" }] },
      { id: "gated-antimatter", requiresTechIds: ["tt-antimatter-confinement"], outputs: [{ item: "Antimatter" }] },
      { id: "steel", outputs: [{ item: "Steel" }] },
    ];
    expect(researchGateProblems({ items, nodes, chains, systems: [] })).toEqual([expect.stringMatching(/free-antimatter makes Tier 4 "Antimatter" and names no research/)]);
  });

  it("a node that recovers an item that does not exist is refused", () => {
    expect(researchGateProblems({ items, nodes: [{ id: "tt-typo", recovers: ["Uranum"] }], chains: [], systems: [] }))
      .toEqual([expect.stringMatching(/tt-typo recovers "Uranum", which is no item/)]);
  });

  it("canRecover's own default is unchanged: an ungated item is recovered by anyone", () => {
    expect(GATED_TIER).toBe(4);
    expect(canRecover({ unlockedTech: [] }, "Silicates")).toBe(true);
    expect(canRecover({ unlockedTech: [] }, "Uranium")).toBe(false);
    expect(canRecover({ unlockedTech: ["tt-actinide-handling"] }, "Uranium")).toBe(true);
  });
});
