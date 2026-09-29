// ISP-264 (AB#960): the player's own account and data. "Download your data" saves GET /export, a JSON file of
// everything the server holds about the account (GDPR Article 20). "Delete your account" asks for the password and
// the word DELETE, then posts them (Article 17); the server erases the email, password, sessions, notifications and
// memoranda and anonymises the corporation in shared history, or refuses and changes nothing.
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { appState } from "../state.js";

export const CONFIRM_WORD = "DELETE";
export const exportPath = (accountId) => `/api/accounts/${encodeURIComponent(accountId)}/export`;
export const deletePath = (accountId) => `/api/accounts/${encodeURIComponent(accountId)}/delete-account`;

const $ = (id) => document.getElementById(id);

/** Whether the delete form may be sent: a password, and the confirmation word typed exactly. */
export const deleteReady = (password, word) => String(password || "").length > 0 && String(word || "").trim() === CONFIRM_WORD;

function show(step) {
  for (const el of document.querySelectorAll("#account-data-modal [data-step]")) el.hidden = el.getAttribute("data-step") !== step;
}

let returnFocus = null;
export function openAccountData() {
  const modal = $("account-data-modal");
  if (!modal || !appState.accountId) return;
  returnFocus = document.activeElement;
  $("account-delete-form")?.reset();
  $("account-delete-error").textContent = "";
  $("account-export-status").textContent = "";
  $("account-delete-submit").disabled = true;
  show("main");
  modal.hidden = false;
  $("account-export-btn")?.focus();
}

function close() {
  const modal = $("account-data-modal");
  if (!modal) return;
  modal.hidden = true;
  returnFocus?.focus?.();
}

async function downloadExport() {
  const status = $("account-export-status");
  status.textContent = "Preparing your data…";
  try {
    const res = await apiFetch(exportPath(appState.accountId));
    if (!res.ok) await parseJsonResponse(res); // throws with the server's message
    const blob = await res.blob();
    const name = (res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || "isp-account-data.json";
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `Saved ${name}.`;
  } catch (error) {
    status.textContent = error?.message || "The export could not be prepared. Try again.";
  }
}

/** Bind the header's Account button and the dialog. `onDeleted` signs the page out once the account is gone. */
export function bindAccountData({ onDeleted }) {
  $("account-data-btn")?.addEventListener("click", openAccountData);
  $("account-data-close")?.addEventListener("click", close);
  $("account-export-btn")?.addEventListener("click", downloadExport);
  $("account-delete-start")?.addEventListener("click", () => { show("delete"); $("account-delete-password")?.focus(); });
  $("account-delete-cancel")?.addEventListener("click", () => { show("main"); $("account-delete-start")?.focus(); });
  $("account-data-modal")?.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("account-data-modal").querySelector('[data-step="done"]:not([hidden])')) close(); });
  const form = $("account-delete-form");
  const sync = () => { $("account-delete-submit").disabled = !deleteReady($("account-delete-password").value, $("account-delete-confirm").value); };
  form?.addEventListener("input", sync);
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = $("account-delete-password").value;
    const confirm = $("account-delete-confirm").value.trim();
    if (!deleteReady(password, confirm)) return;
    const submit = $("account-delete-submit");
    submit.disabled = true;
    $("account-delete-error").textContent = "";
    try {
      await parseJsonResponse(await apiFetch(deletePath(appState.accountId), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, confirm })
      }));
      show("done");
      $("account-deleted-leave")?.focus();
      $("account-deleted-leave")?.addEventListener("click", () => { $("account-data-modal").hidden = true; onDeleted(); }, { once: true });
    } catch (error) {
      $("account-delete-error").textContent = error?.message || "The account could not be deleted. Nothing was changed.";
      $("account-delete-password").value = "";
      sync();
      $("account-delete-password").focus();
    }
  });
}
