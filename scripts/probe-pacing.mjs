// npm run probe:pacing (ISP-283, AB#990): the year-pacing probe. The ladder bot (tests/probes/ladderBot.js, AB#799)
// climbs every defined level on the server's PRODUCTION timings, on an injected clock, twice:
//
//   check-in   two check-ins a simulated day (every 12 hours), the cheapest path: the profile the targets are for
//   always-on  a look every simulated hour: the lower bound, as fast as this bot's policy can go
//
// and prints, per level and per profile, the simulated day it was reached, the credits spent on purchases and the
// research hours queued. These are BOT NUMBERS (P-PROXY): what one policy did against these rules, not how long a
// person takes. docs/design/ladder-11-40.md sets the targets: the check-in profile fails when a level with a target is
// reached more than 15% earlier or later than its day, and, once Levels 31 to 40 are defined, unless Level 40 falls
// between simulated day 330 and day 400.
//
// Each profile runs in a child process of its own, so each has a fresh server, a fresh temporary data directory and a
// clock that only moves forward. The clock is replaced before the server is imported, and so before the corporation
// exists: whatever registration stamps is on the probe's clock, not the machine's (AB#990's harness note).
//
// The bot drives the game through its HTTP routes and exported tick functions. The one step that is not a route is
// creating the account: under NODE_ENV=production registration needs SMTP to send the verification link (AB#2288,
// AB#989), so the probe calls the same server functions the e2e seeds do (createAccount, then verifying the token).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "..");
const PROFILES = { "check-in": { stepHours: 12, says: "two check-ins a day (every 12 h)" }, "always-on": { stepHours: 1, says: "a look every hour (lower bound)" } };
const START = Date.UTC(2026, 0, 1, 9, 0, 0); // AB#799's start: a Thursday morning; the NPC reset is calendar-based
const TOLERANCE = 0.15;
const LEVEL_40_WINDOW = [330, 400];
const MAX_DAYS = Number(process.env.PACING_DAYS || 400);
const ALWAYS_ON_DAYS = Number(process.env.PACING_ALWAYS_ON_DAYS || 20);

/** Per-level target days from the design: Level 10's from its text, 11 to 40 from the table's "probe day" column. */
export function targetDays(doc) {
  const days = {};
  const ten = doc.match(/Level 10 at day (\d+)/);
  if (ten) days[10] = Number(ten[1]);
  for (const m of doc.matchAll(/^\| (\d+) \| (\d+) \|/gm)) days[Number(m[1])] = Number(m[2]);
  return days;
}

/** What is wrong with a check-in run against the targets; empty when it passes. */
export function judge(records, targets, maxDefined) {
  const failures = [];
  for (const r of records) {
    const target = targets[r.level];
    if (!target) continue;
    const day = r.totalHours / 24;
    if (Math.abs(day - target) > target * TOLERANCE) {
      failures.push(`Level ${r.level} at simulated day ${day.toFixed(1)}, target ${target} (±${TOLERANCE * 100}%: ${(target * (1 - TOLERANCE)).toFixed(1)} to ${(target * (1 + TOLERANCE)).toFixed(1)})`);
    }
  }
  if (maxDefined >= 40) {
    const forty = records.find((r) => r.level === 40);
    const day = forty ? forty.totalHours / 24 : null;
    if (day === null || day < LEVEL_40_WINDOW[0] || day > LEVEL_40_WINDOW[1]) {
      failures.push(`Level 40 ${day === null ? "not reached" : `at simulated day ${day.toFixed(1)}`}, must fall between day ${LEVEL_40_WINDOW[0]} and day ${LEVEL_40_WINDOW[1]}`);
    }
  }
  return failures;
}

/**
 * Bug #2311: the always-on profile is the lower bound only while it is never slower than the check-in. Each level the
 * check-in reached inside the always-on run's `days` that the always-on reached later, or not at all; empty when it
 * leads throughout. (It stalled at Level 4, stranded at Mars, while the check-in climbed to Level 10.)
 */
