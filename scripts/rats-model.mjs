// scripts/rats-model.mjs: the arithmetic behind docs/design/rats.md (ISP-164 follow-on, AB#819). For every belt, every
// expedition length and every escort on the menu, the expected result of one launch, with the encounter formula, the
// Rat groups and the unescorted outcome table as the design states them, and the escort battles fought by the real
// combat resolver (server/game/combat.js). Prints the table the design quotes and the best setting per belt.
// Usage: node scripts/rats-model.mjs [--belt <systemId>]
import { resolveBattle } from "../server/game/combat.js";
import { UNITS } from "../server/game/units.js";
import { ECONOMY } from "../server/economy.js";
import { SYSTEMS_DATA } from "../server/game/catalog.js";
import { BASE_YIELD_PER_MIN, RARITY_YIELD_MULTIPLIER } from "../server/game/beltRules.js";

// ── The design's numbers: data/rats.json, through the server's own module (one source, P-TWO-SOURCES) ──
import { RATS, forcePower, ratGroup as serverRatGroup, encounterRate as serverRate } from "../server/game/rats.js";
export { RATS };
export const ESCORTS = {
  none: {},
  "4 LF": { lf: 4 },
  "6 LF + 2 DS": { lf: 6, ds: 2 },
  "4 DS + 4 AT": { ds: 4, at: 4 },
  "6 DS + 6 AT": { ds: 6, at: 6 },
  "12 LF + 4 DS + 6 AT": { lf: 12, ds: 4, at: 6 }
};

const price = (item) => (ECONOMY.npcBuyers || []).find((b) => b.item === item)?.unitPrice || 0;
const unitValue = (id) => UNITS[id].credits + Object.entries(UNITS[id].goods).reduce((s, [g, q]) => s + price(g) * q, 0);
const valueOf = (force) => Object.entries(force).reduce((s, [id, n]) => s + n * unitValue(id), 0);
const power = forcePower;
const supply = (force) => Object.entries(force).reduce((s, [id, n]) => s + n * UNITS[id].supply, 0);
export const meanHaulLost = RATS.unescorted.reduce((s, r) => s + r.chance * r.haulLost, 0);

/** The belt's Rat group from its system's pirate density (the server's rule). */
export const ratGroup = serverRatGroup;
/** Encounters an expedition of `hours` expects, with the escort's deterrence (the server's rule). */
export const encounterRate = (density, hours, escort = {}) => serverRate(density, hours, forcePower(escort));
/** The chance an expedition of `hours` meets Rats at least once: what the launch screen shows. */
export function encounterChance(density, hours, escort = {}) {
  return 1 - Math.exp(-encounterRate(density, hours, escort));
}
const poisson = (mu, k) => Math.exp(-mu) * mu ** k / [1, 1, 2, 6, 24, 120, 720][k];
const MAX_ENCOUNTERS = 6;

export function belts() {
  return SYSTEMS_DATA.flatMap((s) => (s.bodies || []).filter((b) => b.type === "Field").map((b) => ({ system: s, belt: b })));
}
function haulValuePerUnit(belt) {
  const comp = belt.composition || {};
  const total = Object.values(comp).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(comp).reduce((s, [item, share]) => s + (share / total) * price(item), 0);
}

/**
 * One launch's expected result: { profit, perHour, p, win, escortLoss, haul }. Encounters are Poisson over the
 * expedition. Each is fought in turn by what is left of the escort (the resolver decides); while the escort holds, the
 * haul is safe; once it is beaten, or with none, each encounter takes its share of the haul (the unescorted table).
 */
