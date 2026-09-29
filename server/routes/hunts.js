// server/routes/hunts.js: sending a fleet to hunt a belt's Rats, and the hunts' reports (ISP-284, AB#991). The rules are
// server/hunts.js; these routes say what happened. Under /api/accounts/:accountId, so requireAuth, requireAccountAccess
// and the account-action limiter have run: the hunter is always the caller's own corporation. The fields are checked for
// shape by server/gameplayInput.js; a fleet that is not the caller's, or a belt that does not exist, answers 400 and
// changes nothing.
import { declareHunt, huntOutcome, huntPreview, ratsActivity } from "../hunts.js";
import { getAccountById } from "../gameState.js";
import { huntReceipt } from "../receipts.js"; // ISP-285 (AB#992)
import { beltPhrase } from "../../public/scripts/displayNames.js";
import { SYSTEMS_CATALOG } from "../travel.js";
import { combatModifiersFor } from "../game/combat.js";

const str = (v) => (typeof v === "string" ? v : "");

export function registerHuntRoutes(app) {
  app.post("/api/accounts/:accountId/gameplay/fleets/:fleetId/hunt", (req, res) => {
    const result = declareHunt(req.params.accountId, { fleetId: str(req.params.fleetId), beltKey: str(req.body?.beltKey) });
    if (!result?.ok) { res.status(result?.status || 400).json({ error: result?.error || "The hunt could not be declared." }); return; }
    // ISP-285 (AB#992): the account as it is now, and the receipt the page shows (AB#744)
    const account = getAccountById(req.params.accountId);
    const fleet = (account?.state?.corp?.military?.fleets || []).find((f) => f.id === result.hunt.fleetId);
    const expected = huntOutcome(result.hunt.units, result.hunt.rats, combatModifiersFor(account?.state?.corp));
    res.json({ ...account, hunt: result.hunt, receipt: huntReceipt({ fleetName: fleet?.name || "Your fleet", beltLabel: beltPhrase(SYSTEMS_CATALOG, result.hunt.beltKey), provisions: result.hunt.provisions, endsAt: result.hunt.endsAt, expected }) });
  });
  // ISP-285 (AB#992): every system's pirate activity and the belts a hunt has cleared, as the server has them now
  app.get("/api/accounts/:accountId/gameplay/rats/activity", (_req, res) => res.json(ratsActivity()));
  // ISP-285 (AB#992): a belt's hunt screen: its chance and quiet period, the fleets that can hunt it and the expected battle
  app.get("/api/accounts/:accountId/gameplay/belts/:beltKey/hunt", (req, res) => {
    const preview = huntPreview(req.params.accountId, str(req.params.beltKey));
    if (!preview?.ok) { res.status(preview?.status || 400).json({ error: preview?.error || "No such asteroid belt." }); return; }
    res.json(preview);
  });
  // The corporation's hunts: those under way (on their fleets) and the last reports, newest first
  app.get("/api/accounts/:accountId/gameplay/hunts", (req, res) => {
    const corp = getAccountById(req.params.accountId)?.state?.corp;
    if (!corp) { res.status(404).json({ error: "Account not found." }); return; }
    const active = (corp.military?.fleets || []).filter((f) => f.hunt).map((f) => ({ fleetId: f.id, ...f.hunt }));
    res.json({ active, reports: corp.military?.hunts || [] });
  });
}
