// server/routes/upgrades.js: POST /gameplay/buildings/:buildingId/upgrade (ISP-101, AB#793). Behind requireAuth and
// requireAccountAccess like every /api/accounts/:accountId route; server/gameplayInput.js has already refused an id that
// is not one of the caller's buildings, with the same answer for an unknown id and another corporation's. The rules
// are server/upgrades.js.
import { mutateAccountState, saveAccountsNow } from "../gameState.js";
import { formatCredits, formatUtc, upgradeReceipt } from "../receipts.js";
import { upgradeBuilding, upgradeRefusal } from "../upgrades.js";

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
      res.status(400).json({ error: upgradeRefusal(result, formatCredits, formatUtc) });
      return;
    }
    saveAccountsNow(); // a purchase: on disk now, not at the next debounced save
    res.json({ ...account, receipt: upgradeReceipt(result) });
  });
}
