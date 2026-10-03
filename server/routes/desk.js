// server/routes/desk.js: the Desk on the Assignments tab (AB#4689 slice 5, docs/design/desk-work.md section 3). Three
// packets are always open; answering one grades it on the server and pays through applyCredits under `desk`, declining
// one is free, and either draws the next. Packets and their keys are drawn from a server secret and never stored
// (server/game/deskDraws.js), so nothing in a request or in the state the client holds can set the truth or the grade.
import { ECONOMY } from "../economy.js";
import { applyCredits, utcDayStart } from "../finances.js";
import { bodyCount } from "../bodyNumber.js";
import { getState, mutateAccountState, peekCorp, REPUTATION_TIERS_DATA } from "../gameState.js";
import { bumpStat } from "../game/progression.js";
import { applySurveyPayoff, deskPay, deskState, drawEntry, gradeDeskAnswer, openPacket } from "../game/deskDraws.js";
import { standingFor } from "../receipts.js";
import { hasActiveOffice } from "../../public/scripts/officeStatus.js";
import { ASSIGNED_COORDINATOR } from "../../public/scripts/liaison.js";
import { addStandingPoints, migrateStanding } from "../../public/scripts/bureauStanding.js";
import { standingGain } from "../../public/scripts/ceoEffects.js";

const NO_OFFICE = "The Desk takes work from registered corporations only. Rent an office at any station's Orbital Executive Suites first.";
const NO_SEED = "The Desk is closed: the server has no secret to draw packets with.";
const MAX_ANSWER_LENGTH = 4000;

/** Today's paid count, as of `now`: a count from an earlier UTC day is 0. */
const paidTodayOf = (desk, now) => (Number(desk.paidDay) === utcDayStart(now) ? Number(desk.paidToday) || 0 : 0);

