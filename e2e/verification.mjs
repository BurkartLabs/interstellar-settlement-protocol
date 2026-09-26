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

/** After the register form is submitted: land on "Check your email", verify, and log in through the login page. */
export async function verifyAndLogIn(page, base, email, password) {
  await page.waitForURL(/\/check-email\.html$/);
  const token = await verificationToken(page.request, base, email);
  const verified = await page.request.post(`${base}/api/auth/verify-email`, { data: { token } });
  if (!verified.ok()) throw new Error(`verifying answered ${verified.status()} (AB#2288)`);
  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click("#credential-login-btn");
}
