// The Corporate R&D tab: the tech tree, the research picker and the queues.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { showActionReceipt } from "./receiptModal.js"; // AB#744
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { deepClone, toCurrency } from "../helpers.js";
import { escapeHtml, queueItemsHtml } from "../html.js";
import { formatHoursMinutes, nextRndStart, rndItemStatus, scheduleRndQueue } from "../rndQueue.js";
import { appState, techTree } from "../state.js";
import { flashButtonSuccess, pushFeedback, updateAllViews } from "./shared.js";

export function getTechNode(techId) {
  return techTree.find((item) => item.id === techId) || null;
}

export function availableTechNodes(data) {
  const done = new Set(data.corp.unlockedTech || []);
  const inQueue = new Set((data.queues.corporateRnD || []).map((item) => item.techId).filter(Boolean));
  const tier1Ids = techTree.filter((n) => n.tier === 1).map((n) => n.id);
  const allTier1Done = tier1Ids.every((id) => done.has(id));

  return techTree.filter((node) => {
    if (done.has(node.id) || inQueue.has(node.id)) return false;
    if (!node.prereqs.every((req) => done.has(req))) return false;
    if (node.tier >= 2 && !allTier1Done) return false;
    return true;
  });
}

export function renderTechTree(data) {
  const treeWrap = document.getElementById("rnd-tech-tree");
  const done = new Set(data.corp.unlockedTech || []);
  const inQueue = new Set((data.queues.corporateRnD || []).map((item) => item.techId).filter(Boolean));

  // Still populate the ghost #rnd-select so the existing submit handler can read it
  const select = document.getElementById("rnd-select");
  const options = availableTechNodes(data);
  if (!options.length) {
    select.innerHTML = '<option value="">No available research nodes</option>';
    select.disabled = true;
  } else {
    select.disabled = false;
    select.innerHTML = options.map((node) => `<option value="${node.id}">${node.name}</option>`).join("");
  }

  // Render tech rows grouped by tier, then by status
  const tier1Ids = techTree.filter((n) => n.tier === 1).map((n) => n.id);
  const allTier1Done = tier1Ids.every((id) => done.has(id));

  const rows = techTree
    .map((node) => {
      const prereqLabel = node.prereqs.length ? node.prereqs.map((id) => techTree.find((it) => it.id === id)?.name || id).join(", ") : "None";
      const isDone = done.has(node.id);
      const isQueued = inQueue.has(node.id);
      const prereqsMet = node.prereqs.every((req) => done.has(req));
      const tierGated = node.tier >= 2 && !allTier1Done;
      const isLocked = !prereqsMet || tierGated;

      if (isDone) {
        return `<div class="rnd-row rnd-row--done">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(node.name)}</span>
            <span class="rnd-row__effect">${escapeHtml(node.effect)}</span>
          </div>
          <span class="rnd-row__badge rnd-row__badge--done">✓ COMPLETE</span>
        </div>`;
      }

      if (isQueued) {
        return `<div class="rnd-row rnd-row--queued">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(node.name)}</span>
            <span class="rnd-row__effect">${escapeHtml(node.effect)}</span>
            <span class="rnd-row__meta">${node.durationHours}h &middot; ${toCurrency(node.costCredits)}</span>
          </div>
          <span class="rnd-row__badge rnd-row__badge--queued">IN QUEUE</span>
        </div>`;
      }

      if (isLocked) {
        const lockReason = tierGated
          ? "Complete all Tier 1 research first"
          : `Requires: ${escapeHtml(prereqLabel)}`;
        return `<div class="rnd-row rnd-row--locked">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(node.name)} <span class="rnd-tier-badge">T${node.tier}</span></span>
            <span class="rnd-row__effect">${escapeHtml(node.effect)}</span>
            <span class="rnd-row__meta">${lockReason}</span>
          </div>
          <span class="rnd-row__badge rnd-row__badge--locked">LOCKED</span>
        </div>`;
      }

      // Available — show enqueue button
      return `<div class="rnd-row rnd-row--available">
        <div class="rnd-row__info">
          <span class="rnd-row__name">${escapeHtml(node.name)} <span class="rnd-tier-badge">T${node.tier}</span></span>
          <span class="rnd-row__effect">${escapeHtml(node.effect)}</span>
          <span class="rnd-row__meta">${node.durationHours}h &middot; ${toCurrency(node.costCredits)} &middot; Prereqs: ${escapeHtml(prereqLabel)}</span>
        </div>
        <button class="btn btn-accent rnd-enqueue-btn" type="button" data-tech-id="${node.id}">+ Enqueue</button>
      </div>`;
    })
    .join("");

  treeWrap.innerHTML = rows || '<p class="muted">No research nodes configured.</p>';

  // Event delegation — reassignment avoids listener stacking across re-renders
  treeWrap.onclick = (e) => {
    const btn = e.target.closest(".rnd-enqueue-btn");
    if (!btn) return;
    const techId = btn.getAttribute("data-tech-id");
    const rndSelect = document.getElementById("rnd-select");
    const rndForm = document.getElementById("rnd-form");
    if (!rndSelect || !rndForm || !techId) return;
    rndSelect.value = techId;
    rndForm.requestSubmit();
  };

  renderResearchSelectionDetails(data);
}