export function registerDeskRoutes(app) {
  app.get("/api/accounts/:accountId/gameplay/desk", (req, res) => {
    const { accountId } = req.params;
    const corp = peekCorp(accountId);
    if (!corp) return res.status(404).json({ error: "Account not found." });
    if (!hasActiveOffice(corp)) return res.status(400).json({ error: NO_OFFICE, code: "no-office" });
    let packets;
    try {
      const desk = deskState(corp, accountId);
      packets = desk.open.map((entry) => {
        const open = openPacket(accountId, entry, { corp, belts: getState().belts });
        return { draw: entry.draw, fingerprint: open.fingerprint, packet: open.packet };
      });
    } catch {
      return res.status(503).json({ error: NO_SEED, code: "no-seed" });
    }
    const points = migrateStanding(corp.agentReputation?.[ASSIGNED_COORDINATOR.id], ECONOMY.desk.reputationThresholdMultiplier).points;
    const now = Date.now();
    res.json({
      packets,
      standing: { points, ...standingFor(points, REPUTATION_TIERS_DATA) },
      paidToday: paidTodayOf(corp.desk || {}, now),
      paidAssignmentsPerDay: ECONOMY.desk.paidAssignmentsPerDay
    });
  });

  app.post("/api/accounts/:accountId/gameplay/desk/answer", (req, res) => {
    const { accountId } = req.params;
    const draw = bodyCount(req.body?.draw); // Bug #1014: a whole draw number, or null (no packet)
    const fingerprint = String(req.body?.fingerprint || "");
    const answer = req.body?.answer;
    if (!answer || typeof answer !== "object" || Array.isArray(answer) || JSON.stringify(answer).length > MAX_ANSWER_LENGTH) {
      return res.status(400).json({ error: "Enter your answer to the packet." });
    }
    let outcome = "ok";
    let result = null;
    const account = mutateAccountState(accountId, (state) => {
      const corp = state.corp;
      const now = Date.now();
      if (!hasActiveOffice(corp, now)) { outcome = "no-office"; return; }
      let desk, open;
      try {
        desk = deskState(corp, accountId);
        const entry = desk.open.find((e) => e.draw === draw);
        if (!entry) { outcome = "not-open"; return; }
        open = openPacket(accountId, entry, { corp, belts: getState().belts });
      } catch { outcome = "no-seed"; return; }
      if (open.fingerprint !== fingerprint) { outcome = "changed"; return; }
      // Graded against the key drawn here, never anything in the request but the answer itself (T-019).
      const graded = gradeDeskAnswer(open.key, answer);
      const day = utcDayStart(now);
      const paidToday = paidTodayOf(desk, now);
      let paid = 0, points = 0, published = null;
      if (graded.correct) {
        // Slice 6: what a correct Survey learned is this corporation's (a belt scouted, a body's profile). A wrong one publishes nothing.
        published = applySurveyPayoff(corp, open.key, getState().belts, now);
        paid = deskPay(open.key.tier, paidToday);
        applyCredits(corp, paid, "desk", now);
        const rep = migrateStanding(corp.agentReputation?.[ASSIGNED_COORDINATOR.id], ECONOMY.desk.reputationThresholdMultiplier);
        corp.agentReputation = { ...(corp.agentReputation || {}), [ASSIGNED_COORDINATOR.id]: rep };
        points = addStandingPoints(rep, standingGain(ECONOMY.desk.pointsByTier[open.key.tier - 1], corp.completedInsights));
        // Rule 7: desk work has its own counters, never a contract's (completedMissions, missionsCompletedTotal).
        bumpStat(corp, "deskCompleted", 1);
        bumpStat(corp, `deskCompleted:${open.key.kind}`, 1);
      }
      // Right or wrong, the packet is spent and the next is drawn: always openPackets open.
      corp.desk = {
        next: desk.next + 1,
        open: desk.open.map((e) => (e.draw === draw ? drawEntry(accountId, desk.next) : e)),
        paidDay: day,
        paidToday: paidToday + (graded.correct ? 1 : 0)
      };
      const total = migrateStanding(corp.agentReputation?.[ASSIGNED_COORDINATOR.id], ECONOMY.desk.reputationThresholdMultiplier).points;
      result = { correct: graded.correct, explanation: graded.explanation, paid, points, kind: open.key.kind, published, standing: { points: total, ...standingFor(total, REPUTATION_TIERS_DATA) } };
    });
    if (!account) return res.status(404).json({ error: "Account not found." });
    if (outcome === "no-office") return res.status(400).json({ error: NO_OFFICE, code: "no-office" });
    if (outcome === "no-seed") return res.status(503).json({ error: NO_SEED, code: "no-seed" });
    if (outcome === "not-open") return res.status(400).json({ error: "That packet is no longer on the Desk. Open one of the three on it now.", code: "not-open" });
    if (outcome === "changed") return res.status(409).json({ error: "That packet's records changed while it was open. Open it again to see them as they stand.", code: "changed" });
    res.json({ ...account, result });
  });

  app.post("/api/accounts/:accountId/gameplay/desk/decline", (req, res) => {
    const { accountId } = req.params;
    const draw = bodyCount(req.body?.draw); // Bug #1014: a whole draw number, or null (no packet)
    let outcome = "ok";
    const account = mutateAccountState(accountId, (state) => {
      const corp = state.corp;
      if (!hasActiveOffice(corp)) { outcome = "no-office"; return; }
      let desk;
      try { desk = deskState(corp, accountId); } catch { outcome = "no-seed"; return; }
      if (!desk.open.some((e) => e.draw === draw)) { outcome = "not-open"; return; }
      try {
        corp.desk = { ...desk, next: desk.next + 1, open: desk.open.map((e) => (e.draw === draw ? drawEntry(accountId, desk.next) : e)) };
      } catch { outcome = "no-seed"; }
    });
    if (!account) return res.status(404).json({ error: "Account not found." });
    if (outcome === "no-office") return res.status(400).json({ error: NO_OFFICE, code: "no-office" });
    if (outcome === "no-seed") return res.status(503).json({ error: NO_SEED, code: "no-seed" });
    if (outcome === "not-open") return res.status(400).json({ error: "That packet is no longer on the Desk. Open one of the three on it now.", code: "not-open" });
    res.json(account);
  });
}
