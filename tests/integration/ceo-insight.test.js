import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, listAccountNotifications } from "../../server/gameState.js";

// Bug #983: a planned CEO Insight program took the player's credits and did nothing. It is now refused before any
// charge, the client gets the catalogue (with status) from the server, and the live renewal discount is charged.
async function corp(setup = () => {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.finances.credits = 500000;
    state.corp.completedInsights = [];
    state.queues.ceoInsight = [];
    state.corp.offices = [{ stationId: "earth-station-prime", leasedAt: Date.now(), rentedUntil: Date.now() }];
    setup(state);
  });
  const api = authed(app, accessToken);
  const state = () => getAccountById(account.id).state;
  return { id: account.id, app, api, state };
}

describe("CEO Insight programs (Bug #983)", () => {
  it("refuses a planned program with 400, charges nothing and queues nothing", async () => {
    const { id, api, state } = await corp();
    const res = await api.post(`/api/accounts/${id}/gameplay/queue-ceo`).send({ programId: "ceo-employee-motivation" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not available yet/i);
    expect(state().corp.finances.credits).toBe(500000);
    expect(state().queues.ceoInsight).toEqual([]);
  });

  it("still enrolls in a live program and charges its price", async () => {
    const { id, api, state } = await corp();
    const res = await api.post(`/api/accounts/${id}/gameplay/queue-ceo`).send({ programId: "ceo-isa-regulatory-navigation" });
    expect(res.status).toBe(200);
    expect(state().corp.finances.credits).toBe(500000 - 15000);
    expect(state().queues.ceoInsight.map((q) => q.programId)).toEqual(["ceo-isa-regulatory-navigation"]);
    // ISP-254 C2 (AB#4812): the enrollment's notice is Lodged on the CEO Insight screen
    const told = listAccountNotifications(id).notifications.find((n) => n.title === "CEO Insight Queued");
    expect(told.protocol).toEqual({ meaning: "queued", screen: "ceo" });
    // Bug #4873: a second enrollment while one runs says to wait for it
    const second = await api.post(`/api/accounts/${id}/gameplay/queue-ceo`).send({ programId: "ceo-risk-assessment" });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("Only one CEO Insight program can be in progress at a time. Wait for it to finish, then enroll this one.");
  });

  it("enrolls in Risk Assessment with no planned program completed", async () => {
    const { id, api } = await corp();
    const res = await api.post(`/api/accounts/${id}/gameplay/queue-ceo`).send({ programId: "ceo-risk-assessment" });
    expect(res.status).toBe(200);
  });

  it("serves the catalogue with every program's status", async () => {
    const { app } = await corp();
    const { default: request } = await import("supertest");
    const res = await request(app).get("/api/ceo-insight");
    expect(res.status).toBe(200);
    expect(res.body.programs).toHaveLength(12);
    expect(new Set(res.body.programs.map((p) => p.status))).toEqual(new Set(["live", "planned"]));
  });
});

describe("POST /gameplay/renew-office with ISA Regulatory Navigation (Bug #983)", () => {
  const renew = (api, id) => api.post(`/api/accounts/${id}/gameplay/renew-office`).send({ stationId: "earth-station-prime", durationDays: 7 });

  it("charges the full 7,000 without the program", async () => {
    const { id, api, state } = await corp();
    expect((await renew(api, id)).status).toBe(200);
    expect(state().corp.finances.credits).toBe(500000 - 7000);
  });

  it("charges 6,650 with it", async () => {
    const { id, api, state } = await corp((s) => { s.corp.completedInsights = ["ceo-isa-regulatory-navigation"]; });
    expect((await renew(api, id)).status).toBe(200);
    expect(state().corp.finances.credits).toBe(500000 - 6650);
  });
});
