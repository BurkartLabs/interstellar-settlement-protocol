// Companion to e2e/expedition-return.spec.js: one account with an Alpha Centauri expedition that finishes a few
// seconds after the server starts, built with the server's own account code in a separate process (see
// e2e/seed-salvage-account.mjs for why it is a process and not an import).
//
// Usage: node e2e/seed-expedition-account.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "expedition-e2e-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account } = await store.createAccount({ email, password, ceoName: "Expedition QA", corpName: `Expedition QA Corp ${Date.now()}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
const now = Date.now();
store.mutateAccountState(account.id, (state) => {
  state.corp.currentStationId = "earth-station-prime";
  state.corp.asteroidMining = {
    probeCount: 0,
    activeExpeditions: [{
      id: "exp-e2e-1295", beltKey: "alpha-centauri:ac-belt", systemId: "alpha-centauri", duration: "short",
      deployedAt: now - 60_000, lastTickAt: now - 60_000, completesAt: now + 5_000, yields: {}, status: "active"
    }]
  };
}, { sanitize: false, settleMining: false });
store.markWalkthroughCompleted(account.id); // skip the one-time "Brief me" dialogue; not what this story tests
await store.saveAccountsNow();
