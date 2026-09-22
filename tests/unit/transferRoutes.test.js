import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { jumpsBetween, transferFee, transitTime } from "../../server/transfers.js";

// AB#718: the fee and the transit time for every pair of stations come from two server functions, and match the table
// in DESIGN_DOCUMENT.md, which is what the Board reads. Both grow with distance and never shrink.

const root = path.resolve(import.meta.dirname, "..", "..");
const STATIONS = JSON.parse(fs.readFileSync(path.join(root, "data", "stations.json"), "utf8")).stations;
const idOf = (name) => STATIONS.find((s) => s.name === name)?.id;
const minutes = (text) => {
  const m = text.match(/^(?:(\d+) h)?\s*(?:(\d+) min)?$/);
  return Number(m?.[1] || 0) * 60 + Number(m?.[2] || 0);
};

/** The rows of the "Every pair of stations" table: [fromName, toName, jumps, feePerUnit, transitText]. */
function documentedPairs() {
  const doc = fs.readFileSync(path.join(root, "DESIGN_DOCUMENT.md"), "utf8").replace(/\r\n/g, "\n");
  const section = doc.slice(doc.indexOf("**Every pair of stations**"));
  return [...section.matchAll(/^\| ([^|]+) \| ([^|]+) \| (\d+) \| (\d+) \| ([^|]+) \|$/gm)].map((m) => [m[1].trim(), m[2].trim(), Number(m[3]), Number(m[4]), m[5].trim()]);
}

describe("fee and transit time between stations (AB#718)", () => {
  it("DESIGN_DOCUMENT.md lists every pair of stations once, and each row is what the server computes", () => {
    const rows = documentedPairs();
    expect(rows).toHaveLength((STATIONS.length * (STATIONS.length - 1)) / 2);
    const seen = new Set();
    for (const [fromName, toName, jumps, fee, transit] of rows) {
      const from = idOf(fromName);
      const to = idOf(toName);
      expect(from, fromName).toBeTruthy();
      expect(to, toName).toBeTruthy();
      seen.add([from, to].sort().join("|"));
      // Both directions cost and take the same.
      for (const [a, b] of [[from, to], [to, from]]) {
        expect(jumpsBetween(a, b), `${a} -> ${b}`).toBe(jumps);
        expect(transferFee(a, b, 1), `${a} -> ${b}`).toBe(fee);
        expect(transitTime(a, b), `${a} -> ${b}`).toBe(minutes(transit));
      }
    }
    expect(seen.size).toBe(rows.length);
  });

  it("neither the fee nor the time ever falls as the number of jumps rises", () => {
    const pairs = STATIONS.flatMap((a) => STATIONS.filter((b) => b.id !== a.id).map((b) => ({ jumps: jumpsBetween(a.id, b.id), fee: transferFee(a.id, b.id, 100), time: transitTime(a.id, b.id) })));
    const byJumps = [...new Set(pairs.map((p) => p.jumps))].sort((x, y) => x - y);
    expect(byJumps[0]).toBe(0);
    for (let i = 1; i < byJumps.length; i += 1) {
      const lower = pairs.filter((p) => p.jumps === byJumps[i - 1]);
      const higher = pairs.filter((p) => p.jumps === byJumps[i]);
      expect(Math.min(...higher.map((p) => p.fee))).toBeGreaterThan(Math.max(...lower.map((p) => p.fee)));
      expect(Math.min(...higher.map((p) => p.time))).toBeGreaterThan(Math.max(...lower.map((p) => p.time)));
    }
    // A fee scales with what is moved.
    expect(transferFee("kestrel-platform", "earth-station-prime", 100)).toBe(100 * transferFee("kestrel-platform", "earth-station-prime", 1));
  });

  it("a station the catalog does not know has no fee and no time", () => {
    for (const id of ["nowhere", "__proto__", "", null]) {
      expect(transferFee(id, "earth-station-prime", 1)).toBeNull();
      expect(transitTime("earth-station-prime", id)).toBeNull();
    }
  });
});
