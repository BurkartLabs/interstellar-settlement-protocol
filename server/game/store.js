// server/game/store.js: part of the game state, split out of server/gameState.js by system (AB#737).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { welcomeLetter } from "../../public/scripts/liaison.js";
import { closeDueDays, MAX_STATEMENTS } from "../finances.js";
import { unknownLeaseBodies } from "../leases.js";
import { reportAndArchiveInvestments } from "../legacyInvestments.js";
import { NAME_CHARS, validateCorporationName, SYSTEM_SENDERS } from "../corporationName.js";
import { settlePayroll, payrollNotice } from "../payroll.js";
import { PASSWORD_SALT_ROUNDS, SYSTEMS_DATA, accountsSnapshotPath, createId, dataDir, deepClone, safeWriteFile, statePath } from "./catalog.js";
import { evaluateAccountLevel, evaluateLevelProgress, pushSystemNotification, refreshExchangeTax, sanitizeNotification } from "./progression.js";
import { applyMiningOperations, ensureCorpMiningModel } from "./mining.js";
import { normalizeStateShape } from "./shape.js";
import { publicWorld } from "../catalogView.js"; // Bug #4852: the world an account is read with
import { createStarterCorporationState, refreshContractOfferings } from "./corporation.js";
import { backfillBuildingIds, ensureBuildingIds } from "./buildingIds.js";
import { backfillCorpMilitary, ensureCorpMilitary } from "./units.js";
import { backfillVerificationPolicy, loginBlockedByVerification, REQUIRED, verificationPrompted } from "./verificationPolicy.js";
import { RESERVED_CORPORATION_NAMES, ensureStateFile, getSeedState } from "./world.js";
import { reservedNamesError } from "../npcCorporations.js"; // AB#813: fail closed
import { migrateShareRegistries, rebuildHoldingIndexes } from "../shareRegistry.js"; // ISP-157 (AB#851), ISP-158 (AB#852)
import { ensureCorpRefs, referenceFor } from "../references.js"; // ISP-249 (AB#945)

// Bug #1480: the statements live in one file per corporation (declared here, before the load-time
// migration below uses it), written when a day closes, not in the accounts snapshot.
// That file is rewritten every few seconds, and 90 days of statements for 1,000 corporations would add 63 MB to it.
export const statementsDir = path.join(dataDir, "statements");
const statementsFile = (accountId) => path.join(statementsDir, `${encodeURIComponent(accountId)}.json`);

export let state = ensureStateFile();
export let saveTimer = null;
export let accountsSaveTimer = null;

// Bug #578: the accounts live in memory and in accounts-snapshot.json in the data directory, the only store until
// Postgres in v0.6 (Decision #591).
export function loadAccountsSnapshotFromDisk() {
  try {
    if (!fs.existsSync(accountsSnapshotPath)) return null;
    const raw = fs.readFileSync(accountsSnapshotPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.accounts) return null;
    return parsed;
  } catch (error) {
    console.warn("[accounts] Failed to load local accounts-snapshot.json:", error?.message || error);
    return null;
  }
}

export function writeAccountsSnapshotToDiskNow() {
  if (_diskSnapshotTimer) {
    clearTimeout(_diskSnapshotTimer);
    _diskSnapshotTimer = null;
  }
  try {
    // Compact (Bug #1480): about a third smaller than indented, and this file is rewritten every few seconds.
    safeWriteFile(accountsSnapshotPath, JSON.stringify(accountsStore));
  } catch (error) {
    logPersistError("[accounts] Failed to write local accounts snapshot", error);
  }
}

// Debounce disk snapshot writes so high-frequency mutations don't block the
// event loop with synchronous I/O (especially painful on OneDrive folders).
export let _diskSnapshotTimer = null;
export function writeAccountsSnapshotToDisk() {
  if (_diskSnapshotTimer) return;
  _diskSnapshotTimer = setTimeout(() => {
    _diskSnapshotTimer = null;
    writeAccountsSnapshotToDiskNow();
  }, 500);
  if (typeof _diskSnapshotTimer?.unref === "function") _diskSnapshotTimer.unref();
}

