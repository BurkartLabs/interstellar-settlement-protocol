// server/oneTimeToken.js: the one-time tokens mailed links carry (email verification AB#987, password reset AB#988). A
// token is 32 random bytes, handed out once and stored on the account only as its SHA-256 under one field, with an
// expiry. Spending one finds it by hash in constant time and removes it whether or not it has expired, so it works
// once at most. An account holds one token per field: issuing another replaces it.

import crypto from "node:crypto";
import { accountsStore, scheduleAccountsSave } from "./game/store.js";

const TOKEN_BYTES = 32;

const hashOf = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

/** Issue a token under `field` on the account; returns the raw token, which is stored nowhere. */
export function issueToken(accountId, field, ttlMs, now = Date.now()) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) throw new Error("No such account.");
  const raw = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  account[field] = { tokenHash: hashOf(raw), expiresAt: now + ttlMs };
  scheduleAccountsSave();
  return raw;
}

/**
 * Spend a token held under `field`. Returns the account it belonged to, or null for one that is malformed, unknown,
 * already spent or expired: all four look the same to the caller.
 */
export function spendToken(field, raw, now = Date.now()) {
  if (typeof raw !== "string" || raw.length < 40 || raw.length > 64 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const wanted = Buffer.from(hashOf(raw), "hex");
  for (const account of Object.values(accountsStore.accounts || {})) {
    const pending = account?.[field];
    if (!pending?.tokenHash) continue;
    const held = Buffer.from(pending.tokenHash, "hex");
    if (held.length !== wanted.length || !crypto.timingSafeEqual(held, wanted)) continue;
    delete account[field]; // single-use, and an expired one is dropped too
    scheduleAccountsSave();
    return pending.expiresAt > now ? account : null;
  }
  return null;
}

