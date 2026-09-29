// server/game/stationGovernance.js: governing a conglomerate's station by stake (ISP-211, AB#906; docs/design/
// CONGLOMERATES.md Part 2, "Governance" and "Access lists"). The rules for stakes themselves are server/game/stakes.js.
//
// - The station's settings are chosen from fixed options: who may dock (`open`, `members`, or `members-and-listed`),
//   and which other conglomerates are listed. No per-corporation grants and no free text.
// - The founder or a director proposes one change. Each corporation with a stake votes once, yes or no; the proposer's
//   own stake votes yes. The change passes when more than half of all stake has voted yes, and is applied then; it
//   fails when half or more has voted no, or when stationVoteHours (72) pass first. Stakes vote, not headcount.
// - Fails closed: a tally that cannot be read (stakes that do not sum to 10,000, a value that is not a number) decides
//   nothing, and the setting stays as it was.
// - A station nobody paid into (built wholly from the pool) has no stakes; there the founder's vote is the whole, since
//   the founder is the one who moved the pool.
// What the settings do: `dockRefusal` keeps a corporation the access setting excludes from docking there (the travel
// route asks it). The member tax and office rate are the station exchange's and office stories' to charge.

import { CONGLOMERATE_CATALOG, can } from "../conglomerates.js";
import { createId } from "./catalog.js";
import { stationById } from "./stations.js";
import { pushSystemNotification } from "./progression.js";
import { saveAccountsNow } from "./store.js";
import { conglomerateList } from "./conglomerates.js";
import { NOT_FOUND, accountByCorp, context, corpName, findConglomerate, no, roomEvent } from "./membership.js";
import { TOTAL_BPS, ensureStakes, settleBuyouts, stakesAreWhole } from "./stakes.js";

const HOUR_MS = 60 * 60 * 1000;
export const STATION_ACCESS = Object.freeze(["open", "members", "members-and-listed"]);
const ACCESS_TEXT = { open: "every corporation", members: "members only", "members-and-listed": "members and the listed conglomerates" };
const SETTINGS = ["access", "list", "unlist"];

/** The station's settings and proposals, created with their defaults (open, nobody listed) the first time. */
export function ensureStation(c) {
  if (!c?.station) return null;
  ensureStakes(c);
  if (!c.station.settings || typeof c.station.settings !== "object") c.station.settings = { access: "open", listed: [] };
  if (!Array.isArray(c.station.settings.listed)) c.station.settings.listed = [];
  if (!Array.isArray(c.station.proposals)) c.station.proposals = [];
  return c.station;
}

/** The vote's weights: each stakeholder's contributed value, or the founder's alone when nobody holds a stake. */
function weights(c) {
  const stakes = c.station.stakes || {};
  if (!stakesAreWhole(stakes)) throw new Error("the stakes do not sum to 100%");
  const list = Object.entries(stakes).map(([corp, s]) => [corp, s.value]);
  if (list.length) return Object.fromEntries(list);
  const founder = c.members.find((m) => m.role === "founder")?.corp;
  return founder ? { [founder]: 1 } : {};
}

/** { yes, no, total } by weight; throws when the weights cannot be read. */
function tally(c, p) {
  const w = weights(c);
  const total = Object.values(w).reduce((s, v) => s + v, 0);
  if (!(total > 0) || !Number.isFinite(total)) throw new Error("there is no stake to weigh");
  let yes = 0, nay = 0;
  for (const [corp, vote] of Object.entries(p.votes)) {
    if (!(corp in w)) continue; // a vote from a corporation that no longer holds a stake counts for nothing
    if (vote === "yes") yes += w[corp];
    else if (vote === "no") nay += w[corp];
  }
  return { yes, no: nay, total };
}

function apply(c, p) {
  const s = c.station.settings;
  if (p.setting === "access") s.access = p.value;
  else if (p.setting === "list" && !s.listed.includes(p.value)) s.listed.push(p.value);
  else if (p.setting === "unlist") s.listed = s.listed.filter((id) => id !== p.value);
}

/** Decide `p` if it can be decided now. Returns true when it closed. Fails closed: an unreadable tally changes nothing. */
function decide(c, p, now) {
  if (p.state !== "open") return false;
  let t;
  try {
    t = tally(c, p);
  } catch (error) {
    console.error(`[station-governance] ${c.id}'s proposal ${p.id} cannot be tallied: ${error?.message || error}`);
    return false;
  }
  if (t.yes * 2 > t.total) {
    apply(c, p);
    Object.assign(p, { state: "passed", closedAt: now });
  } else if (t.no * 2 >= t.total) Object.assign(p, { state: "rejected", closedAt: now });
  else if (now >= p.closesAt) Object.assign(p, { state: "expired", closedAt: now });
  else return false;
  const title = p.state === "passed" ? "A station change passed" : "A station change did not pass";
  // ISP-254 (AB#4821): passed is In force, voted down is Denied, closed without a majority is Lapsed
  const RESULT_MEANING = { passed: "active", rejected: "refused", expired: "expired" };
  for (const m of c.members) {
    const account = accountByCorp(m.corp);
    if (account) pushSystemNotification(account, { type: "system", protocol: { meaning: RESULT_MEANING[p.state], screen: "conglomerate" }, title, body: `${describe(p)}: ${p.state === "passed" ? "passed by stake, and is in force" : p.state === "expired" ? "the vote closed without a majority" : "voted down by stake"}.` });
  }
  roomEvent(c, "conglomerate:station-vote", { proposal: proposalView(c, p), settings: settingsView(c) });
  return true;
}

