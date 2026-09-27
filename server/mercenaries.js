// server/mercenaries.js: mercenary contracts (ISP-176, AB#870). A corporation offers one of its fleets for hire on
// structured terms; another hires it for the term; at the end the fleet is back under its owner's command, the price is
// the owner's, and the collateral pays for any units lost.
//
// The raid and mercenary design (ISP-165, AB#859) is not written yet, so the shape here is this story's own, drawn from
// the combat design (docs/design/v0.10-combat.md) and the acceptance, and every assumption is listed in the PR:
//   - Terms are numbers and enums only: a term of 12, 24, 72 or 168 hours; a price; a collateral of at least 1 credit and no larger than the
//     fleet's replacement value; an allowed use of defense, pve or raids. No free text anywhere.
//   - Offering escrows the fleet: it stays in the owner's corp.military (its units, its upkeep) but is marked as under
//     contract, and takes no order from its owner (split, merge, deploy, disband) until the contract ends. An open offer
//     lapses after 7 days and the fleet is free again.
//   - Hiring escrows the price and the collateral together through settleTransfer (escrow-hold). The renter commands
//     the fleet for the term through a record in its own corp.military.hired; it has no route that disbands, sells,
//     splits or offers it, because every fleet order acts only on a corporation's own fleets.
//   - At the end: units the contract records as lost leave the owner's fleet; the owner is paid the price and, from the
//     collateral, each lost unit's replacement value (catalog credits plus goods at their NPC bid), capped at the
//     collateral; the rest of the collateral goes back to the renter. All three through settleTransfer (escrow-release).
//   - The owner pays the fleet's upkeep throughout: the units never leave its books.
// No account id is stored in an offer or a contract: both sides are named by corporation publicId, resolved on the
// server when credits move (as player loans do, server/playerLoans.js).

import { ECONOMY } from "./economy.js";
import { getAccountById, getState, mutateAccountState, mutateState } from "./gameState.js";
import { settleTransfer } from "./settlement.js";
import { accountIdOfCorp } from "./playerLoans.js";
import { UNITS, ensureCorpMilitary, militaryPower } from "./game/units.js";
import { FLEET_UNIT_IDS, settleFleets } from "./fleets.js";

const HOUR = 3_600_000;
export const CONTRACT_RULES = Object.freeze({
  termsHours: [12, 24, 72, 168],
  uses: ["defense", "pve", "raids"],
  minPrice: 100,
  maxPrice: 10_000_000,
  offerOpenDays: 7
});
/** What each use permits: a contract for raids may also defend and hunt; one for PvE may also defend. */
const PERMITS = { defense: ["defense"], pve: ["defense", "pve"], raids: ["defense", "pve", "raids"] };

const escrowOf = (id) => `escrow:merc-${id}`;
const price = (item) => (ECONOMY.npcBuyers || []).find((b) => b.item === item)?.unitPrice || 0;
/** A unit's replacement value: its catalog credits, and its goods at their NPC bid (the combat design's "value"). */
export const unitValue = (id) => UNITS[id].credits + Object.entries(UNITS[id].goods).reduce((s, [item, qty]) => s + price(item) * qty, 0);
/** A group of units' replacement value. */
export const unitsValue = (units) => FLEET_UNIT_IDS.reduce((s, id) => s + (Number(units?.[id]) || 0) * unitValue(id), 0);

/** Whether a hired fleet may be used for `purpose` (defense, pve or raids) under its contract's allowed use. */
export function mercenaryUseAllowed(contract, purpose) {
  return (PERMITS[contract?.allowedUse] || []).includes(purpose);
}

function offersDraft(draft) {
  if (!draft.market || typeof draft.market !== "object") draft.market = {};
  if (!Array.isArray(draft.market.mercenaryOffers)) draft.market.mercenaryOffers = [];
  return draft.market.mercenaryOffers;
}
const allOffers = () => (Array.isArray(getState()?.market?.mercenaryOffers) ? getState().market.mercenaryOffers : []);
const setOffer = (id, patch) => mutateState((draft) => { const o = offersDraft(draft).find((x) => x.id === id); if (o) Object.assign(o, patch); });
const corpOf = (accountId) => getAccountById(accountId)?.state?.corp ?? null;
let seq = 0;

