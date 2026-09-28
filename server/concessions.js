// server/concessions.js: ISA concessions: petition, review, grant, renewal, upkeep, grace, challenge, relinquish and
// lapse (ISP-227, AB#922; docs/design/TERRITORY.md, "The concession's life, as a state list"). The terms are the warfare
// catalog's (server/warfare.js concessionTermsFor); eligibility and scores are the daily control readings
// (server/controlService.js controlNow).
//
// A holder is a conglomerate (its founder files, and its treasury pays) or an independent corporation (its credits pay).
// Who files is always the caller's own corporation or conglomerate: nothing in a request names a holder. Every change is
// driven by stored times, from the minute tick (concessionTick) or the request, so a restart loses nothing.
//
// What a concession takes is its own petition fee and its own upkeep, each paid only when the payer can: upkeep that
// cannot be paid suspends the benefits (grace) and, after concessionGraceDays, lapses the concession; it is never owed
// and never pushes a balance below zero. A lapse removes the concession, and only the concession: leases, buildings,
// fleets, goods and credits are never read here, let alone changed (the design's charter-risk check).
//
// Kept in concessions.json in the data directory: holder ids (corporation publicIds, conglomerate ids), names and
// dates, all public (the ISA register), never an account id.

import fs from "node:fs";
import path from "node:path";
import { dataDir, safeWriteFile, createId } from "./game/catalog.js";
import { dayKeyOf } from "./game/dominanceCounters.js";
import { accountsStore, scheduleAccountsSave } from "./game/store.js";
import { mutateAccountState } from "./gameState.js";
import { applyCredits } from "./finances.js";
import { accountByCorp, findConglomerate, roleOf } from "./game/membership.js";
import { currentConglomerateOf } from "./game/intel.js";
import { moveTreasury, settleTreasury } from "./game/conglomerates.js";
import { can } from "./conglomerates.js";
import { settleTransfer } from "./settlement.js";
import { WARFARE_CATALOG, concessionTermsFor } from "./warfare.js";
import { controlNow } from "./controlService.js";
import { ensureRef } from "./references.js"; // ISP-249 (AB#945): the record's reference, given on first read and kept

const FILE = path.join(dataDir, "concessions.json");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const REGISTER_KEPT = 20;
let store = readStore();

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return parsed && typeof parsed === "object" && parsed.systems ? parsed : { systems: {}, lastUpkeepDay: null };
  } catch {
    return { systems: {}, lastUpkeepDay: null };
  }
}
const save = () => safeWriteFile(FILE, JSON.stringify(store));
const keyOf = (holder) => `${holder.type}:${holder.id}`;
const recordFor = (systemId) => (store.systems[systemId] ||= { systemId, holders: [], petitions: [], register: [], cooldowns: {} });
const no = (status, code, error) => ({ refused: { status, code, error } });
function note(rec, at, event, holder, extra = {}) {
  rec.register.push({ at, event, holder: holder ? { type: holder.type, id: holder.id, name: holder.name } : null, ...extra });
  if (rec.register.length > REGISTER_KEPT) rec.register.splice(0, rec.register.length - REGISTER_KEPT);
}

/** The caller as a holder: its conglomerate (with the permission) or itself. { holder, corp } or { refused }. */
function callerHolder(accountId) {
  const corp = accountsStore.accounts?.[accountId]?.state?.corp;
  if (!corp?.publicId) return no(404, "no-account", "Account not found.");
  const c = currentConglomerateOf(corp);
  if (c) {
    if (!can(roleOf(c, corp.publicId), "concession")) return no(403, "not-permitted", "Only your conglomerate's founder can petition for, challenge or relinquish a concession, from its treasury.");
    return { holder: { type: "conglomerate", id: c.id, name: c.name }, corp };
  }
  return { holder: { type: "corp", id: corp.publicId, name: corp.corporationName || "A corporation" }, corp };
}

