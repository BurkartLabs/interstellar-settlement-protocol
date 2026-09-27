#!/usr/bin/env node
// ISP-183 (AB#877): run the combat probe's full table (tests/probes/combat-probe.test.js, every raid profile for
// 30 days, with the counter matrix and the fleet-size sweep) and print its report. BOT NUMBERS (P-PROXY): bots on the
// design's assumed business and fixed policies, not players. About a minute. The ordinary suite runs one raid profile
// for 5 days, to prove the harness executes bot days.
import { spawnSync } from "node:child_process";

const vitest = process.platform === "win32" ? "npx.cmd" : "npx";
const run = spawnSync(vitest, ["vitest", "run", "tests/probes/combat-probe.test.js", "--reporter=verbose"], {
  stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, COMBAT_PROBE: "1" }
});
process.exit(run.status ?? 1);
