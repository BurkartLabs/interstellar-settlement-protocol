import { describe, it, expect, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { recordControlDay, resetControlHistory } from "../../server/controlService.js";
import { dominanceTick, resetDominanceCache } from "../../server/dominanceService.js";

// ISP-226 (AB#921): GET /api/systems/:id/control serves a system's control scores and concession eligibility: public and
// aggregate (names, rounded scores, eligibility), a 404 for a system outside the registry, and eligibility false when the
// daily readings are stale.
const DAY = 86_400_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });
afterEach(() => resetControlHistory());

const group = (type, id, name, extraction) => ({ type, id, name, parts: { leases: 0, extraction, sales: 0 } });
/** A day's dominance result with the same holders in Alpha Centauri and Sol. */
const result = (computedAt) => {
  const entry = { live: ["extraction"], groups: [group("corp", "corp-a", "Aster Mining", 0.6), group("corp", "corp-b", "Brand Holdings", 0.25), group("conglomerate", "cgl-1", "Cinder Pact", 0.15)] };
  return { computedAt, holders: { "alpha-centauri": entry, sol: entry } };
};
const days = (n, newestAt) => { for (let i = n - 1; i >= 0; i -= 1) recordControlDay(result(newestAt - i * DAY)); };

describe("GET /api/systems/:id/control (AB#921)", () => {
  it("names the holders with rounded scores, and the leader is eligible after 14 daily readings", async () => {
    days(14, Date.now() - 3_600_000);
    const res = await request(app).get("/api/systems/alpha-centauri/control");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ systemId: "alpha-centauri", concedable: true, stale: false, others: 0 });
    expect(res.body.holders).toEqual([
      { name: "Aster Mining", type: "corp", score: 60, eligible: true },
      { name: "Brand Holdings", type: "corp", score: 25, eligible: false },
      { name: "Cinder Pact", type: "conglomerate", score: 15, eligible: false }
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/corp-a|cgl-1|acc-/); // no ids of any kind
  });

  it("is not eligible after 13 readings, and never in a system that cannot be conceded", async () => {
    days(13, Date.now() - 3_600_000);
    expect((await request(app).get("/api/systems/alpha-centauri/control")).body.holders[0].eligible).toBe(false);
    days(30, Date.now() - 3_600_000);
    const sol = await request(app).get("/api/systems/sol/control");
    expect(sol.body).toMatchObject({ concedable: false });
    expect(sol.body.holders.every((h) => h.eligible === false)).toBe(true);
    expect(sol.body.rule).toMatch(/first lease in Sol/);
  });

  it("reads eligibility false when the newest reading is older than the stated age (fails closed)", async () => {
    days(14, Date.now() - 30 * 3_600_000);
    const res = await request(app).get("/api/systems/alpha-centauri/control");
    expect(res.body.stale).toBe(true);
    expect(res.body.holders[0].eligible).toBe(false);
  });

  it("takes each day's reading from the daily dominance computation", async () => {
    resetDominanceCache();
    expect(dominanceTick(Date.now(), () => ({ ...result(Date.now()), systems: {}, private: {} }))).toBe("computed");
    const res = await request(app).get("/api/systems/alpha-centauri/control");
    expect(res.body.holders[0]).toMatchObject({ name: "Aster Mining", score: 60, eligible: false }); // one day, not fourteen
    resetDominanceCache();
  });

  it("answers 404 for a system outside the registry, hostile or not", async () => {
    for (const id of ["atlantis", "..%2Fsol", "sol%00", "a".repeat(300)]) {
      expect((await request(app).get(`/api/systems/${id}/control`)).status, id).toBe(404);
    }
  });
});
