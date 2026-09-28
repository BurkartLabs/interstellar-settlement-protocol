import { describe, it, expect, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { applyRefineryOperations, getAccountById, getState, listAccountNotifications, mutateAccountState } from "../../server/gameState.js";
import { recordControlDay, resetControlHistory } from "../../server/controlService.js";
import { concessionRecordForTests, petitionConcession, resetConcessions, reviewConcessions } from "../../server/concessions.js";
import { resetTariffs, setTariff } from "../../server/tariffService.js";
import { filePatent, patentTick, resetPatentsForTests } from "../../server/patents.js";
import { contractRecord, settleContracts } from "../../server/mercenaries.js";
import { postLoanOffer, acceptLoanOffer } from "../../server/playerLoans.js";
import { recoverDefault } from "../../server/defaultRecovery.js";
import { fileCase, resetArbitration } from "../../server/arbitration.js";
import { WARFARE_CATALOG as W } from "../../server/warfare.js";

// ISP-241 (AB#937; docs/design/WARFARE.md, "The Galactic Arbitration Council"): filing a case of each claim type on a
// server record the claimant is party to, the respondent derived from the record and the evidence from the claim type's
// query; the public docket; and every refusal leaving nothing written and nothing charged.
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
  const api = authed(app, accessToken);
  return {
    id: account.id, api, corp: c, credits: () => c().finances.credits,
    holder: { type: "corp", id: c().publicId, name: c().corporationName },
    file: (body) => api.post(`/api/accounts/${account.id}/arbitration/cases`).send(body),
    records: (type) => api.get(`/api/accounts/${account.id}/arbitration/records/${type}`)
  };
}
const docket = async () => (await request(app).get("/api/arbitration/docket")).body.cases;
function readings(systemId, rows, newestAt) {
  for (let i = 13; i >= 0; i -= 1) recordControlDay({ computedAt: newestAt - i * DAY, holders: { [systemId]: { live: ["extraction", "leases"], groups: rows.map(([h, s]) => ({ type: h.type, id: h.id, name: h.name, parts: { extraction: s, leases: s, sales: 0 } })) } } });
}

describe("mercenary-readiness (AB#937)", () => {
  it("the renter files on a hired contract: the owner is the respondent, the refund is WARFARE.md's rule on the owner's readiness, and the escrow is frozen", async () => {
    const owner = await corp({ set: (c) => { c.military = { units: { lf: 10, ds: 2 } }; } });
    const renter = await corp();
    const at = (who, p) => `/api/accounts/${who.id}/gameplay${p}`;
    const fleetId = (await owner.api.post(at(owner, "/fleets/form")).send({ lf: 8, ds: 2, name: "Corsair" })).body.fleet.id;
    const offerId = (await owner.api.post(at(owner, "/mercenaries/offer")).send({ fleetId, termHours: 24, price: 5_000, collateral: 15_000, allowedUse: "defense" })).body.offer.id;
    expect((await renter.api.post(at(renter, `/mercenaries/${offerId}/hire`)).send({})).status).toBe(200);
    const contract = contractRecord(offerId);
    expect(contract.hireReadiness).toBe(100); // the readiness shown at hire, kept on the contract
    // the owner's upkeep goes unpaid: readiness 80 from the 2nd hour, 70 from the 6th (the log settleUpkeep writes)
    mutateAccountState(owner.id, (s) => { s.corp.military.readinessLog = [{ at: contract.hiredAt, readiness: 100 }, { at: contract.hiredAt + 2 * H, readiness: 80 }, { at: contract.hiredAt + 6 * H, readiness: 70 }]; }, { sanitize: false, settleMining: false });
    const credits = renter.credits();
    const r = fileCase(renter.id, { type: "mercenary-readiness", recordId: offerId }, contract.hiredAt + 10 * H);
    expect(r.refused).toBeUndefined();
    expect(r.case).toMatchObject({ type: "mercenary-readiness", state: "answering", respondent: { type: "corp", id: owner.holder.id }, claimant: { id: renter.holder.id }, feePaid: 1_000 });
    expect(r.case.evidence.hourlyReadiness).toEqual([100, 100, 80, 80, 80, 80, 70, 70, 70, 70]); // at the start of each hour
    expect(r.case.amountClaimed).toBe(Math.round((5_000 * (4 * 0.2 + 4 * 0.3)) / 24)); // 417
    expect(r.case.ref).toMatch(/^ARB-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/); // ISP-249 (AB#945): the reference format, opaque
    expect(renter.credits()).toBe(credits - 1_000); // the fee, held until the ruling
    expect(listAccountNotifications(owner.id).notifications.some((n) => n.title === "Galactic Arbitration Council: case filed" && n.body.includes(r.case.ref))).toBe(true);
    // the escrow is frozen: the term ends and nothing is released
    const ownerCredits = owner.credits();
    settleContracts(contract.endsAt + H);
    expect(contractRecord(offerId)).toMatchObject({ state: "hired", frozenBy: r.case.ref });
    expect(owner.credits()).toBe(ownerCredits);
    // one case per record
    expect(fileCase(renter.id, { type: "mercenary-readiness", recordId: offerId }, contract.hiredAt + 11 * H).refused.code).toBe("duplicate");
  });
});

