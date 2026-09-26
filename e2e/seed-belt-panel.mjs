// Companion to e2e/belt-panel.spec.js (AB#2331): a corporation docked in Barnard's Star with its Rift Debris Ring
// scouted and 37% of its reserve left, a probe but only 100 credits (so a launch is refused), Sol's belt unscouted,
// and the Centauri Belt mined out. Mode "respawn" empties the Centauri Belt 100 hours ago instead, so the server's
// first hourly catch-up (a minute after it starts) forms a new one there all but certainly (0.8^100 of not).
// Built with the server's own code in a separate process (see seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-belt-panel.mjs <dataDir> <email> <password> <static|respawn>
const [, , dataDir, email, password, mode = "static"] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "belt-panel-e2e-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";

const RIFT = "barnards-star:bn-rift";
const CENTAURI = "alpha-centauri:ac-belt";
const store = await import("../server/gameState.js");
const { saveStateNow } = await import("../server/game/store.js");
const { markBeltEmpty } = await import("../server/game/belts.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account } = await store.createAccount({ email, password, ceoName: "Belt Panel QA", corpName: `Belt Panel QA Corp ${Date.now()}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
store.mutateAccountState(account.id, (state) => {
  state.corp.currentSystemId = "barnards-star";
  state.corp.currentStationId = "ironwell-depot";
  state.corp.finances.credits = 100;
  state.corp.unlockedTech = [...new Set([...(state.corp.unlockedTech || []), "tt-asteroid-prospecting"])];
  state.corp.asteroidMining = {
    probeCount: 1, maxDeployments: 1, fabricationQueue: [], activeExpeditions: [], completedExpeditions: [],
    scoutedBelts: [RIFT], scoutedGenerations: { [RIFT]: 1 }
  };
}, { sanitize: false, settleMining: false });
store.mutateState((world) => {
  const rift = world.belts[RIFT];
  rift.remaining = Math.floor(rift.reserve * 0.37);
  markBeltEmpty(world, CENTAURI, mode === "respawn" ? Date.now() - 100 * 3_600_000 : Date.now());
});
store.markWalkthroughCompleted(account.id); // skip the one-time "Brief me" dialogue; not what this story tests
await store.saveAccountsNow();
saveStateNow();
