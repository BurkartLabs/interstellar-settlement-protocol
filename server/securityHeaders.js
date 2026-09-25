// server/securityHeaders.js
// AB#753 (ISP-65): the headers every response carries, and who may call the server from another origin. Mounted once,
// in server/app.js, ahead of every route and the static files, so no route can be added without them.
import helmet from "helmet";

/**
 * The one script the pages load from outside this server (public/index.html), allowed by its exact path: the CDN
 * serves every npm package, so allowing the whole origin would let an injected tag load any of them.
 * tests/integration/security-headers.test.js checks every external script in index.html is in this list.
 */
export const EXTERNAL_SCRIPTS = ["https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"];

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
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "https://fonts.gstatic.com"],
  "img-src": ["'self'", "data:"],
  "connect-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "upgrade-insecure-requests": null
};

/** helmet with the policy above. Referrer-Policy is same-origin, not helmet's no-referrer: see below. */
export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: { useDefaults: false, directives: CSP_DIRECTIVES },
    // same-origin: nothing about the page (its URL carries ?account=) reaches the font or script CDN, while the
    // game's own requests keep a referrer. no-referrer makes Chromium send Origin: null on same-origin POSTs, which
    // corsPolicy below would then refuse (T-079).
    referrerPolicy: { policy: "same-origin" },
    frameguard: { action: "deny" },
    // The fonts and Chart.js come from other origins and are not served with CORP headers; requiring them would
    // block them. Nothing on this site needs cross-origin isolation.
    crossOriginEmbedderPolicy: false
  });
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
