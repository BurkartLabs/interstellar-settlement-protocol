import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { contractRecord } from "../../server/mercenaries.js";
import { resetArbitration } from "../../server/arbitration.js";
import { settlementTotals } from "../../server/settlement.js";

// ISP-243 (AB#939): the filing wizard's evidence preview is exactly what a filing attaches, and it charges and writes nothing.
const H = 3_600_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });
afterEach(() => resetArbitration());

async function corp(set = () => {}) {
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => { s.corp.currentStationId = "earth-station-prime"; s.corp.finances.credits = 500_000; set(s.corp); }, { sanitize: false, settleMining: false });
  return { id: account.id, api: authed(app, accessToken), credits: () => getAccountById(account.id).state.corp.finances.credits };
}

describe("the evidence preview (AB#939)", () => {
  it("shows exactly what filing attaches: respondent, amount, fee and evidence; nothing is charged or written", async () => {
    const owner = await corp((c) => { c.military = { units: { lf: 10, ds: 2 } }; });
    const renter = await corp();
    const at = (who, p) => `/api/accounts/${who.id}/gameplay${p}`;
    const fleetId = (await owner.api.post(at(owner, "/fleets/form")).send({ lf: 8, ds: 2 })).body.fleet.id;
    const offerId = (await owner.api.post(at(owner, "/mercenaries/offer")).send({ fleetId, termHours: 24, price: 5_000, collateral: 15_000, allowedUse: "defense" })).body.offer.id;
    await renter.api.post(at(renter, `/mercenaries/${offerId}/hire`)).send({});
    const c = contractRecord(offerId);
    mutateAccountState(owner.id, (s) => { s.corp.military.readinessLog = [{ at: c.hiredAt - 5 * H, readiness: 100 }, { at: c.hiredAt - 4 * H, readiness: 80 }]; }, { sanitize: false, settleMining: false });
    const credits = renter.credits(), totals = JSON.stringify(settlementTotals());
    const body = { type: "mercenary-readiness", recordId: offerId };
    const preview = await renter.api.post(`/api/accounts/${renter.id}/arbitration/preview`).send(body);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(renter.credits()).toBe(credits);
    expect(JSON.stringify(settlementTotals())).toBe(totals);
    expect((await renter.api.get(`/api/accounts/${renter.id}/arbitration/cases`)).body.cases).toEqual([]);
    const filed = await renter.api.post(`/api/accounts/${renter.id}/arbitration/cases`).send(body);
    expect(filed.status).toBe(201);
    const p = preview.body.preview, f = filed.body.case;
    expect(p.evidence).toEqual(f.evidence);
    expect({ recordRef: p.recordRef, respondent: p.respondent, amount: p.amountClaimed, fee: p.fee }).toEqual({ recordRef: f.recordRef, respondent: f.respondent, amount: f.amountClaimed, fee: f.feePaid });
    expect(p.freezesEscrow).toBe(true);
    // once filed, the preview refuses as filing would
    expect((await renter.api.post(`/api/accounts/${renter.id}/arbitration/preview`).send(body)).body.code).toBe("duplicate");
  });
});
