// server/buildingRepair.js: repairing a building a raid damaged (ISP-287, AB#994; docs/design/v0.10-raids-mercenaries.md,
// section 3). A repair restores full condition at once for the price raid resolution already quotes in the defender's
// report (repairCostFor, server/raidResolution.js): (100 - condition)% of the building's cost basis x 25%. It is paid
// through settleTransfer to the fee sink, and the building is restored in the same mutation as the debit, so there is no
// repair without the payment and no payment without the repair. Too few credits repairs nothing: there is no partial
// repair. The caller names a building id and nothing else; the building is looked up among the caller's own, and the
// price is the server's.
import { getAccountById } from "./gameState.js";
import { settleTransfer } from "./settlement.js";
import { conditionOf, isDamaged } from "./game/buildingCondition.js";
import { repairCostFor } from "./raidResolution.js";

const findBuilding = (corp, buildingId) => (corp?.buildings || []).find((b) => typeof b?.id === "string" && b.id === buildingId) || null;

/** The corporation's damaged buildings, each with its condition, the output it runs at and the repair price. */
export function damagedBuildings(corp) {
  const leaseBody = new Map((corp?.miningLeases || []).map((l) => [l.id, l.body]));
  return (corp?.buildings || []).filter(isDamaged).map((b) => ({
    id: b.id,
    name: b.name,
    where: b.leaseId && leaseBody.get(b.leaseId) ? `${leaseBody.get(b.leaseId)} lease` : "home station",
    condition: conditionOf(b),
    outputPct: Math.round(conditionOf(b)),
    repairCost: repairCostFor(b)
  }));
}

/**
 * Repair `buildingId` of the account's corporation, at `now`. { outcome: "ok", name, before, cost } after the payment and
 * the repair, or { outcome } with nothing changed: "unknown-building", "not-damaged", or "insufficient-credits" (with
 * the cost and the credits held).
 */
export function repairBuilding(accountId, buildingId, now = Date.now()) {
  const corp = getAccountById(accountId)?.state?.corp;
  const building = findBuilding(corp, buildingId);
  if (!building) return { outcome: "unknown-building" };
  if (!isDamaged(building)) return { outcome: "not-damaged", name: building.name };
  const before = conditionOf(building);
  const cost = repairCostFor(building);
  const restore = (state) => { const b = findBuilding(state.corp, buildingId); if (b) b.condition = 100; };
  if (cost <= 0) { // a building with no cost basis to price: nothing to pay, so nothing moves through the ledger
    restore({ corp });
    return { outcome: "ok", name: building.name, before, cost: 0 };
  }
  const credits = Math.round(Number(corp.finances?.credits) || 0);
  if (credits < cost) return { outcome: "insufficient-credits", name: building.name, cost, credits };
  const paid = settleTransfer({
    fromAccountId: accountId, toAccountId: "sink:fee", credits: cost, reason: "repair",
    idempotencyKey: `repair:${accountId}:${buildingId}:${now}`, withPayer: restore
  }, now);
  if (!paid.ok) return { outcome: "insufficient-credits", name: building.name, cost, credits };
  return { outcome: "ok", name: building.name, before, cost };
}

/** Why a repair was refused, in words. */
export function repairRefusal(result, formatCredits) {
  if (result.outcome === "not-damaged") return `The ${result.name} is not damaged.`;
  if (result.outcome === "insufficient-credits") return `Repairing the ${result.name} costs ${formatCredits(result.cost)}; you have ${formatCredits(result.credits)}. Nothing was repaired. Sell goods to raise the credits, then repair it.`;
  return "Choose one of your own damaged buildings to repair.";
}