/** Pay `amount` from the holder: a corporation's credits (to the fee sink) or a conglomerate's treasury. Never partial. */
function pay(holder, amount, now, key, note) {
  if (!(amount > 0)) return true;
  if (holder.type === "corp") {
    const account = accountByCorp(holder.id);
    if (!account) return false;
    return settleTransfer({ fromAccountId: account.id, toAccountId: "sink:fee", credits: amount, reason: "fee", idempotencyKey: key }, now).ok;
  }
  const c = findConglomerate(holder.id);
  if (!c) return false;
  settleTreasury(c, now);
  if (Math.floor(Number(c.treasury?.credits) || 0) < amount) return false;
  moveTreasury(c, { at: now, kind: "concession", corp: null, amount: -amount, by: null, note });
  scheduleAccountsSave();
  return true;
}

function grant(rec, holder, now, terms) {
  rec.holders.push({ holder, state: "granted", grantedAt: now, termEndsAt: now + terms.concessionTermDays * DAY, graceSince: null });
  note(rec, now, "granted", holder, { termEndsAt: now + terms.concessionTermDays * DAY });
}
function lapse(rec, entry, now, why, terms) {
  rec.holders = rec.holders.filter((h) => h !== entry);
  rec.cooldowns[keyOf(entry.holder)] = now + (terms?.concessionRepetitionCooldownDays ?? WARFARE_CATALOG.concessionRepetitionCooldownDays) * DAY;
  note(rec, now, "lapsed", entry.holder, { why });
}
/**
 * The challenge bar (Aegis ADM): the holder's score x concessionLeadRatio x (1 + concessionAdmMaxPct/100 x its extraction
 * share). Bug #4667: on top of the lead, or eligibility's own 1.5x would always clear it.
 */
const barFor = (held, terms) => (held?.score || 0) * terms.concessionLeadRatio * (1 + (terms.concessionAdmMaxPct / 100) * (held?.extraction || 0));
const scoreOf = (scores, holder) => scores.find((s) => keyOf(s) === keyOf(holder));

/**
 * File a petition (or, when the system's places are full, a challenge) for the caller's own corporation or
 * conglomerate, docked in the system. Refused, with nothing charged, when the system is never concedable, the caller
 * is not eligible (or eligibility cannot be computed: fails closed), already holds or has one open, is in its
 * cooldown, or cannot pay the fee.
 */
export function petitionConcession(accountId, systemId, now = Date.now()) {
  const who = callerHolder(accountId);
  if (who.refused) return who;
  const { holder, corp } = who;
  const ctl = controlNow(systemId, now);
  const terms = ctl.terms;
  if (!terms) return no(409, "never-concedable", "The ISA grants no concession in this system.");
  if ((corp.currentSystemId || "sol") !== systemId) return no(409, "not-docked", "A petition is filed at the system's ISA Claims & Leases: travel there first.");
  const rec = recordFor(systemId);
  const hk = keyOf(holder);
  if (rec.holders.some((h) => keyOf(h.holder) === hk)) return no(409, "already-held", "You already hold this system's concession.");
  if (rec.petitions.some((p) => p.state === "open" && keyOf(p.holder) === hk)) return no(409, "already-petitioned", "Your petition for this system is already under review.");
  if ((rec.cooldowns[hk] || 0) > now) return no(409, "cooldown", "Your last concession here lapsed recently; the ISA will hear a new petition after the cooldown.");
  if (!terms.holders.includes(holder.type)) return no(409, "holder-type", "The ISA grants this system's concession only to a conglomerate.");
  if (ctl.stale) return no(503, "no-reading", "The ISA cannot read this system's control scores just now, so it hears no petition.");
  if (!ctl.eligible.has(hk)) return no(409, "not-eligible", `A petition needs ${terms.concessionGrantPct}% control and a ${terms.concessionLeadRatio}x lead, on each of the last ${terms.concessionEligibleDays} days.`);
  const full = rec.holders.length >= terms.concessionsPerSystem;
  const kind = full ? "challenge" : "petition";
  let target = null;
  if (full) {
    target = [...rec.holders].sort((a, b) => (scoreOf(ctl.scores, a.holder)?.score || 0) - (scoreOf(ctl.scores, b.holder)?.score || 0))[0];
    const mine = scoreOf(ctl.scores, holder)?.score || 0;
    if (!(mine > barFor(scoreOf(ctl.scores, target.holder), terms))) return no(409, "below-bar", "A challenge must beat the holder's control by more, the more the holder works the system.");
  } else if (!terms.counterPetitions && rec.petitions.some((p) => p.state === "open" && p.kind === "petition")) {
    return no(409, "first-recorded", "Claims here are recorded first come: a petition is already under review.");
  }
  const id = createId("cpet");
  if (!pay(holder, terms.concessionPetitionFee, now, `concession:${systemId}:${id}:fee`, `petition fee, ${systemId}`)) {
    return no(409, "cannot-pay", `A petition costs ${terms.concessionPetitionFee.toLocaleString("en-US")} credits${holder.type === "conglomerate" ? " from the treasury" : ""}.`);
  }
  const petition = { id, kind, holder, filedAt: now, reviewEndsAt: now + terms.concessionReviewHours * HOUR, state: "open", ...(target ? { target: target.holder } : {}) };
  rec.petitions.push(petition);
  note(rec, now, kind === "challenge" ? "challenged" : "petitioned", holder, { reviewEndsAt: petition.reviewEndsAt });
  if (terms.concessionReviewHours === 0) reviewConcessions(now, systemId); // unregulated: decided at once
  save();
  return { petition: publicPetition(petition), concession: publicConcession(systemId, now) };
}

