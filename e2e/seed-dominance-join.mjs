// Companion to e2e/dominance-join.spec.js (Bug #4802): Halcyon founds a conglomerate today; Cedar Trading, which sold
// heavily at Centauri Prime Station over the last days as an independent corporation, joins it today; Birch Freight,
// independent, sold less there. Built with the server's own code in a separate process (foundConglomerate,
// inviteCorporation, answerInvitation, and the counters' own recordSale); the sales themselves are stand-ins, recorded
// through recordSale as a settled sale would record them rather than traded through the exchange.
//
// Usage: node e2e/seed-dominance-join.mjs <dataDir> <email> <password>   (prints the logins as JSON)
const [, , dataDir, email, password] = process.argv;
if (!dataDir || !email || !password) throw new Error("usage: seed-dominance-join.mjs <dataDir> <email> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "dominance-join-e2e-fixture-secret-0123456";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { accountsStore } = await import("../server/game/store.js");
const { foundConglomerate } = await import("../server/game/conglomerates.js");
const { inviteCorporation, answerInvitation } = await import("../server/game/membership.js");
const { recordSale } = await import("../server/game/dominanceCounters.js");
const { CONGLOMERATE_CATALOG: C } = await import("../server/conglomerates.js");

const DAY = 86_400_000;
const now = Date.now();
const stamp = now.toString(36).slice(-3);
async function corporation(mail, corpName) {
  const { account } = await store.createAccount({ email: mail, password, ceoName: `${corpName} CEO`, corpName });
  verifyEmailToken(issueVerificationToken(account.id));
  store.mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = C.charterStationId;
    state.corp.finances.credits = 1_000_000;
  }, { sanitize: false, settleMining: false });
  accountsStore.accounts[account.id].createdAt = now - 10 * DAY;
  store.markWalkthroughCompleted(account.id);
  return account;
}
const must = (r, what) => { if (r?.refused) throw new Error(`${what}: ${r.refused.error}`); return r; };

const halcyon = await corporation(email, `Halcyon Mining ${stamp}`);
const cedar = await corporation(`dominance-join-cedar-${stamp}@example.test`, `Cedar Trading ${stamp}`);
const birch = await corporation(`dominance-join-birch-${stamp}@example.test`, `Birch Freight ${stamp}`);
// the week before: Cedar and Birch, both independent, sell at Centauri Prime Station
store.mutateAccountState(cedar.id, (s) => { for (const d of [2, 3, 4]) recordSale(s.corp, "centauri-prime-station", 60_000, now - d * DAY); }, { sanitize: false, settleMining: false });
store.mutateAccountState(birch.id, (s) => { for (const d of [2, 3]) recordSale(s.corp, "centauri-prime-station", 30_000, now - d * DAY); }, { sanitize: false, settleMining: false });
// today: Halcyon founds the Accord and Cedar joins it
const founded = must(foundConglomerate(halcyon.id, { name: `Halcyon Accord ${stamp}`, emblem: 1, colour: 1 }), "founding");
const cid = founded.conglomerate.id;
const inv = must(inviteCorporation(halcyon.id, cid, accountsStore.accounts[cedar.id].state.corp.publicId), "inviting Cedar");
must(answerInvitation(cedar.id, cid, inv.invitation.id, "accept"), "Cedar joining");
await store.saveAccountsNow();
process.stdout.write(JSON.stringify({ email, accord: `Halcyon Accord ${stamp}`, cedar: `Cedar Trading ${stamp}`, birch: `Birch Freight ${stamp}` }) + "\n");
process.exit(0);
