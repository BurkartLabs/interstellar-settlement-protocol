import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { CEO_INSIGHT_LIBRARY, getState, mutateAccountState, RESEARCH_LIBRARY } from "../../server/gameState.js";
import { isInsightProgramLive } from "../../public/scripts/ceoEffects.js";

// AB#744 (ISP-58): every remaining committing action answers with a receipt built from what the server did, the way
// AB#743's six core-loop actions do. One corporation, given what each action needs (credits, research, inventory, an
// Assembly Facility), takes every action once; each answer's receipt is checked against the state the same answer
// carries, so a figure the modal shows is one the server used, not one it recomputed.

let api;
let accountId;
const res = {};

const credits = (r) => (r.body.account ?? r.body).state.corp.finances.credits;
/** Every string in a receipt, for the register check. */
const strings = (v) => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);

// A tier-1 research the corporation has not done, with nothing it needs first: the one queue-rnd will take.
const queueable = Object.values(RESEARCH_LIBRARY).find((t) => t.tier === 1 && !(t.prereqs || []).length && !(t.requiresCorpLevel > 0));
const program = Object.values(CEO_INSIGHT_LIBRARY).find((p) => isInsightProgramLive(p) && !(p.prereqs || []).length);

beforeAll(async () => {
  const { app } = await getApp();
  const me = await registerAccount(app);
  accountId = me.account.id;
  api = authed(app, me.accessToken);
  const other = await registerAccount(app);
  const theirs = authed(app, other.accessToken);

  const seed = (id, fn) => mutateAccountState(id, fn, { sanitize: false, settleMining: false });
  seed(accountId, (s) => {
    s.corp.finances.credits = 5_000_000;
    s.corp.unlockedTech = Object.keys(RESEARCH_LIBRARY).filter((id) => id !== queueable.id);
    s.corp.buildingSlots = 10;
    s.corp.buildings = [];
    s.corp.currentStationId = "earth-station-prime";
    s.corp.currentSystemId = "sol";
    s.corp.inventory = { "earth-station-prime": { Silicates: 5000, Nickel: 5000 }, "luna-gateway": { Silicates: 200 } };
    s.corp.asteroidMining = { probeCount: 1, maxDeployments: 1, fabricationQueue: [], activeExpeditions: [], completedExpeditions: [], scoutedBelts: [] };
  });
  seed(other.account.id, (s) => {
    s.corp.currentStationId = "earth-station-prime";
    s.corp.inventory = { "earth-station-prime": { Nickel: 100 } };
  });

  const post = (path, body = {}) => api.post(`/api/accounts/${accountId}/gameplay/${path}`).send(body);
  res.before = await api.get(`/api/accounts/${accountId}`);
  res.assembly = await post("build-assembly-facility");
  res.buildRefinery = await post("build-refinery");
  const refineryId = res.buildRefinery.body.state?.corp?.refineries?.[0]?.id;
  res.startRefinery = await post("start-refinery", { refineryId, chainId: "silicates-chain", inputQuantity: 200 });
  res.probe = await post("build-mining-probe");
  res.scout = await post("scout-belt", { beltKey: "sol:belt" });
  res.rescout = await post("scout-belt", { beltKey: "sol:belt" });
  res.expedition = await post("launch-expedition", { beltKey: "sol:belt", duration: "short" });
  res.rnd = await post("queue-rnd", { techId: queueable.id });
  res.ceo = program ? await post("queue-ceo", { programId: program.id }) : null;
  res.list = await api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 10, unitPrice: 55 });
  const theirOrder = await theirs.post("/api/market/orders").send({ type: "sell", item: "Nickel", quantity: 20, unitPrice: 40 });
  res.buy = await api.post(`/api/market/orders/${theirOrder.body.order.id}/buy`).send({ quantity: 5 });
  const bid = (getState().market.npcBuyOrders || []).find((o) => o.item === "Silicates" && o.remainingQty >= 10);
  res.sell = bid ? await api.post(`/api/market/npc-orders/${bid.id}/sell`).send({ quantity: 10 }) : null;
  res.transfer = await post("transfer-resources", { fromStationId: "luna-gateway", lines: [{ item: "Silicates", quantity: 50 }] });
  const offered = (await api.get(`/api/accounts/${accountId}`)).body.state.corp.contractOfferings?.missions?.[0];
  res.accept = offered ? await post("accept-mission", { missionId: offered.id }) : null;
  if (offered?.quota) {
    seed(accountId, (s) => { s.corp.inventory["earth-station-prime"][offered.quota.resource] = offered.quota.amount + 5; });
  }
  res.complete = offered ? await post("complete-mission", { missionId: offered.id }) : null;
  res.travel = await post("travel", { toStationId: "mars-orbital-dock" }); // last: it undocks the corporation
  res.offered = offered;
}, 60_000);

