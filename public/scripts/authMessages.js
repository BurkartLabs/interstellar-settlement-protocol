// What the register and login pages tell a player when something goes wrong (Bug #1059): what happened and what to do
// next, with a link when the next step is another page. Nothing here mentions the demo account: it exists only on a
// developer's machine (ISP_DEV=1, never in production), so a real player is never sent to it.

// A message's link finishes its sentence: "... already exists. Log in instead", "... or register a new corporation."
export const LOGIN_LINK = { href: "/login.html", text: "Log in instead." };
export const REGISTER_LINK = { href: "/register.html", text: "register a new corporation." };

const TRY_AGAIN = "Try again in a minute.";

/**
 * AB#2043: a refusal for too many attempts says how long the server will keep refusing. `retryAfter` is its
 * Retry-After header in seconds: one minute for logins per address, 15 for one account's failed logins, 60 for
 * registrations. Without a usable header, the server's own sentence, which names the same time; with neither, a minute.
 * The durations are never written here: a second copy would drift from server/rateLimiters.js.
 */
function tooManyAttempts(payload, retryAfter) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    const minutes = Math.ceil(seconds / 60);
    return { text: `Too many attempts. ${minutes <= 1 ? TRY_AGAIN : `Try again in ${minutes} minutes.`}` };
  }
  if (payload?.error) return { text: payload.error };
  return { text: `Too many attempts. ${TRY_AGAIN}` };
}

/** The message for a failed login: `status` is the HTTP status (0 when the server could not be reached), and
 *  `retryAfter` the response's Retry-After header, read only for a 429. */
export function loginErrorMessage(status, payload = {}, retryAfter) {
  if (status === 401) {
    return { text: "That email and password do not match. Check them and try again, or", link: REGISTER_LINK };
  }
  if (status === 400 && payload?.error) return { text: payload.error };
  if (status === 429) return tooManyAttempts(payload, retryAfter);
  if (status === 0) return { text: `The server could not be reached. Check your connection. ${TRY_AGAIN}` };
  return { text: `Logging in failed on our side. ${TRY_AGAIN}` };
}

/** The message for a failed registration. The server names what to fix; an email already in use offers the login. */
export function registerErrorMessage(status, payload = {}, retryAfter) {
  if (status === 400 && payload?.code === "email-taken") {
    return { text: "An account with this email already exists.", link: LOGIN_LINK };
  }
  if (status === 400 && payload?.error) return { text: payload.error };
  // AB#781: the Board closed registration (REGISTRATION_OPEN); say that rather than "failed on our side".
  if (status === 403 && payload?.code === "registration-closed") return { text: payload.error };
  if (status === 429) return tooManyAttempts(payload, retryAfter);
  if (status === 0) return { text: `The server could not be reached. Check your connection. ${TRY_AGAIN}` };
  return { text: `Registering failed on our side. ${TRY_AGAIN}` };
}

/** What the register form is missing before it is sent, as `{ field, text }`, or null. The server checks the same
 *  rules again (ISP-66) and is what actually enforces them — this is only so an obviously-empty or obviously-short
 *  field doesn't cost a round trip. Shaped the same as the server's own refusal (`field` names the input) so
 *  register-page.js shows both beside the field the same way, not one there and one in the shared status line. */
export function registerFormProblem({ email, password, ceoName, corpName }) {
  if (!email || !email.includes("@")) return { field: "email", text: "Enter the email address you will log in with." };
  if (!password || password.length < 10) return { field: "password", text: "Choose a password of at least 10 characters." };
  if (!ceoName) return { field: "ceoName", text: "Enter the CEO's name: 2 to 40 letters, digits, spaces and - ' . &." };
  if (!corpName) return { field: "corpName", text: "Name your corporation: 3 to 40 letters, digits, spaces and - ' . &." };
  return null;
}

/** What the login form is missing before it is sent, or null. */
export function loginFormProblem({ email, password }) {
  if (!email || !password) return "Enter your email and password.";
  return null;
}

/** Show `message` ({text, link?}) in a status element, building the link as an element (no HTML is parsed). */
export function showMessage(element, message) {
  if (!element) return;
  element.textContent = message.text;
  if (message.link) {
    const a = element.ownerDocument.createElement("a");
    a.href = message.link.href;
    a.textContent = message.link.text;
    a.className = "login-status-link";
    element.append(" ", a);
  }
}
