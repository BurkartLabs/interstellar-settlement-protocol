// server/arbitration.js: filing cases at the Galactic Arbitration Council (ISP-241, AB#937; docs/design/WARFARE.md,
// "The Galactic Arbitration Council"). A case has no words in it: the claimant names a claim type and a record it is a
// party to, the respondent is the record's other party (derived, never typed), and the evidence is what the claim
// type's query reads from server records at that moment. The rule (server/game/arbitration.js) gives the amount
// claimed, which sets the Council fee; the fee is held in the case's own escrow until the ruling (ISP-242).
//
// Refused, with nothing written and nothing charged: an unknown or closed claim type, a record the claimant is not the
// filing party to, a respondent on the claimant's own side, a second case on the same record, a fourth open case
// against one respondent, a fee it cannot pay, and evidence that cannot be read (fails closed). credit-default is never
// filed by a player: the ISA dockets each default recovery itself (docketDefault, from server/defaultRecovery.js).
//
// Kept in arbitration.json in the data directory. Parties are { type, id, name }: corporation publicIds, conglomerate
// ids, or the ISA; never an account id. The docket is public (reference, claim type, the parties' names, state and the
// ruling); the evidence is shown only to the two parties.

import fs from "node:fs";
import path from "node:path";
import { createId, dataDir, safeWriteFile } from "./game/catalog.js";
import { addAccountNotification } from "./gameState.js";
import { accountsStore } from "./game/store.js";
import { settleTransfer } from "./settlement.js";
import { WARFARE_CATALOG, concessionTermsFor } from "./warfare.js";
import { accountByCorp, findConglomerate, roleOf } from "./game/membership.js";
import { currentConglomerateOf } from "./game/intel.js";
import { contractRecord, freezeContractEscrow, myContracts } from "./mercenaries.js";
import { concessionRegister, petitionRecord, petitionsIn } from "./concessions.js";
import { controlNow } from "./controlService.js";
import { tariffCap, tariffRates } from "./tariffService.js";
import { patentOffice, patentRecord, patentUsers, patentUsesBy } from "./patents.js";
import { councilFee, rateInForceAt, readinessRefund, royaltyShortfall, tariffExcess } from "./game/arbitration.js";

const FILE = path.join(dataDir, "arbitration.json");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OPEN = new Set(["filed", "answering", "ruled", "enforcing"]);
export const ISA_PARTY = Object.freeze({ type: "isa", id: "isa", name: "Interstellar Settlement Authority" });
const LABELS = { "mercenary-readiness": "mercenary readiness", "tariff-overcharge": "tariff overcharge", "concession-arbitrated": "arbitrated concession", "patent-royalty": "patent royalty", "credit-default": "credit default" };
let store = readStore();

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return parsed && Array.isArray(parsed.cases) ? parsed : { cases: [], seq: 0 };
  } catch {
    return { cases: [], seq: 0 };
  }
}
const save = () => safeWriteFile(FILE, JSON.stringify(store));
const terms = () => WARFARE_CATALOG.arbitration;
const no = (status, code, error) => ({ refused: { status, code, error } });
const keyOf = (p) => `${p.type}:${p.id}`;
const corpParty = (corp) => ({ type: "corp", id: corp.publicId, name: corp.corporationName || "A corporation" });
const corpById = (publicId) => accountByCorp(publicId)?.state?.corp || null;
const holderParty = (h) => {
  if (h.type === "conglomerate") { const c = findConglomerate(h.id); return c ? { type: "conglomerate", id: c.id, name: c.name } : null; }
  const corp = corpById(h.id);
  return corp ? corpParty(corp) : null;
};
/** Whether `party` is `corp` itself or on its side: its conglomerate, or a corporation in the same conglomerate. */
function sameSide(corp, party) {
  const mine = currentConglomerateOf(corp)?.id || null;
  if (party.type === "corp") return party.id === corp.publicId || (Boolean(mine) && currentConglomerateOf(corpById(party.id) || {})?.id === mine);
  return party.type === "conglomerate" && party.id === mine;
}
/** The account that answers for a party: a corporation's own, a conglomerate's founder's. */
function accountOf(party) {
  if (party.type === "corp") return accountByCorp(party.id);
  if (party.type === "conglomerate") return accountByCorp(findConglomerate(party.id)?.founder);
  return null;
}
/** The caller's own filing identity for a concession record: its conglomerate (as founder) or itself. */
function concessionSelf(corp) {
  const c = currentConglomerateOf(corp);
  if (c && roleOf(c, corp.publicId) === "founder") return { type: "conglomerate", id: c.id };
  return c ? null : { type: "corp", id: corp.publicId };
}
const hasCase = (type, recordRef) => store.cases.some((c) => c.type === type && c.recordRef === recordRef);
const isArbitrated = (systemId) => /^Arbitrated/.test(concessionTermsFor(systemId)?.rule || "");

