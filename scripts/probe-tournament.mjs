#!/usr/bin/env node
// ISP-270 (AB#966): run the fleet composition tournament in full (tests/probes/tournament-probe.test.js: every
// composition on the grid at all three budgets and every modifier pair, and the raid ladder) and print its report.
// `--out <dir>` also writes the report, the raw numbers and the raid ladder's chart (raid-ladder.svg) there.
// BOT NUMBERS (P-PROXY). About a minute and a half.
import { spawnSync } from "node:child_process";

const i = process.argv.indexOf("--out");
const out = i >= 0 ? process.argv[i + 1] : "";
const vitest = process.platform === "win32" ? "npx.cmd" : "npx";
const run = spawnSync(vitest, ["vitest", "run", "tests/probes/tournament-probe.test.js", "--reporter=verbose"], {
  stdio: "inherit", shell: process.platform === "win32",
  env: { ...process.env, TOURNAMENT_PROBE: "1", ...(out ? { TOURNAMENT_OUT: out } : {}) }
});
process.exit(run.status ?? 1);
