// server/routes/training.js: troop training at Headquarters (ISP-172, AB#866). The rules are server/training.js and
// server/production.js; these routes say what happened. The input check (server/gameplayInput.js) has already refused a
// unit that is not a troop, a quantity that is not a whole number in range, and a job id of the wrong shape.
import { addAccountNotification, mutateAccountState, saveAccountsNow, RESEARCH_LIBRARY } from "../gameState.js";
import { STATION_REGISTRY } from "../travel.js";
import { emitToAccount } from "../realtime.js";
import { fundingRequirementMessage } from "./helpers.js";
import { MAX_JOB_QUANTITY, MAX_QUEUED_JOBS, cancelTroopJob, queueTroops } from "../training.js";
import { UNITS } from "../game/units.js";
import { bodyNumber } from "../bodyNumber.js"; // Bug #1014: the one way a route reads a body number
import { troopCancelReceipt, troopTrainingReceipt } from "../receipts.js";

/** "1 squad of Attack Troops", "3 squads of Defense Troops": a troop unit is a squad. */
const squads = (n, unit) => `${n} squad${n === 1 ? "" : "s"} of ${unit.name}`;

function refusal(result, corp, unitId, quantity) {
  const unit = UNITS[unitId];
  switch (result.outcome) {
    case "not-a-troop": return "Choose troops to train: Attack Troops or Defense Troops.";
    case "bad-quantity": return `Choose a number of squads from 1 to ${MAX_JOB_QUANTITY}.`;
    case "no-headquarters": return "Troops train at your corporation's Headquarters, and it has none.";
    case "missing-research": return `${unit.name} need ${RESEARCH_LIBRARY[result.research]?.name || result.research} research.`;
    case "queue-full": return `Headquarters trains ${MAX_QUEUED_JOBS} jobs at most. Wait for one to finish, or cancel one.`;
    case "insufficient-credits": return fundingRequirementMessage(squads(quantity, unit), corp, result.cost.credits);
    case "insufficient-goods": return `${squads(quantity, unit)} need ${result.needed.toLocaleString("en-US")} ${result.item} at ${STATION_REGISTRY[result.stationId]?.name || "your station"}; it holds ${result.have.toLocaleString("en-US")}.`;
    default: return "Headquarters could not train that.";
  }
}

export function registerTrainingRoutes(app) {
  // The client names the troops and how many squads, nothing else: the cost and the time are the catalog's.
  app.post("/api/accounts/:accountId/gameplay/training/queue", (req, res) => {
    const unitId = String(req.body?.unitId || "");
    const quantity = bodyNumber(req.body?.quantity, { fallback: 0 }); // the input check has held it to 1..100
    let result = { outcome: "not-a-troop" };
    const account = mutateAccountState(req.params.accountId, (state) => { result = queueTroops(state.corp, unitId, quantity); });
    if (!account) { res.status(404).json({ error: "Account not found." }); return; }
    if (result.outcome !== "ok") { res.status(400).json({ error: refusal(result, account.state.corp, unitId, quantity) }); return; }

    const { job } = result;
    const notification = addAccountNotification(req.params.accountId, {
      type: "infrastructure",
      title: "Troop Training Started",
      body: `${squads(job.quantity, UNITS[job.unitId])} training at your Headquarters.`
    });
    if (notification) emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    saveAccountsNow(); // a purchase: on disk now
    res.json({ ...account, receipt: troopTrainingReceipt({ job, what: squads(job.quantity, UNITS[job.unitId]), garrison: job.unitId === "dt" ? STATION_REGISTRY[job.stationId]?.name || job.stationId : null }) });
  });

  app.post("/api/accounts/:accountId/gameplay/training/cancel", (req, res) => {
    const jobId = String(req.body?.jobId || "");
    let result = { outcome: "no-job" };
    const account = mutateAccountState(req.params.accountId, (state) => { result = cancelTroopJob(state.corp, jobId); });
    if (!account) { res.status(404).json({ error: "Account not found." }); return; }
    if (result.outcome !== "ok") { res.status(404).json({ error: "That training job is not in your queue." }); return; }
    saveAccountsNow();
    res.json({ ...account, receipt: troopCancelReceipt({ what: squads(result.job.quantity, UNITS[result.job.unitId]), refund: result.refund }) });
  });
}
