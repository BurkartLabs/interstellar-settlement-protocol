// AB#738 (ISP-52): the walkthrough's page side (the briefing card, its highlight and its controls), moved out of
// app.js. The steps themselves and the rules for advancing them stay in walkthrough.js, which the tests run in node.
import { WALKTHROUGH_STEPS as walkthroughSteps, chooseHighlight, nextStepIndex } from "./walkthrough.js";
import { revealedGroups, showOnlyGroups } from "./navGroups.js"; // ISP-75 (AB#764)
import { walkthroughScrollDelta } from "./walkthrough.js"; // Bug #1083
import { setWalkthroughEconomy } from "./walkthrough.js"; // AB#1430
import { appState, STORAGE_KEYS } from "./state.js";
import { ASSIGNED_COORDINATOR, COORDINATOR_BYLINE } from "./liaison.js";
import { showDialogue, closeDialogue } from "./dialogue.js";
import { apiFetch, parseJsonResponse } from "./apiClient.js";
import { deepClone } from "./helpers.js";
import { scrollBehavior } from "./motion.js"; // AB#1760

// Finishing or resetting the walkthrough redraws the page and moves between tabs, which app.js owns; it hands those
// over at load (connectWalkthroughUi) rather than this module importing the entry point back.
let appHooks = null;
export function connectWalkthroughUi(hooks) {
  appHooks = hooks;
}
function updateAllViews() {
  appHooks.updateAllViews();
}
function setTab(targetId) {
  appHooks.setTab(targetId);
}

const walkthroughModal = document.getElementById("walkthrough-modal");
const walkthroughTitle = document.getElementById("walkthrough-title");
const walkthroughText = document.getElementById("walkthrough-text");
const walkthroughPrev = document.getElementById("walkthrough-prev");
const walkthroughNext = document.getElementById("walkthrough-next");
const walkthroughEnd = document.getElementById("walkthrough-end");

function walkthroughOfferKey(accountId) {
  if (!accountId) {
    return null;
  }
  return `${STORAGE_KEYS.walkthroughOfferSeenPrefix}${accountId}`;
}

function markWalkthroughOfferSeen(accountId) {
  const key = walkthroughOfferKey(accountId);
  if (!key) {
    return;
  }
  localStorage.setItem(key, "1");
}

export function hasSeenWalkthroughOffer(accountId) {
  const key = walkthroughOfferKey(accountId);
  if (!key) {
    return false;
  }
  return localStorage.getItem(key) === "1";
}

function clearWalkthroughFocus() {
  document.querySelectorAll(".walkthrough__focus").forEach((el) => {
    el.classList.remove("walkthrough__focus");
  });
}

/** ISP-75 (AB#764): the navigation groups a new corporation's briefing has reached so far; all of them otherwise. */
function revealNavGroups() {
  showOnlyGroups(revealedGroups({ walkthroughOpen: !walkthroughModal.hidden, level: appState.data?.corp?.level ?? 0, stepIndex: appState.walkthroughIndex }));
}

function stopWalkthrough() {
  walkthroughModal.hidden = true;
  document.body.classList.remove("walkthrough--open");
  revealNavGroups();
  clearWalkthroughFocus();
  clearInterval(walkthroughWatch);
  walkthroughTarget = null;
}

// AB#581: the walkthrough advances when the player does what a step asks (walkthrough.js, WALKTHROUGH_COMPLETION).
// State predicates are checked on a one-second watch and after every click, because an action's response and the
// building views it opens arrive after the click; tab changes are reported by setTab as "tab:<id>" events.
const walkthroughEvents = new Set();
const walkthroughWarned = new Set();
let walkthroughWatch = null;
let walkthroughTarget = null; // the selector highlighted now: views re-render, so the element itself is not stable
let walkthroughHeld = false; // the player stepped back to reread: stay put until they press Skip
let walkthroughFinished = false;
let walkthroughOfferPending = false;

/** A real dialogue is open (a trade confirmation, a mission, a dialogue). The briefing never moves or appears over one. */
function otherModalOpen() {
  return [...document.querySelectorAll(".modal-backdrop")].some(
    (modal) => modal !== walkthroughModal && !modal.hidden
  );
}

