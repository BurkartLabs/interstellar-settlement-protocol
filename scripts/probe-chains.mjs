#!/usr/bin/env node
// ISP-141 (AB#835): run the production-chain probe's full table (tests/probes/chain-probe.test.js) and print its report.
// BOT NUMBERS (P-PROXY). CHAIN_PROBE_SUPPLY_HOURS changes the week's raw supply (tests/probes/chainProbe.js weekSupply).
import { spawnSync } from "node:child_process";

const vitest = process.platform === "win32" ? "npx.cmd" : "npx";
const run = spawnSync(vitest, ["vitest", "run", "tests/probes/chain-probe.test.js", "--reporter=verbose"], {
  stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, CHAIN_PROBE: "1" }
});
process.exit(run.status ?? 1);
