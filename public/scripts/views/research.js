// The Corporate R&D tab: the tech tree, the research picker and the queues.
// AB#739 (ISP-53): everything here moved from app.js unchanged. ISP-79 (AB#768): drawn from the design system.

import { showActionReceipt } from "./receiptModal.js"; // AB#744
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { deepClone, toCurrency } from "../helpers.js";
import { escapeHtml, queueItemsHtml, researchNodeHtml } from "../html.js";
import { formatHoursMinutes, nextRndStart, rndItemStatus, rndQueueRoom, scheduleRndQueue } from "../rndQueue.js";
import { appState, techTree } from "../state.js";
import { flashButtonSuccess, pushFeedback, setTab, updateAllViews } from "./shared.js";
import { bindResearchLinks } from "../researchLinks.js"; // AB#885
import { insightRemaining, researchRemaining, totalText } from "../researchTotals.js"; // AB#2475
import { isInsightProgramLive } from "../ceoEffects.js";
import { renderPrereqGraph } from "./prereqGraph.js"; // AB#2477

export function getTechNode(techId) {
  return techTree.find((item) => item.id === techId) || null;
}

/**
 * Why a node cannot be queued yet, in the words its card shows, or null when it can: the server's own order of
 * refusals (server/routes/research.js, queue-rnd), prerequisites, then corporation level, then Tier 1. Bug AB#2338:
 * the level was not checked here, so a card below its level offered Enqueue and the server refused the click.
 */
export function researchLockReason(node, { done, corpLevel, tree = techTree }) {
  // AB#861: what a planned node unlocks is not built yet; the server refuses it (server/routes/research.js)
  if (node.status === "planned") return PLANNED_RESEARCH;
  if (!node.prereqs.every((req) => done.has(req))) {
    return `Requires: ${node.prereqs.map((id) => tree.find((it) => it.id === id)?.name || id).join(", ")}`;
  }
  const level = Number(node.requiresCorpLevel) || 0;
  const current = Number(corpLevel) || 0;
  if (level && current < level) return `Requires Corporation Level ${level} (you are level ${current})`;
  if (node.tier >= 2 && !tree.filter((n) => n.tier === 1).every((n) => done.has(n.id))) return "Complete all Tier 1 research first";
  return null;
}

export const PLANNED_RESEARCH = "No effect yet: planned for a later version.";

export function availableTechNodes(data) {
  const done = new Set(data.corp.unlockedTech || []);
  const inQueue = new Set((data.queues.corporateRnD || []).map((item) => item.techId).filter(Boolean));
  return techTree.filter((node) => !done.has(node.id) && !inQueue.has(node.id) && !researchLockReason(node, { done, corpLevel: data.corp.level }));
}

