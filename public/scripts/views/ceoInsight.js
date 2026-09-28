// The CEO Insight tab: the CEO's own growth tree.
// AB#739 (ISP-53): everything here moved from app.js unchanged. ISP-79 (AB#768): drawn from the design system.

import { showActionReceipt } from "./receiptModal.js"; // AB#744
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { isInsightProgramLive } from "../ceoEffects.js";
import { deepClone, toCurrency } from "../helpers.js";
import { escapeHtml, researchNodeHtml } from "../html.js";
import { appState, viewerStorage } from "../state.js";
import { pushFeedback, updateAllViews } from "./shared.js";
import { renderPrereqGraph } from "./prereqGraph.js"; // AB#2477

// ─── AB#2474 (Board review 2026-09-26, item 21): categories, each collapsible, in a collapsible Programs section ───
// Which are collapsed is remembered per viewer: { programs: expanded, categories: { name: expanded } }. Everything
// starts expanded; anything unreadable is no choice.
export const INSIGHT_STORAGE_KEY = "isp.ceoInsight.v1";

export function readInsightState(storage = viewerStorage()) {
  try {
    const saved = JSON.parse(storage?.getItem(INSIGHT_STORAGE_KEY) || "{}");
    const categories = Object.fromEntries(Object.entries(saved.categories && typeof saved.categories === "object" ? saved.categories : {}).filter(([, v]) => typeof v === "boolean"));
    return { programs: typeof saved.programs === "boolean" ? saved.programs : true, categories };
  } catch {
    return { programs: true, categories: {} };
  }
}

