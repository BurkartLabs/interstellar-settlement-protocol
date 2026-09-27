// server/routes/patents.js: Corporate Registry & Charters' patents (ISP-235, AB#930; docs/design/WARFARE.md, Lawfare).
// Filing is the caller's own, behind requireAuth and requireAccountAccess (the /api/accounts/:accountId mount), with
// ACCOUNT_INPUT's check of kind, subject and rate; the holder is always the caller's corporation. The list is public.
import { filePatent, publicPatents } from "../patents.js";
import { bodyNumber } from "../bodyNumber.js"; // Bug #1014: never a hand-parsed body number

export function registerPatentRoutes(app) {
  app.get("/api/patents", (req, res) => res.json(publicPatents()));
  app.post("/api/accounts/:accountId/patents", (req, res) => {
    const { kind, subjectId } = req.body || {};
    // Unclamped: filePatent refuses a rate that is not a whole number inside its kind's bound.
    const result = filePatent(req.params.accountId, { kind, subjectId, ratePct: bodyNumber(req.body?.ratePct, { fallback: NaN }) });
    if (result.refused) { res.status(result.refused.status).json({ error: result.refused.error, code: result.refused.code }); return; }
    res.status(201).json(result);
  });
}
