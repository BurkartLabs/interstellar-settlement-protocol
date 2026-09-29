import { describe, it, expect, beforeAll, vi } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, RESEARCH_LIBRARY } from "../../server/gameState.js";
import { refusalMeaning } from "../../public/scripts/protocol.js";
import { fabricationTick } from "../../server/ticks.js";

// ISP-254 (AB#950): the Industry group's protocol line, through the running server. A queue refused for want of
// credits reads as Unfunded (the server's own message, not one this test wrote), and a queued research's notification
// carries its protocol to the client, so the page can draw "Lodged // CORP-RND-1" beside "R&D Queued".
const queueable = Object.values(RESEARCH_LIBRARY).find((t) => t.tier === 1 && !(t.prereqs || []).length && !(t.requiresCorpLevel > 0) && t.costCredits > 0);
let api, accountId;
const seed = (fn) => mutateAccountState(accountId, fn, { sanitize: false, settleMining: false });

beforeAll(async () => {
  const { app } = await getApp();
  const me = await registerAccount(app);
  accountId = me.account.id;
  api = authed(app, me.accessToken);
});

describe("the Industry group's protocol line, from the server (ISP-254, AB#950)", () => {
  it("a research the corporation cannot fund is refused with a message that reads as Unfunded", async () => {
    seed((s) => { s.corp.finances.credits = 0; });
    const res = await api.post(`/api/accounts/${accountId}/gameplay/queue-rnd`).send({ techId: queueable.id });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(refusalMeaning(res.body.error), res.body.error).toBe("unfunded");
    expect(res.body.error).toMatch(/Sell goods or finish an assignment to raise the credits, then queue it again\.$/); // Bug #4807
  });

  it("a queued research's notification carries Queued on the R&D screen, beside its plain title", async () => {
    seed((s) => { s.corp.finances.credits = 5_000_000; });
    const queued = await api.post(`/api/accounts/${accountId}/gameplay/queue-rnd`).send({ techId: queueable.id });
    expect(queued.status).toBe(200);
    const list = await api.get(`/api/accounts/${accountId}/notifications`);
    const note = list.body.notifications.find((n) => n.title === "R&D Queued");
    expect(note).toMatchObject({ title: "R&D Queued", body: `${queueable.name} has been queued in corporate research.`, protocol: { meaning: "queued", screen: "rnd" } });
  });
});

// ISP-254 slice Ba (AB#4810): the Fleet tab. Its refusals say what to do next, and the two notifications of finished
// production carry Concluded on the Fleet screen.
describe("the Fleet's protocol line and next steps, from the server (ISP-254, AB#4810)", () => {
  const EARTH = "earth-station-prime";
  const fleetPost = (path, body) => api.post(`/api/accounts/${accountId}/gameplay${path}`).send(body);

  it("a fleet order for more than the reserve holds says how many it can take", async () => {
    seed((s) => {
      s.corp.currentStationId = EARTH;
      s.corp.military = { ...(s.corp.military || {}), units: { lf: 3, ds: 0, se: 0, at: 0, dt: 0 }, fleets: [] };
    });
    const res = await fleetPost("/fleets/form", { lf: 5, name: "Aegis" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Your reserve holds 3 Light Fighters; the rest are in fleets. Form it with 3 or fewer.");
    expect(refusalMeaning(res.body.error)).toBe("refused");
  });

  it("finished ships and troops notify with Concluded on the Fleet screen, beside their plain words", async () => {
    seed((s) => {
      s.corp.level = 10;
      s.corp.currentStationId = EARTH;
      s.corp.unlockedTech = ["tt-fleet-coordination", "tt-capital-hulls"];
      if (!s.corp.buildings.some((b) => b.name === "Orbital Shipyard")) s.corp.buildings.push({ name: "Orbital Shipyard", tier: 1, status: "Operational" });
      s.corp.finances.credits = 5_000_000;
      s.corp.inventory = { [EARTH]: { "Carbon Fibre Sheets": 1000, "Structural Alloys": 300 } };
    });
    expect((await fleetPost("/shipyard/queue", { unitId: "lf", quantity: 1 })).status).toBe(200);
    expect((await fleetPost("/training/queue", { unitId: "dt", quantity: 1 })).status).toBe(200);
    const later = Date.now() + 30 * 86_400_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    try { fabricationTick(); } finally { vi.restoreAllMocks(); }
    const list = await api.get(`/api/accounts/${accountId}/notifications`);
    const ships = list.body.notifications.find((n) => n.title === "Ships Delivered");
    const troops = list.body.notifications.find((n) => n.title === "Troops Trained");
    expect(ships).toMatchObject({ body: "1 Light Fighter left the Orbital Shipyard and joined your fleet.", protocol: { meaning: "complete", screen: "fleet" } });
    expect(troops?.protocol).toEqual({ meaning: "complete", screen: "fleet" });
    // and when they were queued: Lodged
    expect(list.body.notifications.find((n) => n.title === "Ship Production Queued")?.protocol).toEqual({ meaning: "queued", screen: "fleet" });
    expect(list.body.notifications.find((n) => n.title === "Troop Training Started")?.protocol).toEqual({ meaning: "queued", screen: "fleet" });
  });
});
