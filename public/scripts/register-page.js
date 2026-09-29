import { registerErrorMessage, registerFormProblems, showMessage } from "./authMessages.js";

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

const inputOf = (el) => el && registerForm?.querySelector(`[aria-describedby~="${el.id}"]`);

function clearFieldErrors() {
  for (const el of Object.values(FIELD_ERRORS)) {
    if (!el) continue;
    el.textContent = "";
    inputOf(el)?.removeAttribute("aria-invalid");
  }
}

/** Bug #4861: each mistake beside its own field, all at once, each field marked invalid; the first gets the focus. */
function showFieldProblems(problems) {
  clearFieldErrors();
  registerStatus.textContent = "";
  let first = null;
  for (const { field, message } of problems) {
    const el = FIELD_ERRORS[field];
    if (!el) continue;
    showMessage(el, message);
    const input = inputOf(el);
    input?.setAttribute("aria-invalid", "true");
    first ??= input;
  }
  first?.focus();
}

/** `field` is the server's own name for what to fix, or undefined for an error that names no one field (a network
 *  failure, a 500). A named field's message goes beside that field, and nothing is left in the shared status line
 *  for it — the two never say the same thing twice. Bug #4861: it goes through registerErrorMessage there too, so a
 *  taken email keeps its "Log in instead." link. */
function showRegisterError(status, payload, retryAfter) {
  if (payload?.field && FIELD_ERRORS[payload.field]) {
    showFieldProblems([{ field: payload.field, message: registerErrorMessage(status, payload, retryAfter) }]);
    return;
  }
  clearFieldErrors();
  showMessage(registerStatus, registerErrorMessage(status, payload, retryAfter));
}

// AB#2288: registering gives no session. The page goes to "Check your email"; the login after the link stores the
// account id, as login-page.js does.
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

    const problems = registerFormProblems({ email, password, ceoName, corpName });
    if (problems.length) {
      showFieldProblems(problems.map((p) => ({ field: p.field, message: { text: p.text } })));
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
      showRegisterError(response.status, payload, response.headers.get("Retry-After"));
      return;
    }

    // AB#2288: no session yet. The verification link is on its way; the account logs in once it is followed.
    window.location.href = "/check-email.html";
  });
}
