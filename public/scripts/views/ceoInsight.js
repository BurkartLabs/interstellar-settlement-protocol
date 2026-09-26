// The CEO Insight tab: the CEO's own growth tree.
// AB#739 (ISP-53): everything here moved from app.js unchanged. ISP-79 (AB#768): drawn from the design system.

import { showActionReceipt } from "./receiptModal.js"; // AB#744
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { isInsightProgramLive } from "../ceoEffects.js";
import { deepClone, toCurrency } from "../helpers.js";
import { escapeHtml, researchNodeHtml } from "../html.js";
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
    })
    .join("");

  treeWrap.innerHTML = rows || '<div class="ui-state"><p class="ui-state__title">No insight programs configured.</p></div>';

  treeWrap.onclick = async (e) => {
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
