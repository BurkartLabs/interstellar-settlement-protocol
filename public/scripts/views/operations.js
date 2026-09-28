// AB#2471: the Operations tab: everything in progress (public/scripts/operations.js) and, on its own subpage, the mining
// cycles' detail (views/miningTicker.js draws #mine-cycle-list wherever it sits). Each row's Open goes to the tab the
// thing is run from. The subpage bars of Operations and the Station are bound here, once.
import { chainTitle } from "../chainPlan.js";
import { operationsHtml, operationsRows, operationsSummary } from "../operations.js";
import { appState, techTree } from "../state.js";
import { bindSubnav, selectSubpage } from "../subnav.js";
import { formatSystemLabel, setTab } from "./shared.js";

function context(data) {
  const chains = data?.world?.refineryChains || [];
  return {
    techName: (id) => techTree.find((t) => t.id === id)?.name,
    chainName: (id) => { const c = chains.find((x) => x.id === id); return c ? chainTitle(c) : null; },
    systemName: (id) => formatSystemLabel(id),
    stationName: (id) => (appState.stationRegistry || []).find((s) => s.id === id)?.name || id,
    unitName: (id) => (appState.units || []).find((u) => u.id === id)?.name || id
  };
}

/** Draw the list and its one-line summary from the account state. */
export function renderOperations(data) {
  const list = document.getElementById("operations-list");
  if (!list || !data) return;
  const now = Date.now();
  const rows = operationsRows(data, now, context(data));
  list.innerHTML = operationsHtml(rows, now);
  const summary = document.getElementById("operations-summary");
  if (summary) summary.textContent = operationsSummary(rows);
}

/** Bind both subpage bars, remembering each one's choice for the session, and the rows' Open buttons. Once. */
export function bindOperations(doc = document) {
  const station = doc.getElementById("station-subnav");
  bindSubnav(station, { onChange: (id) => { appState.stationSubpage = id; } }, doc);
  bindSubnav(doc.getElementById("operations-subnav"), { onChange: (id) => { appState.operationsSubpage = id; } }, doc);
  doc.getElementById("operations-list")?.addEventListener("click", (event) => {
    const go = event.target.closest("[data-op-tab]");
    if (!go) return;
    setTab(go.dataset.opTab);
    if (go.dataset.opSub) selectSubpage(doc.getElementById("operations-subnav"), go.dataset.opSub, doc);
  });
}
