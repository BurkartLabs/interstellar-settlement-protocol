// Companion to scripts/look-raids.mjs (ISP-181, AB#875): a world with a raid on its way to the viewer, a raid on it
// already fought (so it has a report, with goods taken and a building damaged), and corporations at Earth Station
// Prime in every state the target picker shows. Built with the server's own code in a separate process before the
// server starts (see seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-raids.mjs <dataDir> <password>   (prints the viewer's e-mail as JSON)
const [, , dataDir, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "raids-look-fixture-secret-0123456789abcdef";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { accountsStore, saveStateNow } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { formFleet } = await import("../server/fleets.js");
const { declareRaid, recallRaid } = await import("../server/raids.js");
const { raidTick } = await import("../server/raidResolution.js");

const EARTH = "earth-station-prime";
const DAY = 86_400_000, HOUR = 3_600_000, MIN = 60_000;
const stamp = Date.now() % 100_000;
const now = Date.now();

async function corporation(name, { days = 30, units = {}, garrison = 0, goods = null, buildings = [] } = {}) {
  const email = `${name.toLowerCase().replace(/\W+/g, "-")}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${name} CEO`, corpName: `${name}` });
  verifyEmailToken(issueVerificationToken(account.id));
  store.mutateAccountState(account.id, (s) => {
    s.corp.currentStationId = EARTH;
    s.corp.level = 12;
    s.corp.buildingSlots = 8;
    s.corp.finances.credits = 400_000;
    s.corp.military = { units: { ...units, dt: garrison }, garrisons: garrison ? { [EARTH]: garrison } : {} };
    if (goods) s.corp.inventory = { ...(s.corp.inventory || {}), [EARTH]: goods };
    s.corp.buildings = [...(s.corp.buildings || []), ...buildings];
  }, { sanitize: false, settleMining: false });
  accountsStore.accounts[account.id].createdAt = now - days * DAY;
  store.markWalkthroughCompleted(account.id);
  return { id: account.id, email, publicId: store.getAccountById(account.id).state.corp.publicId };
}
const fleet = (c, units, name) => {
  let id = null;
  store.mutateAccountState(c.id, (s) => { id = formFleet(s.corp, { units, name }, now - 4 * DAY).fleet.id; }, { sanitize: false });
  return id;
};
const must = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.error}`); return r; };

const viewer = await corporation("Kestrel Holdings", { units: { ds: 6, at: 12, lf: 4 }, garrison: 10, goods: { Silicates: 3_000, "Iron Ore": 1_200 }, buildings: [{ name: "Refinery", tier: 1, status: "Operational", paid: 40_000 }] });
const vanta = await corporation("Vanta Corsairs", { units: { ds: 8, at: 16 }, goods: { Silicates: 400 } });
const helios = await corporation("Helios Freight", { units: { se: 8, ds: 14, at: 24, lf: 10 }, goods: { Silicates: 200 } });
await corporation("Orion Salvage", { garrison: 4, goods: { Silicates: 900 } });
await corporation("Newco Mining", { days: 9, goods: { Silicates: 150 } });
const rigel = await corporation("Rigel Works", { goods: { Silicates: 600 } });
const drift = await corporation("Drift Co", { goods: { Silicates: 500 } });

const raiderFleet = fleet(viewer, { ds: 6, at: 12 }, "Corsair");
// the raiding fleet waits at Luna Gateway, so it is not caught in the defense of Earth
store.mutateAccountState(viewer.id, (s) => { s.corp.military.fleets.find((x) => x.id === raiderFleet).stationId = "luna-gateway"; }, { sanitize: false });
fleet(viewer, { lf: 4 }, "Talon");
const vantaFleet = fleet(vanta, { ds: 8, at: 16 }, "Vanguard");
const heliosFleet = fleet(helios, { se: 8, ds: 14, at: 24, lf: 10 }, "Halberd");

// the viewer raided Drift Co twice this week (both called off): the repeat limit
for (const at of [now - 3 * DAY, now - 2 * DAY]) {
  const r = must(declareRaid(viewer.id, { fleetId: raiderFleet, targetCorpId: drift.publicId, targetStationId: EARTH }, at), "raid on Drift").raid;
  must(recallRaid(viewer.id, r.id, at + MIN), "recall");
  store.mutateAccountState(viewer.id, (s) => { const f = s.corp.military.fleets.find((x) => x.id === raiderFleet); f.stationId = "luna-gateway"; f.transit = null; }, { sanitize: false });
}
// Rigel Works was raided by someone recently: its cooldown
store.mutateAccountState(rigel.id, (s) => { s.corp.raidCooldownUntil = now + 20 * HOUR; }, { sanitize: false, settleMining: false });

// Vanta's raid on the viewer: declared 2 hours ago, arriving in 2 (the incoming alert)
must(declareRaid(vanta.id, { fleetId: vantaFleet, targetCorpId: viewer.publicId, targetStationId: EARTH }, now - 2 * HOUR), "Vanta's raid");
// Helios's raid on the viewer: declared 5 hours ago, fought an hour ago (the report)
const hr = must(declareRaid(helios.id, { fleetId: heliosFleet, targetCorpId: viewer.publicId, targetStationId: EARTH }, now - 5 * HOUR), "Helios's raid").raid;
raidTick(hr.arrivesAt);

await store.saveAccountsNow();
saveStateNow();
console.log(JSON.stringify({ viewer: viewer.email }));
