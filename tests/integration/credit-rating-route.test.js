import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { financialSnapshotTick } from "../../server/ticks.js";

// ISP-148 (AB#842): GET /api/corporations/:corpId/credit-rating, the rating as another corporation sees it.
const DAY = 86_400_000;
let app, viewer, rated, fresh;

function seedStatements(accountId, n) {
  const today = Math.floor(Date.now() / DAY) * DAY;
  mutateAccountState(accountId, (s) => {
    s.statements = Array.from({ length: n }, (_, i) => ({
      day: new Date(today - (n - i) * DAY).toISOString().slice(0, 10), dayStart: today - (n - i) * DAY,
      pnl: { income: {}, expenses: {}, totalIncome: 30_000, totalExpenses: 26_500, net: 3_500 },
      cashFlow: { opening: 0, inflows: 30_000, outflows: 26_500, closing: 150_000, unrecorded: 0 },
      balanceSheet: { credits: 150_000, facilities: 180_000, inventory: 0, liabilities: 20_000, totalAssets: 330_000, netWorth: 310_000 }
    }));
    s.corp.finances.credits = 123_457;
  }, { sanitize: false, settleMining: false });
}
const corpOf = (r) => getAccountById(r.account.id).state.corp;
const get = (id, token) => { const q = request(app).get(`/api/corporations/${encodeURIComponent(id)}/credit-rating`); return token ? q.set("Authorization", `Bearer ${token}`) : q; };

beforeAll(async () => {
  ({ app } = await getApp());
  [viewer, rated, fresh] = [await registerAccount(app), await registerAccount(app), await registerAccount(app)];
  seedStatements(rated.account.id, 30);
  // Bug #4808: rated at a moment whose milliseconds end in 814, the exact score, so the check below that the score is
  // nowhere in the body meets a computedAt that carries those digits (a random 1% of runs did before, and failed)
  const t = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(t - (t % 1000) + 1814);
  try { financialSnapshotTick(); } finally { vi.useRealTimers(); } // the statements file is newer than any basis, so every corporation is rated now
});

describe("ISP-148 another corporation's rating, banded", () => {
  it("returns exactly the public fields: the grade, a score band and each input's band", async () => {
    const res = await get(corpOf(rated).publicId, viewer.accessToken);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["computedAt", "corpId", "corporationName", "grade", "inputs", "scoreBand"]);
    expect(res.body).toMatchObject({ corpId: corpOf(rated).publicId, grade: "AA", scoreBand: "800-849" });
    expect(Object.keys(res.body.inputs)).toEqual(["history", "cashCover", "margin", "solvency", "leverage", "turnover"]);
    for (const band of Object.values(res.body.inputs)) expect(["strong", "fair", "weak"]).toContain(band);
    // nothing private: not its credits, not its statements, not its account id, not the exact score. Bug #4808: the
    // three fields that carry digits of their own (a millisecond time, an id with one in it, the name) are held to what
    // they must be; every other value in the body is searched, and no value anywhere is the score.
    const { computedAt, corpId, corporationName, ...rest } = res.body;
    expect(String(computedAt)).toMatch(/814$/); // the moment pinned above: the case that failed at random
    expect([corpId, corporationName]).toEqual([corpOf(rated).publicId, corpOf(rated).corporationName]);
    const text = JSON.stringify(rest);
    for (const secret of ["123457", "150000", "310000", "statements", "finances", rated.account.id, "814"]) expect(text).not.toContain(secret);
    const values = (v) => (v && typeof v === "object" ? Object.values(v).flatMap(values) : [v]);
    expect(values(res.body).map(String)).not.toContain("814");
  });

  it("a corporation with too little history is NR, with no band", async () => {
    const res = await get(corpOf(fresh).publicId, viewer.accessToken);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ grade: "NR", scoreBand: null, inputs: null });
  });

  it("needs a login", async () => {
    expect((await get(corpOf(rated).publicId)).status).toBe(401);
  });

  it("an unknown or malformed id is one 404, the same body every time", async () => {
    const bodies = [];
    for (const id of ["corp-0-nope", "x", "../../accounts", "%00", "a".repeat(500), rated.account.id, " "]) {
      const res = await get(id, viewer.accessToken);
      expect(res.status, id).toBe(404);
      bodies.push(JSON.stringify(res.body));
    }
    expect(new Set(bodies).size).toBe(1);
  });
});