export function renderResearchSelectionDetails(data) {
  const select = document.getElementById("rnd-select");
  const details = document.getElementById("rnd-selected-details");
  if (!select || !details) {
    return;
  }

  const node = getTechNode(select.value);
  if (!node) {
    details.textContent = "No available research nodes meet current prerequisites.";
    return;
  }

  const prereqLabel = node.prereqs.length ? node.prereqs.map((id) => getTechNode(id)?.name || id).join(", ") : "None";
  details.textContent = `${node.name} costs ${toCurrency(node.costCredits)} credits, runs for ${node.durationHours}h, and requires: ${prereqLabel}.`;
}

export function queueProgress(item) {
  if (!item.startedAt) {
    return 0;
  }
  const elapsedHours = (Date.now() - item.startedAt) / (1000 * 60 * 60);
  return Math.max(0, Math.min(100, (elapsedHours / item.durationHours) * 100));
}

export function renderQueue(elId, queue, subtitle) {
  const el = document.getElementById(elId);
  if (!queue.length) {
    el.innerHTML = `<article class="queue-item"><p>No queued items yet.</p><p class="muted">${escapeHtml(subtitle)}</p></article>`;
    return;
  }

  if (elId === "rnd-queue") {
    el.innerHTML = rndQueueHtml(queue, subtitle);
    return;
  }

  el.innerHTML = queueItemsHtml(queue, subtitle, {
    progressOf: queueProgress,
    remainingLabel: (item) => {
      const remainingMs = Math.max(0, (item.startedAt + item.durationHours * 3_600_000) - Date.now());
      const rHrs = Math.floor(remainingMs / 3_600_000);
      const rMins = Math.floor((remainingMs % 3_600_000) / 60_000);
      return remainingMs > 0 ? `${rHrs}h ${rMins}m remaining` : "Completing...";
    },
    formatCredits: toCurrency
  });
}

// Corporate R&D researches one technology at a time (Bug #1258): an item behind another is "Queued, starts in ...".
// Scheduled on a copy, so a queue saved before the fix shows the order the server will run it in.
export function rndQueueHtml(queue, subtitle) {
  const now = Date.now();
  const scheduled = scheduleRndQueue(queue.map((item) => ({ ...item })), now);
  return queueItemsHtml(scheduled, subtitle, {
    progressOf: (item) => (rndItemStatus(item, now).state === "queued" ? 0 : queueProgress(item)),
    remainingLabel: (item) => {
      const status = rndItemStatus(item, now);
      if (status.state === "queued") return `Queued, starts in ${formatHoursMinutes(status.startsInMs)}`;
      return status.state === "running" ? `${formatHoursMinutes(status.remainingMs)} remaining` : "Completing...";
    },
    statusOf: (item) => (rndItemStatus(item, now).state === "queued" ? "Queued" : "In progress"),
    formatCredits: toCurrency
  });
}

/** Corporate R&D: the research picker and queueing a project. */
export function bindResearchForms() {
  const rndForm = document.getElementById("rnd-form");
  const rndStatus = document.getElementById("rnd-status");
  const rndSelect = document.getElementById("rnd-select");

  rndSelect?.addEventListener("change", () => renderResearchSelectionDetails(appState.data));

  rndForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const techId = rndSelect.value;
    if (!techId) {
      return;
    }

    const node = getTechNode(techId);
    if (!node) {
      return;
    }

    try {
      if (appState.accountId) {
        const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
        const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/queue-rnd`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ techId })
        });

        const account = await parseJsonResponse(response);
        appState.data = deepClone(account.state);
        appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
        updateAllViews();
        showActionReceipt(account, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
      } else {
        const credits = Number(appState.data.corp.finances.credits || 0);
        if (credits < node.costCredits) {
          throw new Error(
            `${node.name} requires ${toCurrency(node.costCredits)} credits. Current reserves are ${toCurrency(credits)} credits.`
          );
        }

        appState.data.corp.finances.credits -= node.costCredits;
        appState.data.queues.corporateRnD.push({
          id: `rnd-${Date.now()}`,
          techId: node.id,
          name: node.name,
          effect: node.effect,
          durationHours: node.durationHours,
          startedAt: nextRndStart(appState.data.queues.corporateRnD, Date.now()), // Bug #1258
          costCredits: node.costCredits
        });
        updateAllViews();
      }

      if (rndStatus) {
        rndStatus.textContent = `${node.name} entered the queue. ${toCurrency(node.costCredits)} credits committed.`;
      }
      pushFeedback(
        `${node.name} added to the corporate R&D queue. Funding locked: ${toCurrency(node.costCredits)} credits.`,
        "success"
      );
      flashButtonSuccess(rndForm.querySelector(".btn-accent"));
      rndForm.reset();
      renderResearchSelectionDetails(appState.data);
    } catch (error) {
      if (rndStatus) {
        rndStatus.textContent = `R&D queue action failed: ${error.message}`;
      }
      pushFeedback(`R&D queue request rejected. ${error.message}`, "error");
    }
  });
}
