// Companion to e2e/remote-dispatch.spec.js (Bug #4656): a conglomerate whose founder has scouted the Centauri Belt from
// Alpha Centauri, and a member docked in Sol with the research to reach it and probes to launch. Founded, joined and
// scouted through the server's own code (foundConglomerate, inviteCorporation, answerInvitation, recordBeltScouted).
//
// Usage: node e2e/seed-remote-dispatch.mjs <dataDir> <password>   (prints the logins as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-remote-dispatch.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "remote-dispatch-e2e-fixture-secret-0123456789";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { accountsStore } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { foundConglomerate } = await import("../server/game/conglomerates.js");
const { inviteCorporation, answerInvitation } = await import("../server/game/membership.js");
const { beltAt, recordBeltScouted } = await import("../server/game/belts.js");
const { RESEARCH_LIBRARY } = await import("../server/game/catalog.js");
const { CONGLOMERATE_CATALOG: C } = await import("../server/conglomerates.js");

const DAY = 86_400_000;
const stamp = Date.now().toString(36);
const logins = {};
async function corp(key, name, { systemId, stationId }) {
  const email = `remote-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${name} CEO`, corpName: `${name} ${stamp.slice(-4)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  const raw = accountsStore.accounts[account.id];
  raw.createdAt = Date.now() - (C.minFounderAgeDays + 1) * DAY;
  const c = raw.state.corp;
  c.finances.credits = 300_000;
  c.unlockedTech = Object.keys(RESEARCH_LIBRARY); // a mid-game corporation: every research, so its navigation reaches Alpha Centauri
  c.asteroidMining = { ...(c.asteroidMining || {}), probeCount: 3, maxDeployments: 3, activeExpeditions: [] };
  c.currentSystemId = systemId;
  c.currentStationId = stationId;
  store.markWalkthroughCompleted(account.id);
  logins[key] = email;
  return account.id;
}
const founder = await corp("founder", "Centauri Surveyors", { systemId: "sol", stationId: C.charterStationId });
const f = foundConglomerate(founder, { name: `Survey League ${stamp.slice(-3)}`, emblem: 3, colour: 3 });
if (f.refused) throw new Error(`founding: ${f.refused.error}`);
const member = await corp("member", "Helios Freight", { systemId: "sol", stationId: "earth-station-prime" });
const inv = inviteCorporation(founder, f.conglomerate.id, accountsStore.accounts[member].state.corp.publicId);
if (inv.refused || answerInvitation(member, f.conglomerate.id, inv.invitation.id, "accept").refused) throw new Error("joining");
const fc = accountsStore.accounts[founder].state.corp;
fc.currentSystemId = "alpha-centauri"; fc.currentStationId = "centauri-prime-station";
recordBeltScouted(fc.asteroidMining, beltAt(store.getState(), "alpha-centauri:ac-belt")); // scouted there, by the founder
await store.saveAccountsNow();
console.log(JSON.stringify(logins));
