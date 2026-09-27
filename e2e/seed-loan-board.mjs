// Companion to e2e/loan-board.spec.js (ISP-153, AB#847): a loan board with open offers from three lenders, and one lender
// ("Helios Freight") holding a loan in arrears, a loan in default that was recovered, and a borrower in the grace period.
// Built with the server's own loan code (postLoanOffer, acceptLoanOffer, the servicing and recovery ticks) in a separate
// process, like seed-leased-account.mjs, then saved to the data directory the spec's server starts on.
//
// Usage: node e2e/seed-loan-board.mjs <dataDir> <password>   (prints the logins as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-loan-board.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "loan-board-e2e-fixture-secret-0123456789";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { postLoanOffer, acceptLoanOffer } = await import("../server/playerLoans.js");
const { defaultRecoveryTick } = await import("../server/defaultRecovery.js");

const DAY = 86_400_000, HOUR = 3_600_000;
const stamp = Date.now().toString(36);
const logins = {};

async function corp(key, corpName, credits, { statements = false } = {}) {
  const email = `loanboard-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${corpName} CEO`, corpName: `${corpName} ${stamp.slice(-4)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  const today = Math.floor(Date.now() / DAY) * DAY;
  store.mutateAccountState(account.id, (s) => {
    s.corp.currentStationId = "earth-station-prime";
    s.corp.finances.credits = credits;
    if (statements) {
      // thirty days of an ordinary mining corporation, so it has a letter grade rather than NR
      s.statements = Array.from({ length: 30 }, (_, i) => ({
        day: new Date(today - (30 - i) * DAY).toISOString().slice(0, 10), dayStart: today - (30 - i) * DAY,
        pnl: { income: {}, expenses: {}, totalIncome: 30_000, totalExpenses: 26_500, net: 3_500 },
        cashFlow: { opening: 0, inflows: 30_000, outflows: 26_500, closing: 150_000, unrecorded: 0 },
        balanceSheet: { credits: 150_000, facilities: 180_000, inventory: 0, liabilities: 20_000, totalAssets: 330_000, netWorth: 310_000 }
      }));
    }
  }, { sanitize: false, settleMining: false });
  store.markWalkthroughCompleted(account.id);
  logins[key] = email;
  return account.id;
}

const now = Date.now();
const helios = await corp("helios", "Helios Freight", 600_000);
const kestrel = await corp("kestrel", "Kestrel Capital", 300_000);
const vanta = await corp("vanta", "Vanta Holdings", 300_000);
const nadir = await corp("nadir", "Nadir Mining", 0, { statements: true });
const orbital = await corp("orbital", "Orbital Salvage", 0);
const tessera = await corp("tessera", "Tessera Works", 0);

// the loans Helios made, taken before its open offers are posted so the board shows others' offers too
const lend = (lender, borrower, principal, rate) => {
  const o = postLoanOffer(lender, { principal, ratePct30: rate, termDays: 30, minGrade: "NR-accepted" }, now - 12 * DAY);
  const r = acceptLoanOffer(borrower, o.offer.id, now - 12 * DAY);
  if (!r.ok) throw new Error(r.error);
  return r.loan.id;
};
const inArrears = (borrower, loanId, { defaulted = false } = {}) => store.mutateAccountState(borrower, (s) => {
  const l = s.corp.loans.find((x) => x.id === loanId);
  Object.assign(l, { paymentsMade: 4, balance: l.principal - 2_600, arrearsFees: 110, arrearsInterest: 420, arrearsPrincipal: 1_720, arrears: 2_250, state: "arrears", arrearsSince: now - 9 * DAY, nextDueAt: now + 400 * DAY, ...(defaulted ? { defaultedAt: now - HOUR * 30 } : {}) });
}, { sanitize: false, settleMining: false });

inArrears(nadir, lend(helios, nadir, 20_000, 3.5)); // in arrears, not yet in default
const orbitalLoan = lend(helios, orbital, 15_000, 4.25); // in default, and recovered from goods and a building
inArrears(orbital, orbitalLoan, { defaulted: true });
store.mutateAccountState(orbital, (s) => {
  s.corp.finances.credits = 2_000;
  s.corp.inventory = { "earth-station-prime": { Silicates: 300 } };
  s.corp.buildings.push({ id: "bld-orbital-refinery", name: "Refinery", tier: 1, status: "Operational", paid: 75_000 });
  s.corp.refineries = [{ id: "ref-1", name: "Refinery #1", tier: 1, active: false, cyclesCompleted: 0, totalInputConsumed: 0, totalOutputProduced: 0 }];
}, { sanitize: false, settleMining: false });
const tesseraLoan = lend(helios, tessera, 10_000, 5); // in default, in the grace period
inArrears(tessera, tesseraLoan, { defaulted: true });

defaultRecoveryTick(now - 26 * HOUR); // the warnings: Orbital's and Tessera's grace periods start
store.mutateAccountState(tessera, (s) => { s.corp.recoveries.forEach((r) => { r.warnedAt = now - HOUR; r.saleAt = now + 23 * HOUR; }); }, { sanitize: false, settleMining: false });
defaultRecoveryTick(now - HOUR); // Orbital's grace has ended: recovery runs; Tessera's has not

// the open offers on the board
postLoanOffer(kestrel, { principal: 25_000, ratePct30: 2.75, termDays: 30, minGrade: "BBB" }, now);
postLoanOffer(vanta, { principal: 8_000, ratePct30: 6.5, termDays: 7, minGrade: "NR-accepted" }, now);
postLoanOffer(kestrel, { principal: 60_000, ratePct30: 3.5, termDays: 90, minGrade: "A" }, now);
postLoanOffer(helios, { principal: 12_000, ratePct30: 4, termDays: 30, minGrade: "BB" }, now);

await store.saveAccountsNow();
console.log(JSON.stringify(logins));
