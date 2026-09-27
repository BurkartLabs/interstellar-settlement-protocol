import { describe, it, expect } from "vitest";
import { DOMINANCE_OVERLAYS, LEADER_TOKENS, OTHER_TOKEN, OWN_TOKEN, QUIET_TOKEN, dominanceDetailsHtml, dominanceKey, dominanceLegendHtml, tokenRgba } from "../../public/scripts/dominanceOverlay.js";
import { readTokens, resolve } from "../../scripts/design-tokens.mjs";
import { contrast } from "../../public/scripts/tokenContrast.js";

// ISP-218 (AB#913): the Starmap's dominance overlays. Each system takes its leader's colour from the API's reading for a
// fixture world; the viewer's own corporation or conglomerate is marked; the legend names every colour shown; and the
// legend's text and swatches meet WCAG AA against the panel they sit on.
const reading = {
  computedAt: Date.UTC(2026, 8, 28, 0, 1),
  systems: {
    sol: { activity: true, byCorporation: { leaders: [{ name: "Alder Mining", share: 55 }, { name: "Birch Freight", share: 30 }, { name: "Cedar Trading", share: 15 }], others: 0 }, byConglomerate: { leaders: [{ name: "Halcyon Accord", share: 70 }, { name: "Birch Freight", share: 30 }], others: 0 } },
    "alpha-centauri": { activity: true, byCorporation: { leaders: [{ name: "Birch Freight", share: 100 }], others: 0 }, byConglomerate: { leaders: [{ name: "Birch Freight", share: 100 }], others: 0 } },
    "tau-ceti": { activity: true, byCorporation: { leaders: [{ name: "Birch Freight", share: 60 }, { name: "Dune Works", share: 40 }], others: 0 }, byConglomerate: { leaders: [{ name: "Birch Freight", share: 60 }, { name: "Dune Works", share: 40 }], others: 0 } },
    sirius: { activity: false, byCorporation: { leaders: [], others: 0 }, byConglomerate: { leaders: [], others: 0 } }
  }
};

describe("each system takes its leader's colour, as the API reads it (AB#913)", () => {
  it("corporate dominance: the viewer's own leads in its own colour, others in palette order by systems led", () => {
    const key = dominanceKey(reading, "corp-dominance", "Alder Mining");
    expect(key.bySystem.sol).toMatchObject({ leader: "Alder Mining", token: OWN_TOKEN, own: true, share: 55 });
    expect(key.bySystem["alpha-centauri"]).toMatchObject({ leader: "Birch Freight", token: LEADER_TOKENS[0], own: false });
    expect(key.bySystem["tau-ceti"].token).toBe(LEADER_TOKENS[0]); // the same leader, the same colour
    expect(key.bySystem.sirius).toMatchObject({ key: "quiet", token: QUIET_TOKEN, leader: null });
  });

  it("conglomerate dominance reads the conglomerate view: the Accord leads Sol", () => {
    const key = dominanceKey(reading, "cong-dominance", "Halcyon Accord");
    expect(key.bySystem.sol).toMatchObject({ leader: "Halcyon Accord", own: true, token: OWN_TOKEN });
    const noOwn = dominanceKey(reading, "cong-dominance", "");
    expect(noOwn.bySystem.sol.token).not.toBe(OWN_TOKEN); // no viewer's colour when the viewer leads nothing
  });

  it("names every colour it shows in the legend, the viewer's first and as 'You', with the systems each leads", () => {
    const key = dominanceKey(reading, "corp-dominance", "Alder Mining");
    const shown = new Set(Object.values(key.bySystem).map((s) => s.token));
    expect(new Set(key.legend.map((e) => e.token))).toEqual(shown);
    expect(key.legend.map((e) => [e.label, e.systems])).toEqual([["Alder Mining", 1], ["Birch Freight", 2], ["No activity in the last 7 days", 1]]);
    const html = dominanceLegendHtml(key, "corp-dominance", { computedAt: reading.computedAt });
    expect(html).toContain("<strong>You: Alder Mining</strong> · 1 system");
    expect(html).toContain("Birch Freight · 2 systems");
    expect(html).toContain("A ring in your colour (cyan) marks each system your corporation leads");
    expect(html).toContain("Computed 2147-09-28 00:01 UTC");
  });

  it("gathers leaders beyond the palette under 'Other leaders', still named in the legend", () => {
    const many = { systems: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`s${i}`, { activity: true, byCorporation: { leaders: [{ name: `Corp ${i}`, share: 100 }], others: 0 } }])) };
    const key = dominanceKey(many, "corp-dominance", "");
    expect(key.legend.filter((e) => e.token !== OTHER_TOKEN)).toHaveLength(LEADER_TOKENS.length);
    const rest = 8 - LEADER_TOKENS.length;
    expect(key.legend.at(-1)).toMatchObject({ label: `Other leaders (${rest})`, token: OTHER_TOKEN, systems: rest });
    expect(Object.values(key.bySystem).filter((s) => s.token === OTHER_TOKEN)).toHaveLength(rest);
  });

  it("lists a system's top three with shares, the viewer's marked, and says when nothing happened", () => {
    const html = dominanceDetailsHtml(reading.systems.sol, "corp-dominance", "Birch Freight");
    expect(html).toContain("<span>1. Alder Mining</span><strong>55%</strong>");
    expect(html).toContain('<li class="dominance-details__own"><span>2. Birch Freight (you)</span><strong>30%</strong>');
    expect(dominanceDetailsHtml(reading.systems.sirius, "corp-dominance")).toContain("No leases, mining or sales here in the last 7 days.");
    expect(dominanceDetailsHtml({ activity: true, byCorporation: { leaders: [{ name: "<b>x</b>", share: 40 }], others: 60 } }, "corp-dominance")).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("turns a token's hex into the canvas's rgba, and falls back rather than breaking", () => {
    expect(tokenRgba("#4fd8e8")).toBe("rgba(79, 216, 232, 0.92)");
    expect(tokenRgba(" #fff ")).toBe("rgba(255, 255, 255, 0.92)");
    expect(tokenRgba("var(--x)")).toMatch(/^rgba\(174, 189, 201/);
    expect(Object.keys(DOMINANCE_OVERLAYS)).toEqual(["corp-dominance", "cong-dominance"]);
  });
});

describe("the legend meets WCAG AA (AB#913)", () => {
  const tokens = readTokens();
  const value = (name) => resolve(tokens, name);
  const panel = value("--surface-1");

  it("its text is at least 4.5:1 on the panel", () => {
    for (const text of ["--text", "--text-soft", "--muted"]) {
      const ratio = contrast(value(text), panel);
      process.stderr.write(`[contrast] ${text} on --surface-1: ${ratio.toFixed(2)}:1\n`);
      expect(ratio, text).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every leader swatch is at least 3:1 on the panel, as a graphic must be; the quiet one is named, not relied on", () => {
    for (const token of [OWN_TOKEN, ...LEADER_TOKENS, OTHER_TOKEN]) {
      const ratio = contrast(value(token), panel);
      process.stderr.write(`[contrast] ${token} on --surface-1: ${ratio.toFixed(2)}:1\n`);
      expect(ratio, token).toBeGreaterThanOrEqual(3);
    }
  });
});