export function lowerBoundLate(checkIn, alwaysOn, days) {
  const at = (records, level) => records.find((r) => r.level === level);
  const late = [];
  for (const c of checkIn.filter((r) => r.totalHours / 24 <= days)) {
    const a = at(alwaysOn, c.level);
    if (!a) late.push(`Level ${c.level}: check-in at day ${(c.totalHours / 24).toFixed(1)}, always-on not within its ${days} days`);
    else if (a.totalHours > c.totalHours) late.push(`Level ${c.level}: check-in at day ${(c.totalHours / 24).toFixed(1)}, always-on later, at day ${(a.totalHours / 24).toFixed(1)}`);
  }
  return late;
}

// ─── One profile, in its own process ──────────────────────────────────────────

let clock = START;
function installClock() {
  const RealDate = Date;
  function FakeDate(...args) {
    // `new Date()` with no arguments is the only case that must lie; everything else is the real thing.
    if (!new.target) return new RealDate(clock).toString();
    return args.length ? new RealDate(...args) : new RealDate(clock);
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => clock;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  globalThis.Date = FakeDate;
}

async function runProfile(name) {
  const { stepHours } = PROFILES[name];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-pacing-"));
  process.env.ISP_DATA_DIR = dir;
  process.env.PORT = "0";
  // Production, deliberately: anything else runs the development timings (research instant, an expedition ten
  // seconds; server/app.js IS_DEV), and a day count on those means nothing.
  process.env.NODE_ENV = "production";
  // Long enough for server/jwtSecret.js's production check; it signs nothing that leaves this process.
  process.env.JWT_SECRET = "isp-pacing-probe-not-a-real-secret-0123456789abcdef0123456789";
  process.env.ISP_DISABLE_TICKERS = "1";
  // Never the Board's Supabase or mail: blank, not deleted, because loadEnv repopulates anything undefined from .env.
  for (const k of ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "ISP_SMTP_HOST", "ISP_SMTP_USER", "ISP_SMTP_PASSWORD"]) {
    process.env[k] = "";
  }
  installClock(); // before the server, and so before the account
  const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
  const { app, server } = await load("server/index.js");
  const { default: request } = await load("node_modules/supertest/index.js");
  const store = await load("server/gameState.js");
  const { issueVerificationToken, verifyEmailToken } = await load("server/emailVerification.js");
  const ticks = await load("server/ticks.js");
  const { MILESTONE_LEVELS, MAX_DEFINED_LEVEL } = await load("server/game/catalog.js");
  const { climb } = await load("tests/probes/ladderBot.js");
  const research = JSON.parse(fs.readFileSync(path.join(ROOT, "data/research.json"), "utf8")).nodes;

  const account = { email: `pacing-${name}@probe.invalid`, password: "Pacing-probe-pass-1" };
  const created = await store.createAccount({ ...account, ceoName: "Pacing Bot", corpName: `Pacing ${name}` });
  if (created.error) throw new Error(`creating the account: ${created.error}`);
  account.id = created.account.id;
  verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: what clicking the emailed link does

  const tick = async () => {
    ticks.checkAndResetNpcBuyOrders();
    ticks.miningTick();
    ticks.refineryTick();
    ticks.fabricationTick();
    ticks.asteroidExpeditionTick();

    ticks.beltTick(); // AB#2330: a mined-out belt forms anew on the hour, as the server's minute ticker has it
    ticks.travelTick();
    ticks.shipmentTick(); // AB#800: ore shipped home from Mars and Luna
    ticks.processRndCompletions();
  };
  let records = [];
  let stopped = null;
  try {
    records = await climb({
      request: request(app),
      account,
      clock: { now: () => clock, advance: (ms) => { clock += ms; } },
      tick,
      levels: MILESTONE_LEVELS,
      research,
      maxLevel: MAX_DEFINED_LEVEL,
      maxDays: MAX_DAYS,
      stepHours,
      log: process.env.PACING_LOG ? (line) => console.error(`[${name}] ${line}`) : undefined
    });
  } catch (error) {
    stopped = String(error?.message || error);
    records = error?.records || [];
  }
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  return { profile: name, maxDefined: MAX_DEFINED_LEVEL, records, stopped };
}

// ─── The parent: both profiles, the table, the verdict ───────────────────────