// ─── The evidence each claim type reads ─────────────────────────────────────
// Each returns { recordRef, respondent, amount, evidence, fee?, escrow? } or { refused }. It may throw: fileCase fails closed.

const EVIDENCE = {
  "mercenary-readiness"(corp, recordId, now) {
    const c = contractRecord(recordId);
    if (!c) return no(404, "no-record", "No such mercenary contract.");
    if (c.renterCorpId !== corp.publicId) return no(403, "not-a-party", "Only the renter can file on a contract's readiness.");
    if (!(c.state === "hired" || (c.state === "completed" && now - c.closedAt <= 7 * DAY))) return no(409, "out-of-time", "A readiness case is filed while the contract runs, or within 7 days of its end.");
    if (!Number.isFinite(c.hireReadiness)) return no(409, "no-evidence", "This contract was hired before the Council kept the readiness shown at hire, so there is no evidence to read.");
    const owner = corpById(c.ownerCorpId);
    if (!owner) return no(404, "no-respondent", "The fleet's owner no longer exists.");
    const r = readinessRefund({ price: c.price, termHours: c.termHours, hireReadiness: c.hireReadiness, hiredAt: c.hiredAt }, owner.military?.readinessLog || [], Math.min(now, c.endsAt));
    return {
      recordRef: `contract:${c.id}`, respondent: corpParty(owner), amount: r.refund,
      evidence: { contract: { id: c.id, fleetName: c.fleetName, termHours: c.termHours, price: c.price, collateral: c.collateral, allowedUse: c.allowedUse, hiredAt: c.hiredAt, endsAt: c.endsAt, state: c.state }, hireReadiness: c.hireReadiness, hourlyReadiness: r.hours, hoursBelow: r.hoursBelow, refund: r.refund },
      escrow: c.state === "hired" ? c.id : null
    };
  },

  "tariff-overcharge"(corp, recordId, now) {
    const row = (corp.tradeHistory || []).find((r) => r.id === recordId && r.tariffAmount > 0);
    const shipment = row ? null : (corp.shipments || []).find((s) => s.id === recordId && s.tariff?.amount > 0);
    if (!row && !shipment) return no(404, "no-record", "None of your sales or transfers that paid a tariff has that id.");
    const rec = row ? row.tariffRecord : shipment.tariff;
    const at = rec?.at ?? row?.at ?? shipment?.dispatchedAt;
    if (!(now - at <= 30 * DAY)) return no(409, "out-of-time", "A tariff case is filed within 30 days of the sale or transfer.");
    if (!rec?.systemId || !Array.isArray(rec.to) || !rec.to.length) return no(409, "no-evidence", "This was settled before the Council kept tariff settlement records, so there is no evidence to read.");
    const register = concessionRegister(rec.systemId);
    const rates = tariffRates(rec.systemId);
    const held = rec.to.map((h) => {
      const events = register.filter((e) => e.holder?.type === h.type && e.holder?.id === h.id && e.at <= at);
      const last = events.at(-1)?.event || null;
      const record = rates.find((r) => r.holder.type === h.type && r.holder.id === h.id);
      return { holder: { type: h.type, id: h.id }, share: h.share, stateAt: last, granted: last ? ["granted", "renewed", "upkeep-paid"].includes(last) : null, record };
    });
    if (held.some((h) => !h.record || h.record.grantedAt > at)) return no(409, "no-evidence", "A holder's filed rate at that moment is no longer on record, so the Council cannot read the lawful rate.");
    const holderRates = held.map((h) => rateInForceAt(h.record, at));
    // a register that no longer reaches back to that moment is read as the settlement found it: in force
    const granted = held.every((h) => h.granted !== false);
    const capPct = tariffCap(rec.systemId);
    const x = tariffExcess({ chargedPct: rec.pct, postedPct: rec.postedPct, base: rec.base, granted, holderRates, capPct });
    const respondent = holderParty(rec.to[0]);
    if (!respondent) return no(404, "no-respondent", "The holder that received this tariff no longer exists.");
    return {
      recordRef: `${row ? "sale" : "transfer"}:${recordId}`, respondent, amount: x.excess,
      evidence: {
        settlement: { kind: row ? "sale" : "transfer", recordId, at, stationId: rec.stationId, systemId: rec.systemId, chargedPct: rec.pct, postedPct: rec.postedPct, base: rec.base, amount: rec.amount, levy: rec.levy, to: rec.to },
        holders: held.map((h, i) => ({ holder: h.holder, share: h.share, stateAt: h.stateAt, ratePct: holderRates[i] })),
        capPct, lawfulPct: x.lawfulPct, excess: x.excess
      }
    };
  },

  "concession-arbitrated"(corp, recordId, now) {
    const r = petitionRecord(recordId);
    if (!r) return no(404, "no-record", "No such petition or challenge.");
    if (!isArbitrated(r.systemId)) return no(409, "not-arbitrated", "Only a petition or challenge in an arbitrated system (Wolf 359, Epsilon Indi) is heard by the Council.");
    if (r.petition.state !== "open") return no(409, "decided", "That petition has already been decided.");
    const self = concessionSelf(corp);
    if (!self || keyOf(self) !== keyOf(r.petition.holder)) return no(403, "not-a-party", "Only the petitioner or challenger (for a conglomerate, its founder) files on a petition.");
    const other = r.petition.kind === "challenge"
      ? r.petition.target
      : r.petitions.filter((p) => p.kind === "petition" && keyOf(p.holder) !== keyOf(r.petition.holder)).sort((a, b) => a.filedAt - b.filedAt)[0]?.holder;
    if (!other) return no(409, "no-other-party", "Nobody contests this petition: its review decides it, and there is no one to file against.");
    const respondent = holderParty(other);
    if (!respondent) return no(404, "no-respondent", "The other party no longer exists.");
    const ctl = controlNow(r.systemId, now);
    const read = (h) => {
      const k = keyOf(h);
      const s = ctl.scores.find((x) => keyOf(x) === k) || null;
      const streak = ctl.streaks instanceof Map ? ctl.streaks.get(k) : ctl.streaks?.[k];
      return { holder: { type: h.type, id: h.id }, score: s?.score ?? 0, extraction: s?.extraction ?? 0, eligible: ctl.eligible.has(k), streakDays: Number(streak) || 0 };
    };
    return {
      recordRef: `petition:${r.petition.id}`, respondent, amount: 0, fee: ctl.terms.concessionPetitionFee,
      evidence: { systemId: r.systemId, rule: ctl.terms.rule, petition: { id: r.petition.id, kind: r.petition.kind, filedAt: r.petition.filedAt, reviewEndsAt: r.petition.reviewEndsAt }, stale: ctl.stale, claimant: read(r.petition.holder), respondent: read(other) }
    };
  },

  "patent-royalty"(corp, recordId) {
    const [patentId, userId] = String(recordId).split("~");
    const patent = patentId ? patentRecord(patentId) : null;
    if (!patent) return no(404, "no-record", "No such patent.");
    if (patent.holder.publicId !== corp.publicId) return no(403, "not-a-party", "Only the patent's holder files for its royalty.");
    const uses = patentUsesBy(patentId, userId);
    if (!uses.length) return no(404, "no-record", "That corporation has no recorded use of this patent.");
    const user = corpById(userId);
    if (!user) return no(404, "no-respondent", "That corporation no longer exists.");
    const s = royaltyShortfall(uses, patent.ratePct);
    return {
      recordRef: `patent-use:${patentId}:${userId}`, respondent: corpParty(user), amount: s.shortfall,
      evidence: {
        patent: { id: patent.id, kind: patent.kind, subjectId: patent.subjectId, subjectName: patent.subjectName, ratePct: patent.ratePct, filedAt: patent.filedAt, endsAt: patent.endsAt },
        uses: uses.map((u) => ({ at: u.at, base: u.base, ratePct: u.ratePct, royalty: u.royalty, paid: u.paid })),
        due: s.due, recorded: s.recorded, paid: s.paid, shortfall: s.shortfall, debtOwed: Math.floor(Number(user.patentDebts?.[patentId]) || 0)
      }
    };
  }
};

