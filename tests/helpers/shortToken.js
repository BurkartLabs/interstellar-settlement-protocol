// AB#2302: an access token that expires mid-connection, for the ISP-67 tests. `jwt.sign(..., { expiresIn: 1 })` floors
// the issue time to the second, so that token lived anywhere from 0 to 1 second: signed late in a second it could be
// dead before the socket's handshake was verified, and the socket connected anonymous, never authenticated, so
// nothing about it could expire (the auth:expired wait timed out under load). This one is given an explicit `exp` at
// least a second away, and untilExpired() waits for that exact instant rather than a fixed 1,300 ms.
import jwt from "jsonwebtoken";

/** A token for `accountId` that lives between 1 and 2 seconds; `expiresAt` is when verification starts refusing it. */
export function shortLivedToken(accountId) {
  const exp = Math.floor(Date.now() / 1000) + 2;
  return { token: jwt.sign({ sub: accountId, kind: "access", exp }, process.env.JWT_SECRET), expiresAt: exp * 1000 };
}

/** Resolves once `expiresAt` has passed (jsonwebtoken refuses a token from its exp second on). */
export function untilExpired(expiresAt) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, expiresAt - Date.now()) + 50));
}
