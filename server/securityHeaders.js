// server/securityHeaders.js
// AB#753 (ISP-65): the headers every response carries, and who may call the server from another origin. Mounted once,
// in server/app.js, ahead of every route and the static files, so no route can be added without them.
import fs from "node:fs";
import helmet from "helmet";

/**
 * Scripts the pages load from outside this server, each by its exact path. None since AB#964: Chart.js is served from
 * public/vendor/ and Inter from public/vendor/ too, so every directive below is this origin alone.
 * tests/integration/security-headers.test.js checks no page loads anything from another origin.
 */
export const EXTERNAL_SCRIPTS = [];

/**
 * The content security policy. No inline or evaluated script: the pages carry no inline <script> or on* handlers,
 * and a handler written into rendered HTML (Bug #691's "<img onerror=...>") is blocked by script-src-attr 'none'.
 * style-src keeps 'unsafe-inline' because the views still set style="" attributes; ISP-26 removes them.
 * No upgrade-insecure-requests: the game is served over http on a developer's machine, and production's https is the
 * ingress's to enforce (HSTS below).
 */
export const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  "script-src": ["'self'", ...EXTERNAL_SCRIPTS],
  "script-src-attr": ["'none'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "font-src": ["'self'"],
  "img-src": ["'self'", "data:"],
  "connect-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "upgrade-insecure-requests": null
};

/** Where the browser posts a violation when reporting is on (AB#959). */
export const CSP_REPORT_PATH = "/csp-report";

/**
 * helmet with the policy above. Referrer-Policy is same-origin, not helmet's no-referrer: see below. `reportUri` adds
 * report-uri, so the browser posts every violation there (AB#959); the policy itself is the same either way.
 */
export function securityHeaders({ reportUri = null } = {}) {
  const directives = reportUri ? { ...CSP_DIRECTIVES, "report-uri": [reportUri] } : CSP_DIRECTIVES;
  return helmet({
    contentSecurityPolicy: { useDefaults: false, directives },
    // same-origin: nothing about the page (its URL carries ?account=) reaches another origin, while the game's own
    // requests keep a referrer. no-referrer makes Chromium send Origin: null on same-origin POSTs, which
    // corsPolicy below would then refuse (T-079).
    referrerPolicy: { policy: "same-origin" },
    frameguard: { action: "deny" },
    // The fonts and Chart.js come from other origins and are not served with CORP headers; requiring them would
    // block them. Nothing on this site needs cross-origin isolation.
    crossOriginEmbedderPolicy: false
  });
}

/**
 * AB#959: the handler for CSP_REPORT_PATH, on only when ISP_CSP_REPORT_FILE names a file (server/app.js): each
 * violation is appended to it as one JSON line, which `npm run audit:csp` counts after a full Playwright run. Takes the
 * raw body (the browser sends application/csp-report); anything that is not a report is ignored, never an error.
 */
export function cspReportSink(file) {
  return (req, res) => {
    let report = null;
    try { report = JSON.parse(String(req.body || ""))?.["csp-report"] ?? null; } catch { /* not a report */ }
    if (report && typeof report === "object") {
      const line = {
        at: new Date().toISOString(),
        page: report["document-uri"],
        directive: report["effective-directive"] || report["violated-directive"],
        blocked: report["blocked-uri"],
        source: report["source-file"],
        line: report["line-number"],
        sample: report["script-sample"]
      };
      try { fs.appendFileSync(file, JSON.stringify(line) + "\n"); } catch { /* reporting never breaks a page */ }
    }
    res.status(204).end();
  };
}

/** The host part of an Origin header, or null for "null" and anything that is not a URL. */
function originHost(origin) {
  try {
    const url = new URL(origin);
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Who may call the server from a page on another origin: nobody, except origins named in ISP_APP_ORIGIN (the list the
 * sockets already read). A browser sends Origin on every cross-origin request and on same-origin writes; a same-origin
 * GET and a page load send none, and pass. Same origin is judged by host against the Host the request came in on, so
 * the ingress's http-to-https hop does not make the game a stranger to itself. A refused request stops here, before
 * any route or body parser, with no CORS headers, so the browser refuses it too.
 */
export function corsPolicy({ allowedOrigins = [] } = {}) {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.get("origin");
    if (!origin) return next();
    // Host, or the X-Forwarded-Host the ingress may set in front of it (app.js trusts one proxy hop). A page cannot
    // send X-Forwarded-Host itself without a preflight, and a preflight from another origin is refused below.
    const ownHosts = [req.get("host"), req.get("x-forwarded-host")].filter(Boolean).map((h) => String(h).split(",").pop().trim().toLowerCase());
    if (ownHosts.includes(originHost(origin))) return next();
    if (allowed.has(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
      if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE");
        res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.set("Access-Control-Max-Age", "600");
        return res.status(204).end();
      }
      return next();
    }
    res.vary("Origin");
    return res.status(403).json({ error: "This request came from another site, which the Protocol does not accept." });
  };
}
