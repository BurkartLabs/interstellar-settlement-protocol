// server/game/conglomerateRoles.js: roles, removal, the founder's transfer and dissolution (ISP-199, AB#893;
// docs/design/CONGLOMERATES.md, Part 1, "Roles" and "Dissolution"). Succession itself is settleSuccession in
// server/game/membership.js, run on every read of a conglomerate.
//
// Every action checks can(role, action) (server/conglomerates.js) against the role the server holds now, never one a
// client sends, so a member demoted a moment ago is refused on its next request. Each action is one synchronous step:
// the founder's transfer swaps both roles together, and two transfers at once leave exactly one founder. The affected
// corporation is told through its own account (a notification, and the event on its account room).

import { CONGLOMERATE_CATALOG, can } from "../conglomerates.js";
import { applyCredits } from "../finances.js";
import { pushSystemNotification } from "./progression.js";
import { saveAccountsNow } from "./store.js";
import { publicConglomerate } from "./conglomerates.js";
import { HOUR_MS, NOT_FOUND, accountByCorp, context, corpName, no, roomEvent } from "./membership.js";

const ROLE_WORD = { founder: "founder", director: "director", member: "member" };

/** The acting context and the target member, or the refusal. A caller who is not a member is told the conglomerate does not exist. */
function withTarget(accountId, conglomerateId, targetCorpId, now) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  if (!ctx.role) return NOT_FOUND.conglomerate();
  const target = ctx.c.members.find((m) => m.corp === targetCorpId);
  if (!target) return no(404, "no-member", "That corporation is not a member of this conglomerate.");
  return { ...ctx, target, targetAccount: accountByCorp(target.corp) };
}

function tell(account, title, body) {
  if (account) pushSystemNotification(account, { type: "system", title, body });
}

/** Promote a member to director, or demote a director to member. The founder only; at most maxDirectors directors. */
export function setMemberRole(accountId, conglomerateId, targetCorpId, role, now = Date.now()) {
  const ctx = withTarget(accountId, conglomerateId, targetCorpId, now);
  if (ctx.refused) return ctx;
  const { corp, c, target, targetAccount } = ctx;
  if (!can(ctx.role, "set-director")) return no(403, "not-permitted", "Only the founder can promote or demote.");
  if (role !== "director" && role !== "member") return no(400, "unknown-role", "A member can be made a director or a member; the founder role moves only by transfer.");
  if (target.corp === corp.publicId || target.role === "founder") return no(409, "founder-role", "The founder's role changes only by transferring it to a director.");
  if (target.role === role) return no(409, "same-role", `That corporation is already a ${ROLE_WORD[role]}.`);
  if (role === "director" && c.members.filter((m) => m.role === "director").length >= CONGLOMERATE_CATALOG.maxDirectors) {
    return no(409, "directors-full", `A conglomerate has at most ${CONGLOMERATE_CATALOG.maxDirectors} directors. Demote one first.`);
  }
  target.role = role;
  saveAccountsNow();
  tell(targetAccount, role === "director" ? "Promoted to director" : "Demoted to member", `Your corporation is now a ${ROLE_WORD[role]} of ${c.name}.`);
  roomEvent(c, "conglomerate:role-changed", { corp: target.corp, corpName: corpName(target.corp), role }, { accounts: [targetAccount?.id].filter(Boolean) });
  return { member: { corp: target.corp, role }, conglomerate: publicConglomerate(c) };
}

/** Remove a member. A director removes members; only the founder removes a director; nobody removes the founder. */
export function removeMember(accountId, conglomerateId, targetCorpId, now = Date.now()) {
  const ctx = withTarget(accountId, conglomerateId, targetCorpId, now);
  if (ctx.refused) return ctx;
  const { corp, c, target, targetAccount } = ctx;
  if (target.corp === corp.publicId) return no(409, "remove-self", "To go, leave the conglomerate instead.");
  if (target.role === "founder") return no(403, "not-permitted", "The founder cannot be removed.");
  const action = target.role === "director" ? "remove-director" : "remove-member";
  if (!can(ctx.role, action)) return no(403, "not-permitted", target.role === "director" ? "Only the founder can remove a director." : "Only the founder or a director can remove a member.");
  c.members = c.members.filter((m) => m !== target);
  if (!Array.isArray(c.past)) c.past = [];
  c.past.push({ corp: target.corp, role: target.role, joinedAt: target.joinedAt, state: "removed", closedAt: now, by: corp.publicId });
  const joinCooldownUntil = now + CONGLOMERATE_CATALOG.joinCooldownHours * HOUR_MS;
  if (targetAccount) Object.assign(targetAccount.state.corp, { conglomerateId: null, joinCooldownUntil });
  saveAccountsNow();
  tell(targetAccount, "Removed from a conglomerate", `Your corporation was removed from ${c.name}. It can join another conglomerate after ${CONGLOMERATE_CATALOG.joinCooldownHours} hours.`);
  roomEvent(c, "conglomerate:removed", { corp: target.corp, corpName: corpName(target.corp) }, { accounts: [targetAccount?.id].filter(Boolean), leave: [targetAccount?.id].filter(Boolean) });
  return { conglomerate: publicConglomerate(c) };
}

