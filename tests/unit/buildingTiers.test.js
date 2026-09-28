import { describe, it, expect } from "vitest";
import { ECONOMY } from "../../server/economy.js";
import { MILESTONE_LEVELS } from "../../server/game/catalog.js";
import { PLAYER_BUILDING_CATALOGUE, playerBuildingProblems } from "../../server/playerBuildings.js";
import { tierTableFor } from "../../public/scripts/buildingTiers.js";
import { facilityUpgradeHtml, facilityUpgradeView } from "../../public/scripts/upgradeControl.js";
import { facilityCardsHtml, facilityStatus } from "../../public/scripts/stationFacilities.js";

// ISP-102 (AB#794): every catalogue building has upgrade tiers or says it has none, and each tier row sets the field
// its type's effect reads (docs/design/upgrades.md).
const EFFECT_FIELD = { "basic-extractor-yard": "throughputCap", "assembly-facility": "fabricationTimePct", refinery: "outputMultiplier" };
const catalogue = JSON.parse(JSON.stringify(PLAYER_BUILDING_CATALOGUE));

describe("every catalogue building has a tier table or is marked \"none\" (AB#794)", () => {
  it.each(PLAYER_BUILDING_CATALOGUE.map((b) => [b.id, b]))("%s", (id, entry) => {
    expect(typeof entry.tiers).toBe("string");
    const table = tierTableFor(entry, PLAYER_BUILDING_CATALOGUE, ECONOMY.buildings);
    if (entry.tiers === "none") {
      expect(table).toBeNull();
      return;
    }
    expect(table.length).toBeGreaterThan(0);
    expect(table.map((r) => r.toTier)).toEqual(table.map((_, i) => i + 2)); // tiers 2, 3, ... with no gap
    expect(EFFECT_FIELD[id], `${id} has tiers but no effect the upgrade route applies`).toBeTruthy();
    for (const row of table) {
      expect(row.upgradeCost).toBeGreaterThan(0);
      expect(row.assetValue).toBeGreaterThan(0);
      expect(row.offlineHours).toBeGreaterThanOrEqual(0);
      expect(row[EFFECT_FIELD[id]], `${id} tier ${row.toTier}`).toBeGreaterThan(0);
    }
  });

  it("the catalogue check refuses a building with no tiers field, an unknown table or an empty one", () => {
    const economy = { buildings: { ...ECONOMY.buildings, emptyUpgrades: [] } };
    const withTiers = (tiers) => ({ buildings: catalogue.map((b, i) => (i === 0 ? { ...b, tiers } : b)) });
    expect(playerBuildingProblems(withTiers(undefined), economy).join(" ")).toMatch(/tiers must be "none"/);
    expect(playerBuildingProblems(withTiers("noSuchUpgrades"), economy).join(" ")).toMatch(/tiers must be "none"/);
    expect(playerBuildingProblems(withTiers("emptyUpgrades"), economy).join(" ")).toMatch(/tiers must be "none"/);
    expect(playerBuildingProblems({ buildings: catalogue }, ECONOMY)).toEqual([]);
  });

  it("the Refinery's tier 2 is the Refinery Complex's own price and multiplier, not a second copy", () => {
    const refinery = PLAYER_BUILDING_CATALOGUE.find((b) => b.id === "refinery");
    const [tier2] = tierTableFor(refinery, PLAYER_BUILDING_CATALOGUE, ECONOMY.buildings);
    expect(tier2).toMatchObject({ toTier: 2, upgradeCost: ECONOMY.buildings.refineryComplexCost, assetValue: ECONOMY.buildings.refineryComplexAssetValue, outputMultiplier: ECONOMY.buildings.refineryComplexOutputMultiplier, via: "refinery-complex" });
  });
});

