import { describe, it, expect } from "vitest";
import { settlePayroll, payrollNotice, dailyPayroll, PAYROLL_PER_EMPLOYEE_PER_DAY } from "../../server/payroll.js";
import { computeLiveLiabilities } from "../../server/finances.js";

// Bug #1097: payroll is charged, at $150 per employee per day (Decision #1147, read as option A).
const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
const corp = (employeeCount, credits, extra = {}) => ({ employeeCount, finances: { credits, dailyCosts: employeeCount * 150, ...extra } });

describe("payroll (Bug #1097)", () => {
  it("charges 10 staff 1,500 credits a day and books it as payroll", () => {
    const c = corp(10, 100_000);
    settlePayroll(c, T0); // the clock starts
    const r = settlePayroll(c, T0 + DAY);
    expect(r).toMatchObject({ paid: 1500, owed: 0 });
    expect(c.finances.credits).toBe(98_500);
    expect(c.finances.expensesByCategory.payroll).toBe(1500);
    expect(c.finances.dailyExpenses).toBe(1500);
    expect(dailyPayroll(c)).toBe(10 * PAYROLL_PER_EMPLOYEE_PER_DAY);
  });

  it("comes to the same total whether the day arrives in one slice or in 17,280 (every 5 s)", () => {
    const whole = corp(7, 100_000);
    settlePayroll(whole, T0);
    settlePayroll(whole, T0 + DAY);
    const sliced = corp(7, 100_000);
    settlePayroll(sliced, T0);
    for (let t = T0 + 5000; t <= T0 + DAY; t += 5000) settlePayroll(sliced, t);
    expect(whole.finances.credits).toBe(100_000 - 1050);
    expect(sliced.finances.credits).toBe(whole.finances.credits);
  });

  it("charges nothing for the time before the clock started, and never touches a corporation with no staff", () => {
    const c = corp(20, 50_000);
    settlePayroll(c, T0 + 30 * DAY); // an old corporation, first settled after payroll exists
    expect(c.finances.credits).toBe(50_000);
    const idle = corp(0, 50_000);
    const before = JSON.stringify(idle);
    settlePayroll(idle, T0);
    settlePayroll(idle, T0 + DAY);
    expect(JSON.stringify(idle)).toBe(before);
  });

  it("when it cannot pay: takes what there is, never goes negative, owes the rest and lets nobody go", () => {
    const c = corp(10, 400);
    settlePayroll(c, T0);
    const r = settlePayroll(c, T0 + DAY);
    expect(r).toMatchObject({ paid: 400, owed: 1100, becameShort: true });
    expect(c.finances.credits).toBe(0);
    expect(c.finances.payrollArrears).toBe(1100);
    expect(c.employeeCount).toBe(10);
    expect(computeLiveLiabilities(c)).toBe(1500 * 7 + 1100);
    expect(payrollNotice(c, r)).toEqual({
      type: "finance",
      title: "Payroll unpaid",
      body: "Your corporation could not cover its wages and owes its staff 1,100 credits. Payroll keeps running at 1,500 credits a day, and what is owed is paid first from your next credits. No one has been let go."
    });
  });

  it("pays what is owed first from the next credits, and says so once it is clear", () => {
    const c = corp(10, 400);
    settlePayroll(c, T0);
    settlePayroll(c, T0 + DAY); // owes 1,100
    const again = settlePayroll(c, T0 + DAY + 1); // still nothing to pay with: no second notice
    expect(again.becameShort).toBe(false);
    c.finances.credits = 5000; // a sale lands
    const r = settlePayroll(c, T0 + DAY + 1);
    expect(r).toMatchObject({ paid: 1100, owed: 0, caughtUp: true });
    expect(c.finances.credits).toBe(3900);
    expect(payrollNotice(c, r)?.title).toBe("Payroll paid");
  });
});