describe("every remaining committing action answers with a receipt (AB#744)", () => {
  const cases = [
    ["assembly", "build-assembly-facility"], ["buildRefinery", "build-refinery"], ["startRefinery", "start-refinery"], ["probe", "build-mining-probe"],
    ["scout", "scout-belt"], ["expedition", "launch-expedition"], ["rnd", "queue-rnd"], ["ceo", "queue-ceo"],
    ["list", "list-for-sale"], ["buy", "buy"], ["sell", "sell-to-order"], ["transfer", "transfer-resources"],
    ["accept", "accept-mission"], ["complete", "complete-mission"], ["travel", "travel"]
  ];
  it.each(cases)("%s: succeeds and carries a receipt for %s, in the ISA's register", (key, action) => {
    const r = res[key];
    expect(r, `${key} was reachable in this fixture`).toBeTruthy();
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(r.body.receipt).toMatchObject({ action, title: expect.any(String), summary: expect.any(String), cost: expect.stringMatching(/ credits$/), next: expect.any(String) });
    expect(Array.isArray(r.body.receipt.grants)).toBe(true);
    for (const s of strings(r.body.receipt)) expect(s, key).not.toMatch(/!/);
  });

  it("each receipt's charge is what actually left the reserves", () => {
    const chain = [res.before, res.assembly, res.buildRefinery, res.startRefinery, res.probe, res.scout, res.rescout, res.expedition, res.rnd, res.ceo].filter(Boolean);
    for (let i = 1; i < chain.length; i += 1) {
      const r = chain[i];
      if (!r.body.receipt) continue;
      expect(credits(chain[i - 1]) - credits(r), r.body.receipt.action).toBe(r.body.receipt.costCredits);
    }
    const buyTotal = res.buy.body.traded.total;
    expect(res.buy.body.receipt.costCredits).toBe(buyTotal);
    if (res.sell) expect(res.sell.body.receipt.costCredits).toBe(res.sell.body.traded.taxAmount);
    expect(res.transfer.body.receipt.costCredits).toBe(res.transfer.body.shipment.fee);
  });

  it("figures come from the state the answer carries", () => {
    const corp = res.startRefinery.body.state.corp;
    const running = corp.refineries.find((r) => r.active);
    expect(res.startRefinery.body.receipt.grants.find((g) => g.label === "Input consumed").value).toBe("200 Silicates");
    expect(res.startRefinery.body.receipt.grants.find((g) => g.label === "Run ends").value).toMatch(/ UTC$/);
    expect(running).toBeTruthy();
    expect(res.expedition.body.receipt.grants.find((g) => g.label === "Probes still on hand").value).toBe(String(res.expedition.body.state.corp.asteroidMining.probeCount));
    expect(res.list.body.receipt.summary).toBe("10 Silicates for sale at 55 credits each.");
    expect(res.transfer.body.receipt.summary).toMatch(/from Luna Gateway to Earth Station Prime\.$/);
    expect(res.travel.body.receipt.summary).toBe("Under way to Mars Orbital Dock.");
    if (res.offered?.quota) {
      expect(res.complete.body.receipt.grants[0]).toEqual({ label: "Delivered", value: `${res.offered.quota.amount.toLocaleString("en-US")} ${res.offered.quota.resource}` });
    }
  });

  it("an action that did nothing, or was refused, carries no receipt", async () => {
    expect(res.rescout.status).toBe(200);
    expect(res.rescout.body.receipt).toBeUndefined(); // already scouted: nothing happened
    const refused = await api.post(`/api/accounts/${accountId}/gameplay/scout-belt`).send({ beltKey: "alpha-centauri:ac-belt" });
    expect(refused.status).toBe(400);
    expect(refused.body.receipt).toBeUndefined();
    expect(refused.body.error).toBeTruthy();
  });
});
