// Companion to e2e/v013-playthrough.spec.js (ISP-244, AB#940): three corporations at Verde Trade Hub, Tau Ceti (the
// tariff corridor, cap 5%), set up only with what the playthrough cannot do in the page in one sitting. Each stand-in
// says what it replaces; everything else is done in the page.
// - Orion (A): 14 days of control readings leading Tau Ceti, as the daily dominance computation writes them (a
//   petition needs 14 eligible days), and the week of mining and selling there that keeps it leading when the
//   server computes today's reading from the players' own counters (corp.dominance, recordExtraction/recordSale);
//   research done (Fusion Fuel Cycle completed two hours ago, first in the
//   galaxy, so it can be patented in the page); Earth Assembly standing 30 (what past trade taxes would have earned).
// - Bright (B): 3,000 Nickel at Verde Trade Hub and 1,000 at Kestrel Platform (Epsilon Eridani, next door, no holder:
//   the route around); Containment Physics researched, so it can research Fusion Fuel Cycle; Earth Assembly
//   standing 30, to oppose Orion's campaign.
// - Cinder (C): credits to buy what Bright sells.
// - The market: 12 days of Nickel trading at 24 credits, 2,000 a day, so the ITC's watch has a normal value.
// All three are at level 10 with walkthroughs done, so nothing but v0.13 stands in the way.
//
// Usage: node e2e/seed-v013-play.mjs <dataDir> <password>   (prints the logins as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-v013-play.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "v013-play-e2e-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { accountsStore, mutateState, saveStateNow } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { RESEARCH_LIBRARY } = await import("../server/game/catalog.js");
const { recordControlDay } = await import("../server/controlService.js");
const { recordTrade } = await import("../server/priceHistory.js");
const { recordExtraction, recordSale } = await import("../server/game/dominanceCounters.js");

const H = 3_600_000, DAY = 24 * H;
const now = Date.now();
const stamp = now.toString(36);
const logins = {};
const HUB = "verde-trade-hub", TAU = "tau-ceti";
const allBut = (skip) => Object.keys(RESEARCH_LIBRARY).filter((id) => !skip.includes(id));

async function corp(key, name, setup) {
  const email = `v013-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${name} CEO`, corpName: `${name} ${stamp.slice(-3)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  const raw = accountsStore.accounts[account.id];
  raw.createdAt = now - 30 * DAY;
  const c = raw.state.corp;
  Object.assign(c, { currentSystemId: TAU, currentStationId: HUB, location: "Verde", level: 10, buildingSlots: 10 });
  c.finances.credits = 2_000_000;
  setup(c);
  store.markWalkthroughCompleted(account.id);
  logins[key] = email;
  return { id: account.id, corp: c };
}

// Fusion Fuel Cycle (tier 3) is Orion's to patent: nobody else has it
const PATENTED = "tt-fusion-fuel-cycle";
const orion = await corp("orion", "Orion Holdings", (c) => {
  c.unlockedTech = allBut([]);
  c.researchCompletedAt = { [PATENTED]: now - 2 * H };
  c.standing = { "earth-assembly": 30, "interplanetary-trade-commission": 30 };
});
const bright = await corp("bright", "Bright Freight", (c) => {
  c.unlockedTech = allBut([PATENTED]);
  c.inventory = { [HUB]: { Nickel: 3000 }, "kestrel-platform": { Nickel: 1000 } };
  c.standing = { "earth-assembly": 30, "interplanetary-trade-commission": 30 };
});
const cinder = await corp("cinder", "Cinder Works", (c) => {
  c.unlockedTech = allBut([PATENTED]);
  c.finances.credits = 5_000_000;
});

// 14 days of control readings in Tau Ceti, Orion leading well past 40% and 1.5x, the newest two hours ago
const holderOf = (x) => ({ type: "corp", id: x.corp.publicId, name: x.corp.corporationName });
const group = (h, score) => ({ ...h, parts: { extraction: score, leases: score, sales: score } });
for (let i = 13; i >= 0; i -= 1) {
  recordControlDay({
    computedAt: now - 2 * H - i * DAY,
    holders: { [TAU]: { live: ["extraction", "leases", "sales"], groups: [group(holderOf(orion), 0.6), group(holderOf(bright), 0.25), group(holderOf(cinder), 0.15)] } }
  });
}

// The last week's work in Tau Ceti, as the players' own counters hold it: Orion mines and sells most, then Bright
for (let d = 6; d >= 0; d -= 1) {
  const at = now - d * DAY;
  recordExtraction(orion.corp, TAU, 4000, at); recordSale(orion.corp, HUB, 80_000, at);
  recordExtraction(bright.corp, TAU, 800, at); recordSale(bright.corp, HUB, 20_000, at);
  recordExtraction(cinder.corp, TAU, 200, at); recordSale(cinder.corp, HUB, 5_000, at);
}

// The Nickel market the ITC reads its normal value from: 12 days at 24 credits, 2,000 a day
mutateState((w) => {
  w.market.priceHistory = w.market.priceHistory || {};
  for (let d = 12; d >= 1; d -= 1) recordTrade(w.market.priceHistory, "Nickel", 24, 2000, now - d * DAY);
});

await store.saveAccountsNow();
await saveStateNow();
process.stdout.write(JSON.stringify({ ...logins, orionPublicId: orion.corp.publicId, brightPublicId: bright.corp.publicId }) + "\n");
process.exit(0);
