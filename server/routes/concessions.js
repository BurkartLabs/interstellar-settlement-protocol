// server/routes/concessions.js: ISA concessions (ISP-227, AB#922; docs/design/TERRITORY.md). Petition (a challenge
// when the system's places are full) and relinquish are the caller's own, behind requireAuth and requireAccountAccess
// (the /api/accounts/:accountId mount), with ACCOUNT_INPUT's check of the system id; the holder is always the caller's
// corporation or conglomerate, never read from the request. The register is public, like the dominance reading.
import { SYSTEMS_BY_ID } from "../game/catalog.js";
import { concessionStatusFor, petitionConcession, publicConcession, relinquishConcession, setLeaseModifier, starmapConcessions } from "../concessions.js";
import { bodyNumber } from "../bodyNumber.js";

function reply(res, result, status = 200) {
  if (result?.refused) { res.status(result.refused.status).json({ error: result.refused.error, code: result.refused.code }); return; }
  res.status(status).json(result);
}
const known = (id) => typeof id === "string" && SYSTEMS_BY_ID.has(id);

export function registerConcessionRoutes(app) {
  // ISP-229 (AB#924): every system's holders and open petitions, for the starmap's Concessions overlay (public)
  app.get("/api/starmap/concessions", (_req, res) => { res.json(starmapConcessions(SYSTEMS_BY_ID.keys())); });
  // ISP-229 (AB#924): the caller's own reading of a system: eligibility, what a petition costs, and what it manages
  app.get("/api/accounts/:accountId/concessions/:systemId", (req, res) => {
    if (!known(req.params.systemId)) { res.status(404).json({ error: "No such system." }); return; }
    reply(res, concessionStatusFor(req.params.accountId, req.params.systemId));
  });
  app.get("/api/systems/:id/concession", (req, res) => {
    if (!known(req.params.id)) { res.status(404).json({ error: "No such system." }); return; }
    res.json(publicConcession(req.params.id));
  });
  app.post("/api/accounts/:accountId/concessions/:systemId/petition", (req, res) => {
    if (!known(req.params.systemId)) { res.status(404).json({ error: "No such system." }); return; }
    reply(res, petitionConcession(req.params.accountId, req.params.systemId), 201);
  });
  // ISP-228 (AB#923): the holder's discount on everyone's new leases in its system, after a notice period
  app.post("/api/accounts/:accountId/concessions/:systemId/lease-modifier", (req, res) => {
    if (!known(req.params.systemId)) { res.status(404).json({ error: "No such system." }); return; }
    reply(res, setLeaseModifier(req.params.accountId, req.params.systemId, bodyNumber(req.body?.discountPct, { fallback: NaN })));
  });
  app.post("/api/accounts/:accountId/concessions/:systemId/relinquish", (req, res) => {
    if (!known(req.params.systemId)) { res.status(404).json({ error: "No such system." }); return; }
    reply(res, relinquishConcession(req.params.accountId, req.params.systemId));
  });
}
