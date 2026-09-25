// The Inbox tab: mail folders, reading, composing, and choosing between corporations that share a name.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { apiFetch } from "../apiClient.js";
import { inboxEmptyText } from "../emptyStates.js";
import { formatInboxDate } from "../helpers.js";
import { escapeHtml, messageListItemsHtml } from "../html.js";
import { appState } from "../state.js";
import { pushFeedback } from "./shared.js";

// ─── Inbox ────────────────────────────────────────────────────────────────────

export async function loadMessages() {
  if (!appState.accountId) return;
  try {
    const res = await apiFetch(`/api/accounts/${appState.accountId}/messages`);
    const data = await res.json();
    if (data.messages) {
      appState.inbox.messages = data.messages;
      appState.inbox.loaded = true;
      // First load: if the user has unread player messages but no unread
      // official messages, default the inbox subtab to "players" so
      // self-sent and incoming player mail isn't hidden behind the default
      // official subtab.
      if (!appState.inbox.subtypeChosenByUser && appState.inbox.folder === "inbox") {
        const inboxMsgs = data.messages.filter((m) => m.folder === "inbox");
        const unreadPlayer = inboxMsgs.some((m) => m.fromType === "player" && !m.readAt);
        const unreadOfficial = inboxMsgs.some((m) => (m.fromType === "system" || m.fromType === "npc") && !m.readAt);
        if (unreadPlayer && !unreadOfficial) {
          appState.inbox.subtype = "players";
          document.querySelectorAll(".inbox-subtab-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.subtype === "players");
          });
        }
      }
      updateInboxSubtabBadges();
      renderInboxMessageList();
    }
  } catch (_) { /* silently ignore */ }
}

// Counts unread inbox messages per subtype and renders a small "(n)" badge in
// each subtab button so the user can see at a glance which tab has new mail.
export function updateInboxSubtabBadges() {
  const msgs = (appState.inbox.messages || []).filter((m) => m.folder === "inbox");
  const counts = {
    official: msgs.filter((m) => (m.fromType === "system" || m.fromType === "npc") && !m.readAt).length,
    players: msgs.filter((m) => m.fromType === "player" && !m.readAt).length
  };
  document.querySelectorAll(".inbox-subtab-btn").forEach((btn) => {
    const subtype = btn.dataset.subtype;
    const baseLabel = btn.dataset.baseLabel || (() => {
      // Cache the original label text once so re-renders don't accumulate
      // badge counts in the button text.
      const stripped = btn.textContent.replace(/\s*\(\d+\)\s*$/, "").trim();
      btn.dataset.baseLabel = stripped;
      return stripped;
    })();
    const n = counts[subtype] || 0;
    btn.textContent = n > 0 ? `${baseLabel} (${n})` : baseLabel;
  });
  // Bug #1130: the Inbox tab carries the unread count too, so a player on any other tab is told that mail has arrived.
  const inboxTab = document.querySelector('.tab-btn[data-tab="inbox"]');
  if (inboxTab) {
    const unread = counts.official + counts.players;
    inboxTab.textContent = unread > 0 ? `Inbox (${unread})` : "Inbox";
  }
}

export function inboxMsgsForView() {
  const { folder, subtype, messages } = appState.inbox;
  let filtered = messages.filter((m) => m.folder === folder);
  if (folder === "inbox") {
    if (subtype === "official") {
      filtered = filtered.filter((m) => m.fromType === "system" || m.fromType === "npc");
    } else {
      filtered = filtered.filter((m) => m.fromType === "player");
    }
  }
  return filtered.slice().sort((a, b) => b.sentAt - a.sentAt);
}

export function renderInboxMessageList() {
  const panel = document.getElementById("inbox");
  if (!panel || !panel.classList.contains("active")) return;

  // Keep subtab badge counts in sync with the latest message state.
  updateInboxSubtabBadges();

  const list = document.getElementById("inbox-message-list");
  const emptyNotice = document.getElementById("inbox-empty-notice");
  if (!list || !emptyNotice) return;

  const msgs = inboxMsgsForView();
  if (!msgs.length) {
    list.innerHTML = "";
    emptyNotice.textContent = inboxEmptyText(appState.inbox.folder, appState.inbox.subtype); // Bug #1060
    emptyNotice.style.display = "";
    return;
  }
  emptyNotice.style.display = "none";

  // Bug #754: every field escaped (public/scripts/html.js, tested in tests/unit/inboxList.test.js).
  list.innerHTML = messageListItemsHtml(msgs, formatInboxDate);

  list.querySelectorAll(".inbox-msg-item").forEach((el) => {
    el.addEventListener("click", () => openMessage(el.dataset.msgId));
  });
}