export function launch({ system, belt }, length, escortName) {
  const hours = RATS.lengthsHours[length];
  const escort = ESCORTS[escortName];
  const d = system.pirateDensity;
  const haul = BASE_YIELD_PER_MIN * 60 * hours * RARITY_YIELD_MULTIPLIER[system.rarity] * haulValuePerUnit(belt);
  const mu = encounterRate(d, hours, escort);
  const group = ratGroup(d);
  let expectedHaulKept = 0, expectedEscortLoss = 0, pHold = 0;
  for (let k = 0; k <= MAX_ENCOUNTERS; k += 1) {
    const pk = poisson(mu, k);
    let force = { ...escort }, kept = 1, held = true;
    for (let i = 0; i < k; i += 1) {
      if (held && power(force) > 0) {
        const g = i === 0 ? group : Object.fromEntries(Object.entries(group).map(([id, n]) => [id, Math.round(n * (1 + RATS.gathering * i))]));
        const fight = resolveBattle(force, g);
        if (fight.winner === "defender") held = false;
        force = Object.fromEntries(Object.keys(escort).map((id) => [id, fight.survivors.attacker[id] ?? 0]));
        if (!held) kept *= 1 - meanHaulLost;
      } else {
        held = false;
        kept *= 1 - meanHaulLost;
      }
    }
    const lost = Object.fromEntries(Object.keys(escort).map((id) => [id, escort[id] - (force[id] ?? 0)]));
    expectedHaulKept += pk * kept;
    expectedEscortLoss += pk * valueOf(lost);
    if (held) pHold += pk;
  }
  const cost = ECONOMY.expeditions.launchCost + RATS.escortCostPerSupplyHour * supply(escort) * hours;
  const profit = haul * expectedHaulKept - cost - expectedEscortLoss;
  return { profit, perHour: profit / hours, p: 1 - Math.exp(-mu), win: pHold, escortLoss: expectedEscortLoss, haul, cost };
}

/** The best setting for a belt: highest expected profit per slot-hour (a deployment slot is the scarce thing). */
export function best(b) {
  let top = null;
  for (const length of Object.keys(RATS.lengthsHours)) {
    for (const escort of Object.keys(ESCORTS)) {
      const r = launch(b, length, escort);
      if (!top || r.perHour > top.r.perHour) top = { length, escort, r };
    }
  }
  return top;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("rats-model.mjs")) {
  const only = process.argv.includes("--belt") ? process.argv[process.argv.indexOf("--belt") + 1] : null;
  if (process.argv.includes("--table")) { // the design's belt table, as Markdown
    console.log("| Belt | System | Density | Rat group | Short | Standard | Extended | Best setting (one probe) | Per slot-hour |");
    console.log("|---|---|---:|---|---:|---:|---:|---|---:|");
    for (const b of belts()) {
      const d = b.system.pirateDensity, g = ratGroup(d), top = best(b);
      const pc = (len) => `${(encounterChance(d, RATS.lengthsHours[len]) * 100).toFixed(0)}%`;
      console.log(`| ${b.belt.name} | ${b.system.name} | ${d} | ${g.lf} LF${g.ds ? ` + ${g.ds} DS` : ""} | ${pc("short")} | ${pc("standard")} | ${pc("extended")} | ${top.length}, ${top.escort === "none" ? "no escort" : top.escort} | ${Math.round(top.r.perHour).toLocaleString("en-US")} |`);
    }
    process.exit(0);
  }
  const all = belts();
  const settings = new Map();
  for (const b of all) {
    if (only && b.system.id !== only) continue;
    const top = best(b);
    const key = `${top.length} / ${top.escort}`;
    settings.set(key, (settings.get(key) || 0) + 1);
    const g = ratGroup(b.system.pirateDensity);
    console.log(`${b.system.id.padEnd(17)} d=${String(b.system.pirateDensity).padStart(2)} rats=${g.lf}LF+${g.ds}DS  best: ${key.padEnd(24)} ${Math.round(top.r.perHour).toLocaleString("en-US").padStart(7)}/h  p=${(top.r.p * 100).toFixed(1)}%`);
    if (only) {
      for (const length of Object.keys(RATS.lengthsHours)) {
        console.log(`  ${length}: ` + Object.keys(ESCORTS).map((e) => { const r = launch(b, length, e); return `${e}=${Math.round(r.perHour)} hold${Math.round(r.win * 100)} p${(r.p * 100).toFixed(1)}`; }).join(" | "));
      }
    }
  }
  console.log("settings:", JSON.stringify(Object.fromEntries(settings)));
}
