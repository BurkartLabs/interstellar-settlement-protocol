// server/routes/conglomerates.js: the charter and the public directory (ISP-197, AB#891). The rules are
// server/game/conglomerates.js. The charter is behind requireAuth and requireAccountAccess like every
// /api/accounts/:accountId route, and server/gameplayInput.js (ACCOUNT_INPUT) has already refused a body of the wrong
// shape; the directory needs a login and shows no account id or corporation figure.
import { requireAuth } from "../auth.js";
import { conglomerateDirectory, foundConglomerate } from "../game/conglomerates.js";
import { bodyNumber } from "../bodyNumber.js";

export function registerConglomerateRoutes(app) {
  app.post("/api/accounts/:accountId/conglomerates", (req, res) => {
    const { name, emblem, colour } = req.body || {};
    const result = foundConglomerate(req.params.accountId, { name, emblem: bodyNumber(emblem, { fallback: null }), colour: bodyNumber(colour, { fallback: null }) });
    if (result.refused) {
      const { status, code, error } = result.refused;
      res.status(status).json({ error, code });
      return;
    }
    res.status(201).json({ ...result.account, conglomerate: result.conglomerate });
  });

  app.get("/api/conglomerates", requireAuth, (_req, res) => {
    res.json({ conglomerates: conglomerateDirectory() });
  });
}
