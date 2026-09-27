import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildingLinkHtml, itemGates, researchLinkHtml, researchNodeId, unrecoveredItemsHtml } from "../../public/scripts/researchLinks.js";
import { resourceCatalogHtml } from "../../public/scripts/resourceCatalog.js";
import { bodyResourceHtml } from "../../public/scripts/bodyInfo.js";
import { researchNodeHtml } from "../../public/scripts/html.js";

// ISP-191 (AB#885): Tier 4 on the Refinery and R&D screens and the Starmap's extraction panels: every lock names the
// research that opens it and links to its card, and the Resource catalog is grouped by tier. The tree and the data are
// the real files, so a node or a share added later is covered without a change here.
const read = (rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8"));
const TREE = read("data/research.json").nodes;
const ITEMS = read("data/items.json").items;
const TIERS = Object.fromEntries(ITEMS.map((i) => [i.name, i.tier]));
const CATALOG = read("data/refinery-chains.json").resourceCatalog;
const kestrel = read("data/systems.json").flatMap((s) => s.bodies).find((b) => b.id === "ee-kestrel");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("ISP-191 a research link lands on the node's card", () => {
  it("names the node as the tree does and points at the card's id, which the R&D card carries", () => {
    const link = researchLinkHtml("tt-deep-core-extraction", TREE);
    expect(link).toContain('data-research-link="tt-deep-core-extraction"');
    expect(link).toContain(`href="#${researchNodeId("tt-deep-core-extraction")}"`);
    expect(text(link)).toBe("Deep-Core Extraction");
    const card = researchNodeHtml({ id: "tt-deep-core-extraction", name: "Deep-Core Extraction", tier: 4, effect: "x", state: "locked" });
    expect(card).toContain(`id="${researchNodeId("tt-deep-core-extraction")}"`);
    expect(card).toContain('tabindex="-1"');
  });
});

describe("ISP-191 an extraction panel says which share is not recovered, and what recovers it", () => {
  it("reads the gates from the tree: the four Tier 4 extracted items", () => {
    expect(Object.fromEntries(itemGates(TREE))).toEqual({
      Uranium: "tt-actinide-handling", "Platinum-Group Metals": "tt-deep-core-extraction",
      "Metallic Hydrogen": "tt-deep-atmosphere-extraction", "Exotic Matter": "tt-exotic-containment"
    });
  });

  it("Kestrel's lease names Platinum-Group Metals and links Deep-Core Extraction until it is researched, then says nothing", () => {
    const locked = bodyResourceHtml(kestrel, [], { tree: TREE, unlockedTech: new Set() });
    expect(text(locked)).toContain("Not recovered until researched: Platinum-Group Metals needs Deep-Core Extraction");
    expect(locked).toContain('data-research-link="tt-deep-core-extraction"');
    const open = bodyResourceHtml(kestrel, [], { tree: TREE, unlockedTech: new Set(["tt-deep-core-extraction"]) });
    expect(open).not.toContain("data-unrecovered");
    expect(text(open)).toContain("Platinum-Group Metals 10%"); // the yield line itself is unchanged
  });

  it("a belt's composition names each gated item it lacks, once", () => {
    const html = unrecoveredItemsHtml(["Uranium", "Exotic Matter", "Nickel", "Uranium"], TREE, new Set(["tt-actinide-handling"]));
    expect(text(html)).toMatch(/^Not recovered until researched: Exotic Matter needs Exotic Containment ?\. Without it, that share is dug and lost\.$/);
    expect(unrecoveredItemsHtml(["Nickel", "Silicates"], TREE, new Set())).toBe("");
  });
});

describe("ISP-191 the Resource catalog is grouped by the design's tiers", () => {
  it("one labelled group per tier, in tier order, every item in its own tier's group", () => {
    const html = resourceCatalogHtml(CATALOG, TIERS);
    const groups = [...html.matchAll(/data-tier="(\d)"[\s\S]*?refinery__tier-label">([^<]+)<\/span>[\s\S]*?<\/ul>/g)];
    expect(groups.map((g) => g[2])).toEqual(["Tier 1: common raw", "Tier 2: scarce raw", "Tier 4: exotic"]);
    for (const g of groups) {
      const names = [...g[0].matchAll(/<li class="ui-badge">([^<]+)<\/li>/g)].map((m) => m[1]);
      for (const name of names) expect(TIERS[name], name).toBe(Number(g[1]));
    }
    expect(text(html).split(" ").length).toBeGreaterThan(CATALOG.length);
    expect(html).toContain("Platinum-Group Metals");
  });

  it("without tiers (an older server), one list as before", () => {
    expect(resourceCatalogHtml(["Silicates", "Nickel"], undefined)).toBe('<li class="ui-badge">Silicates</li><li class="ui-badge">Nickel</li>');
  });
});

describe("ISP-191 part 2: a Tier 4 chain names the facility it needs, as a link", () => {
  const REFINERY_VIEW = readFileSync(new URL("../../public/scripts/views/refinery.js", import.meta.url), "utf8");

  it("the building link points at its construction entry, which can take focus", () => {
    const link = buildingLinkHtml("synthesis-array", "Synthesis Array");
    expect(link).toContain('data-building-link="synthesis-array"');
    expect(text(link)).toBe("Synthesis Array");
    expect(readFileSync(new URL("../../public/scripts/constructionPanel.js", import.meta.url), "utf8")).toContain('data-building-row="${id}" tabindex="-1"');
  });

  it("the card without an Array links both the Array and the research that allows it", () => {
    expect(REFINERY_VIEW).toContain('Runs in a ${buildingLinkHtml("synthesis-array", "Synthesis Array")}');
    expect(REFINERY_VIEW).toContain('${researchLinkHtml("tt-high-energy-synthesis", techTree)} research.');
  });

  it("Bug #4661: the start button that names what is short wraps inside its card", () => {
    const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(css).toMatch(/\.refinery__start \{\n  white-space: normal;\n\}/);
  });
});