/** The accounts from the snapshot in the data directory, or the seed on a fresh install. */
export function loadAccountsStore(fallbackStore) {
  const local = loadAccountsSnapshotFromDisk();
  if (local) {
    console.warn(`[accounts] Restored ${Object.keys(local.accounts).length} account(s) from the snapshot in the data directory.`);
    return mergeDummyAccount(local, fallbackStore);
  }
  console.warn("[accounts] No accounts snapshot in the data directory; starting from the seed.");
  return fallbackStore;
}

/**
 * Ensure the in-memory `dummy` dev account survives loading a snapshot that lacks it. Mutates and returns
 * `hydrated` for chaining.
 */
export function mergeDummyAccount(hydrated, fallbackStore) {
  if (!hydrated || typeof hydrated !== "object") return hydrated;
  if (!hydrated.accounts || typeof hydrated.accounts !== "object") {
    hydrated.accounts = {};
  }
  const fallbackDummy = fallbackStore?.accounts?.dummy;
  if (fallbackDummy && !hydrated.accounts.dummy) {
    hydrated.accounts.dummy = fallbackDummy;
  }
  return hydrated;
}

/**
 * Create a fresh in-memory seed accounts store with a dummy dev account.
 * This is the store a fresh install starts with.
 *
 */
export function createSeedAccountsStore() {
  const seedState = normalizeStateShape(getSeedState());
  const dummyState = createStarterCorporationState(seedState, "Test Director", "Protocol Sandbox Dynamics");
  // Grant dummy account all research + nav techs for testing
  dummyState.corp.unlockedTech = [
    "tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast",
    "tt-energy-routing", "tt-fleet-coordination",
    "tt-proxima-navigation", "tt-deep-star-navigation"
  ];
  return {
    accounts: {
      dummy: {
        id: "dummy",
        email: "dummy@isp.local",
        passwordHash: bcrypt.hashSync("dummy-password", PASSWORD_SALT_ROUNDS),
        createdAt: Date.now(),
        refreshTokens: [],
        notifications: [],
        messages: [],
        walkthroughCompleted: false,
        state: dummyState
      }
    }
  };
}

export let accountsStore = loadAccountsStore(createSeedAccountsStore());

// Bug #691: leases used to accept any string as a body. Say how many stored leases name a body the catalog does not
// have, as a count only (no account, no name), and leave them in place: deleting a player's lease is a Board call.
{
  const unknown = unknownLeaseBodies(SYSTEMS_DATA, Object.values(accountsStore.accounts || {}));
  if (unknown) console.warn(`[leases] ${unknown} stored mining lease(s) name a body that is not in data/systems.json (Bug #691); left in place.`);
}
// Bug #711: saves from before corporations had a public id get one on load, so they can be addressed by mail.
backfillCorpPublicIds();
// AB#792: saves from before buildings had ids get them on load, once; later loads find them and change nothing.
if (backfillBuildingIds(accountsStore.accounts).migrated) scheduleAccountsSave();
// AB#861: saves from before the unit catalog keep their fighters, destroyers and siege engines as units, once
if (backfillCorpMilitary(accountsStore.accounts).migrated) scheduleAccountsSave();
// ISP-157 (AB#851): saves from before equity get each corporation's share registry, founder-owned, once
if (migrateShareRegistries(accountsStore.accounts)) scheduleAccountsSave();
// ISP-158 (AB#852): each investor's index of the corporations it holds shares in is derived from the registries
rebuildHoldingIndexes(accountsStore.accounts);
// AB#2288: accounts from before email verification are asked to verify at login, not refused; set once, here.
if (backfillVerificationPolicy(accountsStore.accounts)) scheduleAccountsSave();
// ISP-249 (AB#945), AB#963: every record's reference, at load, so reads never have to write one
if (Object.values(accountsStore.accounts || {}).map((a) => ensureCorpRefs(a?.state?.corp)).some(Boolean)) scheduleAccountsSave();
// Bug #4852: saves from before hold a copy of the whole world catalog in every account; it is dropped, once
{
  let dropped = 0;
  for (const account of Object.values(accountsStore.accounts || {})) if (account?.state && "world" in account.state) { delete account.state.world; dropped += 1; }
  if (dropped) scheduleAccountsSave();
}
// Bug #1480: statements saved inside the snapshot by the first version of AB#713 move to their own files.
{
  let moved = 0;
  for (const account of Object.values(accountsStore.accounts || {})) moved += fileStatements(account);
  if (moved) { console.warn(`[statements] moved ${moved} daily statement(s) out of the accounts snapshot into ${statementsDir} (Bug #1480).`); scheduleAccountsSave(); }
}
// Bug #689, ISP-158 (AB#852): what the removed POST /api/investments stored is reported, archived for the PM, and cleared
if (reportAndArchiveInvestments(accountsStore.accounts, path.join(dataDir, "legacy-investments.json")).cleared) scheduleAccountsSave();