export function openMessage(messageId) {
  const msg = appState.inbox.messages.find((m) => m.id === messageId);
  if (!msg) return;

  appState.inbox.openMessageId = messageId;

  // If it's a draft, open the compose view pre-filled
  if (msg.folder === "draft") {
    showInboxView("compose");
    document.getElementById("compose-draft-id").value = msg.id;
    document.getElementById("compose-to").value = msg.toCorpName || "";
    document.getElementById("compose-to-id").value = msg.toCorpId || ""; // Bug #711: the corporation it was written for
    clearComposeCandidates();
    document.getElementById("compose-subject").value = msg.subject || "";
    document.getElementById("compose-body").value = msg.body || "";
    document.getElementById("compose-status").textContent = "";
    appState.inbox.composeDraftId = msg.id;
    syncComposeDraftControls();
    return;
  }

  showInboxView("detail");

  document.getElementById("inbox-detail-from").textContent =
    msg.fromType === "player" ? `From: ${msg.fromName}` : `From: ${msg.fromName}`;
  document.getElementById("inbox-detail-date").textContent = formatInboxDate(msg.sentAt);
  document.getElementById("inbox-detail-subject").textContent = msg.subject || "(no subject)";
  document.getElementById("inbox-detail-body").textContent = msg.body || "";

  const archiveBtn = document.getElementById("inbox-action-archive");
  const restoreBtn = document.getElementById("inbox-action-restore");
  const trashBtn = document.getElementById("inbox-action-trash");
  archiveBtn.style.display = "none";
  restoreBtn.style.display = "none";
  trashBtn.style.display = "none";

  if (msg.folder === "inbox") {
    archiveBtn.style.display = "";
    trashBtn.style.display = "";
  } else if (msg.folder === "archive") {
    restoreBtn.style.display = "";
    trashBtn.style.display = "";
  } else if (msg.folder === "trash") {
    restoreBtn.style.display = "";
  }

  // Mark read. Bug #1136: here and now, so the counts and the list are right the moment the player goes Back (it used
  // to wait for the request, and nothing redrew the list after it); put back if the server does not record it.
  if (!msg.readAt && msg.folder !== "sent" && msg.folder !== "draft") {
    msg.readAt = Date.now();
    updateInboxSubtabBadges(); // Bug #1130: the Inbox tab's count is on screen while the message is open
    const unmark = () => {
      const m = appState.inbox.messages.find((x) => x.id === messageId);
      if (m) m.readAt = null;
      renderInboxMessageList();
    };
    apiFetch(`/api/accounts/${appState.accountId}/messages/${messageId}/read`, { method: "POST" })
      .then((res) => { if (!res.ok) unmark(); })
      .catch(unmark);
  }
}

/** Bug #1137: Delete Draft shows in the compose view whenever a saved draft is open there (opened, or just saved). */
export function syncComposeDraftControls() {
  const btn = document.getElementById("compose-delete-draft-btn");
  if (btn) btn.hidden = !appState.inbox.composeDraftId;
}

export function showInboxView(view) {
  // view: "list" | "detail" | "compose"
  document.getElementById("inbox-list-view").style.display = view === "list" ? "" : "none";
  document.getElementById("inbox-detail-view").style.display = view === "detail" ? "" : "none";
  document.getElementById("inbox-compose-view").style.display = view === "compose" ? "" : "none";
  const subtabNav = document.getElementById("inbox-subtab-nav");
  // Subtabs (System & NPC / Players) only make sense on the inbox-folder list view.
  if (subtabNav) {
    subtabNav.style.display = (view === "list" && appState.inbox.folder === "inbox") ? "" : "none";
  }
}

