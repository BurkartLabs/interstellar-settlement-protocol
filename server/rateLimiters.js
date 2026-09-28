// ISP-64: throttle the auth routes. express-rate-limit's MemoryStore keeps nothing but per-key hit counters
// in process memory — no account data, no request bodies — which is why a single replica (#591) is enough for
// now and why a store failure has nothing to lose: on error we log and let the request through rather than
// deny service because the counter broke (fail open, not fail closed, for a throttle that only slows abuse).
import rateLimit, { MemoryStore, ipKeyGenerator } from "express-rate-limit";
import { RATE_LIMITS, MUTATION_GROUPS, groupEnvName, groupOf } from "./rateLimitConfig.js"; // AB#958: the one configuration

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

/**
 * AB#2043: the time left before this caller may try again, from the same resetTime the Retry-After header is set from,
 * so the sentence and the header never disagree. The whole window only when the store gave no reset time.
 */
export function throttledMessage(req, options, now = Date.now()) {
  const reset = req.rateLimit?.resetTime;
  const left = reset instanceof Date ? reset.getTime() - now : options.windowMs;
  return `This request could not be processed. Too many attempts — try again in ${minutesFrom(left)}.`;
}

function throttledResponse(req, res, next, options) {
  res.status(options.statusCode).json({ error: throttledMessage(req, options) });
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

// AB#958: the window, the default and the variable come from rateLimitConfig.js, by the limiter's name.
function limiter(name, { extra } = {}) {
  const { windowMs, envName, productionDefault } = RATE_LIMITS[name];
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
export const loginIpLimiter = limiter("login-ip");

// Five failed logins per account per 15 minutes. Keyed on the normalized email in the body, not the address, and
// only failed attempts count (skipSuccessfulRequests) so a real player who mistypes once and then logs in is never
// locked out by their own success. AB#1747: the no-email fallback goes through ipKeyGenerator, not a raw req.ip —
// without it, an IPv6 caller could get a fresh bucket per address within their own /56 by varying the low bits.
export const loginAccountLimiter = limiter("login-account", {
  extra: {
    skipSuccessfulRequests: true,
    keyGenerator: (req) => String(req.body?.email || "").trim().toLowerCase() || ipKeyGenerator(req.ip)
  }
});

// Five registrations per address per hour.
export const registerLimiter = limiter("register");

// Five verification resends per address per hour (AB#987): each one sends mail, so it is a cost and a nuisance to
// whoever owns the address, and the same answer comes back whether or not an account has it.
export const resendVerificationLimiter = limiter("resend-verification");

// Password-reset requests (AB#988), limited twice: ten an hour from one client, whatever the addresses, and three an
// hour for one address, whoever asks, so nobody can fill an owner's inbox from many clients. Both answer 429 the same
// way whether or not the address has an account.
export const forgotPasswordIpLimiter = limiter("forgot-password-ip");

export const forgotPasswordAccountLimiter = limiter("forgot-password-account", {
  extra: {
    keyGenerator: (req) => (typeof req.body?.email === "string" && req.body.email.trim().toLowerCase()) || ipKeyGenerator(req.ip)
  }
});

// Sixty refreshes per address per minute.
export const refreshLimiter = limiter("refresh");

// AB#734 (ISP-48): 120 state-changing game requests a minute, shared by every route under /api/accounts/:accountId
// and /api/market — one limiter instance, so an account can't dodge the count by splitting a burst across the two
// route families. Keyed on the caller's own account, not their address: two players behind the same NAT (or one
// player's own two tabs) never share a bucket, and the key exists only once requireAuth has verified a token, so
// this always runs after requireAuth in the middleware chain. An unauthenticated caller (a forged or missing
// token) falls back to their address, the same shape as loginAccountLimiter's fallback (AB#1747) — requireAuth
// still answers 401 to them; the fallback only keeps a token-guessing burst from running unthrottled ahead of
// that 401. GET requests are read-only and excluded by `skip`, matching the acceptance line's "state-changing".
export const accountActionLimiter = limiter("account-action", {
  extra: {
    keyGenerator: (req) => req.auth?.accountId || ipKeyGenerator(req.ip),
    skip: (req) => req.method === "GET"
  }
});

// AB#910 (docs/design/messaging.md): private messages, per sender. These protect the server's write rate and the storage
// one account can add (600 x 32 KB is about 19 MB an hour at worst); none of them reads a message or depends on who it
// is for (Board, AB#707 and AB#696: no safety measures). Keyed on the sender's own account, after requireAuth.
const bySender = { keyGenerator: (req) => req.auth?.accountId || ipKeyGenerator(req.ip) };
export const messageMinuteLimiter = limiter("message-minute", {
  extra: bySender
});
export const messageHourLimiter = limiter("message-hour", {
  extra: bySender
});
// A first message to a corporation creates a conversation and an entry in two inboxes; this bounds that fan-out. It
// runs only for a sender's first message to a given corporation, and says nothing about whom a player may write to.
export const newConversationLimiter = limiter("new-conversation", {
  extra: bySender
});

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * AB#958 (ISP-262): every mutating route is limited per address and, once signed in, per account, by the cost group
 * its path belongs to (rateLimitConfig.js: trade, chat, filing, construction, default). Two layers:
 *
 * - `address`, in front of every route (server/index.js): keyed on the caller's address as Express reads it with one
 *   trusted proxy hop (server/app.js), so a spoofed X-Forwarded-For prefix changes nothing (ISP-64's test).
 * - `account`, after requireAuth: keyed on the signed-in account, so players sharing an address do not share a bucket.
 *   The default group has none here; AB#734's account-action bucket is its per-account limit.
 *
 * Unlike the per-route limiters above, this gate fails closed: if a counter cannot be read or written, the request is
 * refused with 503 rather than let through, so a broken store cannot become an unlimited one (AB#958's acceptance).
 * The counters hold a group, an address or account id, and a count; nothing is logged with the address.
 * `makeStore` is for tests.
 */
export function createMutationLimits(makeStore = () => new MemoryStore()) {
  const byAddress = (req) => ipKeyGenerator(req.ip);
  const byAccount = (req) => req.auth?.accountId || ipKeyGenerator(req.ip);
  const build = (group, scope) => rateLimit({
    windowMs: group[scope].windowMs,
    limit: configuredLimit(groupEnvName(group.name, scope), group[scope].productionDefault),
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore(),
    passOnStoreError: false,
    handler: throttledResponse,
    keyGenerator: scope === "address" ? byAddress : byAccount
  });
  const layers = { address: new Map(), account: new Map() };
  for (const group of MUTATION_GROUPS) {
    layers.address.set(group.name, build(group, "address"));
    if (group.account) layers.account.set(group.name, build(group, "account"));
  }
  const gate = (scope) => (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();
    const group = groupOf(`${req.baseUrl}${req.path}`);
    const limit = layers[scope].get(group);
    if (!limit) return next();
    const refuse = (error) => {
      console.error(`[rate-limit] ${scope} limit for ${group} could not count this request; refusing it`, error?.message ?? error);
      if (!res.headersSent) res.status(503).json({ error: "This request could not be processed right now. Try again in a minute." });
    };
    return Promise.resolve(limit(req, res, (error) => (error ? refuse(error) : next()))).catch(refuse);
  };
  return { address: gate("address"), account: gate("account") };
}

/** The server's own two layers (server/index.js, server/routes/market.js, server/routes/forums.js). */
export const mutationLimits = createMutationLimits();
