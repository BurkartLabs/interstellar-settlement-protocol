// server/accountJson.js (Bug #4849): an account as the JSON a response sends, without copying it first.
//
// sanitizeAccount returns deepClone(state), JSON.parse(JSON.stringify(state)), so a caller cannot change the store
// through what it reads. A route that only sends the account paid for that copy and then stringified it again: two
// stringifies and a parse of the whole account on every GET /api/accounts/:id. This stringifies the held state once,
// with the same fields left out (the statements, and any world an old save kept), and splices in the public world,
// whose JSON is the same for every account and made once. What it returns is exactly
// JSON.stringify(sanitizeAccount(account)); tests/integration/account-json.test.js holds it to that.

import { ensureCorpRefs } from "./references.js";
import { publicWorld } from "./catalogView.js";

let worldJson = null;

/** The account as JSON, the same string JSON.stringify(sanitizeAccount(account)) would give. */
export function accountJson(account) {
  ensureCorpRefs(account?.state?.corp); // as sanitizeAccount does (ISP-249, AB#945)
  const { statements: _statements, world: _world, ...state } = account.state || {};
  worldJson ??= JSON.stringify(publicWorld());
  const stateJson = JSON.stringify(state);
  const withWorld = stateJson === "{}" ? `{"world":${worldJson}}` : `${stateJson.slice(0, -1)},"world":${worldJson}}`;
  const head = JSON.stringify({
    id: account.id,
    email: account.email,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt || null,
    walkthroughCompleted: account.walkthroughCompleted
  });
  return `${head === "{}" ? "{" : `${head.slice(0, -1)},`}"state":${withWorld}}`;
}
