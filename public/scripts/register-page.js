const registerForm = document.getElementById("register-form");
const registerStatus = document.getElementById("register-status");

const STORAGE_KEYS = {
  accountId: "isp.accountId",
  accessToken: "isp.accessToken",
  refreshToken: "isp.refreshToken"
};

// TODO: Implement email verification
if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(registerForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const ceoName = String(formData.get("ceoName") || "New CEO").trim();
    const corpName = String(formData.get("corpName") || "Frontier Protocol Ventures").trim();

    if (!email || !password || password.length < 8) {
      registerStatus.textContent = "Registration requires a valid email and a password with at least 8 characters.";
      return;
    }

    registerStatus.textContent = "Registering corporation credentials...";

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ceoName, corpName })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Registration failed." }));
        registerStatus.textContent = payload.error || "Registration failed.";
        return;
      }

      const payload = await response.json();
      localStorage.setItem(STORAGE_KEYS.accountId, payload.account.id);
      localStorage.setItem(STORAGE_KEYS.accessToken, payload.accessToken);
      localStorage.setItem(STORAGE_KEYS.refreshToken, payload.refreshToken);
      window.location.href = `/?account=${encodeURIComponent(payload.account.id)}`;
    } catch {
      registerStatus.textContent = "Registration service unavailable. Try again shortly.";
    }
  });
}