export function noteWalkthroughEvent(name) {
  if (walkthroughModal.hidden || walkthroughFinished) return;
  walkthroughEvents.add(name);
  checkWalkthroughProgress();
}

function checkWalkthroughProgress() {
  if (walkthroughModal.hidden || walkthroughFinished || otherModalOpen()) return;
  if (!walkthroughHeld) {
    const next = nextStepIndex(appState.walkthroughIndex, appState.data, walkthroughEvents);
    if (next >= walkthroughSteps.length) {
      finishWalkthrough();
      return;
    }
    if (next !== appState.walkthroughIndex) {
      appState.walkthroughIndex = next;
      renderWalkthroughStep();
      return;
    }
  }
  refreshWalkthroughHighlight();
}

/** Every step done: stay on the last one, which carries the handoff, until the player closes it. */
function finishWalkthrough() {
  walkthroughFinished = true;
  appState.walkthroughIndex = walkthroughSteps.length - 1;
  renderWalkthroughStep();
  completeWalkthroughForAccount();
}

function refreshWalkthroughHighlight() {
  const step = walkthroughSteps[appState.walkthroughIndex];
  if (!step || walkthroughModal.hidden) return;
  if (walkthroughFinished) {
    // Nothing left to do, so nothing to point at: the card is only the handoff now.
    clearWalkthroughFocus();
    walkthroughTarget = null;
    return;
  }
  const { selector, missing } = chooseHighlight(step, (candidate) => {
    const el = document.querySelector(candidate);
    return { exists: Boolean(el), visible: Boolean(el && el.getClientRects().length) };
  });
  if (missing && !walkthroughWarned.has(step.id)) {
    walkthroughWarned.add(step.id);
    console.warn(`[walkthrough] step "${step.id}": ${step.selector} matches nothing on the page, so it is shown without a highlight.`);
  }
  const target = selector ? document.querySelector(selector) : null;
  if (target?.classList.contains("walkthrough__focus") || (!target && !walkthroughTarget)) return;
  clearWalkthroughFocus();
  if (!target) {
    walkthroughTarget = null;
    return;
  }
  target.classList.add("walkthrough__focus");
  // Scroll only when the thing to do changes, not when a re-render redraws the same control under the player.
  if (selector !== walkthroughTarget) scrollWalkthroughTargetIntoView(target);
  walkthroughTarget = selector;
}


// Bug #1083: into the band between the sticky header and the briefing card, not the centre of the window, where the
// card is on a phone.
function scrollWalkthroughTargetIntoView(target) {
  const card = walkthroughModal.querySelector(".modal-card");
  const header = document.querySelector(".app-header");
  const delta = walkthroughScrollDelta({
    viewportHeight: window.innerHeight,
    headerBottom: header ? header.getBoundingClientRect().bottom : 0,
    card: card ? card.getBoundingClientRect() : null,
    target: target.getBoundingClientRect()
  });
  if (delta) window.scrollBy({ top: delta, behavior: scrollBehavior() });
}

async function completeWalkthroughForAccount() {
  if (!appState.accountId || appState.walkthroughCompleted) {
    return;
  }

  try {
    const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/walkthrough-complete`, {
      method: "POST"
    });
    const account = await parseJsonResponse(response);
    appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
    appState.data = deepClone(account.state);
    updateAllViews();
  } catch {
    // Walkthrough completion persistence is best-effort.
  }
}

export async function resetWalkthroughForAccount() {
  if (!appState.accountId) {
    appState.walkthroughCompleted = false;
    if (appState.data?.playerProfile) {
      appState.data.playerProfile.walkthroughCompleted = false;
    }
    return;
  }

  const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/walkthrough-reset`, {
    method: "POST"
  });
  const account = await parseJsonResponse(response);
  appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
  appState.data = deepClone(account.state);
  updateAllViews();
}

