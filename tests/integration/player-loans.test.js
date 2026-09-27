import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState, mutateState, getState, listAccountNotifications } from "../../server/gameState.js";
import { postLoanOffer, cancelLoanOffer, acceptLoanOffer, listLoanOffers, pairPrincipal, OFFER_RULES } from "../../server/playerLoans.js";
import { loanServicingTick, paymentParts, PLAYER_DEFAULT_DAYS } from "../../server/loanServicing.js";
import { ledgerEntries } from "../../server/settlement.js";

// ISP-152 (AB#846): player-to-player loans (docs/design/v0.9-debt.md, sections 1, 6, 10, 11). Time is injected
// (P-TEST-TIME). New corporations are unrated, so offers here are open to them with NR-accepted unless a test says not.
const DAY = 86_400_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });

async function corp(credits = 500_000) {
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => { s.corp.finances.credits = credits; }, { sanitize: false, settleMining: false });
  const c = () => getAccountById(account.id).state.corp;
  return { id: account.id, api: authed(app, accessToken), base: `/api/accounts/${account.id}`, corp: c, credits: () => Math.round(c().finances.credits) };
}
const escrowOf = (offerId) => Math.round(Number(getState().settlement?.escrow?.[`escrow:loan-offer-${offerId}`]) || 0);
const offer = (lender, over = {}, now = Date.now()) =>
  postLoanOffer(lender.id, { principal: 10_000, ratePct30: 3, termDays: 30, minGrade: "NR-accepted", ...over }, now);

describe("posting and cancelling an offer", () => {
  it("holds the principal in escrow when posted, and releases it on cancel", async () => {
    const a = await corp(50_000);
    const r = offer(a, { principal: 20_000 });
    expect(r.ok).toBe(true);
    expect(a.credits()).toBe(30_000);
    expect(escrowOf(r.offer.id)).toBe(20_000);
    expect(ledgerEntries().some((e) => e.key === `loan-offer:${r.offer.id}:hold` && e.reason === "escrow-hold")).toBe(true);
    expect(cancelLoanOffer(a.id, r.offer.id, Date.now()).ok).toBe(true);
    expect(a.credits()).toBe(50_000);
    expect(escrowOf(r.offer.id)).toBe(0);
  });

  it("has only numbers and enums: free text in the request is not stored, and no account id is shown", async () => {
    const a = await corp();
    const res = await a.api.post(`${a.base}/loan-offers`).send({ principal: 5_000, ratePct30: 2.5, termDays: 7, minGrade: "NR-accepted", note: "<b>hello</b>" });
    expect(res.status).toBe(201);
    const stored = getState().market.loanOffers.find((o) => o.id === res.body.offer.id);
    expect(Object.keys(stored).sort()).toEqual(["escrowKey", "expiresAt", "id", "lenderCorpId", "minGrade", "postedAt", "principal", "ratePct30", "state", "termDays"]);
    const list = await a.api.get(`${a.base}/loan-offers`);
    expect(JSON.stringify(list.body)).not.toContain(a.id);
    expect(list.body.offers.find((o) => o.id === res.body.offer.id)).toMatchObject({ principal: 5_000, ratePct30: 2.5, termDays: 7, mine: true });
  });

  it("refuses a 0% loan, and anything under the 2% floor, between two fixture accounts; nothing moves", async () => {
    const a = await corp(), b = await corp();
    const before = [a.credits(), b.credits()];
    for (const ratePct30 of [0, 1, 1.75, 2.1]) expect(offer(a, { ratePct30 }).ok).toBe(false);
    expect((await a.api.post(`${a.base}/loan-offers`).send({ principal: 5_000, ratePct30: 0, termDays: 30, minGrade: "NR-accepted" })).status).toBe(400);
    expect([a.credits(), b.credits()]).toEqual(before);
    expect(offer(a, { ratePct30: 2 }).ok).toBe(true); // the floor itself is allowed
  });
});

