// Companion to e2e/operations-protocol.spec.js (ISP-254 Bd, AB#4819): a corporation docked at Earth Station Prime with
// Assembly & Fabrication researched, an Assembly Facility built through construct(), and credits for a probe, so the
// spec can fabricate one through the page. Built with the server's own account code in a separate process (see
// seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-assembly-account.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "assembly-account-e2e-fixture-secret-012345";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { playerBuilding } = await import("../server/playerBuildings.js");
const { construct } = await import("../server/construction.js");
const { account } = await store.createAccount({ email, password, ceoName: "Assembly QA", corpName: `Assembly QA ${Date.now() % 100000}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
store.mutateAccountState(account.id, (state) => {
  const corp = state.corp;
  corp.currentSystemId = "sol";
  corp.currentStationId = "earth-station-prime";
  corp.level = 5;
  corp.buildingSlots = 6;
  corp.finances.credits = 2_000_000;
  corp.unlockedTech = [...new Set([...(corp.unlockedTech || []), "tt-assembly-fabrication", "tt-asteroid-prospecting"])];
  const built = construct(corp, playerBuilding("assembly-facility"), null);
  if (built.outcome !== "ok") throw new Error(`the Assembly Facility was not built: ${built.outcome}`);
}, { sanitize: false, settleMining: false });
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
process.exit(0);
