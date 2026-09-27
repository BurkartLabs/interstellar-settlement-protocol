// ISP-183 (AB#877): the combat profile of the ISP probe, the same shape as the financial-markets one (marketsProbe.js).
// Three parts, each printing what the v0.10 stories claim:
//   1. the counter matrix: every pure composition against every other at three budgets, through the real resolver
//      (server/game/combat.js resolveBattle), and whether each unit beats the one it is strong against (the five-way
//      cycle, docs/design/v0.10-combat.md section 2);
//   2. the planner's fleet size against the Fleet Cap, on the real upkeep rule (public/scripts/militaryUpkeep.js): the
//      size where one more unit costs more upkeep than it earns at r, swept over shipyard tiers, caps, unit types and r;
//   3. a raid world: producer, raider and mixed bots for 30 days, the raids declared, resolved and brought home by the
//      real raid code (server/raids.js, server/raidResolution.js) on D-0.10-1's caps, upkeep charged by server/upkeep.js,
//      and r, what a raiding fleet earns a supply a day (docs/design/v0.10-raids-mercenaries.md section 8).
//
// BOT NUMBERS (P-PROXY, DOCTRINE P-005). A bot is not a player. What these numbers measure is whether the counters, the
// upkeep curve and the raid caps hold the design's claims under its own arithmetic and the server's real code; they
// are not a fact about how anybody fights, raids or earns.
//
// WHAT IS REAL AND WHAT IS ASSUMED:
//   - Real: the resolver, the upkeep rule and its daily charge, raid declaration (protection, cooldown, repeat and rate
//     limits), resolution (garrison, losses, loot 20% above 10,000 limited by what survivors carry, damage), the return
//     and the loot's delivery, and the statements.
//   - Assumed: a producer's business is marketsProbe.js's (capital earning on the halving-return curve, less a fixed
//     cost), paid in Silicates held at the home station, so there are goods to take; nobody sells. Units are given at
//     their replacement value (credits plus goods at the standing bids, mercenaries.js unitValue) instead of built at
//     the shipyard, because production is not what is measured. Everyone is at one station (Earth Station Prime): no
//     travel beyond the raid's 4-hour warning. No research modifiers, no mercenaries, no reinforcement on warning.
//   - Net worth is the latest closed statement's plus the units at replacement value: ships and troops are not on the
//     balance sheet.

import { resolveBattle } from "../../server/game/combat.js";
import { UNITS, UNIT_IDS, SHIP_UNIT_IDS, ensureCorpMilitary } from "../../server/game/units.js";
import { upkeepBreakdown } from "../../public/scripts/militaryUpkeep.js";
import { unitValue } from "../../server/mercenaries.js";
import { formFleet } from "../../server/fleets.js";
import { declareRaid, raidTargets } from "../../server/raids.js";
import { lootFor, raidTick, raidReportFor } from "../../server/raidResolution.js";
import { settleAccountUpkeep } from "../../server/upkeep.js";
import { applyCredits } from "../../server/finances.js";
import { getAccountById, getState, getStatements, mutateAccountState } from "../../server/gameState.js";
import { capitalValue } from "./bondPlanner.js";

export const DAY = 86_400_000;
const HOUR = 3_600_000;
const STATION = "earth-station-prime";
const GOOD = "Silicates";
export const BUDGETS = [20_000, 60_000, 180_000];

// ─── 1. The counter matrix ─────────────────────────────────────────────────────

/** How many of `type` a budget buys, at replacement value. */
const afford = (type, budget) => Math.floor(budget / unitValue(type));

/**
 * Every ordered pair of pure compositions at every budget, attacker against defender, each side spending the budget on
 * one unit type. Returns { matchups: [{ budget, attacker, defender, winner }], winRate: { type: share }, cycle }.
 * `cycle` lists, for each unit, whether it beats the one it is strong against as attacker and as defender at every
 * budget; `beats` is who each unit beats both ways at the middle budget.
 */
