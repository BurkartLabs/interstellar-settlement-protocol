// Companion to e2e/inbox-markdown.spec.js (AB#2467): two corporations, and a conversation in which Kestrel sends Nova a
// message written in Markdown, then one made of real XSS payloads. Sent with the server's own code
// (sendConversationMessage, as POST /api/conversations/messages does), in a separate process.
//
// Usage: node e2e/seed-inbox-markdown.mjs <dataDir> <password>   (prints the logins as JSON)
const [, , dataDir, password] = process.argv;
if (!dataDir || !password) throw new Error("usage: seed-inbox-markdown.mjs <dataDir> <password>");
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "inbox-markdown-e2e-secret-0123456789abcd";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";
const store = await import("../server/gameState.js");
const { accountsStore } = await import("../server/game/store.js");
const { issueVerificationToken, verifyEmailToken } = await import("../server/emailVerification.js");
const { sendConversationMessage } = await import("../server/game/conversations.js");

export const FORMATTED = [
  "Hello **Nova Freight**, a *quick* offer:",
  "",
  "- 400 Silicates at 30 credits a tonne",
  "- 200 _Nickel_ at 55",
  "",
  "1. Dock at Earth Station Prime",
  "2. Accept on [the Exchange](https://example.com/gex)",
  "",
  "Reference `LIC-2147-ABC123`."
].join("\n");

export const HOSTILE = [
  "<script>window.__xss = 'script'</script>",
  '<img src=x onerror="window.__xss = \'img\'">',
  "**<svg onload=\"window.__xss = 'svg'\">**",
  "[claim your prize](javascript:window.__xss='link')",
  "[claim your prize](JAVASCRIPT:document.title='pwned')"
].join("\n");

const stamp = Date.now().toString(36);
const logins = {};
async function corp(key, name) {
  const email = `md-${key}-${stamp}@example.test`;
  const { account } = await store.createAccount({ email, password, ceoName: `${name} CEO`, corpName: `${name} ${stamp.slice(-3)}` });
  verifyEmailToken(issueVerificationToken(account.id));
  store.markWalkthroughCompleted(account.id);
  logins[key] = email;
  return account.id;
}
const kestrel = await corp("kestrel", "Kestrel Mining");
const nova = await corp("nova", "Nova Freight");
const to = accountsStore.accounts[nova].state.corp.publicId;
for (const body of [FORMATTED, HOSTILE]) {
  const r = sendConversationMessage(kestrel, { toCorpId: to, body });
  if (!r.ok) throw new Error(`send: ${JSON.stringify(r)}`);
}
await store.saveAccountsNow();
console.log(JSON.stringify(logins));
