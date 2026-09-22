import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState } from "../../server/gameState.js";
import { DAY_MS, utcDayStart } from "../../server/finances.js";
import { statementHtml } from "../../public/scripts/statements.js";

// AB#714: "figures match GET /finances/statements for the same day exactly". The page's statement is rendered from the
// endpoint's own JSON, and every number in that JSON is on the page with the same value.
const figuresIn = (html) => Object.fromEntries([...html.matchAll(/data-figure="([^"]+)" data-value="(-?\d+)"/g)].map((m) => [m[1], Number(m[2])]));

/** Every number in a statement, by path: { "pnl.income.missions": 2000, ... }. */
function leaves(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? leaves(v, `${prefix}${k}.`) : typeof v === "number" ? [[`${prefix}${k}`, v]] : []));
}

describe("the Financial Core shows the statements the server closed (AB#714)", () => {
  it("every figure in the endpoint's statement is on the page, with the same value", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const yesterday = utcDayStart(Date.now()) - DAY_MS;
    mutateAccountState(account.id, (state) => {
      state.corp.finances.credits = 212_750;
      state.corp.finances.assets = 16_000;
      state.corp.finances.dayBook = { dayStart: yesterday, opening: 250_000, income: { exchange: 1_150, missions: 600 }, expenses: { hiring: 8_000, "office-rent": 28_000, "exchange-tax": 92, research: 2_908 } };
    });
    const res = await authed(app, accessToken).get(`/api/accounts/${account.id}/finances/statements?days=1`);
    expect(res.status).toBe(200);
    const [s] = res.body.statements;

    const shown = figuresIn(statementHtml(s));
    const expected = Object.fromEntries(leaves({ pnl: s.pnl, cashFlow: s.cashFlow, balanceSheet: s.balanceSheet }).filter(([k, v]) => !(k === "cashFlow.unrecorded" && v === 0)));
    expect(shown).toEqual(expected);
    expect(Object.keys(shown)).toHaveLength(Object.keys(expected).length);
    expect(shown["cashFlow.closing"]).toBe(212_750);
  });
});
