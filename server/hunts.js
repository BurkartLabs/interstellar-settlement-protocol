// server/hunts.js: hunting a belt's Rats (ISP-284, AB#991; docs/design/rats.md section 5).
//
// A player sends one of their fleets, stationed in a belt's system and free (the same eligibility as an escort), to
// fight that belt's Rat group. The fleet is committed for a standard expedition's length (an hour; the dev server's
// short runs use the same shape), and cannot escort, raid, deploy, split, merge or be offered until it is back. When the
// hunt is due, the combat resolver fights the fleet against the group at its base size (gathering is for expeditions
// that stay). The resolver has no chance in it, so the same fleet against the same group always ends the same way.
// - Win: the ISA pays a bounty of bountyPctOfValue% of the destroyed Rats' value (catalog credits plus goods at the NPC
//   bid, the value v0.10 uses for losses), through settleTransfer from its tap (tap:isa: a bounty creates credits, and
//   the tap counts them). The belt goes quiet for quietHours: expeditions launched there meet Rats at quietRateFactor of
//   the rate, for everyone, and there is no group to hunt until it regrows.
// - Draw or loss: no bounty, no quiet period; what the fleet lost is lost, from the fleet and the corporation.
// Provisions, escortCostPerSupplyHour per supply point for the hour, are paid at the start and destroyed (a sink).
// Everything is computed here, from the server's state: the request names a fleet and a belt, nothing else.
import { addAccountNotification, getAccountById, getState, mutateAccountState, mutateState } from "./gameState.js";
import { emitToAccount } from "./realtime.js";
import { applyCredits } from "./finances.js";
import { accountsStore } from "./game/store.js";
import { beltComposition, EXPEDITION_DURATIONS } from "./game/asteroids.js";
import { stationById } from "./game/stations.js";
import { combatModifiersFor } from "./game/combat.js";
import { SYSTEMS_BY_ID } from "./game/catalog.js";
import { RATS, fightEncounter, forceSupply, ratGroup } from "./game/rats.js";
import { unitsValue } from "./mercenaries.js";
import { settleTransfer } from "./settlement.js";
import { utcTime } from "../public/scripts/timeFormat.js";

const HOUR = 3_600_000;
/** At most this many hunts declared by one corporation in an hour (the acceptance's per-corporation limit). */
export const HUNT_RATE = Object.freeze({ max: 6, hours: 1 });
/** The ISA's bounty office pays from this tap. */
export const BOUNTY_TAP = "tap:isa";
/** A hunt keeps its fleet for a standard expedition's length, and provisions are paid on the design's hour. */
export const huntMs = () => EXPEDITION_DURATIONS.standard.ms;
const KEPT_REPORTS = 30;

const corpOf = (accountId) => getAccountById(accountId)?.state?.corp ?? null;
const unitsOf = (units) => Object.fromEntries(Object.entries(units || {}).filter(([, n]) => Number(n) > 0).map(([id, n]) => [id, Math.floor(Number(n))]));
const utc = (t) => utcTime(t, { withDate: true });

// ─── The quiet period ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The belt's quiet period, { until, byCorpId, huntId }, while it lasts; null once it has passed or never began. */
export function quietOf(beltKey, now = Date.now(), state = getState()) {
  const q = state?.rats?.quiet?.[beltKey];
  return q && Number(q.until) > now ? q : null;
}
/** What the belt's encounter rate is multiplied by now: quietRateFactor while it is quiet, otherwise 1. */
export function rateFactorFor(beltKey, now = Date.now(), state = getState()) {
  return quietOf(beltKey, now, state) ? RATS.quietRateFactor : 1;
}

// ─── Declaring a hunt ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Send `fleetId` to hunt `beltKey`: { ok: true, hunt } or { ok: false, status, error }, with nothing changed on a refusal.
 * Refused: an unknown belt (400), a fleet that is not the caller's (400, as the acceptance asks: nothing tells a caller
 * whether another corporation's fleet exists), a fleet that is busy or elsewhere, a quiet belt, too many hunts, or
 * provisions the corporation cannot pay.
 */
