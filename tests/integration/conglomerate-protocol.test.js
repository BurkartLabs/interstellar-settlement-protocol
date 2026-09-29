import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";
import { refusalMeaning } from "../../public/scripts/protocol.js";
import { findConglomerate } from "../../server/game/membership.js";

// ISP-254 (AB#4811, slice C1a) and Bug #4814, through the running server: a charter refused for want of credits carries
// its code and says what to do; a name already held says to choose another; a role change's notification carries
// Concluded on the Conglomerate screen beside its plain words.
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const uniqueName = (stem) => `${stem} ${Date.now() % 1e6} ${(seq += 1)}`;
async function founder(credits) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  raw.createdAt = Date.now() - (C.minFounderAgeDays + 1) * DAY;
  raw.state.corp.currentStationId = C.charterStationId;
  raw.state.corp.finances.credits = credits;
  return { raw, corpId: raw.state.corp.publicId, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
}

describe("the Bureau's refusals and notices, from the server (AB#4811, Bug #4814)", () => {
  it("a charter it cannot fund: code insufficient-credits, read as Unfunded, and the next step", async () => {
    const f = await founder(5_000);
    const res = await f.api.post(`${f.base}/conglomerates`).send({ name: uniqueName("Poor"), emblem: 1, colour: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("insufficient-credits");
    expect(res.body.error).toMatch(/Your corporation holds 5,000\. Sell goods or finish an assignment to raise the credits, then file\.$/);
    expect(refusalMeaning(Object.assign(new Error(res.body.error), { code: res.body.code }))).toBe("unfunded");
  });

  it("a name already held: says to choose another", async () => {
    const first = await founder(250_000);
    const name = uniqueName("Taken");
    expect((await first.api.post(`${first.base}/conglomerates`).send({ name, emblem: 1, colour: 1 })).status).toBe(201);
    const second = await founder(250_000);
    const res = await second.api.post(`${second.base}/conglomerates`).send({ name, emblem: 1, colour: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("A corporation or conglomerate already has this name. Choose another name.");
  });

  it("a promotion's notice carries Concluded on the Conglomerate screen", async () => {
    const f = await founder(250_000);
    const made = await f.api.post(`${f.base}/conglomerates`).send({ name: uniqueName("Order"), emblem: 1, colour: 1 });
    const cid = made.body.conglomerate.id;
    const { app } = await getApp();
    const reg = await registerAccount(app);
    const m = { corpId: accountsStore.accounts[reg.account.id].state.corp.publicId, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
    const inv = await f.api.post(`${f.base}/conglomerates/${cid}/invitations`).send({ corpId: m.corpId });
    expect((await m.api.post(`${m.base}/conglomerates/${cid}/invitations/${inv.body.invitation.id}/accept`)).status).toBe(200);
    expect((await f.api.post(`${f.base}/conglomerates/${cid}/members/${m.corpId}/role`).send({ role: "director" })).status).toBe(200);
    const list = await m.api.get(`${m.base}/notifications`);
    const note = list.body.notifications.find((n) => n.title === "Promoted to director");
    expect(note).toMatchObject({ title: "Promoted to director", protocol: { meaning: "complete", screen: "conglomerate" } });
  });
});

// ISP-254 slice C1b (AB#4821): the pooled assets. Each refusal for more than is held says how much can be moved, and a
// large withdrawal's notice to the other members is Filed, awaiting review.
describe("the treasury and hangar's refusals and notices, from the server (AB#4821)", () => {
  it("a deposit or withdrawal of more than is held says how much can be moved; a large withdrawal notifies as pending", async () => {
    const f = await founder(250_000);
    const made = await f.api.post(`${f.base}/conglomerates`).send({ name: uniqueName("Pool"), emblem: 1, colour: 1 });
    const cid = made.body.conglomerate.id;
    const url = (p, path) => `${p.base}/conglomerates/${cid}/${path}`;
    const held = f.raw.state.corp.finances.credits;
    const tooMuch = await f.api.post(url(f, "treasury/deposit")).send({ amount: held + 1 });
    expect(tooMuch.body.code).toBe("insufficient-credits");
    expect(tooMuch.body.error).toBe(`Your corporation holds ${held.toLocaleString("en-US")} credits; it cannot deposit ${(held + 1).toLocaleString("en-US")}. Deposit ${held.toLocaleString("en-US")} or less.`);
    expect(refusalMeaning(Object.assign(new Error(tooMuch.body.error), { code: tooMuch.body.code }))).toBe("unfunded");
    const balance = (await f.api.get(url(f, "treasury"))).body.balance;
    const hangar = (await f.api.get(url(f, "hangar"))).body;
    // 100 deposited today makes today's cap 20; with 5 left, 10 is within the cap and more than the hangar holds
    f.raw.state.corp.inventory = { ...(f.raw.state.corp.inventory || {}), [hangar.stationId]: { "Structural Alloys": 100 } };
    expect((await f.api.post(url(f, "hangar/deposit")).send({ stationId: hangar.stationId, item: "Structural Alloys", quantity: 100 })).status).toBe(200);
    findConglomerate(cid).hangar.items["Structural Alloys"] = 5;
    const goods = await f.api.post(url(f, "hangar/withdraw")).send({ stationId: hangar.stationId, item: "Structural Alloys", quantity: 10 });
    expect(goods.body.code).toBe("insufficient-hangar");
    expect(goods.body.error).toBe("The hangar holds 5 Structural Alloys. Withdraw 5 or fewer.");

    // a member, told of the founder's large withdrawal
    const { app } = await getApp();
    const reg = await registerAccount(app);
    const m = { corpId: accountsStore.accounts[reg.account.id].state.corp.publicId, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
    const inv = await f.api.post(`${f.base}/conglomerates/${cid}/invitations`).send({ corpId: m.corpId });
    expect((await m.api.post(`${m.base}/conglomerates/${cid}/invitations/${inv.body.invitation.id}/accept`)).status).toBe(200);
    const big = await f.api.post(url(f, "treasury/withdraw")).send({ amount: Math.floor(balance * 0.15) }); // over the 10% notice, under the daily cap
    expect(big.status, JSON.stringify(big.body)).toBe(200);
    expect(big.body.withdrawal.state).toBe("pending");
    const notes = (await m.api.get(`${m.base}/notifications`)).body.notifications;
    expect(notes.find((n) => n.title.startsWith("A large withdrawal from"))?.protocol).toEqual({ meaning: "pending", screen: "conglomerate" });

    // the daily cap is read first, so a treasury below today's allowance is what reaches "The treasury holds"
    findConglomerate(cid).treasury.credits = 100;
    const over = await f.api.post(url(f, "treasury/withdraw")).send({ amount: 150 });
    expect(over.body.code).toBe("insufficient-treasury");
    expect(over.body.error).toBe("The treasury holds 100 credits. Withdraw 100 or less.");
  });
});
