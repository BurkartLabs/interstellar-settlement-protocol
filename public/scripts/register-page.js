import { registerErrorMessage, registerFormProblem, showMessage } from "./authMessages.js";

const registerForm = document.getElementById("register-form");
const registerStatus = document.getElementById("register-status");

// ISP-66: one error element per field, next to the input it is about ("beside the field"), so the server's
// per-field refusal lands where the player is already looking, not only in the shared status line below the form.
const FIELD_ERRORS = {
  email: document.getElementById("register-email-error"),
  password: document.getElementById("register-password-error"),
  ceoName: document.getElementById("register-ceo-error"),
  corpName: document.getElementById("register-corp-error")
};

function clearFieldErrors() {
  for (const el of Object.values(FIELD_ERRORS)) if (el) el.textContent = "";
}

/** `field` is the server's own name for what to fix, or undefined for an error that names no one field (a network
 *  failure, a 500). A named field's message goes beside that field, and nothing is left in the shared status line
 *  for it — the two never say the same thing twice. */
function showRegisterError(status, payload) {
  clearFieldErrors();
  const target = payload?.field ? FIELD_ERRORS[payload.field] : undefined;
  if (target) {
    target.textContent = payload.error;
    registerStatus.textContent = "";
    return;
  }
  showMessage(registerStatus, registerErrorMessage(status, payload));
}

// AB#757: only the account id is stored. The refresh token arrived as an HttpOnly cookie, and the game page gets its
// own access token from that cookie on load.
const STORAGE_KEYS = {
  accountId: "isp.accountId"
};

// TODO(AB#987): Implement email verification
if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors();

    const formData = new FormData(registerForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    // Bug #1187: no stand-in name. An empty corpName used to register as "Frontier Protocol Ventures", so the
    // second player who left it empty was told a name they never typed was taken; ceoName gets the same treatment
    // (ISP-66) rather than the "New CEO" default this line used to substitute.
    const ceoName = String(formData.get("ceoName") || "").trim();
    const corpName = String(formData.get("corpName") || "").trim();

    const problem = registerFormProblem({ email, password, ceoName, corpName });
    if (problem) {
      showRegisterError(0, { field: problem.field, error: problem.text });
      return;
    }

    registerStatus.textContent = "Registering corporation credentials...";

    let response;
    try {
      response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ceoName, corpName })
      });
    } catch {
      showRegisterError(0, {});
      return;
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      showRegisterError(response.status, payload);
      return;
    }

    const payload = await response.json();
    localStorage.setItem(STORAGE_KEYS.accountId, payload.account.id);
    window.location.href = `/?account=${encodeURIComponent(payload.account.id)}`;
  });
}
