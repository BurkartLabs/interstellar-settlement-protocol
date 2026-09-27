// server/routes/raids.js: declaring and recalling raids (ISP-178, AB#872). The rules are server/raids.js; these routes
// say what happened. Under /api/accounts/:accountId, so requireAuth and requireAccountAccess have run: the attacker is
// always the caller's own corporation. Every field is an id checked for shape by server/gameplayInput.js and against
// what exists by server/raids.js; ids that are not the caller's answer 404 and change nothing.
import { declareRaid, raidTargets, raidsFor, recallRaid } from "../raids.js";
import { raidReportFor } from "../raidResolution.js"; // ISP-179 (AB#873)

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
  // ISP-181 (AB#875): who may be raided at a station, and why the others may not
  app.get("/api/accounts/:accountId/gameplay/raids/targets/:stationId", (req, res) => {
    const list = raidTargets(req.params.accountId, req.params.stationId);
    if (!list) { res.status(404).json({ error: "Account not found." }); return; }
    res.json(list);
  });
  app.post("/api/accounts/:accountId/gameplay/raids", (req, res) => answer(res, declareRaid(req.params.accountId, {
    fleetId: str(req.body?.fleetId), contractId: str(req.body?.contractId), targetCorpId: str(req.body?.targetCorpId), targetStationId: str(req.body?.targetStationId)
  })));
  app.post("/api/accounts/:accountId/gameplay/raids/:raidId/recall", (req, res) => answer(res, recallRaid(req.params.accountId, req.params.raidId)));
  // ISP-179 (AB#873): a raid's report, private to the two sides; anyone else, or an id that does not exist, gets 404
  app.get("/api/accounts/:accountId/gameplay/raids/:raidId/report", (req, res) => {
    const report = raidReportFor(req.params.accountId, req.params.raidId);
    if (!report) { res.status(404).json({ error: "No such raid report." }); return; }
    res.json({ report });
  });
}
