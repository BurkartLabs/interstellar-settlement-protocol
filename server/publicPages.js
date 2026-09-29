// server/publicPages.js: the landing's canonical URL and link-preview tags carry the one public URL (AB#954, ISP-258).
// public/index.html writes %ISP_PUBLIC_URL% where an absolute URL is needed (the canonical link, og:url, og:image,
// twitter:image); this fills it from publicBaseUrl() (ISP_PUBLIC_URL, the setting mail's links already use, server/mail.js),
// so no file names the domain. Production sets it to the app's Container Apps address until Decision D-1.0-1 names the
// real one (ops/infra/isp/isp.bicep, publicUrl). Mounted ahead of express.static, which would serve the token as written.
import fs from "node:fs";
import path from "node:path";
import { publicBaseUrl } from "./mail.js";
import { CACHE_REVALIDATE } from "./staticCache.js";

export const PUBLIC_URL_TOKEN = "%ISP_PUBLIC_URL%";

/** The page's HTML with every token replaced by the public origin ("" when there is none: the URLs become root-relative). */
export function fillPublicUrl(html, base = publicBaseUrl()) {
  return html.split(PUBLIC_URL_TOKEN).join(base || "");
}

/** GET / and /index.html: the landing with its public URL filled, revalidated each load like the other pages. */
export function registerPublicPages(app, publicDir) {
  const file = path.join(publicDir, "index.html");
  let cached = null; // read once: the server restarts when public/ changes in development (npm run dev)
  app.get(["/", "/index.html"], (_req, res, next) => {
    try {
      cached ??= fs.readFileSync(file, "utf8");
    } catch (error) {
      next(error);
      return;
    }
    res.set("Cache-Control", CACHE_REVALIDATE);
    res.type("html").send(fillPublicUrl(cached));
  });
}
