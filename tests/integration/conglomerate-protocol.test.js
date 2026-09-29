import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";
import { refusalMeaning } from "../../public/scripts/protocol.js";

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
