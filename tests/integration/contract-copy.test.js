import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { MISSION_TEMPLATES, FIRST_CONTRACT_ID, mutateAccountState, getAccountById, getStationInventory } from "../../server/gameState.js";
import { WALKTHROUGH_STEPS } from "../../public/scripts/walkthrough.js";
import { ASSIGNED_COORDINATOR } from "../../public/scripts/liaison.js";

// Bug #1104: contract copy promised a deadline no contract has (the Silicate Requisition Order said "within the
// deadline", Voss's greeting "each one has a deadline"), threatened a record of failures nothing keeps, and named the
// coordinator inside contract data. The copy may claim only what the server does, which the last tests below check.
const TIME_CLAIM = /\b(deadline|on schedule|on time|time limit|expires?|this month|within \d+|due by)\b/i;
// AB#1051: the agent's bio and dialogue moved from a literal in app.js to data/missions.json (GET
// /api/mission-agents is the client's only copy, same as MISSION_TEMPLATES above).
const MISSIONS_JSON = JSON.parse(readFileSync(new URL("../../data/missions.json", import.meta.url), "utf8"));
const agentCopy = () => MISSIONS_JSON.agents.map((a) => `${a.bio}\n${(a.dialogue || []).join("\n")}`).join("\n");

describe("contract copy promises nothing the game does not do (Bug #1104)", () => {
  it("no contract template carries or promises a time limit", () => {
    for (const t of MISSION_TEMPLATES) {
      expect(t.text, t.id).not.toMatch(TIME_CLAIM);
      for (const key of ["deadline", "expiresAt", "dueAt", "timeLimit", "durationHours"]) expect(t, t.id).not.toHaveProperty(key);
    }
  });

  it("no contract template names a character, so renaming the coordinator never leaves the contracts behind", () => {
    const names = [ASSIGNED_COORDINATOR.name, ...ASSIGNED_COORDINATOR.name.split(/\s+/)].filter((n) => n.length > 2);
    for (const t of MISSION_TEMPLATES) for (const n of names) expect(t.text, `${t.id} names ${n}`).not.toContain(n);
  });

  it("the walkthrough and the coordinator's own words make no time claim and no threat of a failure record", () => {
    for (const step of WALKTHROUGH_STEPS) expect(step.text, step.id).not.toMatch(TIME_CLAIM);
    expect(agentCopy()).not.toMatch(TIME_CLAIM);
    expect(agentCopy()).not.toMatch(/file an incomplete|second contracts/i);
  });

  // The claims the new copy does make, checked against the server.
  it("a contract completes whenever the quota is delivered, and completing one raises standing with its agent", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const api = authed(app, accessToken);
    const play = (path, body) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body);
    expect((await play("accept-mission", { missionId: FIRST_CONTRACT_ID })).status).toBe(200);
    // Bug #4873: a second acceptance says where the contract already is
    expect((await play("accept-mission", { missionId: FIRST_CONTRACT_ID })).body.error).toBe("You have already accepted that contract: it is in Active Contracts on Assignments.");
    const accepted = getAccountById(account.id).state.corp.activeMissions.find((m) => m.id === FIRST_CONTRACT_ID);
    for (const key of ["deadline", "expiresAt", "dueAt", "acceptedUntil"]) expect(accepted).not.toHaveProperty(key);
    // Time passing is not something the route can see: completion is checked against the quota alone.
    // AB#1051: the quota is rolled per offer now, not a fixed 400 — read what was actually accepted.
    mutateAccountState(account.id, (s) => { getStationInventory(s.corp, s.corp.currentStationId)[accepted.quota.resource] = accepted.quota.amount; });
    const done = await play("complete-mission", { missionId: FIRST_CONTRACT_ID });
    expect(done.status).toBe(200);
    expect(getAccountById(account.id).state.corp.agentReputation[ASSIGNED_COORDINATOR.id].completedCount).toBe(1);
  });

  it("walking away from a contract costs nothing and is not recorded", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const api = authed(app, accessToken);
    const play = (path, body) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body);
    expect((await play("accept-mission", { missionId: FIRST_CONTRACT_ID })).status).toBe(200);
    const before = getAccountById(account.id).state.corp;
    const credits = before.finances.credits;
    expect((await play("abandon-mission", { missionId: FIRST_CONTRACT_ID })).status).toBe(200);
    const after = getAccountById(account.id).state.corp;
    expect(after.finances.credits).toBe(credits);
    expect(after.activeMissions.map((m) => m.id)).not.toContain(FIRST_CONTRACT_ID);
    expect(after.agentReputation?.[ASSIGNED_COORDINATOR.id]?.completedCount || 0).toBe(0);
    expect(JSON.stringify(after.completedMissions || [])).not.toContain(FIRST_CONTRACT_ID);
  });
});
