// Companion to e2e/belt-depletion.spec.js (AB#2330): a corporation docked in Barnard's Star with the Rift Debris Ring
// scouted and a probe on it, and the ring down to its last 2 units, so the server's first expedition tick mines it out
// and brings the probe home early. Built with the server's own code in a separate process (see
// seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-depleting-belt.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "belt-depletion-e2e-fixture-secret-0123456789";
process.env.NODE_ENV = "test";

const BELT = "barnards-star:bn-rift";
const store = await import("../server/gameState.js");
const { saveStateNow } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account } = await store.createAccount({ email, password, ceoName: "Depletion QA", corpName: `Depletion QA Corp ${Date.now()}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
const now = Date.now();
store.mutateAccountState(account.id, (state) => {
  state.corp.currentSystemId = "barnards-star";
  state.corp.currentStationId = "ironwell-depot";
  state.corp.finances.credits = 50_000;
  state.corp.unlockedTech = [...new Set([...(state.corp.unlockedTech || []), "tt-asteroid-prospecting"])];
  state.corp.asteroidMining = {
    probeCount: 0, maxDeployments: 1, fabricationQueue: [], completedExpeditions: [], scoutedBelts: [BELT],
    activeExpeditions: [{
      id: "exp-e2e-2330", beltKey: BELT, systemId: "barnards-star", duration: "standard", generation: 1,
      deployedAt: now - 60_000, lastTickAt: now - 60_000, completesAt: now + 30 * 60_000, yields: { Nickel: 40 }, status: "active"
    }]
  };
}, { sanitize: false, settleMining: false });
store.mutateState((world) => { world.belts[BELT].remaining = 2; });
store.markWalkthroughCompleted(account.id); // skip the one-time "Brief me" dialogue; not what this story tests
await store.saveAccountsNow();
saveStateNow();
