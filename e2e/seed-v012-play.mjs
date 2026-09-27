// ISP-220 (AB#915): the v0.12 playthrough's world, before anything in v0.12 has happened. Two players, A and B, each a
// corporation old enough to found a conglomerate (minFounderAgeDays), docked at Earth Station Prime with credits, two
// Sol leases, the goods a station needs and some Silicates to trade; and sixteen filler corporations for the
// membership counts the level ladder asks for. Nothing about conglomerates is seeded: A founds one in the UI.
// Usage: node e2e/seed-v012-play.mjs <dataDir> <emailA> <emailB> <password>
const [, , dataDir, emailA, emailB, password] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "construction-panel-e2e-fixture-secret-0123";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { accountsStore } = await import("../server/game/store.js");
const { billOfMaterials } = await import("../server/game/stationProjects.js");
const DAY = 86_400_000;
const bom = billOfMaterials();

async function corporation(email, corpName, ceoName, { goods = false } = {}) {
  const { account } = await store.createAccount({ email, password, ceoName, corpName });
  verifyEmailToken(issueVerificationToken(account.id));
  store.mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.currentStationId = "earth-station-prime";
    corp.finances.credits = 3_000_000;
    corp.level = 5;
    corp.miningLeases = ["Earth", "Mars"].map((body) => ({ id: `lease-${body.toLowerCase()}-${corpName.length}`, body, leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [], issuedAt: Date.now() }));
    const inv = ((corp.inventory ||= {})["earth-station-prime"] ||= {});
    inv.Silicates = (inv.Silicates || 0) + 2_000;
    corp.unlockedTech = [...new Set([...(corp.unlockedTech || []), "tt-asteroid-prospecting"])]; // to scout a belt: the intel shared
    if (goods) for (const [item, n] of Object.entries(bom.goods)) inv[item] = (inv[item] || 0) + n;
  }, { sanitize: false, settleMining: false });
  accountsStore.accounts[account.id].createdAt = Date.now() - 10 * DAY;
  store.markWalkthroughCompleted(account.id);
  return account;
}

await corporation(emailA, "Orion Survey Company", "Ada Orion", { goods: true });
await corporation(emailB, "Brightwater Haulage", "Bea Bright", { goods: true });
for (let i = 1; i <= 16; i += 1) await corporation(`filler-${i}-${Date.now()}@example.test`, `Filler Holdings ${String(i).padStart(2, "0")}`, `Filler CEO ${i}`);
await store.saveAccountsNow();
console.log("seeded");
