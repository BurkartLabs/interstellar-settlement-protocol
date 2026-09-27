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
import { addAccountNotification, mutateAccountState } from "./gameState.js";
import { applyCredits } from "./finances.js";
import { accountsStore } from "./game/store.js";
import { settleTransfer } from "./settlement.js";
import { WARFARE_CATALOG, concessionTermsFor } from "./warfare.js";
import { accountByCorp, findConglomerate, roleOf } from "./game/membership.js";
import { currentConglomerateOf } from "./game/intel.js";
import { contractRecord, freezeContractEscrow, myContracts, refundFromEscrow, unfreezeContractEscrow } from "./mercenaries.js";
import { concessionRegister, decideAtCouncil, markPetitionCouncil, petitionRecord, petitionsIn } from "./concessions.js";
import { controlNow } from "./controlService.js";
import { refundLevy, takeTariffAccrual, tariffCap, tariffRates } from "./tariffService.js";
import { patentOffice, patentRecord, patentUsers, patentUsesBy, takeRoyaltyAccrual } from "./patents.js";
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
 * ISP-243 (AB#939): everything filing checks and reads, without charging or writing anything: { corp, claimant, ev, fee }
 * or { refused }. fileCase and previewCase both call it, so the preview is exactly what a filing attaches.
 */
function prepare(accountId, { type, recordId } = {}, now = Date.now()) {
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
  return { corp, claimant, ev, fee: ev.fee ?? councilFee(ev.amount, terms()) };
}

/**
 * ISP-243 (AB#939): the filing wizard's evidence preview: what a filing of `type` on `recordId` would attach now, the
 * respondent it names, the amount claimed and the fee, with nothing charged or written. { preview } or { refused }.
 */
export function previewCase(accountId, input, now = Date.now()) {
  const p = prepare(accountId, input, now);
  if (p.refused) return p;
  return { preview: { type: input.type, recordRef: p.ev.recordRef, claimant: { ...p.claimant }, respondent: { ...p.ev.respondent }, amountClaimed: p.ev.amount, fee: p.fee, evidence: p.ev.evidence, responseHours: terms().responseHours, freezesEscrow: Boolean(p.ev.escrow) } };
}

/**
 * File a case for the caller's corporation: `type` (a catalog claim type) on `recordId` (a record it is the filing party
 * to). Returns { case } (the parties' view, with the evidence) or { refused }. Nothing is written or charged on a refusal.
 */
export function fileCase(accountId, { type, recordId } = {}, now = Date.now()) {
  const p = prepare(accountId, { type, recordId }, now);
  if (p.refused) return p;
  const { claimant, ev, fee } = p;
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
  if (type === "concession-arbitrated") markPetitionCouncil(c.evidence.petition.id, c.ref); // ISP-242 (AB#938): the Council decides it
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

// ─── Rulings and enforcement (ISP-242, AB#938; WARFARE.md, "A case, as a state list" and "Enforcement") ────────
// At the first 00:00 UTC tick after the response window (an arbitrated petition's, after its 7-day review), the claim
// type's rule is applied to the evidence stored at filing. Two claim types read a record that keeps moving after
// filing, again from the server's own store: the owner's readiness for the rest of a mercenary term, and the control
// readings at an arbitrated review's end. Nothing a client sends is read. Dismissed: the fee goes to the fee sink.
// Upheld: the fee goes back to the claimant, and the award is paid from the contract's escrow, then from what the ISA
// holds for the respondent (tariff revenue and patent royalties not yet paid out, and for a tariff overcharge the ISA's
// own levy share at once), then as a Council debt: withheld from the respondent's later sales inside the ITC's one 50%
// (itcService withholdCouncilDebt), counted in its credit rating, and passed on to the claimant here, tick by tick.
// A rule that cannot be evaluated leaves the case pending, with an alert, and moves nothing.

const DAY_START = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
/** When a case is ruled on: the first 00:00 UTC at or after its window's end (or an arbitrated review's end, if later). */
export function decideAt(c) {
  const end = Math.max(c.windowEndsAt, Number(c.evidence?.petition?.reviewEndsAt) || 0);
  return DAY_START(end) === end ? end : DAY_START(end) + DAY;
}

/** Each claim type's rule: { outcome: "upheld" | "dismissed", amount, reason, reading? } or { pending }. May throw. */
const RULES = {
  "mercenary-readiness"(c, now) {
    const contract = contractRecord(c.evidence.contract.id);
    const owner = corpById(c.respondent.id);
    if (!contract || !owner) throw new Error("the contract or its owner is no longer on record");
    const r = readinessRefund({ price: contract.price, termHours: contract.termHours, hireReadiness: c.evidence.hireReadiness, hiredAt: contract.hiredAt }, owner.military?.readinessLog || [], Math.min(now, contract.endsAt));
    return {
      outcome: r.refund > 0 ? "upheld" : "dismissed", amount: r.refund, reading: { hourlyReadiness: r.hours, hoursBelow: r.hoursBelow },
      reason: `Readiness below hire readiness (${c.evidence.hireReadiness}) for ${r.hoursBelow} of ${r.hours.length} contract hours.`
    };
  },
  "tariff-overcharge"(c) {
    const e = c.evidence;
    return { outcome: e.excess > 0 ? "upheld" : "dismissed", amount: e.excess, reason: `Tariff charged ${e.settlement.chargedPct}%, lawful ${e.lawfulPct}%, on a base of ${e.settlement.base.toLocaleString("en-US")} credits.` };
  },
  "patent-royalty"(c) {
    const e = c.evidence;
    return { outcome: e.shortfall > 0 ? "upheld" : "dismissed", amount: e.shortfall, reason: `Royalty due ${e.due.toLocaleString("en-US")} credits at ${e.patent.ratePct}%, recorded ${e.recorded.toLocaleString("en-US")}.` };
  },
  "concession-arbitrated"(c, now) {
    const r = decideAtCouncil(c.evidence.petition.id, now, terms().tieMarginPts);
    if (r.pending) return { pending: true };
    const mine = r.decided.find((d) => keyOf(d.holder) === keyOf(c.evidence.claimant.holder));
    const won = Boolean(mine?.granted);
    return { outcome: won ? "upheld" : "dismissed", amount: 0, order: won ? "granted" : "not granted", reason: `${r.already ? "Decided before the ruling. " : ""}TERRITORY.md's rules at the review's end${r.tie ? `, a tie within ${terms().tieMarginPts} point decided by extraction share, then filing order` : ""}: the concession ${won ? "is granted to" : "is not granted to"} ${c.claimant.name}.`, reading: { scores: r.scores || null } };
  }
};

/** Credit an award to the claimant's corporation, booked "arbitration-award-received". */
function award(c, credits, now) {
  const account = accountOf(c.claimant);
  if (!(credits > 0) || !account) return 0;
  mutateAccountState(account.id, (state) => applyCredits(state.corp, credits, "arbitration-award-received", now), { sanitize: false });
  c.paid = (c.paid || 0) + credits;
  return credits;
}

/** Collect `amount` from `party` for case `c`: what the ISA holds for it, then a Council debt. Returns { income, debt }. */
function collect(c, party, amount, now) {
  let left = Math.max(0, Math.round(amount));
  const fromTariffs = takeTariffAccrual(party, left);
  const fromIncome = fromTariffs + (party.type === "corp" ? takeRoyaltyAccrual(party.id, left - fromTariffs) : 0);
  award(c, fromIncome, now);
  left -= fromIncome;
  if (left > 0) {
    const debtor = accountOf(party);
    const ref = `${c.ref}:${party.id}`;
    if (debtor) {
      mutateAccountState(debtor.id, (state) => {
        if (!Array.isArray(state.corp.councilDebts)) state.corp.councilDebts = [];
        // withholdPct travels with the debt, as corp.itcDuty's does, so the sale confirmation quotes what will be withheld (ISP-243)
        state.corp.councilDebts.push({ ref, caseRef: c.ref, claimant: { type: c.claimant.type, id: c.claimant.id }, owed: left, collected: 0, forwarded: 0, at: now, withholdPct: WARFARE_CATALOG.dumping.withholdPct });
      }, { sanitize: false });
      c.debts = [...(c.debts || []), { ref, party: { type: party.type, id: party.id }, owed: left }];
      notifyParty(party, `${c.ref}: Arbitration Council debt recorded`, `${c.ref}. ${left.toLocaleString("en-US")} credits of the Council's award could not be paid from ISA-held income and are recorded as a debt to ${c.claimant.name}. ${WARFARE_CATALOG.dumping.withholdPct}% of the net proceeds of each exchange sale, shared with any ITC duty owed, is withheld toward it until it is paid. No interest is charged. It counts as debt in your credit rating.`);
    }
  }
  return { income: fromIncome, debt: left };
}

/** Apply an upheld ruling's award. Each step is recorded on the case before the next, so a tick that stops part way finishes on the next without paying twice. */
function enforce(c, now) {
  c.steps ||= {};
  const claimant = accountOf(c.claimant);
  let left = c.ruling.amount;
  if (c.type === "mercenary-readiness" && c.frozenContract) {
    if (c.steps.escrow === undefined) {
      c.steps.escrow = refundFromEscrow(c.frozenContract, claimant?.id, left, c.ref, now);
      c.paid = (c.paid || 0) + c.steps.escrow;
    }
    left -= c.steps.escrow;
  }
  if (c.type === "tariff-overcharge" && left > 0) {
    const s = c.evidence.settlement;
    const levyPart = s.amount > 0 ? Math.round((left * (s.levy || 0)) / s.amount) : 0;
    if (c.steps.levy === undefined) c.steps.levy = award(c, refundLevy(levyPart), now);
    // the holders' part, in the shares they were accrued; the last takes the rounding
    const holderPart = left - c.steps.levy;
    const total = s.to.reduce((a, h) => a + (h.share || 0), 0) || 1;
    const parts = s.to.map((h) => Math.round((holderPart * (h.share || 0)) / total));
    parts[parts.length - 1] += holderPart - parts.reduce((a, b) => a + b, 0);
    s.to.forEach((h, i) => {
      const key = `holder:${h.type}:${h.id}`;
      if (c.steps[key] === undefined) c.steps[key] = collect(c, holderParty(h) || { type: h.type, id: h.id, name: "A former holder" }, parts[i], now);
    });
    left = 0;
  }
  if (left > 0 && c.steps.respondent === undefined) c.steps.respondent = collect(c, c.respondent, left, now);
}

/** Pass on what each Council debt of `c` has collected since the last tick; true when every debt is paid and passed on. */
function forwardDebts(c, now) {
  let open = false;
  for (const d of c.debts || []) {
    const debtor = accountOf(d.party);
    const entry = debtor?.state?.corp?.councilDebts?.find((x) => x.ref === d.ref);
    if (!entry) continue; // the debtor is gone: nothing more can be collected
    const pending = (entry.collected || 0) - (entry.forwarded || 0);
    if (pending > 0) {
      award(c, pending, now);
      mutateAccountState(debtor.id, (state) => { const e = state.corp.councilDebts.find((x) => x.ref === d.ref); e.forwarded = (e.forwarded || 0) + pending; }, { sanitize: false });
    }
    if (entry.owed > 0) open = true;
    else mutateAccountState(debtor.id, (state) => { state.corp.councilDebts = state.corp.councilDebts.filter((x) => x.ref !== d.ref); }, { sanitize: false });
  }
  return !open;
}

function notifyParty(party, title, body) {
  const account = accountOf(party);
  if (account) addAccountNotification(account.id, { type: "finance", title, body });
}

/** Rule on one case and enforce it; leaves it pending (with `alert`) when its rule cannot be evaluated. */
function rule(c, now) {
  let r;
  try {
    r = RULES[c.type](c, now);
  } catch (error) {
    c.alert = `The rule could not be evaluated: ${error?.message || error}`;
    console.error(`[arbitration] ${c.ref} left pending: ${c.alert}`);
    return;
  }
  if (r.pending) return;
  // the fee first: an arbitrated petition's is the petition fee, kept as it is everywhere; else back to an upheld
  // claimant. If it cannot move, nothing is recorded and the case stays pending (no partial ruling).
  const toSink = c.type === "concession-arbitrated" || r.outcome === "dismissed";
  if (c.feePaid > 0 && !c.steps?.fee) {
    const moved = toSink
      ? settleTransfer({ fromAccountId: c.feeEscrow, toAccountId: "sink:fee", credits: c.feePaid, reason: "arbitration-fee", idempotencyKey: `${c.id}:fee-out` }, now)
      : settleTransfer({ fromAccountId: c.feeEscrow, toAccountId: accountOf(c.claimant)?.id, credits: c.feePaid, reason: "escrow-release", idempotencyKey: `${c.id}:fee-out` }, now);
    if (!moved.ok) { c.alert = `The fee could not be settled: ${moved.error}`; console.error(`[arbitration] ${c.ref}: ${c.alert}`); return; }
    c.steps = { ...(c.steps || {}), fee: toSink ? "sink" : "returned" };
  }
  delete c.alert;
  c.ruling = { outcome: r.outcome, amount: r.amount, order: r.order ?? null, reason: r.reason, at: now, ...(r.reading ? { reading: r.reading } : {}) };
  c.state = "ruled";
  if (r.outcome === "upheld" && r.amount > 0) {
    c.state = "enforcing";
    enforce(c, now);
    if (c.type === "tariff-overcharge") {
      // WARFARE.md: the settlement function should have prevented it, so the server reports it as a defect too
      store.defects = [...(store.defects || []), { at: now, ref: c.ref, systemId: c.evidence.settlement.systemId, chargedPct: c.evidence.settlement.chargedPct, lawfulPct: c.evidence.lawfulPct }];
      console.error(`[arbitration] BUG: ${c.ref} upheld a tariff overcharge (${c.evidence.settlement.chargedPct}% charged, ${c.evidence.lawfulPct}% lawful in ${c.evidence.settlement.systemId}): the settlement function let it through`);
    }
  }
  if (c.frozenContract) unfreezeContractEscrow(c.frozenContract);
  if (c.state === "ruled") c.state = "closed";
  if (c.state === "enforcing" && forwardDebts(c, now)) c.state = "closed";
  const text = `${c.ref}. ${c.ruling.reason} ${r.outcome === "upheld" ? (r.amount > 0 ? `Upheld: ${r.amount.toLocaleString("en-US")} credits awarded to ${c.claimant.name}.` : `Upheld: ${c.ruling.order}.`) : "Dismissed."} ${toSink ? `The filing fee of ${c.feePaid.toLocaleString("en-US")} credits is forfeited.` : `The filing fee of ${c.feePaid.toLocaleString("en-US")} credits is returned to the claimant.`}`;
  c.ruling.text = text;
  for (const p of [c.claimant, c.respondent]) notifyParty(p, `${c.ref}: Arbitration Council ruling`, text);
}

/**
 * The adjudication tick (after the concession tick): rule on every case whose time has come, pass on what Council
 * debts collected, and close what is paid. Final and idempotent: a decided case is never ruled again, and every money
 * move is keyed or recorded on the case. Returns the refs it ruled.
 */
export function arbitrationTick(now = Date.now()) {
  const ruled = [];
  let changed = false;
  for (const c of store.cases) {
    if (c.state === "answering" && now >= decideAt(c)) {
      const before = JSON.stringify(c);
      rule(c, now);
      if (c.state !== "answering") ruled.push(c.ref);
      if (JSON.stringify(c) !== before) changed = true;
    } else if (c.state === "enforcing") {
      const before = c.paid;
      if (forwardDebts(c, now)) c.state = "closed";
      if (c.paid !== before || c.state === "closed") changed = true;
    } else if (c.type === "credit-default" && c.state === "ruled") {
      c.state = "closed"; // WARFARE.md: no remedy beyond v0.9's own recovery; the shortfall stays owed on the loan or bond
      changed = true;
    }
  }
  if (changed) save();
  return ruled;
}

/**
 * The respondent cures, inside the window, in one action: it pays the amount claimed to the claimant, and the claimant's
 * filing fee is returned (WARFARE.md: the claimant is made whole, and the fee is not forfeited). Closes the case, and
 * lifts a contract's freeze. Returns { case } (the parties' view) or { refused }.
 */
export function cureCase(accountId, ref, now = Date.now()) {
  const c = store.cases.find((x) => x.ref === ref);
  if (!c) return no(404, "no-case", "No such case.");
  if (accountOf(c.respondent)?.id !== accountId) return no(403, "not-respondent", "Only the respondent (for a conglomerate, its founder) can cure a case.");
  if (c.state !== "answering" || now >= c.windowEndsAt) return no(409, "window-closed", "The response window has closed: the Council's rule decides the case now.");
  if (c.type === "concession-arbitrated" || c.type === "credit-default") return no(409, "nothing-to-cure", "This case is an order, not a payment: there is nothing to cure.");
  const claimant = accountOf(c.claimant);
  if (!claimant) return no(409, "no-claimant", "The claimant no longer exists.");
  if (c.amountClaimed > 0) {
    const paid = settleTransfer({ fromAccountId: accountId, toAccountId: claimant.id, credits: c.amountClaimed, reason: "arbitration-award", idempotencyKey: `${c.id}:cure` }, now);
    if (!paid.ok) return no(402, "cannot-pay", `Curing costs ${c.amountClaimed.toLocaleString("en-US")} credits, paid to ${c.claimant.name} at once.`);
  }
  if (c.feePaid > 0) settleTransfer({ fromAccountId: c.feeEscrow, toAccountId: claimant.id, credits: c.feePaid, reason: "escrow-release", idempotencyKey: `${c.id}:fee-out` }, now);
  if (c.frozenContract) unfreezeContractEscrow(c.frozenContract);
  Object.assign(c, { state: "closed", paid: c.amountClaimed, ruling: { outcome: "cured", amount: c.amountClaimed, order: null, at: now, reason: "Cured by the respondent inside the response window.", text: `${c.ref}. Cured by ${c.respondent.name}: ${c.amountClaimed.toLocaleString("en-US")} credits paid to ${c.claimant.name}, and the filing fee returned.` } });
  save();
  notifyParty(c.claimant, `${c.ref}: case cured`, c.ruling.text);
  return { case: partyView(c) };
}

// ─── Reading ────────────────────────────────────────────────────────────────

const publicView = (c) => ({ ref: c.ref, type: c.type, claimant: c.claimant.name, respondent: c.respondent.name, state: c.state, ruling: c.ruling ? { outcome: c.ruling.outcome, amount: c.ruling.amount, order: c.ruling.order ?? null } : null, paid: c.paid || 0, amountClaimed: c.amountClaimed, filedAt: c.filedAt, windowEndsAt: c.windowEndsAt });
const partyView = (c) => ({ ...publicView(c), recordRef: c.recordRef, claimant: { ...c.claimant }, respondent: { ...c.respondent }, evidence: c.evidence, feePaid: c.feePaid, decideAt: decideAt(c), ruling: c.ruling ? { ...c.ruling } : null, paid: c.paid || 0, debts: c.debts || [], ...(c.alert ? { alert: c.alert } : {}) });

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

/** For tests: the stored case itself (not a copy), to stage a defect the rules must catch. */
export const caseRecordForTests = (ref) => store.cases.find((c) => c.ref === ref) || null;

/** For tests: forget every case (and optionally the file). */
export function resetArbitration({ removeFile = false } = {}) {
  store = { cases: [], seq: 0 };
  if (removeFile) fs.rmSync(FILE, { force: true });
}
