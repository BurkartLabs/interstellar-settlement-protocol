import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { applyRefineryOperations, getAccountById, getState, mutateAccountState, mutateState } from "../../server/gameState.js";
import { recordControlDay, resetControlHistory } from "../../server/controlService.js";
import { concessionRecordForTests, petitionConcession, publicConcession, resetConcessions, reviewConcessions } from "../../server/concessions.js";
import { levyTotal, resetTariffs, setTariff, tariffSummary } from "../../server/tariffService.js";
import { filePatent, patentTick, resetPatentsForTests } from "../../server/patents.js";
import { contractRecord, settleContracts } from "../../server/mercenaries.js";
import { settlementTotals } from "../../server/settlement.js";
import { arbitrationTick, caseRecordForTests, cureCase, decideAt, fileCase, resetArbitration } from "../../server/arbitration.js";
import { WARFARE_CATALOG as W } from "../../server/warfare.js";

// ISP-242 (AB#938; docs/design/WARFARE.md, "A case, as a state list" and "Enforcement"): the adjudication tick rules on
// each claim type from its stored evidence, and enforces the award from escrow, then ISA-held income, then a Council
// debt withheld from later sales; the fee is returned or forfeited; a cure closes a case inside the window. Final and
// idempotent; value conserved; a rule that cannot be evaluated leaves the case pending.
const H = 3_600_000, DAY = 24 * H;
const EARTH = "earth-station-prime";
let app;
beforeAll(async () => { ({ app } = await getApp()); });
afterEach(() => { resetArbitration(); resetConcessions(); resetControlHistory(); resetTariffs(); resetPatentsForTests(); });

async function corp({ credits = 500_000, systemId = "sol", stationId = EARTH, set = () => {} } = {}) {
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => {
    Object.assign(s.corp, { currentSystemId: systemId, currentStationId: stationId });
    s.corp.finances.credits = credits;
    set(s.corp);
  }, { sanitize: false, settleMining: false });
  const c = () => getAccountById(account.id).state.corp;
  return { id: account.id, api: authed(app, accessToken), corp: c, credits: () => c().finances.credits, holder: { type: "corp", id: c().publicId, name: c().corporationName } };
}
const feeSink = () => Number(settlementTotals().sinks?.fee || 0);
function readings(systemId, rows, newestAt) {
  for (let i = 13; i >= 0; i -= 1) recordControlDay({ computedAt: newestAt - i * DAY, holders: { [systemId]: { live: ["extraction", "leases"], groups: rows.map(([h, s]) => ({ type: h.type, id: h.id, name: h.name, parts: { extraction: s, leases: s, sales: 0 } })) } } });
}
/** A snapshot for idempotency: the case, both parties' credits and the settlement totals. */
const snapshot = (ref, ...who) => JSON.stringify({ c: caseRecordForTests(ref), credits: who.map((w) => w.credits()), totals: settlementTotals() });

async function hired(readinessDrops) {
  const owner = await corp({ set: (c) => { c.military = { units: { lf: 10, ds: 2 } }; } });
  const renter = await corp();
  const at = (who, p) => `/api/accounts/${who.id}/gameplay${p}`;
  const fleetId = (await owner.api.post(at(owner, "/fleets/form")).send({ lf: 8, ds: 2, name: "Corsair" })).body.fleet.id;
  const offerId = (await owner.api.post(at(owner, "/mercenaries/offer")).send({ fleetId, termHours: 24, price: 5_000, collateral: 15_000, allowedUse: "defense" })).body.offer.id;
  expect((await renter.api.post(at(renter, `/mercenaries/${offerId}/hire`)).send({})).status).toBe(200);
  const contract = contractRecord(offerId);
  const log = [{ at: contract.hiredAt, readiness: 100 }, ...(readinessDrops ? [{ at: contract.hiredAt + 2 * H, readiness: 80 }, { at: contract.hiredAt + 6 * H, readiness: 70 }] : [])];
  mutateAccountState(owner.id, (s) => { s.corp.military.readinessLog = log; }, { sanitize: false, settleMining: false });
  const filed = fileCase(renter.id, { type: "mercenary-readiness", recordId: offerId }, contract.hiredAt + 10 * H);
  expect(filed.refused).toBeUndefined();
  return { owner, renter, offerId, contract, c: filed.case };
}