/** Close what can be closed, pay what buyouts are due. Returns whether anything changed. */
export function settleStationGovernance(c, now = Date.now()) {
  let changed = settleBuyouts(c, now).length > 0;
  if (c.station) {
    ensureStation(c);
    for (const p of c.station.proposals) changed = decide(c, p, now) || changed;
  }
  if (changed) saveAccountsNow();
  return changed;
}

/** The tick: every conglomerate's proposals and buyouts, so they settle with nobody watching. */
export function settleAllStationGovernance(now = Date.now()) {
  for (const c of conglomerateList()) {
    if (c.dissolvedAt) continue;
    try {
      settleStationGovernance(c, now);
    } catch (error) {
      console.error(`[station-governance] ${c?.id}:`, error?.message || error);
    }
  }
}

const conglomerateName = (id) => conglomerateList().find((x) => x.id === id)?.name || "a conglomerate";
function describe(p) {
  if (p.setting === "access") return `Docking at the station: ${ACCESS_TEXT[p.value]}`;
  return `${p.setting === "list" ? "List" : "Unlist"} ${conglomerateName(p.value)}`;
}

/**
 * Propose a change: `{ setting: "access", value }`, or `{ setting: "list" | "unlist", conglomerateId }`. The founder
 * or a director. One open proposal per setting (per conglomerate, for a listing).
 */
export function proposeStationSetting(accountId, conglomerateId, { setting, value, conglomerateId: target } = {}, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  if (!c.station) return no(409, "no-station", `${c.name} has no station to govern.`);
  settleStationGovernance(c, now);
  if (!can(role, "propose-station-setting")) return no(403, "not-permitted", "Only the founder or a director can propose a change to the station.");
  if (!SETTINGS.includes(setting)) return no(400, "unknown-setting", "Propose a change to who may dock, or to the listed conglomerates.");
  const s = ensureStation(c).settings;
  let v;
  if (setting === "access") {
    if (!STATION_ACCESS.includes(value)) return no(400, "unknown-access", `Docking is one of: ${STATION_ACCESS.join(", ")}.`);
    if (s.access === value) return no(409, "already-set", `Docking is already ${ACCESS_TEXT[value]}.`);
    v = value;
  } else {
    const other = findConglomerate(target);
    if (!other || other.id === c.id) return no(400, "unknown-conglomerate", "Choose another conglomerate from the directory.");
    if (setting === "list" && s.listed.includes(other.id)) return no(409, "already-listed", `${other.name} is already listed.`);
    if (setting === "unlist" && !s.listed.includes(other.id)) return no(409, "not-listed", `${other.name} is not listed.`);
    v = other.id;
  }
  const key = setting === "access" ? "access" : `listing:${v}`;
  if (c.station.proposals.some((p) => p.state === "open" && p.key === key)) return no(409, "proposal-open", "A vote on that is already open.");
  const p = { id: createId("csv"), key, setting, value: v, proposedBy: corp.publicId, at: now, closesAt: now + catalog.stationVoteHours * HOUR_MS, votes: {}, state: "open" };
  let w = {};
  try { w = weights(c); } catch { /* the tally refuses it below */ }
  if (corp.publicId in w) p.votes[corp.publicId] = "yes"; // the proposer's own stake is for it
  c.station.proposals.push(p);
  decide(c, p, now);
  saveAccountsNow();
  for (const m of c.members) {
    const account = accountByCorp(m.corp);
    if (account && m.corp !== corp.publicId && p.state === "open") pushSystemNotification(account, { type: "system", protocol: { meaning: "pending", screen: "conglomerate" }, title: "A station vote is open", body: `${corpName(corp.publicId)} proposed: ${describe(p)}. Stakeholders have ${catalog.stationVoteHours} hours to vote.` });
  }
  if (p.state === "open") roomEvent(c, "conglomerate:station-vote", { proposal: proposalView(c, p), settings: settingsView(c) });
  return { proposal: proposalView(c, p), settings: settingsView(c) };
}

