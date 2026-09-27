#!/usr/bin/env node
// ISP-162 (AB#856): run the financial-markets probe's full table (tests/probes/markets-probe.test.js, every profile for
// 30 days) and print its report. BOT NUMBERS (P-PROXY): bots on the design's assumed business, not players. About 4
// minutes. The ordinary suite runs one profile for 5 days, to prove the harness executes bot days.
import { spawnSync } from "node:child_process";

const vitest = process.platform === "win32" ? "npx.cmd" : "npx";
const run = spawnSync(vitest, ["vitest", "run", "tests/probes/markets-probe.test.js", "--reporter=verbose"], {
  stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, MARKETS_PROBE: "1" }
});
process.exit(run.status ?? 1);
