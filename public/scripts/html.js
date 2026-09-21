// Small pure helpers for building HTML strings, kept out of app.js so they can be tested without a browser.

/** Escape a value for use in HTML text or a quoted attribute. */
export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The notification list's items. Every field is escaped: a notification's text can carry player-supplied strings
 * (Bug #691: a mining lease named "<img onerror=...>" ran script in the browser of anyone who opened the list).
 */
export function notificationItemsHtml(items, formatTime) {
  return items
    .map((item) => {
      const unreadClass = item.readAt ? "" : " unread";
      return `
        <li class="notification-item${unreadClass}" data-notification-id="${escapeHtml(item.id)}">
          <p><strong>${escapeHtml(item.title)}</strong></p>
          <p class="muted">${escapeHtml(item.body)}</p>
          <p class="notification-meta">${escapeHtml(formatTime(item.createdAt))} | ${escapeHtml(item.type)}</p>
        </li>
      `;
    })
    .join("");
}

/**
 * The inbox message list's rows. Every field is escaped (Bug #754: a draft's recipient name went into innerHTML raw,
 * and on the shared dummy account a draft addressed to "<img onerror=...>" ran script for every later visitor).
 */
export function messageListItemsHtml(msgs, formatDate) {
  return msgs
    .map((m) => {
      const unread = !m.readAt && m.folder !== "sent" && m.folder !== "draft";
      const toLine = m.folder === "draft"
        ? `<span class="inbox-msg-to">To: ${escapeHtml(m.toCorpName || "(no recipient)")}</span>`
        : `<span class="inbox-msg-from">${escapeHtml(m.fromName || "Unknown")}</span>`;
      return `<li class="inbox-msg-item${unread ? " unread" : ""}" data-msg-id="${escapeHtml(m.id)}">
      <div class="inbox-msg-top">
        ${toLine}
        <span class="inbox-msg-date">${escapeHtml(formatDate(m.sentAt))}</span>
      </div>
      <div class="inbox-msg-subject">${escapeHtml(m.subject || "(no subject)")}${unread ? ' <span class="inbox-unread-dot"></span>' : ""}</div>
    </li>`;
    })
    .join("");
}

/**
 * The Station tab's institutional office cards: the NPC buildings of the station the corporation is docked at, each
 * with its Enter button. `stationBuildings` is the station's buildingIds resolved against data/buildings.json.
 * The walkthrough highlights these buttons by their data-building-action (AB#404), so its test renders this.
 */
export function stationBuildingCardsHtml(stationBuildings) {
  return stationBuildings
    .filter((b) => b.owner === "npc" && b.available)
    .map((b) => {
      const actionBtn = b.available
        ? `<button class="btn btn-outline" data-building-action="${escapeHtml(b.action)}">Enter</button>`
        : `<span class="building-status-badge">Coming Soon</span>`;
      return `
        <article class="building-card data-card">
          <header class="building-card-header">
            <span class="faction-code-badge">${escapeHtml(b.factionCode)}</span>
            <h3>${escapeHtml(b.name)}</h3>
          </header>
          <p class="muted building-description">${escapeHtml(b.description)}</p>
          <p class="building-flavor">${escapeHtml(b.flavor)}</p>
          <footer class="building-card-footer">${actionBtn}</footer>
        </article>
      `;
    })
    .join("");
}
