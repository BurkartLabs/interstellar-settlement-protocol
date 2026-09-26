import { describe, it, expect } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getState, mutateAccountState } from "../../server/gameState.js";
import { SYSTEMS_DATA } from "../../server/game/catalog.js";

// Bug #2355, and AB#837's acceptance: what is in a belt is revealed by scouting it, so the server sends a player only
// the belts that player has scouted. Before, GET /api/bootstrap sent every belt's live state (the global `belts`,
// AB#2329) and the catalog's belt contents, and GET /api/systems the catalog's, to anyone, signed in or not. Two
// accounts: A scouts Sol's belt; B, and a caller with no token, learn nothing of what is in it, anywhere.
const BELT = "sol:belt";
/** Every place a belt's contents could hide in a response: its composition, its profile, the global belt state. */
function beltSecrets(body) {
  const found = [];
  if (body?.belts) found.push("belts");
  const systems = [...(body?.world?.systems || []), ...(body?.systems || [])];
  for (const s of systems) for (const b of s.bodies || []) {
    if (b.type === "Field" && (b.composition || b.resourceProfile)) found.push(`${s.id}:${b.id}`);
  }
  return found;
}

async function scout() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => {
    s.corp.unlockedTech = [...(s.corp.unlockedTech || []), "tt-asteroid-prospecting"];
    s.corp.currentSystemId = "sol";
  });
  const api = authed(app, accessToken);
  return { app, id: account.id, api, token: accessToken };
}

describe("a belt's contents go only to a player who scouted it (Bug #2355, AB#837)", () => {
  it("A scouted Sol's belt: A reads it from belt-compositions; B and a stranger read it nowhere", async () => {
    const a = await scout();
    const b = await scout();
    expect((await a.api.post(`/api/accounts/${a.id}/gameplay/scout-belt`).send({ beltKey: BELT })).status).toBe(200);
    const live = getState().belts[BELT];
    expect(live.composition).toBeTruthy();

    // A: through its own route, this generation's composition, rarity and reserve.
    const mine = (await a.api.get(`/api/accounts/${a.id}/gameplay/belt-compositions`)).body;
    expect(mine.belts[BELT]).toMatchObject({ scouted: true, composition: live.composition, rarity: live.rarity, remaining: live.remaining });

    // B: its own route says the belt is there, and nothing of what is in it.
    const theirs = (await b.api.get(`/api/accounts/${b.id}/gameplay/belt-compositions`)).body;
    expect(theirs.belts[BELT]).toEqual({ key: BELT, generation: live.generation, present: true, scouted: false, nextDrawAt: null });
    expect(theirs.compositions).toEqual({});
    // And B cannot read A's.
    expect((await b.api.get(`/api/accounts/${a.id}/gameplay/belt-compositions`)).status).toBe(403);

    // The shared routes, signed in as either or as no one, carry no belt's contents at all.
    for (const [who, get] of [
      ["no token", (path) => request(a.app).get(path)],
      ["B", (path) => b.api.get(path)],
      ["A", (path) => a.api.get(path)]
    ]) {
      for (const path of ["/api/bootstrap", "/api/systems"]) {
        const res = await get(path);
        expect(res.status, `${who} ${path}`).toBe(200);
        expect(beltSecrets(res.body), `${who} ${path}`).toEqual([]);
        // The map still has every belt to draw.
        const systems = res.body.systems || res.body.world.systems;
        expect(systems.find((s) => s.id === "sol").bodies.find((x) => x.type === "Field")).toMatchObject({ id: "belt", name: "Asteroid Belt", type: "Field" });
      }
    }
  });

  it("a planet's or moon's profile stays public: it is what a lease yields, shown before one is bought (AB#829)", async () => {
    const { app } = await getApp();
    const sol = (await request(app).get("/api/systems")).body.systems.find((s) => s.id === "sol");
    const catalogLuna = SYSTEMS_DATA.find((s) => s.id === "sol").bodies.find((x) => x.id === "luna");
    expect(sol.bodies.find((x) => x.id === "luna").resourceProfile).toEqual(catalogLuna.resourceProfile);
    expect(catalogLuna.resourceProfile.find((p) => p.item === "Helium-3").concentration).toBe(0.25); // AB#830
  });
});
