// server/routes/mercenaries.js: mercenary contracts (ISP-176, AB#870). The rules are server/mercenaries.js; these routes
// say what happened. Every field is a number or an enum (server/gameplayInput.js); ids that are not the caller's own
// answer 404 and change nothing.
import { bodyNumber } from "../bodyNumber.js";
import { hireOffer, listOffers, offerFleet, withdrawOffer } from "../mercenaries.js";
import { getAccountById } from "../gameState.js";

const whole = (v) => bodyNumber(v, { fallback: -1, integer: true }); // Bug #1014: the one way a body number is read
const answer = (res, result) => {
  if (!result?.ok) { res.status(result?.status || 400).json({ error: result?.error || "The contract could not be made." }); return; }
  res.json(result);
};

export function registerMercenaryRoutes(app) {
  app.get("/api/accounts/:accountId/gameplay/mercenaries", (req, res) => {
    if (!getAccountById(req.params.accountId)) { res.status(404).json({ error: "Account not found." }); return; }
    res.json({ offers: listOffers() });
  });
  app.post("/api/accounts/:accountId/gameplay/mercenaries/offer", (req, res) => answer(res, offerFleet(req.params.accountId, String(req.body?.fleetId || ""), {
    termHours: whole(req.body?.termHours), price: whole(req.body?.price), collateral: whole(req.body?.collateral), allowedUse: req.body?.allowedUse
  })));
  app.post("/api/accounts/:accountId/gameplay/mercenaries/:offerId/withdraw", (req, res) => answer(res, withdrawOffer(req.params.accountId, req.params.offerId)));
  app.post("/api/accounts/:accountId/gameplay/mercenaries/:offerId/hire", (req, res) => answer(res, hireOffer(req.params.accountId, req.params.offerId)));
}
