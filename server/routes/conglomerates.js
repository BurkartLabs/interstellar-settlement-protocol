// server/routes/conglomerates.js: every conglomerate route (ISP-197 AB#891, ISP-198 AB#892, ISP-199 AB#893). The rules
// are server/game/conglomerates.js, membership.js and conglomerateRoles.js.
//
// ISP-199 (AB#893, P-HALF-FIX): every route is registered through guarded(action, handler), which asks can() about the
// caller's role as the server holds it now, before the handler runs; the rules ask again. A caller who is not a member
// is told the conglomerate does not exist; a member whose role lacks the permission gets 403.
// tests/integration/conglomerate-roles.test.js walks the router and fails on a conglomerate route that is not guarded.
// Every /api/accounts/:accountId route is behind requireAuth and requireAccountAccess, so the account acting is the
// caller's own, and server/gameplayInput.js (ACCOUNT_INPUT) has already refused a body or id of the wrong shape.
import { requireAuth } from "../auth.js";
import { can } from "../conglomerates.js";
import { conglomerateDirectory, foundConglomerate } from "../game/conglomerates.js";
import { actorRole, answerApplication, answerInvitation, applyToConglomerate, inviteCorporation, leaveConglomerate, membershipView } from "../game/membership.js";
import { dissolveConglomerate, removeMember, setIdentity, setMemberRole, transferFounder } from "../game/conglomerateRoles.js";
import { buyConglomerateLevel } from "../game/conglomerateLevels.js";
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

/** The handler, behind can(). `action` is a permission id, or a function of the request that names one. */
function guarded(action, handler) {
  const route = (req, res) => {
    const act = typeof action === "function" ? action(req) : action;
    const role = actorRole(req.params.accountId, req.params.conglomerateId);
    if (!can(role, act)) {
      if (!role) return reply(res, { refused: { status: 404, code: "no-conglomerate", error: "No such conglomerate." } });
      if (act === "leave") return reply(res, { refused: { status: 409, code: "founder-cannot-leave", error: "The founder cannot leave. Transfer the founder role to a director first, or dissolve the conglomerate at the Bureau." } });
      return reply(res, { refused: { status: 403, code: "not-permitted", error: "Your role in this conglomerate cannot do that." } });
    }
    return handler(req, res);
  };
  route.conglomerateAction = action;
  return route;
}

const INVITATION_ACTION = (req) => (req.params.answer === "withdraw" ? "invite" : "answer-invitation");
const APPLICATION_ACTION = (req) => (req.params.answer === "withdraw" ? "withdraw-application" : "answer-application");
const number = (v) => bodyNumber(v, { fallback: null });

export function registerConglomerateRoutes(app) {
  const base = "/api/accounts/:accountId/conglomerates/:conglomerateId";
  app.post("/api/accounts/:accountId/conglomerates", guarded("charter", (req, res) => {
    const { name, emblem, colour } = req.body || {};
    const result = foundConglomerate(req.params.accountId, { name, emblem: number(emblem), colour: number(colour) });
    if (result.refused) return reply(res, result);
    res.status(201).json({ ...result.account, conglomerate: result.conglomerate });
  }));
  app.get("/api/conglomerates", requireAuth, guarded("directory", (_req, res) => res.json({ conglomerates: conglomerateDirectory() })));
  app.get("/api/accounts/:accountId/conglomerate", guarded("view-own", (req, res) => {
    reply(res, membershipView(req.params.accountId) || { refused: { status: 404, code: "no-account", error: "Account not found." } });
  }));

  // ISP-198 (AB#892): membership.
  app.post(`${base}/invitations`, guarded("invite", (req, res) => reply(res, inviteCorporation(req.params.accountId, req.params.conglomerateId, req.body?.corpId), 201)));
  app.post(`${base}/invitations/:invitationId/:answer`, guarded(INVITATION_ACTION, (req, res) => {
    const { accountId, conglomerateId, invitationId, answer } = req.params;
    reply(res, answerInvitation(accountId, conglomerateId, invitationId, answer));
  }));
  app.post(`${base}/applications`, guarded("apply", (req, res) => reply(res, applyToConglomerate(req.params.accountId, req.params.conglomerateId), 201)));
  app.post(`${base}/applications/:applicationId/:answer`, guarded(APPLICATION_ACTION, (req, res) => {
    const { accountId, conglomerateId, applicationId, answer } = req.params;
    reply(res, answerApplication(accountId, conglomerateId, applicationId, answer));
  }));
  app.post(`${base}/leave`, guarded("leave", (req, res) => reply(res, leaveConglomerate(req.params.accountId, req.params.conglomerateId))));

  // ISP-199 (AB#893): roles, removal, the founder's transfer, identity and dissolution. Removing a director needs
  // remove-director, which the rules check once they know the target's role.
  app.post(`${base}/members/:corpId/role`, guarded("set-director", (req, res) => reply(res, setMemberRole(req.params.accountId, req.params.conglomerateId, req.params.corpId, req.body?.role))));
  app.post(`${base}/members/:corpId/remove`, guarded("remove-member", (req, res) => reply(res, removeMember(req.params.accountId, req.params.conglomerateId, req.params.corpId))));
  app.post(`${base}/founder`, guarded("transfer-founder", (req, res) => reply(res, transferFounder(req.params.accountId, req.params.conglomerateId, req.body?.corpId))));
  app.post(`${base}/identity`, guarded("set-identity", (req, res) => reply(res, setIdentity(req.params.accountId, req.params.conglomerateId, { emblem: number(req.body?.emblem), colour: number(req.body?.colour) }))));
  app.post(`${base}/dissolve`, guarded("dissolve", (req, res) => reply(res, dissolveConglomerate(req.params.accountId, req.params.conglomerateId))));
  // ISP-202 (AB#896): the next level, named in the body so a repeated request cannot buy two.
  app.post(`${base}/level`, guarded("buy-level", (req, res) => reply(res, buyConglomerateLevel(req.params.accountId, req.params.conglomerateId, number(req.body?.level)))));
}
