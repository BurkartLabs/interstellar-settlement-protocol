# AB#964 (ISP-268): the client on a phone, before and after

## How it was measured

- **Tool:** Lighthouse 12, mobile profile (simulated slow 4G and a 4x slower CPU), performance category only.
- **Browser:** Playwright's Chromium 1243. Edge gave repeated NO_NAVSTART trace failures.
- **Server:** a scratch server on each worktree (NODE_ENV=test, a seeded corporation docked at Earth Station Prime).
- **Runs:** three per page, with an errored run retried; the median by score is reported.
- **Landing page:** `/`, logged out.
- **Main app view:** `/?account=…`, signed in by a fresh login's refresh cookie, a first load (empty cache).
- **Before:** main at dcaf158c. **After:** this branch.
- **Script:** `T:/tmp/lh964.mjs` (not committed).

| Page | Score before | Score after | LCP (simulated) | Transferred, first load | Requests |
|---|---|---|---|---|---|
| Landing | 58 (58, 58, 57) | **66** (63, 66, 66) | 10.5 s → 7.4 s | **2,845 KB → 838 KB** | 179 → 162 |
| Main app view | 51 (50, 51, 54) | **61** (60, 61, 65) | 12.1 s → 8.5 s | 3,147 KB → 924 KB | 198 → 179 |

**Not met:** AB#964's 85. What remains is structural, and is filed:

1. **#4836:** the logged-out landing loads the whole game, about 144 script modules. Locally its LCP is a static paragraph painted at 0.56 s. Lighthouse's simulation charges those module requests to the first paint, so it estimates 7.4 s on a phone.
2. **#4837:** there is no build step, so the client ships 180 unbundled, unminified modules. Their import depth is a waterfall of round trips, and it is most of what keeps the app view at 61.
3. **#4838:** Chart.js (70 KB) loads on every page, though only two charts use it.
4. **#4839:** one 180 KB render-blocking stylesheet, 80% of it unused on the landing.
5. **#4840:** the landing loads the socket.io client and calls /api/bootstrap before anyone signs in.

## What changed

- **Compression:** gzip or brotli for every response the browser accepts it for (`compression`). Lighthouse's largest opportunity before was 1.2 MB of uncompressed text.
- **Images:**
  - The three building photographs sit under a 78% scrim; they are now 960 wide at q55, about 1 MB → 147 KB.
  - The portrait, the probe and the planets are cut to twice their shown size.
  - Three orphans are deleted.
  - `public/images` goes from ~2.4 MB to ~440 KB.
  - The starmap loads a planet's image when it first draws it, where it used to preload all eighteen on every page.
- **Fonts and Chart.js** are served from `public/vendor/` (Inter 5.3.0 variable, OFL; Chart.js 4.4.3, MIT). The CSP is now `'self'` for scripts, styles and fonts.
- **The starfield** stops while the tab is hidden and under reduced motion, and starts again when shown (`tests/unit/starfield.test.js`).
- **Cache headers** (`server/staticCache.js`):

```
GET /                                   Cache-Control: no-cache                                Content-Encoding: br
GET /styles.css                         Cache-Control: no-cache                                Content-Encoding: br
GET /scripts/app.js                     Cache-Control: no-cache                                Content-Encoding: br
GET /images/planets/earth.jpg           Cache-Control: public, max-age=604800, stale-while-revalidate=86400
GET /vendor/chart.js-4.4.3/chart.umd.min.js   Cache-Control: public, max-age=31536000, immutable   Content-Encoding: br
GET /vendor/inter-5.3.0/inter-latin-wght-normal.woff2   Cache-Control: public, max-age=31536000, immutable
```

Pages, scripts and styles carry no fingerprint, so they revalidate on every load (a 304 when unchanged) and a deploy is seen at once. Only versioned vendor paths are kept a year.

## Looked at (375px, 2x, after the image changes)

1. `1-landing-375.png`: the landing, in the self-hosted Inter
2. `2-walkthrough-portrait-375.png`: Elara Voss's portrait at 240 wide
3. `3-app-overview-375.png`: the main app view
4. `4-station-375.png`: Earth at 384px in the station art
5. `5a-oes-header-375.png`, `5b-icl-header-375.png`: two building headers under their scrim
6. `6-exchange-375.png`, `7-exchange-1280.png`: the Exchange's background
7. `8-starmap-375.png`: the starmap

No page errors and no failed requests. I saw no blocking or banding in the recompressed images; the header photos are a little softer, under their scrim. A human should check them too, as AB#964 asks.
