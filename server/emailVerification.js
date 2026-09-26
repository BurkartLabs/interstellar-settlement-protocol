// server/emailVerification.js: proving an account's email address (AB#987, ISP-280; the Board's "Yes to email
// verification", AB#694). A verification token is 32 random bytes, handed out once in a link and stored only as its
// SHA-256, single-use, and good for 24 hours. An account holds at most one: a new one replaces the old. Nothing here
// logs an email address.
//
// Slice 1: the tokens, the mail that carries them and the routes that use them. Registration and login are not wired
// to it yet; that is slice 2, which lands with the real transport (AB#989).

import { accountsStore, scheduleAccountsSave } from "./game/store.js";
import { publicBaseUrl, sendMail } from "./mail.js";
import { issueToken, spendToken } from "./oneTimeToken.js";

export const TOKEN_TTL_MS = 24 * 60 * 60_000;

/** Issue a fresh token for the account, replacing any earlier one. Returns the raw token, which is stored nowhere. */
export function issueVerificationToken(accountId, now = Date.now()) {
  return issueToken(accountId, "emailVerification", TOKEN_TTL_MS, now);
}

/**
 * Verify the account a token belongs to and spend the token. Returns the account id, or null for a token that is
 * malformed, unknown, already used or expired: all four verify nothing and look the same to the caller.
 */
export function verifyEmailToken(raw, now = Date.now()) {
  const account = spendToken("emailVerification", raw, now);
  if (!account) return null;
  account.emailVerifiedAt = now;
  scheduleAccountsSave();
  return account.id;
}

export function isEmailVerified(accountId) {
  return Boolean(accountsStore.accounts?.[accountId]?.emailVerifiedAt);
}

/** The account with this email address, compared the way registration stores it, or undefined. */
export function accountByEmail(email) {
  if (typeof email !== "string") return undefined;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return undefined;
  return Object.values(accountsStore.accounts || {}).find((a) => a?.email === normalized);
}

/** Issue a token and mail its link. Throws MailUnavailableError (mail.js) when mail cannot be sent here. */
export async function sendVerificationEmail(accountId, now = Date.now()) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return;
  const base = publicBaseUrl();
  const raw = issueVerificationToken(accountId, now);
  // The token rides in the fragment, which browsers never send to a server: it stays out of access logs and Referer
  // headers, and a mail scanner that fetches the link cannot spend it, since only the page's button posts it.
  const link = `${base}/verify-email.html#token=${raw}`;
  await sendMail({
    to: account.email,
    subject: "Verify your email for the Interstellar Settlement Protocol",
    text: [
      "Confirm that this address belongs to your corporation's account by opening this link within 24 hours:",
      "",
      link,
      "",
      "If you did not register, ignore this message: nothing happens without the link."
    ].join("\n")
  });
}