function writeInsightState(state, storage = viewerStorage()) {
  try {
    storage?.setItem(INSIGHT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage blocked or full: the screen still works, it just forgets on reload
  }
}

/** The programs by category, in the catalogue's order of categories; a program in none of them goes last, under Other. */
export function groupInsightPrograms(programs, categories) {
  const groups = categories.map((c) => ({ name: c.name, summary: c.summary || "", programs: [] }));
  const byName = new Map(groups.map((g) => [g.name, g]));
  for (const prog of programs) {
    let group = byName.get(prog.category);
    if (!group) {
      group = byName.get("Other") || { name: "Other", summary: "", programs: [] };
      if (!byName.has("Other")) { byName.set("Other", group); groups.push(group); }
    }
    group.programs.push(prog);
  }
  return groups.filter((g) => g.programs.length);
}

const categoryDomId = (name) => `ceo-category-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

function applyProgramsToggle(expanded) {
  const button = document.getElementById("ceo-programs-toggle");
  const body = document.getElementById("ceo-insight-tree");
  if (!button || !body) return;
  button.setAttribute("aria-expanded", String(expanded));
  body.hidden = !expanded;
}

/**
 * AB#2477: the programs as the prerequisite tree draws them, in the same states their cards show. A program is met, for
 * what depends on it, once one level is complete (the server's check, and the card's).
 */
export function insightGraphNodes(programs = [], completed = [], queuedIds = []) {
  return programs.map((prog) => {
    const done = completed.filter((id) => id === prog.id).length;
    const queued = queuedIds.filter((id) => id === prog.id).length;
    const levels = prog.maxLevels || 1;
    const base = { id: prog.id, name: levels > 1 ? `${prog.name} (${done}/${levels})` : prog.name, prereqs: prog.prereqs || [], met: done > 0 };
    if (done >= levels) return { ...base, state: "done" };
    if (queued > 0) return { ...base, state: "queued" };
    if (!isInsightProgramLive(prog)) return { ...base, state: "planned" };
    if (!(prog.prereqs || []).every((req) => completed.includes(req))) return { ...base, state: "locked" };
    return { ...base, state: "available" };
  });
}

export function renderInsightTree(data) {
  const treeWrap = document.getElementById("ceo-insight-tree");
  if (!treeWrap) return;

  const viewState = readInsightState();
  applyProgramsToggle(viewState.programs);
  const programsToggle = document.getElementById("ceo-programs-toggle");
  if (programsToggle) {
    programsToggle.onclick = () => {
      const state = readInsightState();
      state.programs = programsToggle.getAttribute("aria-expanded") !== "true";
      writeInsightState(state);
      applyProgramsToggle(state.programs);
    };
  }

  const completed = data.corp.completedInsights || [];
  const queue = data.queues?.ceoInsight || [];
  const queuedIds = queue.map((item) => item.programId).filter(Boolean);

  const programs = appState.insightPrograms;
  const cardHtml = (prog) => {
      const completionCount = completed.filter((id) => id === prog.id).length;
      const queuedCount = queuedIds.filter((id) => id === prog.id).length;
      const maxLevels = prog.maxLevels || 1;
      const isDone = completionCount >= maxLevels;
      const isQueued = queuedCount > 0 && (completionCount + queuedCount >= maxLevels);
      const isLocked = !prog.prereqs.every((req) => completed.includes(req));
      // Bug #983: a planned program has no effect yet; the server refuses it, so it is shown but not offered.
      const isPlanned = !isInsightProgramLive(prog);
      const plannedNote = isPlanned ? "No effect yet: planned for a later version." : "";
      const anyQueued = queue.length > 0;
      const canEnqueue = !isPlanned && !isDone && !isQueued && !isLocked && !anyQueued && (completionCount + queuedCount < maxLevels);
      const prereqLabel = prog.prereqs.length
        ? prog.prereqs.map((id) => programs.find((p) => p.id === id)?.name || id).join(", ")
        : "None";

      const levelLabel = maxLevels > 1 ? ` (${completionCount}/${maxLevels})` : "";
      const cost = `${prog.durationHours}h · ${toCurrency(prog.costCredits)}`;
      const card = { name: `${prog.name}${levelLabel}`, effect: prog.effect };

      if (isDone) return researchNodeHtml({ ...card, state: "done", meta: [plannedNote] });
      if (isQueued || queuedCount > 0) return researchNodeHtml({ ...card, state: "queued", meta: [cost, plannedNote] });
      if (isPlanned) return researchNodeHtml({ ...card, name: prog.name, state: "planned", meta: [plannedNote] });
      if (isLocked) return researchNodeHtml({ ...card, name: prog.name, state: "locked", meta: [`Requires: ${prereqLabel}`] });
      return researchNodeHtml({
        ...card,
        state: canEnqueue ? "available" : "waiting",
        meta: [cost, `Prereqs: ${prereqLabel}`],
        action: `<button class="ui-button ui-button--secondary insight__enroll" type="button" data-program-id="${escapeHtml(prog.id)}">Enroll</button>`
      });
  };

  const groups = groupInsightPrograms(programs, appState.insightCategories || []);
  const doneCount = (group) => group.programs.filter((p) => completed.filter((id) => id === p.id).length >= (p.maxLevels || 1)).length;
  const sections = groups.map((group) => {
    const id = categoryDomId(group.name);
    const expanded = viewState.categories[group.name] !== false;
    const count = `${group.programs.length} program${group.programs.length === 1 ? "" : "s"} · ${doneCount(group)} done`;
    // a group inside the Programs section, not a section of its own: the section's one document code covers it
    return `<div class="insight__category" role="group" aria-labelledby="${id}-title">
      <h4 id="${id}-title" class="insight__category-title">
        <button class="insight__toggle insight__toggle--category" type="button" aria-expanded="${expanded}" aria-controls="${id}" data-insight-category="${escapeHtml(group.name)}">
          <span class="insight__category-name">${escapeHtml(group.name)}<span class="insight__category-count">${count}</span></span>
          <span class="insight__arrow" aria-hidden="true">▾</span>
        </button>
      </h4>
      <div id="${id}" class="insight__category-body"${expanded ? "" : " hidden"}>
        ${group.summary ? `<p class="insight__category-summary">${escapeHtml(group.summary)}</p>` : ""}
        <div class="ui-grid">${group.programs.map(cardHtml).join("")}</div>
      </div>
    </div>`;
  }).join("");

  treeWrap.innerHTML = sections || '<div class="ui-state"><p class="ui-state__title">No insight programs configured.</p></div>';
  renderPrereqGraph(document.getElementById("ceo-prereq-graph"), {
    key: "ceo", nodes: insightGraphNodes(programs, completed, queuedIds), empty: "No insight programs configured."
  }); // AB#2477

  treeWrap.onclick = async (e) => {
    const toggle = e.target.closest("[data-insight-category]");
    if (toggle) {
      const name = toggle.getAttribute("data-insight-category");
      const expanded = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(expanded));
      const body = document.getElementById(toggle.getAttribute("aria-controls"));
      if (body) body.hidden = !expanded;
      const state = readInsightState();
      state.categories[name] = expanded;
      writeInsightState(state);
      return;
    }
    const btn = e.target.closest(".insight__enroll");
    if (!btn) return;
    const programId = btn.getAttribute("data-program-id");
    if (!programId || !appState.accountId) return;

    btn.disabled = true;
    btn.textContent = "Enrolling\u2026";

    try {
      const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
      const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/queue-ceo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId })
      });

      const account = await parseJsonResponse(response);
      appState.data = deepClone(account.state);
      appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
      updateAllViews();
      showActionReceipt(account, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
    } catch (error) {
      btn.disabled = false;
      btn.textContent = "Enroll";
      pushFeedback(`CEO Insight error: ${error.message}`, "warn");
    }
  };
}
