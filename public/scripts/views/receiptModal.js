// public/scripts/views/receiptModal.js
// AB#743 (ISP-57): the confirmation modal every committing action shows once the server has answered. Call
// showActionReceipt(answer, { returnFocusTo }) with the route's parsed response; it shows the receipt, or the
// milestone variant when the action reached a level, and does nothing for an answer with neither. AB#744 wires the
// rest of the game's actions to this same function: give the route a receipt (server/receipts.js) and call it here.
//
// It never holds anything up: the action has already happened and nothing awaits the modal. Escape or its button
// closes it, and so does a click anywhere outside the card, which also goes through to whatever was clicked (the
// backdrop takes no pointer events), so the player's next action is never spent dismissing this one. A second answer
// while it is open replaces the first rather than stacking.
import { actionReceiptView } from "../actionReceipt.js";
import { noteVerb } from "../telemetry.js"; // ISP-256 (AB#952)

const modal = document.getElementById("action-receipt-modal");
const headingEl = document.getElementById("action-receipt-heading");
const titleEl = document.getElementById("action-receipt-title");
const bodyEl = document.getElementById("action-receipt-body");
const closeBtn = document.getElementById("action-receipt-close");
const card = modal?.querySelector(".action-receipt-card");

let returnTarget = null;

/**
 * Where focus goes back to. The view that triggered the action usually redraws after it, so the button that was
 * pressed may be gone: a selector is looked up again at close time, an element only if it is still on the page.
 */
function resolveReturnTarget(target) {
  if (typeof target === "function") return target();
  if (typeof target === "string") return document.querySelector(target);
  return target && target.isConnected ? target : null;
}

function close({ restoreFocus = true } = {}) {
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.removeEventListener("keydown", onKeydown, true);
  document.removeEventListener("click", onOutsideClick, true);
  const target = resolveReturnTarget(returnTarget);
  returnTarget = null;
  if (restoreFocus && target && typeof target.focus === "function") target.focus({ preventScroll: true });
}

function onKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
}

// A click outside the card closes it and is not stopped, so it reaches what is underneath. On a control, focus is left
// to that click; on empty page, it goes back to the trigger, as Escape and the button do. A click rather than a
// pointerdown: the browser moves focus on mousedown, which would undo a focus restored any earlier.
const INTERACTIVE = "a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex='-1']), [contenteditable]";
function onOutsideClick(event) {
  if (card && card.contains(event.target)) return;
  const onControl = event.target instanceof Element && event.target.closest(INTERACTIVE);
  close({ restoreFocus: !onControl });
}

if (modal) {
  closeBtn?.addEventListener("click", () => close());
}

/** Show what a committing action did. `answer` is the route's parsed JSON; returns whether anything was shown. */
export function showActionReceipt(answer, { returnFocusTo = null } = {}) {
  const view = actionReceiptView(answer);
  if (!view || !modal) return false;
  if (answer?.receipt) noteVerb(); // ISP-256 (AB#952): a committing action succeeded (an Allocate, the Brief's verb): verb_first, then verb_repeat
  headingEl.textContent = view.heading;
  titleEl.textContent = view.title;
  bodyEl.innerHTML = view.bodyHtml;
  card?.classList.toggle("action-receipt-card--milestone", view.variant === "milestone");
  returnTarget = returnFocusTo;
  if (modal.hidden) {
    modal.hidden = false;
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("click", onOutsideClick, true);
  }
  closeBtn?.focus({ preventScroll: true });
  return true;
}
