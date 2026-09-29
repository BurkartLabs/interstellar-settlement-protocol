// Companion to e2e/tariff-case-discount.spec.js (Bug #4854): Halcyon holds Alpha Centauri's concession, filed a 3%
// tariff and cut it to 2%, then changed the discount on everyone's leases, as a holder may. Kestrel then sold Silicates
// at Centauri Prime Station and paid the 2% in force: a lawful tariff. Kestrel is docked at Earth Station Prime, where the
// Galactic Arbitration Council sits. Built with the server's own code in a separate process, on the timeline of
// tests/integration/arbitration-rulings.test.js. One stand-in: the sale is settled with the tariff service's own
// chargeTariff and written as the NPC sale route writes its row (server/routes/market.js), instead of through HTTP.
//
// Usage: node e2e/seed-tariff-discount.mjs <dataDir> <password>   (prints the logins as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-tariff-discount.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "tariff-discount-e2e-fixture-secret-0123456";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { accountsStore } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { recordControlDay } = await import("../server/controlService.js");
const c = await import("../server/concessions.js");
const { chargeTariff, setTariff, dataStore: tariffStore } = await import("../server/tariffService.js");

const H = 3_600_000, DAY = 24 * H;
const T = Date.now();
const stamp = T.toString(36);
const SYSTEM = "alpha-centauri", STATION = "centauri-prime-station";
const logins = {};

async function corp(key, name) {
  const email = `tariff-discount-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${name} CEO`, corpName: `${name} ${stamp.slice(-3)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  const raw = accountsStore.accounts[account.id];
  Object.assign(raw.state.corp, { currentSystemId: SYSTEM, currentStationId: STATION, location: "Proxima b", level: 10 });
  raw.state.corp.finances.credits = 500_000;
  store.markWalkthroughCompleted(account.id);
  logins[key] = email;
  return { id: account.id, corp: raw.state.corp };
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
must(setTariff(halcyon.corp, SYSTEM, 2, T - 2 * H), "the cut to 2%"); // a cut takes effect at once
must(c.setLeaseModifier(halcyon.id, SYSTEM, 10, T - H), "the lease discount"); // Bug #4854: what made the Council misread
c.dataStore.rewrite(() => {});

// Kestrel sells 1,000 Silicates at 20 at Centauri Prime Station, and pays the tariff in force
const total = 1_000 * 20;
const tariff = chargeTariff(kestrel.corp, { stationId: STATION, base: total, now: T });
kestrel.corp.tradeHistory = [{ id: `th-${T}`, type: "sold-npc", item: "Silicates", quantity: 1_000, unitPrice: 20, total, at: T,
  ...(tariff.amount ? { tariffPct: tariff.pct, tariffAmount: tariff.amount, tariffRecord: tariff } : {}), proceeds: total - tariff.amount }];
tariffStore.rewrite(() => {});
Object.assign(kestrel.corp, { currentSystemId: "sol", currentStationId: "earth-station-prime", location: "Earth" });

await store.saveAccountsNow();
process.stdout.write(JSON.stringify({ ...logins, tariffPct: tariff.pct }) + "\n");
process.exit(0);
