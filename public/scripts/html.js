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
 * One attribute, quoted and escaped here, with its leading space: htmlAttr("data-x", v) is ` data-x="..."`, and ""
 * when the value is null, undefined or false, so an optional attribute is one call. Bug #1254: a hand-written
 * data-disabled-reason attribute lost its closing quote and swallowed the Build Refinery button's label.
 */
export function htmlAttr(name, value) {
  if (value === null || value === undefined || value === false) return "";
  return ` ${name}="${escapeHtml(value)}"`;
}

/**
 * The Refinery Chains card's Build Refinery button. With no free building slot it carries the reason the click handler
 * shows, and a line under it says the same (Bug #1254).
 */
export function refineryBuildButtonHtml({ hasRefinery, used, slots }) {
  const full = used >= slots;
  const label = hasRefinery ? "Build 2nd Refinery" : "Build Refinery";
  const reason = full ? `Refinery requires 1 open building slot. Current usage: ${used}/${slots}.` : null;
  const note = full ? `<p class="muted" style="color:var(--color-warn)">No open building slots. Current usage: ${used}/${slots}.</p>` : "";
  return `<button class="btn btn-outline refinery-build-btn"${htmlAttr("data-disabled-reason", reason)}>${label}</button>${note}`;
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
export function queueItemsHtml(queue, subtitle, { progressOf, remainingLabel, formatCredits, statusOf }) {
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
        <p class="muted">Duration: ${escapeHtml(item.durationHours)}h | ${escapeHtml(statusOf ? statusOf(item) : item.startedAt ? "In progress" : "Queued")}</p>
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
 * One chat line. The author and the text are escaped: chat is stored as the player typed it (Bug #1127) and is only
 * ever rendered as text (AB#733).
 */
export function chatLineHtml(msg, formatTime) {
  return `
      <li class="chat-msg">
        <div class="chat-meta">${escapeHtml(msg.author)} | ${escapeHtml(formatTime(msg.createdAt))}</div>
        <div>${escapeHtml(msg.content)}</div>
      </li>
      `;
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

/**
 * A forum post's text as HTML (Bug #1132): lines starting with "> " become one blockquote per run, which is how Quote
 * writes them; the other lines keep their breaks, blank lines separating paragraphs. Every line is escaped.
 */
export function forumPostBodyHtml(text) {
  const blocks = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const quoted = /^>\s?/.test(line);
    const content = quoted ? line.replace(/^>\s?/, "") : line;
    const last = blocks.at(-1);
    if (!quoted && !line.trim()) { blocks.push({ kind: "gap" }); continue; }
    const kind = quoted ? "quote" : "para";
    if (last?.kind === kind) last.lines.push(content);
    else blocks.push({ kind, lines: [content] });
  }
  return blocks
    .filter((b) => b.kind !== "gap")
    .map((b) => {
      const inner = b.lines.map(escapeHtml).join("<br>");
      return b.kind === "quote" ? `<blockquote class="forum-quote">${inner}</blockquote>` : `<p>${inner}</p>`;
    })
    .join("");
}
