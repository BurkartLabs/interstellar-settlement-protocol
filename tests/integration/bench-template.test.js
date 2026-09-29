import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Bug #4813: bench:ticks (and load:test, AB#962) build their template corporation through the real routes. Since
// AB#2288 registration gives no session, and the template step failed on its first line with nothing in the suite to
// notice. This runs the step itself, in its own process as the benchmark does, and checks it leaves a saved account.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("bench-ticks template corporation (Bug #4813)", () => {
  it("registers, verifies, logs in and saves a playing corporation", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-bench-template-"));
    try {
      const res = spawnSync(process.execPath, ["scripts/bench-ticks.mjs", "template"], {
        cwd: ROOT, encoding: "utf8", timeout: 90_000,
        env: { ...process.env, ISP_DATA_DIR: dir, ISP_DISABLE_TICKERS: "1", PORT: "0", NODE_ENV: "test", JWT_SECRET: "bench-template-test-secret-0123456789abcdef", ISP_DEV: "1" }
      });
      const line = (res.stdout || "").trim().split("\n").reverse().find((l) => l.startsWith("{"));
      expect(res.status, res.stderr?.slice(-1500)).toBe(0);
      const { id } = JSON.parse(line);
      const saved = JSON.parse(fs.readFileSync(path.join(dir, "accounts-snapshot.json"), "utf8"));
      const account = (saved.accounts || saved)[id];
      expect(account.emailVerifiedAt).toBeTruthy();
      expect(account.state.corp.miningLeases.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
