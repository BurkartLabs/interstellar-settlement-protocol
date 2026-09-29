import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { applySectionCodes, codeSlotHtml, codeText, setSectionCodes } from "../../public/scripts/sectionCodes.js";

// ISP-248 (AB#944): the document-code section header (docs/design/BUREAUCRATIC_UI.md). Every screen and section in
// data/section-codes.json has one code slot, inside its own title and hidden from assistive technology; every slot
// names a registered id; and no page or script writes a code by hand, so the registry is the only place one lives.
const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const R = JSON.parse(read("data/section-codes.json"));
const pages = Object.fromEntries([...new Set(R.screens.map((s) => s.page))].map((p) => [p, new JSDOM(read(`public/${p}`)).window.document]));
const IDS = new Set([...R.screens, ...R.sections].map((e) => e.id));
/** Screens whose title a view draws (views/travel.js, views/station.js): the slot is codeSlotHtml there. */
const DRAWN = { travel: "public/scripts/views/travel.js", station: "public/scripts/views/station.js" };

/** The element a registered entry's code belongs in: a screen's title, or the section's title (the registry's rule). */
function titleOf(doc, entry, isScreen) {
  if (isScreen) return entry.page === "index.html" ? doc.querySelector(`article#${entry.id} .ui-screen__title`) : doc.querySelector("h1");
  const el = doc.getElementById(entry.id);
  if (!el) return null;
  if (el.tagName !== "SECTION") return el;
  const by = el.getAttribute("aria-labelledby");
  if (by) return doc.getElementById(by.split(" ")[0]);
  return [...el.querySelectorAll("h2, h3, h4, h5")].find((h) => h.closest("section") === el) || null;
}

describe("every registered screen and section has its header slot (ISP-248, AB#944)", () => {
  it("one empty, aria-hidden slot per entry, inside its own title", () => {
    const entries = [...R.screens.map((e) => [e, true]), ...R.sections.map((e) => [e, false])];
    expect(entries.length).toBe(73); // AB#2477: the two prerequisite trees; ISP-287 (AB#994): the Station's Damaged Buildings
    for (const [entry, isScreen] of entries) {
      if (DRAWN[entry.id]) {
        expect(read(DRAWN[entry.id]), entry.id).toContain(`codeSlotHtml("${entry.id}")`);
        continue;
      }
      const doc = pages[isScreen ? entry.page : "index.html"];
      const slots = doc.querySelectorAll(`[data-code-for="${entry.id}"]`);
      expect(slots.length, entry.id).toBe(1);
      const title = titleOf(doc, entry, isScreen);
      expect(title?.contains(slots[0]), `${entry.id}: the slot is in its title`).toBe(true);
      expect(slots[0].getAttribute("aria-hidden"), entry.id).toBe("true");
      expect(slots[0].textContent, `${entry.id}: filled from the registry, never written`).toBe("");
    }
  });

  it("every slot on a page names a registered id", () => {
    for (const [page, doc] of Object.entries(pages)) {
      for (const slot of doc.querySelectorAll("[data-code-for]")) expect(IDS.has(slot.getAttribute("data-code-for")), `${page}: ${slot.getAttribute("data-code-for")}`).toBe(true);
    }
  });

  it("no page or script writes a code by hand (comments aside)", () => {
    const CODE = /\b(CORP|ISA|STA|GEX|CGL|EA|ITC|GAC|SDSD)-[A-Z]{3}-\d+\b/;
    const files = [...fs.readdirSync(new URL("../../public/", import.meta.url)).filter((f) => f.endsWith(".html")).map((f) => `public/${f}`),
      "public/styleguide/index.html",
      ...fs.readdirSync(new URL("../../public/scripts/", import.meta.url), { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => `public/scripts/${f.replace(/\\/g, "/")}`)];
    for (const f of files) {
      const lines = read(f).split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l));
      expect(lines.filter((l) => CODE.test(l)), f).toEqual([]);
    }
  });
});

describe("the header fills from the registry, and leaves the plain title when it cannot (ISP-248, AB#944)", () => {
  it("fills a slot as CODE // and leaves an unknown id empty", () => {
    setSectionCodes({ screens: [{ id: "finance", code: "CORP-FIN-1" }], sections: [{ id: "exchange-sell-section", code: "GEX-MKT-3" }] });
    const doc = new JSDOM(`<h2><span class="ui-code" data-code-for="finance" aria-hidden="true"></span>Financial Control Board</h2>
      <h3><span class="ui-code" data-code-for="nowhere" aria-hidden="true"></span>Plain</h3>`).window.document;
    applySectionCodes(doc);
    expect(doc.querySelector("h2").textContent).toBe("CORP-FIN-1 // Financial Control Board");
    expect(doc.querySelector("h3").textContent).toBe("Plain");
    expect(codeText("exchange-sell-section")).toBe("GEX-MKT-3 // ");
    expect(codeSlotHtml("exchange-sell-section")).toBe('<span class="ui-code" data-code-for="exchange-sell-section" aria-hidden="true">GEX-MKT-3 // </span>');
    expect(codeSlotHtml('"><img>')).not.toContain("<img>");
  });

  it("the Financial Core's lede no longer carries its code by hand: the title's slot does", () => {
    const lede = pages["index.html"].querySelector("#finance .ui-screen__lede").textContent;
    expect(lede).not.toMatch(/CORP-FIN-1/);
    expect(R.screens.find((s) => s.id === "finance").code).toBe("CORP-FIN-1");
  });
});
