// Companion to e2e/jump-location.spec.js (Bug #4856): Orion left Alpha Centauri for Sol two hours ago and has just come
// out of the jump, not yet docked. Built with the server's own code in a separate process. One stand-in: the journey is
// written as POST /gameplay/travel writes it (server/routes/logistics.js), with its departure two hours back, instead of
// through HTTP; the arrival is the server's own travelTick.
//
// Usage: node e2e/seed-jump-arrival.mjs <dataDir> <password>   (prints the login as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-jump-arrival.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "jump-location-e2e-fixture-secret-01234567";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { accountsStore } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { travelTick } = await import("../server/ticks.js");

const H = 3_600_000;
const T = Date.now();
const stamp = T.toString(36);
const email = `jump-location-${stamp}@example.test`;
const { account } = await store.createAccount({ email, password, ceoName: "Orion CEO", corpName: `Orion Holdings ${stamp.slice(-3)}` });
verifyEmailToken(issueVerificationToken(account.id));
store.markWalkthroughCompleted(account.id);
const corp = accountsStore.accounts[account.id].state.corp;
Object.assign(corp, { currentSystemId: "alpha-centauri", currentStationId: null, location: "Proxima b", level: 10 });
corp.travel = { travelType: "interstellar", fromSystemId: "alpha-centauri", toSystemId: "sol", fromStationId: "centauri-prime-station", departedAt: T - 2 * H, arrivesAt: T - 60_000 };

travelTick(); // the server's own arrival
if (corp.travel || corp.currentSystemId !== "sol") throw new Error(`the jump did not land: ${JSON.stringify({ travel: corp.travel, system: corp.currentSystemId })}`);

await store.saveAccountsNow();
process.stdout.write(JSON.stringify({ email, location: corp.location }) + "\n");
process.exit(0);