describe("tariff-overcharge (AB#937)", () => {
  async function tariffWorld() {
    const T = Date.now();
    const holder = await corp({ systemId: "alpha-centauri", stationId: "centauri-prime-station" });
    const rival = await corp({ systemId: "alpha-centauri", stationId: "centauri-prime-station" });
    const seller = await corp({ systemId: "alpha-centauri", stationId: "centauri-prime-station", set: (c) => { c.inventory = { "centauri-prime-station": { Silicates: 2_000 } }; } });
    readings("alpha-centauri", [[holder.holder, 0.6], [rival.holder, 0.2]], T - 151 * H);
    expect(petitionConcession(holder.id, "alpha-centauri", T - 150 * H).refused).toBeUndefined();
    readings("alpha-centauri", [[holder.holder, 0.6], [rival.holder, 0.2]], T - 79 * H);
    reviewConcessions(T - 78 * H);
    expect(setTariff(holder.corp(), "alpha-centauri", 3, T - 77 * H).ok).toBe(true); // an increase: in force 72h later
    expect(setTariff(holder.corp(), "alpha-centauri", 2, T - 2 * H).ok).toBe(true); // a cut: at once
    const order = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    const sell = async (q) => (await seller.api.post(`/api/market/npc-orders/${order.id}/sell`).send({ quantity: q })).body.traded;
    return { holder, seller, sell };
  }

  it("the seller files on a sale that paid a tariff: the holder is the respondent, the evidence the settlement and the rate history", async () => {
    const { holder, seller, sell } = await tariffWorld();
    const traded = await sell(1_000);
    expect(traded.tariffPct).toBe(2);
    const listed = (await seller.records("tariff-overcharge")).body.records;
    expect(listed).toHaveLength(1);
    const res = await seller.file({ type: "tariff-overcharge", recordId: listed[0].recordId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.case).toMatchObject({ respondent: { type: "corp", id: holder.holder.id, name: holder.holder.name }, amountClaimed: 0, feePaid: 1_000 });
    expect(res.body.case.evidence).toMatchObject({ settlement: { kind: "sale", chargedPct: 2, base: traded.total, amount: traded.tariffAmount, stationId: "centauri-prime-station" }, lawfulPct: 2, excess: 0, capPct: 3 });
    expect(res.body.case.evidence.holders).toEqual([expect.objectContaining({ holder: { type: "corp", id: holder.holder.id }, ratePct: 2, stateAt: "granted" })]);
    expect((await seller.records("tariff-overcharge")).body.records).toEqual([]); // no second case on it
  });

  it("finds an overcharge the settlement should have prevented: the excess is (charged - lawful) x base", async () => {
    const { seller, sell } = await tariffWorld();
    const traded = await sell(1_000);
    // a settlement bug, simulated: the record says 3% was charged when the rate in force was 2%
    const row = seller.corp().tradeHistory[0];
    mutateAccountState(seller.id, (s) => { s.corp.tradeHistory[0].tariffRecord.pct = 3; }, { sanitize: false, settleMining: false });
    const r = fileCase(seller.id, { type: "tariff-overcharge", recordId: row.id });
    expect(r.case.evidence).toMatchObject({ lawfulPct: 2, excess: Math.round(traded.total / 100) });
    expect(r.case.amountClaimed).toBe(Math.round(traded.total / 100));
  });
});

describe("concession-arbitrated (AB#937)", () => {
  it("a petitioner in an arbitrated system files against the counter-petitioner, at the petition fee, with both parties' control readings", async () => {
    const T = Date.now();
    const a = await corp({ systemId: "wolf-359", stationId: "halo-anchorage" });
    const b = await corp({ systemId: "wolf-359", stationId: "halo-anchorage" });
    readings("wolf-359", [[a.holder, 0.6], [b.holder, 0.2]], T - H);
    expect(petitionConcession(a.id, "wolf-359", T).refused).toBeUndefined();
    const petitionId = (await a.records("concession-arbitrated")).body.records[0].recordId;
    expect(fileCase(a.id, { type: "concession-arbitrated", recordId: petitionId }, T).refused.code).toBe("no-other-party"); // uncontested
    // the readings turn: B is eligible now, and counter-petitions within A's 7-day review
    resetControlHistory();
    readings("wolf-359", [[b.holder, 0.6], [a.holder, 0.2]], T);
    expect(petitionConcession(b.id, "wolf-359", T + H).refused).toBeUndefined();
    const credits = a.credits();
    const r = fileCase(a.id, { type: "concession-arbitrated", recordId: petitionId }, T + 2 * H);
    expect(r.refused).toBeUndefined();
    expect(r.case).toMatchObject({ respondent: { id: b.holder.id }, feePaid: W.concessionPetitionFee, amountClaimed: 0 });
    expect(r.case.evidence).toMatchObject({ systemId: "wolf-359", claimant: { holder: { id: a.holder.id }, score: 0.2, eligible: false }, respondent: { holder: { id: b.holder.id }, score: 0.6, eligible: true } });
    expect(a.credits()).toBe(credits - W.concessionPetitionFee);
  });

  it("refuses a petition in a system the ISA decides alone", async () => {
    const T = Date.now();
    const a = await corp({ systemId: "barnards-star", stationId: "ironwell-depot" });
    const b = await corp({ systemId: "barnards-star", stationId: "ironwell-depot" });
    readings("barnards-star", [[a.holder, 0.6], [b.holder, 0.2]], T - H);
    const p = petitionConcession(a.id, "barnards-star", T);
    expect(p.refused, JSON.stringify(p.refused)).toBeUndefined();
    expect(fileCase(a.id, { type: "concession-arbitrated", recordId: concessionRecordForTests("barnards-star").petitions[0].id }, T).refused.code).toBe("not-arbitrated");
  });
});

describe("patent-royalty (AB#937)", () => {
  it("the holder files on a corporation's recorded uses: the user is the respondent, the evidence each use and what it paid", async () => {
    const now = Date.now();
    const holder = await corp({ set: (c) => { c.chainFirstRunAt = { "pressure-vessel-chain": now - 5 * H }; } });
    expect(filePatent(holder.id, { kind: "chain", subjectId: "pressure-vessel-chain", ratePct: 4 }).patent).toBeTruthy();
    const user = await corp();
    const at = now + H;
    mutateAccountState(user.id, (s) => {
      s.corp.refineries = [{ id: "ref-1", name: "Refinery #1", tier: 1, active: true, chainId: "pressure-vessel-chain", stationId: EARTH, cycleScale: 10, startedAt: at - 60 * H, lastTickAt: at - 60 * H, endsAt: at, cyclesCompleted: 0, totalInputConsumed: 0, totalOutputProduced: 0, inputs: [], outputs: [{ item: "Pressure Vessels", quantity: 250 }] }];
      applyRefineryOperations(s.corp, at + 1);
    }, { sanitize: false, settleMining: false });
    patentTick(at);
    const listed = (await holder.records("patent-royalty")).body.records;
    expect(listed).toEqual([expect.objectContaining({ recordId: expect.stringContaining(`~${user.holder.id}`), user: user.holder.name })]);
    const res = await holder.file({ type: "patent-royalty", recordId: listed[0].recordId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.case).toMatchObject({ respondent: { id: user.holder.id }, amountClaimed: 0 });
    expect(res.body.case.evidence).toMatchObject({ uses: [expect.objectContaining({ base: 250 * 129, royalty: 1_290, paid: 1_290 })], due: 1_290, recorded: 1_290, shortfall: 0 });
    expect(fileCase(holder.id, { type: "patent-royalty", recordId: `${res.body.case.evidence.patent.id}~corp-nobody` }).refused.code).toBe("no-record");
  });
});

describe("credit-default (AB#937)", () => {
  it("the ISA dockets a default recovery itself, upheld with the recovery's result; no corporation files one", async () => {
    const lender = await corp({ credits: 100_000 }), debtor = await corp({ credits: 0 });
    const T0 = Date.now();
    const offer = postLoanOffer(lender.id, { principal: 20_000, ratePct30: 3, termDays: 30, minGrade: "NR-accepted" }, T0);
    const { loan } = acceptLoanOffer(debtor.id, offer.offer.id, T0);
    mutateAccountState(debtor.id, (s) => {
      Object.assign(s.corp.loans.find((x) => x.id === loan.id), { arrearsFees: 100, arrearsInterest: 400, arrearsPrincipal: 1_500, arrears: 2_000, balance: 20_000, state: "arrears", arrearsSince: T0, defaultedAt: T0 + 8 * DAY, nextDueAt: T0 + 400 * DAY });
      s.corp.finances.credits = 0; s.corp.inventory = {}; s.corp.miningLeases = [];
    }, { sanitize: false, settleMining: false });
    const r = recoverDefault(debtor.id, loan.id, T0 + 10 * DAY);
    const cases = await docket();
    expect(cases).toEqual([expect.objectContaining({ type: "credit-default", claimant: "Interstellar Settlement Authority", respondent: debtor.holder.name, state: "ruled", ruling: { outcome: "upheld", amount: r.shortfall, order: null } })]);
    recoverDefault(debtor.id, loan.id, T0 + 11 * DAY);
    expect(await docket()).toHaveLength(1); // once per record
    expect((await lender.file({ type: "credit-default", recordId: loan.id })).status).toBe(403);
  });
});

describe("filing's refusals and the public docket (AB#937)", () => {
  it("leaves nothing written and nothing charged: own side, an unknown record, no fee, unreadable evidence, a closed claim type", async () => {
    const seller = await corp();
    const row = { id: "th-arb-1", type: "sold-npc", item: "Silicates", quantity: 10, tariffPct: 2, tariffAmount: 5, at: Date.now(),
      tariffRecord: { pct: 2, amount: 5, base: 240, postedPct: null, stationId: "centauri-prime-station", systemId: "alpha-centauri", at: Date.now(), levy: 1, to: [{ type: "corp", id: seller.holder.id, share: 4 }] } };
    mutateAccountState(seller.id, (s) => { s.corp.tradeHistory = [row]; }, { sanitize: false, settleMining: false });
    const credits = seller.credits();
    const tries = [
      [{ type: "tariff-overcharge", recordId: "th-arb-1" }, 409, "no-evidence"], // no rate record for itself as holder
      [{ type: "tariff-overcharge", recordId: "th-nope" }, 404, "no-record"],
      [{ type: "mercenary-readiness", recordId: "merc-nope" }, 404, "no-record"],
      [{ type: "concession-arbitrated", recordId: "cpet-nope" }, 404, "no-record"]
    ];
    for (const [body, status, code] of tries) {
      const res = await seller.file(body);
      expect([res.status, res.body.code], JSON.stringify(body)).toEqual([status, code]);
    }
    // against itself: a record whose other party is the claimant
    const own = fileCase(seller.id, { type: "tariff-overcharge", recordId: "th-arb-1" });
    expect(own.refused.code).toBe("no-evidence");
    // unreadable evidence fails closed, before any fee
    accountsStore.accounts[seller.id].state.corp.tradeHistory = { find() { throw new Error("storage fault"); } };
    expect((await seller.file({ type: "tariff-overcharge", recordId: "th-arb-1" })).status).toBe(503);
    accountsStore.accounts[seller.id].state.corp.tradeHistory = [row];
    // a claim type the catalog has closed
    const pr = W.arbitration.claimTypes.find((t) => t.id === "patent-royalty");
    pr.open = false;
    try { expect((await seller.file({ type: "patent-royalty", recordId: "pat-x~corp-y" })).body.code).toBe("not-open"); } finally { pr.open = true; }
    // hostile input never reaches the Council: the claim type is one of the catalog's
    expect((await seller.file({ type: "anything", recordId: "th-arb-1" })).status).toBe(400);
    expect((await seller.file({ type: "tariff-overcharge" })).status).toBe(400);
    expect(seller.credits()).toBe(credits);
    expect(await docket()).toEqual([]);
  });

  it("refuses a claimant that cannot pay the fee, one filing against its own side, and a fourth open case against one respondent", async () => {
    const now = Date.now();
    const holder = await corp({ set: (c) => { c.chainFirstRunAt = { "pressure-vessel-chain": now - 50 * H }; } }); // before the other tests' holders
    const pat = filePatent(holder.id, { kind: "chain", subjectId: "pressure-vessel-chain", ratePct: 4 }).patent;
    const user = await corp();
    for (let i = 0; i < 4; i += 1) {
      const at = now + (i + 1) * H;
      mutateAccountState(user.id, (s) => {
        s.corp.refineries = [{ id: "ref-1", name: "Refinery #1", tier: 1, active: true, chainId: "pressure-vessel-chain", stationId: EARTH, cycleScale: 1, startedAt: at - 6 * H, lastTickAt: at - 6 * H, endsAt: at, cyclesCompleted: 0, totalInputConsumed: 0, totalOutputProduced: 0, inputs: [], outputs: [{ item: "Pressure Vessels", quantity: 25 }] }];
        applyRefineryOperations(s.corp, at + 1);
      }, { sanitize: false, settleMining: false });
      patentTick(at);
    }
    const recordId = `${pat.id}~${user.holder.id}`;
    mutateAccountState(holder.id, (s) => { s.corp.finances.credits = 10; }, { sanitize: false, settleMining: false });
    expect(fileCase(holder.id, { type: "patent-royalty", recordId }).refused.code).toBe("cannot-pay");
    expect(await docket()).toEqual([]);
    // the respondent on the claimant's own side: the claimant itself as the user (a conglomerate partner reads the same)
    const selfId = `${pat.id}~${holder.holder.id}`;
    expect(fileCase(holder.id, { type: "patent-royalty", recordId: selfId }).refused.code).toBe("no-record"); // the holder's own use owes nothing, so none is recorded
  });

  it("shows the public docket without evidence or ids, and the parties their evidence", async () => {
    const owner = await corp({ set: (c) => { c.military = { units: { lf: 10, ds: 2 } }; } });
    const renter = await corp();
    const at = (who, p) => `/api/accounts/${who.id}/gameplay${p}`;
    const fleetId = (await owner.api.post(at(owner, "/fleets/form")).send({ lf: 8, ds: 2, name: "Corsair" })).body.fleet.id;
    const offerId = (await owner.api.post(at(owner, "/mercenaries/offer")).send({ fleetId, termHours: 24, price: 5_000, collateral: 15_000, allowedUse: "defense" })).body.offer.id;
    await renter.api.post(at(renter, `/mercenaries/${offerId}/hire`)).send({});
    const filed = await renter.file({ type: "mercenary-readiness", recordId: offerId });
    expect(filed.status, JSON.stringify(filed.body)).toBe(201);
    const pub = await docket();
    expect(pub).toEqual([{ ref: filed.body.case.ref, type: "mercenary-readiness", claimant: renter.holder.name, respondent: owner.holder.name, state: "answering", ruling: null, paid: 0, amountClaimed: 0, filedAt: expect.any(Number), windowEndsAt: filed.body.case.filedAt + W.arbitration.responseHours * H }]);
    const text = JSON.stringify(pub);
    for (const secret of [renter.id, owner.id, renter.holder.id, owner.holder.id, offerId, "hourlyReadiness"]) expect(text).not.toContain(secret);
    for (const party of [renter, owner]) expect((await party.api.get(`/api/accounts/${party.id}/arbitration/cases`)).body.cases[0].evidence.hireReadiness).toBe(100);
    const outsider = await corp();
    expect((await outsider.api.get(`/api/accounts/${outsider.id}/arbitration/cases`)).body.cases).toEqual([]);
    expect((await outsider.api.get(`/api/accounts/${renter.id}/arbitration/cases`)).status).toBe(403); // the claimant is the token's
  });
});