describe("mercenary-readiness rulings (AB#938)", () => {
  it("upheld: the refund over the whole term comes from the frozen escrow, off the owner's price, and the fee is returned", async () => {
    const { owner, renter, offerId, contract, c } = await hired(true);
    const [r0, o0] = [renter.credits(), owner.credits()];
    const when = decideAt(caseRecordForTests(c.ref));
    expect(when).toBeGreaterThanOrEqual(c.windowEndsAt);
    expect(new Date(when).getUTCHours()).toBe(0); // the first 00:00 UTC tick after the window
    expect(arbitrationTick(when - 1)).toEqual([]); // not before
    expect(arbitrationTick(when)).toEqual([c.ref]);
    const refund = Math.round((5_000 * (4 * 0.2 + 18 * 0.3)) / 24); // 24 hours: 2 at 100, 4 at 80, 18 at 70
    const ruled = caseRecordForTests(c.ref);
    expect(ruled).toMatchObject({ state: "closed", ruling: { outcome: "upheld", amount: refund }, paid: refund, steps: { fee: "returned", escrow: refund } });
    expect(ruled.ruling.text).toContain(`${refund.toLocaleString("en-US")} credits awarded`);
    expect(renter.credits()).toBe(r0 + refund + 1_000);
    expect(contractRecord(offerId).frozenBy).toBeNull();
    settleContracts(contract.endsAt + 80 * H); // the term's settlement, now unfrozen: the owner is paid the price less the refund
    expect(owner.credits()).toBe(o0 + 5_000 - refund);
    expect(renter.credits()).toBe(r0 + refund + 1_000 + 15_000); // the collateral comes back whole
    const again = snapshot(c.ref, renter, owner);
    arbitrationTick(when + DAY);
    expect(snapshot(c.ref, renter, owner)).toBe(again); // final and idempotent
  });

  it("dismissed: readiness never moved, the fee goes to the fee sink, and the contract settles in full", async () => {
    const { owner, renter, contract, c } = await hired(false);
    const [r0, o0, sink0] = [renter.credits(), owner.credits(), feeSink()];
    arbitrationTick(decideAt(caseRecordForTests(c.ref)));
    expect(caseRecordForTests(c.ref)).toMatchObject({ state: "closed", ruling: { outcome: "dismissed", amount: 0 }, steps: { fee: "sink" } });
    expect(feeSink()).toBe(sink0 + 1_000);
    expect(renter.credits()).toBe(r0);
    settleContracts(contract.endsAt + 80 * H);
    expect(owner.credits()).toBe(o0 + 5_000);
  });

  it("a cure inside the window pays the claim and returns the fee; after the window, or by anyone else, it is refused", async () => {
    const { owner, renter, offerId, c } = await hired(true);
    const [r0, o0] = [renter.credits(), owner.credits()];
    expect(cureCase(renter.id, c.ref, c.filedAt + H).refused.code).toBe("not-respondent");
    expect(cureCase(owner.id, c.ref, c.windowEndsAt).refused.code).toBe("window-closed");
    const cured = cureCase(owner.id, c.ref, c.filedAt + H);
    expect(cured.case).toMatchObject({ state: "closed", ruling: { outcome: "cured", amount: c.amountClaimed } });
    expect(renter.credits() - r0).toBe(c.amountClaimed + 1_000);
    expect(o0 - owner.credits()).toBe(c.amountClaimed); // what the respondent loses is what the claimant gains, less its own fee back
    expect(contractRecord(offerId).frozenBy).toBeNull();
    expect(arbitrationTick(decideAt(caseRecordForTests(c.ref)))).toEqual([]); // nothing left to rule
  });

  it("fails closed: a rule that cannot be evaluated leaves the case pending, with an alert, and moves nothing", async () => {
    const { owner, renter, offerId, c } = await hired(true);
    const before = [renter.credits(), owner.credits(), feeSink()];
    mutateState((draft) => { draft.market.mercenaryOffers = draft.market.mercenaryOffers.filter((o) => o.id !== offerId); });
    expect(arbitrationTick(decideAt(caseRecordForTests(c.ref)))).toEqual([]);
    expect(caseRecordForTests(c.ref)).toMatchObject({ state: "answering", ruling: null, alert: expect.stringContaining("could not be evaluated") });
    expect([renter.credits(), owner.credits(), feeSink()]).toEqual(before);
  });
});

