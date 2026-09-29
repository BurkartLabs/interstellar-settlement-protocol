// ISP (AB#4678; docs/design/rats.md, section 3): a hired mercenary fleet as an expedition's escort.
//
// The fleet stays on its owner's books, as a raid's does: the renter names the contract, the owner's fleet is committed
// (fleet.escort) until the expedition ends, it fights with what it has left (its units less the losses already recorded
// on its contract) and its owner's combat modifiers, and its losses are recorded on the contract through
// recordContractLosses, paid from the collateral when the contract settles. The launch route checks and commits it; the
// expedition tick takes the hooks at the bottom, since game/asteroids.js does not reach other accounts itself.
import { getAccountById, getState, mutateAccountState } from "./gameState.js";
import { accountIdOfCorp } from "./playerLoans.js";
import { mercenaryUseAllowed, recordContractLosses } from "./mercenaries.js";
import { FLEET_UNIT_IDS } from "./fleets.js";
import { combatModifiersFor } from "./game/combat.js";

const count = (v) => Math.max(0, Math.floor(Number(v) || 0));
const hiredOffer = (contractId) => (getState()?.market?.mercenaryOffers || []).find((o) => o.id === contractId && o.state === "hired") || null;
const ownerOf = (ownerCorpId) => {
  const id = ownerCorpId ? accountIdOfCorp(ownerCorpId) : null;
  const corp = id ? getAccountById(id)?.state?.corp ?? null : null;
  return corp ? { id, corp } : null;
};

/** What a hired fleet has left: its units less the losses already recorded on its contract, as a raid reads it. */
export function hiredUnits(fleet, offer) {
  return Object.fromEntries(FLEET_UNIT_IDS.map((id) => [id, count(fleet?.units?.[id]) - count(offer?.lost?.[id])]).filter(([, n]) => n > 0));
}

/**
 * The hired fleet a renter names as an escort, checked as section 3 says: a contract of the renter's whose allowed use
 * includes pve (a raids contract does too), its fleet stationed in the belt's system, not travelling or on a raid, not
 * escorting already, with units left. `systemOf(stationId)` is the station's system.
 * { escort: { contractId, ownerAccountId, ownerCorpId, fleetId, units } } or { outcome }, a key of the route's messages.
 */
export function hiredEscortFor(renter, contractId, beltSystemId, systemOf, now = Date.now()) {
  const hired = (renter?.military?.hired || []).find((h) => h.contractId === contractId);
  const offer = hiredOffer(contractId);
  if (!hired || !offer || offer.renterCorpId !== renter?.publicId) return { outcome: "no-such-contract" };
  if (!mercenaryUseAllowed(hired, "pve")) return { outcome: "escort-not-permitted" };
  const owner = ownerOf(offer.ownerCorpId);
  const fleet = owner?.corp?.military?.fleets?.find((f) => f.id === offer.fleetId);
  if (!fleet) return { outcome: "no-such-contract" };
  if (fleet.escort) return { outcome: "escort-busy" };
  if (fleet.transit && (fleet.transit.raidId || now < fleet.transit.arrivesAt)) return { outcome: "escort-travelling" };
  if (systemOf(fleet.stationId) !== beltSystemId) return { outcome: "escort-elsewhere" };
  const units = hiredUnits(fleet, offer);
  if (!Object.keys(units).length) return { outcome: "escort-empty" };
  return { escort: { contractId, ownerAccountId: owner.id, ownerCorpId: offer.ownerCorpId, fleetId: fleet.id, units } };
}

/** Commit the owner's fleet to the expedition, on its owner's books, until the expedition ends. */
export function commitHiredEscort(escort, expeditionId, now = Date.now()) {
  mutateAccountState(escort.ownerAccountId, (state) => {
    const f = (state.corp.military?.fleets || []).find((x) => x.id === escort.fleetId);
    if (f) f.escort = { expeditionId, since: now, contractId: escort.contractId };
  }, { sanitize: false, settleMining: false });
}

/** For the expedition tick (applyAsteroidExpeditions, settleRats): the hired escort of an expedition's `rats`. */
export const hiredEscortHooks = {
  /** The escort still committed to `exp`, as it fights: { fleetId, units, modifiers }, or null (gone, or its contract is). */
  escort(exp) {
    const r = exp.rats;
    const offer = hiredOffer(r?.escortContractId);
    const owner = offer ? ownerOf(offer.ownerCorpId) : null;
    const fleet = owner?.corp?.military?.fleets?.find((f) => f.id === r.escortFleetId && f.escort?.expeditionId === exp.id);
    if (!fleet) return null;
    return { fleetId: fleet.id, units: hiredUnits(fleet, offer), modifiers: combatModifiersFor(owner.corp) };
  },
  /** The escort's losses, recorded on its contract, as a raid's are. */
  lose(exp, lost) {
    recordContractLosses(exp.rats.escortContractId, lost);
  },
  /** The commitment ends with the expedition, whatever became of the contract meanwhile. */
  release(exp) {
    const r = exp.rats;
    const owner = ownerOf(r?.escortOwnerCorpId);
    if (!owner) return;
    mutateAccountState(owner.id, (state) => {
      const f = (state.corp.military?.fleets || []).find((x) => x.id === r.escortFleetId);
      if (f?.escort?.expeditionId === exp.id) delete f.escort;
    }, { sanitize: false, settleMining: false });
  }
};
