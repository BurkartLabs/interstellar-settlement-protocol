// server/routes/upgrades.js: POST /gameplay/buildings/:buildingId/upgrade (ISP-101, AB#793). Behind requireAuth and
// requireAccountAccess like every /api/accounts/:accountId route; server/gameplayInput.js has already refused an id that
// is not one of the caller's buildings, with the same answer for an unknown id and another corporation's. The rules
// are server/upgrades.js.
import { mutateAccountState, saveAccountsNow } from "../gameState.js";
import { formatCredits, formatUtc, upgradeReceipt } from "../receipts.js";
import { upgradeBuilding, upgradeRefusal } from "../upgrades.js";
import { damagedBuildings, repairBuilding, repairRefusal } from "../buildingRepair.js"; // ISP-287 (AB#994)
import { getAccountById } from "../gameState.js";
import { repairReceipt } from "../receipts.js";

export function registerUpgradeRoutes(app) {
  app.post("/api/accounts/:accountId/gameplay/buildings/:buildingId/upgrade", (req, res) => {
    const { accountId, buildingId } = req.params;
    let result = { outcome: "unknown-building" };
    const account = mutateAccountState(accountId, (state) => {
      result = upgradeBuilding(state.corp, buildingId);
    });
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    if (result.outcome !== "ok") {
      res.status(400).json({ error: upgradeRefusal(result, formatCredits, formatUtc), code: result.outcome }); // ISP-254 (AB#4818)
      return;
    }
    saveAccountsNow(); // a purchase: on disk now, not at the next debounced save
    res.json({ ...account, receipt: upgradeReceipt(result) });
  });

  // ISP-287 (AB#994): the caller's damaged buildings with the server's repair price, and repairing one. The id has been
  // checked against the caller's own buildings by server/gameplayInput.js; server/buildingRepair.js looks it up again
  // among them, prices it, and debits and restores it in one settlement.
  app.get("/api/accounts/:accountId/gameplay/building-repairs", (req, res) => {
    const account = getAccountById(req.params.accountId);
    if (!account) { res.status(404).json({ error: "Account not found." }); return; }
    res.json({ buildings: damagedBuildings(account.state.corp) });
  });

  app.post("/api/accounts/:accountId/gameplay/buildings/:buildingId/repair", (req, res) => {
    const { accountId, buildingId } = req.params;
    if (!getAccountById(accountId)) { res.status(404).json({ error: "Account not found." }); return; }
    const result = repairBuilding(accountId, buildingId);
    if (result.outcome !== "ok") {
      res.status(400).json({ error: repairRefusal(result, formatCredits), code: result.outcome }); // ISP-254 (AB#4818)
      return;
    }
    const account = mutateAccountState(accountId, () => {}); // the caller's account as every route returns it (sanitised)
    saveAccountsNow(); // a purchase: on disk now, not at the next debounced save
    res.json({ ...account, receipt: repairReceipt(result) });
  });
}
