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
 * The trade confirmation modal's rows. Label and value are text, escaped here, so callers pass raw strings
 * (Bug #1002: they went into innerHTML raw, and callers escaped some values themselves and not others).
 */
export function tradeConfirmRowsHtml(rows) {
  return rows
    .map((r) => {
      const cls = r.highlight ? ` class="trade-confirm-highlight"` : r.muted ? ` class="trade-confirm-muted"` : "";
      return `<tr${cls}><td>${escapeHtml(r.label)}</td><td class="trade-confirm-value">${escapeHtml(r.value)}</td></tr>`;
    })
    .join("");
}

/**
 * A research queue's items (Corporate R&D, CEO Insight). Every string is escaped (Bug #1002): names and effects come
 * from the catalog today, and a player-named item would otherwise become stored XSS. `progressOf(item)` is 0 to 100,
 * `remainingLabel(item)` the time left, `formatCredits(n)` the funding figure.
 */
export function queueItemsHtml(queue, subtitle, { progressOf, remainingLabel, formatCredits }) {
  return queue
    .map((item) => {
      const progress = Number(progressOf(item)) || 0;
      const progressMeta = item.startedAt
        ? `<div class="queue-progress-meta"><span>${progress.toFixed(1)}%</span><span>${escapeHtml(remainingLabel(item))}</span></div>`
        : "";
      return `
      <article class="queue-item">
        <h3>${escapeHtml(item.name)}</h3>
        <p class="muted">${escapeHtml(subtitle)}</p>
        <p>${escapeHtml(item.effect)}</p>
        <p class="muted">Duration: ${escapeHtml(item.durationHours)}h | ${item.startedAt ? "In progress" : "Queued"}</p>
        ${item.costCredits ? `<p class="muted">Committed funding: ${escapeHtml(formatCredits(item.costCredits))} credits</p>` : ""}
        ${progressMeta}
        <div class="progress-wrap"><div class="progress-bar" style="width:${progress.toFixed(1)}%"></div></div>
      </article>
      `;
    })
    .join("");
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
