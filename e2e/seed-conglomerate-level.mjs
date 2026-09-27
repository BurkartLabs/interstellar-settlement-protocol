// Companion to e2e/conglomerate-level.spec.js (ISP-203, AB#897): a level-1 conglomerate ready for level 2, founded,
// joined and funded through the server's own code (foundConglomerate, inviteCorporation, answerInvitation,
// depositToTreasury). One thing is set rather than played: the three days a level must be held, by moving levelSince
// back four days. Its founder is docked at the Bureau; a member is not.
//
// Usage: node e2e/seed-conglomerate-level.mjs <dataDir> <password>   (prints the logins as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-conglomerate-level.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "conglomerate-level-e2e-fixture-secret-0123456789";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { accountsStore } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { conglomerateList, foundConglomerate } = await import("../server/game/conglomerates.js");
const { inviteCorporation, answerInvitation } = await import("../server/game/membership.js");
const { depositToTreasury } = await import("../server/game/treasury.js");
const { CONGLOMERATE_CATALOG: C } = await import("../server/conglomerates.js");

const DAY = 86_400_000;
const stamp = Date.now().toString(36);
const logins = {};

async function corp(key, corpName, credits) {
  const email = `cong-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${corpName} CEO`, corpName: `${corpName} ${stamp.slice(-4)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  const raw = accountsStore.accounts[account.id];
  raw.createdAt = Date.now() - (C.minFounderAgeDays + 1) * DAY;
  raw.state.corp.currentStationId = C.charterStationId;
  raw.state.corp.finances.credits = credits;
  store.markWalkthroughCompleted(account.id);
  logins[key] = email;
  return account.id;
}

const founder = await corp("founder", "Helios Freight", 300_000);
const founded = foundConglomerate(founder, { name: `Helios Combine ${stamp.slice(-3)}`, emblem: 6, colour: 1 });
if (founded.refused) throw new Error(`founding: ${founded.refused.error}`);
const id = founded.conglomerate.id;
let memberId = null;
for (const [key, name] of [["member", "Kestrel Mining"], ["m2", "Vanta Holdings"], ["m3", "Orbital Salvage"]]) {
  const member = await corp(key, name, 20_000);
  if (key === "member") memberId = member;
  const publicId = accountsStore.accounts[member].state.corp.publicId;
  const inv = inviteCorporation(founder, id, publicId);
  if (inv.refused) throw new Error(`inviting: ${inv.refused.error}`);
  const invitationId = conglomerateList().find((c) => c.id === id).invitations.find((i) => i.corp === publicId).id;
  const joined = answerInvitation(member, id, invitationId, "accept");
  if (joined.refused) throw new Error(`joining: ${joined.refused.error}`);
}
accountsStore.accounts[memberId].state.corp.currentStationId = "mars-orbital-dock"; // a member away from the Bureau
const paid = depositToTreasury(founder, id, 60_000);
if (paid.refused) throw new Error(`depositing: ${paid.refused.error}`);
conglomerateList().find((c) => c.id === id).levelSince = Date.now() - 4 * DAY; // the 3 days at level 1, set not waited
await store.saveAccountsNow();
console.log(JSON.stringify(logins));
