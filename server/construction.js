// server/construction.js: building a player building (ISP-94, AB#784). One path for every building in
// data/player-buildings.json, run inside the caller's mutateAccountState: the lease a building stands on, the
// catalogue's research gates and cap, the lease's slots, a corporation slot, the price, and only then the change.
// Every check comes before the first write, so a refusal leaves the corporation exactly as it was.
//
// What a building adds beyond its slot and its price is its construction below. A catalogue entry with none is
// refused, not built bare: a building added to the file cannot be bought before its effect is written (fails closed).
import { nextYardPriceFor } from "../public/scripts/yardPrice.js";
import { applyCredits } from "./finances.js";
import { catalogueRefusal, PLAYER_BUILDING_CATALOGUE } from "./playerBuildings.js";
import { buildAssemblyReceipt, buildCryoVaporArrayReceipt, buildExtractorReceipt, buildFerricMiningComplexReceipt, buildRefineryComplexReceipt, buildRefineryReceipt } from "./receipts.js";
// ISP-98 (AB#788): a lease's slots are its extractors and the other buildings on it, counted in one place.
import { leaseFacilities, leaseHasRoom } from "../public/scripts/leaseSlots.js";
import { ECONOMY } from "./economy.js";

const hasTech = (corp, id) => (corp.unlockedTech || []).includes(id);
const slotCount = (corp) => ({ slotsUsed: (corp.buildings || []).length, slotsTotal: corp.buildingSlots || 2 });

/**
 * Per building: `cost(building, corp)` when the price is not the catalogue's, `place(corp, building, lease)` for what it
 * adds (returning what the receipt names), and the notification and receipt a build sends.
 */
export const CONSTRUCTIONS = Object.freeze({
  "basic-extractor-yard": {
    // ISP-303 (AB#2286): each yard costs more than the last; the Supply Forecast discount comes after.
    cost: (building, corp) => nextYardPriceFor(corp, ECONOMY.buildings),
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
  },
  // ISP-96 (AB#786): it adds nothing when built; its effect is on returning expeditions (server/game/asteroids.js).
  "ferric-mining-complex": {
    place: () => ({}),
    notification: { title: "Ferric Mining Complex Online", body: "Returning mining probes now deposit more Nickel and Titanium." },
    receipt: (built, corp) => buildFerricMiningComplexReceipt({ cost: built.cost, assetValue: built.assetValue, multiplier: ECONOMY.buildings.ferricMiningComplexMetalMultiplier, ...slotCount(corp) })
  },
  // ISP-97 (AB#787): an upgrade. The n-th Refinery building and the n-th refinery record are pushed together by the
  // refinery's construction and nothing removes either, so the building upgraded is matched to its refinery by order.
  "refinery-complex": {
    upgradeTarget: (corp, index) => (Array.isArray(corp.refineries) ? corp.refineries[index] : null) || null,
    place(corp, building, refinery) {
      refinery.tier = 2; // what server/game/refining.js reads for the larger output
      return { refineryName: refinery.name || "Refinery" };
    },
    notification: { title: "Refinery Complex Online", body: "One of your Refineries is now a Refinery Complex: its runs deliver more of every output." },
    receipt: (built) => buildRefineryComplexReceipt({ cost: built.cost, assetValue: built.assetValue, refineryName: built.refineryName, multiplier: ECONOMY.buildings.refineryComplexOutputMultiplier })
  },
  // ISP-98 (AB#788): stands on a Luna lease beside its extractors; its effect is on their mining (miningEfficiency).
  "cryo-vapor-extractor-array": {
    place(corp, building, lease) {
      lease.facilities = [...leaseFacilities(lease), building.name];
      return { body: lease.body || "Luna" };
    },
    notification: { title: "Cryo-vapor Extractor Array Online", body: "The extractors on your Luna lease now mine more Silicates." },
    receipt: (built, corp) => buildCryoVaporArrayReceipt({ cost: built.cost, assetValue: built.assetValue, body: built.body, multiplier: ECONOMY.buildings.cryoVaporExtractorArrayMiningMultiplier, ...slotCount(corp) })
  }
});

/** The slots a building can take. An "upgrade" takes none: it changes a building the corporation has (ISP-97). */
const BUILDABLE_SLOTS = new Set(["corporation", "corporation+lease", "upgrade"]);

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
    if (building.lease && String(lease.body || "").toLowerCase() !== building.lease) return { outcome: "wrong-lease" }; // ISP-98
  } else if (leaseId) {
    return { outcome: "not-on-lease" };
  }

  const refused = catalogueRefusal(building, corp);
  if (refused) return { outcome: refused };
  if (building.slot === "upgrade") return upgrade(corp, building, construction);
  const perLease = building.cap?.perLease;
  if (lease && perLease !== undefined && leaseFacilities(lease).filter((n) => n === building.name).length >= perLease) return { outcome: "lease-at-cap" };
  if (lease && !leaseHasRoom(lease)) return { outcome: "lease-slots-full" };
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

/**
 * An upgrade (ISP-97): the first building of the kind it upgrades that does not carry it yet (`cap.perBuilding`, one
 * each), changed in place. No slot is taken. The building records the upgrade in `upgrades` and tier 2, which the
 * ladder's building: metric counts (server/game/progression.js); the construction changes the record that works.
 */
function upgrade(corp, building, construction) {
  const base = PLAYER_BUILDING_CATALOGUE.find((b) => b.id === building.upgrades && b.slot !== "upgrade");
  const perBuilding = building.cap?.perBuilding ?? 1;
  if (!base || typeof construction.upgradeTarget !== "function") return { outcome: "not-constructible" };
  const own = (corp.buildings || []).filter((b) => b?.name === base.name);
  if (!own.length) return { outcome: "nothing-to-upgrade" };
  const target = own.find((b) => (b.upgrades || []).filter((u) => u === building.name).length < perBuilding);
  if (!target) return { outcome: "at-cap" };
  const record = construction.upgradeTarget(corp, own.indexOf(target));
  if (!record) return { outcome: "not-constructible" }; // a building with nothing behind it is not upgraded blind
  const cost = construction.cost ? construction.cost(building, corp) : building.cost;
  if ((corp.finances?.credits || 0) < cost) return { outcome: "insufficient-credits" };

  target.upgrades = [...(target.upgrades || []), building.name];
  target.tier = Math.max(Number(target.tier) || 1, 2);
  const placed = construction.place(corp, building, record);
  applyCredits(corp, -cost, "construction");
  corp.finances.assets = (corp.finances.assets || 0) + building.assetValue;
  return { outcome: "ok", cost, assetValue: building.assetValue, ...placed };
}
