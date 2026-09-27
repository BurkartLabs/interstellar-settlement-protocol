// Companion to e2e/patents.spec.js (ISP-237, AB#932): a world with three patents on file, built with the server's own
// code in a separate process. Kestrel Mining delivered the first run of the Nickel-Iron Alloy refining chain and patented
// it at 4%; Halcyon Mining patented Actinide Handling at 15%; Nova Freight, docked at Earth Station Prime (where the
// Registry is), patented Deep-Core Extraction at 12%, completed Fusion Fuel Cycle first five hours ago (so it may still
// file), and has run Kestrel's chain since, with a Refinery and 800 Nickel-Iron Alloy on hand. What is set rather than
// played: the completion records (as the R&D tick and a run's delivery write them), and the royalties on Nova's
// statements, because charging them is ISP-236 (AB#931), not on main yet.
//
// Usage: node e2e/seed-patents.mjs <dataDir> <password>   (prints the logins as JSON)
import fs from "node:fs";
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-patents.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "patents-e2e-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

// Tiers 1 and 2 only: a patentable node held with no completion record would make the Registry refuse every filing on it.
const research = JSON.parse(fs.readFileSync(new URL("../data/research.json", import.meta.url), "utf8")).nodes.filter((n) => n.tier < 3).map((n) => n.id);
const store = await import("../server/gameState.js");
const { accountsStore } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { filePatent } = await import("../server/patents.js");
const { ROYALTY_CATEGORY } = await import("../public/scripts/patentRoyalty.js");

const H = 3_600_000;
const now = Date.now();
const stamp = now.toString(36);
const logins = {};

async function corp(key, name, set) {
  const email = `patents-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${name} CEO`, corpName: `${name} ${stamp.slice(-3)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  const c = accountsStore.accounts[account.id].state.corp;
  Object.assign(c, { currentSystemId: "sol", currentStationId: "earth-station-prime", unlockedTech: research });
  c.finances.credits = 400_000;
  set(c);
  c.unlockedTech = [...new Set([...c.unlockedTech, ...Object.keys(c.researchCompletedAt || {})])];
  store.markWalkthroughCompleted(account.id);
  logins[key] = email;
  return account.id;
}
const must = (r, what) => { if (r?.refused) throw new Error(`${what}: ${r.refused.error}`); return r; };

const kestrel = await corp("kestrel", "Kestrel Mining", (c) => { c.chainFirstRunAt = { "pressure-vessel-chain": now - 20 * H }; });
const halcyon = await corp("halcyon", "Halcyon Mining", (c) => { c.researchCompletedAt = { "tt-actinide-handling": now - 40 * H }; });
const nova = await corp("nova", "Nova Freight", (c) => {
  c.researchCompletedAt = { "tt-deep-core-extraction": now - 30 * H, "tt-fusion-fuel-cycle": now - 5 * H };
  c.chainFirstRunAt = { "pressure-vessel-chain": now - 10 * H };
  c.refineries = [{ id: "ref-1", name: "Refinery #1", tier: 1, active: false, chainId: null, cyclesCompleted: 0, totalInputConsumed: 0, totalOutputProduced: 0 }];
  c.inventory = { "earth-station-prime": { "Nickel-Iron Alloy": 800 } };
  c.finances.incomeBySource = { ...(c.finances.incomeBySource || {}), [ROYALTY_CATEGORY]: 9_000 };
  c.finances.expensesByCategory = { ...(c.finances.expensesByCategory || {}), [ROYALTY_CATEGORY]: 1_290 };
});
must(filePatent(kestrel, { kind: "chain", subjectId: "pressure-vessel-chain", ratePct: 4 }, now - 19 * H), "Kestrel's patent");
must(filePatent(halcyon, { kind: "research", subjectId: "tt-actinide-handling", ratePct: 15 }, now - 39 * H), "Halcyon's patent");
must(filePatent(nova, { kind: "research", subjectId: "tt-deep-core-extraction", ratePct: 12 }, now - 29 * H), "Nova's patent");

await store.saveAccountsNow();
console.log(JSON.stringify(logins));
