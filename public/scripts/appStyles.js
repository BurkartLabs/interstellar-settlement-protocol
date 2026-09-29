// Bug #4839: the whole stylesheet, attached without blocking the landing's first paint. index.html blocks only on
// landing.css (the landing's rules, extracted from styles.css by scripts/landing-css.mjs), preloads styles.css, and
// loads this module async; a stylesheet a script adds is not render-blocking. The CSP forbids an onload="" attribute
// (script-src-attr 'none'), so the usual media="print" swap cannot be used.
//
// app.js imports appStylesReady and waits for it before it opens the game, so the game never draws on landing.css
// alone. One module instance serves both, so the stylesheet is added once.
export const appStylesReady = (() => {
  if (typeof document === "undefined") return Promise.resolve();
  const present = document.querySelector('link[rel="stylesheet"][href="styles.css"]');
  if (present?.sheet) return Promise.resolve();
  const link = present || Object.assign(document.createElement("link"), { rel: "stylesheet", href: "styles.css" });
  const ready = new Promise((resolve) => {
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true }); // the game still opens; it cannot be worse than unstyled
  });
  if (!present) document.head.append(link);
  return ready;
})();
