// Companion to e2e/research-royalty.spec.js (Bug #4857): Orion completed Fusion Fuel Cycle first and patented it at 1%;
// Bright has done every node below it and may queue it. As in AB#940's playthrough, where the 120 credits were taken
// at completion with nothing said before. Built with the server's own code (filePatent, the patent office's own filing)
// in a separate process. One stand-in: Bright's finished research and Orion's completion are written onto their states,
// not researched through the R&D tick.
//
// Usage: node e2e/seed-patented-research.mjs <dataDir> <password>   (prints the logins as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-patented-research.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "research-royalty-e2e-fixture-secret-0123";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { accountsStore } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { filePatent } = await import("../server/patents.js");

const H = 3_600_000;
const T = Date.now();
const stamp = T.toString(36);
const NODE = "tt-fusion-fuel-cycle";
const tier = store.RESEARCH_LIBRARY[NODE].tier;
const below = Object.values(store.RESEARCH_LIBRARY).filter((n) => n.tier < tier).map((n) => n.id);
const logins = {};

async function corp(key, name) {
  const email = `research-royalty-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${name} CEO`, corpName: `${name} ${stamp.slice(-3)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  store.markWalkthroughCompleted(account.id);
  const raw = accountsStore.accounts[account.id].state;
  Object.assign(raw.corp, { level: 30, unlockedTech: [...below] });
  raw.corp.finances.credits = 200_000;
  raw.queues.corporateRnD = [];
  logins[key] = email;
  return { id: account.id, corp: raw.corp };
}
const orion = await corp("holder", "Orion Holdings");
orion.corp.unlockedTech.push(NODE);
orion.corp.researchCompletedAt = { [NODE]: T - 3 * H };
await corp("user", "Bright Logistics");
await store.saveAccountsNow();

const filed = filePatent(orion.id, { kind: "research", subjectId: NODE, ratePct: 1 }, T - 2 * H);
if (!filed.patent) throw new Error(`the patent was refused: ${JSON.stringify(filed)}`);

await store.saveAccountsNow();
process.stdout.write(JSON.stringify({ ...logins, node: NODE }) + "\n");
process.exit(0);
