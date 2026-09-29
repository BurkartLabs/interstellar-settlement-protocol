// The Chat tab (called Comms until AB#2490): chat channels and the log.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { apiFetch, parseJsonResponse, socket } from "../apiClient.js";
import { chatScrollTop } from "../chatScroll.js";
import { formatTime } from "../helpers.js";
import { chatLineHtml } from "../html.js";
import { appState } from "../state.js";
import { escapeHtml } from "../html.js";

// AB#995 (ISP-288): state:init sends each channel's last 50 lines (the server's window); older lines are read from its
// history a page at a time (GET /api/chat/:channel/history) and kept here, before the live ones.
const WINDOW = 50;
const older = new Map(); // channel -> { lines: [], nextCursor: undefined | string | null, loading, error }
const olderOf = (channel) => {
  if (!older.has(channel)) older.set(channel, { lines: [], nextCursor: undefined, loading: false, error: null });
  return older.get(channel);
};
let anchorOlder = false; // the next render keeps the reader's place after older lines were put above it

/** The lines to show: the pages read back, then the live window, each line once. */
function chatLines(channel, data) {
  const live = data?.chatLog?.[channel] || [];
  const seen = new Set(live.map((m) => m.id));
  return [...olderOf(channel).lines.filter((m) => !seen.has(m.id)), ...live];
}

/** The page before the oldest line shown, for the open channel. */
async function loadOlderChat() {
  const tab = appState.chatChannel || "global";
  const channel = resolveChatChannel(tab);
  const state = olderOf(channel);
  if (state.loading || state.nextCursor === null) return;
  const oldest = chatLines(channel, appState.data)[0];
  if (!oldest) return;
  state.loading = true;
  state.error = null;
  renderChatLog(appState.data);
  try {
    const page = await parseJsonResponse(await apiFetch(`/api/chat/${encodeURIComponent(tab)}/history?cursor=${encodeURIComponent(oldest.id)}`));
    state.lines = [...(page.messages || []), ...state.lines];
    state.nextCursor = page.nextCursor || null;
    anchorOlder = true;
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    renderChatLog(appState.data);
  }
}

// The "local" comms tab is scoped to the player's current solar system, so
// every system has its own isolated chat history. The UI tab name stays
// "local", but it resolves to a per-system channel key like "local:sol".
export function resolveChatChannel(tab, data = appState.data) {
  if (tab === "local") {
    const sys = data?.corp?.currentSystemId || "sol";
    return `local:${sys}`;
  }
  return tab || "global";
}

export function renderChatLog(data) {
  const channel = resolveChatChannel(appState.chatChannel, data);
  const messages = chatLines(channel, data);
  const chatLog = document.getElementById("chat-log");

  if (!chatLog) {
    return;
  }

  // Bug #1135: measure before the redraw, so a player at the newest line stays there and one reading history does not
  // lose their place; a channel switch or their own line goes to the newest.
  const before = { scrollHeight: chatLog.scrollHeight, scrollTop: chatLog.scrollTop, clientHeight: chatLog.clientHeight };
  const channelChanged = chatLog.dataset.channel !== channel;
  chatLog.dataset.channel = channel;

  // AB#995: older history above the lines, while the channel may hold more than the window
  const state = olderOf(channel);
  const mayHaveMore = state.nextCursor === undefined ? (data?.chatLog?.[channel] || []).length >= WINDOW : Boolean(state.nextCursor);
  const olderHtml = mayHaveMore
    ? `<li class="chat__older"><button class="ui-button ui-button--ghost" type="button" data-action="older-chat"${state.loading ? " disabled" : ""}>${state.loading ? "Loading…" : "Load older messages"}</button>${state.error ? ` <span class="ui-screen__meta">${escapeHtml(state.error)}</span>` : ""}</li>`
    : state.nextCursor === null ? `<li class="chat__older"><span class="ui-screen__meta">Start of the channel</span></li>` : "";
  chatLog.innerHTML = olderHtml + messages
    .map((msg) => chatLineHtml(msg, formatTime))
    .join("");

  if (anchorOlder && !channelChanged) {
    // the lines just read back went above the reader, who stays at the line they were looking at
    chatLog.scrollTop = before.scrollTop + (chatLog.scrollHeight - before.scrollHeight);
    anchorOlder = false;
  } else {
    chatLog.scrollTop = chatScrollTop({ before, afterScrollHeight: chatLog.scrollHeight, channelChanged, ownLine: appState.chatOwnLinePending });
  }
  appState.chatOwnLinePending = false;
}

export function renderChatChannelTabs() {
  const tabs = Array.from(document.querySelectorAll("[data-chat-channel-tab]"));
  tabs.forEach((tab) => {
    const tabKey = tab.getAttribute("data-chat-channel-tab");
    const selected = tabKey === appState.chatChannel;
    tab.setAttribute("aria-selected", String(selected));
    // Decorate the Local tab with the player's current system name so it
    // is obvious that comms only reach corporations in that system.
    if (tabKey === "local") {
      const sysId = appState.data?.corp?.currentSystemId || "sol";
      const sysName = (appState.data?.world?.systems || []).find((s) => s.id === sysId)?.name
        || sysId.replace(/\b\w/g, (c) => c.toUpperCase());
      tab.textContent = `Local — ${sysName}`;
    }
  });
}

/** Chat: channel tabs and sending a message. */
export function bindCommsForms() {
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const chatTabs = document.getElementById("chat-channel-tabs");

  chatTabs?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-chat-channel-tab]");
    if (!tab) {
      return;
    }
    const nextChannel = String(tab.getAttribute("data-chat-channel-tab") || "global");
    appState.chatChannel = nextChannel;
    renderChatChannelTabs();
    renderChatLog(appState.data);
  });

  // AB#995: the page of history before the oldest line shown
  document.getElementById("chat-log")?.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="older-chat"]')) loadOlderChat();
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const content = chatInput.value.trim();
    if (!content) {
      return;
    }

    // Bug #1135: show the player their own line when it comes back, wherever they had scrolled to.
    appState.chatOwnLinePending = true;

    // The server names the author from the logged-in account (Bug #710); the client no longer sends one.
    socket?.emit("chat:send", {
      channel: resolveChatChannel(appState.chatChannel),
      content
    });

    chatInput.value = "";
  });
}
