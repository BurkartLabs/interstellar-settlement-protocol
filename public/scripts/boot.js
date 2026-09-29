// Bug #4836: index.html's entry. The page is the logged-out landing and the game shell in one document, and app.js
// imports every view, so a visitor with no account downloaded the whole game (145 modules, about 440 KB, and Chart.js)
// before seeing a paragraph of static text; Lighthouse's phone profile put the landing's LCP at 7.6 s. The landing is
// static HTML and needs none of it. Only a visit that opens the game loads Chart.js and then app.js, in the order the
// two script tags ran in before.
//
// It imports only legacyTokens.js, so the landing loads it, that, and the starfield, and nothing else.
import { forgetLegacyTokens } from "./legacyTokens.js";

/** state.js STORAGE_KEYS.accountId; tests/unit/boot.test.js holds the two equal. */
export const ACCOUNT_KEY = "isp.accountId";
export const CHART_SRC = "/vendor/chart.js-4.4.3/chart.umd.min.js";

/**
 * Whether this visit opens the game: an account in the URL (the login page sends a player to /?account=<id>), one this
 * browser remembers (a reload), or the dev dummy login. app.js decides everything past that, as it did before.
 */
export function opensGame(href, storage) {
  const url = new URL(href);
  if (url.searchParams.get("account") || url.searchParams.get("dummy") === "1") return true;
  try {
    return Boolean(storage?.getItem(ACCOUNT_KEY));
  } catch {
    return false; // storage blocked: nothing is remembered, as app.js's own read would find
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`${src} did not load`));
    document.head.append(script);
  });
}

async function start() {
  forgetLegacyTokens(); // AB#757: on every load, the landing's included
  if (!opensGame(window.location.href, globalThis.localStorage)) return; // the landing: static HTML, and the starfield
  // Chart.js first, as its classic script tag ran before app.js's module did; a chart that cannot load leaves the game
  // playable (charts.js and priceChart.js check for it), so its failure does not stop the game opening.
  await loadScript(CHART_SRC).catch((error) => console.error("[boot]", error));
  await import("./app.js");
}

if (typeof window !== "undefined" && typeof document !== "undefined") start();