describe("accepting an offer", () => {
  it("releases the escrow to the borrower, takes the 0.5% fee, and writes the loan with the lender as counterparty", async () => {
    const a = await corp(100_000), b = await corp(1_000);
    const T0 = Date.now();
    const o = offer(a, { principal: 40_000, ratePct30: 4, termDays: 30 }, T0);
    const r = acceptLoanOffer(b.id, o.offer.id, T0);
    expect(r.ok).toBe(true);
    expect(b.credits()).toBe(1_000 + 40_000 - 200);
    expect(escrowOf(o.offer.id)).toBe(0);
    const loan = b.corp().loans.find((l) => l.id === r.loan.id);
    expect(loan).toMatchObject({ principal: 40_000, ratePct30: 4, termDays: 30, state: "active", lender: { kind: "player", corpId: a.corp().publicId } });
    expect(JSON.stringify(loan)).not.toContain(a.id); // no account id is stored in a loan (Bug #711/#1134)
    const res = await b.api.get(b.base);
    expect(JSON.stringify(res.body)).not.toContain(a.id); // nor in the borrower's account view
    expect(JSON.stringify(getState().market.loanOffers)).not.toContain(a.id); // nor in the offers the market carries
    expect(acceptLoanOffer(b.id, o.offer.id, T0).ok).toBe(false); // taken once
  });

  it("refuses self-dealing and moves nothing", async () => {
    const a = await corp();
    const o = offer(a);
    const before = a.credits();
    const r = acceptLoanOffer(a.id, o.offer.id, Date.now());
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/cannot borrow from itself/) });
    expect(a.credits()).toBe(before);
    expect(escrowOf(o.offer.id)).toBe(10_000);
  });

  it("refuses a borrower below the offer's grade: an unrated corporation needs NR-accepted", async () => {
    const a = await corp(), b = await corp();
    const o = offer(a, { minGrade: "BBB" });
    expect(acceptLoanOffer(b.id, o.offer.id, Date.now())).toMatchObject({ ok: false, error: expect.stringMatching(/grade of BBB/) });
  });

  it("moves nothing on a stale offer (expired or cancelled) or one whose escrow is gone", async () => {
    const a = await corp(100_000), b = await corp(0);
    const T0 = Date.now();
    const old = offer(a, {}, T0);
    const late = acceptLoanOffer(b.id, old.offer.id, T0 + OFFER_RULES.expiryDays * DAY + 1);
    expect(late.ok).toBe(false);
    expect(b.credits()).toBe(0);
    expect(escrowOf(old.offer.id)).toBe(0); // expiry released it back to the lender
    const gone = offer(a, {}, T0);
    mutateState((d) => { d.settlement.escrow[`escrow:loan-offer-${gone.offer.id}`] = 0; }); // the escrow vanished
    expect(acceptLoanOffer(b.id, gone.offer.id, T0)).toMatchObject({ ok: false, error: expect.stringMatching(/escrow no longer holds/) });
    expect(b.credits()).toBe(0);
    const cancelled = offer(a, {}, T0);
    cancelLoanOffer(a.id, cancelled.offer.id, T0);
    expect(acceptLoanOffer(b.id, cancelled.offer.id, T0).ok).toBe(false);
    expect(b.credits()).toBe(0);
  });
});

describe("the per-pair cap: 100,000 principal per rolling 30 days, both directions", () => {
  it("refuses an accept that would pass it, in either direction, and allows it again after 30 days", async () => {
    const a = await corp(300_000), b = await corp(300_000);
    const T0 = Date.now();
    expect(acceptLoanOffer(b.id, offer(a, { principal: 60_000 }, T0).offer.id, T0).ok).toBe(true);
    const second = offer(a, { principal: 50_000 }, T0);
    expect(acceptLoanOffer(b.id, second.offer.id, T0)).toMatchObject({ ok: false, error: expect.stringMatching(/at most 100,000/) });
    const reverse = offer(b, { principal: 50_000 }, T0);
    expect(acceptLoanOffer(a.id, reverse.offer.id, T0).ok).toBe(false); // the other direction counts too
    expect(acceptLoanOffer(a.id, offer(b, { principal: 40_000 }, T0).offer.id, T0).ok).toBe(true); // exactly to the cap
    const later = T0 + 31 * DAY;
    expect(acceptLoanOffer(b.id, offer(a, { principal: 50_000 }, later).offer.id, later).ok).toBe(true);
  });

  it("anti-abuse probe: no sequence of offers, cancels and accepts moves more than the cap between two bots in 30 days", async () => {
    const a = await corp(10_000_000), b = await corp(10_000_000);
    let seed = 846;
    const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296; };
    const T0 = Date.now();
    const accepted = []; // { at, principal }
    const open = [];
    for (let step = 0; step < 400; step++) {
      const now = T0 + Math.floor(step * (45 * DAY) / 400); // 45 days of activity
      const [lender, borrower] = rand() < 0.5 ? [a, b] : [b, a];
      const roll = rand();
      if (roll < 0.45) {
        const principal = 1_000 + Math.floor(rand() * 99) * 1_000;
        const r = offer(lender, { principal, ratePct30: 2 + Math.floor(rand() * 8) * 0.25 }, now);
        if (r.ok) open.push({ id: r.offer.id, lender, principal });
      } else if (roll < 0.9 && open.length) {
        const o = open.splice(Math.floor(rand() * open.length), 1)[0];
        const taker = o.lender === a ? b : a;
        const r = acceptLoanOffer(taker.id, o.id, now);
        if (r.ok) accepted.push({ at: now, principal: o.principal });
      } else if (open.length) {
        const o = open.splice(Math.floor(rand() * open.length), 1)[0];
        cancelLoanOffer(o.lender.id, o.id, now);
      }
      // the invariant, checked after every step: principal accepted in the last 30 days never passes the cap
      const window = accepted.filter((x) => x.at > now - 30 * DAY).reduce((s, x) => s + x.principal, 0);
      expect(window).toBeLessThanOrEqual(OFFER_RULES.pairCapPrincipal);
      expect(pairPrincipal(a.id, b.id, now)).toBe(window);
    }
    expect(accepted.length).toBeGreaterThan(2); // the probe did move credits, up to the cap
  }, 120_000); // 400 steps, each a synchronous ledger and snapshot write: past 20 s in a full parallel run
});

