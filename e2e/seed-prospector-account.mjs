// Companion to e2e/starmap-belt-tap.spec.js: a corporation docked at Ironwell Mining Depot in Barnard's Star that has
// researched Asteroid Prospecting, so Barnard's belt offers "Scout Asteroid Belt" (a belt in another system says to
// travel there first). Built with the server's own account code in a separate process (see seed-logistics-account.mjs
// for why).
//
// Usage: node e2e/seed-prospector-account.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "prospector-e2e-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account } = await store.createAccount({ email, password, ceoName: "Prospector QA", corpName: `Prospector QA Corp ${Date.now()}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
store.mutateAccountState(account.id, (state) => {
  state.corp.currentSystemId = "barnards-star";
  state.corp.currentStationId = "ironwell-depot";
  state.corp.unlockedTech = [...new Set([...(state.corp.unlockedTech || []), "tt-asteroid-prospecting"])];
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