export function counterMatrix(budgets = BUDGETS, types = UNIT_IDS) {
  const matchups = [];
  for (const budget of budgets) {
    for (const a of types) for (const d of types) {
      if (a === d) continue;
      const { winner } = resolveBattle({ [a]: afford(a, budget) }, { [d]: afford(d, budget) });
      matchups.push({ budget, attacker: a, defender: d, winner });
    }
  }
  const won = (t, m) => (m.attacker === t && m.winner === "attacker") || (m.defender === t && m.winner === "defender");
  const winRate = Object.fromEntries(types.map((t) => {
    const mine = matchups.filter((m) => m.attacker === t || m.defender === t);
    return [t, mine.filter((m) => won(t, m)).length / mine.length];
  }));
  const bothWays = (a, d, budget) => matchups.some((m) => m.budget === budget && m.attacker === a && m.defender === d && m.winner === "attacker")
    && matchups.some((m) => m.budget === budget && m.attacker === d && m.defender === a && m.winner === "defender");
  const cycle = types.map((t) => ({ unit: t, strongAgainst: UNITS[t].strongAgainst, holds: budgets.every((b) => bothWays(t, UNITS[t].strongAgainst, b)) }));
  const mid = budgets[Math.floor(budgets.length / 2)];
  const beats = Object.fromEntries(types.map((t) => [t, types.filter((d) => d !== t && bothWays(t, d, mid))]));
  return { matchups, winRate, cycle, beats };
}

// ─── 2. The planner's fleet size ───────────────────────────────────────────────

/** The fleet size the planner keeps: the count of `type` that earns most at r a supply a day, less upkeep. */
export function plannerFleetSize(type, r, shipyardTier) {
  let best = { n: 0, net: 0 };
  for (let n = 1; n <= 1_000; n++) {
    const net = n * UNITS[type].supply * r - upkeepBreakdown(UNITS, { [type]: n }, shipyardTier).total;
    if (net > best.net) best = { n, net };
  }
  return best.n;
}

/** The Fleet Caps a corporation can have: data/milestones.json's maxFleetSize at each level that raises it. */
export const FLEET_CAPS = [8, 14, 22, 30, 40, 55, 70, 90];

/** The sweep: every ship type, r of 30, 45 and 90, shipyard tiers 0 to 3, each cap. Each run: size, cap, below. */
export function fleetSizeSweep({ rs = [30, 45, 90], tiers = [0, 1, 2, 3], caps = FLEET_CAPS } = {}) {
  const runs = [];
  for (const type of SHIP_UNIT_IDS) for (const r of rs) for (const tier of tiers) {
    const n = plannerFleetSize(type, r, tier);
    for (const cap of caps) runs.push({ type, r, tier, cap, n, below: n < cap, fraction: n / cap });
  }
  return runs;
}

// ─── 3. The raid world ─────────────────────────────────────────────────────────

const OPEX_SHARE = 0.35;
const START_CREDITS = 60_000;
const CAPITAL = { returnPct30: 24, halfLifeCredits: 400_000 };
const corpOf = (id) => getAccountById(id).state.corp;
const bid = (item) => Math.max(0, ...(getState()?.market?.npcBuyOrders || []).filter((o) => o.item === item).map((o) => Math.floor(Number(o.unitPrice) || 0)));
const unitsValue = (units) => Object.entries(units || {}).reduce((a, [id, q]) => a + (Number(q) || 0) * unitValue(id), 0);
const supplyOf = (units) => Object.entries(units || {}).reduce((a, [id, q]) => a + (Number(q) || 0) * UNITS[id].supply, 0);

function mutate(id, fn) { mutateAccountState(id, (s) => { ensureCorpMilitary(s.corp); fn(s.corp); }, { sanitize: false, settleMining: false }); }

/** A day of operations: the capital's income, in Silicates held at home; the fixed cost, in credits. */
function operate(bot, now) {
  if (bot.K <= 0) return;
  const income = capitalValue(bot.K, 1, CAPITAL);
  const units = Math.floor(income / Math.max(1, bid(GOOD)));
  mutate(bot.id, (c) => {
    c.inventory = c.inventory || {};
    c.inventory[STATION] = c.inventory[STATION] || {};
    c.inventory[STATION][GOOD] = (Number(c.inventory[STATION][GOOD]) || 0) + units;
    applyCredits(c, -bot.opex, "mining-ops", now);
  });
}