// A write runs 300 ms after the first unsaved change. Later changes ride on that write rather than restarting the wait:
// restarting it meant nothing was written while changes kept coming (Bug #1447). The write reads the state when it
// runs, so it carries every change made before it.
export function scheduleSave() {
  if (saveTimer) return;

  saveTimer = setTimeout(() => {
    saveTimer = null;
    safeWriteFile(statePath, JSON.stringify(state, null, 2));
  }, 300);
}

/** Write the global state now, cancelling a pending debounced save. */
export function saveStateNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  safeWriteFile(statePath, JSON.stringify(state, null, 2));
}

export let _lastPersistErrorAt = 0;
export let _lastPersistErrorSig = "";

export function summarizePersistError(error) {
  const raw = String(error?.message || error || "unknown error");
  return raw.length > 400 ? `${raw.slice(0, 400)}\u2026 (truncated)` : raw;
}

export function logPersistError(prefix, error) {
  const message = summarizePersistError(error);
  // Signature ignores the message tail so transient outages collapse into
  // a single line per prefix instead of spamming.
  const signature = `${prefix}:${message.slice(0, 80)}`;
  const now = Date.now();
  // Keep the first error visible, but suppress duplicate spam bursts.
  if (signature === _lastPersistErrorSig && now - _lastPersistErrorAt < 15000) {
    return;
  }
  _lastPersistErrorSig = signature;
  _lastPersistErrorAt = now;
  console.error(`${prefix}:`, message);
}

export function scheduleAccountsSave() {
  writeAccountsSnapshotToDisk();
}

/**
 * Write the accounts and the global state to the data directory now. The graceful shutdown calls it, so a container
 * stopped for a new revision keeps the last changes (Bug #1153: the debounced writes it used to start never ran).
 */
export async function saveAccountsNow() {
  writeAccountsSnapshotToDiskNow();
  try {
    saveStateNow();
  } catch (error) {
    logPersistError("[state] Failed to write the global state", error);
  }
  return true;
}

export function getState() {
  return state;
}

export function mutateState(mutator) {
  mutator(state);
  scheduleSave();
  return state;
}

/** AB#995: chat lines per channel kept in memory; the same number as chatHistory.js's CHAT_WINDOW. */
const CHAT_WINDOW = 50;

export function appendChatMessage(channel, message) {
  mutateState((draft) => {
    // Backstop for Bug #749: the seed is the fix, but a message must never be dropped because a migration lost this.
    if (!draft.chatLog || typeof draft.chatLog !== "object") draft.chatLog = {};
    if (!Array.isArray(draft.chatLog[channel])) {
      draft.chatLog[channel] = [];
    }

    draft.chatLog[channel].push(message);

    // AB#995: only the design's window stays in memory (and state.json); older lines are in chatHistory.js's files
    if (draft.chatLog[channel].length > CHAT_WINDOW) {
      draft.chatLog[channel] = draft.chatLog[channel].slice(-CHAT_WINDOW);
    }
  });
}