export function bindInboxControls() {
  // Folder tabs
  document.querySelectorAll(".inbox-folder-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".inbox-folder-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      appState.inbox.folder = btn.dataset.folder;
      appState.inbox.openMessageId = null;
      showInboxView("list");
      const subtabNav = document.getElementById("inbox-subtab-nav");
      if (subtabNav) subtabNav.style.display = appState.inbox.folder === "inbox" ? "" : "none";
      renderInboxMessageList();
    });
  });

  // Sub-tabs
  document.querySelectorAll(".inbox-subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".inbox-subtab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      appState.inbox.subtype = btn.dataset.subtype;
      // Once the user picks a subtab, stop auto-switching it on reload.
      appState.inbox.subtypeChosenByUser = true;
      renderInboxMessageList();
    });
  });

  // Back buttons
  document.getElementById("inbox-back-btn")?.addEventListener("click", () => {
    showInboxView("list");
    appState.inbox.openMessageId = null;
    renderInboxMessageList(); // Bug #1136: the message just read is no longer marked unread
  });
  document.getElementById("inbox-compose-back-btn")?.addEventListener("click", () => {
    appState.inbox.composeDraftId = null;
    syncComposeDraftControls();
    showInboxView("list");
    renderInboxMessageList();
  });

  // Compose trigger
  document.getElementById("inbox-compose-trigger")?.addEventListener("click", () => {
    appState.inbox.composeDraftId = null;
    document.getElementById("compose-draft-id").value = "";
    document.getElementById("compose-to").value = "";
    document.getElementById("compose-to-id").value = "";
    clearComposeCandidates();
    document.getElementById("compose-subject").value = "";
    document.getElementById("compose-body").value = "";
    document.getElementById("compose-status").textContent = "";
    syncComposeDraftControls();
    showInboxView("compose");
  });

  // Bug #711: typing a different name means the chosen corporation no longer applies.
  document.getElementById("compose-to")?.addEventListener("input", () => {
    document.getElementById("compose-to-id").value = "";
    clearComposeCandidates();
  });

  // Detail action buttons
  document.getElementById("inbox-action-archive")?.addEventListener("click", () => moveCurrentMessage("archive"));
  document.getElementById("inbox-action-restore")?.addEventListener("click", () => moveCurrentMessage("inbox"));
  document.getElementById("inbox-action-trash")?.addEventListener("click", () => moveCurrentMessage("trash"));
  // Bug #1137: delete the draft open in the compose view, then show Drafts without it.
  document.getElementById("compose-delete-draft-btn")?.addEventListener("click", async () => {
    const id = appState.inbox.composeDraftId;
    if (!id) return;
    const status = document.getElementById("compose-status");
    status.textContent = "Deleting…";
    try {
      const res = await apiFetch(`/api/accounts/${appState.accountId}/messages/draft/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "the server refused");
    } catch (err) {
      status.textContent = `The draft was not deleted: ${err.message}.`;
      return;
    }
    appState.inbox.messages = appState.inbox.messages.filter((m) => m.id !== id);
    appState.inbox.composeDraftId = null;
    appState.inbox.openMessageId = null;
    document.getElementById("compose-draft-id").value = "";
    status.textContent = "";
    syncComposeDraftControls();
    appState.inbox.folder = "draft";
    document.querySelectorAll(".inbox-folder-btn").forEach((b) => b.classList.toggle("active", b.dataset.folder === "draft"));
    showInboxView("list");
    renderInboxMessageList();
    pushFeedback("Draft deleted.", "success");
  });

  // Compose form
  const composeForm = document.getElementById("inbox-compose-form");
  composeForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("compose-status");
    status.textContent = "Sending…";
    const body = {
      toCorpId: document.getElementById("compose-to-id").value.trim() || undefined,
      toCorpName: document.getElementById("compose-to").value.trim(),
      subject: document.getElementById("compose-subject").value.trim(),
      body: document.getElementById("compose-body").value.trim()
    };
    const draftId = document.getElementById("compose-draft-id").value.trim();
    if (draftId) body.draftId = draftId;
    try {
      const res = await apiFetch(`/api/accounts/${appState.accountId}/messages/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.error) {
        status.textContent = data.error;
        // Bug #711: several corporations share the name. Nothing was sent; the player picks which one they mean.
        if (Array.isArray(data.candidates)) showComposeCandidates(data.candidates);
        return;
      }
      appState.inbox.messages = data.messages;
      appState.inbox.folder = "sent";
      appState.inbox.composeDraftId = null;
      syncComposeDraftControls();
      document.querySelectorAll(".inbox-folder-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.folder === "sent");
      });
      status.textContent = `Sent to ${data.toName}.`;
      showInboxView("list");
      renderInboxMessageList();
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  });

  // Save draft button
  document.getElementById("compose-save-draft-btn")?.addEventListener("click", async () => {
    const status = document.getElementById("compose-status");
    status.textContent = "Saving…";
    const body = {
      toCorpId: document.getElementById("compose-to-id").value.trim() || undefined,
      toCorpName: document.getElementById("compose-to").value.trim(),
      subject: document.getElementById("compose-subject").value.trim(),
      body: document.getElementById("compose-body").value.trim()
    };
    const existingDraftId = document.getElementById("compose-draft-id").value.trim();
    if (existingDraftId) body.draftId = existingDraftId;
    try {
      const res = await apiFetch(`/api/accounts/${appState.accountId}/messages/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.draft) {
        document.getElementById("compose-draft-id").value = data.draft.id;
        appState.inbox.composeDraftId = data.draft.id;
        syncComposeDraftControls();
        // Upsert in local list
        const idx = appState.inbox.messages.findIndex((m) => m.id === data.draft.id);
        if (idx >= 0) appState.inbox.messages[idx] = data.draft;
        else appState.inbox.messages.unshift(data.draft);
        status.textContent = "Draft saved.";
      } else {
        status.textContent = data.error || "Failed to save draft.";
      }
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  });
}

export async function moveCurrentMessage(folder) {
  const id = appState.inbox.openMessageId;
  if (!id) return;
  try {
    const res = await apiFetch(`/api/accounts/${appState.accountId}/messages/${id}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder })
    });
    const data = await res.json();
    if (data.message) {
      const idx = appState.inbox.messages.findIndex((m) => m.id === id);
      if (idx >= 0) appState.inbox.messages[idx] = data.message;
    }
    appState.inbox.openMessageId = null;
    showInboxView("list");
    renderInboxMessageList();
  } catch (_) { /* ignore */ }
}