/** The holder gives its concession up: it lapses now, with the usual cooldown. */
export function relinquishConcession(accountId, systemId, now = Date.now()) {
  const who = callerHolder(accountId);
  if (who.refused) return who;
  const rec = store.systems[systemId];
  const entry = rec?.holders.find((h) => keyOf(h.holder) === keyOf(who.holder));
  if (!entry) return no(404, "not-held", "You hold no concession in this system.");
  lapse(rec, entry, now, "relinquished", concessionTermsFor(systemId));
  save();
  return { concession: publicConcession(systemId, now) };
}

/**
 * Decide every petition and challenge whose review has ended (or, with `onlySystemId`, that system's). A petition is
 * decided with every counter-petition open beside it: of those still eligible, the highest control score wins the
 * places left, and the rest fail (fees kept). A challenge wins if the challenger is still eligible and clears the bar;
 * the holder then lapses. Readings that are stale postpone the decision (nothing granted on data that cannot be read).
 */
export function reviewConcessions(now = Date.now(), onlySystemId = null) {
  let changed = false;
  for (const rec of Object.values(store.systems)) {
    if (onlySystemId && rec.systemId !== onlySystemId) continue;
    // ISP-242 (AB#938): a petition or challenge before the Arbitration Council is decided by its ruling, not here
    const atCouncil = (p) => Boolean(p.councilRef) || rec.petitions.some((q) => q.state === "open" && q.councilRef && q.kind === "petition" && p.kind === "petition");
    const due = rec.petitions.filter((p) => p.state === "open" && p.reviewEndsAt <= now && !atCouncil(p));
    if (!due.length) continue;
    const ctl = controlNow(rec.systemId, now);
    if (!ctl.terms || ctl.stale) continue;
    const terms = ctl.terms;
    if (due.some((p) => p.kind === "petition")) {
      const open = rec.petitions.filter((p) => p.state === "open" && p.kind === "petition");
      const places = Math.max(0, terms.concessionsPerSystem - rec.holders.length);
      const ranked = open.filter((p) => ctl.eligible.has(keyOf(p.holder))).sort((a, b) => (scoreOf(ctl.scores, b.holder)?.score || 0) - (scoreOf(ctl.scores, a.holder)?.score || 0) || a.filedAt - b.filedAt);
      const winners = new Set(ranked.slice(0, places));
      for (const p of open) {
        p.state = winners.has(p) ? "granted" : "failed";
        p.decidedAt = now;
        if (winners.has(p)) grant(rec, p.holder, now, terms);
        else note(rec, now, "petition-failed", p.holder);
      }
      changed = true;
    }
    for (const p of due.filter((x) => x.kind === "challenge")) {
      const target = rec.holders.find((h) => keyOf(h.holder) === keyOf(p.target));
      const mine = scoreOf(ctl.scores, p.holder)?.score || 0;
      const wins = target && ctl.eligible.has(keyOf(p.holder)) && mine > barFor(scoreOf(ctl.scores, target.holder), terms);
      p.state = wins ? "granted" : "failed";
      p.decidedAt = now;
      if (wins) { lapse(rec, target, now, "challenged", terms); grant(rec, p.holder, now, terms); }
      else note(rec, now, "challenge-failed", p.holder);
      changed = true;
    }
  }
  return changed;
}

