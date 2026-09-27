// server/lobbyingService.js: lobbying campaigns that move one bounded rule in one system (ISP-239, AB#934;
// docs/design/WARFARE.md, "Lobbying"). The arithmetic is server/game/lobbying.js; the standing it spends is ISP-238's.
//
// A corporation with lobbying.openStandingMin standing with a parameter's faction opens a campaign (which parameter,
// which concedable system, raise or lower), spending openStandingCost standing. For pledgeHours any corporation with
// pledgeStandingMin standing with that faction pledges credits, standing or both to either side; pledges are final and
// a sink. When pledging closes, the parameter moves by the curve's net pull for durationDays, then returns to its base;
// a campaign that moved nothing ends at once. One campaign per parameter per system, and cooldownDays after one ends.
//
// parameterInForce is the one function every consumer reads: the tariff cap (server/tariffService.js), the Exchange's
// sales tax on sales at the system's stations (both sale paths) and the ITC's price and volume lines (server/itcService.js).
// Campaigns are public (who opened and pledged, on which side, what and when): lobbying is registered. The amounts are
// not. Kept in lobbying.json in the data directory, corporations by publicId, no account id. It fails closed: a
// parameter whose curve cannot be evaluated is refused before anything is charged.

import fs from "node:fs";
import path from "node:path";
import { SYSTEMS_BY_ID, dataDir, safeWriteFile } from "./game/catalog.js";
import { WARFARE_CATALOG } from "./warfare.js";
import { ECONOMY } from "./economy.js";
import { applyCredits } from "./finances.js";
import { accountByCorp } from "./game/membership.js";
import { stationById } from "./game/stations.js";
import { addStanding, standingOf } from "./game/standing.js";
import { influence, outcome, specProblem } from "./game/lobbying.js";

const FILE = path.join(dataDir, "lobbying.json");
const HOUR = 3_600_000;
const DAY_MS = 86_400_000;
const TERMS = WARFARE_CATALOG.lobbying;
const PARAMS = TERMS.parameters;
let store = readStore();

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return parsed && Array.isArray(parsed.campaigns) ? parsed : { campaigns: [], seq: 0 };
  } catch {
    return { campaigns: [], seq: 0 };
  }
}
const save = () => safeWriteFile(FILE, JSON.stringify(store));
const no = (status, error) => ({ status, error });

/** A parameter's base in a system: the rule table's tariff cap, or the catalog's sales tax and dumping lines. */
export function baseOf(systemId, parameter) {
  switch (parameter) {
    case "tariffCapPct": return Number(WARFARE_CATALOG.systemRules[systemId]?.tariffCapPct) || 0;
    case "salesTaxPct": return ECONOMY.exchange.salesTaxPct;
    case "dumpingPriceThresholdPct": return WARFARE_CATALOG.dumping.priceThresholdPct;
    case "dumpingVolumeThresholdPct": return WARFARE_CATALOG.dumping.volumeThresholdPct;
    default: return null;
  }
}

/** The campaign holding `parameter` in `systemId` at `now`, if one is. */
function holding(systemId, parameter, now) {
  return store.campaigns.find((c) => c.systemId === systemId && c.parameter === parameter && c.result && now >= c.closesAt && now < c.result.endsAt) || null;
}

/** The value in force: the base, or a holding campaign's value. The one function the tariff, sales tax and watch read. */
export function parameterInForce(systemId, parameter, now = Date.now()) {
  const base = baseOf(systemId, parameter);
  if (base === null) return null;
  const c = holding(systemId, parameter, now);
  return c ? c.result.to : base;
}

/** The Exchange's base sales tax for a sale settled at `stationId` (ISP-302's royalty and discounts apply on top). */
export function salesTaxBaseAt(stationId, now = Date.now()) {
  const systemId = stationById(stationId)?.systemId;
  return systemId ? parameterInForce(systemId, "salesTaxPct", now) : ECONOMY.exchange.salesTaxPct;
}

/** The ITC's dumping terms for sales in `systemId`: the catalog's, with the price and volume lines in force there. */
export function dumpingTermsIn(systemId, now = Date.now()) {
  const base = WARFARE_CATALOG.dumping;
  if (!systemId) return base;
  return { ...base, priceThresholdPct: parameterInForce(systemId, "dumpingPriceThresholdPct", now), volumeThresholdPct: parameterInForce(systemId, "dumpingVolumeThresholdPct", now) };
}

/** Why `parameter` cannot be lobbied in `systemId`, or null. */
function lobbyableProblem(systemId, parameter) {
  const spec = PARAMS[parameter];
  if (!spec) return "That is not a lobbyable parameter.";
  if (specProblem(spec)) return specProblem(spec);
  if (!WARFARE_CATALOG.systemRules[systemId]) return "Only a system the ISA can concede may be lobbied.";
  if (parameter === "tariffCapPct" && !(baseOf(systemId, parameter) > 0)) return "This system's charter allows no tariff: its cap cannot be lobbied.";
  return null;
}

