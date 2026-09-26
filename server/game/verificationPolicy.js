// server/game/verificationPolicy.js: who must verify their email before logging in (AB#2288, ISP-305). An account
// carries verificationPolicy: "required" for one created since this story (createAccount sets it), and "prompt" for
// one that existed before, set once by backfillVerificationPolicy at load, so nobody is locked out retroactively: a
// "prompt" account logs in and is asked to verify. Any other value, or none, is treated as "required": it fails closed.

export const REQUIRED = "required";
export const PROMPT = "prompt";

/** The load-time migration: every account without a policy predates this story and is prompted. Returns how many. */
export function backfillVerificationPolicy(accounts) {
  let set = 0;
  for (const account of Object.values(accounts || {})) {
    if (!account || typeof account !== "object" || account.verificationPolicy !== undefined) continue;
    account.verificationPolicy = PROMPT;
    set += 1;
  }
  return set;
}

/** Whether a login with the right password is still refused, because the address is not verified. */
export function loginBlockedByVerification(account) {
  if (account?.emailVerifiedAt) return false;
  return account?.verificationPolicy !== PROMPT;
}

/** Whether a login goes ahead but should ask the player to verify. */
export function verificationPrompted(account) {
  return !account?.emailVerifiedAt && account?.verificationPolicy === PROMPT;
}
