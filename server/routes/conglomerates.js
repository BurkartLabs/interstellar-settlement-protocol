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
import { blockWithdrawal, depositToTreasury, treasuryView, withdrawFromTreasury } from "../game/treasury.js";
import { depositGoods, hangarView, withdrawGoods } from "../game/hangar.js";
import { conglomerateIntel } from "../game/intel.js";
import { accountsStore } from "../game/store.js";
import { BELT_KEYS } from "../game/asteroids.js";
import { beltAt } from "../game/belts.js";
import { getState } from "../gameState.js";
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
function guarded(action, handler, { outsider } = {}) {
  const route = (req, res) => {
    const act = typeof action === "function" ? action(req) : action;
    const role = actorRole(req.params.accountId, req.params.conglomerateId);
    if (!can(role, act)) {
      if (!role && outsider) return res.status(outsider.status).json(outsider.body); // a route that answers outsiders its own way
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

  // ISP-204 (AB#898): the treasury. The ledger has no route that edits or removes a row: it is only ever read here.
  // ISP-206 (AB#901): the ledger a page at a time, newest first (?offset=&limit=).
  const page = (req) => ({ offset: number(req.query?.offset) ?? 0, limit: number(req.query?.limit) ?? 25 });
  app.get(`${base}/treasury`, guarded("view", (req, res) => reply(res, treasuryView(req.params.accountId, req.params.conglomerateId, undefined, undefined, page(req)))));
  app.post(`${base}/treasury/deposit`, guarded("contribute", (req, res) => reply(res, depositToTreasury(req.params.accountId, req.params.conglomerateId, number(req.body?.amount)))));
  app.post(`${base}/treasury/withdraw`, guarded("withdraw-credits", (req, res) => reply(res, withdrawFromTreasury(req.params.accountId, req.params.conglomerateId, number(req.body?.amount)))));
  app.post(`${base}/treasury/withdrawals/:withdrawalId/block`, guarded("block-withdrawal", (req, res) => reply(res, blockWithdrawal(req.params.accountId, req.params.conglomerateId, req.params.withdrawalId))));

  // ISP-207 (AB#902): intel shared among members. Membership is confirmed on every read; anyone else gets 403 and
  // nothing, whether the conglomerate exists or not.
  const NO_INTEL = { status: 403, body: { error: "Only a conglomerate's current members see its intel.", code: "not-a-member", belts: [], listings: [] } };
  app.get(`${base}/intel`, guarded("view", (req, res) => {
    const corp = accountsStore.accounts?.[req.params.accountId]?.state?.corp;
    const state = getState();
    const intel = conglomerateIntel(corp, { belts: BELT_KEYS.map((key) => beltAt(state, key)).filter(Boolean), orderBook: state.market?.orderBook || [] });
    if (!intel || intel.conglomerate.id !== req.params.conglomerateId) return res.status(NO_INTEL.status).json(NO_INTEL.body);
    res.json(intel);
  }, { outsider: NO_INTEL }));

  // ISP-205 (AB#899): the goods hangar. Its ledger, like the treasury's, is only ever read here.
  const goods = (req) => ({ stationId: req.body?.stationId, item: req.body?.item, quantity: number(req.body?.quantity) });
  app.get(`${base}/hangar`, guarded("view", (req, res) => reply(res, hangarView(req.params.accountId, req.params.conglomerateId, undefined, undefined, page(req)))));
  app.post(`${base}/hangar/deposit`, guarded("contribute", (req, res) => reply(res, depositGoods(req.params.accountId, req.params.conglomerateId, goods(req)))));
  app.post(`${base}/hangar/withdraw`, guarded("withdraw-goods", (req, res) => reply(res, withdrawGoods(req.params.accountId, req.params.conglomerateId, goods(req)))));
}