export function declareHunt(accountId, input = {}, now = Date.now()) {
  const beltKey = typeof input.beltKey === "string" ? input.beltKey.trim() : "";
  const fleetId = typeof input.fleetId === "string" ? input.fleetId : "";
  if (!beltKey || !beltComposition(beltKey)) return { ok: false, status: 400, error: "No such asteroid belt." };
  const systemId = beltKey.split(":")[0];
  const density = Number(SYSTEMS_BY_ID.get(systemId)?.pirateDensity);
  if (!Number.isFinite(density) || density < 0) return { ok: false, status: 400, error: "That belt has no danger reading, so there is nothing to hunt." };
  const group = ratGroup(density);
  if (!Object.values(group).some((n) => n > 0)) return { ok: false, status: 409, error: "No Rats gather in that belt." };

  const corp = corpOf(accountId);
  if (!corp) return { ok: false, status: 404, error: "No such corporation." };
  const peek = (corp.military?.fleets || []).find((f) => f.id === fleetId);
  if (!peek) return { ok: false, status: 400, error: "No such fleet of yours." };

  let result = null;
  mutateAccountState(accountId, (state) => {
    const c = state.corp;
    const fleet = (c.military?.fleets || []).find((f) => f.id === fleetId);
    if (!fleet) { result = { ok: false, status: 400, error: "No such fleet of yours." }; return; }
    if (fleet.contract) { result = { ok: false, status: 409, error: "That fleet is offered or hired out, and takes no order from you until its contract ends." }; return; }
    if (fleet.escort) { result = { ok: false, status: 409, error: "That fleet is escorting an expedition until it comes home." }; return; }
    if (fleet.hunt) { result = { ok: false, status: 409, error: "That fleet is already hunting." }; return; }
    if (fleet.transit && now < Number(fleet.transit.arrivesAt)) { result = { ok: false, status: 409, error: "That fleet is travelling." }; return; }
    if (stationById(fleet.stationId)?.systemId !== systemId) { result = { ok: false, status: 409, error: "A fleet hunts a belt in the system it is stationed in: deploy it there first." }; return; }
    const units = unitsOf(fleet.units);
    if (!forceSupply(units)) { result = { ok: false, status: 409, error: "That fleet has no ships to hunt with." }; return; }
    const quiet = quietOf(beltKey, now);
    if (quiet) { result = { ok: false, status: 409, error: `That belt's Rats were cleared; the group regrows at ${utc(quiet.until)}.` }; return; }
    const recent = [...(c.military.hunts || []), ...(c.military.fleets || []).filter((f) => f.hunt).map((f) => f.hunt)]
      .filter((h) => Number(h.declaredAt) > now - HUNT_RATE.hours * HOUR).length;
    if (recent >= HUNT_RATE.max) { result = { ok: false, status: 429, error: `At most ${HUNT_RATE.max} hunts may be declared in an hour.` }; return; }
    const provisions = Math.round(RATS.escortCostPerSupplyHour * forceSupply(units) * RATS.lengthsHours.standard);
    if ((Number(c.finances?.credits) || 0) < provisions) { result = { ok: false, status: 400, error: `The hunt's provisions cost ${provisions.toLocaleString("en-US")} credits.` }; return; }
    if (provisions) applyCredits(c, -provisions, "expeditions"); // provisions, as an escort's: a sink
    fleet.hunt = {
      id: `hunt-${now}-${Math.random().toString(36).slice(2, 8)}`, beltKey, systemId, density, rats: group,
      units, provisions, declaredAt: now, endsAt: now + huntMs()
    };
    result = { ok: true, hunt: { fleetId: fleet.id, ...fleet.hunt } };
  }, { sanitize: false, settleMining: false });
  return result || { ok: false, status: 404, error: "No such corporation." };
}

// ─── Resolving a hunt ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The fight and its money for a hunting fleet: { winner, lost, ratsDestroyedValue, bounty, lostValue }. Pure: the
 * resolver's result for these units against this group, with the corporation's combat modifiers.
 */
export function huntOutcome(units, group, modifiers = {}) {
  const fight = fightEncounter(units, group, modifiers);
  const won = fight.winner === "attacker";
  const ratsDestroyedValue = won ? unitsValue(group) : 0;
  return {
    winner: fight.winner, won, lost: fight.lost, lostValue: Math.round(unitsValue(fight.lost)),
    ratsDestroyedValue: Math.round(ratsDestroyedValue),
    bounty: won ? Math.round((ratsDestroyedValue * RATS.bountyPctOfValue) / 100) : 0,
    rounds: fight.rounds
  };
}

