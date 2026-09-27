import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { JSDOM } from "jsdom";

// ISP-247 (AB#943): data/section-codes.json gives every screen and every titled section a document code
// (docs/design/BUREAUCRATIC_UI.md). This holds the registry to its scheme and to the page: a screen or a titled section
// added to public/index.html without a code fails here, and so does a code that names something the page lacks.
const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const R = JSON.parse(read("data/section-codes.json"));
const doc = new JSDOM(read("public/index.html")).window.document;
const CODE = /^([A-Z]{2,4})-([A-Z]{3})-([1-9]\d*)$/;
const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();

/** A section's title: its aria-labelledby target, or its own first heading (the generator's rule, and ISP-248's). */
function titleOf(section) {
  const by = section.getAttribute("aria-labelledby");
  if (by) return text(doc.getElementById(by.split(" ")[0]));
  const h = [...section.querySelectorAll("h2, h3, h4, h5")].find((x) => x.closest("section") === section);
  return h ? text(h) : "";
}
const pageSections = [...doc.querySelectorAll("article.tab-panel section")].filter((s) => titleOf(s));
const all = [...R.screens, ...R.sections, ...(R.drawn || [])]; // drawn: ISP-250 (AB#946)

describe("the document-code registry (ISP-247, AB#943)", () => {
  it("every code is DEPT-FUNC-N with a known department and function, and unique, retired codes included", () => {
    for (const { code } of all) {
      const m = code.match(CODE);
      expect(m, code).toBeTruthy();
      expect(Object.keys(R.departments), code).toContain(m[1]);
      expect(Object.keys(R.functions), code).toContain(m[2]);
    }
    const codes = [...all.map((e) => e.code), ...R.retired.map((r) => r.code)];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("numbers each department-function pair from 1 with no gap but a retired code", () => {
    const byPair = {};
    for (const code of [...all.map((e) => e.code), ...R.retired.map((r) => r.code)]) {
      const [, d, f, n] = code.match(CODE);
      (byPair[`${d}-${f}`] ||= []).push(Number(n));
    }
    for (const [pair, ns] of Object.entries(byPair)) expect(ns.sort((a, b) => a - b), pair).toEqual(ns.map((_, i) => i + 1));
  });

  it("gives every screen on the page a code, and names no screen the page lacks", () => {
    const tabs = [...doc.querySelectorAll("article.tab-panel")].map((a) => a.id).sort();
    expect(R.screens.filter((s) => s.page === "index.html").map((s) => s.id).sort()).toEqual(tabs);
    for (const s of R.screens.filter((x) => x.page !== "index.html")) expect(fs.existsSync(new URL(`../../public/${s.page}`, import.meta.url)), s.page).toBe(true);
  });

  it("gives every titled section inside a screen a code, under the right screen, and names no section the page lacks", () => {
    const onPage = pageSections.map((s) => ({ id: s.id || s.getAttribute("aria-labelledby"), screen: s.closest("article.tab-panel").id }));
    for (const s of onPage) expect(s.id, "a titled section needs an id to be coded").toBeTruthy();
    expect(R.sections.map((s) => `${s.screen}/${s.id}`).sort()).toEqual(onPage.map((s) => `${s.screen}/${s.id}`).sort());
  });

  it("keeps the code the build already showed: the Financial Core is CORP-FIN-1, now through its title's slot (AB#944)", () => {
    const finance = R.screens.find((s) => s.id === "finance");
    expect(finance.code).toBe("CORP-FIN-1");
    expect(doc.querySelector('#finance .ui-screen__title [data-code-for="finance"]')).toBeTruthy();
  });
});

describe("sections a view draws (ISP-250, AB#946)", () => {
  /** The ids a file fills slots for: codeSlotHtml("id"), or a template such as `building-${building.id}` as a pattern. */
  const slotsIn = (file) => [...read(file).matchAll(/codeSlotHtml\((["`])(.+?)\1\)/g)].map(([, q, arg]) =>
    q === '"' ? { literal: arg } : { pattern: new RegExp(`^${arg.replace(/[.*+?^()|[\]\\]/g, "\\$&").replace(/\$\{[^}]+\}/g, ".+")}$`) });

  it("each drawn section's file draws its slot, and no drawn id repeats a page one", () => {
    const pageIds = new Set([...R.screens, ...R.sections].map((e) => e.id));
    for (const d of R.drawn) {
      expect(fs.existsSync(new URL(`../../${d.file}`, import.meta.url)), d.file).toBe(true);
      const slots = slotsIn(d.file);
      expect(slots.some((s) => s.literal === d.id || s.pattern?.test(d.id)), `${d.id} in ${d.file}`).toBe(true);
      expect(pageIds.has(d.id), d.id).toBe(false);
      expect(["station", "fleet", "conglomerate", ...R.screens.map((s) => s.id)], d.id).toContain(d.screen);
    }
  });

  it("gives every building the Station opens a title code", () => {
    const buildings = JSON.parse(read("data/buildings.json"));
    const open = (buildings.buildings || buildings).filter((b) => b.available && b.action === `building:${b.id}` && b.id !== "isa-contracting-assignments");
    for (const b of open) expect(R.drawn.map((d) => d.id), b.id).toContain(`building-${b.id}`);
  });
});

describe("the guide keeps its contract (ISP-247, AB#943)", () => {
  const GUIDE = read("docs/design/BUREAUCRATIC_UI.md");
  it("every status the acceptance names has a plain word, a protocol phrase and an example", () => {
    for (const plain of ["Pending", "Active", "Complete", "Failed", "Expired", "Refused", "Insufficient funds"]) {
      const row = GUIDE.split(/\r?\n/).find((l) => l.startsWith(`| **${plain}** |`));
      expect(row, plain).toBeTruthy();
      expect(row.split("|").slice(1, -1).map((c) => c.trim()).every(Boolean), plain).toBe(true);
    }
  });

  it("states the UTC format with its example, and the in-fiction year's offset", () => {
    expect(GUIDE).toContain("2147-03-14 09:42 UTC");
    expect(GUIDE).toMatch(/offset \+121 years/);
    expect(2147 - 121).toBe(2026);
  });

  it("the ids this item added are unique on the page", () => {
    const ids = [...doc.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});
