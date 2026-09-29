// Companion to e2e/building-repair.spec.js (ISP-287, AB#994): a defender at Earth Station Prime with a Refinery and an
// Orbital Shipyard, and an attacker whose siege-engine fleet was sent to raid it five hours ago, so the raid has arrived
// but has not been fought. The running server's raid tick fights it (every 30 seconds), and the damage the page shows
// is that battle's. Built with the server's own code in a separate process before the server starts.
//
// Usage: node e2e/seed-building-repair.mjs <dataDir> <password>   (prints the defender's e-mail as JSON)
const [, , dataDir, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "building-repair-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { accountsStore, saveStateNow } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { formFleet } = await import("../server/fleets.js");
const { declareRaid } = await import("../server/raids.js");

const EARTH = "earth-station-prime";
const DAY = 86_400_000, HOUR = 3_600_000;
const stamp = Date.now() % 100_000;
const now = Date.now();

async function corporation(name, { units = {}, garrison = 0, credits = 400_000, buildings = [] } = {}) {
  const email = `${name.toLowerCase().replace(/\W+/g, "-")}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${name} CEO`, corpName: name });
  verifyEmailToken(issueVerificationToken(account.id));
  store.mutateAccountState(account.id, (s) => {
    s.corp.currentStationId = EARTH;
    s.corp.level = 12;
    s.corp.buildingSlots = 8;
    s.corp.finances.credits = credits;
    s.corp.military = { units: { ...units, dt: garrison }, garrisons: garrison ? { [EARTH]: garrison } : {} };
    s.corp.inventory = { ...(s.corp.inventory || {}), [EARTH]: { Silicates: 50 } };
    s.corp.buildings = [...(s.corp.buildings || []), ...buildings];
  }, { sanitize: false, settleMining: false });
  accountsStore.accounts[account.id].createdAt = now - 30 * DAY;
  store.markWalkthroughCompleted(account.id);
  return { id: account.id, email, publicId: store.getAccountById(account.id).state.corp.publicId };
}

// 5,000 credits: enough to repair the Refinery (2,000), not the Shipyard (7,500)
const defender = await corporation("Kestrel Holdings", { garrison: 2, credits: 5_000, buildings: [
  { name: "Refinery", tier: 1, status: "Operational", paid: 40_000 },
  { name: "Orbital Shipyard", tier: 1, status: "Operational", paid: 60_000, condition: 55 }
] });
const attacker = await corporation("Helios Freight", { units: { se: 6, ds: 6 } });
let fleetId = null;
store.mutateAccountState(attacker.id, (s) => { fleetId = formFleet(s.corp, { units: { se: 6, ds: 6 }, name: "Halberd" }, now - 4 * DAY).fleet.id; }, { sanitize: false });
store.mutateAccountState(attacker.id, (s) => { s.corp.military.fleets.find((x) => x.id === fleetId).stationId = "luna-gateway"; }, { sanitize: false });
const raid = declareRaid(attacker.id, { fleetId, targetCorpId: defender.publicId, targetStationId: EARTH }, now - 5 * HOUR);
if (!raid.ok) throw new Error(`raid: ${raid.error}`);
if (raid.raid.arrivesAt > now) throw new Error("the raid has not arrived yet");

await store.saveAccountsNow();
saveStateNow();
console.log(JSON.stringify({ defender: defender.email, raidId: raid.raid.id }));
