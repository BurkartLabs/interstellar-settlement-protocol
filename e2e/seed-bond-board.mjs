// Companion to scripts/look-bond-board.mjs (ISP-156, AB#850): the bond board's world, built with the server's own
// account and bond code in a separate process before the server starts (see seed-logistics-account.mjs for why).
//
//   - two issuers at level 10 with 30 days of statements, each with a series open for subscribing;
//   - a third issuer whose series the viewer bought out, so it has closed and is live with a coupon due;
//   - the viewer: level 10, rated, eligible to issue, holding that live series and 10 units of an open one;
//   - a level 3 corporation, which sees why it cannot issue.
//
// Usage: node e2e/seed-bond-board.mjs <dataDir> <password>   (prints the two e-mail addresses as JSON)
const [, , dataDir, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "bond-board-look-fixture-secret-0123456789";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { issueBond, subscribeBond } = await import("../server/bonds.js");

const DAY = 86_400_000;
const stamp = Date.now() % 100_000;
const today = Math.floor(Date.now() / DAY) * DAY;

async function corporation(name, { level = 10, credits = 400_000, days = 30 } = {}) {
  const email = `${name.toLowerCase().replace(/\W+/g, "-")}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${name} CEO`, corpName: `${name} ${stamp}` });
  verifyEmailToken(issueVerificationToken(account.id));
  store.mutateAccountState(account.id, (s) => {
    s.statements = Array.from({ length: days }, (_, i) => ({
      day: new Date(today - (days - i) * DAY).toISOString().slice(0, 10), dayStart: today - (days - i) * DAY,
      pnl: { income: {}, expenses: {}, totalIncome: 30_000, totalExpenses: 26_500, net: 3_500 },
      cashFlow: { opening: 0, inflows: 30_000, outflows: 26_500, closing: 150_000, unrecorded: 0 },
      balanceSheet: { credits: 150_000, facilities: 180_000, inventory: 0, liabilities: 20_000, totalAssets: 330_000, netWorth: 310_000 }
    }));
    s.corp.level = level;
    s.corp.currentStationId = "earth-station-prime";
    s.corp.finances.credits = credits;
  }, { sanitize: false, settleMining: false });
  store.getStatements(account.id);
  store.markWalkthroughCompleted(account.id);
  return { id: account.id, email };
}

const must = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.error}`); return r; };
const helios = await corporation("Helios Freight");
const kestrel = await corporation("Kestrel Mining");
const vanta = await corporation("Vanta Refining");
const viewer = await corporation("Borrower Holdings");
const newco = await corporation("Newco Startup", { level: 3, days: 3 });

const now = Date.now();
const a = must(issueBond(helios.id, { quantity: 200, couponPct30: 5.5, maturityDays: 60, windowHours: 48 }, now), "Helios issue").series;
must(issueBond(kestrel.id, { quantity: 120, couponPct30: 3.75, maturityDays: 30, windowHours: 24 }, now - 5 * 3_600_000), "Kestrel issue");
const c = must(issueBond(vanta.id, { quantity: 40, couponPct30: 6.25, maturityDays: 90, windowHours: 24 }, now - 3 * DAY), "Vanta issue").series;
// Bug #4799: no holder takes more than 20% of a series, so the viewer takes its 8 of 40 and four others fill the rest,
// which closes it: a live series the viewer holds
must(subscribeBond(viewer.id, { seriesId: c.id, units: 8 }, now - 3 * DAY + 3_600_000), "viewer buys into Vanta");
for (const name of ["Orion Holdings", "Pallas Capital", "Tethys Trust", "Umbra Partners"]) {
  const h = await corporation(name, { level: 1 });
  must(subscribeBond(h.id, { seriesId: c.id, units: 8 }, now - 3 * DAY + 3_600_000), `${name} buys into Vanta`);
}
must(subscribeBond(viewer.id, { seriesId: a.id, units: 10 }, now), "viewer buys into Helios");
await store.saveAccountsNow();
console.log(JSON.stringify({ viewer: viewer.email, newco: newco.email }));