/** The public face of an offer: terms, the fleet's units and value, and whose it is, by corporation name only. */
export function offerView(offer, viewerCorpId = null) {
  const owner = accountIdOfCorp(offer.ownerCorpId);
  return {
    id: offer.id, state: offer.state, fleetName: offer.fleetName, units: offer.units, stationId: offer.stationId,
    termHours: offer.termHours, price: offer.price, collateral: offer.collateral, allowedUse: offer.allowedUse,
    value: unitsValue(offer.units), ownerName: owner ? corpOf(owner)?.corporationName || "A corporation" : "A corporation",
    // ISP-177 (AB#871): what the fleet fights with, beside its price, so a hire can be weighed against building one
    ...militaryPower(offer.units),
    mine: Boolean(viewerCorpId) && offer.ownerCorpId === viewerCorpId,
    // AB#859 section 7: a hired fleet fights at its owner's readiness, so the renter sees it before hiring
    readiness: owner ? Number(corpOf(owner)?.military?.readiness ?? 100) : null,
    postedAt: offer.postedAt, expiresAt: offer.expiresAt, endsAt: offer.endsAt ?? null
  };
}

/**
 * ISP-177 (AB#871): the caller's contracts, both sides: what it offered or hired out, and what it hired. A contract
 * under way shows its term's end and what the escrow holds; a finished one its settlement (losses, what the collateral
 * paid, what came back). The other side is named by corporation name only.
 */
export function myContracts(accountId, now = Date.now()) {
  expireOffers(now);
  const me = corpOf(accountId)?.publicId;
  if (!me) return null;
  const view = (o) => {
    const renter = o.renterCorpId ? accountIdOfCorp(o.renterCorpId) : null;
    return {
      ...offerView(o, me),
      renterName: renter ? corpOf(renter)?.corporationName || "A corporation" : null,
      escrow: o.state === "hired" ? o.price + o.collateral : 0,
      lost: o.lost && Object.values(o.lost).some((n) => n > 0) ? { ...o.lost } : null,
      settlement: o.settlement || null, closedAt: o.closedAt ?? null
    };
  };
  const recent = (o) => ["open", "hired", "taking"].includes(o.state) || (o.closedAt && now - o.closedAt < 7 * 24 * HOUR);
  const byNewest = (a, b) => (b.hiredAt || b.postedAt) - (a.hiredAt || a.postedAt);
  return {
    offered: allOffers().filter((o) => o.ownerCorpId === me && recent(o) && o.state !== "withdrawn").sort(byNewest).map(view),
    hired: allOffers().filter((o) => o.renterCorpId === me && recent(o)).sort(byNewest).map(view),
    // each of the caller's own fleets' replacement value, the most a collateral may be, for the offer form
    fleetValues: Object.fromEntries((corpOf(accountId)?.military?.fleets || []).map((f) => [f.id, unitsValue(f.units)]))
  };
}

/** Check an offer's terms: every field a number or an enum, in range. Returns { terms } or { error }. */
export function checkTerms({ termHours, price: p, collateral, allowedUse } = {}, fleetValue) {
  if (!CONTRACT_RULES.termsHours.includes(termHours)) return { error: `Choose a term of ${CONTRACT_RULES.termsHours.join(", ")} hours.` };
  if (!Number.isInteger(p) || p < CONTRACT_RULES.minPrice || p > CONTRACT_RULES.maxPrice) return { error: `Choose a price from ${CONTRACT_RULES.minPrice} to ${CONTRACT_RULES.maxPrice.toLocaleString("en-US")} credits.` };
  if (!Number.isInteger(collateral) || collateral < 1 || collateral > fleetValue) return { error: `Choose a collateral from 1 to the fleet's value, ${fleetValue.toLocaleString("en-US")} credits.` };
  if (!CONTRACT_RULES.uses.includes(allowedUse)) return { error: "Choose an allowed use: defense, pve or raids." };
  return { terms: { termHours, price: p, collateral, allowedUse } };
}