/** Renew every term that has ended: at least concessionRetainPct on the day and not in grace, or lapse. */
export function renewConcessions(now = Date.now()) {
  let changed = false;
  for (const rec of Object.values(store.systems)) {
    for (const entry of [...rec.holders]) {
      if (entry.termEndsAt > now) continue;
      const ctl = controlNow(rec.systemId, now);
      if (!ctl.terms) { lapse(rec, entry, now, "no longer concedable", null); changed = true; continue; }
      if (entry.state === "grace") { lapse(rec, entry, now, "term ended in grace", ctl.terms); changed = true; continue; }
      if (ctl.stale) continue; // decided when the readings can be read again
      const score = scoreOf(ctl.scores, entry.holder)?.score || 0;
      if (score * 100 >= ctl.terms.concessionRetainPct) {
        entry.termEndsAt += ctl.terms.concessionTermDays * DAY;
        note(rec, now, "renewed", entry.holder, { termEndsAt: entry.termEndsAt });
      } else lapse(rec, entry, now, "control below the retain line at renewal", ctl.terms);
      changed = true;
    }
  }
  return changed;
}

/** Every concession a holder holds, across systems. */
const heldBy = (holder) => Object.values(store.systems).flatMap((rec) => rec.holders.filter((h) => keyOf(h.holder) === keyOf(holder)).map((h) => ({ rec, entry: h })));

/**
 * What a holder's concession in a system costs today: concessionUpkeepBase x k (k = concessions it holds, so k of them
 * cost base x k² in all), less the use discount (concessionUseDiscountMaxPct x its control share there), times the
 * system's upkeep factor. Whole credits.
 */
export function upkeepFor(holder, systemId, now = Date.now()) {
  const terms = concessionTermsFor(systemId);
  if (!terms) return 0;
  const k = heldBy(holder).length;
  const share = scoreOf(controlNow(systemId, now).scores, holder)?.score || 0;
  return Math.round(terms.concessionUpkeepBase * k * (1 - (terms.concessionUseDiscountMaxPct / 100) * share) * terms.upkeepFactor);
}

/**
 * The day's upkeep, once per UTC day: each concession charged from its holder. Paid: granted (a concession in grace
 * returns to granted). Not payable: grace, benefits suspended; after concessionGraceDays in grace, lapsed.
 */
export function chargeUpkeep(now = Date.now()) {
  const day = dayKeyOf(now);
  if (store.lastUpkeepDay === day) return false;
  store.lastUpkeepDay = day;
  const due = Object.values(store.systems).flatMap((rec) => rec.holders.map((entry) => ({ rec, entry, amount: upkeepFor(entry.holder, rec.systemId, now) })));
  for (const { rec, entry, amount } of due) {
    const terms = concessionTermsFor(rec.systemId);
    if (pay(entry.holder, amount, now, `concession:${rec.systemId}:${keyOf(entry.holder)}:upkeep:${day}`, `upkeep, ${rec.systemId}`)) {
      if (entry.state === "grace") { entry.state = "granted"; entry.graceSince = null; note(rec, now, "upkeep-paid", entry.holder); }
      continue;
    }
    if (entry.state !== "grace") { entry.state = "grace"; entry.graceSince = now; note(rec, now, "grace", entry.holder); }
    else if (now - entry.graceSince >= (terms?.concessionGraceDays ?? WARFARE_CATALOG.concessionGraceDays) * DAY) lapse(rec, entry, now, "upkeep unpaid", terms);
  }
  return true;
}

/** The minute tick: reviews due, terms ended, and the day's upkeep (once per UTC day). */
export function concessionTick(now = Date.now()) {
  const a = reviewConcessions(now);
  const b = renewConcessions(now);
  const c = chargeUpkeep(now);
  if (a || b || c) save();
}

function publicPetition(p) {
  return { kind: p.kind, holder: { type: p.holder.type, id: p.holder.id, name: p.holder.name }, filedAt: p.filedAt, reviewEndsAt: p.reviewEndsAt, state: p.state };
}