export function renderTechTree(data) {
  const treeWrap = document.getElementById("rnd-tech-tree");
  const done = new Set(data.corp.unlockedTech || []);
  const inQueue = new Set((data.queues.corporateRnD || []).map((item) => item.techId).filter(Boolean));
  // AB#2476: the one in progress and one behind it. Full, every card says when a place opens, as the server refuses.
  const now = Date.now();
  const room = rndQueueRoom(data.queues.corporateRnD, now);
  const fullReason = room.ok ? "" : `Queue full: a place opens in ${formatHoursMinutes(room.freesAt - now)}, when ${room.finishing.name || "the research ahead"} finishes`;

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
  const graph = []; // AB#2477: each node's state, for the prerequisite tree
  const rows = techTree
    .map((node) => {
      graph.push(techGraphNode(node, { done, inQueue, corpLevel: data.corp.level }));
      const prereqLabel = node.prereqs.length ? node.prereqs.map((id) => techTree.find((it) => it.id === id)?.name || id).join(", ") : "None";
      const cost = `${node.durationHours}h · ${toCurrency(node.costCredits)}`;
      const card = { id: node.id, name: node.name, tier: node.tier, effect: node.effect };

      if (done.has(node.id)) return researchNodeHtml({ ...card, state: "done" });
      if (inQueue.has(node.id)) return researchNodeHtml({ ...card, state: "queued", meta: [cost] });
      const lock = researchLockReason(node, { done, corpLevel: data.corp.level });
      if (lock === PLANNED_RESEARCH) return researchNodeHtml({ ...card, state: "planned", meta: [cost, lock] });
      if (lock) return researchNodeHtml({ ...card, state: "locked", meta: [lock] });
      return researchNodeHtml({
        ...card,
        state: "available",
        meta: fullReason ? [cost, `Prereqs: ${prereqLabel}`, fullReason] : [cost, `Prereqs: ${prereqLabel}`],
        action: `<button class="ui-button ui-button--secondary research__enqueue" type="button" data-tech-id="${escapeHtml(node.id)}"${fullReason ? " disabled" : ""}>Enqueue</button>`
      });
    })
    .join("");

  treeWrap.innerHTML = rows || '<div class="ui-state"><p class="ui-state__title">No research nodes configured.</p></div>';

  // Event delegation — reassignment avoids listener stacking across re-renders
  treeWrap.onclick = (e) => {
    const btn = e.target.closest(".research__enqueue");
    if (!btn) return;
    const techId = btn.getAttribute("data-tech-id");
    const rndSelect = document.getElementById("rnd-select");
    const rndForm = document.getElementById("rnd-form");
    if (!rndSelect || !rndForm || !techId) return;
    rndSelect.value = techId;
    rndForm.requestSubmit();
  };

  renderResearchSelectionDetails(data);
  renderPrereqGraph(document.getElementById("rnd-prereq-graph"), { key: "rnd", nodes: graph, empty: "No research nodes configured." });
}

/** AB#2477: a research node as the prerequisite tree draws it, in the same states its card shows. */
export function techGraphNode(node, { done, inQueue, corpLevel }) {
  const base = { id: node.id, name: node.name, prereqs: node.prereqs || [], met: done.has(node.id) };
  if (done.has(node.id)) return { ...base, state: "done" };
  if (inQueue.has(node.id)) return { ...base, state: "queued" };
  const lock = researchLockReason(node, { done, corpLevel });
  if (lock === PLANNED_RESEARCH) return { ...base, state: "planned" };
  if (lock) return { ...base, state: "locked", lock: lock.startsWith("Requires: ") ? undefined : lock };
  return { ...base, state: "available" };
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
  details.textContent = `${node.name} costs ${toCurrency(node.costCredits)}, runs for ${node.durationHours}h, and requires: ${prereqLabel}.`;
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
    el.innerHTML = `<div class="ui-state"><p class="ui-state__title">No queued items yet.</p><p class="ui-state__why">${escapeHtml(subtitle)}</p></div>`;
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
  bindResearchLinks(setTab); // AB#885: a research link on any screen opens its card here

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
            `${node.name} requires ${toCurrency(node.costCredits)}. Current reserves are ${toCurrency(credits)}.`
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
        rndStatus.textContent = `${node.name} entered the queue. ${toCurrency(node.costCredits)} committed.`;
      }
      pushFeedback(
        `${node.name} added to the corporate R&D queue. Funding locked: ${toCurrency(node.costCredits)}.`,
        "success"
      );
      flashButtonSuccess(rndForm.querySelector('button[type="submit"]'));
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

/**
 * AB#2475 (Board review item 22): the time to finish every research item still outstanding, on Corporate R&D and CEO
 * Insight (researchTotals.js: each track runs one item at a time, so it is the sum of what is left). Drawn with the
 * page and each second by the ticker, so it counts down and drops as items complete.
 */
export function renderResearchTotals(data, now = Date.now()) {
  if (!data?.corp) return;
  const rnd = document.getElementById("rnd-total");
  if (rnd) rnd.textContent = `Total time to complete all remaining research: ${totalText(researchRemaining({ nodes: techTree, done: data.corp.unlockedTech || [], queue: data.queues?.corporateRnD || [] }, now), "technology", "technologies")}`;
  const ceo = document.getElementById("ceo-total");
  if (ceo) ceo.textContent = `Total time to complete all remaining programs: ${totalText(insightRemaining({ programs: appState.insightPrograms || [], completed: data.corp.completedInsights || [], queue: data.queues?.ceoInsight || [], isLive: isInsightProgramLive }, now), "program level", "program levels")}`;
}
