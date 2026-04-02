const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const dummyLoginButton = document.getElementById("dummy-login-btn");

function goToDummyProfile() {
  window.location.href = "/?dummy=1";
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

      const account = await response.json();
      window.location.href = `/?account=${encodeURIComponent(account.id)}`;
    } catch {
      loginStatus.textContent = "Login service unavailable. Try again or use temporary dummy access.";
    }
  });
}

if (dummyLoginButton) {
  dummyLoginButton.addEventListener("click", goToDummyProfile);
}
