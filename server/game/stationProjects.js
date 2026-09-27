// server/game/stationProjects.js: a conglomerate builds a station as a funded construction project (ISP-210, AB#905;
// docs/design/CONGLOMERATES.md Part 2, "Co-owned stations"). The founder files it at the Bureau for an open orbit (a
// body with no station, in a system where a member holds a lease); members fund it; when it is fully funded it builds
// for stationBuildDays, then the station registry (server/game/stations.js, addStation) holds it, owned by the
// conglomerate.
//
// Where the funding comes from, and what it earns:
// - "own": any member puts in its own credits, or its own goods at the hangar's station. The contribution is that
//   corporation's, by name, and is what its stake will be counted from (the stakes story, v0.12-18).
// - "treasury" / "hangar": the founder moves pooled credits or goods in. Shared money belongs to nobody in particular,
//   so these rows record who moved them (`by`) but no contributor (`corp: null`): nobody's stake grows from them.
// Every movement is one synchronous step, checked in full before anything changes. Cancelling (the founder, before it
// is built) returns each contribution to where it came from, in full. Completion checks the bill of materials again
// and creates nothing if it is short (fails closed); a second completion finds the station and does nothing more.

import { CONGLOMERATE_CATALOG, can } from "../conglomerates.js";
import { applyCredits } from "../finances.js";
import { ECONOMY } from "../economy.js";
import { createId, SYSTEMS_BY_ID } from "./catalog.js";
import { addStation, stationAtBody, stationById } from "./stations.js";
import { pushSystemNotification } from "./progression.js";
import { saveAccountsNow } from "./store.js";
import { conglomerateList, moveTreasury, noteTreasury, publicConglomerate } from "./conglomerates.js";
import { NOT_FOUND, accountByCorp, context, corpName, no, roomEvent } from "./membership.js";
import { ensureHangar, hangarItem, hangarQuantity, moveHangar } from "./hangar.js";
import { treasuryAmount } from "./treasury.js";
import { contributedValues, stakesFrom } from "./stakes.js"; // ISP-211 (AB#906)

const DAY_MS = 24 * 60 * 60 * 1000;
const plain = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");
/** What a new station is called: its body and one of these, chosen by the founder by number from 1. No free text (Decision D-0.12-1). */
export const STATION_NAME_SUFFIXES = Object.freeze(["Station", "Anchorage", "Platform", "Outpost", "Hold", "Relay"]);
const SOURCES = ["own", "treasury", "hangar"];
/**
 * ISP-212 (AB#907): what a built station opens with. The Orbital Executive Suites are where an office is leased, the
 * member rate included; without them the rate would have no counter to be paid at. Ids from data/buildings.json
 * (tests/integration/conglomerate-station-benefits.test.js checks them).
 */
export const STATION_BUILDINGS = Object.freeze(["orbital-executive-suites"]);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** The item's NPC reference price, what a stake counts goods at (stakeGoodsPriceBasis). */
const referencePrice = (item) => (ECONOMY.npcBuyers || []).find((b) => b.item === item)?.unitPrice || 0;

/** The bill of materials, with goods by inventory name: { credits, goods: { <name>: units } }. */
export function billOfMaterials(catalog = CONGLOMERATE_CATALOG) {
  const goods = {};
  for (const [id, units] of Object.entries(catalog.stationCostGoods || {})) {
    const name = hangarItem(id);
    if (!name || !Number.isSafeInteger(units) || units < 1) throw new Error(`stationCostGoods names ${id}, which is not an item with a whole quantity`);
    goods[name] = units;
  }
  return { credits: catalog.stationCostCredits, goods };
}

/** What is still needed: { credits, goods }, zero when met. */
function remaining(p, bom) {
  return {
    credits: Math.max(0, bom.credits - p.credits),
    goods: Object.fromEntries(Object.entries(bom.goods).map(([item, need]) => [item, Math.max(0, need - (p.goods[item] || 0))]))
  };
}
const funded = (p, bom) => p.credits >= bom.credits && Object.entries(bom.goods).every(([item, need]) => (p.goods[item] || 0) >= need);

