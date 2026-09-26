// public/scripts/views/npcProfileModal.js
// ISP-124 (AB#818): the NPC profile card, opened from an NPC's name on the Exchange. It behaves as the receipt does
// (receiptModal.js): its button, Escape or a click outside the card closes it, and focus goes back to the name.
import { npcEntry, npcProfileView } from "../npcProfile.js";
import { appState } from "../state.js";

const modal = document.getElementById("npc-profile-modal");
const headingEl = document.getElementById("npc-profile-heading");
const titleEl = document.getElementById("npc-profile-title");
const bodyEl = document.getElementById("npc-profile-body");
const closeBtn = document.getElementById("npc-profile-close");
const card = modal?.querySelector(".npc-profile-card");
let returnTarget = null;

function close({ restoreFocus = true } = {}) {
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.removeEventListener("keydown", onKeydown, true);
  document.removeEventListener("click", onOutsideClick, true);
  if (restoreFocus && returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
  returnTarget = null;
}
function onKeydown(event) {
  if (event.key === "Escape") { event.preventDefault(); close(); }
}
function onOutsideClick(event) {
  if (card && card.contains(event.target)) return;
  close({ restoreFocus: !(event.target instanceof Element && event.target.closest("button, a[href], input, select, textarea")) });
}
closeBtn?.addEventListener("click", () => close());

/** Open the card for the NPC named `name`, returning focus to `trigger` when it closes; false if it is not an NPC. */
export function showNpcProfile(name, trigger = null) {
  const view = npcProfileView(npcEntry(name, appState.data?.market?.npcDirectory));
  if (!view || !modal) return false;
  headingEl.textContent = view.heading;
  titleEl.textContent = view.title;
  bodyEl.innerHTML = view.bodyHtml;
  returnTarget = trigger;
  if (modal.hidden) {
    modal.hidden = false;
    document.addEventListener("keydown", onKeydown, true);
    // The click that opened it is still bubbling: listen for outside clicks from the next one on.
    setTimeout(() => document.addEventListener("click", onOutsideClick, true), 0);
  }
  closeBtn?.focus({ preventScroll: true });
  return true;
}
