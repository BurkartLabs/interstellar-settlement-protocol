import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, backfillCorpPublicIds, listAccountMessages } from "../../server/gameState.js";

// Bug #711: mail was addressed by corporation name and delivered to the first account whose name matched, so every
// other corporation with that name - and the default name makes that common - could never receive mail, and the
// first one received mail meant for all of them.
const SHARED = "Frontier Protocol Ventures";

// Registration refuses a name another corporation has (Bug #433), but saves from before that rule can hold duplicates,
// which is what these tests model: each corporation registers under a unique name and is then given the name it needs.
async function corp(corpName) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => { state.corp.corporationName = corpName; });
  return { id: account.id, api: authed(app, accessToken), publicId: getAccountById(account.id).state.corp.publicId };
}
// Read mail the way the game does (getAccountById returns a sanitised account without messages).
const inbox = (id) => (listAccountMessages(id) || []).filter((m) => m.folder === "inbox" && m.fromType === "player");
const sent = (id) => (listAccountMessages(id) || []).filter((m) => m.folder === "sent");
const send = (from, body) => from.api.post(`/api/accounts/${from.id}/messages/send`).send({ subject: "Hello", body: "Private terms", ...body });

describe("player mail routing (Bug #711)", () => {
  it("gives every corporation a public id that is not its account id", async () => {
    const a = await corp(SHARED);
    expect(a.publicId).toMatch(/^corp-/);
    expect(a.publicId).not.toContain(a.id);
  });

  it("lists same-named corporations separately, with nothing that identifies the account", async () => {
    const [a, b, c] = [await corp(SHARED), await corp(SHARED), await corp("Sender Holdings")];
    const res = await c.api.get(`/api/accounts/${c.id}/corporations`).query({ name: "frontier protocol" });
    expect(res.status).toBe(200);
    const ids = res.body.corporations.map((x) => x.publicId);
    expect(ids).toEqual(expect.arrayContaining([a.publicId, b.publicId]));
    expect(res.body.corporations.length).toBeLessThanOrEqual(10);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(a.id);
    expect(text).not.toContain("@");
    expect(Object.keys(res.body.corporations[0]).sort()).toEqual(["ceo", "corporationName", "location", "publicId"]);
  });

  it("delivers mail addressed by public id to exactly that corporation, even when two share a name", async () => {
    const [a, b, c] = [await corp(SHARED), await corp(SHARED), await corp("Sender Holdings")];
    expect((await send(c, { toCorpId: b.publicId })).status).toBe(200);
    expect(inbox(b.id)).toHaveLength(1);
    expect(inbox(a.id)).toHaveLength(0);
    expect((await send(c, { toCorpId: a.publicId })).status).toBe(200);
    expect(inbox(a.id)).toHaveLength(1);
  });

  it("refuses an ambiguous name with 409 and the candidates, and writes no copy anywhere", async () => {
    const [a, b, c] = [await corp(SHARED), await corp(SHARED), await corp("Sender Holdings")];
    const res = await send(c, { toCorpName: SHARED });
    expect(res.status).toBe(409);
    expect(res.body.candidates.map((x) => x.publicId)).toEqual(expect.arrayContaining([a.publicId, b.publicId]));
    expect(inbox(a.id)).toHaveLength(0);
    expect(inbox(b.id)).toHaveLength(0);
    expect(sent(c.id)).toHaveLength(0);
  });

  it("still accepts a name that matches exactly one corporation, and 404s one that matches none", async () => {
    const unique = `Unique Mining ${Date.now()}`;
    const [d, c] = [await corp(unique), await corp("Sender Holdings")];
    expect((await send(c, { toCorpName: unique.toUpperCase() })).status).toBe(200);
    expect(inbox(d.id)).toHaveLength(1);
    expect((await send(c, { toCorpName: "Nobody By This Name" })).status).toBe(404);
    expect((await send(c, { toCorpId: "corp-does-not-exist" })).status).toBe(404);
  });

  it("never shows a sender's email address as their name", async () => {
    const [to, from] = [await corp(`Receiver ${Date.now()}`), await corp("Temporary Name")];
    mutateAccountState(from.id, (state) => { state.corp.corporationName = ""; });
    expect((await send(from, { toCorpId: to.publicId })).status).toBe(200);
    const [msg] = inbox(to.id);
    expect(msg.fromName).toBe("Unregistered corporation");
    expect(msg.fromName).not.toContain("@");
  });

  it("does not hand another player's account id to the reader of a message", async () => {
    const [to, from] = [await corp(`Receiver ${Date.now()}`), await corp("Sender Holdings")];
    expect((await send(from, { toCorpId: to.publicId })).status).toBe(200);
    expect(inbox(to.id)).toHaveLength(1); // there is a message to inspect, so the next check is not empty
    const res = await to.api.get(`/api/accounts/${to.id}/messages`);
    const text = JSON.stringify(res.body.messages);
    expect(text).not.toContain(from.id);
    const mine = await from.api.get(`/api/accounts/${from.id}/messages`);
    expect(JSON.stringify(mine.body.messages)).not.toContain(to.id);
  });

  it("gives a save from before this change a public id on load, and it can then receive mail", async () => {
    const [old, c] = [await corp(`Old Save ${Date.now()}`), await corp("Sender Holdings")];
    mutateAccountState(old.id, (state) => { delete state.corp.publicId; }); // as written before Bug #711
    expect(getAccountById(old.id).state.corp.publicId).toBeUndefined();
    backfillCorpPublicIds();
    const publicId = getAccountById(old.id).state.corp.publicId;
    expect(publicId).toMatch(/^corp-/);
    expect((await send(c, { toCorpId: publicId })).status).toBe(200);
    expect(inbox(old.id)).toHaveLength(1);
  });

  it("keeps the recipient's public id on a saved draft", async () => {
    const [to, c] = [await corp(`Draft Target ${Date.now()}`), await corp("Sender Holdings")];
    expect(to.publicId).toMatch(/^corp-/);
    const res = await c.api.post(`/api/accounts/${c.id}/messages/draft`).send({ toCorpId: to.publicId, toCorpName: "whatever", subject: "s", body: "b" });
    expect(res.body.draft.toCorpId).toBe(to.publicId);
  });
});
