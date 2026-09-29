// What the register and login pages tell a player when something goes wrong (Bug #1059): what happened and what to do
// next, with a link when the next step is another page. Nothing here mentions the demo account: it exists only on a
// developer's machine (ISP_DEV=1, never in production), so a real player is never sent to it.

// A message's link finishes its sentence: "... already exists. Log in instead", "... or register a new corporation."
export const LOGIN_LINK = { href: "/login.html", text: "Log in instead." };
export const REGISTER_LINK = { href: "/register.html", text: "register a new corporation." };
// AB#2288: where an unverified player asks for a new verification link.
export const CHECK_EMAIL_LINK = { href: "/check-email.html", text: "Send a new link." };

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
  // AB#2288: the right password on an account whose email is not verified yet, with the resend action beside it.
  if (status === 403 && payload?.code === "email-unverified") return { text: payload.error, link: CHECK_EMAIL_LINK };
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
  // AB#2288: no way to send the verification link here yet; AB#989: it could not be sent just now. Nothing was created.
  if (status === 503 && (payload?.code === "mail-unavailable" || payload?.code === "mail-failed")) return { text: payload.error };
  if (status === 429) return tooManyAttempts(payload, retryAfter);
  if (status === 0) return { text: `The server could not be reached. Check your connection. ${TRY_AGAIN}` };
  return { text: `Registering failed on our side. ${TRY_AGAIN}` };
}

// Bug #4861 (AB#955): the server's own rules (server/game/store.js createAccount and passwordRuleError,
// server/corporationName.js), so the form can name every mistake at once instead of one a submit. The server checks
// them again and is what enforces them; what only it can know (a taken email or name, a reserved name) it still says.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;
const NAME_CHARS = /^[A-Za-z0-9 \-'.&]+$/;
const NAME_MAX = 40;
const squash = (value) => String(value || "").trim().replace(/\s+/g, " ");

function nameProblem(field, value, min, label, empty) {
  const name = squash(value);
  if (!name) return { field, text: empty };
  if (name.length < min) return { field, text: `${label} needs at least ${min} characters; this has ${name.length}.` };
  if (name.length > NAME_MAX) return { field, text: `${label} may be at most ${NAME_MAX} characters; this has ${name.length}.` };
  if (!NAME_CHARS.test(name)) return { field, text: `${label} may use letters, digits, spaces and - ' . & only.` };
  return null;
}

/** Every mistake the register form can see before it is sent, as `[{ field, text }]` in the form's order (none: []).
 *  Shaped as the server's own refusal (`field` names the input), so register-page.js puts each beside its field. */
export function registerFormProblems({ email, password, ceoName, corpName }) {
  const problems = [];
  const address = String(email || "").trim();
  if (!address) problems.push({ field: "email", text: "Enter the email address you will log in with." });
  else if (!address.includes("@")) problems.push({ field: "email", text: "This address has no @. Enter it in full, like name@example.com." });
  else if (address.length > EMAIL_MAX || !EMAIL_SHAPE.test(address)) problems.push({ field: "email", text: "This is not a complete email address. Enter it in full, like name@example.com." });
  const secret = String(password || "");
  if (!secret) problems.push({ field: "password", text: `Choose a password of at least ${PASSWORD_MIN} characters.` });
  else if (secret.length < PASSWORD_MIN) problems.push({ field: "password", text: `Use at least ${PASSWORD_MIN} characters; this has ${secret.length}.` });
  else if (secret.length > PASSWORD_MAX) problems.push({ field: "password", text: `Use at most ${PASSWORD_MAX} characters; this has ${secret.length}.` });
  const ceo = nameProblem("ceoName", ceoName, 2, "The CEO's name", "Enter the CEO's name: 2 to 40 letters, digits, spaces and - ' . &.");
  if (ceo) problems.push(ceo);
  const corp = nameProblem("corpName", corpName, 3, "The corporation's name", "Name your corporation: 3 to 40 letters, digits, spaces and - ' . &.");
  if (corp) problems.push(corp);
  return problems;
}

/** The first of registerFormProblems, or null. */
export function registerFormProblem(values) {
  return registerFormProblems(values)[0] || null;
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
    a.className = "auth-page__link";
    element.append(" ", a);
  }
}