describe("tariff-overcharge rulings (AB#938)", () => {
  async function tariffCase(overcharge) {
    const T = Date.now();
    const holder = await corp({ systemId: "alpha-centauri", stationId: "centauri-prime-station" });
    const rival = await corp({ systemId: "alpha-centauri", stationId: "centauri-prime-station" });
    const seller = await corp({ systemId: "alpha-centauri", stationId: "centauri-prime-station", set: (c) => { c.inventory = { "centauri-prime-station": { Silicates: 2_000 } }; } });
    readings("alpha-centauri", [[holder.holder, 0.6], [rival.holder, 0.2]], T - 151 * H);
    petitionConcession(holder.id, "alpha-centauri", T - 150 * H);
    readings("alpha-centauri", [[holder.holder, 0.6], [rival.holder, 0.2]], T - 79 * H);
    reviewConcessions(T - 78 * H);
    setTariff(holder.corp(), "alpha-centauri", 3, T - 77 * H);
    setTariff(holder.corp(), "alpha-centauri", 2, T - 2 * H);
    const order = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    const traded = (await seller.api.post(`/api/market/npc-orders/${order.id}/sell`).send({ quantity: 1_000 })).body.traded;
    // a settlement defect, staged: the record says 3% was charged when 2% was in force
    if (overcharge) mutateAccountState(seller.id, (s) => { s.corp.tradeHistory[0].tariffRecord.pct = 3; }, { sanitize: false, settleMining: false });
    const filed = fileCase(seller.id, { type: "tariff-overcharge", recordId: seller.corp().tradeHistory[0].id });
    expect(filed.refused).toBeUndefined();
    return { holder, seller, traded, c: filed.case };
  }
  const accrued = (holder) => tariffSummary(holder.corp()).holdings.find((h) => h.systemId === "alpha-centauri")?.accrued || 0;

  it("upheld: the excess is repaid from the ISA's levy share and the holder's unpaid tariff revenue; value is conserved", async () => {
    const { holder, seller, traded, c } = await tariffCase(true);
    const excess = Math.round(traded.total / 100);
    const [s0, a0, l0] = [seller.credits(), accrued(holder), levyTotal()];
    arbitrationTick(decideAt(caseRecordForTests(c.ref)));
    const ruled = caseRecordForTests(c.ref);
    expect(ruled).toMatchObject({ state: "closed", ruling: { outcome: "upheld", amount: excess }, paid: excess });
    const fromLevy = l0 - levyTotal(), fromHolder = a0 - accrued(holder);
    expect(fromLevy + fromHolder).toBe(excess); // what the respondents lose is what the claimant gains
    expect(fromLevy).toBe(Math.round((excess * ruled.evidence.settlement.levy) / ruled.evidence.settlement.amount));
    expect(seller.credits()).toBe(s0 + excess + 1_000); // the award, and the fee back
  });

  it("dismissed: the lawful rate was charged", async () => {
    const { seller, c } = await tariffCase(false);
    const [s0, sink0] = [seller.credits(), feeSink()];
    arbitrationTick(decideAt(caseRecordForTests(c.ref)));
    expect(caseRecordForTests(c.ref).ruling).toMatchObject({ outcome: "dismissed", amount: 0 });
    expect([seller.credits(), feeSink()]).toEqual([s0, sink0 + 1_000]);
  });
});

