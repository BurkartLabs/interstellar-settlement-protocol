// Companion to e2e/forums-nested.spec.js (AB#2466): three corporations and a thread whose replies answer each other,
// down to seven levels, the shape a real exchange takes. Built with the server's own account code and its state store
// in a separate process; the replies are written as the reply route writes them (id, author, content, replyToId).
//
// Usage: node e2e/seed-forum-thread.mjs <dataDir> <password>   (prints the logins as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-forum-thread.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "forums-nested-e2e-fixture-secret-0123456789";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const store = await import("../server/gameState.js");
const { saveStateNow } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");

const now = Date.now();
const stamp = now.toString(36);
const logins = {};
const names = {};
for (const [key, name] of [["nova", "Nova Freight"], ["kestrel", "Kestrel Mining"], ["halcyon", "Halcyon Mining"]]) {
  const email = `forums-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${name} CEO`, corpName: `${name} ${stamp.slice(-3)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  store.markWalkthroughCompleted(account.id);
  logins[key] = email;
  names[key] = { id: account.id, name: `${name} ${stamp.slice(-3)}` };
}
let n = 0;
const reply = (who, content, replyToId) => ({ id: `rep-seed-${++n}`, author: names[who].name, authorAccountId: names[who].id, content, likes: 0, createdAt: now - (40 - n) * 60_000, ...(replyToId ? { replyToId } : {}) });
const r1 = reply("kestrel", "Has anyone filed on an Epsilon Indi petition yet? The Council's rule reads the extraction share at the review's end.");
const r2 = reply("halcyon", "We did. It is the share over the eligible days that counts, not the day you file.", r1.id);
const r3 = reply("nova", "So a late surge in extraction does nothing for a tie?", r2.id);
const r4 = reply("halcyon", "Nothing, unless it lasts the whole review.", r3.id);
const r5 = reply("kestrel", "Then the lead ratio is what matters, and the tie-break almost never runs.", r4.id);
const r6 = reply("nova", "Which is what the Director flagged on the design.", r5.id);
const r7 = reply("halcyon", "Agreed. Filed a note on it.", r6.id);
const r8 = reply("nova", "A separate question: does the petition fee come back if the Council finds for you?", r1.id);
const r9 = reply("kestrel", "No: it is a petition fee, kept either way.", r8.id);
const r10 = reply("halcyon", "Wolf 359 is the other arbitrated system, for what it is worth.");
store.mutateState((draft) => {
  draft.forums ||= {};
  draft.forums.threads = [{
    id: "thr-seed-arbitration", category: "Conglomerates & Diplomacy", title: "Arbitrated concessions: how the Council decides",
    author: names.kestrel.name, authorAccountId: names.kestrel.id, body: "A thread for what we have learned about petitions and challenges in Wolf 359 and Epsilon Indi.",
    likes: 0, createdAt: now - 45 * 60_000, replies: [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10]
  }, ...(draft.forums.threads || [])];
});
saveStateNow();
await store.saveAccountsNow();
console.log(JSON.stringify(logins));
