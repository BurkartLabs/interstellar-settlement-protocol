import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archiveDirectInvestments } from "../../server/legacyInvestments.js";

// ISP-158 (AB#852): the vestigial corp.investments (Bug #689's removed route) is written to legacy-investments.json for
// the PM and cleared. Nothing is refunded; nothing the player typed is kept.
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "legacy-inv-")), "legacy-investments.json");
const accounts = () => ({
  "acc-1": { id: "acc-1", state: { corp: { corporationName: "Early Co", investments: [{ id: "inv-1", targetCorp: "<img onerror=x>", amount: 50_000, instrument: "equity", createdAt: 111 }, { amount: 2_500, createdAt: 222 }] } } },
  "acc-2": { id: "acc-2", state: { corp: { corporationName: "Empty Co", investments: [] } } },
  "acc-3": { id: "acc-3", state: { corp: { corporationName: "New Co" } } }
});

describe("archiveDirectInvestments (AB#852)", () => {
  it("writes each record as account, corporation, amount and time, then clears corp.investments", () => {
    const file = tmpFile();
    const a = accounts();
    expect(archiveDirectInvestments(a, file)).toEqual({ archived: 2, total: 52_500, cleared: 2 });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual([
      { accountId: "acc-1", corporationName: "Early Co", amount: 50_000, createdAt: 111 },
      { accountId: "acc-1", corporationName: "Early Co", amount: 2_500, createdAt: 222 }
    ]);
    expect(fs.readFileSync(file, "utf8")).not.toContain("onerror");
    for (const acc of Object.values(a)) expect(acc.state.corp).not.toHaveProperty("investments");
  });

  it("run again, or on a save that was already cleared, adds nothing and keeps the file", () => {
    const file = tmpFile();
    archiveDirectInvestments(accounts(), file);
    const kept = fs.readFileSync(file, "utf8");
    expect(archiveDirectInvestments(accounts(), file)).toMatchObject({ archived: 0, total: 0 }); // the same records again
    expect(fs.readFileSync(file, "utf8")).toBe(kept);
    const cleared = { x: { id: "x", state: { corp: {} } } };
    expect(archiveDirectInvestments(cleared, tmpFile())).toEqual({ archived: 0, total: 0, cleared: 0 });
  });

  it("a clean install writes no file", () => {
    const file = tmpFile();
    archiveDirectInvestments({ n: { id: "n", state: { corp: { investments: [] } } } }, file);
    expect(fs.existsSync(file)).toBe(false);
  });
});
