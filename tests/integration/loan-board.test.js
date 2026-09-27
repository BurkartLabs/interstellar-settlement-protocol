import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState } from "../../server/gameState.js";

// ISP-153 (AB#847): what the loan board reads: the caller's grade with the offers, and its player loans both ways,
// each lent loan with its borrower's grade. No account id in either.
let app;
beforeAll(async () => { ({ app } = await getApp()); });

async function corp(credits) {
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => { s.corp.finances.credits = credits; }, { sanitize: false, settleMining: false });
  return { id: account.id, api: authed(app, accessToken), base: `/api/accounts/${account.id}` };
}

describe("the loan board's reads (AB#847)", () => {
  it("returns the caller's grade with the offers, and each side's loans with the borrower's grade", async () => {
    const lender = await corp(100_000), borrower = await corp(0);
    const board = await lender.api.get(`${lender.base}/loan-offers`);
    expect(board.status).toBe(200);
    expect(board.body.grade).toBe("NR"); // a new corporation is unrated
    const posted = await lender.api.post(`${lender.base}/loan-offers`).send({ principal: 12_000, ratePct30: 4.5, termDays: 30, minGrade: "NR-accepted" });
    expect((await borrower.api.post(`${borrower.base}/loan-offers/${posted.body.offer.id}/accept`)).status).toBe(200);

    const lent = await lender.api.get(`${lender.base}/player-loans`);
    expect(lent.status).toBe(200);
    expect(lent.body.lent).toHaveLength(1);
    expect(lent.body.lent[0]).toMatchObject({ principal: 12_000, ratePct30: 4.5, state: "active", borrowerGrade: "NR", recovery: null });
    expect(lent.body.lent[0].borrowerName).toBeTruthy();
    expect(lent.body.borrowed).toEqual([]);

    const owed = await borrower.api.get(`${borrower.base}/player-loans`);
    expect(owed.body.borrowed[0]).toMatchObject({ principal: 12_000, state: "active" });
    expect(owed.body.borrowed[0].lenderName).toBeTruthy();
    for (const body of [lent.body, owed.body]) expect(JSON.stringify(body)).not.toMatch(new RegExp(`${lender.id}|${borrower.id}`));
  });
});
