// AB#738 (ISP-52): the coordinator's dialogue card and its typewriter, moved out of app.js.
import { appState } from "./state.js";
import { ASSIGNED_COORDINATOR, COORDINATOR_BYLINE } from "./liaison.js";
import { prefersReducedMotion } from "./motion.js"; // AB#1760

const dialogueModal = document.getElementById("dialogue-modal");
const dialogueSpeaker = document.getElementById("dialogue-speaker");
const dialogueTitle = document.getElementById("dialogue-title");
const dialogueText = document.getElementById("dialogue-text");
const dialogueChoices = document.getElementById("dialogue-choices");
const dialogueContinue = document.getElementById("dialogue-continue");

// AB#1763 (ISP-294): while a line is typing, a click or tap anywhere on the dialogue, or any key, finishes it.
let skipTyping = null;
let skipArming = null;

function clearTypewriter() {
  if (appState.activeTypewriter) {
    clearInterval(appState.activeTypewriter);
    appState.activeTypewriter = null;
  }
  clearTimeout(skipArming);
  if (skipTyping) {
    dialogueModal.removeEventListener("click", skipTyping);
    document.removeEventListener("keydown", skipTyping, true);
    skipTyping = null;
  }
}

/** The first choice or Continue button, once the line has finished and they exist. */
function firstControl() {
  return dialogueChoices.querySelector("button") || (dialogueContinue.hidden ? null : dialogueContinue);
}

function typeDialogueText(text, onDone) {
  clearTypewriter();
  // AB#1760: a player who asks for reduced motion reads the whole line at once.
  if (prefersReducedMotion()) {
    dialogueText.textContent = text;
    if (onDone) onDone();
    return;
  }
  dialogueText.textContent = "";
  let index = 0;
  const finish = () => {
    clearTypewriter();
    dialogueText.textContent = text;
    if (onDone) onDone();
  };
  appState.activeTypewriter = setInterval(() => {
    dialogueText.textContent += text[index] || "";
    index += 1;
    if (index >= text.length) finish();
  }, 14);
  // The key or click that finishes the line does nothing else: the choices do not exist until it has, and the key is
  // not passed on, so Enter or Space cannot also press whatever held focus. Focus then goes to the first choice, so
  // the next key press acts on it.
  skipTyping = (event) => {
    if (event.type === "keydown") {
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
    }
    finish();
    firstControl()?.focus();
  };
  // Armed on the next task, not now: a choice that opens the next line does so while its own click (or the Enter that
  // pressed it) is still being dispatched, and a listener added to dialogueModal now would take that same click as a
  // skip and finish the new line before anyone read it.
  const skip = skipTyping;
  skipArming = setTimeout(() => {
    if (skipTyping !== skip) return;
    dialogueModal.addEventListener("click", skip);
    document.addEventListener("keydown", skip, true);
  }, 0);
}

export function showDialogue({ speaker, title, text, choices = [], continueText = "", onContinue, portrait = "" }) {
  dialogueSpeaker.textContent = speaker;
  dialogueTitle.textContent = title;
  // A speaker with a portrait shows it (AB#585); every other dialogue keeps the text-only card.
  const dialoguePortrait = document.getElementById("dialogue-portrait");
  if (dialoguePortrait) {
    dialoguePortrait.hidden = !portrait;
    dialoguePortrait.closest(".modal-card")?.classList.toggle("has-portrait", Boolean(portrait));
    if (portrait) {
      dialoguePortrait.src = portrait;
      dialoguePortrait.alt = speaker;
    } else {
      dialoguePortrait.removeAttribute("src");
    }
  }
  dialogueChoices.innerHTML = "";
  dialogueContinue.hidden = true;
  dialogueModal.hidden = false;

  typeDialogueText(text, () => {
    choices.forEach((choice) => {
      const button = document.createElement("button");
      button.className = `btn ${choice.accent ? "btn-accent" : "btn-outline"}`;
      button.textContent = choice.label;
      button.addEventListener("click", choice.onClick);
      dialogueChoices.append(button);
    });

    if (continueText) {
      dialogueContinue.hidden = false;
      dialogueContinue.textContent = continueText;
      dialogueContinue.onclick = onContinue;
    }
  });
}

export function closeDialogue() {
  clearTypewriter();
  dialogueModal.hidden = true;
  dialogueChoices.innerHTML = "";
  dialogueContinue.hidden = true;
}

// TODO(AB#585): Expand design of intro dialogue
export function runIntroDialogue() {
  return new Promise((resolve) => {
    showDialogue({
      speaker: COORDINATOR_BYLINE,
      portrait: ASSIGNED_COORDINATOR.portrait,
      title: "Corporate Confirmation",
      text: "Registration complete. Your corporation is officially chartered under the Interstellar Settlement Protocol, and command authority is yours as Founder and CEO. The Bureau assigns every new charter a coordinator. I have been assigned to yours.",
      choices: [
        {
          label: "Any advice for me?",
          accent: true,
          onClick: () => {
            showDialogue({
              speaker: COORDINATOR_BYLINE,
              portrait: ASSIGNED_COORDINATOR.portrait,
              title: "Starting Advice",
              text: "In order: an office, then staff, then a mining claim with a yard on it. Sell what you mine before you spend on anything you do not yet need. Research can wait until the yard is running. I will walk you through each of those next.",
              continueText: "Proceed To Command Interface",
              onContinue: () => {
                closeDialogue();
                resolve();
              }
            });
          }
        },
        {
          label: "Proceed. I understand the basics.",
          onClick: () => {
            closeDialogue();
            resolve();
          }
        }
      ]
    });
  });
}