/** Offer one of the caller's own fleets for hire. The fleet is under contract from now until the offer closes. */
export function offerFleet(accountId, fleetId, input, now = Date.now()) {
  const corp = corpOf(accountId);
  if (!corp?.publicId) return { ok: false, status: 404, error: "Account not found." };
  let result = null;
  mutateAccountState(accountId, (state) => {
    const c = state.corp;
    ensureCorpMilitary(c);
    settleFleets(c, now);
    const fleet = (c.military.fleets || []).find((f) => f.id === fleetId);
    if (!fleet) { result = { ok: false, status: 404, error: "That fleet is not one of yours." }; return; }
    if (fleet.transit && now < fleet.transit.arrivesAt) { result = { ok: false, status: 409, error: "That fleet is in transit. Offer it once it has arrived." }; return; }
    if (fleet.contract) { result = { ok: false, status: 409, error: "That fleet is already under contract." }; return; }
    const checked = checkTerms(input, unitsValue(fleet.units));
    if (checked.error) { result = { ok: false, status: 400, error: checked.error }; return; }
    const id = `mo-${now.toString(36)}-${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    fleet.contract = { offerId: id, state: "offered" };
    result = { ok: true, offer: { id, ownerCorpId: c.publicId, fleetId, fleetName: fleet.name, units: { ...fleet.units }, stationId: fleet.stationId,
      ...checked.terms, state: "open", postedAt: now, expiresAt: now + CONTRACT_RULES.offerOpenDays * 24 * HOUR } };
  }, { sanitize: false });
  if (result?.ok) mutateState((draft) => { offersDraft(draft).push(result.offer); });
  return result?.ok ? { ok: true, offer: offerView(result.offer) } : result;
}

function freeFleet(ownerCorpId, fleetId, patch = (fleet) => { delete fleet.contract; }) {
  const owner = accountIdOfCorp(ownerCorpId);
  if (owner) mutateAccountState(owner, (state) => { const f = (state.corp.military?.fleets || []).find((x) => x.id === fleetId); if (f) patch(f, state.corp); }, { sanitize: false });
}

/** Withdraw one's own open offer: the fleet is free again. Nothing else moved, so nothing moves back. */
export function withdrawOffer(accountId, offerId, now = Date.now()) {
  const offer = allOffers().find((o) => o.id === offerId);
  if (!offer || offer.ownerCorpId !== corpOf(accountId)?.publicId) return { ok: false, status: 404, error: "No such offer of yours." };
  if (offer.state !== "open") return { ok: false, status: 409, error: "That offer is no longer open." };
  setOffer(offer.id, { state: "withdrawn", closedAt: now });
  freeFleet(offer.ownerCorpId, offer.fleetId);
  return { ok: true, offer: offerView({ ...offer, state: "withdrawn" }) };
}

/** Close every open offer whose window has passed: the fleet is free again. */
export function expireOffers(now = Date.now()) {
  for (const offer of allOffers().filter((o) => o.state === "open" && o.expiresAt <= now)) {
    setOffer(offer.id, { state: "expired", closedAt: now });
    freeFleet(offer.ownerCorpId, offer.fleetId);
  }
}

/** The open offers, newest first. */
export function listOffers(now = Date.now(), viewerAccountId = null) {
  expireOffers(now);
  const me = viewerAccountId ? corpOf(viewerAccountId)?.publicId ?? null : null;
  return allOffers().filter((o) => o.state === "open").sort((a, b) => b.postedAt - a.postedAt).map((o) => offerView(o, me));
}

/**
 * Hire an open offer. Refused, with nothing moved, when the offer is not open or has lapsed, when the caller owns it,
 * or when the caller cannot cover price plus collateral. Otherwise both are held in the contract's escrow and the fleet
 * is under the renter's command until the term ends.
 */
export function hireOffer(accountId, offerId, now = Date.now()) {
  expireOffers(now);
  const offer = allOffers().find((o) => o.id === offerId);
  const renter = corpOf(accountId);
  if (!offer || !renter?.publicId) return { ok: false, status: 404, error: "No such offer." };
  if (offer.state !== "open") return { ok: false, status: 409, error: "That offer is no longer open." };
  if (offer.ownerCorpId === renter.publicId || accountIdOfCorp(offer.ownerCorpId) === accountId) return { ok: false, status: 400, error: "You cannot hire your own fleet." };
  const total = offer.price + offer.collateral;
  if (Math.floor(Number(renter.finances?.credits) || 0) < total) return { ok: false, status: 409, error: `Hiring holds ${total.toLocaleString("en-US")} credits (price and collateral) until the term ends, and you have ${Math.floor(Number(renter.finances?.credits) || 0).toLocaleString("en-US")}.` };

  setOffer(offer.id, { state: "taking" }); // taken now: a second hire is refused from here on
  const held = settleTransfer({ fromAccountId: accountId, toAccountId: escrowOf(offer.id), credits: total, reason: "escrow-hold", idempotencyKey: `merc:${offer.id}:hold` }, now);
  if (!held.ok) { setOffer(offer.id, { state: "open" }); return { ok: false, status: 409, error: `Price and collateral could not be held: ${held.error}` }; }
  const endsAt = now + offer.termHours * HOUR;
  setOffer(offer.id, { state: "hired", renterCorpId: renter.publicId, hiredAt: now, endsAt, lost: {} });
  freeFleet(offer.ownerCorpId, offer.fleetId, (fleet) => { fleet.contract = { offerId: offer.id, state: "hired", endsAt }; });
  mutateAccountState(accountId, (state) => {
    ensureCorpMilitary(state.corp);
    if (!Array.isArray(state.corp.military.hired)) state.corp.military.hired = [];
    state.corp.military.hired.push({ contractId: offer.id, fleetName: offer.fleetName, units: { ...offer.units }, stationId: offer.stationId, allowedUse: offer.allowedUse, endsAt });
  }, { sanitize: false });
  return { ok: true, offer: offerView({ ...offer, state: "hired", endsAt }) };
}

/** Record units a hired fleet lost (the raids stories call this; a test injects losses through it). */
export function recordContractLosses(offerId, lost) {
  mutateState((draft) => {
    const o = offersDraft(draft).find((x) => x.id === offerId);
    if (!o || o.state !== "hired") return;
    for (const id of FLEET_UNIT_IDS) {
      const n = Math.max(0, Math.floor(Number(lost?.[id]) || 0));
      o.lost[id] = Math.min((o.lost[id] || 0) + n, Number(o.units[id]) || 0);
    }
  });
}

/**
 * End every contract whose term is over: lost units leave the owner's fleet, the price goes to the owner, the
 * collateral pays for the losses and the rest goes back to the renter, and both sides' records close. Each transfer
 * has its own idempotency key, so a settlement interrupted halfway finishes on the next tick without paying twice.
 */
export function settleContracts(now = Date.now()) {
  for (const offer of allOffers().filter((o) => o.state === "hired" && o.endsAt <= now)) {
    const ownerId = accountIdOfCorp(offer.ownerCorpId), renterId = accountIdOfCorp(offer.renterCorpId);
    const lostValue = unitsValue(offer.lost);
    const compensation = Math.min(offer.collateral, lostValue);
    const refund = offer.collateral - compensation;
    const pay = (to, credits, part) => (credits > 0 && to
      ? settleTransfer({ fromAccountId: escrowOf(offer.id), toAccountId: to, credits, reason: "escrow-release", idempotencyKey: `merc:${offer.id}:${part}` }, now)
      : { ok: true });
    const paid = [pay(ownerId, offer.price, "price"), pay(ownerId, compensation, "losses"), pay(renterId, refund, "collateral")];
    if (paid.some((r) => !r.ok)) continue; // tried again on the next tick; what was paid is not paid twice
    if (ownerId) mutateAccountState(ownerId, (state) => {
      const c = state.corp;
      ensureCorpMilitary(c);
      const fleet = (c.military.fleets || []).find((f) => f.id === offer.fleetId);
      for (const id of FLEET_UNIT_IDS) {
        const n = Number(offer.lost?.[id]) || 0;
        if (!n) continue;
        if (fleet) fleet.units[id] = Math.max(0, (Number(fleet.units[id]) || 0) - n);
        c.military.units[id] = Math.max(0, (Number(c.military.units[id]) || 0) - n);
      }
      if (fleet) delete fleet.contract;
      if (fleet && FLEET_UNIT_IDS.every((id) => !(Number(fleet.units[id]) > 0))) c.military.fleets = c.military.fleets.filter((f) => f !== fleet);
      ensureCorpMilitary(c);
    }, { sanitize: false });
    if (renterId) mutateAccountState(renterId, (state) => {
      state.corp.military.hired = (state.corp.military?.hired || []).filter((h) => h.contractId !== offer.id);
    }, { sanitize: false });
    setOffer(offer.id, { state: "completed", closedAt: now, settlement: { price: offer.price, compensation, refund } });
  }
}
