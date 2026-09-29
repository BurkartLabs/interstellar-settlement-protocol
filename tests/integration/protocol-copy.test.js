import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, RESEARCH_LIBRARY } from "../../server/gameState.js";
import { refusalMeaning } from "../../public/scripts/protocol.js";

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
