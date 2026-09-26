// AB#987 (ISP-280): spend the token in this page's fragment when the player presses the button, then show the
// verified landing, or say the link is spent and offer a new one.

const title = document.getElementById("verify-title");
const copy = document.getElementById("verify-copy");
const status = document.getElementById("verify-status");
const button = document.getElementById("verify-btn");
const login = document.getElementById("verify-login");
const newLink = document.getElementById("verify-new-link");

const token = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";

function spent(message) {
  title.textContent = "This link cannot be used";
  copy.textContent = message || "This link has expired or was already used. Ask for a new one.";
  status.textContent = "";
  button.hidden = true;
  newLink.hidden = false;
}

function verified() {
  title.textContent = "Your email is verified";
  copy.textContent = "Your corporation's account is confirmed. Log in to take command.";
  status.textContent = "";
  button.hidden = true;
  newLink.hidden = true;
  login.classList.remove("btn-hero-secondary");
  login.classList.add("btn-hero-fill");
}

if (!token) spent("This link is incomplete. Open the whole link from the email, or ask for a new one.");

button?.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Verifying...";
  try {
    const response = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const payload = await response.json().catch(() => ({}));
    // The token is spent either way: take it out of the address bar and the history.
    history.replaceState(null, "", window.location.pathname);
    if (response.ok && payload.verified) verified();
    else spent(payload.error);
  } catch {
    status.textContent = "The server could not be reached. Check your connection and try again.";
    button.disabled = false;
  }
});
