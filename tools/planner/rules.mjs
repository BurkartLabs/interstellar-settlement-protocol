// The rules the Economy Planner prices actions with (AB#4911): the game's data files as they are in this checkout, plus
// the rules that live in code rather than data (scripts/economy-model.mjs CODE_RULES, which its own test holds to the
// server). Node only; the browser gets the result as /rules.json from scripts/planner.mjs.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CODE_RULES } from "../../scripts/economy-model.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));

export function loadRules() {
  const economy = readJson("data/economy.json");
  const research = [];
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if ("costCredits" in o) research.push(o); else Object.values(o).forEach(walk); } };
  walk(readJson("data/research.json"));
  research.sort((a, b) => a.tier - b.tier || a.costCredits - b.costCredits);
  const systems = readJson("data/systems.json");
  const leases = (Array.isArray(systems) ? systems : systems.systems || [])
    .flatMap((s) => (s.bodies || []).filter((b) => Number(b.leaseCost) > 0).map((b) => ({ system: s.name, body: b.name, cost: Number(b.leaseCost) })))
    .sort((a, b) => a.cost - b.cost);
  const code = Object.fromEntries(Object.entries(CODE_RULES).map(([k, v]) => [k, v.value]));
  let commit = "unknown";
  try { commit = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: ROOT }).toString().trim(); } catch { /* not a checkout */ }
  return { commit, economy, research, leases, code };
}
