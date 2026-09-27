// server/game/membership.js: joining and leaving a conglomerate (ISP-198, AB#892; docs/design/CONGLOMERATES.md, Part 1,
// "Membership"). Invitations and applications are the only ways in. Leaving is one way out; removal and dissolution
// are server/game/conglomerateRoles.js (ISP-199, AB#893), which also holds succession's rules (settleSuccession here
// runs them on every read of a conglomerate, so an absent founder is replaced before anything is decided).
//
// Every action names the acting account, and the corporation it acts for is that account's own: an invitation is
// answered only by the corporation it is addressed to, an application only by a founder or director of the
// conglomerate it was made to. An invitation or application is answered once; a second answer finds it closed (409).
// An id the caller cannot see is the same 404 as one that does not exist. The member cap is checked at acceptance,
// inside the same synchronous step that admits, so two acceptances for the last place admit exactly one.
//
// Events go to the conglomerate's socket room (cong:<id>) and to the affected corporation's own account; the listener
// in server/realtime.js delivers them. This module never imports the socket layer.

import { CONGLOMERATE_CATALOG, can } from "../conglomerates.js";
import { createId } from "./catalog.js";
import { pushSystemNotification } from "./progression.js";
import { accountsStore, saveAccountsNow } from "./store.js";
import { charterRefusal, conglomerateList, levelStatus, publicConglomerate, settleTreasury } from "./conglomerates.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const OPEN = { invitations: "invited", applications: "applied" };

const listeners = new Set();
/** Hear every membership event: { conglomerateId, event, payload, accounts, join, leave } (account ids). */
export function onConglomerateEvent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function publish(message) {
  for (const listener of listeners) {
    try { listener(message); } catch (error) { console.error("[conglomerates] an event listener failed:", error?.message || error); }
  }
}

const no = (status, code, error) => ({ refused: { status, code, error } });
const NOT_FOUND = { conglomerate: () => no(404, "no-conglomerate", "No such conglomerate."), invitation: () => no(404, "no-invitation", "No such invitation."), application: () => no(404, "no-application", "No such application.") };
const until = (t) => `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** The account whose corporation has this public id, or null. */
export function accountByCorp(publicId) {
  if (typeof publicId !== "string" || !publicId) return null;
  return Object.values(accountsStore.accounts || {}).find((a) => a?.state?.corp?.publicId === publicId) || null;
}
const corpName = (publicId) => accountByCorp(publicId)?.state?.corp?.corporationName || "";

/** A conglomerate that exists now: a dissolved one is kept only to hold its name, and is found by nothing. */
export function findConglomerate(id) {
  return typeof id === "string" ? conglomerateList().find((c) => c.id === id && !c.dissolvedAt) || null : null;
}

/** The corporation's role in the conglomerate, or null when it is not a member. */
export function roleOf(c, publicId) {
  return c?.members?.find((m) => m.corp === publicId)?.role || null;
}

/**
 * ISP-199 (AB#893): the founder's account deleted, or not signed in for founderAbsentDays, hands the founder role to
 * the longest-serving director (the longest-serving member when there is none). The old founder, if its account
 * still exists, becomes a director; one whose account is gone leaves the roster. Returns whether anything changed.
 */
export function settleSuccession(c, now = Date.now()) {
  const founder = c.members.find((m) => m.role === "founder");
  const account = accountByCorp(founder?.corp);
  const seen = Number(account?.lastLoginAt || account?.createdAt) || 0;
  if (founder && account && now - seen < CONGLOMERATE_CATALOG.founderAbsentDays * DAY_MS) return false;
  const byService = (role) => c.members.filter((m) => m.role === role).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  const heir = byService("director") || byService("member");
  if (!heir) return false;
  const heirWas = heir.role;
  if (founder) {
    if (account) founder.role = "director";
    else {
      c.members = c.members.filter((m) => m !== founder);
      if (!Array.isArray(c.past)) c.past = [];
      c.past.push({ corp: founder.corp, role: "founder", joinedAt: founder.joinedAt, state: "account-deleted", closedAt: now });
    }
  }
  heir.role = "founder";
  c.founder = heir.corp;
  const heirAccount = accountByCorp(heir.corp);
  if (heirAccount) pushSystemNotification(heirAccount, { type: "system", title: "You are now your conglomerate's founder", body: `${c.name}'s founder ${account ? `has not signed in for ${CONGLOMERATE_CATALOG.founderAbsentDays} days` : "no longer exists"}, so the founder role passed to your corporation, its longest-serving ${heirWas}.` });
  saveAccountsNow();
  roomEvent(c, "conglomerate:role-changed", { corp: heir.corp, corpName: corpName(heir.corp), role: "founder", reason: "succession" }, { accounts: [heirAccount?.id, account?.id].filter(Boolean) });
  return true;
}

