#!/usr/bin/env node
// test-gate.mjs: the full check, once per Feature PR, before merge (AB#4889, decision 5). Runs the named npm scripts in
// order, stops at the first that fails, and ends with one line per step and its time, so the gate's cost is known.
//
// Canonical copy: hq ops/test/test-gate.mjs. Product repos carry a byte-identical copy at scripts/test-gate.mjs
// (`node ops/test/install.mjs <repo>`). A repo's package.json names its steps:
//
//   "test:gate": "node scripts/test-gate.mjs typecheck test"

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/** One line per step: "typecheck 21 s ok". */
export function summarize(results) {
  return results.map((r) => `${r.step} ${r.seconds} s ${r.ok ? "ok" : "FAILED"}`).join("; ");
}

function runScript(step) {
  // npm_execpath is npm's own CLI when this runs under npm; spawning it through node needs no shell on any platform.
  const npm = process.env.npm_execpath;
  const [cmd, args, shell] = npm ? [process.execPath, [npm, "run", step], false] : ["npm", ["run", step], process.platform === "win32"];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main(steps) {
  if (!steps.length) {
    console.error("[test-gate] name the npm scripts to run, in order: node scripts/test-gate.mjs typecheck test");
    return 1;
  }
  const started = Date.now();
  const results = [];
  for (const step of steps) {
    const t = Date.now();
    const code = await runScript(step);
    results.push({ step, ok: code === 0, seconds: Math.round((Date.now() - t) / 1000) });
    if (code !== 0) break;
  }
  const ok = results.length === steps.length && results.every((r) => r.ok);
  console.log(`\n[test-gate] ${ok ? "passed" : "FAILED"} in ${Math.round((Date.now() - started) / 1000)} s: ${summarize(results)}`);
  return ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
