import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState } from "../../server/gameState.js";
import { refusalMeaning } from "../../public/scripts/protocol.js";

// ISP-254 Bd (AB#4819): Operations' notifications carry their protocol through the running server, so the page draws
// the guide's phrase and the screen's code after the plain title: a mining lease approved is In force at the ISA
// Claims & Leases Division, a yard commissioned is Concluded on the lease, a cycle started is In force and one stopped
// is Withdrawn in Active Mining Cycles. The titles and bodies are unchanged: the plain words always stay.
let api, accountId;
const seed = (fn) => mutateAccountState(accountId, fn, { sanitize: false, settleMining: false });
const route = (path) => `/api/accounts/${accountId}/${path}`;
const notice = async (title) => (await api.get(route("notifications"))).body.notifications.find((n) => n.title === title);

beforeAll(async () => {
  const { app } = await getApp();
  const me = await registerAccount(app);
  accountId = me.account.id;
  api = authed(app, me.accessToken);
  seed((s) => { s.corp.finances.credits = 50_000_000; });
  await api.post(route("walkthrough-complete"));
  expect((await api.post(route("gameplay/rent-office")).send({ stationId: "earth-station-prime", durationDays: 28 })).status).toBe(200);
  expect((await api.post(route("gameplay/hire")).send({ count: 5 })).status).toBe(200);
});

describe("Operations' notifications carry the protocol line (ISP-254 Bd, AB#4819)", () => {
  let lease, extractorId;

  it("a lease approved: In force at the Claims & Leases Division, beside the unchanged title", async () => {
    const res = await api.post(route("gameplay/purchase-lease")).send({ body: "earth" });
    expect(res.status, res.body.error).toBe(200);
    lease = res.body.state.corp.miningLeases.at(-1);
    expect(await notice("Mining Lease Approved")).toMatchObject({ protocol: { meaning: "active", screen: "building-isa-claims-leases" } });
  });

  it("a yard commissioned on the lease: Concluded on the lease's page", async () => {
    const res = await api.post(route(`gameplay/lease/${lease.id}/build-extractor`)).send({});
    expect(res.status, res.body.error).toBe(200);
    extractorId = res.body.state.corp.miningLeases.find((l) => l.id === lease.id).extractorIds.at(-1);
    expect(await notice("Extractor Commissioned")).toMatchObject({
      body: "Basic Extractor Yard is now operational and linked to your mining lease.",
      protocol: { meaning: "complete", screen: "building-lease" }
    });
  });

  it("a cycle started is In force and a cycle stopped is Withdrawn, in Active Mining Cycles", async () => {
    const started = await api.post(route(`gameplay/lease/${lease.id}/start-mining`)).send({ amount: 100, hours: 24, extractorId });
    expect(started.status, started.body.error).toBe(200);
    expect(await notice("Mining Cycle Started")).toMatchObject({ protocol: { meaning: "active", screen: "station-active-mining-cycles" } });
    const stopped = await api.post(route(`gameplay/lease/${lease.id}/stop-mining`)).send({ extractorId });
    expect(stopped.status, stopped.body.error).toBe(200);
    expect(await notice("Mining Cycle Stopped")).toMatchObject({ protocol: { meaning: "cancelled", screen: "station-active-mining-cycles" } });
  });

  it("a cycle refused for want of credits reads as Unfunded, from the server's own words", async () => {
    seed((s) => { s.corp.finances.credits = 0; });
    const res = await api.post(route(`gameplay/lease/${lease.id}/start-mining`)).send({ amount: 100, hours: 24, extractorId });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(refusalMeaning(res.body.error), res.body.error).toBe("unfunded"); // written by fundingRequirementMessage
  });
});
