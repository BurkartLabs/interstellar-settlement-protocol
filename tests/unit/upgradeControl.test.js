import { describe, it, expect } from "vitest";
import { ECONOMY } from "../../server/economy.js";
import { MILESTONE_LEVELS } from "../../server/game/catalog.js";
import { upgradePath, yardUpgradeHtml, yardUpgradeView } from "../../public/scripts/upgradeControl.js";

// ISP-103 (AB#795): the upgrade control on an extractor yard. Its numbers come from what GET /api/bootstrap sends
// (server/routes/catalog.js): data/economy.json's operations and buildings, and each level's maxUpgradeTier. The
// fixture below is built the way that route builds it; changing a value in it must change what is drawn.
function bootstrapEconomy(buildings = ECONOMY.buildings) {
  return {
    operations: ECONOMY.operations,
    salesTaxPct: ECONOMY.exchange.salesTaxPct,
    silicateUnitPrice: 24,
    buildings,
    upgradeTierByLevel: MILESTONE_LEVELS.map((l) => ({ level: l.level, maxUpgradeTier: Number(l.unlocks?.maxUpgradeTier) || 1 }))
  };
}
const yard = (over = {}) => ({ id: "ext-1", buildingId: "bld-1", tier: 1, active: false, ...over });
const corp = (over = {}) => ({ level: 3, unlocks: { maxUpgradeTier: 2 }, finances: { credits: 500_000 }, mining: { silicateExtractors: [yard()] }, ...over });
const html = (ex, c, economy = bootstrapEconomy(), opts) => yardUpgradeHtml(yardUpgradeView(ex, c, economy, opts), ex.id);

describe("the upgrade control (AB#795)", () => {
  it("shows the tier, the next tier's price, and what changes, from the server's numbers", () => {
    const out = html(yard(), corp());
    expect(out).toContain("<strong>Tier 1</strong> of 8"); // AB#2308
    expect(out).toContain("Upgrade to tier 2 ($40,000)");
    expect(out).toContain("cap 250 &rarr; 313 t/h");
    expect(out).toContain("best rate 146 &rarr; 182 t/h");
    expect(out).toContain("running cost at best $2,618 &rarr; $3,262/h");
    expect(out).toContain("nets $606 &rarr; $757/h");
    expect(out).toContain("offline 6 h while it upgrades");
    expect(out).toContain('data-upgrade-building="bld-1"');
    expect(out).not.toContain("disabled");
  });

  it("draws a changed server value: a different price and cap in the fixture are what the control shows", () => {
    const changed = { ...ECONOMY.buildings, extractorYardUpgrades: ECONOMY.buildings.extractorYardUpgrades.map((u) => (u.toTier === 2 ? { ...u, upgradeCost: 41_234, throughputCap: 350 } : u)) };
    const out = html(yard(), corp(), bootstrapEconomy(changed));
    expect(out).toContain("Upgrade to tier 2 ($41,234)");
    expect(out).toContain("cap 250 &rarr; 350 t/h");
  });

  it("at the yard's last tier the button is replaced by the reason", () => {
    const out = html(yard({ tier: 8 }), corp({ unlocks: { maxUpgradeTier: 8 } }));
    expect(out).toContain("Tier 8 is this yard&#39;s last."); // escaped as drawn; AB#2308 made 8 the last
    expect(out).not.toContain("<button");
  });

  it("above the level's limit the button is replaced by the level that opens the tier, from milestones.json", () => {
    const out = html(yard(), corp({ level: 1, unlocks: { maxUpgradeTier: 1 } }));
    expect(out).toContain("Tier 2 opens at Corporation Level 2; you are Level 1.");
    expect(out).toContain("cap 250 &rarr; 313 t/h"); // the comparison is still shown
    expect(out).not.toContain("<button");
    const t3 = html(yard({ tier: 2 }), corp({ level: 3, unlocks: { maxUpgradeTier: 2 } }));
    expect(t3).toContain("Tier 3 opens at Corporation Level 4; you are Level 3.");
  });

  it("a tier-5 yard sees tier 6's comparison, and that no level opens it yet (AB#2308, until AB#800 to AB#802)", () => {
    const out = html(yard({ tier: 5 }), corp({ level: 10, unlocks: { maxUpgradeTier: 5 } }));
    expect(out).toContain("<strong>Tier 5</strong> of 8");
    expect(out).toContain("cap 610 &rarr; 763 t/h");
    expect(out).toContain("Tier 6 is not open at any level yet.");
    expect(out).not.toContain("<button");
    const allowed = html(yard({ tier: 5 }), corp({ level: 10, unlocks: { maxUpgradeTier: 6 } }));
    expect(allowed).toContain("Upgrade to tier 6 ($202,500)");
  });

  it("keeps the button, disabled with the reason, while a cycle runs, while it upgrades, or short of credit", () => {
    expect(html(yard({ active: true }), corp())).toMatch(/Stop or finish its mining cycle first[\s\S]*disabled/);
    const until = Date.UTC(2026, 8, 26, 14, 5);
    expect(html(yard({ upgradingUntil: until }), corp(), bootstrapEconomy(), { now: until - 60_000 })).toMatch(/back online at 14:05 UTC[\s\S]*disabled/);
    expect(html(yard(), corp({ finances: { credits: 12_500 } }))).toMatch(/Needs \$40,000; you have \$12,500\.[\s\S]*disabled/);
  });

  it("a second yard's running cost includes its upkeep (AB#2284)", () => {
    const second = yard({ id: "ext-2", buildingId: "bld-2" });
    const out = html(second, corp({ mining: { silicateExtractors: [yard(), second] } }));
    expect(out).toContain("running cost at best $2,659 &rarr; $3,303/h");
  });

  it("fails closed: no prices loaded, or no building record, means no button", () => {
    expect(html(yard(), corp(), {})).toContain("The upgrade prices have not loaded; reload the page.");
    expect(html(yard({ buildingId: "" }), corp())).toContain("This yard has no building record to upgrade.");
    for (const out of [html(yard(), corp(), {}), html(yard({ buildingId: "" }), corp())]) expect(out).not.toContain("<button");
  });

  it("escapes what it draws and posts to the one upgrade route", () => {
    expect(html(yard({ id: '"><img src=x>', buildingId: '"><b>' }), corp())).not.toMatch(/<img|<b>/);
    expect(upgradePath("acc 1", "bld/2")).toBe("/api/accounts/acc%201/gameplay/buildings/bld%2F2/upgrade");
  });
});
