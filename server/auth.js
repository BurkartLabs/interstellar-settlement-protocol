// server/auth.js: access and refresh tokens, and the login check every signed-in route runs, split out of server/index.js (AB#1815).
import "./loadEnv.js";
import { resolveJwtSecret } from "./jwtSecret.js";
import jwt from "jsonwebtoken";
import { accountExists, storeRefreshToken } from "./gameState.js";
import { IS_DEV, DEV_SURFACE } from "./app.js";

const ACCESS_TOKEN_SECONDS = 7 * 24 * 60 * 60;
const DUMMY_ACCESS_TOKEN_SECONDS = IS_DEV ? 7 * 24 * 60 * 60 : 2 * 60 * 60;
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
// Refuses to start without a real secret, except on the dev surface (Bug #589: it fell back to a string in the source).
const JWT_SECRET = resolveJwtSecret(process.env, { devSurface: DEV_SURFACE });

function signAccessToken(accountId) {
  const expiresIn = accountId === "dummy" ? DUMMY_ACCESS_TOKEN_SECONDS : ACCESS_TOKEN_SECONDS;
  return jwt.sign({ sub: accountId, kind: "access" }, JWT_SECRET, { expiresIn });
}

function signRefreshToken(accountId) {
  return jwt.sign({ sub: accountId, kind: "refresh" }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_SECONDS });
}

function issueTokens(accountId) {
  const accessExpiry = accountId === "dummy" ? DUMMY_ACCESS_TOKEN_SECONDS : ACCESS_TOKEN_SECONDS;
  const accessToken = signAccessToken(accountId);
  const refreshToken = signRefreshToken(accountId);
  const refreshExpiresAt = Date.now() + REFRESH_TOKEN_SECONDS * 1000;
  storeRefreshToken(accountId, refreshToken, refreshExpiresAt);
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: Date.now() + accessExpiry * 1000,
    refreshTokenExpiresAt: refreshExpiresAt
  };
}

function getBearerToken(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7).trim();
}

/**
 * Verify an access token. Returns { accountId } or { error }. The one check behind both HTTP routes (requireAuth)
 * and sockets (io.use, Bug #710), so the two cannot drift apart.
 */
function verifyAccessToken(token) {
  if (!token) return { error: "Missing bearer token." };
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.kind !== "access") return { error: "Invalid token type." };
    return { accountId: payload.sub };
  } catch {
    return { error: "Invalid or expired access token." };
  }
}

function requireAuth(req, res, next) {
  const verified = verifyAccessToken(getBearerToken(req));
  if (!verified.accountId) {
    res.status(401).json({ error: verified.error });
    return;
  }
  req.auth = { accountId: verified.accountId };
  next();
}

function requireAccountAccess(req, res, next) {
  if (!req.auth?.accountId || req.auth.accountId !== req.params.accountId) {
    res.status(403).json({ error: "Forbidden account scope." });
    return;
  }

  if (!accountExists(req.params.accountId)) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  next();
}

export { verifyAccessToken, getBearerToken, issueTokens, JWT_SECRET, requireAuth, requireAccountAccess };