/** Close invitations and applications whose time has run out (inviteExpiryDays, applicationExpiryDays). */
function expireOpen(c, now) {
  const days = { invitations: CONGLOMERATE_CATALOG.inviteExpiryDays, applications: CONGLOMERATE_CATALOG.applicationExpiryDays };
  for (const kind of ["invitations", "applications"]) {
    if (!Array.isArray(c[kind])) c[kind] = [];
    for (const r of c[kind]) if (r.state === OPEN[kind] && now >= r.at + days[kind] * DAY_MS) Object.assign(r, { state: "expired", closedAt: r.at + days[kind] * DAY_MS });
  }
}

/** Why the corporation cannot join anywhere now (already a member, or in its join cooldown), or null. */
function joinRefusal(corp, now, who = "Your corporation") {
  if (corp.conglomerateId) return no(409, "already-in-conglomerate", `${who} is already in a conglomerate. A corporation belongs to one at a time.`);
  const cooldown = Number(corp.joinCooldownUntil) || 0;
  if (cooldown > now) return no(409, "join-cooldown", `${who} left a conglomerate recently and cannot join one until ${until(cooldown)}.`);
  return null;
}

/** The acting account, its corporation, and the conglomerate (expired entries closed), or the refusal. */
function context(accountId, conglomerateId, now) {
  const account = accountsStore.accounts?.[accountId];
  const corp = account?.state?.corp;
  if (!corp?.publicId) return no(404, "no-account", "Account not found.");
  const c = findConglomerate(conglomerateId);
  if (!c) return NOT_FOUND.conglomerate();
  expireOpen(c, now);
  settleSuccession(c, now);
  settle(c, now);
  return { account, corp, c, role: roleOf(c, corp.publicId) };
}

/** ISP-204 (AB#898): bring the treasury up to `now` (settleTreasury), and tell members what it did. */
export function settle(c, now = Date.now()) {
  const events = settleTreasury(c, now);
  if (!events.length) return;
  saveAccountsNow();
  for (const { event, payload, notify } of events) {
    if (notify) for (const m of c.members) { const a = accountByCorp(m.corp); if (a) pushSystemNotification(a, { type: "system", ...notify }); }
    roomEvent(c, event, payload);
  }
}

/** A conglomerate in arrears admits nobody until it is paid up (the design's "Arrears"). */
function arrearsRefusal(c) {
  return c.arrearsSince ? no(409, "in-arrears", `${c.name} owes upkeep and cannot admit anyone until its treasury is paid up. A deposit that covers what is owed ends the arrears.`) : null;
}

/** Put the corporation in the conglomerate, and close every other invitation and application it holds. */
function admit(c, corp, now) {
  c.members.push({ corp: corp.publicId, role: "member", joinedAt: now });
  corp.conglomerateId = c.id;
  for (const other of conglomerateList()) {
    for (const kind of ["invitations", "applications"]) {
      for (const r of other[kind] || []) if (r.corp === corp.publicId && r.state === OPEN[kind]) Object.assign(r, { state: "withdrawn", closedAt: now });
    }
  }
}

