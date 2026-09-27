import { describe, it, expect } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getState } from "../../server/gameState.js";

// Bug #1036: POST /api/combat/simulate needed no login and stored the attacker and defender names from the body,
// unbounded, in the global state that every client downloads. Nothing in the game called it; it is removed, and
// ISP-166 (AB#860) removed the global feed it wrote to.
describe("POST /api/combat/simulate is gone (Bug #1036, AB#860)", () => {
  const body = { attackerName: "x".repeat(10_240), defenderName: "<img src=x onerror=alert(1)>", attackerAttack: "abc" };

  it("answers 404 without a login, with a 10 KB name, and changes nothing in the global state", async () => {
    const { app } = await getApp();
    const before = JSON.stringify(getState());
    const res = await request(app).post("/api/combat/simulate").send(body);
    expect(res.status).toBe(404);
    expect(JSON.stringify(getState())).toBe(before);
    expect(getState()).not.toHaveProperty("combatReports");
  });

  it("answers 404 with a login too", async () => {
    const { app } = await getApp();
    const { accessToken } = await registerAccount(app);
    const res = await authed(app, accessToken).post("/api/combat/simulate").send(body);
    expect(res.status).toBe(404);
  });
});