describe("patent-royalty rulings, and a Council debt collected from later sales (AB#938)", () => {
  let earlier = 0; // each holder completed before every corporation an earlier test made, so it is the first (the accounts persist)
  async function patentCase() {
    const now = Date.now();
    const holder = await corp({ set: (c) => { c.chainFirstRunAt = { "pressure-vessel-chain": now - 60 * H - (++earlier) * 60_000 }; } });
    const pat = filePatent(holder.id, { kind: "chain", subjectId: "pressure-vessel-chain", ratePct: 4 }).patent;
    expect(pat).toBeTruthy();
    const user = await corp({ set: (c) => { c.inventory = { [EARTH]: { Silicates: 5_000 } }; } });
    const at = now + H;
    mutateAccountState(user.id, (s) => {
      s.corp.refineries = [{ id: "ref-1", name: "Refinery #1", tier: 1, active: true, chainId: "pressure-vessel-chain", stationId: EARTH, cycleScale: 10, startedAt: at - 60 * H, lastTickAt: at - 60 * H, endsAt: at, cyclesCompleted: 0, totalInputConsumed: 0, totalOutputProduced: 0, inputs: [], outputs: [{ item: "Pressure Vessels", quantity: 250 }] }];
      applyRefineryOperations(s.corp, at + 1);
    }, { sanitize: false, settleMining: false });
    patentTick(at);
    const filed = fileCase(holder.id, { type: "patent-royalty", recordId: `${pat.id}~${user.holder.id}` });
    expect(filed.refused).toBeUndefined();
    return { holder, user, c: filed.case };
  }

  it("dismissed: every use was charged at the patent's rate", async () => {
    const { c } = await patentCase();
    arbitrationTick(decideAt(caseRecordForTests(c.ref)));
    expect(caseRecordForTests(c.ref).ruling).toMatchObject({ outcome: "dismissed", amount: 0 });
  });

  it("upheld: a shortfall the user's ISA income cannot cover becomes a Council debt, withheld inside the ITC's 50% and passed on to the holder", async () => {
    const { holder, user, c } = await patentCase();
    // a settlement defect, staged in the stored evidence: the use recorded 290 credits less than the rate owed
    const stored = caseRecordForTests(c.ref);
    Object.assign(stored.evidence, { recorded: stored.evidence.due - 290, shortfall: 290 });
    const [h0, u0] = [holder.credits(), user.credits()];
    arbitrationTick(decideAt(stored));
    const ruled = caseRecordForTests(c.ref);
    expect(ruled).toMatchObject({ state: "enforcing", ruling: { outcome: "upheld", amount: 290 }, debts: [expect.objectContaining({ owed: 290 })] });
    expect(user.corp().councilDebts).toEqual([expect.objectContaining({ caseRef: c.ref, owed: 290, collected: 0 })]);
    expect(holder.credits()).toBe(h0 + 1_000); // only the fee back so far
    // the user sells 100 Silicates: half the net is withheld (no ITC duty owed), up to the debt
    const order = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    const sold = (await user.api.post(`/api/market/npc-orders/${order.id}/sell`).send({ quantity: 100 })).body.traded;
    const net = sold.total - sold.taxAmount;
    const withheld = Math.min(290, Math.floor(net / 2));
    expect(sold.councilWithheld).toBe(withheld);
    expect(sold.proceeds).toBe(net - withheld);
    arbitrationTick(decideAt(stored) + H);
    expect(holder.credits()).toBe(h0 + 1_000 + withheld); // passed on at the next tick
    // enough sales to pay it off; then the case closes and the debt is gone
    for (let i = 0; i < 4 && user.corp().councilDebts?.length && user.corp().councilDebts[0].owed > 0; i += 1) await user.api.post(`/api/market/npc-orders/${order.id}/sell`).send({ quantity: 100 });
    arbitrationTick(decideAt(stored) + 2 * H);
    expect(caseRecordForTests(c.ref)).toMatchObject({ state: "closed", paid: 290 });
    expect(user.corp().councilDebts).toEqual([]);
    expect(holder.credits()).toBe(h0 + 1_000 + 290);
    expect(u0 - user.credits()).toBeLessThan(0); // the user still netted from its sales; it paid 290 of their proceeds
  });
});

