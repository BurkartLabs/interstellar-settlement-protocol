// Payroll (Bug #1097). Hiring promised $150 a day per employee and nothing ever charged it. The Board answered
// Decision #1147 ("turn payroll on now?") with "Yes", read by the PM as option A: charge it as designed, now.
//
// Payroll is settled by the 5-second mining ticker, for every account, online or not, for the time since it was last
// settled. Only the ticker settles it, so reading an account or a refused request never changes it; a new hire
// starts costing at the next tick. A day costs the same whether it arrives in one slice or in thousands: the unpaid
// fraction of a credit is carried to the next settlement, as the extractor costs carry theirs (Bug #1138).
//
// A corporation that cannot cover it pays what it has: its balance stops at 0, never below, and the rest is owed to
// its staff (finances.payrollArrears), paid first from the next credits it has. Nobody is let go. The Financial Core
// shows what is owed as a liability, and the player is told when wages go unpaid and when they are paid again.
//
// A corporation's payroll clock starts the first time it is settled with staff, so nobody is charged for the time
// before payroll existed, and a corporation with no staff is never touched.

import { recordExpense } from "./finances.js";

export const PAYROLL_PER_EMPLOYEE_PER_DAY = 150;
const DAY_MS = 86_400_000;
// The same floating-point allowance as the extractor costs: many small slices must add up to the whole day.
const CARRY_TOLERANCE = 1e-6;

/** What a corporation's staff cost a day. */
export function dailyPayroll(corp) {
  return Math.max(0, Math.floor(Number(corp?.employeeCount) || 0)) * PAYROLL_PER_EMPLOYEE_PER_DAY;
}

/**
 * Charge payroll for the time since it was last settled. Returns { paid, owed, becameShort, caughtUp }: what was
 * taken from credits now, what is still owed after it, and whether this settlement started or cleared arrears.
 */
export function settlePayroll(corp, now = Date.now()) {
  const none = { paid: 0, owed: 0, becameShort: false, caughtUp: false };
  const f = corp?.finances;
  if (!f) return none;
  const owedBefore = Math.max(0, Number(f.payrollArrears) || 0);
  // No staff and nothing owed: nothing runs, and the corporation is left exactly as it is (the clock starts at the
  // first tick after the first hire).
  if (dailyPayroll(corp) === 0 && owedBefore === 0) {
    delete f.payrollPaidThrough;
    delete f.payrollRemainder;
    return none;
  }
  // Wages since the last settlement, at the staff of that time; the clock starts the first time there is staff.
  let wholeCredits = 0;
  if (dailyPayroll(corp) > 0) {
    const since = Number(f.payrollPaidThrough);
    if (!Number.isFinite(since) || since <= 0) {
      f.payrollPaidThrough = now;
    } else if (now > since) {
      const accrued = dailyPayroll(corp) * ((now - since) / DAY_MS) + Math.max(0, Number(f.payrollRemainder) || 0);
      wholeCredits = Math.floor(accrued + CARRY_TOLERANCE);
      f.payrollRemainder = Math.max(0, accrued - wholeCredits);
      f.payrollPaidThrough = now;
    }
  }

  // What is owed is paid first, whenever there are credits, even in the same instant.
  const due = wholeCredits + owedBefore;
  if (due <= 0) return { ...none, owed: 0 };
  const credits = Math.max(0, Number(f.credits) || 0);
  const paid = Math.min(due, Math.floor(credits));
  f.credits = credits - paid;
  f.payrollArrears = due - paid;
  if (paid > 0) recordExpense(corp, "payroll", paid, now);
  return { paid, owed: f.payrollArrears, becameShort: owedBefore === 0 && f.payrollArrears > 0, caughtUp: owedBefore > 0 && f.payrollArrears === 0 };
}

/** The notification for a settlement that started or cleared arrears, or null. */
export function payrollNotice(corp, result) {
  const credits = (n) => `${Math.round(n).toLocaleString("en-US")} credits`;
  if (result?.becameShort) {
    return {
      type: "finance",
      title: "Payroll unpaid",
      body: `Your corporation could not cover its wages and owes its staff ${credits(result.owed)}. Payroll keeps running at ${credits(dailyPayroll(corp))} a day, and what is owed is paid first from your next credits. No one has been let go.`
    };
  }
  if (result?.caughtUp) {
    return { type: "finance", title: "Payroll paid", body: "Your corporation has paid the wages it owed. Payroll is up to date." };
  }
  return null;
}
