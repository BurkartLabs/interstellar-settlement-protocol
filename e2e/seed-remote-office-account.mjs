// Companion to e2e/claims-office-remote.spec.js (AB#1870): a corporation with an office at Earth Station Prime
// only, then docked at Mars Orbital Dock — the exact repro shape the bug named (an office elsewhere, none here).
//
// Usage: node e2e/seed-remote-office-account.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "remote-office-e2e-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { account } = await store.createAccount({ email, password, ceoName: "Remote Office QA", corpName: `Remote Office QA Corp ${Date.now()}` });
const now = Date.now();
store.mutateAccountState(account.id, (state) => {
  state.corp.offices = [{
    stationId: "earth-station-prime",
    name: "Earth Station Prime",
    body: "Earth",
    systemId: "sol",
    tier: 1,
    rentedAt: now,
    rentedUntil: now + 7 * 86_400_000,
    durationDays: 7
  }];
  state.corp.employeeCount = 10;
  state.corp.currentStationId = "mars-orbital-dock";
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
