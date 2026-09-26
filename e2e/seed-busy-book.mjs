// Companion to e2e/sell-orders-capped.spec.js: a buyer, and a second corporation with 35 one-unit Silicates listings
// on the book — the shape the market route writes (server/routes/market.js), written with the server's own store in a
// separate process (see seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-busy-book.mjs <dataDir> <buyerEmail> <password> <listings>
import { randomUUID } from "node:crypto";

const [, , dataDir, email, password, listings] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "busy-book-e2e-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account: buyer } = await store.createAccount({ email, password, ceoName: "Buyer QA", corpName: `Buyer QA Corp ${Date.now()}` });
verifyEmailToken(issueVerificationToken(buyer.id)); // AB#2288: a player who can log in has verified
store.markWalkthroughCompleted(buyer.id);
const { account: seller } = await store.createAccount({
  email: `seller-${email}`, password, ceoName: "Seller QA", corpName: `Seller QA Corp ${Date.now()}`
});
verifyEmailToken(issueVerificationToken(seller.id)); // AB#2288: a player who can log in has verified
const now = Date.now();
const orders = Array.from({ length: Number(listings) }, (_, i) => ({
  id: `ord-${randomUUID()}`, type: "sell", item: "Silicates", quantity: 1, unitPrice: 41 + i,
  seller: `Seller QA Corp`, sellerAccountId: seller.id, stationId: "earth-station-prime", createdAt: now - i * 60_000
}));
store.mutateState((draft) => {
  draft.market.orderBook = [...orders, ...(draft.market.orderBook || [])];
});
await store.saveAccountsNow();
