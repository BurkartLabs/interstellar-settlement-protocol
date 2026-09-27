// server/routes/control.js: a system's control scores and concession eligibility (ISP-226, AB#921; docs/design/TERRITORY.md).
// Public, like the dominance reading it is made from: no login, no input but the system id, which must be one the
// registry has (404 otherwise). The answer is aggregate: names, rounded scores and eligibility only.
import { SYSTEMS_BY_ID } from "../game/catalog.js";
import { systemControl } from "../controlService.js";

export function registerControlRoutes(app) {
  app.get("/api/systems/:id/control", (req, res) => {
    const view = systemControl(String(req.params.id ?? ""), Date.now(), new Set(SYSTEMS_BY_ID.keys()));
    if (!view) { res.status(404).json({ error: "No such system." }); return; }
    res.json(view);
  });
}
