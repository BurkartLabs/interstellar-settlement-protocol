// Companion to e2e/concessions.spec.js (ISP-229, AB#924): a world with two concession holders and one petition under
// review, built with the server's own code in a separate process. Halcyon Mining (a corporation) holds Alpha Centauri,
// the Serpent Pact (a conglomerate) holds Luyten 726-8, Kestrel Mining's petition for Barnard's Star is in review, and
// Nova Freight, docked in Ross 248, is eligible there and has not petitioned. What is set rather than played: the 14
// days of control readings (recordControlDay, as the daily dominance computation writes them).
//
// Usage: node e2e/seed-concessions.mjs <dataDir> <password>   (prints the logins as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-concessions.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "concessions-e2e-fixture-secret-0123456789";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { accountsStore } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { foundConglomerate } = await import("../server/game/conglomerates.js");
const { depositToTreasury } = await import("../server/game/treasury.js");
const { RESEARCH_LIBRARY } = await import("../server/game/catalog.js");
const { CONGLOMERATE_CATALOG: C } = await import("../server/conglomerates.js");
const { recordControlDay } = await import("../server/controlService.js");
const { petitionConcession, reviewConcessions } = await import("../server/concessions.js");

const H = 3_600_000, DAY = 24 * H;
const now = Date.now();
const stamp = now.toString(36);
const logins = {};

async function corp(key, name, systemId, stationId) {
  const email = `concession-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${name} CEO`, corpName: `${name} ${stamp.slice(-3)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  const raw = accountsStore.accounts[account.id];
  raw.createdAt = now - (C.minFounderAgeDays + 10) * DAY;
  Object.assign(raw.state.corp, { currentSystemId: systemId, currentStationId: stationId, unlockedTech: Object.keys(RESEARCH_LIBRARY) });
  raw.state.corp.finances.credits = 400_000;
  store.markWalkthroughCompleted(account.id);
  logins[key] = email;
  return { id: account.id, corp: raw.state.corp };
}
const holderOf = (c) => ({ type: "corp", id: c.corp.publicId, name: c.corp.corporationName });

const halcyon = await corp("halcyon", "Halcyon Mining", "alpha-centauri", "centauri-prime-station");
const kestrel = await corp("kestrel", "Kestrel Mining", "barnards-star", "ironwell-depot");
const nova = await corp("nova", "Nova Freight", "ross-248", "frost-relay-depot");
const rival = await corp("rival", "Drift Salvage", "ross-248", "frost-relay-depot");
const serpentFounder = await corp("serpent", "Serpent Holdings", "sol", C.charterStationId);
const founded = foundConglomerate(serpentFounder.id, { name: `Serpent Pact ${stamp.slice(-3)}`, emblem: 9, colour: 5 });
if (founded.refused) throw new Error(`founding: ${founded.refused.error}`);
const serpent = { type: "conglomerate", id: founded.conglomerate.id, name: founded.conglomerate.name };
depositToTreasury(serpentFounder.id, serpent.id, 150_000);
serpentFounder.corp.currentSystemId = "luyten-726-8";
serpentFounder.corp.currentStationId = "twin-flare-outpost";

// 14 days of control readings, the newest two hours ago
const group = (h, score) => ({ type: h.type, id: h.id, name: h.name, parts: { extraction: score, leases: score, sales: score } });
for (let i = 13; i >= 0; i -= 1) {
  recordControlDay({
    computedAt: now - 2 * H - i * DAY,
    holders: {
      "alpha-centauri": { live: ["extraction", "leases", "sales"], groups: [group(holderOf(halcyon), 0.62), group(holderOf(nova), 0.18), group(holderOf(rival), 0.2)] },
      "luyten-726-8": { live: ["extraction", "leases", "sales"], groups: [group(serpent, 0.7), group(holderOf(rival), 0.3)] },
      "barnards-star": { live: ["extraction", "leases", "sales"], groups: [group(holderOf(kestrel), 0.5), group(holderOf(rival), 0.2)] },
      "ross-248": { live: ["extraction", "leases", "sales"], groups: [group(holderOf(nova), 0.55), group(holderOf(rival), 0.25), group(holderOf(kestrel), 0.2)] },
      sol: { live: ["extraction", "leases", "sales"], groups: [group(holderOf(halcyon), 0.4), group(holderOf(nova), 0.6)] }
    }
  });
}
const must = (r, what) => { if (r?.refused) throw new Error(`${what}: ${r.refused.error}`); return r; };
must(petitionConcession(halcyon.id, "alpha-centauri", now - 73 * H), "Halcyon's petition");
reviewConcessions(now - H); // 72 hours on: granted
must(petitionConcession(serpentFounder.id, "luyten-726-8", now - 30 * H), "the Serpent Pact's petition"); // unregulated: granted at once
must(petitionConcession(kestrel.id, "barnards-star", now - 5 * H), "Kestrel's petition"); // in review for 67 more hours

await store.saveAccountsNow();
console.log(JSON.stringify(logins));
