// server/routes/research.js: the research routes, split out of server/index.js (AB#1815).
import { isInsightProgramLive } from "../../public/scripts/ceoEffects.js";
import { addAccountNotification, mutateAccountState, CEO_INSIGHT_LIBRARY, RESEARCH_LIBRARY } from "../gameState.js";
// The R&D schedule lives in public/scripts/rndQueue.js, which the R&D panel reads too; imported here beside its use
// (Bug #1258), away from the import block other branches edit.
import { nextRndStart } from "../../public/scripts/rndQueue.js"; // Bug #1258
import { applyCredits } from "../finances.js";
import { IS_DEV } from "../app.js";
import { emitToAccount } from "../realtime.js";
import { fundingRequirementMessage } from "./helpers.js";
import { queueInsightReceipt, queueResearchReceipt } from "../receipts.js"; // AB#744
import { royaltyFor } from "../patents.js"; // Bug #4857
import { rndItemEndsAt } from "../../public/scripts/rndQueue.js"; // AB#744: the same end the R&D panel shows
import { formatHoursMinutes, rndQueueRoom } from "../../public/scripts/rndQueue.js"; // AB#2476: the same limit the R&D panel shows

// AB#1049: RESEARCH_LIBRARY is imported from gameState.js now — data/research.json is the only definition,
// keyed by id in server/game/catalog.js. GET /api/research (below) is how the client gets the same tree.
const TIER_1_TECH_IDS = Object.values(RESEARCH_LIBRARY).filter((t) => t.tier === 1).map((t) => t.id);

