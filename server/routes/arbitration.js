// server/routes/arbitration.js: the Galactic Arbitration Council's filing and docket (ISP-241, AB#937; docs/design/
// WARFARE.md). Filing and the caller's own cases sit behind requireAuth and requireAccountAccess (the
// /api/accounts/:accountId mount), with ACCOUNT_INPUT's check of the claim type and record id: the claimant is always the
// caller's corporation, and nothing in a case is free text. The docket is public.
import { casesFor, cureCase, fileCase, fileableRecords, publicDocket } from "../arbitration.js";

export function registerArbitrationRoutes(app) {
  app.get("/api/arbitration/docket", (req, res) => res.json(publicDocket()));
  app.get("/api/accounts/:accountId/arbitration/cases", (req, res) => {
    const view = casesFor(req.params.accountId);
    if (!view) { res.status(404).json({ error: "Account not found." }); return; }
    res.json(view);
  });
  app.get("/api/accounts/:accountId/arbitration/records/:type", (req, res) => {
    const view = fileableRecords(req.params.accountId, req.params.type);
    if (!view) { res.status(404).json({ error: "Not a claim type the Council hears." }); return; }
    res.json(view);
  });
  // ISP-242 (AB#938): the respondent cures, inside the window, in one action
  app.post("/api/accounts/:accountId/arbitration/cases/:ref/cure", (req, res) => {
    const result = cureCase(req.params.accountId, req.params.ref);
    if (result.refused) { res.status(result.refused.status).json({ error: result.refused.error, code: result.refused.code }); return; }
    res.json(result);
  });
  app.post("/api/accounts/:accountId/arbitration/cases", (req, res) => {
    const result = fileCase(req.params.accountId, { type: req.body?.type, recordId: req.body?.recordId });
    if (result.refused) { res.status(result.refused.status).json({ error: result.refused.error, code: result.refused.code }); return; }
    res.status(201).json(result);
  });
}