describe("servicing a player loan on the Development Bank's tick", () => {
  it("pays each day's payment to the lender, and marks default after 7 days in arrears, telling both sides", async () => {
    const a = await corp(100_000), b = await corp(0);
    const T0 = Date.now();
    const o = offer(a, { principal: 20_000, ratePct30: 3, termDays: 30 }, T0);
    const { loan } = acceptLoanOffer(b.id, o.offer.id, T0);
    const lenderBefore = a.credits();
    loanServicingTick(T0 + DAY);
    const first = paymentParts(b.corp().loans.find((l) => l.id === loan.id), 1);
    expect(a.credits()).toBe(lenderBefore + first.amount); // interest and principal both go to the lender
    // the borrower spends everything: payments are missed, and after 7 days the loan is in default
    mutateAccountState(b.id, (s) => { s.corp.finances.credits = 0; }, { sanitize: false, settleMining: false });
    for (let d = 2; d <= 2 + PLAYER_DEFAULT_DAYS + 1; d++) loanServicingTick(T0 + d * DAY);
    const after = b.corp().loans.find((l) => l.id === loan.id);
    expect(after.state).toBe("arrears");
    expect(after.defaultedAt).toBeGreaterThan(0);
    expect(listAccountNotifications(a.id).notifications.some((n) => n.title === "A loan is in default")).toBe(true);
    expect(listAccountNotifications(b.id).notifications.some((n) => n.title === "Loan in default")).toBe(true);
    // credits that arrive are still collected for the lender
    const lenderMid = a.credits();
    mutateAccountState(b.id, (s) => { s.corp.finances.credits = 5_000; }, { sanitize: false, settleMining: false });
    loanServicingTick(T0 + (4 + PLAYER_DEFAULT_DAYS) * DAY);
    expect(a.credits()).toBeGreaterThan(lenderMid);
  });
});

describe("the routes", () => {
  it("post, list, accept and cancel through HTTP", async () => {
    const a = await corp(), b = await corp();
    const posted = await a.api.post(`${a.base}/loan-offers`).send({ principal: 8_000, ratePct30: 2.25, termDays: 7, minGrade: "NR-accepted" });
    expect(posted.status).toBe(201);
    const seen = await b.api.get(`${b.base}/loan-offers`);
    expect(seen.body.offers.some((o) => o.id === posted.body.offer.id && !o.mine)).toBe(true);
    const took = await b.api.post(`${b.base}/loan-offers/${posted.body.offer.id}/accept`);
    expect(took.status).toBe(200);
    expect(took.body.loan).toMatchObject({ principal: 8_000, lender: { kind: "player", corpId: a.corp().publicId } });
    const other = await a.api.post(`${a.base}/loan-offers`).send({ principal: 8_000, ratePct30: 2.25, termDays: 7, minGrade: "NR-accepted" });
    expect((await b.api.post(`${b.base}/loan-offers/${other.body.offer.id}/cancel`)).status).toBe(404); // not b's offer
    expect((await a.api.post(`${a.base}/loan-offers/${other.body.offer.id}/cancel`)).status).toBe(200);
    expect(listLoanOffers(a.id, Date.now()).some((o) => o.id === other.body.offer.id)).toBe(false);
  });
});
