// Companion to e2e/arbitration.spec.js (ISP-243, AB#939): a world with cases before the Galactic Arbitration Council,
// built with the server's own code in a separate process. Nova Freight, docked at Earth Station Prime (where the Council
// sits), rents Kestrel Mining's fleet now, and Kestrel's readiness has fallen since the hire, so Nova has a record to
// file on. Nova also rented Halcyon Mining's fleet last week, filed on it, and the Council has ruled (upheld, refunded
// from escrow). Drift Salvage rents Nova's own fleet and has filed against Nova, so Nova is a respondent inside its
// window. Halcyon's case against Drift was dismissed. What is set rather than played: the owners' readiness logs (as
// the upkeep tick writes them when upkeep goes unpaid).
//
// Usage: node e2e/seed-arbitration.mjs <dataDir> <password>   (prints the logins as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-arbitration.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "arbitration-e2e-fixture-secret-0123456789a";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { accountsStore } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { formFleet } = await import("../server/fleets.js");
const { offerFleet, hireOffer, settleContracts } = await import("../server/mercenaries.js");
const { fileCase, arbitrationTick, decideAt, caseRecordForTests } = await import("../server/arbitration.js");

const H = 3_600_000, DAY = 24 * H;
const now = Date.now();
const stamp = now.toString(36);
const logins = {};
const must = (r, what) => { if (r?.refused || r?.ok === false) throw new Error(`${what}: ${JSON.stringify(r.refused || r.error)}`); return r; };

async function corp(key, name) {
  const email = `arbitration-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${name} CEO`, corpName: `${name} ${stamp.slice(-3)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  const c = accountsStore.accounts[account.id].state.corp;
  Object.assign(c, { currentSystemId: "sol", currentStationId: "earth-station-prime" });
  c.finances.credits = 400_000;
  c.military = { units: { lf: 10, ds: 2 } };
  store.markWalkthroughCompleted(account.id);
  logins[key] = email;
  return account.id;
}
/** `owner` offers a fleet and `renter` hires it at `at` for `termHours`; `drops` are readiness entries after the hire. */
function contract(owner, renter, at, termHours, drops, name) {
  let fleetId = null;
  store.mutateAccountState(owner, (s) => { const r = formFleet(s.corp, { units: { lf: 8, ds: 2 } }, at); if (!r.fleet) throw new Error(`${name} fleet: ${JSON.stringify(r)}`); fleetId = r.fleet.id; }, { sanitize: false });
  const offer = must(offerFleet(owner, fleetId, { termHours, price: 60_000, collateral: 15_000, allowedUse: "defense" }, at - H), `${name} offer`).offer;
  must(hireOffer(renter, offer.id, at), `${name} hire`);
  store.mutateAccountState(owner, (s) => { s.corp.military.readinessLog = [{ at, readiness: 100 }, ...drops.map(([h, r]) => ({ at: at + h * H, readiness: r }))]; }, { sanitize: false });
  return offer.id;
}

const nova = await corp("nova", "Nova Freight");
const kestrel = await corp("kestrel", "Kestrel Mining");
const halcyon = await corp("halcyon", "Halcyon Mining");
const drift = await corp("drift", "Drift Salvage");

// last week: Nova rented Halcyon's fleet, Halcyon's readiness fell, Nova filed, and the Council ruled at 00:00 UTC
const weekAgo = now - 8 * DAY;
const old = contract(halcyon, nova, weekAgo, 72, [[24, 90], [48, 80]], "Aurora");
const upheld = must(fileCase(nova, { type: "mercenary-readiness", recordId: old }, weekAgo + 30 * H), "Nova's case").case;
arbitrationTick(decideAt(caseRecordForTests(upheld.ref)));
settleContracts(now);

// also last week: Halcyon rented Drift's fleet; readiness never moved; Halcyon filed anyway, and was dismissed
const flat = contract(drift, halcyon, weekAgo + H, 24, [], "Lancer");
const dismissed = must(fileCase(halcyon, { type: "mercenary-readiness", recordId: flat }, weekAgo + 10 * H), "Halcyon's case").case;
arbitrationTick(decideAt(caseRecordForTests(dismissed.ref)));
settleContracts(now);

// now: Drift rents Nova's fleet, Nova's readiness has fallen, and Drift has filed: Nova answers inside the window
const mine = contract(nova, drift, now - 20 * H, 72, [[6, 90]], "Escort");
must(fileCase(drift, { type: "mercenary-readiness", recordId: mine }, now - 2 * H), "Drift's case");

// and Nova rents Kestrel's fleet now; Kestrel's readiness has fallen since the hire: Nova's record to file on
contract(kestrel, nova, now - 30 * H, 72, [[4, 90], [16, 80]], "Sentinel");

await store.saveAccountsNow();
console.log(JSON.stringify(logins));
