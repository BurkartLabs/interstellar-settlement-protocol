// ISP-219 (AB#914): the conglomerate profile of the ISP probe, the same shape as marketsProbe.js and combatProbe.js.
// For conglomerates of 5, 20, 50 and 100 members it plays each member beside a solo corporation that is its twin (same
// system, same probes, same credits) for 7 days of asteroid expeditions, and prints credits per member per day at day 7,
// the level each size needs, and the size a planner bot chooses when size is a free choice (solo included).
//
// BOT NUMBERS (P-PROXY, DOCTRINE P-005). A bot is not a player. What these numbers measure is whether membership pays
// for itself on the mechanics that exist, and whether size has an interior optimum (T-018); they are not a fact about
// how anybody plays in a conglomerate.
//
// WHAT IS REAL AND WHAT IS ASSUMED:
//   - Real: the charter (foundConglomerate), membership (inviteCorporation, answerInvitation, 20 invitations a day),
//     treasury deposits with the 2% custody fee (depositToTreasury), upkeep charged at each UTC midnight
//     (settleTreasury), scouting and launching through the routes (so the shared-intel gate, beltSharedWith, decides
//     whether a member may launch on a partner's scouting, from its own system since Bug #4656, at the remote share of the
//     yield), expeditions mined out of the shared belt reserves
//     (asteroidExpeditionTick), and the standing bids ore is valued at.
//   - Assumed: every corporation has the prospecting research and two probes, sits in one belt system for the week
//     and launches both probes once a day on a standard survey. Nothing is sold: ore is counted at the standing bid, so
//     one bot's sales do not move another's price. A member deposits its share of each day's upkeep. The level a size
//     needs is set, not climbed (AB#896 tests the climb); what those levels cost per member is printed beside the
//     result, not taken from it. Hangar, station stakes and dominance change no credits on main: the station's member
//     perks (0% tax, offices at half rent) are in the catalog but not built, so they cannot be played.

import request from "supertest";
import { accountsStore } from "../../server/game/store.js";
import { getAccountById, getState, mutateAccountState, mutateState } from "../../server/gameState.js";
import { foundConglomerate, dailyUpkeep, settleTreasury } from "../../server/game/conglomerates.js";
import { findConglomerate, inviteCorporation, answerInvitation } from "../../server/game/membership.js";
import { depositToTreasury } from "../../server/game/treasury.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";
import { BELT_KEYS, EXPEDITION_LAUNCH_COST } from "../../server/game/asteroids.js";
import { allStations } from "../../server/game/stations.js";
import { asteroidExpeditionTick } from "../../server/ticks.js";
import { RESEARCH_LIBRARY } from "../../server/game/catalog.js";
import { BASE_YIELD_PER_MIN, RARITY_YIELD_MULTIPLIER } from "../../server/game/beltRules.js";

export const DAY = 86_400_000;
const HOUR = 3_600_000;
export const SIZES = [5, 20, 50, 100];
const PROBES = 2;
const START_CREDITS = 200_000;

const bid = (item) => Math.max(0, ...(getState()?.market?.npcBuyOrders || []).filter((o) => o.item === item).map((o) => Math.floor(Number(o.unitPrice) || 0)));
const raw = (id) => accountsStore.accounts[id];
/**
 * A generator for Math.random, seeded per twin and per launch, so a member's expedition and its solo twin's draw the
 * same id, and the yield (seeded from the id, server/game/asteroids.js) is the same draw: the week's difference between
 * twins is then membership, not luck. mulberry32.
 */
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const keyed = (s) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);

/** A corporation's worth for this probe: its credits and its goods at the standing bids. */
export function worthOf(id) {
  const corp = getAccountById(id).state.corp;
  const goods = Object.values(corp.inventory || {}).reduce((a, stock) => a + Object.entries(stock || {}).reduce((s, [item, q]) => s + (Number(q) || 0) * bid(item), 0), 0);
  return Math.round((Number(corp.finances.credits) || 0) + goods);
}
/** The first level whose member cap holds `n`, and what the levels up to it cost in all. */
export function levelFor(n) {
  const row = C.levels.find((l) => l.maxMembers >= n) || C.levels.at(-1);
  const cost = C.levels.filter((l) => l.level <= row.level).reduce((a, l) => a + l.cost, 0);
  return { level: row.level, maxMembers: row.maxMembers, cost };
}

/**
 * Play every size. `register()` makes an account through the server and returns { id, token }; `setTime(t)` moves the
 * clock; `app` is the server for the routes. Members are admitted before the measured week (the invitation limit lets
 * 20 in a day), then everyone plays 7 days.
 */