/** The systems where a member holds a lease, from each lease's body. */
function leasedSystems(c) {
  const systemOfBody = new Map([...SYSTEMS_BY_ID.values()].flatMap((s) => (s.bodies || []).map((b) => [b.name.toLowerCase(), s.id])));
  const out = new Set();
  for (const m of c.members) {
    for (const lease of accountByCorp(m.corp)?.state?.corp?.miningLeases || []) {
      const system = systemOfBody.get(String(lease?.body || "").toLowerCase());
      if (system) out.add(system);
    }
  }
  return out;
}
/** Bodies another conglomerate's live project has claimed. */
const claimedBodies = (except) => new Set(conglomerateList().filter((o) => o !== except && o.stationProject).map((o) => o.stationProject.body));

/** Where `c` may build: every open orbit in a system where a member holds a lease, not claimed by another project. */
export function openOrbits(c) {
  const claimed = claimedBodies(c);
  return [...leasedSystems(c)].flatMap((systemId) => (SYSTEMS_BY_ID.get(systemId).bodies || [])
    .filter((b) => !stationAtBody(b.name) && !claimed.has(b.name))
    .map((b) => ({ systemId, systemName: SYSTEMS_BY_ID.get(systemId).name, body: b.name })));
}

/** Why `c` cannot start a project now, or null. */
function startRefusal(c, catalog) {
  if (c.station) return no(409, "owns-station", `${c.name} already owns a station.`);
  if (c.stationProject) return no(409, "project-open", `${c.name} already has a station project under way. Finish or cancel it first.`);
  if (c.level < catalog.stationMinLevel) return no(409, "level-too-low", `A station project needs a level ${catalog.stationMinLevel} conglomerate; ${c.name} is level ${c.level}.`);
  if (c.arrearsSince) return no(409, "in-arrears", `${c.name} owes upkeep. Pay it up before starting a station project.`);
  return null;
}

/** File a station project at `body` in `systemId`, named `${body} ${STATION_NAME_SUFFIXES[suffix - 1]}`. The founder, at the Bureau. */
export function startStationProject(accountId, conglomerateId, { systemId, body, suffix } = {}, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  settleStationProject(c, now);
  if (!can(role, "station-project")) return no(403, "not-permitted", "Only the founder can start a station project.");
  if (corp.currentStationId !== catalog.charterStationId) return no(409, "not-at-bureau", "Station projects are filed at the Conglomerate Affairs Bureau on Earth Station Prime. Travel there, then file it.");
  const refusal = startRefusal(c, catalog);
  if (refusal) return refusal;
  const system = typeof systemId === "string" ? SYSTEMS_BY_ID.get(systemId) : null;
  if (!system) return no(400, "unknown-system", "Choose a system from the game's list.");
  if (typeof body !== "string" || !(system.bodies || []).some((b) => b.name === body)) return no(400, "unknown-body", `Choose a body in ${system.name}.`);
  if (!Number.isInteger(suffix) || suffix < 1 || !STATION_NAME_SUFFIXES[suffix - 1]) return no(400, "unknown-name", "Choose the station's name from the list.");
  if (stationAtBody(body)) return no(409, "body-taken", `${body} already has a station.`);
  if (claimedBodies(c).has(body)) return no(409, "body-claimed", `Another conglomerate is already building at ${body}.`);
  if (!leasedSystems(c).has(system.id)) return no(409, "no-lease-in-system", `A station is built where a member mines: no member of ${c.name} holds a lease in ${system.name}.`);
  let bom;
  try {
    bom = billOfMaterials(catalog);
  } catch (error) {
    console.error("[station-project] the bill of materials cannot be read:", error?.message || error);
    return no(503, "project-unavailable", "The Bureau cannot price a station just now; nothing was filed.");
  }
  c.stationProject = {
    id: createId("csp"), state: "funding", systemId: system.id, body, name: `${body} ${STATION_NAME_SUFFIXES[suffix - 1]}`,
    stationId: `cg-${slug(body)}`, startedAt: now, startedBy: corp.publicId, credits: 0, goods: {}, contributions: [],
    fundedAt: null, completesAt: null
  };
  noteTreasury(c, { at: now, kind: "station-project", corp: corp.publicId, by: corp.publicId, note: `station project filed: ${c.stationProject.name}, ${system.name}` });
  saveAccountsNow();
  notifyMembers(c, `${c.name} is building a station`, `${corpName(corp.publicId)} filed a station project: ${c.stationProject.name} in ${system.name}. It needs ${plain(bom.credits)} credits and ${goodsText(bom.goods)}.`);
  roomEvent(c, "conglomerate:station-project", { kind: "started", project: projectView(c, now, catalog) });
  return { project: projectView(c, now, catalog) };
}