function child(name, maxDays) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PACING_DAYS: String(maxDays) };
    const proc = spawn(process.execPath, [HERE, "--profile", name], { cwd: ROOT, env, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    proc.stdout.on("data", (d) => { out += d; });
    proc.on("error", reject);
    proc.on("close", (code) => {
      const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop();
      if (code !== 0 || !line) return reject(new Error(`the ${name} profile exited ${code}:\n${out}`));
      resolve(JSON.parse(line));
    });
  });
}

async function main() {
  const began = performance.now();
  const targets = targetDays(fs.readFileSync(path.join(ROOT, "docs/design/ladder-11-40.md"), "utf8"));
  // AB#800: with 20 levels the check-in profile runs about half a simulated year (about 3 minutes), and an hourly step
  // costs about 12 seconds of wall time a simulated day, so the always-on run covers only its first ALWAYS_ON_DAYS, in
  // parallel: the lower bound for the early levels, not the whole ladder, inside the probe's five minutes.
  const alwaysOnDays = Math.min(MAX_DAYS, ALWAYS_ON_DAYS);
  const [checkIn, alwaysOn] = await Promise.all([child("check-in", MAX_DAYS), child("always-on", alwaysOnDays)]);
  const byLevel = (run, level) => run.records.find((r) => r.level === level);
  const day = (r) => (r ? (r.totalHours / 24).toFixed(1) : "—");
  const n = (v) => (v === undefined ? "—" : v.toLocaleString("en-US"));

  console.log("Year-pacing probe (ISP-283, AB#990). BOT NUMBERS, NOT PLAYER TIME (P-PROXY): what the ladder bot's");
  console.log("cheapest-path policy did on production timings and an injected clock. A person plays differently.");
  console.log(`  check-in:  ${PROFILES["check-in"].says}   always-on: ${PROFILES["always-on"].says}`);
  console.log(`  targets: docs/design/ladder-11-40.md (check-in profile, ±${TOLERANCE * 100}%)\n`);
  console.log("level | target day | check-in: day, credits spent, research h queued | always-on: day, credits spent, research h queued");
  for (let level = 1; level <= checkIn.maxDefined; level++) {
    const c = byLevel(checkIn, level);
    const a = byLevel(alwaysOn, level);
    console.log(`${String(level).padStart(5)} | ${String(targets[level] ?? "—").padStart(10)} | ${day(c).padStart(6)}, ${n(c?.spent).padStart(10)} cr, ${n(c?.researchHours).padStart(5)} h | ${day(a).padStart(6)}, ${n(a?.spent).padStart(10)} cr, ${n(a?.researchHours).padStart(5)} h`);
  }
  const undefinedTargets = Object.keys(targets).map(Number).filter((l) => l > checkIn.maxDefined);
  if (undefinedTargets.length) console.log(`\nLevels ${Math.min(...undefinedTargets)} to ${Math.max(...undefinedTargets)} have targets but are not in the data yet; not judged.`);

  const failures = [];
  if (checkIn.stopped) failures.push(`check-in: ${checkIn.stopped}`);
  // The targets judge the check-in profile only. The always-on run is the lower bound, so it fails when it is slower
  // (Bug #2311): a finding about the bot, not about the design.
  if (alwaysOn.stopped) console.log(`
always-on ran its first ${alwaysOnDays} simulated days (the cap, PACING_ALWAYS_ON_DAYS) and reached Level ${alwaysOn.records.at(-1)?.level ?? 0}.`);
  failures.push(...judge(checkIn.records, targets, checkIn.maxDefined).map((f) => `check-in: ${f}`));
  failures.push(...lowerBoundLate(checkIn.records, alwaysOn.records, alwaysOnDays).map((f) => `always-on is not the lower bound: ${f}`));
  console.log(`\n(${((performance.now() - began) / 1000).toFixed(0)} s of wall time)`);
  if (failures.length) {
    console.log(`\nFAIL (bot numbers against the design's targets):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("\nPASS: every defined level with a target falls within 15% of it on the check-in profile (bot numbers).");
  }
}

const flag = process.argv.indexOf("--profile");
if (flag > 0) {
  const result = await runProfile(process.argv[flag + 1]);
  process.stdout.write(`\n${JSON.stringify(result)}\n`);
  process.exit(0); // the server's handles (sockets, timers) would keep the child alive
} else if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  await main();
}