export function sanitizeAccount(account) {
  // ISP-249 (AB#945): records from a save made before reference numbers get theirs the first time they are read. A read
  // schedules no write (AB#963): a reference is an HMAC of the record's id under the stored salt, so the next read gives
  // the same one, and the next write keeps it. Saves from before references get them all at load (below the imports).
  ensureCorpRefs(account?.state?.corp);
  // The daily statements (AB#713) stay out: up to 90 days of them would ride on every response and socket event. They
  // are served on their own by GET /finances/statements.
  // Bug #4852: nor the world an old save kept; the shared public view goes with every account instead
  const { statements: _statements, world: _world, ...state } = account.state || {};
  return {
    id: account.id,
    email: account.email,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt || null,
    walkthroughCompleted: account.walkthroughCompleted,
    state: { ...deepClone(state), world: publicWorld() }
  };
}


/** A corporation's closed statements, oldest first; empty when it has none. */
/** AB#842: the statements file's version (modified time, ms), 0 when there is none. The credit rating's basis. */
export function statementsVersion(accountId) {
  try { return fs.statSync(statementsFile(accountId)).mtimeMs; } catch { return 0; }
}

export function readStatements(accountId) {
  try {
    const list = JSON.parse(fs.readFileSync(statementsFile(accountId), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Move the days closeDueDays has just closed from the account to its statements file, keeping the newest 90. Also
 * moves statements an older save kept in the snapshot, on load. Returns how many were filed.
 */
export function fileStatements(account) {
  const fresh = account?.state?.statements;
  if (!account?.state || !Array.isArray(fresh)) return 0;
  delete account.state.statements;
  if (!fresh.length) return 0;
  fs.mkdirSync(statementsDir, { recursive: true });
  // Idempotent by day: a day closed again (the server stopped before the snapshot kept the advanced day book) replaces
  // the one filed before rather than appearing twice.
  const byDay = new Map(readStatements(account.id).map((st) => [st.dayStart, st]));
  for (const st of fresh) byDay.set(st.dayStart, st);
  const list = [...byDay.values()].sort((a, b) => a.dayStart - b.dayStart).slice(-MAX_STATEMENTS);
  safeWriteFile(statementsFile(account.id), JSON.stringify(list));
  return fresh.length;
}

/** Close any day that has ended (AB#713), before the corporation is read or changed, so each movement lands on its day. */
export function closeFinancialDays(account, now = Date.now()) {
  closeDueDays(account.state, now, state?.market || null);
  fileStatements(account);
}

/**
 * The corporation's closed daily statements, newest first, at most `days` of them (1 to 90). Closes any day that has
 * ended first, so a day missed while nobody looked is there on the next read. Null for an unknown account.
 */
export function getStatements(accountId, days = MAX_STATEMENTS, now = Date.now()) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  closeFinancialDays(account, now); // a day that closed files its own statements (fileStatements); nothing else to write
  const count = Math.max(1, Math.min(MAX_STATEMENTS, Math.floor(Number(days) || MAX_STATEMENTS)));
  const all = readStatements(accountId);
  const book = account.state.corp?.finances?.dayBook || null;
  return { statements: deepClone(all.slice(-count).reverse()), today: book ? deepClone(book) : null };
}

// Bug #1097: payroll, settled by the mining ticker (server/index.js) for every account. Imported beside its use.

/**
 * Charge an account's payroll up to `now`, and tell the player when wages go unpaid or are paid again. Only the
 * ticker calls it, so reading an account, or a request that is refused, never changes it.
 */
export function settleAccountPayroll(accountId, now = Date.now()) {
  const account = accountsStore.accounts?.[accountId];
  if (!account?.state?.corp) return null;
  const result = settlePayroll(account.state.corp, now);
  const notice = payrollNotice(account.state.corp, result);
  if (notice) pushSystemNotification(account, notice);
  if (result.paid > 0 || notice) scheduleAccountsSave();
  return result;
}

export function getAccountById(accountId) {
  const account = settledAccount(accountId);
  return account ? sanitizeAccount(account) : null;
}
/** The account as held, settled as a read settles it: for a caller that only serialises it (Bug #4849). Never change it. */
export function settledAccount(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  closeFinancialDays(account);
  applyMiningOperations(account.state.corp);
  refreshContractOfferings(account.state.corp);
  evaluateAccountLevel(accountId, account); // a read can raise the level too: mining settles here (Bug #1260)
  // Bug #4815 (AB#963): a read schedules no write. What it settled is time-derived: the next read settles it the same
  // way, and the next change or ticker writes it (scheduling here rewrote the snapshot about once a second under traffic).
  return account;
}

export async function authenticateAccount(email, password) {
  // Bug #2050: a password of {"x":1} was compared as "[object Object]". Anything but two strings signs nobody in.
  if (typeof email !== "string" || typeof password !== "string") return null;
  const normalizedEmail = String(email || "").toLowerCase();
  const normalizedPassword = String(password || "");
  const account = Object.values(accountsStore.accounts || {}).find(
    (item) => item.email?.toLowerCase() === normalizedEmail
  );

  if (!account) {
    return null;
  }

  const isValidPassword = bcrypt.compareSync(normalizedPassword, String(account.passwordHash || ""));
  if (!isValidPassword) {
    return null;
  }
  // AB#2288: the right password, but an address never verified: refused before the login changes anything.
  if (loginBlockedByVerification(account)) return { blocked: "email-unverified" };

  applyMiningOperations(account.state.corp);
  refreshContractOfferings(account.state.corp);
  account.lastLoginAt = Date.now();
  pushSystemNotification(account, {
    type: "auth",
    protocol: { meaning: "complete", screen: "login" }, // ISP-254 C2 (AB#4812)
    title: "Secure Access Granted",
    body: "Authentication successful. Welcome back to command."
  });
  if (verificationPrompted(account)) {
    pushSystemNotification(account, {
      type: "auth",
      protocol: { meaning: "pending", screen: "check-email" }, // ISP-254 C2 (AB#4812)
      title: "Verify your email address",
      body: "Confirm the address you log in with: open /check-email.html and ask for a link. Your account keeps working meanwhile."
    });
  }
  scheduleAccountsSave();

  return sanitizeAccount(account);
}

// ISP-66: boundaries checked at the registration boundary, before anything is hashed or stored.
export const EMAIL_MAX_LENGTH = 254; // RFC 5321's practical mailbox-address limit
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** The password rule, in one place for registration and reset (AB#988): the refusal, or null for a good password. */
export function passwordRuleError(password) {
  if (typeof password === "string" && password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH) return null;
  return { error: `Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`, field: "password" };
}

/**
 * Set a new password (AB#988) and revoke every refresh token the account holds, so each signed-in device has to log
 * in again. The caller has checked passwordRuleError. Access tokens issued before it stop working too: each carries
 * the passwordChangedAt it was issued under, and server/auth.js refuses one that no longer matches (Bug #2291).
 */
export function setAccountPassword(accountId, password, now = Date.now()) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return false;
  account.passwordHash = bcrypt.hashSync(password, PASSWORD_SALT_ROUNDS);
  account.passwordChangedAt = now;
  account.refreshTokens = [];
  scheduleAccountsSave();
  return true;
}

/** When the account's password was last changed (ms), 0 if never or no such account: what an access token must carry (Bug #2291). */
export function passwordChangedAtOf(accountId) {
  return Number(accountsStore.accounts?.[accountId]?.passwordChangedAt) || 0;
}

export const CEO_NAME_MIN_LENGTH = 2;
export const CEO_NAME_MAX_LENGTH = 40;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createAccount({ email, password, ceoName, corpName }) {
  // Bug #2050: every field must arrive as a string. String() made a password of {"x":1} into "[object Object]", a
  // password anyone can guess, and a one-element array into its element. A wrong type gets the message and field its
  // length or shape rule gives, and the value is never read.
  if (typeof email !== "string") return { error: "Enter a valid email address.", field: "email" };
  const passwordError = passwordRuleError(password);
  if (typeof password !== "string") return passwordError;
  if (typeof ceoName !== "string") {
    return { error: `CEO name must be ${CEO_NAME_MIN_LENGTH} to ${CEO_NAME_MAX_LENGTH} characters.`, field: "ceoName" };
  }
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");
  const normalizedCeoName = String(ceoName || "").trim().replace(/\s+/g, " ");

  if (!normalizedEmail || normalizedEmail.length > EMAIL_MAX_LENGTH || !EMAIL_SHAPE.test(normalizedEmail)) {
    return { error: "Enter a valid email address.", field: "email" };
  }

  if (passwordError) {
    return passwordError;
  }

  // Bug #1187: no stand-in name, so an empty field is refused here rather than defaulted — the same reasoning that
  // already applies to corpName. Same character set as a corporation name (NAME_CHARS): a name is a name.
  if (normalizedCeoName.length < CEO_NAME_MIN_LENGTH || normalizedCeoName.length > CEO_NAME_MAX_LENGTH) {
    return { error: `CEO name must be ${CEO_NAME_MIN_LENGTH} to ${CEO_NAME_MAX_LENGTH} characters.`, field: "ceoName" };
  }
  if (!NAME_CHARS.test(normalizedCeoName)) {
    return { error: "CEO name may use letters, digits, spaces and - ' . & only.", field: "ceoName" };
  }

  const existing = Object.values(accountsStore.accounts || {}).find((item) => item.email === normalizedEmail);
  if (existing) {
    // Bug #1059: the code lets the page offer the login instead.
    return { error: "An account with this email already exists.", code: "email-taken", field: "email" };
  }

  // Bug #433: the name is the only trust signal on the order book, the forums and in mail. Checked before anything is
  // created: 3 to 40 plain characters, unique ignoring case and spacing, and not the name of
  // anything the game itself speaks as.
  // AB#813: without the reserved list every name would pass, so registration is refused until it can be read.
  if (reservedNamesError) {
    return { error: "Registration is unavailable just now; try again later.", code: "names-unavailable" };
  }
  const corporation = validateCorporationName(corpName, {
    existingNames: Object.values(accountsStore.accounts || {}).map((item) => item?.state?.corp?.corporationName).filter(Boolean),
    reservedNames: RESERVED_CORPORATION_NAMES
  });
  if (corporation.error) {
    return { error: corporation.error, field: "corpName" };
  }

  const accountId = createId("acc");
  const passwordHash = bcrypt.hashSync(normalizedPassword, PASSWORD_SALT_ROUNDS);

  const seedState = normalizeStateShape(getSeedState());
  const nextState = createStarterCorporationState(
    seedState,
    normalizedCeoName,
    corporation.name
  );

  const account = {
    id: accountId,
    email: normalizedEmail,
    passwordHash,
    walkthroughCompleted: false,
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
    verificationPolicy: REQUIRED, // AB#2288: logs in once its email is verified
    refreshTokens: [],
    notifications: [],
    messages: [],
    state: nextState
  };

  pushSystemNotification(account, {
    type: "system",
    protocol: { meaning: "active", screen: "register" }, // ISP-254 C2 (AB#4812): the charter is in force
    title: "Corporation Registered",
    body: "Your corporation charter is now active under the Interstellar Settlement Protocol."
  });

  // The letter's text lives in public/scripts/liaison.js with the coordinator who signs it (AB#585).
  // ISP-249 (AB#945): the licence's reference, the corporation's own and not its account id
  nextState.corp.licenceRef = referenceFor("LIC", nextState.corp.publicId, account.createdAt);
  pushSystemMessage(account, welcomeLetter(corpName, nextState.corp.licenceRef));

  accountsStore.accounts[accountId] = account;
  scheduleAccountsSave();

  return { account: sanitizeAccount(account) };
}

/**
 * AB#989: take back an account registration just created when its verification email could not be sent, so a failed
 * send leaves nothing behind (no email or corporation name held by an account nobody can verify). Only an account
 * that has never verified its address can be removed this way. Returns whether it was removed.
 */
export function removeUnverifiedAccount(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account || account.emailVerifiedAt) return false;
  delete accountsStore.accounts[accountId];
  scheduleAccountsSave();
  return true;
}

export function listAccountNotifications(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  const notifications = (account.notifications || []).map(sanitizeNotification);
  return {
    notifications,
    unreadCount: notifications.filter((item) => !item.readAt).length
  };
}

export function addAccountNotification(accountId, payload) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  pushSystemNotification(account, payload);
  scheduleAccountsSave();
  return sanitizeNotification(account.notifications[0]);
}

export function markNotificationRead(accountId, notificationId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  const target = (account.notifications || []).find((item) => item.id === notificationId);
  if (!target) {
    return null;
  }

  if (!target.readAt) {
    target.readAt = Date.now();
    scheduleAccountsSave();
  }

  return sanitizeNotification(target);
}

export function markAllNotificationsRead(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  const now = Date.now();
  (account.notifications || []).forEach((item) => {
    if (!item.readAt) {
      item.readAt = now;
    }
  });

  scheduleAccountsSave();
  return listAccountNotifications(accountId);
}

export function pushSystemMessage(account, { subject, body, fromName = SYSTEM_SENDERS.SYSTEM }) {
  if (!Array.isArray(account.messages)) account.messages = [];
  account.messages.unshift({
    id: createId("msg"),
    fromType: "system",
    fromId: "system",
    fromName,
    toAccountId: account.id,
    toName: account.state?.corp?.corporationName || "",
    subject,
    body,
    sentAt: Date.now(),
    readAt: null,
    folder: "inbox",
    trashedAt: null
  });
}

/** Give every corporation that lacks one a publicId. Returns how many were added. */
export function backfillCorpPublicIds() {
  let added = 0;
  for (const account of Object.values(accountsStore.accounts || {})) {
    const corp = account?.state?.corp;
    if (corp && !corp.publicId) { corp.publicId = createId("corp"); added++; }
  }
  if (added) scheduleAccountsSave();
  return added;
}

export function accountExists(accountId) {
  return Boolean(accountsStore.accounts?.[accountId]);
}

export function getAllAccountIds() {
  return Object.keys(accountsStore.accounts || {});
}

/**
 * Bug #4816 (AB#963): a corporation as held, for a scan that only looks for something: no settling, no copy, nothing
 * scheduled. getAccountById settles mining and deep-copies the whole account, about 3 ms at release scale, so a ticker
 * that called it for every account to find a rare loan, raid move or listing spent seconds finding none. Read only:
 * never change what it returns; settle and change the few it finds through getAccountById or mutateAccountState.
 */
export function peekCorp(accountId) {
  return accountsStore.accounts?.[accountId]?.state?.corp ?? null;
}

// Bug #1765: a refresh token is a bearer credential good for up to 30 days, and account.refreshTokens is
// persisted to accounts-snapshot.json as-is. Unlike passwordHash (bcrypt, one-way), storing the token itself
// meant a leaked snapshot handed out live, usable-as-is tokens with no cracking required. Only ever compared
// for exact equality against a client-presented token (never a user-typed value, so no salt is needed, the way
// a password's would be), so a plain SHA-256 digest is stored instead — same shape as passwordHash, one-way.
function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// TODO(AB#757): Evaluate usage of Refresh Tokens
export function storeRefreshToken(accountId, token, expiresAt) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return false;
  }

  if (!Array.isArray(account.refreshTokens)) {
    account.refreshTokens = [];
  }

  account.refreshTokens.push({ token: hashRefreshToken(token), expiresAt: Number(expiresAt || 0) });
  account.refreshTokens = account.refreshTokens
    .filter((item) => item.expiresAt > Date.now())
    .slice(-10);
  scheduleAccountsSave();
  return true;
}