describe("concession-arbitrated rulings (AB#938)", () => {
  async function contested() {
    const T = Date.now();
    const a = await corp({ systemId: "wolf-359", stationId: "halo-anchorage" });
    const b = await corp({ systemId: "wolf-359", stationId: "halo-anchorage" });
    readings("wolf-359", [[a.holder, 0.6], [b.holder, 0.2]], T - H);
    petitionConcession(a.id, "wolf-359", T);
    resetControlHistory();
    readings("wolf-359", [[b.holder, 0.6], [a.holder, 0.2]], T);
    petitionConcession(b.id, "wolf-359", T + H);
    const petitionId = concessionRecordForTests("wolf-359").petitions.find((p) => p.holder.id === a.holder.id).id;
    const filed = fileCase(a.id, { type: "concession-arbitrated", recordId: petitionId }, T + 2 * H);
    expect(filed.refused).toBeUndefined();
    return { a, b, c: filed.case, T };
  }

  it("upheld: at the review's end the readings favour the claimant, and the Council grants it; the ordinary review left it alone", async () => {
    const { a, c, T } = await contested();
    reviewConcessions(T + 8 * DAY); // the ISA's own review does not decide a petition before the Council
    expect(concessionRecordForTests("wolf-359").petitions.every((p) => p.state === "open")).toBe(true);
    const when = decideAt(caseRecordForTests(c.ref));
    expect(when).toBeGreaterThanOrEqual(c.evidence.petition.reviewEndsAt); // after the 7-day review, not the 72-hour window
    resetControlHistory();
    readings("wolf-359", [[a.holder, 0.6], [{ type: "corp", id: "corp-other", name: "Other" }, 0.2]], when - H);
    const sink0 = feeSink();
    arbitrationTick(when);
    expect(caseRecordForTests(c.ref)).toMatchObject({ state: "closed", ruling: { outcome: "upheld", order: "granted" } });
    expect(publicConcession("wolf-359", when).holders.map((h) => h.holder.id)).toEqual([a.holder.id]);
    expect(feeSink()).toBe(sink0 + W.concessionPetitionFee); // the petition fee, kept as everywhere
  });

  it("dismissed: the readings favour the respondent, who is granted instead", async () => {
    const { b, c } = await contested();
    const when = decideAt(caseRecordForTests(c.ref));
    resetControlHistory();
    readings("wolf-359", [[b.holder, 0.6], [{ type: "corp", id: "corp-other", name: "Other" }, 0.2]], when - H);
    arbitrationTick(when);
    expect(caseRecordForTests(c.ref)).toMatchObject({ state: "closed", ruling: { outcome: "dismissed", order: "not granted" } });
    expect(publicConcession("wolf-359", when).holders.map((h) => h.holder.id)).toEqual([b.holder.id]);
  });

  it("stays pending while the readings are stale: nothing is decided on data that cannot be read", async () => {
    const { c } = await contested();
    const when = decideAt(caseRecordForTests(c.ref));
    resetControlHistory();
    arbitrationTick(when);
    expect(caseRecordForTests(c.ref).state).toBe("answering");
    expect(concessionRecordForTests("wolf-359").petitions.every((p) => p.state === "open")).toBe(true);
  });
});

describe("credit-default (AB#938)", () => {
  it("is closed at the next tick with no remedy beyond the recovery's own; a case with no shortfall closes the same way", async () => {
    const { docketDefault } = await import("../../server/arbitration.js");
    const debtor = await corp({ credits: 0 });
    const withShortfall = docketDefault({ kind: "loan", id: "loan-x1", debtorAccountId: debtor.id, owedBefore: 22_000, collected: 2_000, shortfall: 20_000 });
    const without = docketDefault({ kind: "loan", id: "loan-x2", debtorAccountId: debtor.id, owedBefore: 22_000, collected: 22_000, shortfall: 0 });
    const credits = debtor.credits();
    arbitrationTick(Date.now());
    expect(caseRecordForTests(withShortfall.ref)).toMatchObject({ state: "closed", ruling: { outcome: "upheld", amount: 20_000 } });
    expect(caseRecordForTests(without.ref)).toMatchObject({ state: "closed", ruling: { outcome: "upheld", amount: 0 } });
    expect(debtor.credits()).toBe(credits);
    expect(debtor.corp().councilDebts || []).toEqual([]); // the shortfall stays owed on the loan, not twice
  });
});

describe("the cure route (AB#938)", () => {
  it("takes the case from the path and the respondent from the token", async () => {
    const { owner, renter, c } = await hired(true);
    expect((await renter.api.post(`/api/accounts/${renter.id}/arbitration/cases/${c.ref}/cure`).send({})).status).toBe(403);
    expect((await owner.api.post(`/api/accounts/${renter.id}/arbitration/cases/${c.ref}/cure`).send({})).status).toBe(403); // not its account
    const res = await owner.api.post(`/api/accounts/${owner.id}/arbitration/cases/${c.ref}/cure`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.case.ruling.outcome).toBe("cured");
  });
});
