// Where tokens were kept before AB#757. Removed on every load of the game's page and on sign-out, so a player who last
// signed in on an older build does not keep a readable 30-day refresh token in this origin's storage. Bug #4836: a
// module of its own, so scripts/boot.js removes them on the logged-out landing without loading the game's client.
export const LEGACY_TOKEN_KEYS = ["isp.accessToken", "isp.refreshToken"];

export function forgetLegacyTokens() {
  try {
    for (const key of LEGACY_TOKEN_KEYS) localStorage.removeItem(key);
  } catch {
    // storage blocked: nothing was kept there to remove
  }
}
