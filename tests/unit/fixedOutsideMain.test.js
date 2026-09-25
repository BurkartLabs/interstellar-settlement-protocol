import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// Bug AB#1832: the contract briefing (#mission-detail-modal, position: fixed) sat inside article#missions, and
// .tab-panel has backdrop-filter: blur(5px). A backdrop-filter, like a transform or a filter, makes its element the
// containing block for fixed descendants, so the modal was fixed to the panel, scrolled out of view, not to the
// screen: the player saw a dimmed list and no briefing. Every panel lives in <main>, so anything the stylesheet fixes
// to the viewport belongs at body level, beside #trade-confirm-modal. This reads the stylesheet as data, so the next
// overlay someone nests in a panel is caught here. The layout itself is checked by e2e/mission-modal-viewport.spec.js.
const CSS = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const HTML = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** Simple class and id selectors (".x", "#x") of every rule that sets position: fixed. */
function fixedSelectors(css) {
  const out = new Set();
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|;|\s)position:\s*fixed/.test(body)) continue;
    for (const s of selectors.split(",")) {
      const simple = s.trim().match(/^[.#][\w-]+$/);
      if (simple) out.add(simple[0]);
    }
  }
  return [...out];
}

function main(html) {
  const start = html.indexOf("<main");
  const end = html.indexOf("</main>");
  return start >= 0 && end > start ? html.slice(start, end) : "";
}

const carries = (markup, selector) => {
  const name = selector.slice(1);
  return selector.startsWith(".")
    ? new RegExp(`class="[^"]*(?<![\\w-])${name}(?![\\w-])`).test(markup)
    : markup.includes(`id="${name}"`);
};

describe("overlays fixed to the screen sit outside <main> (Bug AB#1832)", () => {
  const fixed = fixedSelectors(CSS);

  it("reads the stylesheet and the page it checks", () => {
    expect(fixed).toEqual(expect.arrayContaining([".modal-backdrop", ".mission-modal-backdrop"]));
    expect(main(HTML)).toContain('id="missions"');
  });

  it("no element the stylesheet fixes to the viewport is nested inside <main>, where every panel blurs", () => {
    expect(fixed.filter((s) => carries(main(HTML), s))).toEqual([]);
  });

  it("the contract briefing is still on the page, outside <main>", () => {
    const after = HTML.slice(HTML.indexOf("</main>"));
    expect(after).toContain('id="mission-detail-modal"');
    expect(after).toContain('id="mission-accept-btn"');
  });
});
