// Companion to e2e/lease-royalty.spec.js (ISP-302, AB#2285): a corporation docked at Earth Station Prime holding
// Silicates there and the given number of mining leases, so a sale shows the ISA lease royalty. Built with the
// server's own account code in a separate process (see seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-leased-account.mjs <dataDir> <email> <password> <leases>
const [, , dataDir, email, password, leasesArg] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "lease-royalty-e2e-fixture-secret-0123456789";
process.env.NODE_ENV = "test";

const leases = Number(leasesArg);
if (!dataDir || !email || !password || !(leases >= 0)) throw new Error("usage: seed-leased-account.mjs <dataDir> <email> <password> <leases>");
const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account } = await store.createAccount({ email, password, ceoName: "Royalty QA", corpName: `Royalty QA Corp ${Date.now()}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
store.mutateAccountState(account.id, (state) => {
  state.corp.currentStationId = "earth-station-prime";
  state.corp.inventory = { "earth-station-prime": { Silicates: 1000 } };
  state.corp.miningLeases = Array.from({ length: leases }, (_, i) => ({ id: `lease-royalty-${i}`, body: "Earth" }));
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
