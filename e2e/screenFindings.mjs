// e2e/screenFindings.mjs: what is off the design system on the screen in sight (ISP-83, AB#772), shared by
// e2e/every-screen.spec.js and e2e/company-station-screens.spec.js (ISP-250, AB#946), so both hold screens to one rule.
/** The components the design system replaced (ISP-72 to ISP-82). None may be in sight on any screen. */
export const LEGACY = ["btn", "btn-accent", "btn-outline", "btn-ghost", "muted", "overline", "lede", "choice-row", "form-card", "data-card", "card-grid", "text-list", "panel-block", "pill", "queue-item", "queue-list"];

/**
 * What is wrong on the screen in sight, as lines: sideways scroll at any width; at 375 text under 14px and controls
 * under 44px; legacy components. `scope` is where to look (the whole page, or a tab with the shell around it).
 */
export async function findings(page, name, width, scope = "body") {
  return page.evaluate(({ name, narrow, scope, legacy }) => {
    const out = [];
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (overflow > 0) out.push(`${name}: sideways scroll ${overflow}px`);
    const shown = (el) => el.getClientRects().length && !el.closest("[hidden]") && getComputedStyle(el).visibility !== "hidden";
    const roots = [...document.querySelectorAll(scope)].filter(shown);
    const label = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : ""}`;
    // What the sideways-scroll check cannot see (found by looking): a box past the left edge, which never scrolls, or past
    // the right inside something that clips it; and a control whose words are wider than it.
    const vw = document.documentElement.clientWidth;
    const inScroller = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox !== "visible" && a.scrollWidth > a.clientWidth + 1) return true;
      }
      return false;
    };
    for (const root of roots) {
      for (const el of root.querySelectorAll(legacy.map((c) => `.${c}`).join(","))) {
        if (shown(el)) out.push(`${name}: legacy ${label(el)}`);
      }
      for (const el of root.querySelectorAll("*")) {
        if (!shown(el) || el.closest("canvas, svg, [aria-hidden='true']")) continue; // decoration may bleed
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.left < -1 || r.right > vw + 1) && !inScroller(el)) out.push(`${name}: off screen ${label(el)} ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
      for (const el of root.querySelectorAll("button, [role=tab], .ui-badge")) {
        if (shown(el) && el.scrollWidth > el.clientWidth + 1) out.push(`${name}: words wider than ${label(el)} "${el.textContent.trim().slice(0, 24)}"`);
      }
      if (!narrow) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!n.textContent.trim() || !shown(el) || el.closest("canvas, option, .sr-only")) continue;
        const f = parseFloat(getComputedStyle(el).fontSize);
        if (f < 14) out.push(`${name}: ${f}px text ${label(el)} "${n.textContent.trim().slice(0, 30)}"`);
      }
      for (const el of root.querySelectorAll("button, input, select, textarea, a, [role=button], [role=tab]")) {
        if (!shown(el) || (el.tagName === "A" && el.closest("p, li"))) continue; // a link in running text is exempt
        // ISP-250 (AB#946): a radio or checkbox inside its <label> is toggled by the whole label, which is its target
        // (WCAG 2.5.8 counts it), so the label is measured
        const box = el.matches("input[type=radio], input[type=checkbox]") && el.closest("label") ? el.closest("label") : el;
        const r = box.getBoundingClientRect();
        if (r.width > 0 && (r.width < 44 || r.height < 44)) out.push(`${name}: control ${Math.round(r.width)}x${Math.round(r.height)} ${label(el)} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24)}"`);
      }
    }
    return [...new Set(out)];
  }, { name, narrow: width === 375, scope, legacy: LEGACY });
}

