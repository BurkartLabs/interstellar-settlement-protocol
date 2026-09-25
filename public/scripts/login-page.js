import { loginErrorMessage, loginFormProblem, showMessage } from "./authMessages.js";

const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const dummyLoginButton = document.getElementById("dummy-login-btn");
// TODO(AB#738): Move IS_DEV_ACCESS duplicate to a single file
// The demo account exists only on a developer's server (ISP_DEV=1, never in production), so its button shows only there.
const IS_DEV_ACCESS =
  new URL(window.location.href).searchParams.get("dev") === "1" ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

// AB#757: only the account id is stored. The refresh token arrived as an HttpOnly cookie, and the game page gets its
// own access token from that cookie on load.
const STORAGE_KEYS = {
  accountId: "isp.accountId"
};

const loginPageUrl = new URL(window.location.href);
const loginReason = loginPageUrl.searchParams.get("reason");

if (loginReason === "expired" && loginStatus) {
  loginStatus.textContent = "Your session expired. Log in again to continue.";
}

async function goToDummyProfile() {
  if (!IS_DEV_ACCESS) {
    return;
  }

  loginStatus.textContent = "Opening the demo account...";

  try {
    const response = await fetch("/api/auth/dummy-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    if (!response.ok) {
      loginStatus.textContent = "The demo account is not available on this server (it needs ISP_DEV=1).";
      return;
    }

    const payload = await response.json();
    localStorage.setItem(STORAGE_KEYS.accountId, payload.account.id);
    window.location.href = `/?account=${encodeURIComponent(payload.account.id)}`;
  } catch {
    loginStatus.textContent = "The demo account could not be reached. Try again.";
  }
}

if (dummyLoginButton) {
  dummyLoginButton.hidden = !IS_DEV_ACCESS;
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    const problem = loginFormProblem({ email, password });
    if (problem) {
      loginStatus.textContent = problem;
      return;
    }

    loginStatus.textContent = "Authenticating corporate profile...";

    let response;
    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
    } catch {
      showMessage(loginStatus, loginErrorMessage(0));
      return;
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      showMessage(loginStatus, loginErrorMessage(response.status, payload));
      return;
    }

    const payload = await response.json();
    localStorage.setItem(STORAGE_KEYS.accountId, payload.account.id);
    window.location.href = `/?account=${encodeURIComponent(payload.account.id)}`;
  });
}

if (dummyLoginButton) {
  dummyLoginButton.addEventListener("click", goToDummyProfile);
}