export async function runConglomerateProbe({ app, register, setTime, start, sizes = SIZES, days = 7 }) {
  const beltSystems = [...new Set(BELT_KEYS.map((k) => k.split(":")[0]))];
  const stationIn = (systemId) => allStations().find((s) => s.systemId === systemId)?.id ?? "earth-station-prime";
  const setup = async (systemId) => {
    const { id, token } = await register();
    mutateAccountState(id, (s) => {
      s.corp.finances.credits = START_CREDITS;
      // every research: a mid-game corporation whose navigation reaches every belt system (Bug #4656's remote launch
      // reads the same reach as travel)
      s.corp.unlockedTech = [...new Set([...(s.corp.unlockedTech || []), ...Object.keys(RESEARCH_LIBRARY)])];
      s.corp.currentSystemId = systemId;
      s.corp.currentStationId = stationIn(systemId);
      s.corp.asteroidMining = { ...(s.corp.asteroidMining || {}), probeCount: PROBES, maxDeployments: PROBES };
    }, { sanitize: false, settleMining: false });
    raw(id).createdAt = start - (C.minFounderAgeDays + 30) * DAY;
    return { id, token, systemId };
  };

  // the admission window before the week: sizes up to 100 need 5 days of invitations
  const admitFrom = start - 8 * DAY;
  setTime(admitFrom);
  const groups = [];
  for (const n of sizes) {
    const members = [], solos = [];
    for (let i = 0; i < n; i++) members.push(await setup(beltSystems[i % beltSystems.length]));
    groups.push({ n, members, solos });
    const founder = members[0];
    mutateAccountState(founder.id, (s) => { s.corp.currentStationId = C.charterStationId; s.corp.finances.credits = START_CREDITS + C.charterFee + C.charterDeposit; }, { sanitize: false, settleMining: false });
    const f = foundConglomerate(founder.id, { name: `Probe Pool ${n} ${start % 1000}`, emblem: 1, colour: 1 }, admitFrom);
    if (f.refused) throw new Error(`charter: ${f.refused.error}`);
    const c = findConglomerate(f.conglomerate.id);
    // the founder funds the upkeep of the admission days, which a treasury in arrears would stop (the join refuses)
    mutateAccountState(founder.id, (s) => { s.corp.finances.credits += 500_000; }, { sanitize: false, settleMining: false });
    const funded = depositToTreasury(founder.id, c.id, 500_000, admitFrom);
    if (funded.refused) throw new Error(`funding: ${funded.refused.error}`);
    const lv = levelFor(n);
    c.level = lv.level; // set, not climbed (AB#896 tests the climb); its cost is printed, not charged
    c.maxMembers = lv.maxMembers;
    let now = admitFrom;
    for (const m of members.slice(1)) {
      let inv = inviteCorporation(founder.id, c.id, raw(m.id).state.corp.publicId, now);
      if (inv.refused?.code === "invite-limit") { now += DAY; raw(founder.id).lastLoginAt = now; setTime(now); inv = inviteCorporation(founder.id, c.id, raw(m.id).state.corp.publicId, now); }
      if (inv.refused) throw new Error(`invite: ${inv.refused.error}`);
      const joined = answerInvitation(m.id, c.id, inv.invitation.id, "accept", now);
      if (joined.refused) throw new Error(`join: ${joined.refused.error}`);
    }
    mutateAccountState(founder.id, (s) => { s.corp.currentStationId = stationIn(founder.systemId); s.corp.finances.credits = START_CREDITS; }, { sanitize: false, settleMining: false });
    Object.assign(groups.at(-1), { c, level: lv });
  }
  // the solo twins, made after every member in the same order, so the expedition tick (which settles corporations in
  // the order they were made) meets them in the same pattern as their members
  for (const g of groups) for (const m of g.members) g.solos.push(await setup(m.systemId));
  for (const g of groups) g.members.forEach((m, i) => { m.key = `${g.n}:${i}`; g.solos[i].key = m.key; });

  const everyone = groups.flatMap((g) => [...g.members, ...g.solos]);
  setTime(start);
  for (const g of groups) settleTreasury(g.c, start);
  const at0 = new Map(everyone.map((b) => [b.id, worthOf(b.id)]));
  let botDays = 0, sharedLaunches = 0, scouts = 0;
  const refused = {}; // launches the server refused, by side and reason: a policy the probe should see
  const post = (b, path, body) => request(app).post(`/api/accounts/${b.id}/gameplay/${path}`).set("Authorization", `Bearer ${b.token}`).send(body);
  // Two weeks over the same dates on the same belts: the conglomerates' members, then (the belts put back as they were)
  // their solo twins. Each side meets fresh belts and the same neighbours, and nobody mines a twin's reserve.
  let belts;
  mutateState((w) => { belts = structuredClone(w.belts); });
  const realRandom = Math.random;
  const week = async (bots, pooled) => {
  for (let d = 0; d < days; d++) {
    const morning = start + d * DAY + 8 * HOUR;
    setTime(morning);
    if (pooled) for (const g of groups) {
      // each member pays in its share of today's upkeep, plus the custody fee; midnight's charge takes it
      const share = Math.ceil(dailyUpkeep(g.members.length) / g.members.length / (1 - C.poolingFeePct / 100));
      for (const m of g.members) depositToTreasury(m.id, g.c.id, share, morning);
    }
    // What the morning's launches will draw from each belt, so a later choice sees what is left (the design's intel
    // table: "choose between belts on what is left"). Reserves are the world's, so every bot reads the same claims.
    const claimed = {};
    for (const b of bots) {
      const own = BELT_KEYS.find((k) => k.startsWith(`${b.systemId}:`));
      // The belt to launch to: its own, or (a member) the partner-scouted belt that nets most after the remote share.
      // Expected value of a standard survey: 60 min x the base yield x the rarity, at the standing bids, x the share.
      const read = async () => (await request(app).get(`/api/accounts/${b.id}/gameplay/belt-compositions`).set("Authorization", `Bearer ${b.token}`)).body;
      let view = await read();
      // its own belt, whenever it is there and not scouted by itself: at the start, and after a belt is mined out and a
      // new one forms (the tick forgets everyone's scouting of an emptied belt)
      const mine = view.belts?.[own];
      if (mine?.present && (!mine.scouted || mine.sharedBy?.length)) { scouts++; await post(b, "scout-belt", { beltKey: own }); view = await read(); }
      const unitsOf = (v, share) => 60 * BASE_YIELD_PER_MIN * (RARITY_YIELD_MULTIPLIER[v.rarity] || 1) * share * PROBES;
      const worth = (v, share, key) => {
        // what the launches would bring home, no more than is left after the morning's claims
        const units = Math.min(unitsOf(v, share), Math.max(0, Number(v.remaining) - (claimed[key] || 0)));
        if (!(units > 0)) return -Infinity;
        const total = Object.values(v.composition || {}).reduce((a, w) => a + w, 0) || 1;
        // net of the launches' cost: a trip that brings home less than it costs is not made
        return units * Object.entries(v.composition || {}).reduce((a, [item, w]) => a + (w / total) * bid(item), 0) - EXPEDITION_LAUNCH_COST * PROBES;
      };
      let beltKey = own, best = view.belts?.[own]?.scouted ? worth(view.belts[own], 1, own) : -Infinity, remote = false, share = 1;
      if (pooled) {
        const pct = (Number(view.remoteDispatchYieldPct) || 0) / 100;
        for (const [key, v] of Object.entries(view.belts || {})) {
          if (key === own || !v.sharedBy?.length || !v.present || key.split(":")[0] === b.systemId) continue;
          const w = worth(v, pct, key);
          if (w > best) { best = w; beltKey = key; remote = true; share = pct; }
        }
      }
      if (!(best > 0)) { Math.random = realRandom; continue; } // nothing worth launching to today
      if (view.belts?.[beltKey]) claimed[beltKey] = (claimed[beltKey] || 0) + unitsOf(view.belts[beltKey], share);
      const launch = (p) => { Math.random = seeded(keyed(`${b.key}:${d}:${p}`)); return post(b, "launch-expedition", { beltKey, duration: "standard" }); };
      for (let p = 0; p < PROBES; p++) {
        const r = await launch(p);
        if (r.status === 200 && remote) sharedLaunches++;
        if (r.status !== 200) { const why = `${pooled ? "member" : "solo"}: ${r.body?.error || r.status}`; refused[why] = (refused[why] || 0) + 1; }
      }
      Math.random = realRandom;
    }
    const later = morning + HOUR; // dev durations: a standard survey is 10 seconds with its yield scaled to the hour
    setTime(later);
    asteroidExpeditionTick(later);
    botDays += bots.length;
    const night = start + (d + 1) * DAY + 60_000;
    setTime(night);
    if (pooled) for (const g of groups) settleTreasury(g.c, night);
  }
  };
  await week(groups.flatMap((g) => g.members), true);
  const end = Date.now();
  mutateState((w) => { w.belts = structuredClone(belts); });
  await week(groups.flatMap((g) => g.solos), false);
  setTime(end);

  const rows = groups.map((g) => {
    const perDay = (list) => list.reduce((a, b) => a + (worthOf(b.id) - at0.get(b.id)), 0) / list.length / days;
    const member = perDay(g.members), solo = perDay(g.solos);
    return { n: g.n, level: g.level, member, solo, edgePct: solo ? ((member - solo) / Math.abs(solo)) * 100 : null, upkeepPerMember: dailyUpkeep(g.n) / g.n, arrears: Boolean(g.c.arrearsSince), treasury: Math.round(g.c.treasury.credits) };
  });
  // The planner: the size whose members gain most a day over their own solo twins (each size's corporations sit in
  // different systems, so sizes are compared through their twins, never with each other directly); solo, a gain of 0,
  // when no size gains; the smaller on a tie.
  const choices = [{ n: 1, gain: 0 }, ...rows.map((r) => ({ n: r.n, gain: r.member - r.solo }))];
  const chosen = choices.reduce((best, x) => (x.gain > best.gain + 1e-9 ? x : best), choices[0]);
  return { rows, chosen, choices, botDays, days, sharedLaunches, scouts, refused, accounts: everyone.length };
}

