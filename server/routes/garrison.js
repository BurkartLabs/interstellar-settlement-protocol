// server/routes/garrison.js: defending (ISP-180, AB#874). The rules are server/garrison.js; these routes say what
// happened. Under /api/accounts/:accountId, so the corporation is always the caller's own. Every field is a number, an
// enum or an id (server/gameplayInput.js); ids that are not the caller's answer 404 and change nothing.
import { bodyNumber } from "../bodyNumber.js";
import { deployHiredFleet, moveTroops, setPosture } from "../garrison.js";

const answer = (res, result) => {
  if (!result?.ok) { res.status(result?.status || 400).json({ error: result?.error || "That could not be done." }); return; }
  res.json(result);
};
const str = (v) => (typeof v === "string" ? v : "");
const whole = (v) => bodyNumber(v, { fallback: -1, integer: true }); // Bug #1014

export function registerGarrisonRoutes(app) {
  app.post("/api/accounts/:accountId/gameplay/garrisons/:stationId/posture", (req, res) =>
    answer(res, setPosture(req.params.accountId, req.params.stationId, str(req.body?.posture))));
  app.post("/api/accounts/:accountId/gameplay/garrisons/move", (req, res) =>
    answer(res, moveTroops(req.params.accountId, { fromStationId: str(req.body?.fromStationId), toStationId: str(req.body?.toStationId), quantity: whole(req.body?.quantity) })));
  app.post("/api/accounts/:accountId/gameplay/mercenaries/:contractId/deploy", (req, res) =>
    answer(res, deployHiredFleet(req.params.accountId, req.params.contractId, str(req.body?.toStationId))));
}