export function registerResearchRoutes(app) {
  app.post("/api/accounts/:accountId/gameplay/queue-rnd", (req, res) => {
    const techId = String(req.body?.techId || "").trim();
    const tech = RESEARCH_LIBRARY[techId];
    let outcome = "ok";
    let room = null; // AB#2476: why the queue is full, and when a place opens

    if (!tech) {
      res.status(400).json({ error: "Unknown research node." });
      return;
    }
    // AB#861: a planned node unlocks something no route builds yet (v0.10's units), so it is shown and not sold
    if (tech.status === "planned") {
      res.status(400).json({ error: `${tech.name} is not available yet: what it unlocks is planned for a later version.` });
      return;
    }

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;
      const queue = state.queues?.corporateRnD || [];
      const unlocked = new Set(corp.unlockedTech || []);
      const queued = new Set(queue.map((item) => item.techId).filter(Boolean));

      if (unlocked.has(tech.id)) {
        outcome = "already-unlocked";
        return;
      }

      if (queued.has(tech.id)) {
        outcome = "already-queued";
        return;
      }

      if (!tech.prereqs.every((prereq) => unlocked.has(prereq))) {
        outcome = "missing-prereq";
        return;
      }

      // Corp level gate for certain research
      if (tech.requiresCorpLevel && (corp.level || 0) < tech.requiresCorpLevel) {
        outcome = "corp-level-too-low";
        return;
      }

      // Tier 2+ requires all Tier 1 research to be completed
      if (tech.tier >= 2 && !TIER_1_TECH_IDS.every((id) => unlocked.has(id))) {
        outcome = "tier-gate";
        return;
      }

      // AB#2476 (Board review item 23): the one in progress and one behind it; nothing is charged for a refusal
      room = rndQueueRoom(queue, Date.now());
      if (!room.ok) {
        outcome = "queue-full";
        return;
      }

      if (corp.finances.credits < tech.costCredits) {
        outcome = "insufficient-credits";
        return;
      }

      applyCredits(corp, -tech.costCredits, "research");
      state.queues.corporateRnD.push({
        id: `rnd-${Date.now()}`,
        techId: tech.id,
        name: tech.name,
        effect: tech.effect,
        durationHours: IS_DEV ? 0 : tech.durationHours,
        startedAt: nextRndStart(state.queues.corporateRnD, Date.now()), // after the item ahead finishes (Bug #1258)
        costCredits: tech.costCredits
      });
    });

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    if (outcome !== "ok") {
      const corp = account.state.corp;
      const messageMap = {
        "already-unlocked": `${tech.name} has already been completed.`,
        "already-queued": `${tech.name} is already in the corporate R&D queue.`,
        "missing-prereq": `${tech.name} requires: ${tech.prereqs.map((id) => RESEARCH_LIBRARY[id]?.name || id).join(", ")}.`,
        "corp-level-too-low": `${tech.name} requires Corp Level ${tech.requiresCorpLevel}.`,
        "tier-gate": `${tech.name} is Tier ${tech.tier} research. All Tier 1 research must be completed first.`,
        // Bug #4807 (ISP-6's rule): and how to raise it
        "insufficient-credits": fundingRequirementMessage(`${tech.name} queueing`, corp, tech.costCredits, "Sell goods or finish an assignment to raise the credits, then queue it again."),
        "queue-full": `Corporate R&D runs one technology and holds one more behind it. ${tech.name} can be queued once ${room?.finishing?.name || "the research ahead"} finishes, in ${formatHoursMinutes((room?.freesAt || 0) - Date.now())}.`
      };
      res.status(400).json({ error: messageMap[outcome] || "Unable to queue research." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "research",
      title: "R&D Queued",
      body: `${tech.name} has been queued in corporate research.`,
      protocol: { meaning: "queued", screen: "rnd" } // ISP-254 (AB#950)
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    // AB#744: the item the mutation queued, scheduled behind whatever was ahead of it.
    const queuedItem = [...(account.state.queues?.corporateRnD || [])].reverse().find((q) => q.techId === tech.id);
    // Bug #4857: the royalty the R&D tick will charge when this completes (server/patents.js recordResearchUse): the
    // patent in force at completion, on the node's research cost
    const endsAt = rndItemEndsAt(queuedItem);
    const { patent, royalty } = royaltyFor(account.state.corp, { kind: "research", subjectId: tech.id, at: endsAt, base: Number(tech.costCredits) || 0 });
    const receipt = queueResearchReceipt({
      name: tech.name,
      cost: queuedItem?.costCredits ?? tech.costCredits,
      startsAt: queuedItem?.startedAt,
      endsAt,
      now: Date.now(),
      royalty: patent ? { amount: royalty, ratePct: patent.ratePct, holder: patent.holder.name } : null
    });
    res.json({ ...account, receipt });
  });

  // ─── CEO Insight ─────────────────────────────────────────────────────────────

  app.post("/api/accounts/:accountId/gameplay/queue-ceo", (req, res) => {
    const programId = String(req.body?.programId || "").trim();
    const prog = CEO_INSIGHT_LIBRARY[programId];
    let outcome = "ok";

    if (!prog) {
      res.status(400).json({ error: "Unknown insight program." });
      return;
    }

    // Bug #983: a planned program has no effect in the game yet, so it is not sold.
    if (!isInsightProgramLive(prog)) {
      res.status(400).json({ error: `${prog.name} is not available yet: its effect is planned for a later version.` });
      return;
    }

    const account = mutateAccountState(req.params.accountId, (state) => {
      const corp = state.corp;
      const queue = state.queues?.ceoInsight || [];
      const completed = corp.completedInsights || [];

      // Only one CEO Insight program can be in progress at a time
      if (queue.length > 0) {
        outcome = "queue-full";
        return;
      }

      // For multi-level programs, count completions towards max
      const completionCount = completed.filter((id) => id === prog.id).length;
      const maxLevels = prog.maxLevels || 1;

      if (completionCount >= maxLevels) {
        outcome = "max-level";
        return;
      }

      if (!prog.prereqs.every((prereq) => completed.includes(prereq))) {
        outcome = "missing-prereq";
        return;
      }

      if (corp.finances.credits < prog.costCredits) {
        outcome = "insufficient-credits";
        return;
      }

      applyCredits(corp, -prog.costCredits, "ceo-insight");
      state.queues.ceoInsight.push({
        id: `ceo-${Date.now()}`,
        programId: prog.id,
        name: prog.name,
        effect: prog.effect,
        durationHours: IS_DEV ? 0 : prog.durationHours,
        startedAt: Date.now(),
        costCredits: prog.costCredits
      });
    });

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    if (outcome !== "ok") {
      const corp = account.state.corp;
      const messageMap = {
        "max-level": `${prog.name} is already at maximum level.`,
        "queue-full": "Only one CEO Insight program can be in progress at a time.",
        "missing-prereq": `${prog.name} requires: ${prog.prereqs.map((id) => CEO_INSIGHT_LIBRARY[id]?.name || id).join(", ")}.`,
        "insufficient-credits": fundingRequirementMessage(`${prog.name} enrollment`, corp, prog.costCredits)
      };
      res.status(400).json({ error: messageMap[outcome] || "Unable to enqueue insight program." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "insight",
      title: "CEO Insight Queued",
      body: `${prog.name} has been enrolled in the CEO Insight Program.`
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    // AB#744: the program the mutation enrolled.
    const enrolled = [...(account.state.queues?.ceoInsight || [])].reverse().find((q) => q.programId === prog.id);
    const receipt = queueInsightReceipt({
      name: prog.name,
      cost: enrolled?.costCredits ?? prog.costCredits,
      endsAt: Number(enrolled?.startedAt || Date.now()) + Number(enrolled?.durationHours || 0) * 3_600_000
    });
    res.json({ ...account, receipt });
  });
}
