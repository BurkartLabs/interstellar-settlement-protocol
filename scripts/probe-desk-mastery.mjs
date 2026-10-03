#!/usr/bin/env node
// AB#4689 slice 10: the desk-mastery probe's full table (tests/probes/desk-probes.test.js), exit 1 when its targets miss.
// BOT NUMBERS (P-PROXY): bots working generated Desk packets, not players. docs/design/desk-work.md section 8.
import { spawnSync } from "node:child_process";

console.log("ISP desk-mastery probe (AB#4689). BOT NUMBERS (P-PROXY): a random bot and a rules-aware bot each work the Desk for 50 simulated hours per tier; their standing an hour and the ratio. Not players.");
const vitest = process.platform === "win32" ? "npx.cmd" : "npx";
const run = spawnSync(vitest, ["vitest", "run", "tests/probes/desk-probes.test.js", "-t", "desk-mastery", "--reporter=verbose"], {
  stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, DESK_PROBE: "mastery" }
});
process.exit(run.status ?? 1);