export function roomEvent(c, event, extra, { accounts = [], join = [], leave = [] } = {}) {
  publish({ conglomerateId: c.id, event, payload: { conglomerate: publicConglomerate(c), ...extra }, accounts, join, leave });
}

export { context, no, until, corpName, NOT_FOUND, DAY_MS, HOUR_MS };

/** The acting account's role in the conglomerate now (after succession), or null: what the route guard asks can() about. */
export function actorRole(accountId, conglomerateId, now = Date.now()) {
  if (!conglomerateId) return null;
  const ctx = context(accountId, conglomerateId, now);
  return ctx.refused ? null : ctx.role;
}

const entryView = (r) => ({ id: r.id, corp: r.corp, corpName: corpName(r.corp), at: r.at, state: r.state });

/** Invite a corporation (by its public id). Founders and directors only; `invitesPerDay` per conglomerate. */
export function inviteCorporation(accountId, conglomerateId, targetCorpId, now = Date.now()) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  if (!can(role, "invite")) return no(403, "not-permitted", "Only the founder or a director can invite a corporation.");
  if (targetCorpId === corp.publicId) return no(409, "invite-self", "Your corporation is already in this conglomerate.");
  const target = accountByCorp(targetCorpId);
  if (!target) return no(404, "no-corporation", "No such corporation.");
  const refusal = joinRefusal(target.state.corp, now, "That corporation");
  if (refusal) return refusal;
  if (c.invitations.some((r) => r.corp === targetCorpId && r.state === "invited")) return no(409, "already-invited", "That corporation already has an open invitation from this conglomerate.");
  const sent = c.invitations.filter((r) => r.at > now - DAY_MS).length;
  if (sent >= CONGLOMERATE_CATALOG.invitesPerDay) {
    return no(429, "invite-limit", `A conglomerate can send ${CONGLOMERATE_CATALOG.invitesPerDay} invitations in 24 hours. Try again after ${until(c.invitations.filter((r) => r.at > now - DAY_MS)[0].at + DAY_MS)}.`);
  }
  const invitation = { id: createId("cinv"), corp: targetCorpId, by: corp.publicId, at: now, state: "invited", closedAt: null };
  c.invitations.push(invitation);
  saveAccountsNow();
  roomEvent(c, "conglomerate:invited", { invitation: entryView(invitation) }, { accounts: [target.id] });
  return { invitation: entryView(invitation) };
}

/** Apply to a conglomerate. One open application at a time. */
export function applyToConglomerate(accountId, conglomerateId, now = Date.now()) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { account, corp, c } = ctx;
  const refusal = joinRefusal(corp, now);
  if (refusal) return refusal;
  for (const other of conglomerateList()) expireOpen(other, now);
  if (conglomerateList().some((o) => o.applications.some((r) => r.corp === corp.publicId && r.state === "applied"))) {
    return no(409, "already-applied", "Your corporation already has an open application. Withdraw it before applying elsewhere.");
  }
  const application = { id: createId("capp"), corp: corp.publicId, at: now, state: "applied", closedAt: null };
  c.applications.push(application);
  saveAccountsNow();
  roomEvent(c, "conglomerate:applied", { application: entryView(application) }, { accounts: [account.id] });
  return { application: entryView(application) };
}

