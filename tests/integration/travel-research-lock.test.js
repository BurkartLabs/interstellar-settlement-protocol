import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// Bug #1270: the travel route refused a locked jump with 'You lack the required navigation research', naming no
// research. It now refuses with the Starmap's own lock text, built from the server's research library.
const TIER_1 = JSON.parse(readFileSync(new URL("../../data/research.json", import.meta.url), "utf8")).nodes
  .filter((t) => t.tier === 1).map((t) => t.id);

async function corp(setup) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  if (setup) mutateAccountState(account.id, (state) => setup(state.corp));
  const api = authed(app, accessToken);
  return {
    travel: (toSystemId) => api.post(`/api/accounts/${account.id}/gameplay/travel`).send({ toSystemId }),
    state: () => getAccountById(account.id).state.corp
  };
}

describe("a refused jump names the research (Bug #1270)", () => {
  it("Alpha Centauri from a new corporation: 400 naming Near-Star Navigation Array and what comes before it", async () => {
    const c = await corp();
    const res = await c.travel("alpha-centauri");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Requires Near-Star Navigation Array \(Corporate R&D, Tier 2, corporation level 5\)\./);
    expect(res.body.error).toMatch(/Fleet Coordination Matrix/);
    expect(c.state().travel).toBeFalsy();
  });

  it("Wolf 359 from a new corporation: 400 naming Deep-Star Cartography Suite", async () => {
    const c = await corp();
    const res = await c.travel("wolf-359");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Requires Deep-Star Cartography Suite \(Corporate R&D, Tier 3, corporation level 10\)\./);
    expect(res.body.error).toMatch(/Before you can research it: Near-Star Navigation Array/);
  });

  it("with Near-Star Navigation Array the jump to Alpha Centauri is allowed", async () => {
    const c = await corp((corp) => { corp.unlockedTech = ["tt-proxima-navigation"]; corp.level = 5; });
    const res = await c.travel("alpha-centauri");
    expect(res.status).toBe(200);
    expect(c.state().travel?.toSystemId || c.state().travel?.destinationSystemId || c.state().travel).toBeTruthy();
  });

  it("the Tier 1 research and level held but the prerequisite missing: it names only the prerequisite", async () => {
    const c = await corp((corp) => { corp.unlockedTech = [...TIER_1]; corp.level = 5; });
    const res = await c.travel("alpha-centauri");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Requires Near-Star Navigation Array (Corporate R&D, Tier 2, corporation level 5). Before you can research it: Fleet Coordination Matrix."
    );
  });
});
