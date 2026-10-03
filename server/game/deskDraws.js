// server/game/deskDraws.js: which Desk packets a corporation has open, and the packet each one is (AB#4689 slice 5,
// docs/design/desk-work.md section 3). Nothing secret is stored: every response carries the whole account state to the
// browser, so a packet's key never lives in it. A corporation's state holds only its open draws ({ draw, kind, tier })
// and a counter; the packet and its key are drawn again from an HMAC of the server's secret and the draw, the way the
// Rats' encounters are (rats.js seedFor), and a player cannot compute them. The packet's fingerprint, sent with it, lets
// an answer be refused when the world under it moved (a belt mined out between reading and answering).

import crypto from "node:crypto";
import { ECONOMY } from "../economy.js";
import { deskRng, generateAudit, generateDispatch, generateSurvey, gradeAudit, gradeDispatch, gradeSurvey } from "./desk.js";
import { SYSTEMS_DATA } from "./catalog.js";
import { isBeltPresent, recordBeltScouted } from "./belts.js";

export const DESK_KINDS = Object.freeze(["survey", "audit", "dispatch"]);
const GENERATE = { survey: generateSurvey, audit: generateAudit, dispatch: generateDispatch };
const GRADE = { survey: gradeSurvey, audit: gradeAudit, dispatch: gradeDispatch };

/** The seed for an account's nth draw: an HMAC of the server's secret. Throws without a secret (fails closed). */
export function deskSeed(accountId, draw, secret = process.env.ISP_DESK_SEED_SECRET || process.env.JWT_SECRET) {
  if (typeof secret !== "string" || secret.length < 16) throw new Error("the Desk's seed needs a server secret");
  return crypto.createHmac("sha256", secret).update(`desk:${accountId}:${draw}`).digest("hex");
}

/** What the nth draw is: its kind, from its seed, and its tier. Slice 8 opens tiers 2 and 3 by grade; until then, 1. */
export function drawEntry(accountId, draw, secret) {
  const rng = deskRng(`kind:${deskSeed(accountId, draw, secret)}`);
  return { draw, kind: DESK_KINDS[Math.floor(rng() * DESK_KINDS.length)], tier: 1 };
}

/**
 * The open draws and the next draw number, as stored or, for a corporation that has never opened the Desk, as they
 * would be (draws 1 to openPackets; draw numbers start at 1). Reading this writes nothing, so GET /desk stays a pure read.
 */
export function deskState(corp, accountId, secret, rules = ECONOMY.desk) {
  const stored = corp?.desk;
  if (stored && Array.isArray(stored.open) && Number.isInteger(stored.next)) return stored;
  return { next: rules.openPackets + 1, open: Array.from({ length: rules.openPackets }, (_, i) => drawEntry(accountId, i + 1, secret)), paidDay: 0, paidToday: 0 };
}

/** A packet's fingerprint: what the client was shown, hashed, so an answer to a packet that has since changed is refused. */
export const fingerprintOf = (packet) => crypto.createHash("sha256").update(JSON.stringify(packet)).digest("hex").slice(0, 24);

/**
 * The packet an open draw is now: { packet, key, fingerprint }, or null if it cannot be drawn. A Survey with nothing to
 * survey falls back to an Audit, which always draws.
 */
export function openPacket(accountId, entry, { corp, belts }, secret) {
  const seed = deskSeed(accountId, entry.draw, secret);
  const drawn = GENERATE[entry.kind]?.({ seed, tier: entry.tier, corp, belts }) || generateAudit({ seed, tier: entry.tier });
  return drawn ? { ...drawn, fingerprint: fingerprintOf(drawn.packet) } : null;
}

/** Grade an answer against a key of any kind; fails closed. */
export function gradeDeskAnswer(key, answer) {
  return GRADE[key?.kind]?.(key, answer) || { correct: false, explanation: "" };
}

/** What a correct answer pays: its tier's fee, or overCapPayPct of it once paidAssignmentsPerDay have been paid today. */
export function deskPay(tier, paidToday, rules = ECONOMY.desk) {
  const fee = rules.payByTier[tier - 1];
  return paidToday < rules.paidAssignmentsPerDay ? fee : Math.round((fee * rules.overCapPayPct) / 100);
}

/**
 * AB#4689 slice 6 (design section 5, the Survey table, and the Board's decision 5): what a correct Survey publishes, to
 * this corporation only. Tier 2 and 3 surveys of a belt mark it scouted for its current generation, in
 * asteroidMining.scoutedBelts, the field a probe writes (so conglomerate intel shares it as it shares a probe's); a belt
 * that respawned since the packet was drawn is not the belt surveyed, and is not marked. A survey of a lease body stores
 * what it learned in corp.surveys: the dominant resource at tier 1, the whole profile from tier 2. Returns what was
 * published, or null. Called only for a correct answer: a wrong one publishes nothing.
 */
export function applySurveyPayoff(corp, key, belts, now = Date.now()) {
  if (key?.kind !== "survey" || !key.subject) return null;
  const s = key.subject;
  const where = `${s.systemId}:${s.bodyId}`;
  if (s.beltKey) {
    const belt = belts?.[s.beltKey];
    if (!isBeltPresent(belt) || belt.generation !== s.generation) return null;
    if (key.tier >= 2) {
      if (!corp.asteroidMining || typeof corp.asteroidMining !== "object") corp.asteroidMining = {};
      recordBeltScouted(corp.asteroidMining, belt);
      return { beltKey: s.beltKey, scouted: true, generation: belt.generation };
    }
    corp.surveys = { ...(corp.surveys || {}), [where]: { tier: key.tier, generation: belt.generation, dominant: key.truth[0].resource, at: now } };
    return { beltKey: s.beltKey, dominant: key.truth[0].resource };
  }
  const body = SYSTEMS_DATA.find((sys) => sys.id === s.systemId)?.bodies?.find((b) => b.id === s.bodyId);
  if (!(Number(body?.leaseCost) > 0)) return null;
  const record = key.tier === 1
    ? { tier: 1, dominant: key.truth[0].resource, at: now }
    : { tier: key.tier, profile: (body.resourceProfile || []).map((p) => ({ item: p.item, concentration: p.concentration })), at: now };
  // A body's profile does not change, so a tier-1 survey after a fuller one learns nothing to keep.
  if (corp.surveys?.[where]?.profile && !record.profile) return { body: where, ...corp.surveys[where] };
  corp.surveys = { ...(corp.surveys || {}), [where]: record };
  return { body: where, ...record };
}
