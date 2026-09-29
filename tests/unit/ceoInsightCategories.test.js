// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url"; // jsdom replaces the global URL, and readFileSync wants Node's

// AB#2474 (Board review 2026-09-26, item 21): CEO Insight's programs are in named categories. The Programs section
// collapses as a whole and each category on its own, and the viewer's choices are remembered. What it looks like at
// 1280x800 and 375x812 is in docs/ab-2474.
vi.mock("../../public/scripts/views/shared.js", () => ({ pushFeedback: vi.fn(), updateAllViews: vi.fn() }));
vi.mock("../../public/scripts/views/receiptModal.js", () => ({ showActionReceipt: vi.fn() }));
const { appState } = await import("../../public/scripts/state.js");
const { renderInsightTree, groupInsightPrograms, INSIGHT_STORAGE_KEY } = await import("../../public/scripts/views/ceoInsight.js");

const read = (rel) => readFileSync(new NodeURL(`../../${rel}`, import.meta.url), "utf8");
const CATALOGUE = JSON.parse(read("data/ceo-insight.json"));
const HTML = read("public/index.html");
const ARTICLE = HTML.slice(HTML.indexOf('<article id="ceo"'), HTML.indexOf("</article>", HTML.indexOf('<article id="ceo"')) + "</article>".length);

// the viewer's storage: Node's own localStorage (undefined without --localstorage-file) hides jsdom's, so a plain one
const saved = new Map();
const storage = { getItem: (k) => (saved.has(k) ? saved.get(k) : null), setItem: (k, v) => void saved.set(k, String(v)), clear: () => saved.clear() };
Object.defineProperty(window, "localStorage", { value: storage, configurable: true });

const data = { corp: { completedInsights: ["ceo-negotiation-fundamentals", "ceo-risk-assessment"] }, queues: { ceoInsight: [] } };
const toggles = () => [...document.querySelectorAll("[data-insight-category]")];
const toggle = (name) => document.querySelector(`[data-insight-category="${name}"]`);
const bodyOf = (button) => document.getElementById(button.getAttribute("aria-controls"));

beforeEach(() => {
  document.body.innerHTML = `<main>${ARTICLE}</main>`;
  storage.clear();
  appState.insightPrograms = CATALOGUE.programs;
  appState.insightCategories = CATALOGUE.categories;
});

describe("the catalogue's categories (AB#2474)", () => {
  it("names each category once, and every program is in one of them", () => {
    const names = CATALOGUE.categories.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of CATALOGUE.programs) expect(names, p.id).toContain(p.category);
  });

  it("leaves no category with a single program, so no subsection collapses one card", () => {
    for (const g of groupInsightPrograms(CATALOGUE.programs, CATALOGUE.categories)) expect(g.programs.length, g.name).toBeGreaterThan(1);
  });

  it("puts a program with an unknown category under Other, last, rather than dropping it", () => {
    const groups = groupInsightPrograms([...CATALOGUE.programs, { id: "x", name: "X", category: "Nowhere" }], CATALOGUE.categories);
    expect(groups.at(-1).name).toBe("Other");
    expect(groups.flatMap((g) => g.programs)).toHaveLength(CATALOGUE.programs.length + 1);
  });
});

describe("the CEO Insight screen's categories (AB#2474)", () => {
  it("draws one subsection per category, in the catalogue's order, holding every program", () => {
    renderInsightTree(data);
    expect(toggles().map((b) => b.dataset.insightCategory)).toEqual(CATALOGUE.categories.map((c) => c.name));
    const cards = toggles().reduce((n, b) => n + bodyOf(b).querySelector(".ui-grid").children.length, 0);
    expect(cards).toBe(CATALOGUE.programs.length);
    expect(toggle("Operations").textContent).toContain("4 programs · 1 done");
  });

  it("collapses and expands one category without touching the others, and remembers it across a redraw", () => {
    renderInsightTree(data);
    toggle("Operations").click();
    expect(toggle("Operations").getAttribute("aria-expanded")).toBe("false");
    expect(bodyOf(toggle("Operations")).hidden).toBe(true);
    for (const b of toggles().filter((b) => b.dataset.insightCategory !== "Operations")) expect(bodyOf(b).hidden, b.dataset.insightCategory).toBe(false);

    renderInsightTree(data); // every state update redraws the tree
    expect(bodyOf(toggle("Operations")).hidden).toBe(true);
    toggle("Operations").click();
    expect(bodyOf(toggle("Operations")).hidden).toBe(false);
  });

  it("collapses the whole Programs section from its title, keeps the categories' own choices, and remembers it", () => {
    renderInsightTree(data);
    toggle("Trade").click();
    const programs = document.getElementById("ceo-programs-toggle");
    programs.click();
    expect(programs.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("ceo-insight-tree").hidden).toBe(true);
    expect(JSON.parse(storage.getItem(INSIGHT_STORAGE_KEY))).toEqual({ programs: false, categories: { Trade: false } });

    document.body.innerHTML = `<main>${ARTICLE}</main>`; // a reload
    renderInsightTree(data);
    expect(document.getElementById("ceo-insight-tree").hidden).toBe(true);
    document.getElementById("ceo-programs-toggle").click();
    expect(document.getElementById("ceo-insight-tree").hidden).toBe(false);
    expect(bodyOf(toggle("Trade")).hidden).toBe(true);
  });

  it("keeps the section's document code inside its title, now that the title is a button", () => {
    const title = document.getElementById("ceo-tree-title");
    expect(title.querySelector('[data-code-for="ceo-tree-title"]')).not.toBeNull();
    expect(title.querySelector("button#ceo-programs-toggle")).not.toBeNull();
  });

  it("starts everything expanded when the stored choice is unreadable", () => {
    storage.setItem(INSIGHT_STORAGE_KEY, "{not json");
    renderInsightTree(data);
    expect(document.getElementById("ceo-insight-tree").hidden).toBe(false);
    expect(toggles().every((b) => b.getAttribute("aria-expanded") === "true")).toBe(true);
  });
});
