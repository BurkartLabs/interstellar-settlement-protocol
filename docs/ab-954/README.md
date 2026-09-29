# AB#954 (ISP-258): shareable and findable

## What was added

- **Favicon:** `favicon.svg` is the landing's emblem on the page's dark ground, so it reads on a light tab strip. Alongside it are `favicon.ico` (16, 32 and 48px) for anything that asks for `/favicon.ico` directly, and `apple-touch-icon.png` (180px). Every public page links them, the style guide included.
- **The landing's head:**
  - a meta description, and `theme-color` (#05070a, the page's background);
  - `<link rel="canonical">`;
  - Open Graph tags: type, site name, title, description, url, and an image with its width, height and alt text;
  - a Twitter `summary_large_image` card.
- **Descriptions** for login, register and how to start.
- **The preview image** `images/og/landing.jpg` is a real screenshot of the landing's first 1200x630 (taken at 2x and scaled, 54 KB).
- **`robots.txt`:** everything may be indexed except `/api/` and `/styleguide/`.

## One URL setting

The canonical link, og:url, og:image and twitter:image are written in `public/index.html` as `%ISP_PUBLIC_URL%`. `server/publicPages.js` fills them from `publicBaseUrl()`, which reads `ISP_PUBLIC_URL`, the setting mail's links already use (`server/mail.js`). No file names a domain, and a test checks that.

In production, `ops/infra/isp/isp.bicep` sets `ISP_PUBLIC_URL` to the app's Container Apps address until Decision D-1.0-1 names the real domain (its `publicUrl` parameter). So that address is the placeholder, and picking the domain is not decided here.

## Cross-origin embedding: flagged for veto

helmet sends `Cross-Origin-Resource-Policy: same-origin` on everything. Under that, a chat client or search page that draws a preview in the browser could not load the preview image or the favicon; my first render of the preview card showed a broken image. Only those files now say `cross-origin`: `images/og/*`, `favicon.svg`, `favicon.ico` and `apple-touch-icon.png`. Everything else stays same-origin.

## Measured

- **Lighthouse SEO on the landing** (mobile, Chromium): **91 before → 100 after.** Before, it failed only on the missing meta description. It is also 100 with `ISP_PUBLIC_URL` set to a placeholder domain (`https://isp.example`), so a canonical on another domain costs nothing.
- **A landing load, cold:** 166 responses, none at 400 or above. Headless Chromium never asks for a favicon, so that count is no evidence either way. `/favicon.ico` itself answers 200 now; before this change there was no such file. A test covers it.
- **The tags as an unfurler reads them,** from the raw HTML with a Slackbot user agent and no scripts: title, description, og:image, og:url, the card type and the canonical link are all present. og:image answers 200, image/jpeg.

## Screenshots

- `preview-card-from-tags.png`: **a local stand-in, not a real unfurler.** It is a card drawn only from the tags above, with the image loaded cross-origin. It shows what an unfurler receives, not how a particular app draws it.
- `favicon.png`: the ICO at tab size beside a title, then the SVG and the touch icon, each loaded cross-origin from the server.

## Needs the Board

Acceptance line 1 asks for a preview in a real unfurler, such as a chat app. An unfurler fetches the page from the internet, so it needs a public URL: the deployed site, or a tunnel to this machine. I did not open a tunnel; exposing a local server is not mine to do unasked. After the next deploy, paste the production URL into Slack, Discord or opengraph.xyz and screenshot the preview.
