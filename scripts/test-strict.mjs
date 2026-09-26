#!/usr/bin/env node
/**
 * `npm test` for ISP: the vitest suite, judged by what executed rather than by its exit code (AB#2144,
 * scripts/strict-pass.mjs). A file that never ran is a failure, and the last line says how many files and tests did.
 * Arguments pass through to vitest: `npm test -- tests/unit/foo.test.js`.
 */
import { strictPass } from "./strict-pass.mjs";

const result = await strictPass({ args: process.argv.slice(2) });
if (result.ok) {
  console.log(`\n[test-strict] every file ran and every test executed: ${result.summary} (${result.seconds} s)`);
  process.exit(0);
}
console.error(`\n[test-strict] FAILED: ${result.summary} (${result.seconds} s)`);
process.exit(1);
