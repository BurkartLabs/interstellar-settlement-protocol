// AB#956 (ISP-260): everything a request can reach without a login, each with the reason it may. This is the only
// place a route or socket event is made public: tests/integration/route-auth.test.js enumerates every Express route
// and every socket.io event at runtime and fails on one that answers without a login and is not listed here. Adding
// an entry is a security decision, reviewed in its pull request, so write the reason a reviewer needs.

/** Routes that answer without a login in every environment. */
export const PUBLIC_ROUTES = {
  "POST /api/auth/register": "creating an account",
  "POST /api/auth/login": "signing in",
  "POST /api/auth/refresh": "exchanging the refresh cookie, which is itself the credential (AB#757)",
  "POST /api/auth/logout": "revoking the refresh cookie, which is itself the credential (AB#757)",
  "POST /api/auth/verify-email": "spending a verification token, which is itself the credential (AB#987)",
  "POST /api/auth/resend-verification": "asking for a new verification link before anyone can sign in; rate-limited, one answer for every address (AB#987)",
  "POST /api/auth/forgot-password": "asking for a password-reset link by someone who cannot sign in; rate-limited, one answer for every address (AB#988)",
  "POST /api/auth/reset-password": "spending a reset token, which is itself the credential (AB#988)",
  "GET /healthz": "the container platform's health probe (AB#735)",
  "GET /how-to-start": "the playtest briefing, a static page for people who have not registered yet (AB#748)",
  "GET /api/bootstrap": "the global game state shown before login",
  "POST /api/telemetry": "the page's minimum telemetry (ISP-256, AB#952): an event names no account, so none is asked for; only the listed events, 20 and 8 KB a request, its own rate-limit group, no address stored (SECURITY.md, Telemetry)",
  "GET /api/stations": "a static catalog",
  "GET /api/systems": "a static catalog (ISP-112, AB#804)",
  "GET /api/section-codes": "the document-code registry, ids and codes only, for every page's headers (ISP-248, AB#944)",
  "GET /api/buildings": "a static catalog",
  "GET /api/ceo-insight": "a static catalog",
  "GET /api/mission-agents": "a static catalog",
  "GET /api/research": "a static catalog",
  "GET /api/starmap/dominance": "aggregate dominance shares per system, names and rounded shares only, for the starmap overlay (ISP-217, AB#912)",
  "GET /api/starmap/concessions": "every system's concession holders and open petitions for the starmap overlay: names, types, dates (ISP-229, AB#924)",
  "GET /api/systems/:id/control": "a system's control scores and concession eligibility: names, rounded scores and eligibility only (ISP-226, AB#921; Bug #4664)",
  "GET /api/systems/:id/concession": "a system's ISA concession register: holders, open petitions, dates, all public (ISP-227, AB#922)",
  "GET /api/systems/:id/tariff": "a system's tariff and any pending change with its effective time: traders must see it before they commit (ISP-230, AB#925)",
  "GET /api/patents": "the Registry's patent list: holder names, subjects, rates and terms, all public (ISP-235, AB#930)",
  "GET /api/arbitration/docket": "the Arbitration Council's docket: reference, claim type, the parties' names, state and ruling, all public (ISP-241, AB#937)",
  "GET /api/lobbying": "the lobbying register: who opened and pledged, on which side, what and when, never the amounts; lobbying is registered (ISP-239, AB#934)"
};

/** Routes that exist only when ISP_DEV=1 outside production (the test process sets it); they answer without a login by design. */
export const DEV_ONLY_ROUTES = {
  "POST /api/auth/dummy-login": "the shared demo account",
  "POST /api/auth/dummy-reset": "resetting the shared demo account",
  "GET /kanban/api": "the developer kanban board (Bug #1069)",
  "POST /kanban/api": "the developer kanban board (Bug #1069)",
  "GET /api/dev/outbox": "the test mail transport's outbox, for local play and e2e (AB#987); there is no outbox in production"
};

/**
 * Socket.io: what a socket without a login may do. Connecting is open, because the page shows the public game state
 * before sign-in. Every other event a client can send must re-check its token with checkSocketAuth (ISP-67).
 */
export const PUBLIC_SOCKET = {
  connection: "a socket without a login receives state:init, sharedStateView(null): the public world, market and forums with nothing highlighted as its own, and joins no account or conglomerate room (server/realtime.js)",
  disconnect: "socket.io's own lifecycle event; the handler does nothing (server/realtime.js)",
  error: "socket.io's own no-op listener, added by its Socket constructor so an error event cannot crash the server; error is a reserved name a client cannot send"
};
