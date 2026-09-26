// Companion to e2e/every-screen.spec.js (ISP-83, AB#772) and e2e/travel-screen.spec.js (AB#1053): a corporation in one of
// the Travel screen's three states. "local" (the default) is part-way through a docking approach from Earth Station Prime
// to Luna Gateway; "interstellar" is part-way through a jump from Sol to Alpha Centauri; "space" has arrived in Sol and
// is in open space, choosing a station to dock at. Built with the server's own account code in a separate process (see
// seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-travel-account.mjs <dataDir> <email> <password> [local|interstellar|space]
const [, , dataDir, email, password, kind = "local"] = process.argv;
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
  corp.travel = kind === "space" ? null : kind === "interstellar"
    ? { travelType: "interstellar", fromSystemId: "sol", toSystemId: "alpha-centauri", fromStationId: "earth-station-prime", departedAt: now - 2 * 3_600_000, arrivesAt: now + 4 * 3_600_000 }
    : { travelType: "local", fromStationId: "earth-station-prime", toStationId: "luna-gateway", toSystemId: "sol", departedAt: now - 10 * 60_000, arrivesAt: now + 30 * 60_000 };
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
