import { describe, it, expect, beforeEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { resetPatentsForTests } from "../../server/patents.js";
import { WARFARE_CATALOG } from "../../server/warfare.js";
import { ROYALTY_CATEGORY } from "../../public/scripts/patentRoyalty.js";

// ISP-237 (AB#932): GET /api/accounts/:id/patents, the caller's own patent office: what it may file now (first
// completer, inside the window, not patented), its patents, the patents it pays on, and its royalties both ways.
const HOUR = 3_600_000;
const T = WARFARE_CATALOG.patents;
beforeEach(() => resetPatentsForTests());

async function corp({ research = {}, chains = {}, finances = {} } = {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => {
    s.corp.finances.credits = 100_000;
    Object.assign(s.corp.finances, finances);
    s.corp.researchCompletedAt = { ...research };
    s.corp.chainFirstRunAt = { ...chains };
    s.corp.unlockedTech = [...new Set([...(s.corp.unlockedTech || []), ...Object.keys(research)])];
  }, { sanitize: false, settleMining: false });
  const api = authed(app, accessToken);
  return { id: account.id, api, name: () => getAccountById(account.id).state.corp.corporationName, office: () => api.get(`/api/accounts/${account.id}/patents`), file: (body) => api.post(`/api/accounts/${account.id}/patents`).send(body) };
}

describe("the patent office's read (AB#932)", () => {
  it("lists only what the caller completed first, inside the window, and not yet patented; filing moves it to the caller's patents", async () => {
    const now = Date.now();
    const first = await corp({ research: { "tt-fusion-fuel-cycle": now - 2 * HOUR, "tt-capital-hulls": now - (T.filingWindowHours + 1) * HOUR, "tt-basic-extraction": now - HOUR }, chains: { "pressure-vessel-chain": now - HOUR } });
    const second = await corp({ research: { "tt-fusion-fuel-cycle": now - HOUR } });
    const res = await first.office();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.terms).toMatchObject({ filingFee: T.filingFee, filingWindowHours: T.filingWindowHours, termDays: T.termDays });
    // soonest window first; the late node and the tier 1 node are not offered
    expect(res.body.filable.map((f) => [f.kind, f.subjectId, f.maxPct])).toEqual([["research", "tt-fusion-fuel-cycle", T.royaltyMaxPct], ["chain", "pressure-vessel-chain", T.chainRoyaltyMaxPct]]);
    expect(res.body.filable.find((f) => f.subjectId === "tt-fusion-fuel-cycle").windowEndsAt).toBe(now - 2 * HOUR + T.filingWindowHours * HOUR);
    expect((await second.office()).body.filable).toEqual([]); // the second completer is offered nothing

    // a rate of 0 is a rate (the input check must not refuse it)
    const filed = await first.file({ kind: "chain", subjectId: "pressure-vessel-chain", ratePct: 0 });
    expect(filed.status, JSON.stringify(filed.body)).toBe(201);
    const after = (await first.office()).body;
    expect(after.filable.map((f) => f.subjectId)).toEqual(["tt-fusion-fuel-cycle"]);
    expect(after.mine).toEqual([expect.objectContaining({ kind: "chain", subjectId: "pressure-vessel-chain", ratePct: 0, holder: first.name(), active: true })]);
  });

  it("shows another's patent in force on a chain the caller runs, and the royalties its statements carry both ways", async () => {
    const now = Date.now();
    const holder = await corp({ chains: { "pressure-vessel-chain": now - 3 * HOUR } });
    expect((await holder.file({ kind: "chain", subjectId: "pressure-vessel-chain", ratePct: 4 })).status).toBe(201);
    const user = await corp({ chains: { "pressure-vessel-chain": now - HOUR }, finances: { expensesByCategory: { [ROYALTY_CATEGORY]: 1_290 } } });
    const idle = await corp();
    const office = (await user.office()).body;
    expect(office.paying).toEqual([expect.objectContaining({ subjectId: "pressure-vessel-chain", holder: holder.name(), ratePct: 4 })]);
    expect(office.royalties).toEqual({ received: 0, paid: 1_290 });
    expect((await idle.office()).body.paying).toEqual([]); // a chain it has never run
    expect((await holder.office()).body.paying).toEqual([]); // never its own
    expect(JSON.stringify(office)).not.toContain(holder.id);
  });

  it("is the caller's own: another account's office is refused", async () => {
    const a = await corp(), b = await corp();
    expect((await a.api.get(`/api/accounts/${b.id}/patents`)).status).toBe(403);
  });
});