/** Accept, decline or withdraw an invitation. The invited corporation accepts or declines; the inviting side withdraws. */
export function answerInvitation(accountId, conglomerateId, invitationId, answer, now = Date.now()) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { account, corp, c, role } = ctx;
  const invitation = c.invitations.find((r) => r.id === invitationId);
  const invitee = invitation?.corp === corp.publicId;
  const inviter = can(role, "invite");
  // Only the two sides can see an invitation; anyone else is told it does not exist.
  if (!invitation || (answer === "withdraw" ? !inviter : !invitee)) return NOT_FOUND.invitation();
  if (invitation.state !== "invited") return no(409, "invitation-closed", `This invitation is ${invitation.state}; it cannot be answered again.`);
  if (answer === "accept") {
    const refusal = joinRefusal(corp, now) || arrearsRefusal(c);
    if (refusal) return refusal;
    if (c.members.length >= c.maxMembers) return no(409, "conglomerate-full", `${c.name} has no room: it has ${c.members.length} of ${c.maxMembers} members. The invitation stays open until it has room or expires.`);
    Object.assign(invitation, { state: "member", closedAt: now });
    admit(c, corp, now);
    saveAccountsNow();
    roomEvent(c, "conglomerate:joined", { corp: corp.publicId, corpName: corp.corporationName }, { accounts: [account.id], join: [account.id] });
    return { invitation: entryView(invitation), conglomerate: publicConglomerate(c) };
  }
  Object.assign(invitation, { state: answer === "decline" ? "declined" : "withdrawn", closedAt: now });
  saveAccountsNow();
  roomEvent(c, "conglomerate:invitation-closed", { invitation: entryView(invitation) }, { accounts: [accountByCorp(invitation.corp)?.id].filter(Boolean) });
  return { invitation: entryView(invitation) };
}

/** Accept, decline or withdraw an application. A founder or director accepts or declines; the applicant withdraws. */
export function answerApplication(accountId, conglomerateId, applicationId, answer, now = Date.now()) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  const application = c.applications.find((r) => r.id === applicationId);
  const applicant = application?.corp === corp.publicId;
  const answerer = can(role, "answer-application");
  if (!application || (answer === "withdraw" ? !applicant : !answerer)) return NOT_FOUND.application();
  if (application.state !== "applied") return no(409, "application-closed", `This application is ${application.state}; it cannot be answered again.`);
  const applicantAccount = accountByCorp(application.corp);
  if (answer === "accept") {
    if (!applicantAccount) return NOT_FOUND.application();
    const joiner = applicantAccount.state.corp;
    const refusal = joinRefusal(joiner, now, "That corporation") || arrearsRefusal(c);
    if (refusal) return refusal;
    if (c.members.length >= c.maxMembers) return no(409, "conglomerate-full", `${c.name} has no room: it has ${c.members.length} of ${c.maxMembers} members. Buy the next level at the Bureau, or wait for a place.`);
    Object.assign(application, { state: "member", closedAt: now });
    admit(c, joiner, now);
    saveAccountsNow();
    roomEvent(c, "conglomerate:joined", { corp: joiner.publicId, corpName: joiner.corporationName }, { accounts: [applicantAccount.id], join: [applicantAccount.id] });
    return { application: entryView(application), conglomerate: publicConglomerate(c) };
  }
  Object.assign(application, { state: answer === "decline" ? "declined" : "withdrawn", closedAt: now });
  saveAccountsNow();
  roomEvent(c, "conglomerate:application-closed", { application: entryView(application) }, { accounts: [applicantAccount?.id].filter(Boolean) });
  return { application: entryView(application) };
}

/** Leave. Any member but the founder; the corporation serves the join cooldown. */
export function leaveConglomerate(accountId, conglomerateId, now = Date.now()) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { account, corp, c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  if (!can(role, "leave")) {
    return no(409, "founder-cannot-leave", "The founder cannot leave. Transfer the founder role to a director first, or dissolve the conglomerate at the Bureau.");
  }
  const member = c.members.find((m) => m.corp === corp.publicId);
  c.members = c.members.filter((m) => m !== member);
  if (!Array.isArray(c.past)) c.past = [];
  c.past.push({ corp: corp.publicId, role: member.role, joinedAt: member.joinedAt, state: "left", closedAt: now });
  corp.conglomerateId = null;
  corp.joinCooldownUntil = now + CONGLOMERATE_CATALOG.joinCooldownHours * HOUR_MS;
  saveAccountsNow();
  roomEvent(c, "conglomerate:left", { corp: corp.publicId, corpName: corp.corporationName }, { accounts: [account.id], leave: [account.id] });
  return { conglomerate: publicConglomerate(c), joinCooldownUntil: corp.joinCooldownUntil };
}