// ─── Filing ─────────────────────────────────────────────────────────────────

/** The claim type's catalog row, or null for an unknown id. */
const claimType = (type) => (terms().claimTypes || []).find((t) => t.id === type) || null;

function nextRef(now) {
  store.seq = (store.seq || 0) + 1;
  return `GAC-${new Date(now).getUTCFullYear()}-${String(store.seq).padStart(6, "0")}`;
}

function notifyRespondent(c) {
  const account = accountOf(c.respondent);
  if (!account) return;
  const amount = c.amountClaimed > 0 ? ` The amount claimed is ${c.amountClaimed.toLocaleString("en-US")} credits.` : "";
  addAccountNotification(account.id, {
    type: "finance",
    title: "Galactic Arbitration Council: case filed",
    body: `${c.ref}. ${c.claimant.name} has filed a ${LABELS[c.type]} case against ${c.respondent.name} with the Galactic Arbitration Council.${amount} The evidence is the ISA's own record. The response window closes ${new Date(c.windowEndsAt).toISOString().slice(0, 16).replace("T", " ")} UTC; the Council then applies its published rule.`
  });
}

/**
 * File a case for the caller's corporation: `type` (a catalog claim type) on `recordId` (a record it is the filing party
 * to). Returns { case } (the parties' view, with the evidence) or { refused }. Nothing is written or charged on a refusal.
 */
