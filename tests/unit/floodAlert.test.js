import { describe, it, expect } from "vitest";
import { floodAlertText, withCents } from "../../public/scripts/priceChart.js";
import { tradeConfirmRowsHtml } from "../../public/scripts/html.js";
import { listingWarning } from "../../public/scripts/dumping.js";
import { WARFARE_CATALOG } from "../../server/warfare.js";

// ISP-233 (AB#928): the price-impact alert's words, the confirmation's warning rows, and when a listing warns at all.
const fc = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const watch = { terms: WARFARE_CATALOG.dumping, normal: { price: 270, dailyVolume: 1000 }, line: 229.5, volumeLine: 300, sales: [], alert: { day: "2026-09-26", close: 160, volume: 600, dropPct: 41, volumePct: 60 } };

describe("the price-impact alert and the listing warning (AB#928)", () => {
  it("says how far under normal value the last day closed, on what volume, and where the ITC's line is", () => {
    expect(floodAlertText("Rare-Earth Magnets", watch, fc)).toBe(
      "Price impact: Rare-Earth Magnets closed 2147-09-26 at $160, 41% under its normal value of $270, on 600 units (60% of a normal day). " +
      "The ITC counts sales below $229.50 toward a dumping investigation.");
    expect(floodAlertText("Rare-Earth Magnets", { ...watch, alert: null }, fc)).toBe("");
    expect(floodAlertText("Rare-Earth Magnets", null, fc)).toBe("");
  });

  it("names a price with its cents when it has any, so the line is never rounded above itself", () => {
    expect(withCents(229.5, fc)).toBe("$229.50");
    expect(withCents(270, fc)).toBe("$270");
    expect(withCents(269.734, fc)).toBe("$269.73");
  });

  it("warns only below the line, and not at all without a normal value", () => {
    expect(listingWarning(watch, 1000, 230)).toBeNull();
    expect(listingWarning({ ...watch, normal: null, line: null }, 1000, 1)).toBeNull();
    expect(listingWarning(watch, 300, 160)).toMatchObject({ found: true, Q: 300, duty: (270 - 160) * 300 });
  });

  it("draws a warning row in the warning colour and a note across both columns", () => {
    const html = tradeConfirmRowsHtml([{ label: "ITC Dumping Line", value: "$230", warn: true }, { note: "Below the <line>", warn: true }]);
    expect(html).toContain('<tr class="trade-confirm-warn"><td>ITC Dumping Line</td>');
    expect(html).toContain('<tr class="trade-confirm-note trade-confirm-warn"><td colspan="2">Below the &lt;line&gt;</td></tr>');
  });
});