/**
 * Put credits (`credits`) or goods (`item`, `quantity`) into the project from `source`: "own" (any member, its own), or
 * "treasury" / "hangar" (the founder, the pooled stock). No more than the project still needs of that thing.
 */
export function contributeToStationProject(accountId, conglomerateId, { source, credits, item: rawItem, quantity } = {}, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  settleStationProject(c, now);
  const p = c.stationProject;
  if (!p) return no(409, "no-project", `${c.name} has no station project to fund.`);
  if (p.state !== "funding") return no(409, "fully-funded", `${p.name} is fully funded and being built.`);
  if (!SOURCES.includes(source)) return no(400, "unknown-source", "Fund it from your own stock, the treasury or the hangar.");
  if (source === "own" ? !can(role, "contribute") : !can(role, "station-project")) return no(403, "not-permitted", "Only the founder can move the treasury or the hangar into the station project; any member can put in its own.");
  const bom = billOfMaterials(catalog);
  const need = remaining(p, bom);
  const giveCredits = credits !== undefined && credits !== null;
  if (giveCredits === (rawItem !== undefined && rawItem !== null)) return no(400, "credits-or-goods", "Put in credits or one item, not both and not neither.");
  if (source === "hangar" && giveCredits) return no(400, "hangar-holds-goods", "The hangar holds goods; credits come from the treasury.");
  if (source === "treasury" && !giveCredits) return no(400, "treasury-holds-credits", "The treasury holds credits; goods come from the hangar.");
  const hangarStation = ensureHangar(c, catalog).stationId;
  let row;
  if (giveCredits) {
    if (treasuryAmount(credits) === null) return no(400, "invalid-amount", "Enter a whole number of credits, at least 1.");
    if (credits > need.credits) return no(409, "over-need", `The project needs ${plain(need.credits)} more credits.`);
    if (source === "own") {
      const held = Number(corp.finances?.credits);
      if (!Number.isFinite(held) || held < credits) return no(409, "insufficient-credits", `Your corporation holds ${plain(held)} credits; it cannot put in ${plain(credits)}.`);
      applyCredits(corp, -credits, "conglomerate-station", now);
    } else {
      if (credits > c.treasury.credits) return no(409, "insufficient-treasury", `The treasury holds ${plain(c.treasury.credits)} credits.`);
      moveTreasury(c, { at: now, kind: "station-project", corp: corp.publicId, amount: -credits, by: corp.publicId, note: p.name });
    }
    p.credits += credits;
    row = { at: now, source, corp: source === "own" ? corp.publicId : null, by: corp.publicId, credits, value: credits };
  } else {
    const item = hangarItem(rawItem);
    if (!item) return no(400, "unknown-item", "Choose an item from the game's list.");
    if (!(item in bom.goods)) return no(409, "not-needed", `A station is not built from ${item}.`);
    if (hangarQuantity(quantity) === null) return no(400, "invalid-quantity", "Enter a whole number of units, at least 1.");
    if (quantity > need.goods[item]) return no(409, "over-need", `The project needs ${plain(need.goods[item])} more ${item}.`);
    if (source === "own") {
      const held = Math.floor(Number(corp.inventory?.[hangarStation]?.[item]) || 0);
      if (held < quantity) return no(409, "insufficient-stock", `Your corporation holds ${plain(held)} ${item} at ${stationById(hangarStation)?.name || hangarStation}; goods for the project come from there.`);
      corp.inventory[hangarStation][item] = held - quantity;
      if (!corp.inventory[hangarStation][item]) delete corp.inventory[hangarStation][item];
    } else {
      const held = Math.floor(Number(c.hangar.items[item]) || 0);
      if (held < quantity) return no(409, "insufficient-hangar", `The hangar holds ${plain(held)} ${item}.`);
      moveHangar(c, { at: now, kind: "station-project", corp: corp.publicId, item, quantity: -quantity, by: corp.publicId });
    }
    p.goods[item] = (p.goods[item] || 0) + quantity;
    row = { at: now, source, corp: source === "own" ? corp.publicId : null, by: corp.publicId, item, quantity, stationId: hangarStation, value: quantity * referencePrice(item) };
  }
  p.contributions.push(row);
  if (funded(p, bom)) {
    p.state = "building";
    p.fundedAt = now;
    p.completesAt = now + catalog.stationBuildDays * DAY_MS;
  }
  saveAccountsNow();
  roomEvent(c, "conglomerate:station-project", { kind: "contribution", contribution: contributionView(row), project: projectView(c, now, catalog) });
  if (p.state === "building") notifyMembers(c, `${p.name} is fully funded`, `Construction has begun; ${p.name} opens in ${catalog.stationBuildDays} days.`);
  return { project: projectView(c, now, catalog), account: { credits: corp.finances.credits } };
}

