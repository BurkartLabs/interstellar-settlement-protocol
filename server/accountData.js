// server/accountData.js: a player's own data, exported and erased (ISP-264, AB#960; GDPR Articles 20 and 17).
//
// The server keeps its world in files under its data directory (server/game/catalog.js dataDir), not in database
// tables, so what the item calls "account-keyed tables" is DATA_FILES below: every file or folder the server writes
// there, and what it holds about an account. tests/integration/account-data.test.js finds each name the server joins
// onto its data directory (the scan tests/unit/runtimeDataIgnored.test.js makes) and fails until a new one is listed
// here, so a store added later cannot be missed by the export or the erasure.
//
// Export: everything held about the account, from each store that holds any, as JSON. Records are found by the
// account's id or its corporation's publicId, the only two ways a store names an account. Credentials are named but
// never exported (they are one-way hashes, and an export file is easy to leak).
//
// Erasure: after the password and the word DELETE (the route checks both), the account's email, password hash,
// sessions, one-time tokens, notifications and mail are erased. Its corporation stays in the world, so other players'
// trades, contracts, raids and cases still add up, but its name and its CEO's name are replaced, in every stored name
// field of every store, by ANONYMISED_CORPORATION_NAME; its CEO's name (not unique) by ANONYMISED_CEO_NAME on it alone. The account's record is kept as a
// tombstone with nothing that identifies a person, which no login, token or reset can reach. Every store is copied
// first; if any step throws, each is put back and nothing is left half-deleted (fails closed).
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { dataDir, deepClone } from "./game/catalog.js";
import { accountsStore, getState, mutateState, readStatements, saveAccountsNow, saveStateNow } from "./game/store.js";
import { ANONYMISED_CORPORATION_NAME, ANONYMISED_CEO_NAME } from "./game/world.js";
import { accountMailFiles, eraseAccountMail, exportAccountMail, restoreMailFiles } from "./game/conversations.js";
import { resetChatCache } from "./game/chatHistory.js";
import { ledgerEntries } from "./settlement.js";
import { itemLedgerEntries } from "./itemSettlement.js";
import { dataStore as arbitration } from "./arbitration.js";
import { dataStore as concessions } from "./concessions.js";
import { dataStore as controlHistory } from "./controlService.js";
import { dataStore as dominance } from "./dominanceService.js";
import { dataStore as itc } from "./itcService.js";
import { dataStore as lobbying } from "./lobbyingService.js";
import { dataStore as patents } from "./patents.js";
import { dataStore as tariffs } from "./tariffService.js";

export { ANONYMISED_CORPORATION_NAME, ANONYMISED_CEO_NAME };

/** The account record's credentials: erased, and never exported (named in the export as withheld). */
export const CREDENTIAL_FIELDS = Object.freeze(["passwordHash", "refreshTokens", "emailVerification", "passwordReset"]);
/** What erasure removes from the account record, beyond the credentials. */
const ERASED_FIELDS = Object.freeze(["email", "notifications", "messages", "lastLoginAt", "emailVerifiedAt", "verificationPolicy"]);

const FILE_STORES = [arbitration, concessions, controlHistory, dominance, itc, lobbying, patents, tariffs];
const LEGACY_INVESTMENTS = () => path.join(dataDir, "legacy-investments.json");
const CHAT_DIR = () => path.join(dataDir, "chat");

/**
 * Every name the server joins onto its data directory, and what it holds about one account: "account" (records of the
 * account, exported, and erased or anonymised), "shared" (shared history that names corporations: exported where it
 * names this one, anonymised on erasure) or "none" (nothing about any account).
 */
export const DATA_FILES = Object.freeze({
  "accounts-snapshot.json": "account", // the account record and corporation; bond series, share offerings, conglomerates
  "state.json": "shared", // the market, raids, forums, chat's recent lines, settlement balances
  statements: "account", // statements/<accountId>.json, the corporation's daily statements
  inbox: "account", // inbox/<accountId>.json, its conversations
  messages: "account", // messages/<conversationId>.jsonl, each conversation's messages
  chat: "shared", // chat/<channel>.jsonl: lines carry the author's corporation name, never an account id
  "settlement-ledger.jsonl": "account", // credits moved, from and to account ids
  "item-ledger.jsonl": "account", // goods moved, from and to account ids
  "legacy-investments.json": "account", // AB#852's archive: account id and corporation name
  "arbitration.json": "shared",
  "concessions.json": "shared",
  "control-history.json": "shared",
  "dominance.json": "shared",
  "itc.json": "shared",
  "lobbying.json": "shared",
  "patents.json": "shared",
  "tariffs.json": "shared",
  "stations-built.json": "none", // stations are owned by conglomerates, and name none of their members
  "references-salt": "none", // the server's reference salt
  "kanbanState.json": "none", // the dev kanban board under test (Bug #4828): cards, never a player
  telemetry: "none", // telemetry/<day>.jsonl: a random browser id, never an account id or email (ISP-256, AB#952)
  "x.json.tmp": "none" // a write in progress (safeWriteFile)
});

