// Companion to e2e/starmap-dialogue.spec.js (ISP-82, AB#771): a corporation docked at Earth Station Prime in Sol with
// Assembly & Fabrication and Asteroid Prospecting researched, Sol's belt scouted, two probes, two deployment slots and
// one expedition out on the belt, so the Starmap's belt panel shows its composition, an expedition's progress and the
// launch form together. Built with the server's own account code in a separate process (see seed-logistics-account.mjs
// for why).
//
// Usage: node e2e/seed-starmap-account.mjs <dataDir> <email> <password>
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "starmap-dialogue-e2e-fixture-secret-012345";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account } = await store.createAccount({ email, password, ceoName: "Starmap QA", corpName: `Starmap QA ${Date.now() % 100000}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
store.mutateAccountState(account.id, (state) => {
  const corp = state.corp;
  const now = Date.now();
  corp.currentSystemId = "sol";
  corp.currentStationId = "earth-station-prime";
  corp.unlockedTech = [...new Set([...(corp.unlockedTech || []), "tt-assembly-fabrication", "tt-asteroid-prospecting"])];
  corp.asteroidMining = {
    ...(corp.asteroidMining || {}),
    probeCount: 2,
    maxDeployments: 2,
    scoutedBelts: ["sol:belt"],
    activeExpeditions: [{ id: "exp-e2e-starmap", beltKey: "sol:belt", systemId: "sol", duration: "standard", status: "active",
      deployedAt: now - 20 * 60_000, lastTickAt: now, completesAt: now + 40 * 60_000, yields: { Nickel: 18, Silicates: 9 } }]
  };
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
