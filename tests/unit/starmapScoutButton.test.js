import { describe, it, expect } from "vitest";

// starmap.js preloads planet images when it is imported; node has no Image.
globalThis.Image ??= class { set src(_v) {} };
const { unscoutedBeltHtml } = await import("../../public/scripts/starmap.js");

// Bug #1285: the Starmap offered 'Scout Asteroid Belt' on every unscouted belt, to corporations the server refuses
// (AB#1256), and the refusal showed only on the Overview tab. The button now follows the server's rule.
describe("the unscouted belt panel offers Scout only when the server will allow it (Bug #1285)", () => {
  it("a new corporation (no research) sees no button and is told the research", () => {
    for (const inSameSystem of [true, false]) {
      const html = unscoutedBeltHtml({ hasProspecting: false, inSameSystem, systemName: "Tau Ceti" });
      expect(html).not.toContain("scout-belt-btn");
      expect(html).toContain("Research <em>Asteroid Prospecting Arrays</em> in Corporate R&amp;D to scout this belt.");
    }
  });

  it("with the research, a belt in another system names the system to travel to, with no button", () => {
    const html = unscoutedBeltHtml({ hasProspecting: true, inSameSystem: false, systemName: "Tau Ceti" });
    expect(html).not.toContain("scout-belt-btn");
    expect(html).toContain("Travel to Tau Ceti to scout this belt.");
  });

  it("with the research, the belt in the corporation's own system has the Scout button", () => {
    const html = unscoutedBeltHtml({ hasProspecting: true, inSameSystem: true, systemName: "Sol" });
    expect(html).toContain('id="scout-belt-btn"');
    expect(html).not.toMatch(/Travel to|Research <em>/);
  });

  it("every case still says the composition is unknown", () => {
    for (const hasProspecting of [true, false]) {
      for (const inSameSystem of [true, false]) {
        expect(unscoutedBeltHtml({ hasProspecting, inSameSystem, systemName: "Sol" })).toContain("Material composition unknown.");
      }
    }
  });

  it("escapes the system name", () => {
    expect(unscoutedBeltHtml({ hasProspecting: true, inSameSystem: false, systemName: "<b>X & Y</b>" }))
      .toContain("Travel to &lt;b&gt;X &amp; Y&lt;/b&gt; to scout this belt.");
  });
});
