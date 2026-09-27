import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { RESEARCH_LIBRARY } from "../../server/game/catalog.js";
import { recordControlDay, resetControlHistory } from "../../server/controlService.js";
import { chargeUpkeep, concessionRecordForTests, leaseCostFor, petitionConcession, publicConcession, resetConcessions, setLeaseModifier } from "../../server/concessions.js";
import { paySeller } from "../../server/marketSettlement.js";
import { WARFARE_CATALOG as W } from "../../server/warfare.js";

// ISP-228 (AB#923): what a concession grants (docs/design/TERRITORY.md): the fee share on others' lease fees (and the
// lease royalty on sales at the system's station), booked in the holder's P&L; the holder's own 25% off; and the
// everyone-discount the holder sets within bounds, applying after its notice. Only while the concession is in force.
const H = 3_600_000, DAY = 24 * H;
const SYSTEM = "luyten-726-8", STATION = "twin-flare-outpost", BODY = "BL Ceti I"; // unregulated: granted at once
const BASE = 45_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });
afterEach(() => { resetConcessions(); resetControlHistory(); });

async function corp() {
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  const c = raw.state.corp;
  Object.assign(c, { currentSystemId: SYSTEM, currentStationId: STATION, employeeCount: 20, unlockedTech: Object.keys(RESEARCH_LIBRARY) });
  c.offices = [{ stationId: STATION, rentedUntil: Date.now() + 30 * DAY }];
  c.finances.credits = 1_000_000;
  return { id: reg.account.id, corp: c, holder: { type: "corp", id: c.publicId, name: c.corporationName }, api: authed(app, reg.accessToken), credits: () => Math.round(c.finances.credits) };
}
/** The holder holds Luyten's concession (eligible for 14 days, and granted at once there). */
async function holding() {
  const h = await corp();
  for (let i = 13; i >= 0; i -= 1) recordControlDay({ computedAt: Date.now() - H - i * DAY, holders: { [SYSTEM]: { live: ["extraction"], groups: [{ type: "corp", id: h.holder.id, name: h.holder.name, parts: { extraction: 0.8, leases: 0, sales: 0 } }] } } });
  expect(petitionConcession(h.id, SYSTEM).refused).toBeUndefined();
  return h;
}
const buy = (p) => p.api.post(`/api/accounts/${p.id}/gameplay/purchase-lease`).send({ body: BODY });
const shareIncome = (p) => Number(p.corp.finances.dayBook?.income?.["concession-fee-share"]) || 0;

describe("the fee share and the lease discount (AB#923)", () => {
  it("another corporation's lease pays the holder 20% of the fee, as concession-fee-share income in its P&L", async () => {
    const h = await holding(), lessee = await corp();
    const before = h.credits();
    const res = await buy(lessee);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(1_000_000 - lessee.credits()).toBe(BASE); // no discount set: the base fee
    expect(h.credits() - before).toBe((BASE * W.concessionFeeSharePct) / 100);
    expect(shareIncome(h)).toBe(9_000);
  });

  it("the holder's own lease is 25% off, and pays no share to itself", async () => {
    const h = await holding();
    const before = h.credits();
    const res = await buy(h);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(before - h.credits()).toBe(BASE * 0.75);
    expect(shareIncome(h)).toBe(0);
  });

  it("the everyone-discount applies only after its notice: the same lease before and after", async () => {
    const h = await holding(), early = await corp(), late = await corp();
    const set = await h.api.post(`/api/accounts/${h.id}/concessions/${SYSTEM}/lease-modifier`).send({ discountPct: 20 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.leaseModifier).toMatchObject({ pct: 0, pendingPct: 20 });
    await buy(early);
    expect(1_000_000 - early.credits()).toBe(BASE); // during the notice: the fee before
    concessionRecordForTests(SYSTEM).holders[0].leaseModifier.effectiveAt = Date.now() - 1; // the 72 hours have passed
    await buy(late);
    expect(1_000_000 - late.credits()).toBe(BASE * 0.8); // after it: the modified fee
    expect(publicConcession(SYSTEM).holders[0].leaseDiscountPct).toBe(20);
  });

  it("refuses a change during an active notice, a value out of bounds, and anyone but the holder", async () => {
    const h = await holding(), other = await corp();
    const url = (p) => `/api/accounts/${p.id}/concessions/${SYSTEM}/lease-modifier`;
    expect((await h.api.post(url(h)).send({ discountPct: W.concessionLeaseModifierMaxPct + 1 })).status).toBe(400);
    expect((await h.api.post(url(h)).send({ discountPct: -5 })).status).toBe(400);
    expect((await h.api.post(url(h)).send({ discountPct: "lots" })).status).toBe(400);
    expect((await h.api.post(url(h)).send({ discountPct: 10 })).status).toBe(200);
    expect((await h.api.post(url(h)).send({ discountPct: 5 })).body.code).toBe("notice-period");
    expect((await other.api.post(url(other)).send({ discountPct: 10 })).status).toBe(404); // holds nothing
    expect(setLeaseModifier(other.id, SYSTEM, 10).refused.code).toBe("not-held");
  });

  it("an invalid stored discount reads as none: the base fee (fails closed)", async () => {
    const h = await holding(), lessee = await corp();
    concessionRecordForTests(SYSTEM).holders[0].leaseModifier = { pct: 90, pendingPct: null, effectiveAt: 0 };
    expect(leaseCostFor(SYSTEM, lessee.corp, BASE).cost).toBe(BASE);
    concessionRecordForTests(SYSTEM).holders[0].leaseModifier = { pct: "free" };
    expect(leaseCostFor(SYSTEM, lessee.corp, BASE).cost).toBe(BASE);
    expect(leaseCostFor(SYSTEM, h.corp, BASE).cost).toBe(BASE * 0.75); // the holder's own discount is the catalog's, not stored
  });

  it("a concession in grace grants nothing: the base fee and no share", async () => {
    const h = await holding(), lessee = await corp();
    h.corp.finances.credits = 0;
    chargeUpkeep(Date.now() + DAY);
    expect(publicConcession(SYSTEM).holders[0].state).toBe("grace");
    await buy(lessee);
    expect(1_000_000 - lessee.credits()).toBe(BASE);
    expect(h.credits()).toBe(0);
  });

  it("the lease royalty on a sale settled at the system's station pays the holder its share too", async () => {
    const h = await holding(), seller = await corp();
    seller.corp.miningLeases = [{ id: "l1", body: "Earth" }, { id: "l2", body: "Mars" }]; // two leases: 1 royalty point
    const before = h.credits();
    paySeller({ sellerAccountId: seller.id, stationId: STATION, item: "Nickel", unitPrice: 1_000 }, 10, "A buyer");
    expect(h.credits() - before).toBe(Math.floor((10_000 * 0.01 * W.concessionFeeSharePct) / 100)); // 1% of 10,000, then 20%
  });
});