export function fileCase(accountId, { type, recordId } = {}, now = Date.now()) {
  const corp = accountsStore.accounts?.[accountId]?.state?.corp;
  if (!corp?.publicId) return no(404, "no-account", "Account not found.");
  const t = claimType(type);
  if (!t) return no(400, "unknown-type", "That is not a claim type the Council hears.");
  if (type === "credit-default") return no(403, "isa-only", "Credit defaults are docketed by the ISA itself when recovery starts; no corporation files one.");
  if (!t.open || !EVIDENCE[type]) return no(409, "not-open", `The Council does not hear ${LABELS[type] || type} cases yet: the records it would rule on do not exist.`);
  let ev;
  try {
    ev = EVIDENCE[type](corp, String(recordId ?? ""), now);
  } catch (error) {
    console.error(`[arbitration] the evidence for a ${type} case could not be read: ${error?.message || error}`);
    return no(503, "evidence-unavailable", "The Council could not read the evidence, so nothing was filed and no fee was taken.");
  }
  if (ev.refused) return ev;
  if (sameSide(corp, ev.respondent)) return no(409, "own-side", "You cannot file against yourself or your own conglomerate: the record has no other party.");
  if (hasCase(type, ev.recordRef)) return no(409, "duplicate", "A case of this kind has already been filed on that record: one case per record.");
  const claimant = corpParty(corp);
  const openAgainst = store.cases.filter((c) => OPEN.has(c.state) && keyOf(c.claimant) === keyOf(claimant) && keyOf(c.respondent) === keyOf(ev.respondent)).length;
  if (openAgainst >= terms().maxOpenCasesPerPair) return no(409, "too-many", `You already have ${openAgainst} open cases against ${ev.respondent.name}, the most the Council hears at once.`);
  const fee = ev.fee ?? councilFee(ev.amount, terms());
  const id = createId("gac");
  const held = settleTransfer({ fromAccountId: accountId, toAccountId: `escrow:${id}`, credits: fee, reason: "escrow-hold", idempotencyKey: `${id}:fee` }, now);
  if (!held.ok) return no(402, "cannot-pay", `Filing costs ${fee.toLocaleString("en-US")} credits, held until the ruling.`);
  const c = {
    id, ref: nextRef(now), type, recordRef: ev.recordRef, claimant, respondent: ev.respondent,
    filedAt: now, windowEndsAt: now + terms().responseHours * HOUR, amountClaimed: ev.amount, evidence: ev.evidence,
    state: "answering", ruling: null, paid: 0, feePaid: fee, feeEscrow: `escrow:${id}`, ...(ev.escrow ? { frozenContract: ev.escrow } : {})
  };
  store.cases.push(c);
  save();
  if (ev.escrow) freezeContractEscrow(ev.escrow, c.ref);
  notifyRespondent(c);
  return { case: partyView(c) };
}

