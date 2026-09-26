// server/routes/construction.js: POST /gameplay/build { buildingId, leaseId? } (ISP-94, AB#784), the one route that
// builds a player building. The old per-building routes (build-extractor, build-assembly-facility, build-refinery)
// are the same handler with the building fixed, so the client keeps working and every building has one validation
// path. server/gameplayInput.js checks both fields against the catalogue and the caller's own leases before this runs;
// the rules are server/construction.js; the handler is buildHandler in ./helpers.js, which the old routes share.
import { buildHandler } from "./helpers.js";

export function registerConstructionRoutes(app) {
  app.post("/api/accounts/:accountId/gameplay/build", buildHandler((req) => ({ buildingId: req.body?.buildingId, leaseId: req.body?.leaseId })));
}