function tell(accountId, title, body) {
  const n = addAccountNotification(accountId, { type: "military", title, body });
  if (n) emitToAccount(accountId, "notifications:new", { accountId, notification: n });
}

/** Resolve one account's hunts that are due by `now`. Returns the reports filed. */
export function resolveHunts(accountId, now = Date.now()) {
  const corp = corpOf(accountId);
  const due = (corp?.military?.fleets || []).filter((f) => f.hunt && Number(f.hunt.endsAt) <= now).map((f) => f.id);
  const reports = [];
  for (const fleetId of due) {
    let report = null;
    mutateAccountState(accountId, (state) => {
      const c = state.corp;
      const fleet = (c.military?.fleets || []).find((f) => f.id === fleetId);
      const h = fleet?.hunt;
      if (!h || Number(h.endsAt) > now) return;
      // Another corporation's hunt won first and cleared the belt: this fleet finds nothing and comes home.
      const cleared = quietOf(h.beltKey, Number(h.endsAt));
      const outcome = cleared ? null : huntOutcome(h.units, h.rats, combatModifiersFor(c));
      if (outcome) {
        for (const [id, n] of Object.entries(outcome.lost)) { // real losses: the fleet's and the corporation's
          fleet.units[id] = Math.max(0, Number(fleet.units[id] || 0) - n);
          c.military.units[id] = Math.max(0, Number(c.military.units[id] || 0) - n);
        }
      }
      report = {
        id: h.id, fleetId, beltKey: h.beltKey, systemId: h.systemId, units: h.units, rats: h.rats, provisions: h.provisions,
        declaredAt: h.declaredAt, resolvedAt: now, outcome: cleared ? "already-cleared" : outcome.winner,
        lost: outcome?.lost ?? {}, lostValue: outcome?.lostValue ?? 0, ratsDestroyedValue: outcome?.ratsDestroyedValue ?? 0,
        bounty: outcome?.bounty ?? 0, quietUntil: outcome?.won ? now + RATS.quietHours * HOUR : null
      };
      if (!Array.isArray(c.military.hunts)) c.military.hunts = [];
      c.military.hunts.unshift(report);
      c.military.hunts = c.military.hunts.slice(0, KEPT_REPORTS);
      delete fleet.hunt; // back: free for other orders
    }, { sanitize: false, settleMining: false });
    if (!report) continue;
    if (report.bounty > 0) {
      const paid = settleTransfer({ fromAccountId: BOUNTY_TAP, toAccountId: accountId, credits: report.bounty, reason: "bounty", idempotencyKey: `hunt:${report.id}:bounty` }, now);
      if (!paid.ok) report.bountyError = paid.error;
    }
    if (report.quietUntil) {
      mutateState((draft) => {
        if (!draft.rats || typeof draft.rats !== "object") draft.rats = {};
        if (!draft.rats.quiet || typeof draft.rats.quiet !== "object") draft.rats.quiet = {};
        draft.rats.quiet[report.beltKey] = { until: report.quietUntil, byCorpId: corp?.publicId ?? null, huntId: report.id };
      });
    }
    const where = SYSTEMS_BY_ID.get(report.systemId)?.name || report.systemId;
    if (report.outcome === "attacker") tell(accountId, "Hunt won", `Your fleet cleared the Rats at ${where}. The ISA paid a bounty of ${report.bounty.toLocaleString("en-US")} credits, and the belt is quiet until ${utc(report.quietUntil)}.`);
    else if (report.outcome === "already-cleared") tell(accountId, "Hunt found nothing", `Another corporation had already cleared the Rats at ${where}. Your fleet is back.`);
    else tell(accountId, report.outcome === "draw" ? "Hunt broke off" : "Hunt lost", `Your fleet did not clear the Rats at ${where}. No bounty is paid, and the belt is not quiet.`);
    reports.push(report);
  }
  return reports;
}

/**
 * The ticker: every account's due hunts. It looks through the store itself, not getAccountById, which settles and
 * copies each account it reads (Bug AB#4649): only an account with a hunt due is touched.
 */
export function huntTick(now = Date.now()) {
  for (const [accountId, account] of Object.entries(accountsStore.accounts || {})) {
    const fleets = account?.state?.corp?.military?.fleets || [];
    if (fleets.some((f) => f.hunt && Number(f.hunt.endsAt) <= now)) resolveHunts(accountId, now);
  }
}
