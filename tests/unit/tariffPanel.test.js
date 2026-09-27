import { describe, it, expect } from "vitest";
import { tariffHoldingHtml, tariffLineHtml, tariffPanelHtml } from "../../public/scripts/tariffPanel.js";

// ISP-231 (AB#926): the starmap system panel's tariff: the public rate with a pending change in UTC, and the holder's
// schedule, with the form only where it can be filed (docked in the system).
const AT = Date.UTC(2026, 8, 30, 14, 0);
const holding = { systemId: "alpha-centauri", cap: 3, pct: 1, pending: { pct: 2, effectiveAt: AT }, systemPct: 1, holders: 1, docked: true, accrued: 180, paidTotal: 5400 };

describe("the tariff in the system panel (AB#926)", () => {
  it("shows a held system's rate and a pending change with its time in UTC, and nothing where nobody holds it", () => {
    const html = tariffLineHtml({ systemId: "alpha-centauri", cap: 3, pct: 1, pending: { pct: 2, effectiveAt: AT }, held: true });
    expect(html).toContain("<strong>1%</strong> on sales here and goods shipped in (cap 3%)");
    expect(html).toContain("It becomes <strong>2%</strong> at 2147-09-30 14:00 UTC.");
    expect(tariffLineHtml({ held: false, pct: 0, cap: 3 })).toBe("");
  });

  it("gives the holder its schedule, and the form only when docked in the system", () => {
    const html = tariffHoldingHtml(holding, "Alpha Centauri");
    expect(html).toContain("In force: <strong>1%</strong> of a 3% cap");
    expect(html).toContain("Filed: <strong>2%</strong>, in force at 2147-09-30 14:00 UTC");
    expect(html).toContain("Collected to date: <strong>$5,400</strong>");
    expect(html).toContain("At the next payout (00:00 UTC): <strong>$180</strong>");
    expect(html).toContain('data-form="file-tariff"');
    expect(html).toMatch(/max="3" step="0.25" value="2"/);
    const away = tariffHoldingHtml({ ...holding, docked: false }, "Alpha Centauri");
    expect(away).not.toContain("data-form");
    expect(away).toContain("travel there to change it");
    expect(tariffHoldingHtml(null, "x")).toBe("");
  });

  it("says a condominium charges the lower of its two holders' rates", () => {
    expect(tariffHoldingHtml({ ...holding, holders: 2, pct: 3, systemPct: 1 }, "61 Cygni")).toContain("The system charges <strong>1%</strong>: the lower of its two holders' rates");
    expect(tariffPanelHtml("alpha-centauri", { systems: {}, holdings: [holding] }, "Alpha Centauri")).toContain("Your tariff");
  });
});
