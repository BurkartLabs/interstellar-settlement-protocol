import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState } from "../../server/gameState.js";

// Bug #1097: payroll through the real routes. The clock is moved with a fake Date (Date only; timers stay real).
const DAY = 86_400_000;
beforeAll(async () => { await getApp(); });
afterEach(() => { vi.useRealTimers(); });

async function corporation(credits) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => { state.corp.finances.credits = credits; state.corp.employeeCap = 20; });
  const api = authed(app, accessToken);
  return { id: account.id, api, read: async () => (await api.get(`/api/accounts/${account.id}`)).body };
}

describe("payroll through the routes (Bug #1097)", () => {
  it("hire 10, a day passes: 1,500 credits leave and the Financial Core books them as payroll", async () => {
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    const c = await corporation(100_000);
    expect((await c.api.post(`/api/accounts/${c.id}/gameplay/hire`).send({ count: 10 })).status).toBe(200);
    const afterHire = (await c.read()).state.corp.finances.credits; // 100,000 less the 20,000 hiring fee
    vi.setSystemTime(start + DAY);
    const f = (await c.read()).state.corp.finances;
    expect(afterHire - f.credits).toBe(1500);
    expect(f.expensesByCategory.payroll).toBe(1500);
    expect(f.payrollArrears ?? 0).toBe(0);
  });

  it("a corporation that cannot cover it goes to 0, owes the rest, keeps its staff and is told", async () => {
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    const c = await corporation(20_400); // the hiring fee leaves 400
    expect((await c.api.post(`/api/accounts/${c.id}/gameplay/hire`).send({ count: 10 })).status).toBe(200);
    vi.setSystemTime(start + DAY);
    const account = await c.read();
    expect(account.state.corp.finances.credits).toBe(0);
    expect(account.state.corp.finances.payrollArrears).toBe(1100);
    expect(account.state.corp.employeeCount).toBe(10);
    const notifications = (await c.api.get(`/api/accounts/${c.id}/notifications`)).body.notifications;
    const notice = notifications.find((n) => n.title === "Payroll unpaid");
    expect(notice?.body).toMatch(/owes its staff 1,100 credits.*No one has been let go\.$/);
  });
});
