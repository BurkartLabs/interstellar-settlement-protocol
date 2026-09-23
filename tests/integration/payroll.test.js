import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState } from "../../server/gameState.js";

// Bug #1097: payroll through the real routes and the real ticker. The clock is moved with a fake Date (Date only;
// timers stay real), and the 5-second mining tick, which settles payroll, is run by hand (tests run with tickers off).
const DAY = 86_400_000;
let mod;
beforeAll(async () => { mod = await getApp(); });
afterEach(() => { vi.useRealTimers(); });

async function corporation(credits) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.finances.credits = credits;
    state.corp.employeeCap = 20;
    state.corp.offices = [{ stationId: "earth-station-prime", rentedUntil: Date.now() + 7 * DAY }];
  });
  const api = authed(app, accessToken);
  return { id: account.id, api, read: async () => (await api.get(`/api/accounts/${account.id}`)).body };
}

describe("payroll through the routes and the ticker (Bug #1097)", () => {
  it("hire 10, a day passes: 1,500 credits leave and the Financial Core books them as payroll", async () => {
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    const c = await corporation(100_000);
    expect((await c.api.post(`/api/accounts/${c.id}/gameplay/hire`).send({ count: 10 })).status).toBe(200);
    mod.miningTick(); // the first tick with staff starts the payroll clock
    const afterHire = (await c.read()).state.corp.finances.credits; // 100,000 less the 20,000 hiring fee
    vi.setSystemTime(start + DAY);
    mod.miningTick();
    const f = (await c.read()).state.corp.finances;
    expect(afterHire - f.credits).toBe(1500);
    expect(f.expensesByCategory.payroll).toBe(1500);
    expect(f.payrollArrears ?? 0).toBe(0);
  });

  it("reading an account never charges payroll: only the ticker does", async () => {
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    const c = await corporation(100_000);
    await c.api.post(`/api/accounts/${c.id}/gameplay/hire`).send({ count: 10 });
    mod.miningTick();
    const before = JSON.stringify((await c.read()).state);
    vi.setSystemTime(start + DAY);
    expect(JSON.stringify((await c.read()).state.corp.finances.credits)).toBe(JSON.stringify(JSON.parse(before).corp.finances.credits));
  });

  it("a corporation that cannot cover it goes to 0, owes the rest, keeps its staff and is told", async () => {
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    const c = await corporation(20_400); // the hiring fee leaves 400
    expect((await c.api.post(`/api/accounts/${c.id}/gameplay/hire`).send({ count: 10 })).status).toBe(200);
    mod.miningTick();
    vi.setSystemTime(start + DAY);
    mod.miningTick();
    const account = await c.read();
    expect(account.state.corp.finances.credits).toBe(0);
    expect(account.state.corp.finances.payrollArrears).toBe(1100);
    expect(account.state.corp.employeeCount).toBe(10);
    const notifications = (await c.api.get(`/api/accounts/${c.id}/notifications`)).body.notifications;
    const notice = notifications.find((n) => n.title === "Payroll unpaid");
    expect(notice?.body).toMatch(/owes its staff 1,100 credits.*No one has been let go\.$/);
  });
});
