// server/routes/conglomerates.js: the charter and the public directory (ISP-197, AB#891), and joining and leaving
// (ISP-198, AB#892). The rules are server/game/conglomerates.js and server/game/membership.js. Every
// /api/accounts/:accountId route is behind requireAuth and requireAccountAccess, so the account acting is the caller's
// own, and server/gameplayInput.js (ACCOUNT_INPUT) has already refused a body or id of the wrong shape. The directory
// needs a login and shows no account id or corporation figure.
import { requireAuth } from "../auth.js";
import { conglomerateDirectory, foundConglomerate } from "../game/conglomerates.js";
import { answerApplication, answerInvitation, applyToConglomerate, inviteCorporation, leaveConglomerate, membershipView } from "../game/membership.js";
import { bodyNumber } from "../bodyNumber.js";

/** Send a rules result: its refusal as { error, code } with its status, or the result with `status`. */
function reply(res, result, status = 200) {
  if (result?.refused) {
    const { status: code, code: reason, error } = result.refused;
    res.status(code).json({ error, code: reason });
    return;
  }
  res.status(status).json(result);
}

export function registerConglomerateRoutes(app) {
  app.post("/api/accounts/:accountId/conglomerates", (req, res) => {
    const { name, emblem, colour } = req.body || {};
    const result = foundConglomerate(req.params.accountId, { name, emblem: bodyNumber(emblem, { fallback: null }), colour: bodyNumber(colour, { fallback: null }) });
    if (result.refused) return reply(res, result);
    res.status(201).json({ ...result.account, conglomerate: result.conglomerate });
  });

  app.get("/api/conglomerates", requireAuth, (_req, res) => {
    res.json({ conglomerates: conglomerateDirectory() });
  });

  // ISP-198 (AB#892): membership.
  app.get("/api/accounts/:accountId/conglomerate", (req, res) => {
    reply(res, membershipView(req.params.accountId) || { refused: { status: 404, code: "no-account", error: "Account not found." } });
  });
  app.post("/api/accounts/:accountId/conglomerates/:conglomerateId/invitations", (req, res) => {
    reply(res, inviteCorporation(req.params.accountId, req.params.conglomerateId, req.body?.corpId), 201);
  });
  app.post("/api/accounts/:accountId/conglomerates/:conglomerateId/invitations/:invitationId/:answer", (req, res) => {
    const { accountId, conglomerateId, invitationId, answer } = req.params;
    reply(res, answerInvitation(accountId, conglomerateId, invitationId, answer));
  });
  app.post("/api/accounts/:accountId/conglomerates/:conglomerateId/applications", (req, res) => {
    reply(res, applyToConglomerate(req.params.accountId, req.params.conglomerateId), 201);
  });
  app.post("/api/accounts/:accountId/conglomerates/:conglomerateId/applications/:applicationId/:answer", (req, res) => {
    const { accountId, conglomerateId, applicationId, answer } = req.params;
    reply(res, answerApplication(accountId, conglomerateId, applicationId, answer));
  });
  app.post("/api/accounts/:accountId/conglomerates/:conglomerateId/leave", (req, res) => {
    reply(res, leaveConglomerate(req.params.accountId, req.params.conglomerateId));
  });
}
