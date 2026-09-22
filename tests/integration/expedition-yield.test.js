import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitExactly } from "../../server/gameState.js";

// Bug #1274: every production expedition came home empty. A 10-second tick of a Short Sweep is worth 0.5 units, and
// each tick's yield was floored on its own. The yield now carries its fraction, and each tick's drops add up to exactly
// its whole units, so a sweep yields the same whether it is settled every 10 seconds (the ticker) or once.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Run the sweep in a process with production durations (the test process has test durations). */
function productionSweep(duration, stepMs, beltKey = "sol:belt") {
  const r = spawnSync(process.execPath, ["tests/fixtures/expedition-sweep.mjs", duration, String(stepMs), beltKey], {
    cwd: repo,
    env: { ...process.env, NODE_ENV: "production" },
    encoding: "utf8",
    timeout: 30000
  });
  const line = r.stdout.split(/\r?\n/).filter((l) => l.startsWith("{")).at(-1);
  if (!line) throw new Error(`no result: ${r.stderr}`);
  return JSON.parse(line);
}

describe("an expedition yields the same however it is ticked (Bug #1274)", () => {
  it("a 30-minute Short Sweep in production: 90 units in 10-second steps and in one step", () => {
    const r = productionSweep("short", 10_000);
    expect(r.ms).toBe(30 * 60 * 1000);
    expect(r.stepped.total).toBe(90);
    expect(r.oneStep.total).toBe(90);
    expect(r.stepped.completed).toBe(true);
    expect(r.stepped.stationTotal).toBe(90); // deposited at the station
  });

  it("the standard and extended durations and a rarer system agree too", () => {
    for (const [duration, beltKey, total] of [["standard", "sol:belt", 180], ["extended", "sol:belt", 360], ["short", "alpha-centauri:ac-belt", 103]]) {
      const r = productionSweep(duration, 10_000, beltKey);
      expect(r.stepped.total, `${duration} ${beltKey}`).toBe(total);
      expect(r.oneStep.total, `${duration} ${beltKey}`).toBe(total);
    }
  }, 60_000);

  it("splits a tick's units exactly, never inventing or losing one", () => {
    for (const whole of [1, 2, 3, 7, 50, 91]) {
      for (const weights of [[1], [0.6, 1.4], [0.6, 1.0, 1.4], [1.39, 0.61, 0.9]]) {
        if (weights.length > whole) continue;
        const shares = splitExactly(whole, weights);
        expect(shares.reduce((a, b) => a + b, 0), `${whole} over ${weights}`).toBe(whole);
        expect(shares.every((n) => n >= 0)).toBe(true);
      }
    }
  });
});
