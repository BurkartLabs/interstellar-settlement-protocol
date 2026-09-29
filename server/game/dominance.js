// server/game/dominance.js: corporate and conglomerate dominance per system (ISP-217, AB#912; docs/design/CONGLOMERATES.md,
// "The dominance metric"). One number per system and holder, from what the server holds, over the dominanceWindowDays
// (7) full UTC days before the computation:
//
//   L = the holder's active leases on bodies in the system / all of them
//   X = tonnes it extracted in the system / all tonnes extracted there        (server/game/dominanceCounters.js)
//   S = credits of its sales settled at the system's stations / all of them    (sales to a conglomerate partner left out)
//   D = 0.4 L + 0.4 X + 0.2 S (dominanceWeights), a component with no activity left out and the others scaled to 1
//   a conglomerate's D = the sum of its current members' Ds: one share, never multiplied by its members. Bug #4802: of a
//   member's rolling extraction and sales, only the days it began as a member count toward the conglomerate (the
//   roster's joinedAt); its days before that stay its own, as the independent corporation it then was
//
// Computed once a day, at the first tick after 00:00 UTC, and cached in the global state. What is published is the top
// three holders by corporation and by conglomerate, each share rounded to dominancePublicRoundPct (5%), plus "others",
// in whole 5% steps that sum to exactly 100: names and shares, never an account id, a count, tonnes or credits.
// Each corporation's own components are kept in the cache for its own view only.

import { CONGLOMERATE_CATALOG } from "../conglomerates.js";
import { SYSTEMS_DATA } from "./catalog.js";
import { stationById } from "./stations.js";
import { dayKeyOf, systemOfBody } from "./dominanceCounters.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const COMPONENTS = ["leases", "extraction", "sales"];