/** Transfer the founder role to a director: the director becomes founder and the founder a director, together. */
export function transferFounder(accountId, conglomerateId, targetCorpId, now = Date.now()) {
  const ctx = withTarget(accountId, conglomerateId, targetCorpId, now);
  if (ctx.refused) return ctx;
  const { corp, c, target, targetAccount } = ctx;
  if (!can(ctx.role, "transfer-founder")) return no(403, "not-permitted", "Only the founder can transfer the founder role.");
  if (target.role !== "director") return no(409, "not-a-director", "The founder role can only go to a director. Promote the corporation first.");
  const founder = c.members.find((m) => m.corp === corp.publicId);
  founder.role = "director";
  target.role = "founder";
  c.founder = target.corp;
  saveAccountsNow();
  tell(targetAccount, "You are now your conglomerate's founder", `${corp.corporationName} transferred the founder role of ${c.name} to your corporation.`);
  roomEvent(c, "conglomerate:role-changed", { corp: target.corp, corpName: corpName(target.corp), role: "founder", reason: "transfer" }, { accounts: [targetAccount?.id].filter(Boolean) });
  return { founder: target.corp, conglomerate: publicConglomerate(c) };
}

/** Choose the emblem and colour, from the Bureau's fixed lists. The founder only. */
export function setIdentity(accountId, conglomerateId, { emblem, colour } = {}, now = Date.now()) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  if (!ctx.role) return NOT_FOUND.conglomerate();
  if (!can(ctx.role, "set-identity")) return no(403, "not-permitted", "Only the founder can choose the emblem and colour.");
  if (!Number.isInteger(emblem) || emblem < 1 || emblem > CONGLOMERATE_CATALOG.emblems) return no(400, "invalid-emblem", `Choose an emblem from the Bureau's ${CONGLOMERATE_CATALOG.emblems}.`);
  if (!Number.isInteger(colour) || colour < 1 || colour > CONGLOMERATE_CATALOG.colours) return no(400, "invalid-colour", `Choose a colour from the Bureau's ${CONGLOMERATE_CATALOG.colours}.`);
  Object.assign(ctx.c, { emblem, colour });
  saveAccountsNow();
  roomEvent(ctx.c, "conglomerate:identity-changed", {});
  return { conglomerate: publicConglomerate(ctx.c) };
}

/**
 * Dissolve the conglomerate, at the Bureau. The founder only. Every member leaves with no join cooldown; the treasury
 * is split equally among the corporations that were members at that moment, whole credits, the remainder to the
 * founder; the name stays held for nameReleaseDays. There is no hangar yet (Part 2): when there is, its goods are
 * split the same way. Pending invitations and applications are withdrawn.
 */
export function dissolveConglomerate(accountId, conglomerateId, now = Date.now()) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c } = ctx;
  if (!ctx.role) return NOT_FOUND.conglomerate();
  if (!can(ctx.role, "dissolve")) return no(403, "not-permitted", "Only the founder can dissolve the conglomerate.");
  if (corp.currentStationId !== CONGLOMERATE_CATALOG.charterStationId) return no(409, "not-at-bureau", "A conglomerate is dissolved at the Conglomerate Affairs Bureau on Earth Station Prime. Travel there, then dissolve it.");
  const members = c.members.map((m) => ({ ...m, account: accountByCorp(m.corp) })).filter((m) => m.account);
  const credits = Math.max(0, Math.floor(Number(c.treasury?.credits) || 0));
  const share = Math.floor(credits / members.length);
  const remainder = credits - share * members.length;
  const paid = [];
  for (const m of members) {
    const amount = share + (m.role === "founder" ? remainder : 0);
    if (amount > 0) applyCredits(m.account.state.corp, amount, "conglomerate-dissolution", now);
    paid.push({ corp: m.corp, credits: amount });
  }
  // Tell the room before it empties, then empty it.
  roomEvent(c, "conglomerate:dissolved", { shares: paid }, { accounts: members.map((m) => m.account.id), leave: members.map((m) => m.account.id) });
  for (const m of members) {
    m.account.state.corp.conglomerateId = null;
    if (m.corp !== corp.publicId) tell(m.account, "Conglomerate dissolved", `${c.name} was dissolved by its founder. Your corporation's share of the treasury, ${paid.find((p) => p.corp === m.corp).credits.toLocaleString("en-US")} credits, has been paid to it.`);
  }
  if (!Array.isArray(c.past)) c.past = [];
  for (const m of c.members) c.past.push({ corp: m.corp, role: m.role, joinedAt: m.joinedAt, state: "dissolved", closedAt: now });
  for (const r of [...c.invitations, ...c.applications]) if (r.state === "invited" || r.state === "applied") Object.assign(r, { state: "withdrawn", closedAt: now });
  c.members = [];
  c.treasury = { credits: 0 };
  c.dissolvedAt = now;
  saveAccountsNow();
  return { dissolved: { id: c.id, name: c.name, shares: paid, nameReleasedAt: now + CONGLOMERATE_CATALOG.nameReleaseDays * 24 * HOUR_MS } };
}