/**
 * The raider's pick: of the targets it may raid now, the one whose expected loot, less its expected losses at
 * replacement value, is highest; it knows each garrison (a report after one raid, or the warning a defender sees).
 * Null when none is worth it.
 */
function pickTarget(bot, now, claimed) {
  const fleet = corpOf(bot.id).military.fleets?.find((f) => f.id === bot.fleetId);
  if (!fleet || fleet.transit || !fleet.stationId) return null;
  const mine = Object.fromEntries(Object.entries(fleet.units).filter(([, q]) => q > 0));
  if (!Object.keys(mine).length) return null;
  let best = null;
  for (const t of raidTargets(bot.id, STATION, now)?.targets || []) {
    if (!t.eligible || claimed.has(t.corpId)) continue;
    const target = Object.values(bot.world).find((b) => corpOf(b.id).publicId === t.corpId);
    if (!target) continue;
    const tc = corpOf(target.id);
    const defenders = { dt: Number(tc.military?.garrisons?.[STATION]) || 0 };
    for (const f of tc.military?.fleets || []) if (f.stationId === STATION && !f.transit) for (const [id, q] of Object.entries(f.units)) defenders[id] = (defenders[id] || 0) + q;
    const battle = resolveBattle(mine, defenders);
    const lost = Object.fromEntries(Object.entries(mine).map(([id, q]) => [id, q - (battle.survivors.attacker[id] || 0)]));
    const loot = battle.winner === "attacker" ? lootFor(tc.inventory?.[STATION], battle.survivors.attacker).lootValue : 0;
    const net = loot - unitsValue(lost);
    if (net > 0 && (!best || net > best.net)) best = { corpId: t.corpId, net };
  }
  return best;
}

/**
 * Play the raid world. `newCorporation()` makes an account through the server; `setTime(t)` moves the clock.
 * Per profile: three producers, one raider, one mixed bot, each starting with the same worth. Warm-up days run the
 * producers only, past the 14 days of new-player protection, so there are goods to take on day one.
 */
