// server/routes/dominance.js: the dominance reading (ISP-217, AB#912). The public one, for the starmap overlay and
// v0.13's territorial control, has names and rounded shares only; a corporation's own components are behind its login.
// The metric is server/game/dominance.js; the cache is server/dominanceService.js.
import { SYSTEMS_BY_ID } from "../game/catalog.js";
import { accountsStore } from "../game/store.js";
import { ownDominance, publicDominance } from "../dominanceService.js";

export function registerDominanceRoutes(app) {
  // Public: no login, and no input but an optional system id, which must be one the catalog has.
  app.get("/api/starmap/dominance", (req, res) => {
    const systemId = req.query?.systemId;
    if (systemId !== undefined && (typeof systemId !== "string" || !SYSTEMS_BY_ID.has(systemId))) {
      res.status(400).json({ error: "Choose a system from the starmap." });
      return;
    }
    res.json(publicDominance(systemId || null));
  });

  // Behind requireAuth and requireAccountAccess (the /api/accounts/:accountId mount): the caller's own components.
  app.get("/api/accounts/:accountId/dominance", (req, res) => {
    const corp = accountsStore.accounts?.[req.params.accountId]?.state?.corp;
    if (!corp?.publicId) { res.status(404).json({ error: "Account not found." }); return; }
    res.json(ownDominance(corp.publicId));
  });
}
