// server/passwordReset.js: resetting a forgotten password by email (AB#988, ISP-281; the Board's "Yes to ... password
// reset", AB#694). A reset token is a one-time token (server/oneTimeToken.js) good for one hour. A reset sets the new
// password, revokes every refresh token, and tells the owner by email. Nothing here logs an address or a password.

import { accountsStore, passwordRuleError, setAccountPassword } from "./game/store.js";
import { accountByEmail } from "./emailVerification.js";
import { publicBaseUrl, sendMail } from "./mail.js";
import { issueToken, spendToken } from "./oneTimeToken.js";

export const RESET_TTL_MS = 60 * 60_000;
const FIELD = "passwordReset";

export function issueResetToken(accountId, now = Date.now()) {
  return issueToken(accountId, FIELD, RESET_TTL_MS, now);
}

/** Mail a reset link to the account with this address, if there is one; nothing at all otherwise. */
export async function sendResetEmail(email, now = Date.now()) {
  const account = accountByEmail(email);
  if (!account) return;
  const link = `${publicBaseUrl()}/reset-password.html#token=${issueResetToken(account.id, now)}`;
  await sendMail({
    to: account.email,
    subject: "Reset your password for the Interstellar Settlement Protocol",
    text: [
      "Someone asked to reset the password for this address's account. To choose a new one, open this link within one hour:",
      "",
      link,
      "",
      "If it was not you, ignore this message: your password stays as it is, and the link stops working in an hour."
    ].join("\n")
  });
}

/**
 * Reset the password a token was issued for. The password is checked first, so a refused one leaves the token for
 * another try. Returns { ok: true } or { ok: false, reason: "password", error } or { ok: false, reason: "spent" }.
 */
export async function resetPassword(raw, password, now = Date.now()) {
  const refusal = passwordRuleError(password);
  if (refusal) return { ok: false, reason: "password", error: refusal };
  const account = spendToken(FIELD, raw, now);
  if (!account) return { ok: false, reason: "spent" };
  setAccountPassword(account.id, password, now);
  try {
    await sendMail({
      to: accountsStore.accounts[account.id].email,
      subject: "Your password was changed",
      text: [
        "The password for your Interstellar Settlement Protocol account was just changed, and every device that was",
        "signed in has been signed out.",
        "",
        "If that was you, there is nothing to do. If it was not, reset it again from the login page straight away."
      ].join("\n")
    });
  } catch (error) {
    // The password has changed whatever happens to the notice; its failure is logged without the address.
    console.error("[password-reset] the password-changed notice could not be sent:", error?.name);
  }
  return { ok: true };
}