export async function runRaidWorld({ newCorporation, setTime, start, profiles, warmupDays = 15, days = 30 }) {
  setTime(start);
  const bots = [];
  const sizing = [];
  for (const profile of profiles) {
    const world = {};
    const opex = Math.round(capitalValue(profile.capital, 1, CAPITAL) * OPEX_SHARE);
    // the raider's fleet: the unit strong against a garrison of defense troops, at the planner's size under the cap
    const type = Object.keys(UNITS).find((t) => UNITS[t].strongAgainst === "dt" && SHIP_UNIT_IDS.includes(t));
    const wanted = plannerFleetSize(type, profile.r, profile.shipyardTier);
    const n = Math.min(wanted, profile.cap);
    sizing.push({ profile: profile.name, type, wanted, cap: profile.cap, below: wanted < profile.cap });
    const fleetValue = n * unitValue(type);
    const garrison = Math.floor((profile.garrisonShare * profile.capital) / unitValue("dt"));
    const roles = [["producer", 3], ["raider", 1], ["mixed", 1]];
    for (const [role, count] of roles) {
      for (let i = 0; i < count; i++) {
        const id = await newCorporation();
        const military = role === "producer" ? { dt: garrison } : { [type]: n };
        const spent = unitsValue(military);
        const K = role === "raider" ? 0 : profile.capital - spent;
        const credits = START_CREDITS + (role === "raider" ? profile.capital - spent : 0);
        mutate(id, (c) => {
          c.level = 15;
          c.currentStationId = STATION;
          c.finances.credits = credits;
          c.finances.assets = Math.max(0, K);
          c.buildings = c.buildings || [];
          if (profile.shipyardTier > 0) c.buildings.push({ id: `bld-yard-${id}`, name: "Orbital Shipyard", tier: profile.shipyardTier, status: "Operational" });
          for (const [u, q] of Object.entries(military)) c.military.units[u] = q;
          if (military.dt) c.military.garrisons[STATION] = military.dt;
        });
        const bot = { id, role, profile: profile.name, K: Math.max(0, K), opex: K > 0 ? opex : 0, start: credits + Math.max(0, K) + spent, world, raids: [], lootValue: 0, lostValue: 0, supply: supplyOf(military) };
        if (role !== "producer") {
          mutate(id, (c) => { const r = formFleet(c, { units: { [type]: n } }, start); bot.fleetId = r.fleet?.id; });
        }
        world[`${role}${i}`] = bot;
        bots.push(bot);
      }
    }
  }
  const at = (d, h) => start + d * DAY + h * HOUR;
  for (let d = 0; d < warmupDays; d++) {
    setTime(at(d, 12));
    for (const bot of bots) if (bot.role !== "raider") operate(bot, at(d, 12));
  }
  let botDays = 0;
  for (let d = warmupDays; d < warmupDays + days; d++) {
    setTime(at(d, 7));
    // bots in one world do not pile onto the same target in a morning: the second raid would arrive in the first one's
    // cooldown and be turned back (assumed coordination; players see only their own raids)
    const claimed = new Set();
    for (const bot of bots) {
      if (bot.role === "producer") continue;
      const t = pickTarget(bot, at(d, 7), claimed);
      if (!t) continue;
      const r = declareRaid(bot.id, { targetCorpId: t.corpId, targetStationId: STATION, fleetId: bot.fleetId }, at(d, 7));
      if (r.ok) { bot.raids.push(r.raid.id); claimed.add(t.corpId); }
    }
    for (const h of [11.5, 12]) { setTime(at(d, h)); raidTick(at(d, h)); }
    setTime(at(d, 13));
    for (const bot of bots) {
      if (bot.role !== "raider") operate(bot, at(d, 13));
      settleAccountUpkeep(bot.id, at(d, 13));
      botDays++;
    }
  }
  const end = at(warmupDays + days, 1);
  setTime(end);
  for (const bot of bots) {
    for (const raidId of bot.raids) {
      const rep = raidReportFor(bot.id, raidId);
      if (!rep) continue;
      bot.lootValue += Object.entries(rep.loot || {}).reduce((a, [item, q]) => a + q * bid(item), 0);
      bot.lostValue += unitsValue(rep.attacker?.lost);
    }
    bot.r = bot.role !== "producer" && bot.supply ? (bot.lootValue - bot.lostValue) / (bot.supply * days) : null; // a garrison does not raid
    const statement = getStatements(bot.id, 1, end)?.statements?.[0]?.balanceSheet?.netWorth ?? 0;
    const units = corpOf(bot.id).military.units;
    bot.netWorth = Math.round(statement + unitsValue(units));
    delete bot.world;
  }
  return { bots, sizing, botDays, days, warmupDays };
}

/** The profiles the raid world is played on: capital against how much of it a producer keeps as a garrison. */
export const RAID_PROFILES = [200_000, 400_000].flatMap((capital) => [0.02, 0.08].map((garrisonShare) => ({
  name: `capital ${capital / 1000}k, garrison ${garrisonShare * 100}%`, capital, garrisonShare, r: 45, shipyardTier: 1, cap: 40
})));

// ─── The report ────────────────────────────────────────────────────────────────

const n0 = (x) => Math.round(x).toLocaleString("en-US");
const pct = (x) => `${(x * 100).toFixed(0)}%`;

