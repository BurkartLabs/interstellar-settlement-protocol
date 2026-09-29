import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";

// Bug #4832: three Inbox refusals said what went wrong but not what to do next (ISP-6's rule). A name nothing matches
// now says that part of a name finds matches; a send or a draft save that never reached the server says to check the
// connection and press the button again; a draft delete the server refused without words says to try again shortly.
let api, accountId;
const inbox = readFileSync(new URL("../../public/scripts/views/inbox.js", import.meta.url), "utf8");

beforeAll(async () => {
  const { app } = await getApp();
  const me = await registerAccount(app);
  accountId = me.account.id;
  api = authed(app, me.accessToken);
});

describe("Inbox refusals say what to do next (Bug #4832)", () => {
  it("a name no corporation has: the server says part of a name lists matches", async () => {
    const res = await api.post(`/api/accounts/${accountId}/messages/send`).send({ toCorpName: "zzzz-no-such-corporation-4832", body: "hello" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("No corporation has that name. Check the spelling: part of a name lists every corporation it matches.");
  });

  it("the page's own lookup says the same", () => {
    expect(inbox).toContain('if (!matches.length) return { error: "No corporation has that name. Check the spelling: part of a name lists every corporation it matches." };');
  });

  it("a send or a save that never reached the server says to check the connection and try the same button", () => {
    expect(inbox).toContain("The message was not sent: ${err.message}. Check your connection and press Send again.");
    expect(inbox).toContain("The draft was not saved: ${err.message}. Check your connection and press Save Draft again.");
    expect(inbox).toContain('"The draft was not saved. Press Save Draft again."');
    expect(inbox).not.toMatch(/`Error: \$\{err\.message\}`/);
  });

  it("a delete refused without words says to try again in a minute", () => {
    expect(inbox).toContain('"the server did not answer. Try again in a minute"');
    expect(inbox).not.toContain('"the server refused"');
  });
});
