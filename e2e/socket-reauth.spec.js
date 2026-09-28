// Bug AB#2154: after starting a mining cycle, the lease view's "Mined this cycle" sometimes never left 0. The figure
// comes from mining:updated, which the server sends only to sockets in the account's room. A page's socket sends its
// CONNECT before the page has a token (it refreshes one from its cookie as it loads, AB#757), and when the refresh
// finished before the server answered, nothing reconnected the socket: it stayed anonymous, outside the room, for the
// rest of the session. This forces that race by holding the CONNECT for 1.5 s, and counts the per-account updates the
// page then receives (the mining tick sends one to every account every 5 s). Run against a server you started:
// BASE_URL=http://127.0.0.1:<port> npx playwright test e2e/socket-reauth.spec.js
import { test, expect } from "@playwright/test";
import { verifyAndLogIn } from "./verification.mjs";

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function signIn(page, label) {
  const email = `socket-reauth-${label}-${stamp}@example.test`;
  const password = "playtest-password-not-real";
  await page.goto("/register.html");
  await page.fill("#register-email", email);
  await page.fill("#register-password", password);
  await page.fill("#register-ceo", "Reauth CEO");
  await page.fill("#register-corp", `Reauth Corp ${label} ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", email, password);
  await page.waitForURL(/\/\?account=/);
}

/** The mining:updated frames the page receives in `ms` after reloading it. */
async function updatesAfterReload(page, ms) {
  let n = 0;
  page.on("websocket", (ws) => ws.on("framereceived", (f) => { if (String(f.payload).startsWith('42["mining:updated"')) n += 1; }));
  await page.reload();
  await page.waitForTimeout(ms);
  return n;
}

for (const late of [false, true]) {
  test(`the page receives its account's updates after a reload${late ? ", when its socket's CONNECT is answered after the token refresh" : ""}`, async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, late ? "late" : "plain");
    if (late) {
      await page.route("**/socket.io/**", async (route) => {
        const r = route.request();
        if (r.method() === "POST" && /(^|\u001e)40/.test(r.postData() || "")) await new Promise((res) => setTimeout(res, 1500));
        await route.continue();
      });
    }
    expect(await updatesAfterReload(page, 15_000)).toBeGreaterThan(0);
  });
}
