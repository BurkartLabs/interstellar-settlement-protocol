import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { listAccountMessages, CORP_NAME_MAX_LENGTH } from "../../server/gameState.js";

// Bug #754: a draft's recipient name was stored uncapped and unfiltered. It is now bounded like a corporation name.
async function sender() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app, { corpName: `Bounds Sender ${Date.now()}` });
  return { id: account.id, api: authed(app, accessToken) };
}

describe("mail recipient names are bounded (Bug #754)", () => {
  it("uses the registration form's corporation-name maximum", () => {
    expect(CORP_NAME_MAX_LENGTH).toBe(80);
  });

  it("stores a draft's recipient at no more than 80 characters, with control characters removed", async () => {
    const s = await sender();
    const res = await s.api.post(`/api/accounts/${s.id}/messages/draft`).send({ toCorpName: `A\u0000B\u0007${"x".repeat(200)}`, subject: "s", body: "b" });
    expect(res.status).toBe(200);
    const stored = listAccountMessages(s.id).find((m) => m.id === res.body.draft.id).toCorpName;
    expect(stored.length).toBeLessThanOrEqual(80);
    expect(stored).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(stored.startsWith("AB")).toBe(true);
  });

  it("refuses to send to a name over 80 characters or with control characters, and writes nothing", async () => {
    const s = await sender();
    const before = listAccountMessages(s.id).length;
    for (const toCorpName of ["x".repeat(81), "Frontier\u0000Protocol", "Line\nBreak"]) {
      const res = await s.api.post(`/api/accounts/${s.id}/messages/send`).send({ toCorpName, subject: "s", body: "b" });
      expect(res.status).toBe(400);
    }
    expect(listAccountMessages(s.id).length).toBe(before);
  });
});
