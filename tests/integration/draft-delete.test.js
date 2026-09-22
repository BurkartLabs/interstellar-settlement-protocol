import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";

// Bug #1137: a saved draft could not be deleted. Opening a draft goes to Compose, which had no Delete; the Delete
// Draft button was in the message view, which drafts never open. It is now in Compose.
beforeAll(async () => { await getApp(); });

async function player() {
  const { app } = await getApp();
  const { account, accessToken, body } = await registerAccount(app);
  return { id: account.id, corpName: body.corpName, api: authed(app, accessToken) };
}

describe("deleting a draft (Bug #1137)", () => {
  it("removes the saved draft, and only that one", async () => {
    const a = await player();
    const b = await player();
    const keep = await a.api.post(`/api/accounts/${a.id}/messages/draft`).send({ toCorpName: b.corpName, subject: "keep", body: "x" });
    const gone = await a.api.post(`/api/accounts/${a.id}/messages/draft`).send({ toCorpName: b.corpName, subject: "delete me", body: "y" });
    expect(gone.body.draft.id).toBeTruthy();
    const res = await a.api.delete(`/api/accounts/${a.id}/messages/draft/${gone.body.draft.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const drafts = (await a.api.get(`/api/accounts/${a.id}/messages`)).body.messages.filter((m) => m.folder === "draft");
    expect(drafts.map((d) => d.id)).toEqual([keep.body.draft.id]);
  });

  it("another account cannot delete it", async () => {
    const a = await player();
    const b = await player();
    const draft = (await a.api.post(`/api/accounts/${a.id}/messages/draft`).send({ toCorpName: b.corpName, subject: "mine", body: "z" })).body.draft;
    expect((await b.api.delete(`/api/accounts/${a.id}/messages/draft/${draft.id}`)).status).toBe(403);
    expect((await b.api.delete(`/api/accounts/${b.id}/messages/draft/${draft.id}`)).body).toEqual({ ok: false });
    const drafts = (await a.api.get(`/api/accounts/${a.id}/messages`)).body.messages.filter((m) => m.folder === "draft");
    expect(drafts.map((d) => d.id)).toContain(draft.id);
  });
});

describe("the page offers Delete where a draft opens (Bug #1137)", () => {
  const html = fs.readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../../public/scripts/app.js", import.meta.url), "utf8");

  it("Compose has a Delete Draft button, hidden until a saved draft is open", () => {
    const compose = html.slice(html.indexOf('id="inbox-compose-form"'), html.indexOf("</form>", html.indexOf('id="inbox-compose-form"')));
    expect(compose).toMatch(/<button type="button" class="btn btn-danger" id="compose-delete-draft-btn" hidden>Delete Draft<\/button>/);
    expect(app).toMatch(/btn\.hidden = !appState\.inbox\.composeDraftId/);
  });

  it("the message view's draft buttons, which could never show, are gone", () => {
    for (const id of ["inbox-action-delete-draft", "inbox-action-edit-draft"]) {
      expect(html).not.toContain(id);
      expect(app).not.toContain(id);
    }
  });
});