/**
 * What the account may see: its conglomerate in full when it is a member (roster, treasury, open invitations and
 * applications), the invitations addressed to it, and its own open application.
 */
export function membershipView(accountId, now = Date.now()) {
  const account = accountsStore.accounts?.[accountId];
  const corp = account?.state?.corp;
  if (!corp?.publicId) return null;
  for (const c of conglomerateList()) expireOpen(c, now);
  const mine = findConglomerate(corp.conglomerateId);
  if (mine) { settleSuccession(mine, now); settle(mine, now); }
  const invitations = [];
  let application = null;
  for (const c of conglomerateList()) {
    for (const r of c.invitations) if (r.corp === corp.publicId && r.state === "invited") invitations.push({ ...entryView(r), conglomerate: publicConglomerate(c) });
    const open = c.applications.find((r) => r.corp === corp.publicId && r.state === "applied");
    if (open) application = { ...entryView(open), conglomerate: publicConglomerate(c) };
  }
  return {
    conglomerate: mine && can(roleOf(mine, corp.publicId), "view") ? {
      ...publicConglomerate(mine),
      role: roleOf(mine, corp.publicId),
      // ISP-200 (AB#894): what this role may do, from can(), so the Bureau offers only those controls and mirrors no table.
      permissions: CONGLOMERATE_CATALOG.permissions.map((p) => p.id).filter((id) => can(roleOf(mine, corp.publicId), id)),
      maxDirectors: CONGLOMERATE_CATALOG.maxDirectors,
      // ISP-202 (AB#896): the next level, its price and each requirement as the server reads it (the Bureau shows these).
      levels: levelStatus(mine, now),
      // ISP-203 (AB#897): a level reached since this member last saw the overlay, or null
      levelReached: mine.members.find((m) => m.corp === corp.publicId)?.levelReached ?? null,
      founderAbsentDays: CONGLOMERATE_CATALOG.founderAbsentDays,
      members: mine.members.map((m) => ({ corp: m.corp, corpName: corpName(m.corp), role: m.role, joinedAt: m.joinedAt })),
      treasury: { ...mine.treasury },
      invitations: mine.invitations.filter((r) => r.state === "invited").map(entryView),
      applications: mine.applications.filter((r) => r.state === "applied").map(entryView)
    } : null,
    invitations,
    application,
    joinCooldownUntil: Number(corp.joinCooldownUntil) > now ? corp.joinCooldownUntil : null,
    // ISP-200 (AB#894): whether this corporation may file a charter now, and if not the server's own reason, so the
    // Bureau shows the refusal the route would give rather than working it out again in the page.
    charter: {
      fee: CONGLOMERATE_CATALOG.charterFee,
      deposit: CONGLOMERATE_CATALOG.charterDeposit,
      minFounderAgeDays: CONGLOMERATE_CATALOG.minFounderAgeDays,
      refusal: (({ refused } = {}) => (refused ? { code: refused.code, error: refused.error } : null))(charterRefusal(account, now) || {})
    }
  };
}

/** Every conglomerate id the account's corporation is a member of (at most one): the socket rooms it belongs in. */
export function conglomerateRoomsFor(accountId) {
  const corp = accountsStore.accounts?.[accountId]?.state?.corp;
  const c = findConglomerate(corp?.conglomerateId);
  return c && roleOf(c, corp.publicId) ? [c.id] : [];
}

/** Whether the account's corporation is a member of the conglomerate now: checked again at every delivery. */
export function isMemberAccount(accountId, conglomerateId) {
  const corp = accountsStore.accounts?.[accountId]?.state?.corp;
  return Boolean(corp?.publicId && corp.conglomerateId === conglomerateId && roleOf(findConglomerate(conglomerateId), corp.publicId));
}
