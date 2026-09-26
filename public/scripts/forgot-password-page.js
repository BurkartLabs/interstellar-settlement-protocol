// AB#988 (ISP-281): ask for a password-reset link. The server answers the same whether or not the address has an
// account, and so does this page.

const form = document.getElementById("forgot-form");
const email = document.getElementById("forgot-email");
const status = document.getElementById("forgot-status");
const button = document.getElementById("forgot-btn");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const address = email.value.trim();
  if (!address || !address.includes("@")) {
    status.textContent = "Enter the email address you registered with.";
    return;
  }
  button.disabled = true;
  status.textContent = "Sending...";
  try {
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: address })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 202) status.textContent = payload.message || "A reset link is on its way.";
    else if (response.status === 429) status.textContent = "Too many reset requests. Try again in an hour.";
    else status.textContent = payload.error || "No link could be sent. Try again in a minute.";
  } catch {
    status.textContent = "The server could not be reached. Check your connection and try again.";
  } finally {
    button.disabled = false;
  }
});
