// public/scripts/actionReceipt.js
// AB#743 (ISP-57): what the confirmation modal says after a committing action. Pure: no DOM, so node tests read it.
// The figures come from the server's own answer (server/receipts.js for `receipt`, server/game/progression.js for
// `levelsReached`); this module only lays them out. views/receiptModal.js puts the result on screen.
//
// Two variants: the receipt (what was done, what it cost, what it grants, what to do next), and the milestone, shown
// when the same action also reached a level, which leads with the level's unlocks and keeps the receipt under them.
import { escapeHtml } from "./html.js";

const rows = (items) => items.map(({ label, value }) =>
  `<div class="action-receipt-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");

function receiptBody(receipt) {
  return `
    <p class="action-receipt-summary">${escapeHtml(receipt.summary)}</p>
    <dl class="action-receipt-list">
      ${rows([{ label: "Charged", value: receipt.cost }, ...(receipt.grants || [])])}
    </dl>
    <p class="action-receipt-next"><span class="action-receipt-next-label">Next</span> ${escapeHtml(receipt.next)}</p>`;
}

/**
 * The modal's content for a server answer, or null when it carries nothing to confirm (a refusal, or an action that
 * has no receipt yet). Returns { variant, heading, title, bodyHtml }.
 */
export function actionReceiptView(answer) {
  const receipt = answer?.receipt || null;
  const levels = Array.isArray(answer?.levelsReached) ? answer.levelsReached.filter((l) => l && l.level) : [];
  if (!receipt && levels.length === 0) return null;
  if (levels.length === 0) {
    return { variant: "receipt", heading: "ISA Transaction Record", title: receipt.title, bodyHtml: receiptBody(receipt) };
  }
  const top = levels[levels.length - 1];
  const levelsHtml = levels.map((l) => `
    <section class="action-receipt-level">
      <p class="action-receipt-summary">Your corporation reached Level ${escapeHtml(l.level)} of ${escapeHtml(l.maxLevel)}. The ISA registry now grants:</p>
      <dl class="action-receipt-list">${rows(l.unlocks || [])}</dl>
    </section>`).join("");
  const orderHtml = receipt
    ? `<section class="action-receipt-order"><h3>${escapeHtml(receipt.title)}</h3>${receiptBody(receipt)}</section>`
    : "";
  return { variant: "milestone", heading: "ISA Corporate Registry", title: top.title, bodyHtml: levelsHtml + orderHtml };
}