/** A system's concession as the ISA register shows it: holders, open petitions and the recent register. Public. */
export function publicConcession(systemId, now = Date.now()) {
  const terms = concessionTermsFor(systemId);
  const rec = store.systems[systemId];
  return {
    systemId,
    concedable: Boolean(terms),
    holders: (rec?.holders || []).map((h) => ({
      holder: { type: h.holder.type, id: h.holder.id, name: h.holder.name }, state: h.state, grantedAt: h.grantedAt,
      termEndsAt: h.termEndsAt, benefits: h.state === "granted",
      ref: ensureRef(h, "CSN", { recordId: `${systemId}:${h.holder.type}:${h.holder.id}@${h.grantedAt}`, issuedAt: h.grantedAt })[0], // ISP-249 (AB#945): the grant's
      // ISP-228 (AB#923): the everyone-discount in force and any change waiting out its notice, both public
      leaseDiscountPct: terms ? modifierNow(h, now, terms) : 0,
      ...(h.leaseModifier?.pendingPct !== undefined && h.leaseModifier?.pendingPct !== null && now < h.leaseModifier.effectiveAt ? { pendingLeaseDiscount: { pct: h.leaseModifier.pendingPct, effectiveAt: h.leaseModifier.effectiveAt } } : {})
    })),
    petitions: (rec?.petitions || []).filter((p) => p.state === "open").map(publicPetition),
    register: [...(rec?.register || [])].reverse()
  };
}

/** For AB#923: whether a holder's concession in a system is in force now (granted, not in grace). */
export function concessionInForce(systemId, holder) {
  return Boolean(store.systems[systemId]?.holders.some((h) => keyOf(h.holder) === keyOf(holder) && h.state === "granted"));
}

// ─── ISP-228 (AB#923): what a concession grants ─────────────────────────────────────────────────────────────────────
// TERRITORY.md, "What a concession grants": the fee share and the lease-fee modifier. Only a concession in force
// (granted, not in grace) grants either; a lapse or grace simply stops them.

const inForce = (systemId) => (store.systems[systemId]?.holders || []).filter((h) => h.state === "granted");
/** Whether `corp` is, or belongs to, the holder: an independent corporation itself, or a member of the conglomerate. */
function belongsTo(corp, holder) {
  if (!corp?.publicId) return false;
  if (holder.type === "corp") return holder.id === corp.publicId;
  return Boolean(findConglomerate(holder.id)?.members?.some((m) => m.corp === corp.publicId));
}
/** A stored discount, or 0 when it is not a whole percentage within the catalog's bounds (fails closed: the base fee). */
const validPct = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : 0);

/** The discount a holder's modifier gives now: the waiting change once its notice has passed, else the current one. */
function modifierNow(entry, now, terms) {
  const m = entry.leaseModifier;
  if (!m || !terms) return 0;
  const max = terms.concessionLeaseModifierMaxPct;
  if (m.pendingPct !== undefined && m.pendingPct !== null && now >= m.effectiveAt) return validPct(m.pendingPct, max);
  return validPct(m.pct, max);
}

/**
 * What a new lease on a body in `systemId` costs `corp` now: the base `leaseCost`, less the larger of the holder's
 * everyone-discount (after its notice) and, for the holder or its members, the own-lease discount. Never above the
 * base. { cost, discountPct }.
 */
export function leaseCostFor(systemId, corp, base, now = Date.now()) {
  const terms = concessionTermsFor(systemId);
  const entries = inForce(systemId);
  if (!terms || !entries.length || !(base > 0)) return { cost: base, discountPct: 0 };
  let pct = 0;
  for (const e of entries) {
    pct = Math.max(pct, modifierNow(e, now, terms));
    if (belongsTo(corp, e.holder)) pct = Math.max(pct, validPct(terms.concessionOwnLeaseDiscountPct, 100));
  }
  return { cost: Math.max(0, Math.min(base, Math.round((base * (100 - pct)) / 100))), discountPct: pct };
}

/**
 * The holder sets the discount on everyone's new leases in its system: a whole percentage from 0 to
 * concessionLeaseModifierMaxPct, applying after concessionLeaseModifierNoticeHours. Refused while a change is waiting,
 * or when the caller does not hold the concession (for a conglomerate, only a role with the "concession" permission).
 */
