// Companion to e2e/trade-history-deductions.spec.js (Bug #4853): Halcyon holds Alpha Centauri's concession with a 3% tariff
// in force; Kestrel sold 500 Nickel at 26 at Centauri Prime Station (tax and tariff taken) and 400 Silicates at 20 at
// Earth Station Prime (tax only). Built with the server's own code in a separate process, on the timeline of
// e2e/seed-tariff-discount.mjs. One stand-in: each sale is computed with the NPC sale route's own functions
// (exchangeTaxBreakdown, taxOnSale, chargeTariff) and written as that route writes its row (server/routes/market.js),
// instead of through HTTP.
//
// Usage: node e2e/seed-trade-deductions.mjs <dataDir> <password>   (prints the seller's login as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-trade-deductions.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "trade-deductions-e2e-fixture-secret-012345";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { accountsStore } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { recordControlDay } = await import("../server/controlService.js");
const c = await import("../server/concessions.js");
const { chargeTariff, setTariff, dataStore: tariffStore } = await import("../server/tariffService.js");
const { exchangeTaxBreakdown } = await import("../server/game/progression.js");
const { salesTaxBaseAt } = await import("../server/lobbyingService.js");
const { taxOnSale } = await import("../public/scripts/exchangeTax.js");

const H = 3_600_000, DAY = 24 * H;
const T = Date.now();
const stamp = T.toString(36);
const SYSTEM = "alpha-centauri", STATION = "centauri-prime-station";

async function corp(key, name) {
  const email = `trade-deductions-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${name} CEO`, corpName: `${name} ${stamp.slice(-3)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  const raw = accountsStore.accounts[account.id];
  Object.assign(raw.state.corp, { currentSystemId: SYSTEM, currentStationId: STATION, location: "Proxima b", level: 10 });
  raw.state.corp.finances.credits = 500_000;
  store.markWalkthroughCompleted(account.id);
  return { id: account.id, email, state: raw.state, corp: raw.state.corp };
}
const halcyon = await corp("holder", "Halcyon Mining");
const kestrel = await corp("seller", "Kestrel Freight");
const holderOf = (x) => ({ type: "corp", id: x.corp.publicId, name: x.corp.corporationName });
const readings = (newestAt) => {
  for (let i = 13; i >= 0; i -= 1) {
    recordControlDay({ computedAt: newestAt - i * DAY, holders: { [SYSTEM]: { live: ["extraction", "leases"], groups: [[halcyon, 0.6], [kestrel, 0.2]].map(([x, s]) => ({ ...holderOf(x), parts: { extraction: s, leases: s, sales: 0 } })) } } });
  }
};
const must = (r, what) => { if (r?.refused) throw new Error(`${what}: ${r.refused.error}`); return r; };

readings(T - 151 * H);
must(c.petitionConcession(halcyon.id, SYSTEM, T - 150 * H), "the petition");
readings(T - 79 * H);
c.reviewConcessions(T - 78 * H);
must(setTariff(halcyon.corp, SYSTEM, 3, T - 77 * H), "the 3% tariff"); // in force 72 hours later
c.dataStore.rewrite(() => {});

/** One NPC sale by Kestrel at `stationId`, computed as server/routes/market.js computes it, and its row. */
function sale(stationId, item, quantity, unitPrice, at, counterparty) {
  const total = quantity * unitPrice;
  const breakdown = exchangeTaxBreakdown(kestrel.state, salesTaxBaseAt(stationId));
  const { tax: taxAmount, proceeds: afterTax } = taxOnSale(total, breakdown);
  const tariff = chargeTariff(kestrel.corp, { stationId, base: total, now: at });
  return { id: `th-${at}`, type: "sold-npc", item, quantity, unitPrice, total, taxPct: breakdown.ratePct, taxAmount,
    ...(tariff.amount ? { tariffPct: tariff.pct, tariffAmount: tariff.amount, tariffRecord: tariff } : {}),
    proceeds: afterTax - tariff.amount, counterparty, at };
}
kestrel.corp.tradeHistory = [sale(STATION, "Nickel", 500, 26, T - 60_000, "Centauri Commodities Board"), sale("earth-station-prime", "Silicates", 400, 20, T - 120_000, "Sol Materials Exchange")];
tariffStore.rewrite(() => {});

await store.saveAccountsNow();
const [withTariff, withoutTariff] = kestrel.corp.tradeHistory;
process.stdout.write(JSON.stringify({ seller: kestrel.email, withTariff, withoutTariff }) + "\n");
process.exit(0);
