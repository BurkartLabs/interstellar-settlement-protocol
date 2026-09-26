// Companion to e2e/exchange-screen.spec.js (ISP-80, AB#769): a corporation docked at Earth Station Prime holding three
// goods there, and a second corporation with four sell orders on the public book, so every table on the Exchange has
// rows. Built with the server's own account code in a separate process (see seed-logistics-account.mjs for why); the
// orders are the shape POST /api/market/orders writes (server/routes/market.js).
//
// With a fourth argument `bids` (AB#1054), a third corporation has two buy orders waiting, placed through the server's own
// placeBuyOrder (server/buyOrders.js), so its credits are held as a real order holds them.
//
// Usage: node e2e/seed-exchange-account.mjs <dataDir> <email> <password> [bids]
import { randomUUID } from "node:crypto";

const [, , dataDir, email, password, extra] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "exchange-e2e-fixture-secret-0123456789abcd";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");

const { account } = await store.createAccount({ email, password, ceoName: "Exchange QA", corpName: `Exchange QA Corp ${Date.now() % 100000}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288
store.mutateAccountState(account.id, (state) => {
  state.corp.currentStationId = "earth-station-prime";
  state.corp.finances.credits = 250_000;
  state.corp.inventory = { "earth-station-prime": { Silicates: 400, Nickel: 120, Titanium: 60 } };
});
store.markWalkthroughCompleted(account.id);

const seller = await store.createAccount({ email: `seller-${email}`, password, ceoName: "Seller QA", corpName: "Kessler Ore Brokers" });
const now = Date.now();
store.mutateState((draft) => {
  if (!Array.isArray(draft.market.orderBook)) draft.market.orderBook = [];
  for (const [item, quantity, unitPrice, minutesAgo] of [["Silicates", 250, 27, 40], ["Nickel", 80, 64, 25], ["Titanium", 45, 118, 12], ["Carbon", 300, 19, 5]]) {
    draft.market.orderBook.unshift({
      id: `ord-${randomUUID()}`, type: "sell", item, quantity, unitPrice, seller: "Kessler Ore Brokers",
      sellerAccountId: seller.account.id, stationId: "earth-station-prime", createdAt: now - minutesAgo * 60_000
    });
  }
});
if (extra === "bids") {
  const { placeBuyOrder } = await import("../server/buyOrders.js");
  const rival = await store.createAccount({ email: `rival-${email}`, password, ceoName: "Rival QA", corpName: "Halvorsen Refining" });
  store.mutateAccountState(rival.account.id, (state) => { state.corp.finances.credits = 200_000; });
  for (const [item, quantity, unitPrice] of [["Nickel", 200, 55], ["Silicates", 1000, 22]]) {
    const placed = placeBuyOrder(rival.account.id, { item, quantity, unitPrice });
    if (placed.error || placed.fills.length) throw new Error(`seeding a buy order: ${placed.error || "it filled"}`);
  }
}
await store.saveAccountsNow();
