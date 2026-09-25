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

function clearTypewriter() {
  if (appState.activeTypewriter) {
    clearInterval(appState.activeTypewriter);
    appState.activeTypewriter = null;
  }
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
  appState.activeTypewriter = setInterval(() => {
    dialogueText.textContent += text[index] || "";
    index += 1;
    if (index >= text.length) {
      clearTypewriter();
      if (onDone) {
        onDone();
      }
    }
  }, 14);
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
