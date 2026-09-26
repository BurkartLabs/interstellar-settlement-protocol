// Companion to e2e/suites-flavor.spec.js: a corporation docked at the station named on the command line, built with
// the server's own account code in a separate process (see seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-docked-account.mjs <dataDir> <email> <password> <stationId>
const [, , dataDir, email, password, stationId] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "docked-e2e-fixture-secret-0123456789abcd";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account } = await store.createAccount({ email, password, ceoName: "Docked QA", corpName: `Docked QA Corp ${Date.now()}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
store.mutateAccountState(account.id, (state) => {
  state.corp.currentStationId = stationId;
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
