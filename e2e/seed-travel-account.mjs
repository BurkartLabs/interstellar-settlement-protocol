// Companion to e2e/every-screen.spec.js (ISP-83, AB#772): a corporation part-way through a docking approach from Earth
// Station Prime to Luna Gateway, so the Travel screen shows its route, its progress and the time left. Built with the
// server's own account code in a separate process (see seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-travel-account.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "every-screen-e2e-fixture-secret-0123456789";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account } = await store.createAccount({ email, password, ceoName: "Travel QA", corpName: `Travel QA ${Date.now() % 100000}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
store.mutateAccountState(account.id, (state) => {
  const corp = state.corp;
  const now = Date.now();
  corp.currentSystemId = "sol";
  corp.currentStationId = null;
  corp.travel = {
    travelType: "local",
    fromStationId: "earth-station-prime",
    toStationId: "luna-gateway",
    toSystemId: "sol",
    departedAt: now - 10 * 60_000,
    arrivesAt: now + 30 * 60_000
  };
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
