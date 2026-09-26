// NPC sell orders (ISP-122, AB#815; docs/design/npc-corporations.md, AB#812).
//
// Each NPC corporation in data/npc-corporations.json posts an ask for every good it trades: an entry in the shared
// order book with `npc: true`, the corporation as seller, its home station, no seller account and the id
// `npc-sell-<item>`. The price is the design's base ask, `askMultiple` times the good's standing bid base
// (data/economy.json); drift with volume is AB#817's.
//
// Kept apart from player listings (AB#425: a global cap once deleted the oldest listings, goods and all):
//   - placeNpcAsks touches only entries flagged npc, by id, and never removes, reorders or trims anything else;
//   - an NPC ask has no sellerAccountId, so it counts against no seller's listing cap, and the client view shows
//     it outside the 200-order cap (server/marketView.js);
//   - no route creates, edits or cancels one (server/routes/market.js refuses `npc` in a request).
// It is pure: it works on the market object it is given, so the seed and the tick share it.

import { ECONOMY } from "../economy.js";
import { NPC_CATALOG } from "../npcCorporations.js";

export const NPC_ASK_PREFIX = "npc-sell-";
export const npcAskId = (item) => `${NPC_ASK_PREFIX}${String(item).toLowerCase().replace(/\s+/g, "-")}`;

/** The asks the design specifies now: one per NPC corporation and traded good that has a standing bid to price from. */
export function npcAskSpecs(catalog = NPC_CATALOG, economy = ECONOMY) {
  if (!catalog) return [];
  const multiple = Number(economy?.npcAsks?.askMultiple) || 1.5;
  const specs = [];
  for (const corp of catalog.corporations) {
    for (const item of corp.trades || []) {
      const bid = (economy?.npcBuyers || []).find((b) => b.item === item);
      const quantity = Math.floor(Number((economy?.npcAsks?.dailyQty || []).find((d) => d.item === item)?.qty) || 0);
      if (!bid || quantity <= 0) continue;
      specs.push({
        id: npcAskId(item),
        type: "sell",
        npc: true,
        item,
        seller: corp.name,
        npcCorporationId: corp.id,
        stationId: corp.homeStationId,
        unitPrice: Math.round(Number(bid.unitPrice) * multiple),
        dailyQty: quantity
      });
    }
  }
  return specs;
}

/**
 * Put the design's asks in `market.orderBook`. Missing ones are added at the oldest end of the book, so the newest
 * player listings keep their places. Existing ones keep their quantity unless `refill` (the daily refresh), and take
 * the current seller, station and price. An NPC ask the catalog no longer names is removed. Nothing without
 * `npc: true` is touched. Running it twice changes nothing the first run did not (a restart does not duplicate).
 */
export function placeNpcAsks(market, { refill = false, now = Date.now(), specs = npcAskSpecs() } = {}) {
  if (!market || typeof market !== "object") return market;
  if (!Array.isArray(market.orderBook)) market.orderBook = [];
  const book = market.orderBook;
  const wanted = new Set(specs.map((s) => s.id));
  for (const spec of specs) {
    const { dailyQty, ...fields } = spec;
    const existing = book.find((o) => o?.id === spec.id);
    if (existing && existing.npc === true) {
      Object.assign(existing, fields);
      if (refill || !Number.isFinite(Number(existing.quantity))) existing.quantity = dailyQty;
    } else if (!existing) {
      book.push({ ...fields, quantity: dailyQty, createdAt: now });
    }
    // An entry with the id but no npc flag is not ours to overwrite; player orders are "ord-..." and never collide.
  }
  market.orderBook = book.filter((o) => !(o?.npc === true && String(o.id).startsWith(NPC_ASK_PREFIX) && !wanted.has(o.id)));
  return market;
}
