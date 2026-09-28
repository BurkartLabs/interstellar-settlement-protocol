// The Chat tab (called Comms until AB#2490): chat channels and the log.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { socket } from "../apiClient.js";
import { chatScrollTop } from "../chatScroll.js";
import { formatTime } from "../helpers.js";
import { chatLineHtml } from "../html.js";
import { appState } from "../state.js";

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
  const messages = data?.chatLog?.[channel] || [];
  const chatLog = document.getElementById("chat-log");

  if (!chatLog) {
    return;
  }

  // Bug #1135: measure before the redraw, so a player at the newest line stays there and one reading history does not
  // lose their place; a channel switch or their own line goes to the newest.
  const before = { scrollHeight: chatLog.scrollHeight, scrollTop: chatLog.scrollTop, clientHeight: chatLog.clientHeight };
  const channelChanged = chatLog.dataset.channel !== channel;
  chatLog.dataset.channel = channel;

  chatLog.innerHTML = messages
    .slice(-120)
    .map((msg) => chatLineHtml(msg, formatTime))
    .join("");

  chatLog.scrollTop = chatScrollTop({ before, afterScrollHeight: chatLog.scrollHeight, channelChanged, ownLine: appState.chatOwnLinePending });
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