/** Cancel the project before it is built (the founder): every contribution goes back where it came from, in full. */
export function cancelStationProject(accountId, conglomerateId, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  settleStationProject(c, now);
  if (!can(role, "station-project")) return no(403, "not-permitted", "Only the founder can cancel a station project.");
  const p = c.stationProject;
  if (!p) return no(409, "no-project", `${c.name} has no station project to cancel.`);
  refund(c, p, now, corp.publicId);
  c.stationProject = null;
  noteTreasury(c, { at: now, kind: "station-project", corp: corp.publicId, by: corp.publicId, note: `station project cancelled: ${p.name}; every contribution returned` });
  saveAccountsNow();
  notifyMembers(c, `${p.name} was cancelled`, `${corpName(corp.publicId)} cancelled the station project. Every contribution has gone back where it came from.`);
  roomEvent(c, "conglomerate:station-project", { kind: "cancelled", name: p.name });
  return { cancelled: p.name, treasury: { credits: c.treasury.credits }, account: { credits: corp.finances.credits } };
}

/** Return every contribution to its source. A contributor whose account is gone is repaid into the pool instead. */
function refund(c, p, now, by) {
  for (const row of p.contributions) {
    const owner = row.source === "own" ? accountByCorp(row.corp)?.state?.corp : null;
    if (row.credits) {
      if (owner) applyCredits(owner, row.credits, "conglomerate-station-refund", now);
      else moveTreasury(c, { at: now, kind: "station-project-refund", corp: row.corp, amount: row.credits, by, note: p.name });
    } else if (owner) {
      const inv = ((owner.inventory ||= {})[row.stationId] ||= {});
      inv[row.item] = (Number(inv[row.item]) || 0) + row.quantity;
    } else {
      moveHangar(c, { at: now, kind: "station-project-refund", corp: row.corp, item: row.item, quantity: row.quantity, by });
    }
  }
}

/**
 * Complete `c`'s project if its build time is over: check the bill of materials, add the station, tell the members.
 * Idempotent: a station already in the registry for this project completes it without adding a second. Fails closed:
 * short materials or a refusal from the registry leave the project as it is, with the reason, and create nothing.
 */
