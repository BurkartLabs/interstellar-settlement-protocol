// ISP-64: throttle the auth routes. express-rate-limit's MemoryStore keeps nothing but per-key hit counters
// in process memory — no account data, no request bodies — which is why a single replica (#591) is enough for
// now and why a store failure has nothing to lose: on error we log and let the request through rather than
// deny service because the counter broke (fail open, not fail closed, for a throttle that only slows abuse).
import rateLimit, { MemoryStore, ipKeyGenerator } from "express-rate-limit";

const isTest = process.env.NODE_ENV === "test";

// Test files that need to see a real 429 override these env vars before importing server/index.js (each test
// file gets its own module instance, so the override only affects that file). Every other test file registers
// and logs in more than the production limits allow in ordinary setup, so the default under NODE_ENV=test is
// high enough to never trip by accident.
function configuredLimit(envName, productionDefault) {
  const raw = process.env[envName];
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return isTest ? 100_000 : productionDefault;
}

function minutesFrom(ms) {
  const n = Math.max(1, Math.ceil(ms / 60_000));
  return `${n} minute${n === 1 ? "" : "s"}`;
}

function throttledResponse(req, res, next, options) {
  res.status(options.statusCode).json({
    error: `This request could not be processed. Too many attempts — try again in ${minutesFrom(options.windowMs)}.`
  });
}

// Wraps a Store so a broken counter throttles nobody: any error logs and reports "not yet at the limit" instead
// of rejecting or hanging the request.
export function failOpenStore(store, name) {
  return {
    localKeys: store.localKeys,
    init: (options) => store.init?.(options),
    async increment(key) {
      try {
        return await store.increment(key);
      } catch (error) {
        console.error(`[rate-limit] ${name} store failed on increment; failing open`, error);
        return { totalHits: 0, resetTime: undefined };
      }
    },
    async decrement(key) {
      try {
        await store.decrement(key);
      } catch (error) {
        console.error(`[rate-limit] ${name} store failed on decrement; failing open`, error);
      }
    },
    async resetKey(key) {
      try {
        await store.resetKey(key);
      } catch (error) {
        console.error(`[rate-limit] ${name} store failed on resetKey; failing open`, error);
      }
    }
  };
}

function limiter(name, { windowMs, envName, productionDefault, extra }) {
  return rateLimit({
    windowMs,
    limit: configuredLimit(envName, productionDefault),
    standardHeaders: true,
    legacyHeaders: false,
    store: failOpenStore(new MemoryStore(), name),
    handler: throttledResponse,
    ...extra
  });
}

// Ten attempts a minute per address (ISP-64 acceptance #1).
export const loginIpLimiter = limiter("login-ip", {
  windowMs: 60_000,
  envName: "ISP_RATE_LIMIT_LOGIN_IP_MAX",
  productionDefault: 10
});

// Five failed logins per account per 15 minutes. Keyed on the normalized email in the body, not the address, and
// only failed attempts count (skipSuccessfulRequests) so a real player who mistypes once and then logs in is never
// locked out by their own success. AB#1747: the no-email fallback goes through ipKeyGenerator, not a raw req.ip —
// without it, an IPv6 caller could get a fresh bucket per address within their own /56 by varying the low bits.
export const loginAccountLimiter = limiter("login-account", {
  windowMs: 15 * 60_000,
  envName: "ISP_RATE_LIMIT_LOGIN_ACCOUNT_MAX",
  productionDefault: 5,
  extra: {
    skipSuccessfulRequests: true,
    keyGenerator: (req) => String(req.body?.email || "").trim().toLowerCase() || ipKeyGenerator(req.ip)
  }
});

// Five registrations per address per hour.
export const registerLimiter = limiter("register", {
  windowMs: 60 * 60_000,
  envName: "ISP_RATE_LIMIT_REGISTER_MAX",
  productionDefault: 5
});

// Sixty refreshes per address per minute.
export const refreshLimiter = limiter("refresh", {
  windowMs: 60_000,
  envName: "ISP_RATE_LIMIT_REFRESH_MAX",
  productionDefault: 60
});
