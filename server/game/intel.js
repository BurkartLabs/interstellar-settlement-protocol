// server/game/intel.js: intel shared inside a conglomerate (ISP-207, AB#902; docs/design/CONGLOMERATES.md, "Shared
// intel"). Intel is shared only where a member can act on it (P-INERT-FEATURE):
//
// - A belt any current member scouted this generation may be dispatched to by every member, and the dispatch screen
//   shows its composition and what remains (the dispatch gate calls beltSharedWith, server/routes/asteroids.js).
// - Members' active sell listings, grouped by item, so a member can price against partners rather than undercut them.
//   Only the fields the public order book already shows: item, quantity, unit price, seller name, listed at.
//
// Membership is read from the roster on every call, never cached: a corporation that leaves loses its partners' intel,
// and its partners lose its scouting, on the next request. Nothing here names an account id, a credit balance or an
// inventory.

import { isBeltPresent, isBeltScoutedBy } from "./belts.js";
import { accountByCorp, findConglomerate, roleOf } from "./membership.js";

/** The conglomerate `corp` belongs to now, confirmed against the roster, or null. */
export function currentConglomerateOf(corp) {
  if (!corp?.publicId || !corp.conglomerateId) return null;
  const c = findConglomerate(corp.conglomerateId);
  return c && roleOf(c, corp.publicId) ? c : null;
}

/**
 * The names of the other current members that scouted this generation of `belt`, for the corporation `corp`; [] when
 * none did or `corp` is in no conglomerate. The corporation's own scouting is not intel and is not listed.
 */
export function beltSharedWith(corp, belt) {
  const c = currentConglomerateOf(corp);
  if (!c || !isBeltPresent(belt)) return [];
  const names = [];
  for (const m of c.members) {
    if (m.corp === corp.publicId) continue;
    const other = accountByCorp(m.corp)?.state?.corp;
    if (other && isBeltScoutedBy(other.asteroidMining, belt)) names.push(other.corporationName || "A member");
  }
  return names;
}

/** The corporation's conglomerate's intel: the shared belts and the members' listings. Null when it is in none. */
export function conglomerateIntel(corp, { belts = [], orderBook = [] } = {}) {
  const c = currentConglomerateOf(corp);
  if (!c) return null;
  const shared = [];
  for (const belt of belts) {
    const by = beltSharedWith(corp, belt);
    if (!by.length) continue;
    shared.push({
      key: belt.key,
      generation: belt.generation,
      rarity: belt.rarity,
      composition: { ...belt.composition },
      reserve: belt.reserve,
      remaining: belt.remaining,
      scoutedBy: by,
      scoutedByYou: isBeltScoutedBy(corp.asteroidMining, belt)
    });
  }
  // Each member's own account id, to find its listings; never sent.
  const sellers = new Map();
  for (const m of c.members) {
    const account = accountByCorp(m.corp);
    if (account) sellers.set(account.id, { name: account.state.corp.corporationName || "A member", mine: m.corp === corp.publicId });
  }
  const byItem = {};
  for (const o of orderBook) {
    const seller = o?.type === "sell" ? sellers.get(o.sellerAccountId) : null;
    if (!seller || !(Number(o.quantity) > 0)) continue;
    (byItem[o.item] ||= []).push({ item: o.item, quantity: o.quantity, unitPrice: o.unitPrice, seller: seller.name, mine: seller.mine, listedAt: o.createdAt });
  }
  const listings = Object.entries(byItem)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([item, rows]) => ({ item, listings: rows.sort((x, y) => x.unitPrice - y.unitPrice), lowest: Math.min(...rows.map((r) => r.unitPrice)) }));
  return { conglomerate: { id: c.id, name: c.name }, belts: shared, listings };
}
