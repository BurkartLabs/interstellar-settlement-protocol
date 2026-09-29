import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById } from "../../server/gameState.js";
import { offersFirstDay } from "../../public/scripts/walkthrough.js";

// Bug #4885: declining "Your first day" was remembered only in one browser's localStorage, so the server's
// walkthroughCompleted stayed false and every other browser offered the blocking briefing again, to a Level 12
// corporation in the AB#971 RC run. Declining now answers the offer on the account.
const route = (id, what) => `/api/accounts/${id}/${what}`;
const titles = async (api, id) => ((await api.get(route(id, "notifications"))).body.notifications || []).map((n) => n.title);

describe("declining the first-day briefing is recorded on the account (Bug #4885)", () => {
  it("a declined offer sets walkthroughCompleted on the server, and is not announced as a completed briefing", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const api = authed(app, accessToken);
    expect(getAccountById(account.id).walkthroughCompleted).toBe(false);
    const res = await api.post(route(account.id, "walkthrough-complete")).send({ answer: "declined" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.walkthroughCompleted).toBe(true);
    expect(getAccountById(account.id).walkthroughCompleted).toBe(true);
    expect(await titles(api, account.id)).not.toContain("Walkthrough Completed");
  });

  it("finishing the briefing is still announced, and an answer other than declined is refused", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const api = authed(app, accessToken);
    expect((await api.post(route(account.id, "walkthrough-complete")).send({ answer: "maybe" })).status).toBe(400);
    expect(getAccountById(account.id).walkthroughCompleted).toBe(false);
    expect((await api.post(route(account.id, "walkthrough-complete"))).status).toBe(200);
    expect(await titles(api, account.id)).toContain("Walkthrough Completed");
  });
});

describe("when the first-day offer is made (Bug #4885)", () => {
  const fresh = { level: 0, stats: {} };
  it("to a new corporation that has neither finished nor declined it, on a browser that has not shown it", () => {
    expect(offersFirstDay({ walkthroughCompleted: false, seenHere: false, corp: fresh })).toBe(true);
  });
  it("not once the account has finished or declined it, whichever browser signs in", () => {
    expect(offersFirstDay({ walkthroughCompleted: true, seenHere: false, corp: fresh })).toBe(false);
  });
  it("not twice in one browser", () => {
    expect(offersFirstDay({ walkthroughCompleted: false, seenHere: true, corp: fresh })).toBe(false);
  });
  it("not to a corporation that has started, whatever the flags say (players who declined before this fix)", () => {
    expect(offersFirstDay({ walkthroughCompleted: false, seenHere: false, corp: { level: 12, stats: { officeRented: 3 } } })).toBe(false);
    expect(offersFirstDay({ walkthroughCompleted: false, seenHere: false, corp: { level: 0, stats: { officeRented: 1 } } })).toBe(false);
  });
});
