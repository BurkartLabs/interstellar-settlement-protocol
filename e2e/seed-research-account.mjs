// Companion to e2e/research-level-lock.spec.js (Bug AB#2338): a corporation at the given level holding every Tier 1
// research and the research named on the command line, so a node's corporation level is the one thing between it and
// the queue. Built with the server's own account code in a separate process (see seed-logistics-account.mjs for why).
//
// Usage: node e2e/seed-research-account.mjs <dataDir> <email> <password> <level> <techId,techId,...>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [, , dataDir, email, password, level, techs] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "research-e2e-fixture-secret-0123456789abcd";
process.env.NODE_ENV = "test";

const tree = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "research.json"), "utf8")).nodes;
const store = await import("../server/gameState.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { account } = await store.createAccount({ email, password, ceoName: "Research QA", corpName: `Research QA Corp ${Date.now()}` });
verifyEmailToken(issueVerificationToken(account.id)); // AB#2288: a player who can log in has verified
store.mutateAccountState(account.id, (state) => {
  state.corp.level = Number(level);
  state.corp.unlockedTech = [...new Set([...tree.filter((n) => n.tier === 1).map((n) => n.id), ...String(techs || "").split(",").filter(Boolean)])];
  state.corp.finances.credits = 1_000_000;
});
store.markWalkthroughCompleted(account.id);
await store.saveAccountsNow();
