// Each catalogue building's upgrade tiers (ISP-102, AB#794; docs/design/upgrades.md, AB#791), one rule for the server
// (server/buildingTiers.js, server/upgrades.js) and the page (upgradeControl.js), so the tiers a player is shown are the
// tiers the server sells. A catalogue entry's `tiers` names its table in data/economy.json's buildings, or is "none".
// A tier the catalogue already sells as an upgrade building is not priced twice: the Refinery's tier 2 is the Refinery
// Complex (AB#787, `upgrades: "refinery"`), made from the Complex's own price. Pure: it loads in node and the browser.

/**
 * A building's tier table, rows { toTier, upgradeCost, assetValue, offlineHours, ...effect } in tier order, or null
 * for a building with no tiers. A row made from an upgrade building carries `via`, that building's id.
 */
export function tierTableFor(entry, catalogue = [], buildings = {}) {
  if (!entry || !entry.tiers || entry.tiers === "none") return null;
  const rows = [...(buildings?.[entry.tiers] || [])];
  const viaUpgrade = (catalogue || []).find((b) => b.slot === "upgrade" && b.upgrades === entry.id);
  if (viaUpgrade) {
    rows.push({
      toTier: 2,
      upgradeCost: viaUpgrade.cost ?? buildings?.[`${viaUpgrade.price}Cost`],
      assetValue: viaUpgrade.assetValue ?? buildings?.[`${viaUpgrade.price}AssetValue`],
      offlineHours: 0, // the Complex is built in place with no downtime (AB#787); the upgrade route matches it
      outputMultiplier: buildings?.[`${viaUpgrade.price}OutputMultiplier`],
      via: viaUpgrade.id
    });
  }
  return rows.sort((a, b) => a.toTier - b.toTier);
}

/** How long a probe takes at an Assembly Facility of `tier`: the tier row's share of the base time. */
export function fabricationMsFor(tier, baseMs, buildings = {}) {
  const row = (buildings?.assemblyFacilityUpgrades || []).find((u) => u.toTier === Number(tier));
  return Number(tier) > 1 && row ? Math.round((baseMs * row.fabricationTimePct) / 100) : baseMs;
}