// ─── The report ────────────────────────────────────────────────────────────────

const n0 = (x) => Math.round(x).toLocaleString("en-US");

/** The targets AB#914 names, each PASS or FAIL with its numbers. Never softened here: a miss is reported and filed. */
export function targets(report) {
  const max = Math.max(...report.rows.map((r) => r.n));
  const out = report.rows.filter((r) => r.edgePct === null || r.edgePct < 5 || r.edgePct > 30);
  return [
    { target: "the planner bot does not always choose the maximum size", result: report.chosen.n !== max ? "PASS" : "FAIL", detail: `it chose ${report.chosen.n === 1 ? "solo" : `${report.chosen.n} members`}` },
    { target: "a member beats a solo corporation on credits at day 7 by 5% to 30%", result: out.length ? "FAIL" : "PASS", detail: report.rows.map((r) => `${r.n}: ${r.edgePct === null ? "n/a" : `${r.edgePct >= 0 ? "+" : ""}${r.edgePct.toFixed(1)}%`}`).join(", ") }
  ];
}

/** The report as text, headed with what it is (P-PROXY). */
export function formatReport(report) {
  const lines = [];
  lines.push("ISP conglomerate probe (ISP-219, AB#914). BOT NUMBERS (P-PROXY): bots on fixed policies, not players.");
  lines.push(`${report.accounts} corporations (each member with a solo twin in its system), ${report.days} days: ${report.botDays} bot days.`);
  lines.push("");
  lines.push(`Credits per corporation per day over ${report.days} days (credits and ore at the standing bids; the charter and levels, paid before, not counted):`);
  for (const r of report.rows) {
    lines.push(`  ${String(r.n).padStart(3)} members (level ${r.level.level}, cap ${r.level.maxMembers}): member ${n0(r.member)} | solo twin ${n0(r.solo)} | edge ${r.edgePct === null ? "n/a" : `${r.edgePct >= 0 ? "+" : ""}${r.edgePct.toFixed(1)}%`} | upkeep ${n0(r.upkeepPerMember)} a member a day | levels to here ${n0(r.level.cost)} (${n0(r.level.cost / r.n)} a member, not counted)${r.arrears ? " | IN ARREARS" : ""}`);
  }
  lines.push(`Members' remote launches on a partner's scouting (Bug #4656): ${report.sharedLaunches}; own belts scouted: ${report.scouts}.`);
  lines.push(`Launches refused: ${Object.entries(report.refused).map(([why, k]) => `${why} x${k}`).join("; ") || "none"}`);
  lines.push(`Planner's chosen size (the most gained a member a day over its solo twin): ${report.chosen.n === 1 ? "solo" : report.chosen.n} (${report.choices.map((c) => `${c.n === 1 ? "solo" : c.n} ${c.gain >= 0 ? "+" : ""}${n0(c.gain)}`).join(", ")})`);
  lines.push("");
  for (const t of targets(report)) lines.push(`${t.result.padEnd(8)} ${t.target}: ${t.detail}`);
  return lines.join("\n");
}
