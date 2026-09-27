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
import { accountByCorp, findConglomerate, roleOf } from "./game/membership.js";
import { currentConglomerateOf } from "./game/intel.js";
import { moveTreasury, settleTreasury } from "./game/conglomerates.js";
import { can } from "./conglomerates.js";
import { settleTransfer } from "./settlement.js";
import { WARFARE_CATALOG, concessionTermsFor } from "./warfare.js";
import { controlNow } from "./controlService.js";

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
    const due = rec.petitions.filter((p) => p.state === "open" && p.reviewEndsAt <= now);
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
    holders: (rec?.holders || []).map((h) => ({ holder: { type: h.holder.type, id: h.holder.id, name: h.holder.name }, state: h.state, grantedAt: h.grantedAt, termEndsAt: h.termEndsAt, benefits: h.state === "granted" })),
    petitions: (rec?.petitions || []).filter((p) => p.state === "open").map(publicPetition),
    register: [...(rec?.register || [])].reverse()
  };
}

/** For AB#923: whether a holder's concession in a system is in force now (granted, not in grace). */
export function concessionInForce(systemId, holder) {
  return Boolean(store.systems[systemId]?.holders.some((h) => keyOf(h.holder) === keyOf(holder) && h.state === "granted"));
}

/** For tests: forget every concession (and optionally the file). */
export function resetConcessions({ removeFile = false } = {}) {
  store = { systems: {}, lastUpkeepDay: null };
  if (removeFile) fs.rmSync(FILE, { force: true });
}
