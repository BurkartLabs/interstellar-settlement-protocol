// AB#829: what a body yields and what a yard is producing, as the lease picker and the extractor row show them. The
// profile is the catalog's (data/systems.json resourceProfile, AB#826, served by GET /api/systems); the per-item output
// is the server's (minedThisCycleByItem, AB#828/AB#829). Nothing here estimates. Pure: it loads in node and the browser.

const units = (n) => `${Math.round(Number(n) || 0).toLocaleString("en-US")} t`;

/** The catalog's resource profile for the body named `bodyName`: [{ item, concentration }], or [] when it has none. */
export function bodyProfile(systemsCatalog, bodyName) {
  for (const system of systemsCatalog || []) {
    const body = (system.bodies || []).find((b) => b.name === bodyName);
    if (body) return Array.isArray(body.resourceProfile) ? body.resourceProfile : [];
  }
  return [];
}

/** "Silicates 100%", or "Hydrogen 55% · Helium-3 30% · Deuterium 15%": each item and its share, as the catalog lists them. */
export function profileText(profile) {
  if (!profile?.length) return "Not surveyed";
  return profile.map((p) => `${p.item} ${Math.round(Number(p.concentration) * 100)}%`).join(" · ");
}

/**
 * This cycle's output per item, most first: [{ item, units }]. A cycle started before per-item counts (AB#829) mined
 * only Silicates, so its minedThisCycle is Silicates.
 */
export function cycleItems(extractor) {
  const byItem = extractor?.minedThisCycleByItem;
  const record = byItem && typeof byItem === "object"
    ? byItem
    : Number(extractor?.minedThisCycle) > 0 ? { Silicates: Number(extractor.minedThisCycle) } : {};
  return Object.entries(record).filter(([, n]) => Number(n) > 0).map(([item, n]) => ({ item, units: Number(n) }))
    .sort((a, b) => b.units - a.units || a.item.localeCompare(b.item));
}

/** "Silicates 1,234 t · Iron Ore 300 t", or "Nothing yet" at the start of a cycle. */
export function cycleItemsText(extractor) {
  const items = cycleItems(extractor);
  return items.length ? items.map((i) => `${i.item} ${units(i.units)}`).join(" · ") : "Nothing yet";
}
