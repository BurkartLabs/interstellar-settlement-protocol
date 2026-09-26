import request from "supertest";
import fs from "node:fs";
import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState } from "../../server/gameState.js";

// ISP-112 (AB#804): the page reads every per-system fact from GET /api/systems. It is data/systems.json as it is on
// disk: served to anyone, the same to everyone, holding no player's data, and unchanged by anything a player does.
const ON_DISK = JSON.parse(fs.readFileSync(new URL("../../data/systems.json", import.meta.url), "utf8"));
const PLAYER_FIELDS = /"(corp|accountId|email|credits|finances|inventory|unlockedTech|miningLeases|scoutedBelts|passwordHash|ownerAccountId)"/;

describe("GET /api/systems (ISP-112)", () => {
  it("serves the catalog on disk, with no login, and no player's field in it", async () => {
    const { app } = await getApp();
    const res = await request(app).get("/api/systems");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ systems: ON_DISK });
    expect(JSON.stringify(res.body)).not.toMatch(PLAYER_FIELDS);
  });

  it("answers the same after a player scouts, travels its research open and changes its own state", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    mutateAccountState(account.id, (state) => {
      state.corp.unlockedTech = ["tt-proxima-navigation", "tt-deep-star-navigation", "tt-asteroid-prospecting"];
      state.corp.asteroidMining = { ...(state.corp.asteroidMining || {}), scoutedBelts: ["sol:belt"] };
    });
    const scout = await authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/scout-belt`).send({ beltKey: "sol:belt" });
    expect(scout.status).toBe(200);
    const travel = await authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/travel`).send({ toSystemId: "alpha-centauri" });
    expect(travel.status).toBe(200);
    const res = await request(app).get("/api/systems");
    expect(res.body).toEqual({ systems: ON_DISK });
  });
});