export function revokeRefreshToken(accountId, token) {
  const account = accountsStore.accounts?.[accountId];
  if (!account || !Array.isArray(account.refreshTokens)) {
    return false;
  }

  const hashed = hashRefreshToken(token);
  const before = account.refreshTokens.length;
  account.refreshTokens = account.refreshTokens.filter((item) => item.token !== hashed);
  if (account.refreshTokens.length !== before) {
    scheduleAccountsSave();
    return true;
  }

  return false;
}

export function hasRefreshToken(accountId, token) {
  const account = accountsStore.accounts?.[accountId];
  if (!account || !Array.isArray(account.refreshTokens)) {
    return false;
  }

  const now = Date.now();
  account.refreshTokens = account.refreshTokens.filter((item) => item.expiresAt > now);
  return account.refreshTokens.some((item) => item.token === hashRefreshToken(token));
}

export function getDummyAccount() {
  applyMiningOperations(accountsStore.accounts.dummy.state.corp);
  evaluateLevelProgress(accountsStore.accounts.dummy.state);
  scheduleAccountsSave();
  return sanitizeAccount(accountsStore.accounts.dummy);
}

export function markWalkthroughCompleted(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  account.walkthroughCompleted = true;
  account.state.playerProfile.walkthroughCompleted = true;
  scheduleAccountsSave();
  return sanitizeAccount(account);
}

