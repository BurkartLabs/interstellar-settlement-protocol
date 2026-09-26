// Companion to e2e/salvage-assignment.spec.js: builds one account's fixture using the server's own
// account-creation code, then exits — a genuinely separate process, not an in-process import, for the same
// reason e2e/seed-logistics-account.mjs is (server/gameState.js's dataDir and accountsStore are computed once
// at first import and do not follow a later ISP_DATA_DIR change within one process).
//
// Usage: node e2e/seed-salvage-account.mjs <dataDir> <email> <password> <mode>
//   mode "offered": 0 credits, idle — the Salvage Assignment is offered, not yet accepted (Overview, ISP-298).
//   mode "active":  0 credits, accepted 1 of its 4 hours ago — a running countdown (Assignments, ISP-298).
//   mode "ready":   0 credits, accepted 5 hours ago — the 4 hours are already served, ready to complete.
const [, , dataDir, email, password, mode] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "salvage-e2e-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account } = await store.createAccount({ email, password, ceoName: "Salvage QA", corpName: `Salvage QA Corp ${Date.now()}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
store.mutateAccountState(account.id, (state) => {
  state.corp.currentStationId = "earth-station-prime";
  state.corp.finances.credits = 0;
  state.corp.mining.silicateExtractors = [];
  if (mode === "active") {
    state.corp.activeMissions = [{ ...store.salvageAssignmentOffer(), acceptedAt: Date.now() - 1 * 3_600_000 }];
  } else if (mode === "ready") {
    state.corp.activeMissions = [{ ...store.salvageAssignmentOffer(), acceptedAt: Date.now() - 5 * 3_600_000 }];
  }
});
store.markWalkthroughCompleted(account.id); // skip the one-time "Brief me" dialogue; not what this story tests
await store.saveAccountsNow();
