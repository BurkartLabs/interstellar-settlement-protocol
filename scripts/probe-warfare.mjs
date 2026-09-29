#!/usr/bin/env node
// ISP-271 (AB#967): run the warfare economy probe in full (tests/probes/warfare-probe.test.js: the faction world for 60
// days, the same world at ten times the trade, and the lever sweeps) and print its report. `--out <dir>` also writes the
// report and the raw numbers there. BOT NUMBERS (P-PROXY). About a minute.
import { spawnSync } from "node:child_process";

const i = process.argv.indexOf("--out");
const out = i >= 0 ? process.argv[i + 1] : "";
const vitest = process.platform === "win32" ? "npx.cmd" : "npx";
const run = spawnSync(vitest, ["vitest", "run", "tests/probes/warfare-probe.test.js", "--reporter=verbose"], {
  stdio: "inherit", shell: process.platform === "win32",
  env: { ...process.env, WARFARE_PROBE: "1", ...(out ? { WARFARE_OUT: out } : {}) }
});
process.exit(run.status ?? 1);
