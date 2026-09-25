// ISP-72 (AB#761): the two core components that need more than CSS. Tabs move with the arrow keys, Home and End, as
// the ARIA tabs pattern has them (one tab in the tab order at a time, the selected one). A tooltip opens on hover and
// focus from CSS alone, and Escape closes it until the pointer or focus leaves, as WCAG 1.4.13 asks.

/** Wire every [role=tablist] under root. */
export function initTabs(root = document) {
  for (const list of root.querySelectorAll('[role="tablist"]')) {
    const tabs = () => [...list.querySelectorAll('[role="tab"]')].filter((t) => !t.disabled);
    const select = (tab) => {
      for (const t of list.querySelectorAll('[role="tab"]')) {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      }
      tab.focus();
    };
    list.addEventListener("click", (e) => {
      const tab = e.target.closest('[role="tab"]');
      if (tab && !tab.disabled) select(tab);
    });
    list.addEventListener("keydown", (e) => {
      const all = tabs();
      const i = all.indexOf(document.activeElement);
      if (i < 0) return;
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select(all[(next + all.length) % all.length]);
    });
  }
}

/** Escape closes an open tooltip; it can open again once the pointer or focus has left its trigger. */
export function initTooltips(root = document) {
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const wrap of root.querySelectorAll(".ui-tooltip-wrap")) {
      if (wrap.matches(":hover, :focus-within")) wrap.classList.add("is-dismissed");
    }
  });
  for (const wrap of root.querySelectorAll(".ui-tooltip-wrap")) {
    const reset = () => wrap.classList.remove("is-dismissed");
    wrap.addEventListener("mouseleave", reset);
    wrap.addEventListener("focusout", reset);
  }
}