/**
 * The ISA dockets a default recovery (WARFARE.md: `credit-default`, filed by nobody): upheld at once, the ruling the
 * recovery's result. `record`: { kind: "loan" | "bond", id, debtorAccountId, owedBefore, collected, shortfall }. Once per
 * record; returns the case, or null when it was docketed already or the debtor is unknown.
 */
export function docketDefault(record, now = Date.now()) {
  const debtor = accountsStore.accounts?.[record?.debtorAccountId]?.state?.corp;
  const recordRef = `${record?.kind}:${record?.id}`;
  if (!debtor?.publicId || hasCase("credit-default", recordRef)) return null;
  const c = {
    id: createId("gac"), ref: nextRef(now), type: "credit-default", recordRef, claimant: { ...ISA_PARTY }, respondent: corpParty(debtor),
    filedAt: now, windowEndsAt: now, amountClaimed: Math.max(0, Math.round(Number(record.shortfall) || 0)),
    evidence: { record: { kind: record.kind, id: record.id }, owedBefore: record.owedBefore, collected: record.collected, shortfall: record.shortfall },
    state: "ruled", ruling: { outcome: "upheld", amount: Math.max(0, Math.round(Number(record.shortfall) || 0)), order: null }, paid: 0, feePaid: 0
  };
  store.cases.push(c);
  save();
  notifyRespondent({ ...c, windowEndsAt: now });
  return partyView(c);
}

// ─── Reading ────────────────────────────────────────────────────────────────

const publicView = (c) => ({ ref: c.ref, type: c.type, claimant: c.claimant.name, respondent: c.respondent.name, state: c.state, ruling: c.ruling ? { outcome: c.ruling.outcome, amount: c.ruling.amount } : null, amountClaimed: c.amountClaimed, filedAt: c.filedAt, windowEndsAt: c.windowEndsAt });
const partyView = (c) => ({ ...publicView(c), recordRef: c.recordRef, claimant: { ...c.claimant }, respondent: { ...c.respondent }, evidence: c.evidence, feePaid: c.feePaid });

