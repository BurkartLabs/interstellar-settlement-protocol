import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { MISSION_TEMPLATES, FIRST_CONTRACT_ID, mutateAccountState, getAccountById, getStationInventory } from "../../server/gameState.js";

// Bug #1268: accept-mission fell back to the whole template pool, so any contract could be accepted whether offered
// or not, all ten at once, and a contract taken again the moment it was completed. Only offered contracts are accepted now.
async function corp() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const api = authed(app, accessToken);
  const accept = (missionId) => api.post(`/api/accounts/${account.id}/gameplay/accept-mission`).send({ missionId });
  const complete = (missionId) => api.post(`/api/accounts/${account.id}/gameplay/complete-mission`).send({ missionId });
  const state = () => getAccountById(account.id).state.corp;
  const offered = () => (state().contractOfferings?.missions || []).map((m) => m.id);
  // The offerings are drawn on first use: read them the way the page does, by accepting nothing yet.
  mutateAccountState(account.id, () => {});
  return { id: account.id, accept, complete, state, offered };
}

describe("accept-mission accepts only a contract on offer (Bug #1268)", () => {
  it("accepts an offered contract and takes it off the offers", async () => {
    const c = await corp();
    expect((await c.accept(FIRST_CONTRACT_ID)).status).toBe(200);
    expect(c.state().activeMissions.map((m) => m.id)).toEqual([FIRST_CONTRACT_ID]);
    expect(c.offered()).not.toContain(FIRST_CONTRACT_ID);
  });

  it("refuses a real contract that is not offered, says what to do, and changes nothing", async () => {
    const c = await corp();
    await c.accept(FIRST_CONTRACT_ID); // draws the offerings
    const notOffered = MISSION_TEMPLATES.map((t) => t.id).find((id) => !c.offered().includes(id) && id !== FIRST_CONTRACT_ID);
    const before = JSON.stringify(c.state().activeMissions);
    const res = await c.accept(notOffered);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not on offer to you/);
    expect(res.body.error).toMatch(/Assignments/);
    expect(res.body.error).toMatch(/New contracts are offered in about \d+ hours?\./);
    expect(JSON.stringify(c.state().activeMissions)).toBe(before);
  });

  it("cannot take all ten: at most the two on offer", async () => {
    const c = await corp();
    await c.accept(FIRST_CONTRACT_ID);
    const statuses = [];
    for (const t of MISSION_TEMPLATES) statuses.push((await c.accept(t.id)).status);
    expect(c.state().activeMissions.length).toBeLessThanOrEqual(2);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(1); // the first was already taken above
  });

  it("refuses a contract completed a moment ago, naming the 4-hour wait", async () => {
    const c = await corp();
    expect((await c.accept(FIRST_CONTRACT_ID)).status).toBe(200);
    // AB#1051: the quota is rolled per offer now, not a fixed 400 — read what was actually accepted.
    const quota = c.state().activeMissions.find((m) => m.id === FIRST_CONTRACT_ID).quota;
    mutateAccountState(c.id, (s) => { getStationInventory(s.corp, s.corp.currentStationId)[quota.resource] = quota.amount; });
    expect((await c.complete(FIRST_CONTRACT_ID)).status).toBe(200);
    const res = await c.accept(FIRST_CONTRACT_ID);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/completed that contract recently/);
    expect(res.body.error).toMatch(/4 hours/);
    expect(c.state().activeMissions).toEqual([]);
  });

  it("still refuses an unknown id as before", async () => {
    const c = await corp();
    const res = await c.accept("ms-nope");
    expect(res.status).toBe(400);
  });
});
