// Companion to e2e/conglomerate-join-age.spec.js (Bug #4801): Orion, registered 10 days ago, has founded a conglomerate
// through the server's own foundConglomerate; Newcastle Mining was registered just now. Built with the server's own code
// in a separate process.
//
// Usage: node e2e/seed-join-age.mjs <dataDir> <email> <password>   (prints the logins as JSON)
const [, , dataDir, email, password] = process.argv;
if (!dataDir || !email || !password) throw new Error("usage: seed-join-age.mjs <dataDir> <email> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "join-age-e2e-fixture-secret-01234567890";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { accountsStore } = await import("../server/game/store.js");
const { foundConglomerate } = await import("../server/game/conglomerates.js");
const { CONGLOMERATE_CATALOG: C } = await import("../server/conglomerates.js");

const DAY = 86_400_000;
const stamp = Date.now().toString(36);
async function corporation(mail, corpName, ageDays) {
  const { account } = await store.createAccount({ email: mail, password, ceoName: `${corpName} CEO`, corpName });
  verifyEmailToken(issueVerificationToken(account.id));
  store.mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = C.charterStationId;
    state.corp.finances.credits = 1_000_000;
  }, { sanitize: false, settleMining: false });
  accountsStore.accounts[account.id].createdAt = Date.now() - ageDays * DAY;
  store.markWalkthroughCompleted(account.id);
  return account;
}

const founder = await corporation(email, `Orion Survey ${stamp.slice(-3)}`, 10);
const founded = foundConglomerate(founder.id, { name: `Orion Accord ${stamp.slice(-3)}`, emblem: 1, colour: 1 });
if (founded.refused) throw new Error(`founding: ${founded.refused.error}`);
await corporation(`join-age-fresh-${stamp}@example.test`, `Newcastle Mining ${stamp.slice(-3)}`, 0);
await store.saveAccountsNow();
process.stdout.write(JSON.stringify({ founder: email, fresh: `Newcastle Mining ${stamp.slice(-3)}` }) + "\n");
process.exit(0);