export function setLeaseModifier(accountId, systemId, pct, now = Date.now()) {
  const who = callerHolder(accountId);
  if (who.refused) return who;
  const terms = concessionTermsFor(systemId);
  const entry = store.systems[systemId]?.holders.find((h) => keyOf(h.holder) === keyOf(who.holder));
  if (!terms || !entry) return no(404, "not-held", "You hold no concession in this system.");
  if (entry.state !== "granted") return no(409, "in-grace", "The concession's benefits are suspended until its upkeep is paid.");
  const max = terms.concessionLeaseModifierMaxPct;
  if (!Number.isInteger(pct) || pct < 0 || pct > max) return no(400, "out-of-bounds", `The lease discount is a whole percentage from 0 to ${max}.`);
  const m = entry.leaseModifier || { pct: 0 };
  if (m.pendingPct !== undefined && m.pendingPct !== null && now < m.effectiveAt) return no(409, "notice-period", "A change to the lease discount is already waiting out its notice period.");
  const current = modifierNow(entry, now, terms);
  entry.leaseModifier = { pct: current, pendingPct: pct, effectiveAt: now + terms.concessionLeaseModifierNoticeHours * HOUR };
  note(store.systems[systemId], now, "lease-modifier", entry.holder, { pct, effectiveAt: entry.leaseModifier.effectiveAt });
  save();
  return { leaseModifier: { pct: current, pendingPct: pct, effectiveAt: entry.leaseModifier.effectiveAt } };
}

/**
 * Pay each holder in force its share of an ISA fee paid in `systemId` by `payerCorp`: concessionFeeSharePct of `amount`
 * (times the system's fee-share factor, halved in a condominium), in whole credits. Nothing for a fee the holder, or a
 * member of the holding conglomerate, paid itself. Booked as "concession-fee-share" income (the holder's P&L) or into
 * the conglomerate's treasury. Call it after the payer's own change is saved, never inside another account's mutation.
 * Returns what was paid in all.
 */
export function payConcessionShare(systemId, amount, payerCorp, now = Date.now(), source = "lease") {
  const terms = concessionTermsFor(systemId);
  if (!terms || !(amount > 0)) return 0;
  let paid = 0;
  for (const entry of inForce(systemId)) {
    if (belongsTo(payerCorp, entry.holder)) continue;
    const share = Math.floor((amount * terms.concessionFeeSharePct * terms.feeShareFactor) / 100);
    if (!(share > 0)) continue;
    if (entry.holder.type === "corp") {
      const account = accountByCorp(entry.holder.id);
      if (!account) continue;
      mutateAccountState(account.id, (state) => { applyCredits(state.corp, share, "concession-fee-share", now); }, { sanitize: false, settleMining: false });
    } else {
      const c = findConglomerate(entry.holder.id);
      if (!c) continue;
      settleTreasury(c, now);
      moveTreasury(c, { at: now, kind: "concession-fee-share", corp: payerCorp?.publicId ?? null, amount: share, by: null, note: `${source}, ${systemId}` });
      scheduleAccountsSave();
    }
    entry.feeShareCollected = (entry.feeShareCollected || 0) + share;
    paid += share;
  }
  if (paid) save();
  return paid;
}

// ─── ISP-229 (AB#924): what the starmap and a viewer's own panel read ────────────────────────────────────────────────

/** Every system's concession for the starmap's overlay: holders and open petitions, public (names, types, dates). */
export function starmapConcessions(systemIds, now = Date.now()) {
  return { systems: Object.fromEntries([...systemIds].map((id) => {
    const c = publicConcession(id, now);
    return [id, { concedable: c.concedable, holders: c.holders.map((h) => ({ name: h.holder.name, type: h.holder.type, state: h.state, termEndsAt: h.termEndsAt, ref: h.ref })), /* ISP-252 (AB#948): the grant's CSN reference, drawn */ petitions: c.petitions.map((p) => ({ kind: p.kind, name: p.holder.name, type: p.holder.type, reviewEndsAt: p.reviewEndsAt })) }];
  })) };
}

/**
 * The viewer's own reading of a system: who it would petition as, whether it may (and if not, why), its eligibility
 * streak, the fee and the upkeep it would pay if granted (for the confirmation), and, when it holds the concession,
 * what the holder manages: state, term, today's upkeep, the fee share collected and the lease discount in force or
 * waiting. Nothing about any other corporation.
 */
