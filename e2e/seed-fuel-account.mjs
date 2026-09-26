// Companion to e2e/fuel-track.spec.js (AB#830): a corporation docked at Frost Relay Depot in Ross 248 with every
// research done (Fusion Fuel Cycle included), a Refinery, and the Fuel track's four raw items in stock there, so the
// Refinery Chains tab offers the two new chains with their inputs on hand. Built with the server's own account code in a
// separate process (see seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-fuel-account.mjs <dataDir> <email> <password>
import fs from "node:fs";
const [, , dataDir, email, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "fuel-track-e2e-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";

const research = JSON.parse(fs.readFileSync(new URL("../data/research.json", import.meta.url), "utf8")).nodes.map((n) => n.id);
const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account } = await store.createAccount({ email, password, ceoName: "Fuel QA", corpName: `Fuel QA Corp ${Date.now()}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
store.mutateAccountState(account.id, (state) => {
  const corp = state.corp;
  corp.currentSystemId = "ross-248";
  corp.currentStationId = "frost-relay-depot";
  corp.finances.credits = 500_000;
  corp.unlockedTech = research;
  corp.refineries = [{ id: "ref-fuel-1", name: "Refinery #1", tier: 1, active: false, chainId: null, totalInputConsumed: 0, totalOutputProduced: 0 }];
  corp.inventory = { "frost-relay-depot": { "Helium-3": 200, Deuterium: 200, "Water Ice": 400, Hydrogen: 400 } };
});
store.markWalkthroughCompleted(account.id); // skip the one-time "Brief me" dialogue; not what this story tests
await store.saveAccountsNow();
