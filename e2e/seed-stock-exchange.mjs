// Companion to e2e/stock-exchange.spec.js (ISP-161, AB#855): three listed corporations with offerings open, an investor
// ("Helios Freight") holding shares in two of them, one worth more than it cost and one less, with two weeks of
// dividends paid, and a second investor that has sold some shares back to the market maker. Built with the server's own
// equity code (listCorporation, openOffering, buyShares, payDividends, exitShares) in a separate process, like
// seed-loan-board.mjs, then saved to the data directory the spec's server starts on.
//
// Usage: node e2e/seed-stock-exchange.mjs <dataDir> <password>   (prints the logins as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-stock-exchange.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "stock-exchange-e2e-fixture-secret-0123456789";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { listCorporation, openOffering, buyShares, exitShares } = await import("../server/shareOfferings.js");
const { payDividends } = await import("../server/dividends.js");

const DAY = 86_400_000;
const stamp = Date.now().toString(36);
const today = Math.floor(Date.now() / DAY) * DAY;
const logins = {};

/** A day of an ordinary profitable corporation worth `netWorth`, closed `ago` days back. */
const statement = (ago, net, netWorth) => ({
  day: new Date(today - ago * DAY).toISOString().slice(0, 10), dayStart: today - ago * DAY,
  pnl: { income: {}, expenses: {}, totalIncome: net + 20_000, totalExpenses: 20_000, net },
  cashFlow: { opening: 0, inflows: net + 20_000, outflows: 20_000, closing: 400_000, unrecorded: 0 },
  balanceSheet: { credits: 400_000, facilities: netWorth - 400_000 + 20_000, inventory: 0, liabilities: 20_000, totalAssets: netWorth + 20_000, netWorth }
});

async function corp(key, corpName, credits, history = null) {
  const email = `igsx-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${corpName} CEO`, corpName: `${corpName} ${stamp.slice(-4)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  store.mutateAccountState(account.id, (s) => {
    s.corp.currentStationId = "earth-station-prime";
    s.corp.finances.credits = credits;
    s.corp.level = 15;
    // thirty-one closed days up to the day before yesterday; yesterday's is added after the offerings open
    if (history) s.statements = Array.from({ length: 31 }, (_, i) => statement(32 - i, history.net, history.netWorth));
  }, { sanitize: false, settleMining: false });
  store.markWalkthroughCompleted(account.id);
  logins[key] = email;
  return account.id;
}
const ok = (r, what) => { if (!r?.ok) throw new Error(`${what}: ${r?.error}`); return r; };

const now = Date.now();
const aurora = await corp("aurora", "Aurora Dynamics", 500_000, { net: 9_000, netWorth: 1_320_000 }); // 132 a share
const nadir = await corp("nadir", "Nadir Mining", 500_000, { net: 4_000, netWorth: 860_000 }); // 86 a share
const vanta = await corp("vanta", "Vanta Holdings", 500_000, { net: 6_500, netWorth: 2_050_000 }); // 205 a share
const helios = await corp("helios", "Helios Freight", 400_000);
const kestrel = await corp("kestrel", "Kestrel Capital", 300_000);

for (const [id, name] of [[aurora, "Aurora"], [nadir, "Nadir"], [vanta, "Vanta"]]) {
  ok(listCorporation(id, now), `list ${name}`);
}
const offer = (id, quantity) => ok(openOffering(id, { quantity }, now), "open offering").offering;
const auroraOffer = offer(aurora, 1_500), nadirOffer = offer(nadir, 1_200);
offer(vanta, 800);

ok(buyShares(helios, { offeringId: auroraOffer.id, quantity: 600 }, now), "Helios buys Aurora");
ok(buyShares(helios, { offeringId: nadirOffer.id, quantity: 500 }, now), "Helios buys Nadir");
ok(buyShares(kestrel, { offeringId: auroraOffer.id, quantity: 400 }, now), "Kestrel buys Aurora");

// two weeks of dividends, as if the issuers had listed a fortnight ago, paid by the server's own dividend code
for (const id of [aurora, nadir]) {
  store.mutateAccountState(id, (s) => { s.corp.shareRegistry.listedAt = now - 14 * DAY; }, { sanitize: false, settleMining: false });
  payDividends(id, now);
}

// yesterday closes: Aurora is worth more than when its offering opened, Nadir less
store.mutateAccountState(aurora, (s) => { s.statements = [...(s.statements || []), statement(1, 9_000, 1_540_000)]; }, { sanitize: false, settleMining: false });
store.mutateAccountState(nadir, (s) => { s.statements = [...(s.statements || []), statement(1, -12_000, 700_000)]; }, { sanitize: false, settleMining: false });

const auroraCorpId = store.getAccountById(aurora).state.corp.publicId;
ok(exitShares(kestrel, { issuerCorpId: auroraCorpId, quantity: 60 }, now), "Kestrel sells to the market maker");

await store.saveAccountsNow();
console.log(JSON.stringify(logins));