// Called when the Inbox tab becomes active (via tab switching logic)
export function onInboxTabActivated() {
  // Bug #1130: fetch every time the Inbox opens, not once per page load; show what is already held meanwhile.
  if (appState.inbox.loaded) renderInboxMessageList();
  loadMessages();
  const subtabNav = document.getElementById("inbox-subtab-nav");
  if (subtabNav) subtabNav.style.display = appState.inbox.folder === "inbox" ? "" : "none";
}

// ─── Mail recipients (Bug #711) ──────────────────────────────────────────────
// When several corporations share the name typed into To, the server sends nothing and returns them as candidates.
// The player picks one (told apart by CEO and location); the message is then addressed by that corporation's publicId.
export function clearComposeCandidates() {
  const box = document.getElementById("compose-candidates");
  if (!box) return;
  box.hidden = true;
  box.innerHTML = "";
}

export function showComposeCandidates(candidates) {
  const box = document.getElementById("compose-candidates");
  if (!box) return;
  box.innerHTML = `<p class="muted">Choose which corporation you mean, then press Send:</p>` + candidates
    .map((c) => `<button type="button" class="btn btn-outline compose-candidate" data-corp-id="${escapeHtml(c.publicId)}" data-corp-name="${escapeHtml(c.corporationName)}">`
      + `${escapeHtml(c.corporationName)} · CEO ${escapeHtml(c.ceo || "unknown")} · ${escapeHtml(c.location || "unknown")}</button>`)
    .join("");
  box.hidden = false;
  box.querySelectorAll(".compose-candidate").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("compose-to-id").value = btn.dataset.corpId;
      box.querySelectorAll(".compose-candidate").forEach((b) => b.classList.toggle("is-selected", b === btn));
      document.getElementById("compose-status").textContent = `Addressed to ${btn.textContent}. Press Send.`;
    });
  });
}
