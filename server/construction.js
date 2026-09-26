// server/construction.js: building a player building (ISP-94, AB#784). One path for every building in
// data/player-buildings.json, run inside the caller's mutateAccountState: the lease a building stands on, the
// catalogue's research gates and cap, the lease's slots, a corporation slot, the price, and only then the change.
// Every check comes before the first write, so a refusal leaves the corporation exactly as it was.
//
// What a building adds beyond its slot and its price is its construction below. A catalogue entry with none is
// refused, not built bare: a building added to the file cannot be bought before its effect is written (fails closed).
import { buildCostFor } from "./economy.js";
import { applyCredits } from "./finances.js";
import { catalogueRefusal } from "./playerBuildings.js";
import { buildAssemblyReceipt, buildExtractorReceipt, buildRefineryReceipt } from "./receipts.js";

const hasTech = (corp, id) => (corp.unlockedTech || []).includes(id);
const slotCount = (corp) => ({ slotsUsed: (corp.buildings || []).length, slotsTotal: corp.buildingSlots || 2 });

/**
 * Per building: `cost(building, corp)` when the price is not the catalogue's, `place(corp, building, lease)` for what it
 * adds (returning what the receipt names), and the notification and receipt a build sends.
 */
export const CONSTRUCTIONS = Object.freeze({
  "basic-extractor-yard": {
    cost: (building, corp) => buildCostFor(building.cost, hasTech(corp, "tt-supply-forecast")),
    place(corp, building, lease) {
      if (!corp.mining || typeof corp.mining !== "object") corp.mining = {};
      if (!Array.isArray(corp.mining.silicateExtractors)) corp.mining.silicateExtractors = [];
      const nextIndex = corp.mining.silicateExtractors.length + 1;
      const id = `ext-basic-${nextIndex}`;
      corp.mining.silicateExtractors.push({
        id,
        name: `${building.name} #${nextIndex}`,
        tier: 1,
        active: false,
        startedAt: null,
        lastTickAt: null,
        endsAt: null,
        throughputPerHour: 0,
        operationCostPerHour: 0,
        totalMined: 0,
        totalSpent: 0,
        lastCompletedAt: null,
        leaseId: lease.id,
        // The lease body on the yard itself, so its location survives any later change to lease ids.
        body: lease.body || null
      });
      if (!Array.isArray(lease.extractorIds)) lease.extractorIds = [];
      lease.extractorIds.push(id);
      return { extractorName: `${building.name} #${nextIndex}`, body: lease.body || null };
    },
    notification: { title: "Extractor Commissioned", body: "Basic Extractor Yard is now operational and linked to your mining lease." },
    receipt: (built) => buildExtractorReceipt(built)
  },
  "assembly-facility": {
    place: () => ({}),
    notification: { title: "Assembly Facility Online", body: "Your Assembly Facility is now operational. You may begin fabricating units." },
    receipt: (built, corp) => buildAssemblyReceipt({ cost: built.cost, assetValue: built.assetValue, ...slotCount(corp) })
  },
  refinery: {
    place(corp) {
      if (!Array.isArray(corp.refineries)) corp.refineries = [];
      const nextIndex = corp.refineries.length + 1;
      corp.refineries.push({
        id: `ref-${nextIndex}`,
        name: `Refinery #${nextIndex}`,
        tier: 1,
        active: false,
        chainId: null,
        startedAt: null,
        lastTickAt: null,
        endsAt: null,
        cyclesCompleted: 0,
        totalInputConsumed: 0,
        totalOutputProduced: 0
      });
      return { refineryName: `Refinery #${nextIndex}` };
    },
    notification: { title: "Refinery Commissioned", body: "A new Refinery is now operational and ready for production runs." },
    receipt: (built, corp) => buildRefineryReceipt({ refineryName: built.refineryName, cost: built.cost, ...slotCount(corp) })
  }
});

/** The slots a building can take today. "upgrade" is in the catalogue's shape but nothing builds one yet. */
const BUILDABLE_SLOTS = new Set(["corporation", "corporation+lease"]);

/**
 * Build `building` for `corp`, on the lease `leaseId` when it stands on one. Returns { outcome: "ok", cost, assetValue,
 * ...what place() returned } after the change, or { outcome } naming the first refusal, having changed nothing.
 */
export function construct(corp, building, leaseId) {
  if (!building) return { outcome: "unknown-building" };
  const construction = CONSTRUCTIONS[building.id];
  if (!construction || !BUILDABLE_SLOTS.has(building.slot)) return { outcome: "not-constructible" };

  let lease = null;
  if (building.slot === "corporation+lease") {
    if (!leaseId) return { outcome: "no-lease-named" };
    lease = (corp.miningLeases || []).find((l) => l?.id === leaseId);
    if (!lease) return { outcome: "no-lease" };
  } else if (leaseId) {
    return { outcome: "not-on-lease" };
  }

  const refused = catalogueRefusal(building, corp);
  if (refused) return { outcome: refused };
  if (lease && (lease.extractorIds || []).length >= lease.buildingSlots) return { outcome: "lease-slots-full" };
  if ((corp.buildings || []).length >= (corp.buildingSlots || 2)) return { outcome: "no-corp-slot" };
  const cost = construction.cost ? construction.cost(building, corp) : building.cost;
  if ((corp.finances?.credits || 0) < cost) return { outcome: "insufficient-credits" };

  if (!Array.isArray(corp.buildings)) corp.buildings = [];
  corp.buildings.push({ name: building.name, tier: 1, status: "Operational" }); // the catalogue name; a test holds them equal
  const placed = construction.place(corp, building, lease);
  applyCredits(corp, -cost, "construction");
  corp.finances.assets = (corp.finances.assets || 0) + building.assetValue;
  return { outcome: "ok", cost, assetValue: building.assetValue, ...placed };
}
