// AB#987 (ISP-280): ask for a new verification link. The server answers the same whether or not the address has an
// account, and so does this page.

const form = document.getElementById("resend-form");
const email = document.getElementById("resend-email");
const status = document.getElementById("resend-status");
const button = document.getElementById("resend-btn");

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
    const response = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: address })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 202) status.textContent = payload.message || "A new link is on its way.";
    else if (response.status === 429) status.textContent = "Too many requests for a new link. Try again in an hour.";
    else status.textContent = payload.error || "No link could be sent. Try again in a minute.";
  } catch {
    status.textContent = "The server could not be reached. Check your connection and try again.";
  } finally {
    button.disabled = false;
  }
});