export function concessionStatusFor(accountId, systemId, now = Date.now()) {
  const corp = accountsStore.accounts?.[accountId]?.state?.corp;
  if (!corp?.publicId) return no(404, "no-account", "Account not found.");
  const c = currentConglomerateOf(corp);
  const holder = c ? { type: "conglomerate", id: c.id, name: c.name } : { type: "corp", id: corp.publicId, name: corp.corporationName || "A corporation" };
  const canAct = !c || can(roleOf(c, corp.publicId), "concession");
  const ctl = controlNow(systemId, now);
  const terms = ctl.terms;
  const rec = store.systems[systemId];
  const hk = keyOf(holder);
  const entry = rec?.holders.find((h) => keyOf(h.holder) === hk) || null;
  const open = rec?.petitions.find((p) => p.state === "open" && keyOf(p.holder) === hk) || null;
  const base = { holder: { type: holder.type, name: holder.name }, concedable: Boolean(terms), canAct, docked: (corp.currentSystemId || "sol") === systemId };
  if (!terms) return base;
  let refusal = null;
  if (!canAct) refusal = "Only your conglomerate's founder can petition for a concession, from its treasury.";
  else if (open) refusal = "Your petition is under review.";
  else if ((rec?.cooldowns?.[hk] || 0) > now) refusal = "Your last concession here lapsed recently; the ISA will hear a new petition after the cooldown.";
  else if (!terms.holders.includes(holder.type)) refusal = "The ISA grants this system's concession only to a conglomerate.";
  else if (ctl.stale) refusal = "The ISA cannot read this system's control scores just now.";
  else if (!ctl.eligible.has(hk)) refusal = `A petition needs ${terms.concessionGrantPct}% control and a ${terms.concessionLeadRatio}x lead on each of the last ${terms.concessionEligibleDays} days.`;
  else if (!base.docked) refusal = "A petition is filed at this system's ISA Claims & Leases: travel here first.";
  const full = (rec?.holders.length || 0) >= terms.concessionsPerSystem;
  const k = heldBy(holder).length + (entry ? 0 : 1);
  const share = scoreOf(ctl.scores, holder)?.score || 0;
  const upkeep = Math.round(terms.concessionUpkeepBase * k * (1 - (terms.concessionUseDiscountMaxPct / 100) * share) * terms.upkeepFactor);
  const pending = entry?.leaseModifier?.pendingPct !== undefined && entry?.leaseModifier?.pendingPct !== null && now < entry.leaseModifier.effectiveAt;
  return {
    ...base,
    eligible: ctl.eligible.has(hk),
    streakDays: ctl.streaks?.get(hk) || 0,
    needDays: terms.concessionEligibleDays,
    stale: ctl.stale,
    petition: entry ? null : { kind: full ? "challenge" : "petition", fee: terms.concessionPetitionFee, upkeepIfGranted: upkeep, concessionsAfter: k, refusal, open: open ? { reviewEndsAt: open.reviewEndsAt } : null },
    holds: entry ? {
      state: entry.state, grantedAt: entry.grantedAt, termEndsAt: entry.termEndsAt, graceSince: entry.graceSince,
      upkeepToday: upkeep, feeShareCollected: entry.feeShareCollected || 0, feeSharePct: terms.concessionFeeSharePct * terms.feeShareFactor,
      ownLeaseDiscountPct: terms.concessionOwnLeaseDiscountPct, leaseDiscountPct: modifierNow(entry, now, terms), leaseDiscountMaxPct: terms.concessionLeaseModifierMaxPct,
      noticeHours: terms.concessionLeaseModifierNoticeHours,
      pendingLeaseDiscount: pending ? { pct: entry.leaseModifier.pendingPct, effectiveAt: entry.leaseModifier.effectiveAt } : null
    } : null
  };
}

/** For tests: a system's stored record, to corrupt a value and see the reader fail closed. */
export const concessionRecordForTests = (systemId) => store.systems[systemId] ?? null;

