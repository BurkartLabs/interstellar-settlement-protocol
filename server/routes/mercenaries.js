// server/routes/mercenaries.js: mercenary contracts (ISP-176, AB#870). The rules are server/mercenaries.js; these routes
// say what happened. Every field is a number or an enum (server/gameplayInput.js); ids that are not the caller's own
// answer 404 and change nothing.
import { bodyNumber } from "../bodyNumber.js";
import { hireOffer, listOffers, myContracts, offerFleet, withdrawOffer } from "../mercenaries.js";
import { mercenaryHireReceipt } from "../receipts.js"; // ISP-177 (AB#871)
import { getAccountById } from "../gameState.js";

const whole = (v) => bodyNumber(v, { fallback: -1, integer: true }); // Bug #1014: the one way a body number is read
const answer = (res, result) => {
  if (!result?.ok) { res.status(result?.status || 400).json({ error: result?.error || "The contract could not be made." }); return; }
  res.json(result);
};

export function registerMercenaryRoutes(app) {
  app.get("/api/accounts/:accountId/gameplay/mercenaries", (req, res) => {
    if (!getAccountById(req.params.accountId)) { res.status(404).json({ error: "Account not found." }); return; }
    res.json({ offers: listOffers(Date.now(), req.params.accountId) });
  });
  // ISP-177 (AB#871): the caller's own contracts, both sides
  app.get("/api/accounts/:accountId/gameplay/mercenaries/mine", (req, res) => {
    const mine = myContracts(req.params.accountId);
    if (!mine) { res.status(404).json({ error: "Account not found." }); return; }
    res.json(mine);
  });
  app.post("/api/accounts/:accountId/gameplay/mercenaries/offer", (req, res) => answer(res, offerFleet(req.params.accountId, String(req.body?.fleetId || ""), {
    termHours: whole(req.body?.termHours), price: whole(req.body?.price), collateral: whole(req.body?.collateral), allowedUse: req.body?.allowedUse
  })));
  app.post("/api/accounts/:accountId/gameplay/mercenaries/:offerId/withdraw", (req, res) => answer(res, withdrawOffer(req.params.accountId, req.params.offerId)));
  // ISP-177 (AB#871): a hire holds credits, so it answers with its receipt, as every committing action does (AB#744)
  app.post("/api/accounts/:accountId/gameplay/mercenaries/:offerId/hire", (req, res) => {
    const result = hireOffer(req.params.accountId, req.params.offerId);
    if (!result?.ok) { answer(res, result); return; }
    const account = getAccountById(req.params.accountId);
    res.json({ ...result, ...account, receipt: mercenaryHireReceipt({ offer: result.offer }) });
  });
}
