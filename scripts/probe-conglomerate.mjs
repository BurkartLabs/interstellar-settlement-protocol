#!/usr/bin/env node
// ISP-219 (AB#914): run the conglomerate probe's full table (tests/probes/conglomerate-probe.test.js: 5, 20, 50 and 100
// members against their solo twins for 7 days) and print its report. BOT NUMBERS (P-PROXY): bots on fixed policies, not
// players. Slow: it registers 350 corporations through the server. The ordinary suite runs 5 members for 3 days.
import { spawnSync } from "node:child_process";

const vitest = process.platform === "win32" ? "npx.cmd" : "npx";
const run = spawnSync(vitest, ["vitest", "run", "tests/probes/conglomerate-probe.test.js", "--reporter=verbose"], {
  stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, CONGLOMERATE_PROBE: "1" }
});
process.exit(run.status ?? 1);
