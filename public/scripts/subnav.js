// public/scripts/subnav.js: a screen's subpages (DOCTRINE P-010; Feature AB#2468). A subpage bar is the design system's
// tabs (<nav class="ui-tabs" role="tablist">, one <button class="ui-tab" role="tab" aria-controls> per subpage, each
// panel role="tabpanel"), the markup AB#2470's Financial Core uses too. This binds one: a click or the arrow keys
// select a subpage, and only its panel shows. showSubpageOf(el) opens whatever subpage holds `el`, so a link or a
// walkthrough step that points into a subpage never lands on a hidden element.

const tabsOf = (nav) => [...nav.querySelectorAll('[role="tab"]')];
const panelOf = (tab, doc) => doc.getElementById(tab.getAttribute("aria-controls"));

/** Select `tab` in its bar: it and its panel are shown, the others hidden. Calls the bar's onChange with the tab's id. */
export function selectTab(tab, doc = document) {
  const nav = tab.closest('[role="tablist"]');
  if (!nav) return;
  for (const t of tabsOf(nav)) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    const panel = panelOf(t, doc);
    if (panel) panel.hidden = !on;
  }
  nav._onSubnavChange?.(tab.dataset.subpage);
}

/** Select the subpage named `id` (a tab's data-subpage) in `nav`. */
export function selectSubpage(nav, id, doc = document) {
  const tab = tabsOf(nav).find((t) => t.dataset.subpage === id);
  if (tab) selectTab(tab, doc);
}

/**
 * Bind a subpage bar once: click and Left/Right/Home/End, as the design system's tabs move (ISP-72). `onChange(id)`
 * hears each selection, to remember it.
 */
export function bindSubnav(nav, { onChange } = {}, doc = document) {
  if (!nav || nav.dataset.subnavBound) return;
  nav.dataset.subnavBound = "1";
  nav._onSubnavChange = onChange;
  nav.addEventListener("click", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab && nav.contains(tab)) selectTab(tab, doc);
  });
  nav.addEventListener("keydown", (event) => {
    const tabs = tabsOf(nav);
    const at = tabs.indexOf(event.target.closest('[role="tab"]'));
    if (at < 0) return;
    const to = { ArrowRight: (at + 1) % tabs.length, ArrowLeft: (at - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    selectTab(tabs[to], doc);
    tabs[to].focus();
  });
}

/** Open the subpage that holds `el`, if it sits in a hidden one. True when it changed something. */
export function showSubpageOf(el, doc = document) {
  const panel = el?.closest?.('[role="tabpanel"][hidden]');
  if (!panel) return false;
  const tab = doc.querySelector(`[role="tab"][aria-controls="${panel.id}"]`);
  if (!tab) return false;
  selectTab(tab, doc);
  return true;
}
