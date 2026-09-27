// ISP-148 (AB#842): any corporation's credit rating, as lenders and investors may see it. The rating is computed on the
// server (server/creditRating.js, ISP-147); this is its public face: the grade, the score in a band, and each input's
// band, never a raw value, a credit balance or a statement (docs/design/v0.9-debt.md, section 4, "What others see").
import { requireAuth } from "../auth.js";
import { getAccountById, getAllAccountIds } from "../gameState.js";
import { publicRating } from "../creditRating.js";

const NOT_FOUND = { error: "No such corporation." };

export function registerCreditRatingRoutes(app) {
  app.get("/api/corporations/:corpId/credit-rating", requireAuth, (req, res) => {
    const wanted = String(req.params.corpId ?? "");
    // Every corporation is looked at whatever the id, and a miss (unknown or malformed alike) is one answer, so
    // neither the reply nor its timing says which ids exist.
    let found = null;
    for (const id of getAllAccountIds()) {
      const corp = getAccountById(id)?.state?.corp;
      if (corp?.publicId && corp.publicId === wanted && !found) found = corp;
    }
    if (!found) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    res.json({ corpId: found.publicId, corporationName: found.corporationName || "", ...publicRating(found.creditRating) });
  });
}
