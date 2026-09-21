// The key every access and refresh token is signed with (Bug #589).
//
// It used to fall back to a string in the public source when JWT_SECRET was unset, so anyone who read the repository
// could sign a token for any account. Now the server refuses to start without a real secret; only the dev surface
// (ISP_DEV=1, never in production) may run on the development secret, and it says so on every start.
//
// Make one with: openssl rand -base64 48. Changing it signs every player out, because every existing token stops
// verifying; that is the right result when a secret may have leaked.

export const JWT_SECRET_MIN_BYTES = 32;

const DEVELOPMENT_SECRET = "isp-dev-insecure-secret-change-me";

/**
 * The signing secret from `env.JWT_SECRET`, or an error that stops the server. `devSurface` is whether ISP_DEV=1 outside
 * production; only then may a missing or short secret be used, with a warning. The error never repeats the secret.
 */
export function resolveJwtSecret(env, { devSurface = false, warn = console.warn } = {}) {
  const secret = typeof env?.JWT_SECRET === "string" ? env.JWT_SECRET : "";
  const bytes = Buffer.byteLength(secret);
  if (bytes >= JWT_SECRET_MIN_BYTES) return secret;

  const problem = secret ? `is ${bytes} bytes, shorter than ${JWT_SECRET_MIN_BYTES}` : "is not set";
  if (devSurface) {
    warn(`[auth] JWT_SECRET ${problem}: signing tokens with the insecure development secret because ISP_DEV=1. `
      + "Never run a server anyone else can reach like this.");
    return secret || DEVELOPMENT_SECRET;
  }
  throw new Error(`JWT_SECRET ${problem}. Set it to at least ${JWT_SECRET_MIN_BYTES} bytes, for example the output of `
    + "`openssl rand -base64 48`. For local development only, set ISP_DEV=1 instead.");
}