// ─── Finding an account in a store ───────────────────────────────────────────
const isRef = (v, refs) => typeof v === "string" && refs.has(v);
/** Whether `obj` names a ref in one of its own fields (a value, or an item of an array it holds). */
function namesDirectly(obj, refs) {
  return Object.values(obj).some((v) => isRef(v, refs) || (Array.isArray(v) && v.some((x) => isRef(x, refs))));
}
/**
 * The smallest records in `root` that name the account: every object that holds one of `refs` in a field of its own,
 * with the path it was found at. A record's children are not searched again once it is taken.
 */
export function recordsNaming(root, refs, at = "") {
  const out = [];
  const walk = (node, where) => {
    if (!node || typeof node !== "object") return;
    if (!Array.isArray(node) && namesDirectly(node, refs)) { out.push({ at: where || ".", record: node }); return; }
    for (const [k, v] of Object.entries(node)) walk(v, Array.isArray(node) ? `${where}[${k}]` : `${where}.${k}`);
  };
  walk(root, at);
  return out;
}

// ─── Anonymising names ───────────────────────────────────────────────────────
/** Whether a field holds a name: `name`, anything ending in Name (fromName, attackerName, corporationName…), author, ceo. */
const isNameField = (key) => /name$/i.test(key) || key === "author" || key === "ceo";
/**
 * Replace, everywhere under `root`, a name field holding one of the account's names with its label. Only exact values in
 * name fields: free text (a message body, a notification) is left as written. Returns how many were replaced.
 */
export function anonymiseNames(root, renames) {
  let n = 0;
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && !Array.isArray(node) && isNameField(k) && renames.has(v)) { node[k] = renames.get(v); n++; }
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(root);
  return n;
}

// ─── Export ──────────────────────────────────────────────────────────────────
const readJsonl = (file) => {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  return text.split("\n").filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
};
const chatFiles = () => { try { return fs.readdirSync(CHAT_DIR()).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(CHAT_DIR(), f)); } catch (e) { if (e.code === "ENOENT") return []; throw e; } };
const ledgerParty = (p) => (typeof p === "string" ? p : p?.accountId);

