// server/staticCache.js: how long a browser may keep each static file (AB#964, ISP-268). The pages, scripts and styles
// have no fingerprint in their names, so they are revalidated on every load (a 304 when unchanged) and a deploy is seen
// at once. A file whose path names its version (public/vendor/<package>-<version>/) never changes and is kept a year.
// Images keep their names when replaced, so a week, and a day more served while the browser checks.

export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
export const CACHE_IMAGES = "public, max-age=604800, stale-while-revalidate=86400";
export const CACHE_REVALIDATE = "no-cache";

/** The Cache-Control for a static file, by its path under public/ (forward slashes). */
export function cacheControlFor(relPath) {
  const p = String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (p.startsWith("vendor/")) return CACHE_IMMUTABLE;
  if (p.startsWith("images/") || /\.(png|jpe?g|webp|gif|svg|ico)$/i.test(p)) return CACHE_IMAGES;
  return CACHE_REVALIDATE;
}

/** express.static's options for public/: each file's Cache-Control from cacheControlFor. */
export function staticOptions(publicDir) {
  return {
    setHeaders(res, filePath) {
      const rel = filePath.slice(publicDir.length);
      res.setHeader("Cache-Control", cacheControlFor(rel));
    }
  };
}