export function settleStationProject(c, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const p = c?.stationProject;
  if (!p || p.state !== "building" || now < p.completesAt) return null;
  let station = stationById(p.stationId);
  if (station && station.owner?.id !== c.id) return blocked(c, p, `${p.stationId} is another station's id`);
  if (!station) {
    let bom;
    try {
      bom = billOfMaterials(catalog);
    } catch (error) {
      return blocked(c, p, `the bill of materials cannot be read (${error?.message || error})`);
    }
    if (!funded(p, bom)) return blocked(c, p, "the project is short of its bill of materials");
    const added = addStation({ id: p.stationId, name: p.name, systemId: p.systemId, body: p.body, owner: { type: "conglomerate", id: c.id }, buildingIds: [...STATION_BUILDINGS] });
    if (!added.ok) return blocked(c, p, added.error);
    station = added.station;
  }
  // ISP-211 (AB#906): the stakes, fixed from the contributions now, and the settings the stakeholders govern
  c.station = { id: station.id, builtAt: now, projectId: p.id, contributions: p.contributions, stakes: stakesFrom(contributedValues(p.contributions)), settings: { access: "open", listed: [] }, proposals: [] };
  c.stationProject = null;
  noteTreasury(c, { at: now, kind: "station-built", corp: null, by: "bureau", note: `${station.name} opened` });
  saveAccountsNow();
  const system = SYSTEMS_BY_ID.get(station.systemId)?.name || station.systemId;
  notifyMembers(c, `${station.name} is open`, `${c.name}'s station at ${station.body}, ${system}, is built and on the starmap.`);
  roomEvent(c, "conglomerate:station-built", { station: { id: station.id, name: station.name, systemId: station.systemId, body: station.body } });
  return { station };
}

function blocked(c, p, why) {
  if (p.blocked !== why) {
    p.blocked = why;
    console.error(`[station-project] ${c.id}'s ${p.stationId} was not created: ${why}`);
    saveAccountsNow();
  }
  return { blocked: why };
}

/** Complete every conglomerate's finished project: the server's tick, so a station opens with nobody watching. */
export function settleStationProjects(now = Date.now()) {
  for (const c of conglomerateList()) {
    try {
      settleStationProject(c, now);
    } catch (error) {
      console.error(`[station-project] ${c?.id}:`, error?.message || error);
    }
  }
}

const goodsText = (goods) => Object.entries(goods).map(([item, n]) => `${plain(n)} ${item}`).join(", ");
function notifyMembers(c, title, body) {
  for (const m of c.members) {
    const account = accountByCorp(m.corp);
    if (account) pushSystemNotification(account, { type: "system", title, body });
  }
}
const contributionView = (r) => ({ at: r.at, source: r.source, corp: r.corp, corpName: r.corp ? corpName(r.corp) : null, byName: corpName(r.by), credits: r.credits ?? null, item: r.item ?? null, quantity: r.quantity ?? null, value: r.value });

/** The project as members see it: where, progress against the bill, and each contribution with its contributor's name. */
export function projectView(c, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const p = c.stationProject;
  if (!p) return null;
  const bom = billOfMaterials(catalog);
  const byCorp = {};
  for (const r of p.contributions) if (r.corp) byCorp[r.corp] = (byCorp[r.corp] || 0) + r.value;
  return {
    id: p.id, state: p.state, name: p.name, systemId: p.systemId, body: p.body, startedAt: p.startedAt,
    needs: bom, has: { credits: p.credits, goods: { ...p.goods } }, remaining: remaining(p, bom),
    fundedAt: p.fundedAt, completesAt: p.completesAt, blocked: p.blocked || null,
    contributions: p.contributions.map(contributionView),
    byMember: Object.entries(byCorp).map(([corp, value]) => ({ corp, corpName: corpName(corp), value })).sort((a, b) => b.value - a.value)
  };
}

/** GET: the project (or null), the station if built, and where a project could go. Any member. */
export function stationProjectView(accountId, conglomerateId, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  settleStationProject(c, now, catalog);
  const station = c.station ? stationById(c.station.id) : null;
  return {
    conglomerate: publicConglomerate(c),
    project: projectView(c, now, catalog),
    station: station ? { id: station.id, name: station.name, systemId: station.systemId, body: station.body, builtAt: c.station.builtAt } : null,
    canStart: !startRefusal(c, catalog), minLevel: catalog.stationMinLevel, buildDays: catalog.stationBuildDays,
    // ISP-213 (AB#908): what a station costs and the member office rate, for the screen before any project exists
    bill: billOfMaterials(catalog), memberRentPct: catalog.stationMemberRentPct,
    nameSuffixes: STATION_NAME_SUFFIXES, openOrbits: c.station || c.stationProject ? [] : openOrbits(c)
  };
}
