#!/usr/bin/env node
// ISP-193 (AB#887): run the Tier 4 probe's full table (tests/probes/tier4-probe.test.js, 200 seeded market states
// per contest, both markets, with reachability and the time to each first unit) and print its report. BOT NUMBERS
// (P-PROXY): a planner over the data and the bid rule, not players. Seconds. The ordinary suite plays 20 states.
import { spawnSync } from "node:child_process";

const vitest = process.platform === "win32" ? "npx.cmd" : "npx";
const run = spawnSync(vitest, ["vitest", "run", "tests/probes/tier4-probe.test.js", "--reporter=verbose"], {
  stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, TIER4_PROBE: "1" }
});
process.exit(run.status ?? 1);
