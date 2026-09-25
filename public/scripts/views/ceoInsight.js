// The CEO Insight tab: the CEO's own growth tree.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { isInsightProgramLive } from "../ceoEffects.js";
import { deepClone, toCurrency } from "../helpers.js";
import { escapeHtml } from "../html.js";
import { appState } from "../state.js";
import { pushFeedback, updateAllViews } from "./shared.js";

export function renderInsightTree(data) {
  const treeWrap = document.getElementById("ceo-insight-tree");
  if (!treeWrap) return;

  const completed = data.corp.completedInsights || [];
  const queue = data.queues?.ceoInsight || [];
  const queuedIds = queue.map((item) => item.programId).filter(Boolean);

  const programs = appState.insightPrograms;
  const rows = programs
    .map((prog) => {
      const completionCount = completed.filter((id) => id === prog.id).length;
      const queuedCount = queuedIds.filter((id) => id === prog.id).length;
      const maxLevels = prog.maxLevels || 1;
      const isDone = completionCount >= maxLevels;
      const isQueued = queuedCount > 0 && (completionCount + queuedCount >= maxLevels);
      const isLocked = !prog.prereqs.every((req) => completed.includes(req));
      // Bug #983: a planned program has no effect yet; the server refuses it, so it is shown but not offered.
      const isPlanned = !isInsightProgramLive(prog);
      const plannedNote = isPlanned ? `<span class="rnd-row__meta">No effect yet: planned for a later version.</span>` : "";
      const anyQueued = queue.length > 0;
      const canEnqueue = !isPlanned && !isDone && !isQueued && !isLocked && !anyQueued && (completionCount + queuedCount < maxLevels);
      const prereqLabel = prog.prereqs.length
        ? prog.prereqs.map((id) => programs.find((p) => p.id === id)?.name || id).join(", ")
        : "None";

      const levelLabel = maxLevels > 1 ? ` (${completionCount}/${maxLevels})` : "";

      if (isDone) {
        return `<div class="rnd-row rnd-row--done">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(prog.name)}${levelLabel}</span>
            <span class="rnd-row__effect">${escapeHtml(prog.effect)}</span>
            ${plannedNote}
          </div>
          <span class="rnd-row__badge rnd-row__badge--done">\u2713 COMPLETE</span>
        </div>`;
      }

      if (isQueued || queuedCount > 0) {
        return `<div class="rnd-row rnd-row--queued">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(prog.name)}${levelLabel}</span>
            <span class="rnd-row__effect">${escapeHtml(prog.effect)}</span>
            <span class="rnd-row__meta">${prog.durationHours}h &middot; ${toCurrency(prog.costCredits)}</span>
            ${plannedNote}
          </div>
          <span class="rnd-row__badge rnd-row__badge--queued">IN QUEUE</span>
        </div>`;
      }

      if (isPlanned) {
        return `<div class="rnd-row rnd-row--locked rnd-row--planned">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(prog.name)}</span>
            <span class="rnd-row__effect">${escapeHtml(prog.effect)}</span>
            ${plannedNote}
          </div>
          <span class="rnd-row__badge rnd-row__badge--locked">PLANNED</span>
        </div>`;
      }

      if (isLocked) {
        return `<div class="rnd-row rnd-row--locked">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(prog.name)}</span>
            <span class="rnd-row__effect">${escapeHtml(prog.effect)}</span>
            <span class="rnd-row__meta">Requires: ${escapeHtml(prereqLabel)}</span>
          </div>
          <span class="rnd-row__badge rnd-row__badge--locked">LOCKED</span>
        </div>`;
      }

      // Available
      return `<div class="rnd-row rnd-row--available">
        <div class="rnd-row__info">
          <span class="rnd-row__name">${escapeHtml(prog.name)}${levelLabel}</span>
          <span class="rnd-row__effect">${escapeHtml(prog.effect)}</span>
          <span class="rnd-row__meta">${prog.durationHours}h &middot; ${toCurrency(prog.costCredits)} &middot; Prereqs: ${escapeHtml(prereqLabel)}</span>
        </div>
        ${canEnqueue
          ? `<button class="btn btn-accent ceo-enqueue-btn" type="button" data-program-id="${prog.id}">+ Enroll</button>`
          : `<span class="rnd-row__badge rnd-row__badge--locked">AWAITING SLOT</span>`
        }
      </div>`;
    })
    .join("");

  treeWrap.innerHTML = rows || '<p class="muted">No insight programs configured.</p>';

  treeWrap.onclick = async (e) => {
    const btn = e.target.closest(".ceo-enqueue-btn");
    if (!btn) return;
    const programId = btn.getAttribute("data-program-id");
    if (!programId || !appState.accountId) return;

    btn.disabled = true;
    btn.textContent = "Enrolling\u2026";

    try {
      const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/queue-ceo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId })
      });

      const account = await parseJsonResponse(response);
      appState.data = deepClone(account.state);
      appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
      updateAllViews();
    } catch (error) {
      btn.disabled = false;
      btn.textContent = "+ Enroll";
      pushFeedback(`CEO Insight error: ${error.message}`, "warn");
    }
  };
}
