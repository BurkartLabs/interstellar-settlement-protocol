// AB#988 (ISP-281): set a new password with the token in this page's fragment. A refused password leaves the link
// usable; a spent or expired link says so and offers a new one.

const title = document.getElementById("reset-title");
const copy = document.getElementById("reset-copy");
const form = document.getElementById("reset-form");
const password = document.getElementById("reset-password");
const confirm = document.getElementById("reset-confirm");
const status = document.getElementById("reset-status");
const button = document.getElementById("reset-btn");
const login = document.getElementById("reset-login");
const newLink = document.getElementById("reset-new-link");

const token = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";

function hideForm() {
  for (const el of form.querySelectorAll("label, input")) el.hidden = true;
  button.hidden = true;
}

function spent(message) {
  title.textContent = "This link cannot be used";
  copy.textContent = message || "This link has expired or was already used. Ask for a new one.";
  status.textContent = "";
  hideForm();
  newLink.hidden = false;
}

function changed() {
  title.textContent = "Your password is changed";
  copy.textContent = "Every device that was signed in has been signed out. Log in with your new password.";
  status.textContent = "";
  hideForm();
  login.classList.remove("ui-button--secondary");
  login.classList.add("ui-button--primary"); // AB#765: Log In becomes the page's one primary
}

if (!token) spent("This link is incomplete. Open the whole link from the email, or ask for a new one.");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (password.value.length < 10 || password.value.length > 128) {
    status.textContent = "Choose a password of 10 to 128 characters.";
    return;
  }
  if (password.value !== confirm.value) {
    status.textContent = "The two passwords are not the same.";
    return;
  }
  button.disabled = true;
  status.textContent = "Saving...";
  try {
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: password.value })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.reset) {
      history.replaceState(null, "", window.location.pathname); // the token is spent: out of the address bar
      changed();
    } else if (payload.field === "password") {
      status.textContent = payload.error; // the link still works: try another password
    } else {
      history.replaceState(null, "", window.location.pathname);
      spent(payload.error);
    }
  } catch {
    status.textContent = "The server could not be reached. Check your connection and try again.";
  } finally {
    button.disabled = false;
  }
});
