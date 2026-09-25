// server/routes/missions.js: the missions routes, split out of server/index.js (AB#1815).
import { missionRewardCredits } from "../../public/scripts/ceoEffects.js";
import { ECONOMY } from "../economy.js";
import {
  mutateAccountState,
  MISSION_TEMPLATES,
  refreshContractOfferings,
  COMPLETED_COOLDOWN_MS // Bug #1268
} from "../gameState.js";
import { applyCredits } from "../finances.js";
// Bug #1058: refusals that say what to do next. Imported beside their first use, away from the import block.
import { missionShortMessage } from "../nextStep.js";
import { STATIONS_DATA } from "../travel.js";

export function registerMissionRoutes(app) {
  // ── Mission contract endpoints ──────────────────────────────

  app.post("/api/accounts/:accountId/gameplay/accept-mission", (req, res) => {
    const missionId = String(req.body?.missionId || "").trim();
    if (!missionId) return res.status(400).json({ error: "Missing missionId." });

    let outcome = "ok";
    let refusalHours = 2;
    const account = mutateAccountState(req.params.accountId, (state) => {
      if (!Array.isArray(state.corp.activeMissions)) state.corp.activeMissions = [];
      if (state.corp.activeMissions.some((m) => m.id === missionId)) { outcome = "already-active"; return; }

      // Bug #1268: only a contract the Bureau is offering this corporation now can be accepted. A fallback to the whole
      // template pool let any contract be taken, all ten at once, and one completed a moment ago taken again, past the
      // offerings (two at a time, refreshed every 2 hours) and the 4-hour cooldown that refreshContractOfferings applies.
      const offerings = refreshContractOfferings(state.corp);
      const mission = offerings.missions.find((m) => m.id === missionId);
      if (!mission) {
        if (!MISSION_TEMPLATES.some((m) => m.id === missionId)) { outcome = "not-found"; return; }
        const done = (state.corp.completedMissions || []).find((m) => m.id === missionId);
        outcome = done && Date.now() - Number(done.completedAt || 0) < COMPLETED_COOLDOWN_MS ? "cooling-down" : "not-offered";
        refusalHours = Math.max(1, Math.ceil((offerings.nextRefreshAt - Date.now()) / 3_600_000));
        return;
      }
      // ISP-297 (AB#1789): acceptedAt is what a time-served contract (the Salvage Assignment) measures completion
      // against; harmless to record on every mission, so one route sets it rather than branching on kind here.
      state.corp.activeMissions.push({ ...mission, acceptedAt: Date.now() });
      // Remove from current offerings so it can't be double-accepted
      offerings.missions = offerings.missions.filter((m) => m.id !== missionId);
    });

    if (!account) return res.status(404).json({ error: "Account not found." });
    if (outcome === "not-found") return res.status(400).json({ error: "Mission not found in current offerings." });
    const nextOffers = `New contracts are offered in about ${refusalHours} hour${refusalHours === 1 ? "" : "s"}.`;
    if (outcome === "not-offered") {
      return res.status(400).json({ error: `That contract is not on offer to you. Accept one of the contracts listed in the agent's office on Assignments. ${nextOffers}` });
    }
    if (outcome === "cooling-down") {
      return res.status(400).json({ error: `You completed that contract recently; it can be offered to you again 4 hours after completion. Accept one of the contracts listed in the agent's office on Assignments. ${nextOffers}` });
    }
    if (outcome === "already-active") return res.status(400).json({ error: "Mission already accepted." });
    res.json(account);
  });

  app.post("/api/accounts/:accountId/gameplay/abandon-mission", (req, res) => {
    const missionId = String(req.body?.missionId || "").trim();
    if (!missionId) return res.status(400).json({ error: "Missing missionId." });

    const account = mutateAccountState(req.params.accountId, (state) => {
      if (!Array.isArray(state.corp.activeMissions)) state.corp.activeMissions = [];
      state.corp.activeMissions = state.corp.activeMissions.filter((m) => m.id !== missionId);
    });

    if (!account) return res.status(404).json({ error: "Account not found." });
    res.json(account);
  });

  app.post("/api/accounts/:accountId/gameplay/complete-mission", (req, res) => {
    const missionId = String(req.body?.missionId || "").trim();
    if (!missionId) return res.status(400).json({ error: "Missing missionId." });

    let outcome = "ok";
    let shortfall = null;
    let hoursRemaining = null;
    const account = mutateAccountState(req.params.accountId, (state) => {
      if (!Array.isArray(state.corp.activeMissions)) state.corp.activeMissions = [];
      const mission = state.corp.activeMissions.find((m) => m.id === missionId);
      if (!mission) { outcome = "not-active"; return; }

      if (mission.kind === "time-served") {
        // ISP-297 (AB#1789): the Salvage Assignment — paid in time served, not a delivered quota (ECONOMY.md "The
        // way back from broke"). Flat payout, unmodified by missionRewardCredits' Contract Law Essentials bonus:
        // the design is explicit that nothing a player can research or set changes what it pays (T-018).
        const requiredMs = Number(mission.hoursRequired || 0) * 3_600_000;
        const elapsedMs = Date.now() - Number(mission.acceptedAt || 0);
        if (elapsedMs < requiredMs) {
          outcome = "too-soon";
          hoursRemaining = Math.max(1, Math.ceil((requiredMs - elapsedMs) / 3_600_000));
          return;
        }
        applyCredits(state.corp, ECONOMY.salvage.payoutCredits, "salvage");
      } else {
        if (!mission.quota) { outcome = "no-quota"; return; }

        const stationId = state.corp.currentStationId || "earth-station-prime";
        if (!state.corp.inventory) state.corp.inventory = {};
        if (!state.corp.inventory[stationId]) state.corp.inventory[stationId] = {};
        const stationInv = state.corp.inventory[stationId];

        const resource = mission.quota.resource || "";
        const required = mission.quota.amount || 0;
        const have = stationInv[resource] || 0;
        if (have < required) { outcome = "insufficient"; shortfall = { resource, required, stationId }; return; }

        // Deduct resources
        stationInv[resource] = have - required;
        if (stationInv[resource] <= 0) delete stationInv[resource];

        // Credit reward into the balance the player spends, and book it as income (Bug #1009: it went to
        // corp.credits, which nothing reads). Contract Law Essentials adds 8%.
        const rewardCredits = missionRewardCredits(mission.reward, state.corp.completedInsights);
        if (rewardCredits) {
          applyCredits(state.corp, rewardCredits, "missions");
        }
      }

      // Remove from active
      state.corp.activeMissions = state.corp.activeMissions.filter((m) => m.id !== missionId);

      // Remove from current offerings so it doesn't reappear until next rotation
      if (state.corp.contractOfferings && Array.isArray(state.corp.contractOfferings.missions)) {
        state.corp.contractOfferings.missions = state.corp.contractOfferings.missions.filter((m) => m.id !== missionId);
      }

      // Record completion
      if (!Array.isArray(state.corp.completedMissions)) state.corp.completedMissions = [];
      state.corp.completedMissions.unshift({
        id: mission.id,
        title: mission.title,
        type: mission.type,
        agentId: mission.agentId || null,
        reward: mission.reward,
        completedAt: Date.now()
      });
      state.corp.completedMissions = state.corp.completedMissions.slice(0, 200);

      // Update agent reputation
      if (!state.corp.agentReputation || typeof state.corp.agentReputation !== "object") state.corp.agentReputation = {};
      const agentId = mission.agentId || "unknown";
      if (!state.corp.agentReputation[agentId]) state.corp.agentReputation[agentId] = { completedCount: 0 };
      state.corp.agentReputation[agentId].completedCount += 1;
    });

    if (!account) return res.status(404).json({ error: "Account not found." });
    if (outcome === "not-active") return res.status(400).json({ error: "Mission is not active." });
    if (outcome === "no-quota") return res.status(400).json({ error: "Mission has no quota to complete." });
    if (outcome === "too-soon") {
      return res.status(400).json({ error: `Salvage work is not finished yet. ${hoursRemaining} hour${hoursRemaining === 1 ? "" : "s"} remaining.` });
    }
    if (outcome === "insufficient") {
      const stationName = (id) => STATIONS_DATA.stations.find((st) => st.id === id)?.name || id;
      return res.status(400).json({ error: missionShortMessage({ ...shortfall, inventory: account.state.corp.inventory, stationName }) });
    }
    res.json(account);
  });
}