/** ISP-241 (AB#937): a petition or challenge by id, with its system's holders and open petitions (copies); or null. */
export function petitionRecord(petitionId) {
  for (const rec of Object.values(store.systems)) {
    const petition = rec.petitions.find((p) => p.id === petitionId);
    if (petition) return JSON.parse(JSON.stringify({ systemId: rec.systemId, petition, holders: rec.holders, petitions: rec.petitions.filter((p) => p.state === "open") }));
  }
  return null;
}
/** ISP-242 (AB#938): mark a petition or challenge as before the Council (the ordinary review leaves it), or clear it. */
export function markPetitionCouncil(petitionId, caseRef) {
  for (const rec of Object.values(store.systems)) {
    const p = rec.petitions.find((x) => x.id === petitionId);
    if (p) { p.councilRef = caseRef || null; save(); return true; }
  }
  return false;
}

/**
 * ISP-242 (AB#938; WARFARE.md, `concession-arbitrated`): the Council decides a petition or challenge in an arbitrated
 * system by TERRITORY.md's rules at `now`, with its tie-break: two eligible petitioners' scores within `tieMarginPts`
 * points go to the higher extraction share, then to the earlier filing. A petition is decided with every petition open
 * beside it, as the review would. Returns { pending } while the readings are stale (nothing decided on data that cannot
 * be read), else { decided: [{ holder, kind, granted }], tie } and the concessions it changed.
 */
export function decideAtCouncil(petitionId, now = Date.now(), tieMarginPts = 1) {
  const rec = Object.values(store.systems).find((r) => r.petitions.some((p) => p.id === petitionId));
  const p = rec?.petitions.find((x) => x.id === petitionId);
  if (!p || p.state !== "open") return { decided: [], tie: false, already: true };
  const ctl = controlNow(rec.systemId, now);
  if (!ctl.terms || ctl.stale) return { pending: true };
  const terms = ctl.terms;
  const decided = [];
  let tie = false;
  if (p.kind === "challenge") {
    const target = rec.holders.find((h) => keyOf(h.holder) === keyOf(p.target));
    const mine = scoreOf(ctl.scores, p.holder)?.score || 0;
    const wins = Boolean(target) && ctl.eligible.has(keyOf(p.holder)) && mine > barFor(scoreOf(ctl.scores, target.holder), terms);
    Object.assign(p, { state: wins ? "granted" : "failed", decidedAt: now, councilRef: null });
    if (wins) { lapse(rec, target, now, "challenged", terms); grant(rec, p.holder, now, terms); }
    else note(rec, now, "challenge-failed", p.holder);
    decided.push({ holder: p.holder, kind: "challenge", granted: wins });
  } else {
    const open = rec.petitions.filter((x) => x.state === "open" && x.kind === "petition");
    const places = Math.max(0, terms.concessionsPerSystem - rec.holders.length);
    const s = (x) => scoreOf(ctl.scores, x.holder) || { score: 0, extraction: 0 };
    const ranked = open.filter((x) => ctl.eligible.has(keyOf(x.holder))).sort((a, b) => {
      const d = s(b).score - s(a).score;
      if (Math.abs(d) * 100 > tieMarginPts) return d;
      return (s(b).extraction - s(a).extraction) || a.filedAt - b.filedAt;
    });
    tie = ranked.length > 1 && Math.abs(s(ranked[0]).score - s(ranked[1]).score) * 100 <= tieMarginPts;
    const winners = new Set(ranked.slice(0, places));
    for (const x of open) {
      Object.assign(x, { state: winners.has(x) ? "granted" : "failed", decidedAt: now, councilRef: null });
      if (winners.has(x)) grant(rec, x.holder, now, terms);
      else note(rec, now, "petition-failed", x.holder);
      decided.push({ holder: x.holder, kind: "petition", granted: winners.has(x) });
    }
  }
  save();
  return { decided, tie, scores: ctl.scores.map((x) => ({ type: x.type, id: x.id, score: x.score, extraction: x.extraction })) };
}

/** ISP-241 (AB#937): a system's open petitions and challenges (copies). */
export const petitionsIn = (systemId) => JSON.parse(JSON.stringify((store.systems[systemId]?.petitions || []).filter((p) => p.state === "open")));
/** ISP-241 (AB#937): a system's public register of concession events (a copy), oldest first. */
export const concessionRegister = (systemId) => JSON.parse(JSON.stringify(store.systems[systemId]?.register || []));

/** For tests: forget every concession (and optionally the file). */
export function resetConcessions({ removeFile = false } = {}) {
  store = { systems: {}, lastUpkeepDay: null };
  if (removeFile) fs.rmSync(FILE, { force: true });
}
