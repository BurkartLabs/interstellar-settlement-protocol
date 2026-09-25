import { describe, it, expect } from "vitest";
import { actionReceiptView } from "../../public/scripts/actionReceipt.js";

// AB#743: the confirmation modal lays out the server's receipt and levels; it never computes a figure of its own.
const HIRE = {
  action: "hire",
  title: "Hiring Order Confirmed",
  summary: "1 employee added to the payroll.",
  cost: "2,000 credits",
  costCredits: 2000,
  grants: [{ label: "Employees", value: "5 / 20" }, { label: "Payroll added", value: "120 credits per day" }],
  next: "File an extraction lease at the ISA Claims & Leases Division."
};
const LEVEL_1 = {
  level: 1,
  maxLevel: 10,
  title: "Corporation Level 1",
  unlocks: [
    { key: "employeeCap", label: "Employee cap", value: "20" },
    { key: "buildingSlots", label: "Building slots", value: "2" },
    { key: "maxFleetSize", label: "Fleet cap", value: "8" },
    { key: "marketSectors", label: "Market sectors opened", value: "Raw Materials" }
  ]
};
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("actionReceiptView (AB#743)", () => {
  it("shows nothing for an answer with no receipt and no level: a refusal, or an action without a receipt yet", () => {
    expect(actionReceiptView({ error: "You must maintain a registered office." })).toBeNull();
    expect(actionReceiptView({ state: {}, levelsReached: [] })).toBeNull();
    expect(actionReceiptView(null)).toBeNull();
  });

  it("the receipt: what was done, what it cost, every grant, and the next action, in the server's words", () => {
    const view = actionReceiptView({ receipt: HIRE, levelsReached: [] });
    expect(view.variant).toBe("receipt");
    expect(view.title).toBe("Hiring Order Confirmed");
    const body = text(view.bodyHtml);
    expect(body).toContain("1 employee added to the payroll.");
    expect(body).toContain("Charged 2,000 credits");
    expect(body).toContain("Employees 5 / 20");
    expect(body).toContain("Payroll added 120 credits per day");
    expect(body).toContain("Next File an extraction lease at the ISA Claims & Leases Division.".replace("&", "&amp;"));
  });

  it("the milestone: the level and each unlock lead, and the order that reached it follows", () => {
    const view = actionReceiptView({ receipt: HIRE, levelsReached: [LEVEL_1] });
    expect(view.variant).toBe("milestone");
    expect(view.title).toBe("Corporation Level 1");
    const body = text(view.bodyHtml);
    expect(body).toContain("Your corporation reached Level 1 of 10.");
    for (const u of LEVEL_1.unlocks) expect(body).toContain(`${u.label} ${u.value}`);
    expect(body.indexOf("Market sectors opened")).toBeLessThan(body.indexOf("Hiring Order Confirmed"));
    expect(body).toContain("Charged 2,000 credits");
  });

  it("two levels at once: both listed, titled by the higher", () => {
    const view = actionReceiptView({ receipt: HIRE, levelsReached: [LEVEL_1, { ...LEVEL_1, level: 2, title: "Corporation Level 2" }] });
    expect(view.title).toBe("Corporation Level 2");
    expect(text(view.bodyHtml)).toContain("reached Level 1 of 10");
    expect(text(view.bodyHtml)).toContain("reached Level 2 of 10");
  });

  it("escapes everything it is given", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const view = actionReceiptView({ receipt: { ...HIRE, summary: hostile, grants: [{ label: hostile, value: hostile }], next: hostile }, levelsReached: [] });
    expect(view.bodyHtml).not.toContain("<img");
    expect(view.bodyHtml).toContain("&lt;img");
  });

  it("its own words are in the ISA's register: no exclamation marks, no congratulations", () => {
    const views = [actionReceiptView({ receipt: HIRE, levelsReached: [] }), actionReceiptView({ receipt: HIRE, levelsReached: [LEVEL_1] })];
    for (const v of views) expect(`${v.heading} ${v.title} ${text(v.bodyHtml)}`).not.toMatch(/!|congratulat/i);
  });
});
