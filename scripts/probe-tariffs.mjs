#!/usr/bin/env node
// ISP-234 (AB#929): run the tariff and dumping probe's full table (tests/probes/tariff-probe.test.js: both worked-example
// tariff sweeps, the condominium, and the flood grid of 7 prices x 5 volumes against their twin weeks) and print its
// report. BOT NUMBERS (P-PROXY): bots on fixed policies in an assumed market, not players. The ordinary suite plays two floods.
import { spawnSync } from "node:child_process";

const vitest = process.platform === "win32" ? "npx.cmd" : "npx";
const run = spawnSync(vitest, ["vitest", "run", "tests/probes/tariff-probe.test.js", "--reporter=verbose"], {
  stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, TARIFF_PROBE: "1" }
});
process.exit(run.status ?? 1);