export function resetWalkthroughCompletion(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  account.walkthroughCompleted = false;
  account.state.playerProfile.walkthroughCompleted = false;
  scheduleAccountsSave();
  return sanitizeAccount(account);
}

export function resetDummyAccountProgress() {
  const dummy = accountsStore.accounts?.dummy;
  if (!dummy) {
    return null;
  }

  const seedState = normalizeStateShape(getSeedState());
  dummy.state = createStarterCorporationState(seedState, "Test Director", "Protocol Sandbox Dynamics");
  dummy.notifications = [];
  dummy.messages = [];
  dummy.walkthroughCompleted = false;
  dummy.state.playerProfile.walkthroughCompleted = false;

  // Strip any market sell orders belonging to the dummy account from global state
  const dummyId = dummy.id;
  state.market.orderBook = (state.market.orderBook || []).filter(
    (order) => order.type !== "sell" || order.sellerAccountId !== dummyId
  );
  // AB#1054: and its buy orders; the credits they held went with the reset corporation.
  state.market.buyOrders = (state.market.buyOrders || []).filter((order) => order.buyerAccountId !== dummyId);
  scheduleSave();

  scheduleAccountsSave();
  return sanitizeAccount(dummy);
}

// AB#1448: `sanitize` and `settleMining` default to the behaviour every route handler relies on. The nine tickers
// pass both false: none of them use the returned clone (sanitizeAccount deep-clones the whole account state, the
// single largest cost per call), and mining only needs settling once per elapsed interval, which miningTick already
// does itself inside its own mutator — the before/after calls here would otherwise re-run it (on the same `now`, so
// idempotently, but not for free) on every ticker, mining or not.
export function mutateAccountState(accountId, mutator, { sanitize = true, settleMining = true } = {}) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  closeFinancialDays(account);
  if (settleMining) applyMiningOperations(account.state.corp);
  mutator(account.state);
  if (settleMining) applyMiningOperations(account.state.corp);
  refreshContractOfferings(account.state.corp);
  ensureCorpMiningModel(account.state.corp);
  ensureBuildingIds(account.state.corp); // AB#792: whatever route built it, a building has an id when this returns
  ensureCorpMilitary(account.state.corp); // AB#861: power follows the units, whatever changed them
  refreshExchangeTax(account.state); // ISP-302 (AB#2285): the tax moves with leases held, so after every change
  const levelsReached = evaluateAccountLevel(accountId, account); // Bug #1260
  scheduleAccountsSave();
  // AB#743: the levels this change reached ride on the response, so the page can show the milestone modal from the
  // server's own figures. [] on every change that reaches none.
  return sanitize ? { ...sanitizeAccount(account), levelsReached } : null;
}

