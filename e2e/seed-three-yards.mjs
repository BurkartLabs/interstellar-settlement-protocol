// Companion to e2e/yard-upkeep.spec.js (ISP-308, AB#2304): a corporation docked at Earth Station Prime with an office,
// five employees and one Earth lease holding three idle extractor yards, so the lease view shows the first two free of
// upkeep and the third paying it. Built with the server's own account code in a separate process (see
// seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-three-yards.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "yard-upkeep-e2e-fixture-secret-0123456789";
process.env.NODE_ENV = "test";

if (!dataDir || !email || !password) throw new Error("usage: seed-three-yards.mjs <dataDir> <email> <password>");
const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account } = await store.createAccount({ email, password, ceoName: "Upkeep QA", corpName: `Upkeep QA Corp ${Date.now()}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
const leaseId = "lease-upkeep-qa";
const idle = (n) => ({
  id: `ext-upkeep-${n}`, name: `Basic Extractor Yard #${n}`, tier: 1, active: false, startedAt: null, lastTickAt: null, endsAt: null,
  throughputPerHour: 40, operationCostPerHour: 0, totalMined: 0, minedThisCycle: 0, totalSpent: 0, leaseId, body: "Earth"
});
store.mutateAccountState(account.id, (state) => {
  const corp = state.corp;
  const now = Date.now();
  corp.currentStationId = "earth-station-prime";
  corp.offices = [{ stationId: "earth-station-prime", rentedAt: now, rentedUntil: now + 7 * 86_400_000, durationDays: 7 }];
  corp.employeeCount = 5;
  corp.buildingSlots = 3;
  corp.miningLeases = [{ id: leaseId, body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 3, extractorIds: [1, 2, 3].map((n) => `ext-upkeep-${n}`) }];
  const yard = { name: "Basic Extractor Yard", tier: 1, status: "Operational" };
  corp.buildings = [...(corp.buildings || []), yard, { ...yard }, { ...yard }];
  corp.mining.silicateExtractors = [idle(1), idle(2), idle(3)];
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
console.log(leaseId);
