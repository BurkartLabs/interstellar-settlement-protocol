const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const dummyLoginButton = document.getElementById("dummy-login-btn");
// TODO: Move IS_DEV_ACCESS duplicate to a single file
const IS_DEV_ACCESS =
  new URL(window.location.href).searchParams.get("dev") === "1" ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const STORAGE_KEYS = {
  accountId: "isp.accountId",
  accessToken: "isp.accessToken",
  refreshToken: "isp.refreshToken"
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

  loginStatus.textContent = "Authorizing temporary sandbox access...";

  try {
    const response = await fetch("/api/auth/dummy-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    if (!response.ok) {
      loginStatus.textContent = "Dummy access is currently unavailable.";
      return;
    }

    const payload = await response.json();
    localStorage.setItem(STORAGE_KEYS.accountId, payload.account.id);
    localStorage.setItem(STORAGE_KEYS.accessToken, payload.accessToken);
    localStorage.setItem(STORAGE_KEYS.refreshToken, payload.refreshToken);
    window.location.href = `/?account=${encodeURIComponent(payload.account.id)}`;
  } catch {
    loginStatus.textContent = "Dummy access failed. Try again.";
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

    if (!email || !password) {
      loginStatus.textContent = "Enter both email and password to continue.";
      return;
    }

    if (password.length < 8) {
      loginStatus.textContent = "Password must be at least 8 characters.";
      return;
    }

    loginStatus.textContent = "Authenticating corporate profile...";

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        loginStatus.textContent = "Invalid credentials. Use the dummy account button for temporary access.";
        return;
      }

      const payload = await response.json();
      localStorage.setItem(STORAGE_KEYS.accountId, payload.account.id);
      localStorage.setItem(STORAGE_KEYS.accessToken, payload.accessToken);
      localStorage.setItem(STORAGE_KEYS.refreshToken, payload.refreshToken);
      window.location.href = `/?account=${encodeURIComponent(payload.account.id)}`;
    } catch {
      loginStatus.textContent = "Login service unavailable. Try again or use temporary dummy access.";
    }
  });
}

if (dummyLoginButton) {
  dummyLoginButton.addEventListener("click", goToDummyProfile);
}
