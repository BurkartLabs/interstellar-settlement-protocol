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
