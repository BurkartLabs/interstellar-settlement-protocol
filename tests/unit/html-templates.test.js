import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { tradeConfirmRowsHtml, queueItemsHtml } from "../../public/scripts/html.js";

// Bug #1002: three innerHTML templates put server strings into markup raw. Catalog data today; a player string tomorrow.
const ATTACK = "<img src=x onerror=alert(1)>";

describe("tradeConfirmRowsHtml (Bug #1002)", () => {
  it("renders markup in a label or value as text", () => {
    const html = tradeConfirmRowsHtml([{ label: ATTACK, value: "<svg onload=alert(2)>" }]);
    expect(html).not.toMatch(/<img|<svg/);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;svg onload=alert(2)&gt;");
  });

  it("still renders an ordinary confirmation, with its row classes", () => {
    const html = tradeConfirmRowsHtml([
      { label: "Item", value: "Silicates" },
      { label: "GEX Sales Tax (8%)", value: "− $192", muted: true },
      { label: "You Receive", value: "$2,208", highlight: true }
    ]);
    expect(html).toContain("<tr><td>Item</td><td class=\"trade-confirm-value\">Silicates</td></tr>");
    expect(html).toContain("<tr class=\"trade-confirm-muted\"><td>GEX Sales Tax (8%)</td>");
    expect(html).toContain("<tr class=\"trade-confirm-highlight\"><td>You Receive</td><td class=\"trade-confirm-value\">$2,208</td></tr>");
  });

  // The callers used to escape their own values; with the template escaping too, a seller named "A&B" would read "A&amp;amp;B".
  it("is not fed pre-escaped values by its callers", () => {
    const app = readFileSync(new URL("../../public/scripts/app.js", import.meta.url), "utf8");
    const calls = app.split("showTradeConfirmation({").slice(1).map((c) => c.slice(0, c.indexOf("});")));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) expect(call).not.toContain("escapeHtml(");
  });
});

describe("queueItemsHtml (Bug #1002)", () => {
  const helpers = { progressOf: () => 42, remainingLabel: () => "3h 5m remaining", formatCredits: (n) => `$${n.toLocaleString()}` };

  it("renders markup in a name, effect or subtitle as text", () => {
    const html = queueItemsHtml([{ name: ATTACK, effect: "<script>alert(3)</script>", durationHours: 8 }], "<b>track</b>", helpers);
    expect(html).not.toMatch(/<img|<script|<b>/);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;alert(3)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;track&lt;/b&gt;");
  });

  it("still renders an item in progress: name, effect, funding, progress and time left", () => {
    const html = queueItemsHtml([
      { name: "Fleet Coordination Matrix", effect: "+12 fleet cap", durationHours: 16, startedAt: 1, costCredits: 12000 }
    ], "Permanent corporate unlock track", helpers);
    expect(html).toContain("<h3>Fleet Coordination Matrix</h3>");
    expect(html).toContain("<p>+12 fleet cap</p>");
    expect(html).toContain("Duration: 16h | In progress");
    expect(html).toContain("Committed funding: $12,000 credits");
    expect(html).toContain("<span>42.0%</span><span>3h 5m remaining</span>");
    expect(html).toContain("width:42.0%");
  });

  it("shows a queued item without progress or funding", () => {
    const html = queueItemsHtml([{ name: "Energy Routing", effect: "+5% output", durationHours: 4 }], "track", helpers);
    expect(html).toContain("Duration: 4h | Queued");
    expect(html).not.toContain("queue-progress-meta");
    expect(html).not.toContain("Committed funding");
  });
});
