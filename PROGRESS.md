# ISP — handoff

**2026-09-23, Builder (Sonnet 5), non-visual session (no CONTROL_URL, no Chrome extension attached — see
"Blind spot" below).**

## What's now true

- `/api/auth/login`, `/register` and `/refresh` are rate-limited (ISP-64, AB#752): 10 login attempts/minute per
  address, 5 failed logins per account per 15 minutes (lockout survives a spoofed source address — keyed on
  email, not IP), 5 registrations/hour per address, 60 refreshes/minute per address. `trust proxy` is set to 1
  hop app-wide (`server/index.js`), matching the one real proxy (Container Apps ingress) in front of this
  server. Limits live in `server/rateLimiters.js`; production defaults are overridable per-limiter via
  `ISP_RATE_LIMIT_LOGIN_IP_MAX` / `_LOGIN_ACCOUNT_MAX` / `_REGISTER_MAX` / `_REFRESH_MAX`, and under
  `NODE_ENV=test` default to a high ceiling so the rest of the suite (which registers/logs in far more than 5
  times per file in normal setup) doesn't trip them by accident — only the two dedicated rate-limit test files
  override those env vars down to small numbers before importing the app.
- The limiter's store fails open (logs and lets the request through) rather than denying service if the
  in-memory counter itself errors; see `failOpenStore` in `server/rateLimiters.js` and its unit tests.

## Blind spot

This session has no browser (no Chrome extension connected, no CONTROL_URL/token — Builder panes don't get
either by design). ISP-64 is server-only (routes and headers), verified with `npm test` (145 files / 1480
tests, all green, including 10 new tests for this story) and `node --check server/index.js`. Nothing here has
a screen, so there is nothing a screenshot would add — but flagging the gap rather than skipping it silently
per CLAUDE.md.

## What's next

Working the ISP backlog by state/priority next, favoring v0.5 security/server items that don't need a
screenshot to verify (skipping `ui`-tagged items until a browser session is available). See ADO for what's
currently Active/Resolved under `product:interstellar-settlement-protocol`.

## In flight / blocked

Nothing blocked. `agent/752-auth-rate-limit` branch, PR opening next.
