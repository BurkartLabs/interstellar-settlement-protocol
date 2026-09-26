// AB#2288: registration gives no session. A spec that registers through the page and then plays follows the
// verification link from the server's test outbox and logs in through the login page, as a new player does. The
// outbox is read through GET /api/dev/outbox, so the server under test runs with ISP_DEV=1 (never production).
//
// `base` is the server's origin for a spec that starts its own, or "" for one using the configured BASE_URL.

/** The newest verification token the server's outbox holds for this address. */
export async function verificationToken(request, base, email) {
  const res = await request.get(`${base}/api/dev/outbox`);
  if (!res.ok()) throw new Error(`GET /api/dev/outbox answered ${res.status()}: start the server under test with ISP_DEV=1 (AB#2288)`);
  const address = String(email).trim().toLowerCase();
  const text = (await res.json()).messages.filter((m) => m.to === address && /verify-email\.html#token=/.test(m.text)).at(-1)?.text;
  const token = text?.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error("no verification link in the server's outbox for the address just registered (AB#2288)");
  return token;
}

/**
 * Bug AB#2326: what the register page says when it refuses, or null while it has not. Its status line reads
 * "Registering corporation credentials..." while the request is in flight, which is not a refusal.
 */
const REGISTER_REFUSALS = "#register-status, #register-email-error, #register-password-error, #register-ceo-error, #register-corp-error";
const IN_FLIGHT = /^Registering corporation credentials/;

/** The error for a refused registration, naming the fix when it is the register limit (AB#2326). */
export function refusedRegistrationError(text) {
  const limit = /too many attempts/i.test(text)
    ? " The register limit (5 an hour) is lifted only when the server runs with NODE_ENV=test: start it as" +
      " ISP_DEV=1 NODE_ENV=test npm run dev (playwright.config.js)."
    : "";
  return new Error(`registration was refused: "${text}".${limit} (AB#2326)`);
}

/** After the register form is submitted: land on "Check your email", verify, and log in through the login page. */
export async function verifyAndLogIn(page, base, email, password) {
  // Bug AB#2326: a refused registration never reaches Check your email. Waiting only for that page turned a refusal
  // the form was already showing into a 150-second timeout that named nothing.
  const sent = page.waitForURL(/\/check-email\.html$/).then(() => null, () => null);
  const refused = page
    .waitForFunction(({ selector, inFlight }) => {
      const said = [...document.querySelectorAll(selector)].map((el) => el.textContent.trim()).find((s) => s && !new RegExp(inFlight).test(s));
      return said || null;
    }, { selector: REGISTER_REFUSALS, inFlight: IN_FLIGHT.source }, { polling: 250 })
    .then((handle) => handle.jsonValue(), () => null);
  const refusal = await Promise.race([sent, refused]);
  if (typeof refusal === "string" && refusal) throw refusedRegistrationError(refusal);
  await page.waitForURL(/\/check-email\.html$/);
  const token = await verificationToken(page.request, base, email);
  const verified = await page.request.post(`${base}/api/auth/verify-email`, { data: { token } });
  if (!verified.ok()) throw new Error(`verifying answered ${verified.status()} (AB#2288)`);
  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click("#credential-login-btn");
}