/** The targets AB#877 and the raids design name, each PASS or FAIL with its numbers. Never softened here. */
export function targets({ matrix, sweep, world }) {
  const worst = Object.entries(matrix.winRate).sort((a, b) => b[1] - a[1])[0];
  const below = sweep.filter((r) => r.below).length;
  const byProfile = [...new Set(world.bots.map((b) => b.profile))].map((p) => {
    const of = (role) => world.bots.filter((b) => b.profile === p && b.role === role);
    const producer = of("producer").reduce((a, b) => a + b.netWorth, 0) / of("producer").length;
    return { p, producer, raider: of("raider")[0].netWorth };
  });
  const raiderAhead = byProfile.filter((x) => x.raider > x.producer);
  const rs = world.bots.filter((b) => b.r !== null).map((b) => b.r);
  const rMean = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  return [
    { target: "no composition wins more than 60% of matchups across budgets", result: worst[1] <= 0.6 ? "PASS" : "FAIL", detail: `highest ${worst[0]} ${pct(worst[1])}` },
    { target: "each unit beats the one it is strong against, both ways, at every budget (the five-way cycle)", result: matrix.cycle.every((c) => c.holds) ? "PASS" : "FAIL", detail: matrix.cycle.filter((c) => !c.holds).map((c) => `${c.unit} > ${c.strongAgainst} fails`).join("; ") || "all five" },
    { target: "planner fleet size below the Fleet Cap in at least 80% of runs", result: below / sweep.length >= 0.8 ? "PASS" : "FAIL", detail: `${below} of ${sweep.length} (${pct(below / sweep.length)})` },
    { target: "the pure raider does not beat the producer on net worth at day 30", result: raiderAhead.length ? "FAIL" : "PASS", detail: raiderAhead.length ? raiderAhead.map((x) => `${x.p}: raider ${n0(x.raider)} vs producer ${n0(x.producer)}`).join("; ") : `${byProfile.length} of ${byProfile.length} profiles` },
    { target: "r, what a raiding fleet earns a supply a day, lands between 30 and 90 (raids design section 8)", result: rMean === null ? "NO RAIDS" : rMean >= 30 && rMean <= 90 ? "PASS" : "FAIL", detail: rMean === null ? "no fleet" : `mean ${rMean.toFixed(1)} over ${rs.length} fleets (${rs.map((r) => r.toFixed(1)).join(", ")})` }
  ];
}

/** The report as text, headed with what it is (P-PROXY). */
export function formatReport({ matrix, sweep, world }) {
  const lines = [];
  lines.push("ISP combat probe (ISP-183, AB#877). BOT NUMBERS (P-PROXY): bots on the design's assumed business and fixed policies, not players.");
  lines.push(`Raid world: ${world.bots.length} bots, ${world.warmupDays} warm-up days, ${world.days} measured days: ${world.botDays} bot days. Raids run on the real resolver with D-0.10-1's caps (AB#705, answered).`);
  lines.push("");
  lines.push(`Counter matrix (pure compositions, budgets ${BUDGETS.map(n0).join(", ")}; win rate over every matchup, both roles):`);
  lines.push(`  ${Object.entries(matrix.winRate).map(([t, w]) => `${t} ${pct(w)}`).join(" | ")}; ${pct(matrix.matchups.filter((m) => m.winner === "draw").length / matrix.matchups.length)} of matchups end in a draw (both standing after the last round)`);
  lines.push(`  beats both ways at ${n0(BUDGETS[1])}: ${Object.entries(matrix.beats).map(([t, b]) => `${t} > ${b.join(",") || "none"}`).join("; ")}`);
  lines.push("");
  const byType = SHIP_UNIT_IDS.map((t) => {
    const runs = sweep.filter((r) => r.type === t);
    return `${t} ${runs.filter((r) => r.below).length}/${runs.length} below (sizes ${[...new Set(runs.map((r) => r.n))].join(", ")})`;
  });
  lines.push(`Planner fleet size against the cap (r 30/45/90, shipyard tiers 0-3, caps ${FLEET_CAPS.join(", ")}): ${byType.join("; ")}`);
  lines.push("");
  lines.push("Raid world, net worth at the last measured day (statement plus units at replacement value):");
  for (const p of [...new Set(world.bots.map((b) => b.profile))]) {
    const of = (role) => world.bots.filter((b) => b.profile === p && b.role === role);
    const prod = of("producer");
    const show = (b) => `${n0(b.netWorth)}${b.raids.length ? ` (${b.raids.length} raids, loot ${n0(b.lootValue)}, lost ${n0(b.lostValue)}, r ${b.r.toFixed(1)})` : ""}`;
    lines.push(`  ${p}: producers ${prod.map((b) => n0(b.netWorth)).join(", ")} | raider ${show(of("raider")[0])} | mixed ${show(of("mixed")[0])}`);
  }
  const s = world.sizing[0];
  lines.push(`  fleets: ${s.type} x ${Math.min(s.wanted, s.cap)} (the planner wanted ${s.wanted}, cap ${s.cap})`);
  lines.push("");
  for (const t of targets({ matrix, sweep, world })) lines.push(`${t.result.padEnd(8)} ${t.target}: ${t.detail}`);
  return lines.join("\n");
}
