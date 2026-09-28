// AB#958 (ISP-262): every rate limit the server applies, in one place. Each limit has a window, a production default
// and the environment variable that overrides it (server/rateLimiters.js reads them through configuredLimit, which
// also lifts them under NODE_ENV=test, Bug AB#2326). Changing a number here changes the limit and the 429 a player
// sees; nothing else holds a copy.

/**
 * The limiters that guard one route or one family of routes (ISP-64, AB#734, AB#910, AB#987, AB#988). Unchanged by
 * AB#958; kept here so the numbers live in one configuration.
 */
export const RATE_LIMITS = {
  "login-ip": { windowMs: 60_000, envName: "ISP_RATE_LIMIT_LOGIN_IP_MAX", productionDefault: 10 },
  "login-account": { windowMs: 15 * 60_000, envName: "ISP_RATE_LIMIT_LOGIN_ACCOUNT_MAX", productionDefault: 5 },
  // AB#958's registration throttle per address: five a day would stop a household, so five an hour, as ISP-64 set
  register: { windowMs: 60 * 60_000, envName: "ISP_RATE_LIMIT_REGISTER_MAX", productionDefault: 5 },
  "resend-verification": { windowMs: 60 * 60_000, envName: "ISP_RATE_LIMIT_RESEND_MAX", productionDefault: 5 },
  "forgot-password-ip": { windowMs: 60 * 60_000, envName: "ISP_RATE_LIMIT_FORGOT_IP_MAX", productionDefault: 10 },
  "forgot-password-account": { windowMs: 60 * 60_000, envName: "ISP_RATE_LIMIT_FORGOT_ACCOUNT_MAX", productionDefault: 3 },
  refresh: { windowMs: 60_000, envName: "ISP_RATE_LIMIT_REFRESH_MAX", productionDefault: 60 },
  "account-action": { windowMs: 60_000, envName: "ISP_RATE_LIMIT_ACCOUNT_ACTION_MAX", productionDefault: 120 },
  "message-minute": { windowMs: 60_000, envName: "ISP_RATE_LIMIT_MESSAGE_MINUTE_MAX", productionDefault: 30 },
  "message-hour": { windowMs: 60 * 60_000, envName: "ISP_RATE_LIMIT_MESSAGE_HOUR_MAX", productionDefault: 600 },
  "new-conversation": { windowMs: 60 * 60_000, envName: "ISP_RATE_LIMIT_NEW_CONVERSATION_MAX", productionDefault: 60 }
};

/**
 * AB#958: every mutating route belongs to one group, by what a burst of it costs, and each group has a limit per
 * address (every caller, signed in or not) and, for the named groups, per account (after sign-in). The default group's
 * per-account limit is AB#734's shared account-action bucket, which still caps everything. Per address is looser than
 * per account because players behind one address (a household, a campus NAT) share it.
 *
 * `paths` are matched against the route's path with any "/api/accounts/<id>" prefix taken off; the first group that
 * matches wins, and a path no group names is `default`, so a new route is limited from the day it is added.
 */
export const MUTATION_GROUPS = [
  {
    name: "trade", // the exchanges: market orders, shares, bonds, loans between players
    paths: [/^\/api\/market\//, /^\/equity\//, /^\/bonds\//, /^\/loan-offers(\/|$)/],
    account: { windowMs: 60_000, productionDefault: 30 },
    address: { windowMs: 60_000, productionDefault: 120 }
  },
  {
    name: "chat", // chat and memoranda: private messages, conversations, the forums
    paths: [/^\/messages\//, /^\/conversations\//, /^\/api\/forums\//],
    account: { windowMs: 60_000, productionDefault: 20 },
    address: { windowMs: 60_000, productionDefault: 60 }
  },
  {
    name: "filing", // what goes on a public record: arbitration cases (the docket), patents, tariffs, concessions, lobbying
    paths: [/^\/arbitration\//, /^\/patents(\/|$)/, /^\/tariffs\//, /^\/concessions\//, /^\/lobbying(\/|$)/],
    account: { windowMs: 60_000, productionDefault: 6 },
    address: { windowMs: 60_000, productionDefault: 20 }
  },
  {
    name: "construction", // buildings, their upgrades and extractors, conglomerate station projects
    paths: [/^\/gameplay\/build(-[a-z-]+)?$/, /^\/gameplay\/buildings\//, /^\/gameplay\/lease\/[^/]+\/build-extractor$/, /\/station-project(\/|$)/],
    account: { windowMs: 60_000, productionDefault: 20 },
    address: { windowMs: 60_000, productionDefault: 60 }
  },
  {
    name: "default", // every other mutating route, signing in included (its own ISP-64 limits still apply first)
    paths: [],
    account: null, // AB#734's account-action bucket
    address: { windowMs: 60_000, productionDefault: 600 }
  }
];

/** The environment variable that overrides a group's limit: ISP_RATE_LIMIT_TRADE_ACCOUNT_MAX and so on. */
export const groupEnvName = (group, scope) => `ISP_RATE_LIMIT_${group.toUpperCase()}_${scope.toUpperCase()}_MAX`;

/** Which group a mutating request's path belongs to (the path without its query string). */
export function groupOf(path) {
  const p = String(path || "").replace(/^\/api\/accounts\/[^/]+/, "");
  return MUTATION_GROUPS.find((g) => g.paths.some((re) => re.test(p)))?.name ?? "default";
}