/** Open a campaign for `corp`: { parameter, systemId, direction }. Returns { ok, campaign } or { status, error }. */
export function openCampaign(corp, { parameter, systemId, direction } = {}, now = Date.now()) {
  const problem = lobbyableProblem(systemId, parameter);
  if (problem) return no(400, problem);
  if (!["raise", "lower"].includes(direction)) return no(400, "A campaign raises or lowers its parameter.");
  const spec = PARAMS[parameter];
  if (standingOf(corp, spec.faction) < TERMS.openStandingMin) return no(403, `Opening a campaign needs ${TERMS.openStandingMin} standing with the ${factionName(spec.faction)}.`);
  const last = store.campaigns.filter((c) => c.systemId === systemId && c.parameter === parameter).sort((a, b) => b.opensAt - a.opensAt)[0];
  if (last && (!last.result || now < last.result.endsAt)) return no(409, "A campaign on this parameter in this system is already running.");
  if (last && now < last.result.endsAt + TERMS.cooldownDays * DAY_MS) return no(409, `Another campaign may open here from ${new Date(last.result.endsAt + TERMS.cooldownDays * DAY_MS).toISOString().slice(0, 16).replace("T", " ")} UTC.`);
  addStanding(corp, spec.faction, -TERMS.openStandingCost, WARFARE_CATALOG.standing);
  store.seq += 1;
  const campaign = { id: `lob-${store.seq}`, parameter, systemId, direction, faction: spec.faction, openedBy: corp.publicId, opensAt: now, closesAt: now + TERMS.pledgeHours * HOUR, base: baseOf(systemId, parameter), pledges: [], result: null };
  store.campaigns.push(campaign);
  save();
  return { ok: true, campaign: publicCampaign(campaign) };
}

/** `corp` pledges { side, credits, standing } to a campaign still taking pledges. Final. Returns { ok, campaign } or { status, error }. */
export function pledge(corp, campaignId, { side, credits = 0, standing = 0 } = {}, now = Date.now()) {
  const c = store.campaigns.find((x) => x.id === campaignId);
  if (!c) return no(404, "No such campaign.");
  if (c.result || now >= c.closesAt) return no(409, "This campaign has stopped taking pledges.");
  if (!["for", "against"].includes(side)) return no(400, "A pledge is for or against the campaign.");
  const cr = Number(credits) || 0, st = Math.round((Number(standing) || 0) * 100) / 100;
  if (!Number.isInteger(cr) || cr < 0 || !Number.isFinite(st) || st < 0 || (cr === 0 && st === 0)) return no(400, "Pledge whole credits, standing, or both.");
  const spec = PARAMS[c.parameter];
  if (specProblem(spec)) return no(400, specProblem(spec));
  const held = standingOf(corp, c.faction);
  if (held < TERMS.pledgeStandingMin) return no(403, `Pledging needs ${TERMS.pledgeStandingMin} standing with the ${factionName(c.faction)}.`);
  if (st > held) return no(400, `You hold ${held} standing with the ${factionName(c.faction)}.`);
  if (cr > Math.floor(Number(corp.finances?.credits) || 0)) return no(400, "You do not have the credits you pledged.");
  // fails closed: the side's curve with this pledge must evaluate before anything is charged
  const totals = sideTotals(c);
  totals[side] += influence(cr, st, TERMS.creditsPerStandingPoint);
  if (!outcome(c.base, c.direction, totals.for, totals.against, spec)) return no(400, "This campaign's curve cannot be evaluated.");
  if (cr > 0) applyCredits(corp, -cr, "lobbying-pledge", now);
  if (st > 0) addStanding(corp, c.faction, -st, WARFARE_CATALOG.standing);
  c.pledges.push({ corp: corp.publicId, side, credits: cr, standing: st, at: now });
  save();
  return { ok: true, campaign: publicCampaign(c) };
}

function sideTotals(c) {
  const totals = { for: 0, against: 0 };
  for (const p of c.pledges) totals[p.side] += influence(p.credits, p.standing, TERMS.creditsPerStandingPoint);
  return totals;
}

