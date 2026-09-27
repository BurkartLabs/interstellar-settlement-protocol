// server/routes/raids.js: declaring and recalling raids (ISP-178, AB#872). The rules are server/raids.js; these routes
// say what happened. Under /api/accounts/:accountId, so requireAuth and requireAccountAccess have run: the attacker is
// always the caller's own corporation. Every field is an id checked for shape by server/gameplayInput.js and against
// what exists by server/raids.js; ids that are not the caller's answer 404 and change nothing.
import { declareRaid, raidsFor, recallRaid } from "../raids.js";

const answer = (res, result) => {
  if (!result?.ok) { res.status(result?.status || 400).json({ error: result?.error || "The raid could not be declared." }); return; }
  res.json(result);
};
const str = (v) => (typeof v === "string" ? v : "");

export function registerRaidRoutes(app) {
  app.get("/api/accounts/:accountId/gameplay/raids", (req, res) => {
    const raids = raidsFor(req.params.accountId);
    if (!raids) { res.status(404).json({ error: "Account not found." }); return; }
    res.json(raids);
  });
  app.post("/api/accounts/:accountId/gameplay/raids", (req, res) => answer(res, declareRaid(req.params.accountId, {
    fleetId: str(req.body?.fleetId), contractId: str(req.body?.contractId), targetCorpId: str(req.body?.targetCorpId), targetStationId: str(req.body?.targetStationId)
  })));
  app.post("/api/accounts/:accountId/gameplay/raids/:raidId/recall", (req, res) => answer(res, recallRaid(req.params.accountId, req.params.raidId)));
}