/** The public docket: every case, newest first, its public fields only (WARFARE.md, "Public and private"). */
export function publicDocket() {
  return { cases: [...store.cases].sort((a, b) => b.filedAt - a.filedAt).map(publicView) };
}

/** The caller's own cases, either side (its conglomerate's included), newest first, with the evidence. */
export function casesFor(accountId) {
  const corp = accountsStore.accounts?.[accountId]?.state?.corp;
  if (!corp?.publicId) return null;
  return { cases: store.cases.filter((c) => sameSide(corp, c.claimant) || sameSide(corp, c.respondent)).sort((a, b) => b.filedAt - a.filedAt).map(partyView) };
}

/**
 * The records the caller may file `type` on now, each { recordId, ... } with what the filing screen names it by
 * (ISP-243); a record that already has a case of this type is left out. Null for an unknown account or type.
 */
export function fileableRecords(accountId, type, now = Date.now()) {
  const corp = accountsStore.accounts?.[accountId]?.state?.corp;
  if (!corp?.publicId || !claimType(type)) return null;
  const free = (ref) => !hasCase(type, ref);
  let records = [];
  if (type === "mercenary-readiness") {
    records = (myContracts(accountId, now)?.hired || []).map((v) => contractRecord(v.id)).filter((c) => c && c.renterCorpId === corp.publicId && Number.isFinite(c.hireReadiness) && (c.state === "hired" || (c.state === "completed" && now - c.closedAt <= 7 * DAY)))
      .filter((c) => free(`contract:${c.id}`)).map((c) => ({ recordId: c.id, fleetName: c.fleetName, owner: corpById(c.ownerCorpId)?.corporationName || "A corporation", hiredAt: c.hiredAt, endsAt: c.endsAt, state: c.state }));
  } else if (type === "tariff-overcharge") {
    const sales = (corp.tradeHistory || []).filter((r) => r.tariffAmount > 0 && r.tariffRecord?.to?.length && now - r.tariffRecord.at <= 30 * DAY && free(`sale:${r.id}`))
      .map((r) => ({ recordId: r.id, kind: "sale", item: r.item, quantity: r.quantity, at: r.tariffRecord.at, stationId: r.tariffRecord.stationId, tariffPct: r.tariffPct, tariffAmount: r.tariffAmount }));
    const transfers = (corp.shipments || []).filter((s) => s.tariff?.amount > 0 && s.tariff?.to?.length && now - s.tariff.at <= 30 * DAY && free(`transfer:${s.id}`))
      .map((s) => ({ recordId: s.id, kind: "transfer", at: s.tariff.at, stationId: s.tariff.stationId, tariffPct: s.tariff.pct, tariffAmount: s.tariff.amount }));
    records = [...sales, ...transfers].sort((a, b) => b.at - a.at);
  } else if (type === "concession-arbitrated") {
    const self = concessionSelf(corp);
    records = self ? Object.keys(WARFARE_CATALOG.systemRules).filter(isArbitrated)
      .flatMap((systemId) => petitionsIn(systemId).filter((p) => keyOf(p.holder) === keyOf(self) && free(`petition:${p.id}`)).map((p) => ({ recordId: p.id, systemId, kind: p.kind, filedAt: p.filedAt, reviewEndsAt: p.reviewEndsAt }))) : [];
  } else if (type === "patent-royalty") {
    records = (patentOffice(accountId, now)?.mine || []).flatMap((p) => patentUsers(p.id).filter((u) => free(`patent-use:${p.id}:${u}`))
      .map((u) => ({ recordId: `${p.id}~${u}`, patent: p.subjectName, user: corpById(u)?.corporationName || "A corporation" })));
  }
  return { type, open: Boolean(claimType(type).open) && type !== "credit-default", records };
}

/** For tests: forget every case (and optionally the file). */
export function resetArbitration({ removeFile = false } = {}) {
  store = { cases: [], seq: 0 };
  if (removeFile) fs.rmSync(FILE, { force: true });
}