/** Round shares (fractions summing to 1) to whole `stepPct` steps summing to exactly 100, by largest remainder. */
export function roundToSteps(entries, stepPct = CONGLOMERATE_CATALOG.dominancePublicRoundPct) {
  const units = Math.round(100 / stepPct);
  const raw = entries.map((e) => ({ ...e, exact: e.share * units }));
  const floor = raw.map((e) => Math.floor(e.exact));
  let left = units - floor.reduce((s, x) => s + x, 0);
  const order = raw.map((e, i) => [e.exact - floor[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; floor[i] += 1; left -= 1; }
  return raw.map((e, i) => ({ name: e.name, share: floor[i] * stepPct }));
}

/** The published reading for one view: the top three with rounded shares, and "others" for the rest. */
function publicView(holders, catalog) {
  const ranked = holders.filter((h) => h.share > 0).sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
  if (!ranked.length) return { leaders: [], others: 0 };
  const top = ranked.slice(0, 3);
  const rest = ranked.slice(3).reduce((s, h) => s + h.share, 0);
  const rounded = roundToSteps(rest > 0 ? [...top, { name: "", share: rest }] : top, catalog.dominancePublicRoundPct);
  const others = rest > 0 ? rounded.pop().share : 0;
  return { leaders: rounded.filter((r) => r.share > 0), others }; // a leader rounded to 0% is left out; the rest still sum to 100
}

/**
 * Compute every system's dominance at `now`. `accounts` are the stored accounts (their corp's leases and counters),
 * `conglomerates` the stored list (only the living are read). Returns { computedAt, window, systems, private }: systems
 * is what the public endpoint serves, private each corporation's own components by publicId.
 */
export function computeDominance({ accounts = [], conglomerates = [] } = {}, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const to = dayKeyOf(now);
  const from = to - catalog.dominanceWindowDays * DAY_MS;
  const inWindow = (day) => Number(day) >= from && Number(day) < to;
  const weights = catalog.dominanceWeights;
  // Per system: each corporation's raw leases, tonnes and credits (kept here, never published).
  const raw = new Map(SYSTEMS_DATA.map((s) => [s.id, new Map()]));
  const corpById = new Map();
  // Each corporation's conglomerate, from the roster now, and since when it has been a member (Bug #4802).
  const conglomerateOf = new Map();
  const memberSince = new Map();
  for (const c of conglomerates) {
    if (c.dissolvedAt) continue;
    for (const m of c.members || []) { conglomerateOf.set(m.corp, c); memberSince.set(m.corp, Number(m.joinedAt)); }
  }
  // `asMember`: activity that counts toward the corporation's conglomerate. Leases are held now, so a member's count;
  // a day's extraction or sales count when the corporation was a member as that day began (never the day it joined,
  // nor any before). No joinedAt on record counts nothing toward the group: fails closed.
  const add = (systemId, corp, kind, n, asMember) => {
    if (!raw.has(systemId) || !(n > 0)) return;
    const holders = raw.get(systemId);
    const row = holders.get(corp.publicId) || { leases: 0, extraction: 0, sales: 0, member: { leases: 0, extraction: 0, sales: 0 } };
    row[kind] += n;
    if (asMember) row.member[kind] += n;
    holders.set(corp.publicId, row);
  };
  const memberOn = (publicId, day) => conglomerateOf.has(publicId) && memberSince.get(publicId) <= Number(day);
  for (const account of accounts) {
    const corp = account?.state?.corp;
    if (!corp?.publicId) continue;
    corpById.set(corp.publicId, corp);
    for (const lease of corp.miningLeases || []) add(systemOfBody(lease?.body), corp, "leases", 1, conglomerateOf.has(corp.publicId));
    for (const [day, bySystem] of Object.entries(corp.dominance?.extraction || {})) {
      if (inWindow(day)) for (const [systemId, tonnes] of Object.entries(bySystem)) add(systemId, corp, "extraction", Number(tonnes), memberOn(corp.publicId, day));
    }
    for (const [day, byStation] of Object.entries(corp.dominance?.sales || {})) {
      if (inWindow(day)) for (const [stationId, credits] of Object.entries(byStation)) add(stationById(stationId)?.systemId, corp, "sales", Number(credits), memberOn(corp.publicId, day));
    }
  }

  const systems = {};
  const priv = {};
  // ISP-226 (AB#921): each system's holders (a conglomerate as one, an independent corporation as itself) with their
  // component shares and the components with any activity, for control scores at the system's own weights. Private: it
  // is kept in dominance.json, never served (the control endpoint serves names, rounded scores and eligibility only).
  const holdersBySystem = {};
  for (const [systemId, holders] of raw) {
    const totals = Object.fromEntries(COMPONENTS.map((k) => [k, [...holders.values()].reduce((s, r) => s + r[k], 0)]));
    const live = COMPONENTS.filter((k) => totals[k] > 0);
    if (!live.length) { systems[systemId] = { activity: false, byCorporation: { leaders: [], others: 0 }, byConglomerate: { leaders: [], others: 0 } }; continue; }
    const weightSum = live.reduce((s, k) => s + weights[k], 0);
    const corps = [];
    const groups = new Map();
    for (const [publicId, row] of holders) {
      const parts = Object.fromEntries(COMPONENTS.map((k) => [k, totals[k] > 0 ? row[k] / totals[k] : 0]));
      const share = live.reduce((s, k) => s + (weights[k] / weightSum) * parts[k], 0);
      const corp = corpById.get(publicId);
      corps.push({ name: corp?.corporationName || "A corporation", share });
      (priv[publicId] ||= {})[systemId] = { ...parts, dominance: share };
      // Bug #4802: a member's share splits in two. What it did as a member is its conglomerate's; what it did before it
      // joined stays its own, a holder by itself as it was then. Every unit is counted once, so the shares still sum to 1.
      const c = conglomerateOf.get(publicId);
      const asMember = c ? Object.fromEntries(COMPONENTS.map((k) => [k, totals[k] > 0 ? row.member[k] / totals[k] : 0])) : null;
      const own = asMember ? Object.fromEntries(COMPONENTS.map((k) => [k, parts[k] - asMember[k]])) : parts;
      const credit = (key, name, conglomerateId, portion) => {
        const portionShare = live.reduce((s, k) => s + (weights[k] / weightSum) * portion[k], 0);
        if (!(portionShare > 0) && groups.has(key)) return;
        const group = groups.get(key) || { name, share: 0, parts: { leases: 0, extraction: 0, sales: 0 }, conglomerateId, publicId };
        group.share += portionShare;
        for (const k of COMPONENTS) group.parts[k] += portion[k];
        groups.set(key, group);
      };
      if (c) credit(`cgl:${c.id}`, c.name, c.id, asMember);
      if (!c || live.some((k) => own[k] > 1e-12)) credit(`corp:${publicId}`, corp?.corporationName || "A corporation", null, own);
    }
    for (const group of groups.values()) {
      if (!group.conglomerateId) continue;
      for (const m of conglomerates.find((c) => c.id === group.conglomerateId)?.members || []) {
        if (priv[m.corp]?.[systemId]) priv[m.corp][systemId].conglomerate = { ...group.parts, dominance: group.share };
      }
    }
    holdersBySystem[systemId] = {
      live,
      groups: [...groups.values()].map((g) => ({ type: g.conglomerateId ? "conglomerate" : "corp", id: g.conglomerateId || g.publicId, name: g.name, parts: { ...g.parts } }))
    };
    systems[systemId] = {
      activity: true,
      byCorporation: publicView(corps, catalog),
      byConglomerate: publicView([...groups.values()].map(({ name, share }) => ({ name, share })), catalog)
    };
  }
  return { computedAt: now, window: { from, to }, systems, private: priv, holders: holdersBySystem };
}