/** Close every campaign whose pledging has ended: its outcome, held for durationDays (or ended at once when nothing moved). */
export function lobbyingTick(now = Date.now()) {
  const closed = [];
  for (const c of store.campaigns) {
    if (c.result || now < c.closesAt) continue;
    const totals = sideTotals(c);
    const r = outcome(c.base, c.direction, totals.for, totals.against, PARAMS[c.parameter]);
    if (!r) console.error(`[lobbying] campaign ${c.id}'s curve could not be evaluated: it moves nothing`);
    const to = r ? r.to : c.base;
    c.result = { eFor: r?.eFor ?? 0, eAgainst: r?.eAgainst ?? 0, from: c.base, to, endsAt: to === c.base ? c.closesAt : c.closesAt + TERMS.durationDays * DAY_MS };
    closed.push(c.id);
  }
  if (closed.length) save();
  return closed;
}

const factionName = (f) => (f === "earth-assembly" ? "Earth Assembly" : "Interplanetary Trade Commission");
const nameOf = (pub) => accountByCorp(pub)?.state?.corp?.corporationName || "A corporation";

/** A campaign as the register shows it: who and which side, what and when; never the amounts pledged. */
export function publicCampaign(c, now = Date.now()) {
  const state = !c.result ? (now < c.closesAt ? "pledging" : "closing") : now < c.result.endsAt ? "in-force" : "ended";
  return {
    id: c.id, parameter: c.parameter, systemId: c.systemId, direction: c.direction, faction: c.faction, state,
    openedBy: nameOf(c.openedBy), opensAt: c.opensAt, closesAt: c.closesAt, base: c.base,
    pledgers: c.pledges.map((p) => ({ name: nameOf(p.corp), side: p.side })),
    result: c.result ? { from: c.result.from, to: c.result.to, endsAt: c.result.endsAt } : null
  };
}

/** The register: every campaign pledging or in force, and those ended within the cooldown, newest first. */
export function lobbyingRegister(now = Date.now()) {
  return store.campaigns
    .filter((c) => !c.result || now < c.result.endsAt + TERMS.cooldownDays * DAY_MS)
    .sort((a, b) => b.opensAt - a.opensAt)
    .map((c) => publicCampaign(c, now));
}

/**
 * ISP-240 (AB#935): the lobbying office as the caller sees it: its standing with each faction, the terms, the lobbyable
 * parameters, every concedable system's base and in-force value for each (with the campaign on it, or when the next may
 * open), and the register, with the caller's own pledge amounts on its own lines only.
 */
export function lobbyingOffice(corp, now = Date.now()) {
  const systems = Object.keys(WARFARE_CATALOG.systemRules).map((id) => ({
    id,
    name: SYSTEMS_BY_ID.get(id)?.name || id,
    values: Object.fromEntries(Object.keys(PARAMS).map((parameter) => {
      const last = store.campaigns.filter((c) => c.systemId === id && c.parameter === parameter).sort((a, b) => b.opensAt - a.opensAt)[0];
      const running = last && (!last.result || now < last.result.endsAt) ? last : null;
      const cooldownUntil = last?.result && !running ? last.result.endsAt + TERMS.cooldownDays * DAY_MS : null;
      return [parameter, {
        base: baseOf(id, parameter), inForce: parameterInForce(id, parameter, now), lobbyable: !lobbyableProblem(id, parameter),
        campaign: running ? { id: running.id, direction: running.direction, state: publicCampaign(running, now).state } : null,
        cooldownUntil: cooldownUntil && cooldownUntil > now ? cooldownUntil : null
      }];
    }))
  }));
  const mine = corp?.publicId;
  const campaigns = lobbyingRegister(now).map((pub) => {
    const c = store.campaigns.find((x) => x.id === pub.id);
    const own = c.pledges.filter((p) => p.corp === mine).map(({ side, credits, standing, at }) => ({ side, credits, standing, at }));
    return { ...pub, systemName: SYSTEMS_BY_ID.get(pub.systemId)?.name || pub.systemId, openedByYou: c.openedBy === mine, own };
  });
  return {
    standing: { "earth-assembly": standingOf(corp, "earth-assembly"), "interplanetary-trade-commission": standingOf(corp, "interplanetary-trade-commission") },
    standingMax: WARFARE_CATALOG.standing.max,
    terms: { openStandingMin: TERMS.openStandingMin, openStandingCost: TERMS.openStandingCost, pledgeStandingMin: TERMS.pledgeStandingMin, creditsPerStandingPoint: TERMS.creditsPerStandingPoint, pledgeHours: TERMS.pledgeHours, durationDays: TERMS.durationDays, cooldownDays: TERMS.cooldownDays },
    parameters: PARAMS,
    systems,
    campaigns,
    credits: Math.floor(Number(corp?.finances?.credits) || 0),
    currentSystemId: corp?.currentSystemId || "sol"
  };
}

/** For tests: forget every campaign (and optionally the file). */
export function resetLobbying({ removeFile = false } = {}) {
  store = { campaigns: [], seq: 0 };
  if (removeFile) fs.rmSync(FILE, { force: true });
}