function renderWalkthroughStep() {
  const step = walkthroughSteps[appState.walkthroughIndex];
  if (!step) {
    stopWalkthrough();
    return;
  }

  // AB#579: a briefing from the assigned coordinator. The step count is a small mark under the text, not the heading.
  const portrait = document.getElementById("walkthrough-portrait");
  if (portrait) {
    portrait.src = ASSIGNED_COORDINATOR.portrait;
    portrait.alt = ASSIGNED_COORDINATOR.name;
  }
  const speaker = document.getElementById("walkthrough-speaker");
  if (speaker) speaker.textContent = COORDINATOR_BYLINE;
  walkthroughTitle.textContent = step.title;
  setWalkthroughEconomy(appState.economy); // AB#1430: the steps that quote a price read it from here
  walkthroughText.textContent = step.text;
  const progress = document.getElementById("walkthrough-progress");
  if (progress) {
    progress.textContent = walkthroughFinished
      ? "Briefing complete"
      : `${appState.walkthroughIndex + 1} of ${walkthroughSteps.length}`;
  }
  // AB#581: the steps advance on what the player does, so the button is a way past a step, not the way through.
  walkthroughPrev.disabled = appState.walkthroughIndex === 0;
  walkthroughPrev.hidden = walkthroughFinished;
  walkthroughEnd.hidden = walkthroughFinished;
  walkthroughNext.textContent = walkthroughFinished ? "Close" : "Skip";
  const card = walkthroughModal.querySelector(".modal-card");
  if (card) document.body.style.setProperty("--walkthrough-card-height", `${card.offsetHeight + 24}px`);
  walkthroughTarget = null;
  revealNavGroups();
  refreshWalkthroughHighlight();
}

function startWalkthrough() {
  walkthroughEvents.clear();
  walkthroughWarned.clear();
  walkthroughHeld = false;
  walkthroughFinished = false;
  appState.walkthroughIndex = 0;
  walkthroughModal.hidden = false;
  document.body.classList.add("walkthrough--open");
  renderWalkthroughStep();
  clearInterval(walkthroughWatch);
  walkthroughWatch = setInterval(checkWalkthroughProgress, 1000);
}

export function promptWalkthroughOffer() {
  // AB#581: never over another dialogue, such as an open trade confirmation (Builder #1 saw this once).
  if (otherModalOpen()) {
    if (!walkthroughOfferPending) {
      walkthroughOfferPending = true;
      setTimeout(() => {
        walkthroughOfferPending = false;
        promptWalkthroughOffer();
      }, 500);
    }
    return;
  }
  markWalkthroughOfferSeen(appState.accountId);
  showDialogue({
    speaker: COORDINATOR_BYLINE,
    portrait: ASSIGNED_COORDINATOR.portrait,
    title: "Your first day",
    text: "I can take you through your first day on the station: an office, staff, a mining claim, and your first sale. It takes a few minutes. If you would rather find your own way, the milestones on your Overview say what the ISA expects next.",
    choices: [
      {
        label: "Brief me",
        accent: true,
        onClick: () => {
          closeDialogue();
          startWalkthrough();
        }
      },
      {
        label: "I'll find my own way",
        onClick: () => {
          closeDialogue();
        }
      }
    ]
  });
}

/** The briefing card's own buttons, and the page-wide click that re-checks progress (bound from app.js's bindEvents). */
export function bindWalkthroughControls() {
  walkthroughPrev.addEventListener("click", () => {
    appState.walkthroughIndex = Math.max(0, appState.walkthroughIndex - 1);
    walkthroughHeld = true;
    renderWalkthroughStep();
  });

  // Skip always works: past this step, then past any the player has already done.
  walkthroughNext.addEventListener("click", () => {
    if (walkthroughFinished) {
      stopWalkthrough();
      return;
    }
    if (appState.walkthroughIndex >= walkthroughSteps.length - 1) {
      stopWalkthrough();
      completeWalkthroughForAccount();
      setTab("rnd");
      return;
    }
    walkthroughHeld = false;
    const next = nextStepIndex(appState.walkthroughIndex + 1, appState.data, walkthroughEvents);
    if (next >= walkthroughSteps.length) {
      finishWalkthrough();
      return;
    }
    appState.walkthroughIndex = next;
    renderWalkthroughStep();
  });

  // An action's result, or a building view it opens, lands after the click that caused it.
  document.addEventListener("click", () => setTimeout(checkWalkthroughProgress, 0));

  walkthroughEnd.addEventListener("click", () => {
    stopWalkthrough();
    completeWalkthroughForAccount();
    setTab("rnd");
  });
}
