// server/routes/hunts.js: sending a fleet to hunt a belt's Rats, and the hunts' reports (ISP-284, AB#991). The rules are
// server/hunts.js; these routes say what happened. Under /api/accounts/:accountId, so requireAuth, requireAccountAccess
// and the account-action limiter have run: the hunter is always the caller's own corporation. The fields are checked for
// shape by server/gameplayInput.js; a fleet that is not the caller's, or a belt that does not exist, answers 400 and
// changes nothing.
import { declareHunt } from "../hunts.js";
import { getAccountById } from "../gameState.js";

const str = (v) => (typeof v === "string" ? v : "");

export function registerHuntRoutes(app) {
  app.post("/api/accounts/:accountId/gameplay/fleets/:fleetId/hunt", (req, res) => {
    const result = declareHunt(req.params.accountId, { fleetId: str(req.params.fleetId), beltKey: str(req.body?.beltKey) });
    if (!result?.ok) { res.status(result?.status || 400).json({ error: result?.error || "The hunt could not be declared." }); return; }
    res.json(result);
  });
  // The corporation's hunts: those under way (on their fleets) and the last reports, newest first
  app.get("/api/accounts/:accountId/gameplay/hunts", (req, res) => {
    const corp = getAccountById(req.params.accountId)?.state?.corp;
    if (!corp) { res.status(404).json({ error: "Account not found." }); return; }
    const active = (corp.military?.fleets || []).filter((f) => f.hunt).map((f) => ({ fleetId: f.id, ...f.hunt }));
    res.json({ active, reports: corp.military?.hunts || [] });
  });
}
