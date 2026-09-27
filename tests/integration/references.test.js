import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { REFERENCE_PATTERN } from "../../server/references.js";

// ISP-249 (AB#945): records carry reference numbers: new ones from the start, those in an older save from the first time
// they are read, kept; the licence letter names the licence, not the account; and no route finds a record by its
// reference, so a reference is never a key to anyone else's records.
let app;
beforeAll(async () => { ({ app } = await getApp()); });

describe("reference numbers on records (AB#945)", () => {
  it("gives a used save's records their references on first read, and keeps them", async () => {
    const reg = await registerAccount(app);
    const raw = accountsStore.accounts[reg.account.id];
    const corp = raw.state.corp;
    // a save from before reference numbers: records with ids and times, and no references
    delete corp.licenceRef;
    corp.miningLeases = [{ id: "lease-old-1", body: "Earth", issuedAt: Date.UTC(2026, 5, 1), buildingSlots: 2 }];
    corp.tradeHistory = [{ id: "th-old-1", type: "sold", item: "Silicates", quantity: 10, unitPrice: 24, total: 240, at: Date.UTC(2026, 5, 2) }];
    corp.completedMissions = [{ id: "ms-log-001", title: "Old contract", acceptedAt: Date.UTC(2026, 5, 3), completedAt: Date.UTC(2026, 5, 4) }];
    corp.loans = [{ id: "loan-old", openedAt: Date.UTC(2026, 5, 5), principal: 1000, balance: 1000 }];
    const api = authed(app, reg.accessToken);
    const first = (await api.get(`/api/accounts/${reg.account.id}`)).body.state.corp;
    for (const ref of [first.licenceRef, first.miningLeases[0].ref, first.tradeHistory[0].ref, first.completedMissions[0].ref, first.loans[0].ref]) expect(ref).toMatch(REFERENCE_PATTERN);
    expect(first.miningLeases[0].ref).toMatch(/^LSE-2147-/);
    expect(first.tradeHistory[0].ref).toMatch(/^RCP-2147-/);
    expect(first.completedMissions[0].ref).toMatch(/^CON-2147-/);
    expect(first.loans[0].ref).toMatch(/^LOA-2147-/);
    // kept: on the saved record itself, and the same on the next read
    expect(corp.miningLeases[0].ref).toBe(first.miningLeases[0].ref);
    expect(corp.licenceRef).toBe(first.licenceRef);
    const second = (await api.get(`/api/accounts/${reg.account.id}`)).body.state.corp;
    expect(second.miningLeases[0].ref).toBe(first.miningLeases[0].ref);
    expect(second.licenceRef).toBe(first.licenceRef);
  });

  it("names a new corporation's licence in its welcome letter by the licence's reference, not its account id", async () => {
    const reg = await registerAccount(app);
    const raw = accountsStore.accounts[reg.account.id];
    expect(raw.state.corp.licenceRef).toMatch(/^LIC-2147-[0-9A-HJKMNP-TV-Z]{6}$/);
    const letter = (raw.messages || []).find((m) => /ISA Settlement Licence/.test(m.subject));
    expect(letter.subject).toBe(`ISA Settlement Licence — Ref. ${raw.state.corp.licenceRef}`);
    expect(`${letter.subject}\n${letter.body}`).not.toContain(reg.account.id);
    expect(`${letter.subject}\n${letter.body}`.toUpperCase()).not.toContain(reg.account.id.toUpperCase());
  });

  it("is never a way in: no route takes a reference number, and a record is only ever served to its owner", async () => {
    const stack = (app._router?.stack || []).flatMap((l) => (l.route ? [l.route.path] : l.handle?.stack ? l.handle.stack.filter((s) => s.route).map((s) => s.route.path) : []));
    expect(stack.length).toBeGreaterThan(50);
    expect(stack.filter((p) => /:(ref|reference)\w*/i.test(String(p)))).toEqual([]);
    const a = await registerAccount(app), b = await registerAccount(app);
    expect((await authed(app, b.accessToken).get(`/api/accounts/${a.account.id}`)).status).toBe(403);
  });
});
