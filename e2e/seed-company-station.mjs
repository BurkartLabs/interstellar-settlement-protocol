// Companion to e2e/company-station-screens.spec.js (ISP-250, AB#946): run after e2e/seed-industry-account.mjs on the
// same data directory, it gives that busy corporation what the Company and Station screens added since v0.5 draw: a
// conglomerate it founded (with a treasury), ships and troops, and a fleet. Built with the server's own code in a
// separate process, as the industry seed is.
//
// Usage: node e2e/seed-company-station.mjs <dataDir> <email>
const [, , dataDir, email] = process.argv;
if (!dataDir || !email) throw new Error("usage: seed-company-station.mjs <dataDir> <email>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "company-station-e2e-fixture-secret-012345";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { accountsStore } = await import("../server/game/store.js");
const { foundConglomerate } = await import("../server/game/conglomerates.js");
const { depositToTreasury } = await import("../server/game/treasury.js");
const { CONGLOMERATE_CATALOG: C } = await import("../server/conglomerates.js");
const { formFleet } = await import("../server/fleets.js");

const account = Object.values(accountsStore.accounts).find((a) => a?.email === email || a?.state?.email === email);
if (!account) throw new Error(`no account for ${email}`);
const now = Date.now();
account.createdAt = now - (C.minFounderAgeDays + 10) * 86_400_000;
store.mutateAccountState(account.id, (s) => {
  s.corp.finances.credits = Math.max(Number(s.corp.finances.credits) || 0, 400_000);
  s.corp.military = { units: { lf: 12, ds: 3, inf: 20 } };
  const r = formFleet(s.corp, { units: { lf: 8, ds: 2 } }, now);
  if (!r.fleet) throw new Error(`fleet: ${JSON.stringify(r)}`);
}, { sanitize: false });
const founded = foundConglomerate(account.id, { name: `Meridian Compact ${now.toString(36).slice(-3)}`, emblem: 4, colour: 2 });
if (founded.refused) throw new Error(`founding: ${founded.refused.error}`);
depositToTreasury(account.id, founded.conglomerate.id, 60_000);
await store.saveAccountsNow();
console.log("ok");
