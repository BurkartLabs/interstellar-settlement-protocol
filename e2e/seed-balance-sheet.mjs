// Companion to e2e/balance-sheet.spec.js (Bug #4647): a borrower with a Development Bank loan and a lender with a loan
// offer in escrow and a loan to another corporation. Today is closed early, by reading the statements a day ahead, so
// the page has a statement with them on the balance sheet (the store closes a day only once it has ended; a day set in
// the past is closed before anything is booked on it). Built with the server's own loan code in a separate process,
// like seed-loan-board.mjs.
//
// Usage: node e2e/seed-balance-sheet.mjs <dataDir> <password>   (prints the logins as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-balance-sheet.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "balance-sheet-e2e-fixture-secret-0123456789";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { quoteLoan, acceptLoan } = await import("../server/loans.js");
const { postLoanOffer, acceptLoanOffer } = await import("../server/playerLoans.js");
await import("../server/balanceSheet.js");

const DAY = 86_400_000;
const stamp = Date.now().toString(36);
const logins = {};
const then = Date.now();

async function corp(key, corpName, credits) {
  const email = `sheet-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${corpName} CEO`, corpName: `${corpName} ${stamp.slice(-4)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  store.mutateAccountState(account.id, (s) => {
    s.corp.currentStationId = "earth-station-prime";
    s.corp.finances.credits = credits;
  }, { sanitize: false, settleMining: false });
  store.markWalkthroughCompleted(account.id);
  logins[key] = email;
  return account.id;
}

const borrower = await corp("borrower", "Nadir Mining", 50_000);
const lender = await corp("lender", "Helios Freight", 200_000);
const other = await corp("other", "Orbital Salvage", 0);

const q = quoteLoan(borrower, { productId: "dsdb-90", principal: 20_000 }, then);
if (!q.ok || !acceptLoan(borrower, { quoteId: q.quote.id }, then).ok) throw new Error(`the bank loan: ${q.error}`);
const lent = postLoanOffer(lender, { principal: 40_000, ratePct30: 4, termDays: 30, minGrade: "NR-accepted" }, then);
if (!lent.ok || !acceptLoanOffer(other, lent.offer.id, then).ok) throw new Error("the player loan");
if (!postLoanOffer(lender, { principal: 25_000, ratePct30: 5, termDays: 30, minGrade: "BBB" }, then).ok) throw new Error("the open offer");

for (const id of [borrower, lender, other]) store.getStatements(id, 90, Date.now() + DAY); // close today
await store.saveAccountsNow();
console.log(JSON.stringify(logins));
