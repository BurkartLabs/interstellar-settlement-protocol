// Companion to e2e/logistics-shipments.spec.js: builds one account's fixture using the server's own
// account-creation code, then exits — a genuinely separate process, not an in-process import, because
// server/gameState.js's dataDir and accountsStore are computed once at first import and do not follow a
// later change to ISP_DATA_DIR within the same process (T-029's family of ESM-caching surprises).
//
// Usage: node e2e/seed-logistics-account.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "logistics-e2e-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account } = await store.createAccount({ email, password, ceoName: "Logistics QA", corpName: `Logistics QA Corp ${Date.now()}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
store.mutateAccountState(account.id, (state) => {
  state.corp.currentStationId = "earth-station-prime";
  state.corp.inventory = { "centauri-prime-station": { Silicates: 500 } };
  state.corp.finances.credits = 50_000;
});
store.markWalkthroughCompleted(account.id); // skip the one-time "Brief me" dialogue; not what this story tests
await store.saveAccountsNow();
