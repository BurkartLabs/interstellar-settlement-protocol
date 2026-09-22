import { registerErrorMessage, registerFormProblem, showMessage } from "./authMessages.js";

const registerForm = document.getElementById("register-form");
const registerStatus = document.getElementById("register-status");

const STORAGE_KEYS = {
  accountId: "isp.accountId",
  accessToken: "isp.accessToken",
  refreshToken: "isp.refreshToken"
};

// TODO(AB#987): Implement email verification
if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(registerForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const ceoName = String(formData.get("ceoName") || "").trim() || "New CEO";
    // Bug #1187: no stand-in name. An empty field used to register as "Frontier Protocol Ventures", so the second
    // player who left it empty was told a name they never typed was taken.
    const corpName = String(formData.get("corpName") || "").trim();

    const problem = registerFormProblem({ email, password, corpName });
    if (problem) {
      registerStatus.textContent = problem;
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
      showMessage(registerStatus, registerErrorMessage(0));
      return;
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      showMessage(registerStatus, registerErrorMessage(response.status, payload));
      return;
    }

    const payload = await response.json();
    localStorage.setItem(STORAGE_KEYS.accountId, payload.account.id);
    localStorage.setItem(STORAGE_KEYS.accessToken, payload.accessToken);
    localStorage.setItem(STORAGE_KEYS.refreshToken, payload.refreshToken);
    window.location.href = `/?account=${encodeURIComponent(payload.account.id)}`;
  });
}