/** Vote `vote` ("yes" or "no") on an open proposal, as the caller's own corporation. Stakeholders, once each. */
export function voteOnStationProposal(accountId, conglomerateId, proposalId, vote, now = Date.now()) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  if (!c.station) return no(409, "no-station", `${c.name} has no station to govern.`);
  settleStationGovernance(c, now);
  const p = ensureStation(c).proposals.find((x) => x.id === proposalId);
  if (!p) return no(404, "no-proposal", "No such proposal.");
  if (vote !== "yes" && vote !== "no") return no(400, "unknown-vote", "Vote yes or no.");
  if (p.state !== "open") return no(409, "vote-closed", "That vote has closed.");
  let w;
  try { w = weights(c); } catch { return no(503, "vote-unavailable", "The stakes cannot be read just now; no vote was recorded. Try again later."); } // AB#4821 (ISP-6)
  if (!(corp.publicId in w)) return no(403, "no-stake", "Only a corporation with a stake in the station votes on it.");
  if (p.votes[corp.publicId]) return no(409, "already-voted", `Your corporation has already voted ${p.votes[corp.publicId]}.`);
  p.votes[corp.publicId] = vote;
  if (!decide(c, p, now)) roomEvent(c, "conglomerate:station-vote", { proposal: proposalView(c, p), settings: settingsView(c) });
  saveAccountsNow();
  return { proposal: proposalView(c, p), settings: settingsView(c) };
}

/**
 * ISP-212 (AB#907): `corp`'s own conglomerate's station as the member rates need it, { id, officeRentPct }, or null.
 * Read from the roster at the moment of the order, so a corporation removed a moment ago is charged as anyone else.
 */
export function memberStation(corp, catalog = CONGLOMERATE_CATALOG) {
  const c = findConglomerate(corp?.conglomerateId);
  if (!c?.station || !stationById(c.station.id) || !c.members.some((m) => m.corp === corp.publicId)) return null;
  return { id: c.station.id, officeRentPct: catalog.stationMemberRentPct };
}

/**
 * Why `corp` may not dock at `stationId`, or null. Only a conglomerate's station can refuse anyone, by its access
 * setting; a station whose conglomerate is gone refuses nobody.
 */
export function dockRefusal(corp, stationId) {
  const station = stationById(stationId);
  if (station?.owner?.type !== "conglomerate") return null;
  const c = findConglomerate(station.owner.id);
  if (!c?.station || c.station.id !== station.id) return null;
  const { access, listed } = ensureStation(c).settings;
  if (access === "open" || corp?.conglomerateId === c.id) return null;
  if (access === "members-and-listed" && listed.includes(corp?.conglomerateId)) return null;
  return `${station.name} admits ${ACCESS_TEXT[access]}, by the vote of ${c.name}'s stakeholders. Dock at another station in this system.`; // AB#4831 (ISP-6)
}

function settingsView(c) {
  const s = c.station.settings;
  return { access: s.access, listed: s.listed.map((id) => ({ id, name: conglomerateName(id) })) };
}
function proposalView(c, p) {
  let t = null;
  try { t = tally(c, p); } catch { /* shown as not countable */ }
  const pct = (x) => (t ? Math.round((x / t.total) * 1000) / 10 : null);
  return {
    id: p.id, setting: p.setting, value: p.value, text: describe(p), state: p.state, proposedBy: p.proposedBy, proposedByName: corpName(p.proposedBy),
    at: p.at, closesAt: p.closesAt, closedAt: p.closedAt ?? null, yesPct: t ? pct(t.yes) : null, noPct: t ? pct(t.no) : null,
    votes: Object.entries(p.votes).map(([corp, vote]) => ({ corp, corpName: corpName(corp), vote }))
  };
}

/** The station's stakes, settings, votes and buyouts, for members (the station-project view carries it). */
export function stationGovernanceView(c) {
  if (!c.station) return null;
  ensureStation(c);
  return {
    stakes: Object.entries(c.station.stakes).map(([corp, s]) => ({ corp, corpName: corpName(corp), value: s.value, pct: s.bps / (TOTAL_BPS / 100) })).sort((a, b) => b.value - a.value),
    settings: settingsView(c),
    proposals: c.station.proposals.slice(-20).reverse().map((p) => proposalView(c, p)),
    buyouts: (c.buyouts || []).filter((b) => b.state === "paying").map((b) => ({ corp: b.corp, corpName: corpName(b.corp), how: b.how, total: b.total, paid: b.paid, days: b.days, startsAt: b.startsAt }))
  };
}

/** GET: the station, its stakes (members only: the route is behind "view"), settings, votes and buyouts. */
export function stationGovernanceRead(accountId, conglomerateId, now = Date.now()) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  if (!c.station) return no(404, "no-station", `${c.name} has no station.`);
  settleStationGovernance(c, now);
  const station = stationById(c.station.id);
  return { station: { id: c.station.id, name: station?.name ?? null, systemId: station?.systemId ?? null, body: station?.body ?? null, builtAt: c.station.builtAt }, ...stationGovernanceView(c) };
}
