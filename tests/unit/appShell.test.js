import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NARROW_MAX_WIDTH } from "../../public/scripts/firstAction.js";

// ISP-74 (AB#763): the app shell. At 1280 the navigation is a column beside the content; at 375 it is two rows along
// the top of the screen (AB#2468; it was a bar along the bottom) and the content is full width. One media query decides it, at the width the scripts already
// call a phone (NARROW_MAX_WIDTH), and no other query reaches the shell. Where the bar sits, and that nothing hides
// under it, is measured in a browser by e2e/app-shell.spec.js; this holds the markup and the stylesheet to the shape.
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const HTML = read("public/index.html");
const CSS = read("public/styles.css");

/** Every @media block in the stylesheet: its query and its body. */
const mediaBlocks = () =>
  [...CSS.matchAll(/@media([^{]+)\{/g)].map((m) => {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (depth && i < CSS.length) {
      if (CSS[i] === "{") depth += 1;
      else if (CSS[i] === "}") depth -= 1;
      i += 1;
    }
    return { query: m[1].trim(), body: CSS.slice(start, i - 1) };
  });
const SHELL = /\.(layout-grid|app-nav|nav-group|nav-tab|side-panel|main-panel)\b/;

describe("the app shell (ISP-74)", () => {
  it("the navigation is the grid's own first child, not a row inside the content, and outside <main>", () => {
    const grid = HTML.indexOf('<div class="layout-grid">');
    const nav = HTML.indexOf('<nav class="app-nav" aria-label="Game modules">');
    expect(grid).toBeGreaterThan(-1);
    expect(nav).toBeGreaterThan(grid);
    expect(HTML.slice(grid, nav).replace(/<!--[\s\S]*?-->/g, "").trim()).toBe('<div class="layout-grid">');
    expect(nav).toBeLessThan(HTML.indexOf('<aside class="side-panel"'));
    // <main> is the content alone: the bar is fixed to the screen, and nothing fixed may sit in <main> (Bug AB#1832).
    expect(HTML.indexOf('<main class="main-panel">')).toBeGreaterThan(HTML.indexOf('<aside class="side-panel"'));
    expect(HTML.slice(HTML.indexOf('<main class="main-panel">'))).not.toContain('class="app-nav');
  });

  it("on a desktop, the navigation and the side panel share a column beside the content", () => {
    const rule = /\.layout-grid {([^}]*)}/.exec(CSS)?.[1] ?? "";
    expect(rule).toMatch(/grid-template-areas:\s*"nav main"\s*"side main"/);
    expect(CSS).toMatch(/\.app-nav {[^}]*grid-area: nav;[^}]*flex-direction: column;/);
  });

  it("on a phone, one query makes the navigation two rows along the top and the content full width", () => {
    const shell = mediaBlocks().filter((b) => SHELL.test(b.body));
    expect(shell.map((b) => b.query)).toEqual([`(max-width: ${NARROW_MAX_WIDTH}px)`]);
    const phone = shell[0].body;
    expect(phone).toMatch(/\.layout-grid {[^}]*grid-template-areas:\s*"main"\s*"side";/); // Bug #4846: the screen first, the sidebar's panels after it
    expect(phone).toMatch(/\.app-nav {[^}]*position: fixed;[^}]*top: 0;/); // AB#2468: along the top
    // ISP-75: the six group buttons are the bar and never scroll; each group button and each tab is 44px.
    expect(phone).toMatch(/\.app-nav {[^}]*display: flex;[^}]*flex-direction: row;/);
    expect(phone).not.toMatch(/\.app-nav {[^}]*overflow-x/);
    expect(phone).toMatch(/\.nav-group__button {[^}]*min-height: 44px;/);
    expect(phone).toMatch(/\.nav-tab {[^}]*min-height: 44px;/);
    // Room over the content and the briefing card for the two rows, so neither starts beneath them (AB#2468).
    expect(phone).toMatch(/\.layout-grid {[^}]*padding-top: calc\(var\(--phone-nav-height\)/);
    expect(phone).toMatch(/#walkthrough-modal {[^}]*padding-top: var\(--phone-nav-height\);/);
    // And whatever the browser scrolls into view (keyboard focus, scrollIntoView) stops below the rows, not under them:
    // without this, Hire Personnel was scrolled under the bar and the bar took the tap (e2e/action-receipt.spec.js).
    expect(phone).toMatch(/html {[^}]*scroll-padding-top: calc\(var\(--phone-nav-height\)/);
  });

  // AB#2468: on a phone the header is not shown. Its controls (Notifications, Replay Onboarding, Log Out and the rest)
  // are a sheet the ☰ opens; the ☰ is in the navigation, names what it controls, and a desktop never shows it.
  it("on a phone the header is a sheet the ☰ in the navigation opens; a desktop shows the header and no ☰", () => {
    const phone = mediaBlocks().find((b) => b.query === `(max-width: ${NARROW_MAX_WIDTH}px)` && /\.app-nav \{/.test(b.body)).body;
    expect(phone).toMatch(/\.app-header {[^}]*display: none;/);
    expect(phone).toMatch(/#game-shell\.is-menu-open \.app-header {[^}]*display: flex;[^}]*position: fixed;/);
    expect(phone).toMatch(/\.app-nav__menu {[^}]*min-width: 44px;[^}]*min-height: 44px;/);
    expect(CSS).toMatch(/^\.app-nav__menu {\s*display: none;\s*}/m); // outside any query: a desktop never shows it
    const nav = HTML.slice(HTML.indexOf('<nav class="app-nav"'), HTML.indexOf("</nav>", HTML.indexOf('<nav class="app-nav"')));
    expect(nav).toMatch(/<button id="phone-menu-toggle" class="app-nav__menu" type="button" aria-expanded="false" aria-controls="app-header"/);
    expect(HTML).toContain('<header class="app-header" id="app-header">');
    for (const id of ["notification-toggle", "replay-onboarding-btn", "logout-btn"]) {
      const at = HTML.indexOf(`id="${id}"`);
      expect(at, id).toBeGreaterThan(HTML.indexOf('<header class="app-header"'));
      expect(at, id).toBeLessThan(HTML.indexOf('<div class="layout-grid">')); // the header ends where the grid begins
    }
  });

  // AB#2468 slice 2: on a phone the sidebar's blocks are not on the page; a bar pinned along the bottom opens each as a
  // sheet above it, and the page keeps its last control clear of the bar. A desktop never shows the bar.
  it("on a phone Profile, Milestones and Quick Actions are pinned along the bottom and open their block as a sheet", () => {
    const phone = mediaBlocks().find((b) => b.query === `(max-width: ${NARROW_MAX_WIDTH}px)` && /\.app-nav \{/.test(b.body)).body;
    const bar = HTML.slice(HTML.indexOf('<nav class="pinned-bar"'), HTML.indexOf("</nav>", HTML.indexOf('<nav class="pinned-bar"')));
    const buttons = [...bar.matchAll(/<button class="pinned-bar__button" type="button" data-panel="([\w-]+)" aria-expanded="false" aria-controls="side-panel">([^<]+)<\/button>/g)];
    expect(buttons.map((m) => m[2])).toEqual(["Profile", "Milestones", "Quick Actions"]);
    for (const [, id] of buttons) expect(HTML, id).toContain(`id="${id}"`);
    // after the navigation and before the sidebar, so the keyboard goes from the bar into the open sheet
    expect(HTML.indexOf('<nav class="pinned-bar"')).toBeGreaterThan(HTML.indexOf('<nav class="app-nav"'));
    expect(HTML.indexOf('<nav class="pinned-bar"')).toBeLessThan(HTML.indexOf('<aside class="side-panel" id="side-panel">'));
    expect(CSS).toMatch(/^\.pinned-bar {\s*display: none;\s*}/m); // outside any query: a desktop never shows it
    expect(phone).toMatch(/\.pinned-bar {[^}]*position: fixed;[^}]*bottom: 0;/);
    expect(phone).toMatch(/\.pinned-bar__button {[^}]*min-height: 44px;/);
    expect(phone).toMatch(/\.side-panel {\s*display: none;/);
    expect(phone).toMatch(/#game-shell\[data-pinned\] \.side-panel {[^}]*position: fixed;[^}]*bottom: var\(--pinned-bar-height\);/);
    // the page scrolls clear of the bar: room under the content and the briefing card, and scrolled-to controls stop above it
    expect(phone).toMatch(/\.layout-grid {[^}]*padding-bottom: calc\(var\(--pinned-bar-height\)/);
    expect(phone).toMatch(/html {[^}]*scroll-padding-bottom: calc\(var\(--pinned-bar-height\)/);
    expect(phone).toMatch(/#walkthrough-modal {[^}]*padding-bottom: var\(--pinned-bar-height\);/);
  });

  it("the bar sits under every dialog and the briefing, never over them", () => {
    // Bug #4886: the layers are tokens now; a value is a number or var(--z-...), read from the token block
    const layer = (v) => Number(/^-?\d+$/.test(v ?? "") ? v : new RegExp(`${v?.match(/var\((--z-[\w-]+)\)/)?.[1]}:\\s*(-?\\d+);`).exec(CSS)?.[1]);
    const z = layer(/\.app-nav {[^}]*z-index: ([^;]+);/.exec(mediaBlocks().find((b) => /\.app-nav/.test(b.body)).body)?.[1]);
    const dialog = layer(/\.modal-backdrop {[^}]*z-index: ([^;]+);/.exec(CSS)?.[1]);
    const briefing = layer(/#walkthrough-modal {[^}]*z-index: ([^;]+);/.exec(CSS)?.[1]);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(dialog);
    expect(z).toBeLessThan(briefing);
  });
});
