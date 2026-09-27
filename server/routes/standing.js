// server/routes/standing.js: a corporation's standing with the Earth Assembly and the ITC (ISP-238, AB#933;
// docs/design/WARFARE.md, "Faction standing"). Its own, and private: behind requireAccountAccess (server/index.js), for
// the corporation alone. There is no route that writes it: standing is earned only through the server's own bookings.
import { getAccountById } from "../gameState.js";
import { standingView } from "../standingService.js";

export function registerStandingRoutes(app) {
  app.get("/api/accounts/:accountId/standing", (req, res) => {
    const corp = getAccountById(req.params.accountId)?.state?.corp;
    if (!corp) { res.status(404).json({ error: "Account not found." }); return; }
    res.json(standingView(corp));
  });
}