describe("the upgrade control on a facility card (AB#794)", () => {
  const economy = (buildings = ECONOMY.buildings) => ({
    buildings,
    probeFabricationMs: 30 * 60_000,
    upgradeTierByLevel: MILESTONE_LEVELS.map((l) => ({ level: l.level, maxUpgradeTier: Number(l.unlocks?.maxUpgradeTier) || 1 }))
  });
  const corp = (over = {}) => ({ level: 4, unlocks: { maxUpgradeTier: 3 }, finances: { credits: 1_000_000 }, unlockedTech: ["tt-nano-lattice"], refineries: [{ id: "ref-1", active: false }], ...over });
  const refinery = { id: "bld-r", name: "Refinery", tier: 1 };
  const html = (b, c = corp({ buildings: [b] }), e = economy()) => facilityUpgradeHtml(facilityUpgradeView(b, c, e, catalogue));

  it("a Refinery: tier 1 of 4, the Complex's price, and output x1 to x1.5", () => {
    const out = html(refinery);
    expect(out).toContain("<strong>Tier 1</strong> of 4"); // ISP-192 (AB#886): tier 4 takes Superconducting Coils
    expect(out).toContain("output per run &times;1 &rarr; &times;1.5");
    expect(out).toContain("Upgrade to tier 2 (¤100,000)");
  });

  it("an Assembly Facility: probe fabrication 30 min to 15 min, 2 hours offline", () => {
    const out = html({ id: "bld-a", name: "Assembly Facility", tier: 1 });
    expect(out).toContain("probe fabrication 30 min &rarr; 15 min each");
    expect(out).toContain("offline 2 h while it upgrades");
    expect(out).toContain("Upgrade to tier 2 (¤30,000)");
  });

  it("draws a changed server value", () => {
    const changed = { ...ECONOMY.buildings, assemblyFacilityUpgrades: [{ ...ECONOMY.buildings.assemblyFacilityUpgrades[0], upgradeCost: 31_234, fabricationTimePct: 40 }] };
    const out = html({ id: "bld-a", name: "Assembly Facility", tier: 1 }, undefined, economy(changed));
    expect(out).toContain("Upgrade to tier 2 (¤31,234)");
    expect(out).toContain("30 min &rarr; 12 min each");
  });

  it("replaces the button with the reason at the last tier, at the level's limit, and on a building with no tiers", () => {
    expect(html({ ...refinery, tier: 4 }, corp({ buildings: [{ ...refinery, tier: 4 }], unlocks: { maxUpgradeTier: 5 } }))).toMatch(/Tier 4 is its last\.(?![\s\S]*<button)/);
    expect(html(refinery, corp({ buildings: [refinery], level: 1, unlocks: { maxUpgradeTier: 1 } }))).toMatch(/Tier 2 opens at Corporation Level 2; you are Level 1\.(?![\s\S]*<button)/);
    expect(html({ id: "bld-f", name: "Ferric Mining Complex", tier: 1 })).toMatch(/has no upgrades\.(?![\s\S]*<button)/);
  });

  it("keeps the button disabled with the reason while it runs or is short of credit", () => {
    expect(html(refinery, corp({ buildings: [refinery], refineries: [{ id: "ref-1", active: true }] }))).toMatch(/production run[\s\S]*disabled/);
    expect(html(refinery, corp({ buildings: [refinery], finances: { credits: 5_000 } }))).toMatch(/Needs ¤100,000; you have ¤5,000\.[\s\S]*disabled/);
    // ISP-192 (AB#886): the Refinery's tier 4 also takes 10 Superconducting Coils from the docked station's stock
    const t3 = { ...refinery, tier: 3 };
    const short = (inventory, currentStationId = "earth-station-prime") => html(t3, corp({ buildings: [t3], unlocks: { maxUpgradeTier: 5 }, currentStationId, inventory }));
    expect(short({ "earth-station-prime": { "Superconducting Coils": 4 } })).toMatch(/Needs 10 Superconducting Coils at this station; you hold 4\.[\s\S]*disabled[\s\S]*¤250,000 \+ 10 Superconducting Coils/);
    expect(short({ "earth-station-prime": { "Superconducting Coils": 10 } })).not.toMatch(/disabled/);
    expect(short({}, null)).toMatch(/Dock where you hold the goods it takes, then upgrade\.[\s\S]*disabled/);
  });

  it("a card with the control says the tier once, and Upgrading while it is offline", () => {
    const b = { id: "bld-a", name: "Assembly Facility", tier: 2, status: "Operational" };
    const out = facilityCardsHtml({ buildings: [b] }, NaN, () => "<p>control</p>");
    expect(out).not.toMatch(/Tier 2 &mdash;/);
    expect(out).toContain('<p class="ui-badge">Operational</p>');
    expect(facilityStatus({ ...b, upgradingUntil: 2_000 }, {}, 1_000)).toBe("Upgrading");
    const r = { id: "bld-r", name: "Refinery", tier: 3, status: "Operational" };
    expect(facilityStatus(r, { buildings: [r], refineries: [{ upgradingUntil: 2_000 }] }, 1_000)).toBe("Upgrading");
    expect(facilityStatus(r, { buildings: [r], refineries: [{ upgradingUntil: 500 }] }, 1_000)).toBe("Operational");
  });
});