/** Everything the server holds about the account, by store (the keys are DATA_FILES' "account" and "shared" names). */
export function exportAccountData(accountId, now = Date.now()) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  const corp = account.state?.corp || {};
  const refs = new Set([accountId, corp.publicId].filter(Boolean));
  const record = Object.fromEntries(Object.entries(account).filter(([k]) => !CREDENTIAL_FIELDS.includes(k)));
  let legacy = [];
  try { legacy = JSON.parse(fs.readFileSync(LEGACY_INVESTMENTS(), "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const data = {
    "accounts-snapshot.json": {
      account: record,
      withheld: CREDENTIAL_FIELDS.filter((k) => k in account).map((field) => ({ field, why: "a security credential, held only as a one-way hash, and never exported" })),
      bondSeries: recordsNaming(accountsStore.bondSeries || [], refs, "bondSeries"),
      shareOfferings: recordsNaming(accountsStore.shareOfferings || [], refs, "shareOfferings"),
      conglomerates: recordsNaming(accountsStore.conglomerates || [], refs, "conglomerates")
    },
    "state.json": recordsNaming(getState(), refs),
    statements: readStatements(accountId),
    inbox: exportAccountMail(accountId).map(({ messages, ...conversation }) => conversation),
    messages: exportAccountMail(accountId).map(({ id, messages }) => ({ conversationId: id, messages })),
    // a chat line names its author only by corporation name: these are the lines under the current name
    chat: chatFiles().flatMap((file) => readJsonl(file).filter((line) => corp.corporationName && line.author === corp.corporationName)),
    "settlement-ledger.jsonl": ledgerEntries().filter((e) => refs.has(ledgerParty(e.from)) || refs.has(ledgerParty(e.to))),
    "item-ledger.jsonl": itemLedgerEntries().filter((e) => refs.has(ledgerParty(e.from)) || refs.has(ledgerParty(e.to))),
    "legacy-investments.json": (Array.isArray(legacy) ? legacy : []).filter((r) => refs.has(r?.accountId)),
    ...Object.fromEntries(FILE_STORES.map((s) => [s.file, recordsNaming(s.read(), refs)]))
  };
  return {
    format: "isp-account-data/1",
    exportedAt: new Date(now).toISOString(),
    accountId,
    corporation: { publicId: corp.publicId ?? null, name: corp.corporationName ?? null },
    note: "Everything the Interstellar Settlement Protocol holds about this account, by the store it is kept in. Records in shared stores (the market, forums, cases) are those that name this account or its corporation.",
    data
  };
}

// ─── Erasure ─────────────────────────────────────────────────────────────────
/** Check a deletion request: the account, its password and the confirmation word. { ok } or { outcome }. */
export function checkDeletion(accountId, { password, confirm } = {}) {
  const account = accountsStore.accounts?.[accountId];
  if (!account || account.deletedAt) return { outcome: "no-account" };
  if (confirm !== "DELETE") return { outcome: "not-confirmed" };
  if (typeof password !== "string" || !bcrypt.compareSync(password, String(account.passwordHash || ""))) return { outcome: "wrong-password" };
  return { ok: true };
}

/** Test seam: a step that throws part-way, to prove the rollback. */
let failAfter = null;
export function setErasureFaultForTests(step) { failAfter = step; }
const step = (name) => { if (failAfter === name) throw new Error(`erasure fault injected after ${name}`); };

/**
 * Erase the account (the caller has checked the request with checkDeletion). Returns { ok: true, label } or throws,
 * having put every store back as it was.
 */
export function eraseAccount(accountId, now = Date.now()) {
  const account = accountsStore.accounts[accountId];
  const corp = account.state?.corp || {};
  // A corporation's name is unique (store.js createAccount), so where it is stored it is this one's. A CEO's name is
  // not, so it is replaced on this corporation only, never where another could share it.
  const renames = new Map();
  if (corp.corporationName) renames.set(corp.corporationName, ANONYMISED_CORPORATION_NAME);

  // copies of everything that will change, to put back if a step fails
  const saved = {
    accounts: deepClone(accountsStore.accounts),
    lists: deepClone({ bondSeries: accountsStore.bondSeries, shareOfferings: accountsStore.shareOfferings, conglomerates: accountsStore.conglomerates }),
    world: deepClone(getState()),
    stores: FILE_STORES.map((s) => deepClone(s.read())),
    mail: accountMailFiles(accountId),
    files: Object.fromEntries([LEGACY_INVESTMENTS(), ...chatFiles()].map((f) => { try { return [f, fs.readFileSync(f, "utf8")]; } catch { return [f, null]; } }))
  };
  try {
    // shared history: every stored name field, in every store
    mutateState((world) => { anonymiseNames(world, renames); });
    for (const list of ["bondSeries", "shareOfferings", "conglomerates"]) anonymiseNames(accountsStore[list] || [], renames);
    for (const other of Object.values(accountsStore.accounts)) anonymiseNames(other, renames); // raid reports, old mail, its own corp
    step("world");
    for (const s of FILE_STORES) s.rewrite((held) => anonymiseNames(held, renames));
    step("files");
    for (const [file, text] of Object.entries(saved.files)) {
      if (text === null) continue;
      if (file === LEGACY_INVESTMENTS()) {
        const list = JSON.parse(text);
        if (anonymiseNames(list, renames)) fs.writeFileSync(file, JSON.stringify(list, null, 2));
      } else {
        const lines = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
        if (anonymiseNames(lines, renames)) fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      }
    }
    resetChatCache();
    step("chat");
    eraseAccountMail(accountId, ANONYMISED_CORPORATION_NAME);
    step("mail");
    // the account itself: a tombstone that identifies nobody and admits nobody
    for (const k of [...CREDENTIAL_FIELDS, ...ERASED_FIELDS]) delete account[k];
    if (account.state?.corp) account.state.corp.ceo = ANONYMISED_CEO_NAME;
    account.deletedAt = now;
    account.passwordChangedAt = Math.max(now, (Number(account.passwordChangedAt) || 0) + 1); // every access token is refused
    step("account");
    saveStateNow();
    saveAccountsNow();
    return { ok: true, label: ANONYMISED_CORPORATION_NAME };
  } catch (error) {
    // put everything back: nothing half-deleted. Each store on its own, so one that cannot be put back does not stop
    // the rest (and is reported).
    const restore = (what, fn) => { try { fn(); } catch (e) { console.error(`[account] rollback of ${what} failed:`, e?.message || e); } };
    restore("accounts", () => {
      for (const k of Object.keys(accountsStore.accounts)) delete accountsStore.accounts[k];
      Object.assign(accountsStore.accounts, saved.accounts);
      Object.assign(accountsStore, saved.lists);
    });
    restore("world", () => mutateState((world) => { for (const k of Object.keys(world)) delete world[k]; Object.assign(world, saved.world); }));
    FILE_STORES.forEach((s, i) => saved.stores[i] && restore(s.file, () => s.rewrite((held) => { for (const k of Object.keys(held)) delete held[k]; Object.assign(held, saved.stores[i]); })));
    restore("chat", () => { for (const [file, text] of Object.entries(saved.files)) if (text !== null) fs.writeFileSync(file, text); resetChatCache(); });
    restore("mail", () => restoreMailFiles(saved.mail));
    restore("saving", () => { saveStateNow(); saveAccountsNow(); });
    throw error;
  }
}
