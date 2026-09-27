// server/routes/shipyard.js: ship production at the Orbital Shipyard (ISP-171, AB#865). The rules are server/shipyard.js;
// these routes say what happened. The input check (server/gameplayInput.js) has already refused a unit that is not a
// ship, a quantity that is not a whole number in range, and a job id of the wrong shape.
import { addAccountNotification, fleetStatus, mutateAccountState, saveAccountsNow, RESEARCH_LIBRARY } from "../gameState.js";
import { STATION_REGISTRY } from "../travel.js";
import { emitToAccount } from "../realtime.js";
import { fundingRequirementMessage } from "./helpers.js";
import { MAX_JOB_QUANTITY, MAX_QUEUED_JOBS, SHIPYARD, cancelShipJob, queueShips } from "../shipyard.js";
import { UNITS } from "../game/units.js";
import { bodyNumber } from "../bodyNumber.js"; // Bug #1014: the one way a route reads a body number
import { shipCancelReceipt, shipQueueReceipt } from "../receipts.js";

const plural = (n, name) => `${n} ${name}${n === 1 ? "" : "s"}`;

function refusal(result, corp, unitId, quantity) {
  const unit = UNITS[unitId];
  switch (result.outcome) {
    case "not-a-ship": return "Choose a ship: a Light Fighter, a Destroyer or a Siege Engine.";
    case "bad-quantity": return `Choose a quantity from 1 to ${MAX_JOB_QUANTITY}.`;
    case "no-shipyard": return `Ships are built at an ${SHIPYARD.name}: build one first.`;
    case "missing-research": return `${unit.name}s need ${RESEARCH_LIBRARY[result.research]?.name || result.research} research.`;
    case "queue-full": return `The shipyard's queue holds ${MAX_QUEUED_JOBS} jobs. Wait for one to finish, or cancel one.`;
    case "fleet-cap": return `Your fleet is at its Fleet Cap: ${result.fleet.vessels} of ${result.fleet.cap} vessels, and ${plural(quantity, unit.name)} would pass it. ${result.fleet.raiseText}`.trim();
    case "insufficient-credits": return fundingRequirementMessage(`${plural(quantity, unit.name)}`, corp, result.cost.credits);
    case "insufficient-goods": return `${plural(quantity, unit.name)} need ${result.needed.toLocaleString("en-US")} ${result.item} at ${STATION_REGISTRY[result.stationId]?.name || "your station"}; it holds ${result.have.toLocaleString("en-US")}.`;
    default: return "The shipyard could not queue that.";
  }
}

export function registerShipyardRoutes(app) {
  // The client names a ship and a quantity, nothing else: the cost and the time are the catalog's.
  app.post("/api/accounts/:accountId/gameplay/shipyard/queue", (req, res) => {
    const unitId = String(req.body?.unitId || "");
    const quantity = bodyNumber(req.body?.quantity, { fallback: 0 }); // the input check has held it to 1..100
    let result = { outcome: "not-a-ship" };
    const account = mutateAccountState(req.params.accountId, (state) => { result = queueShips(state.corp, unitId, quantity); });
    if (!account) { res.status(404).json({ error: "Account not found." }); return; }
    if (result.outcome !== "ok") { res.status(400).json({ error: refusal(result, account.state.corp, unitId, quantity) }); return; }

    const { job } = result;
    const notification = addAccountNotification(req.params.accountId, {
      type: "infrastructure",
      title: "Ship Production Queued",
      body: `${plural(job.quantity, UNITS[job.unitId].name)} queued at your ${SHIPYARD.name}.`
    });
    if (notification) emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    saveAccountsNow(); // a purchase: on disk now
    const fleet = fleetStatus(account.state.corp);
    res.json({ ...account, receipt: shipQueueReceipt({ job, unitName: UNITS[job.unitId].name, vessels: fleet.vessels, cap: fleet.cap }) });
  });

  app.post("/api/accounts/:accountId/gameplay/shipyard/cancel", (req, res) => {
    const jobId = String(req.body?.jobId || "");
    let result = { outcome: "no-job" };
    const account = mutateAccountState(req.params.accountId, (state) => { result = cancelShipJob(state.corp, jobId); });
    if (!account) { res.status(404).json({ error: "Account not found." }); return; }
    if (result.outcome !== "ok") { res.status(404).json({ error: "That shipyard job is not in your queue." }); return; }
    saveAccountsNow();
    res.json({ ...account, receipt: shipCancelReceipt({ job: result.job, unitName: UNITS[result.job.unitId].name, refund: result.refund }) });
  });
}
