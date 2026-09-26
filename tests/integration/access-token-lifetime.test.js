import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, refreshCookieOf } from "../helpers/api.js";

// AB#2294: an access token lives 30 minutes, not 7 days. A session held open past that keeps working through the
// refresh cookie (AB#757), which lives 30 days as before.
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

afterEach(() => vi.useRealTimers());

async function signedIn() {
  const { app } = await getApp();
  const player = await registerAccount(app);
  const call = (token) => request(app).get(`/api/accounts/${player.account.id}`).set("Authorization", `Bearer ${token}`);
  const refresh = (cookie) => request(app).post("/api/auth/refresh").set("Cookie", `isp_refresh=${encodeURIComponent(cookie)}`);
  return { ...player, call, refresh };
}

/** Move the clock, Date only, as the JWT checks read it. */
function later(ms) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + ms);
}

describe("the access token lives 30 minutes (AB#2294)", () => {
  it("a login's access token expires 30 minutes out; its refresh token, 30 days out as before", async () => {
    const before = Date.now();
    const { accessTokenExpiresAt, refreshTokenExpiresAt } = await signedIn();
    expect(accessTokenExpiresAt - before).toBeGreaterThanOrEqual(30 * MINUTE);
    expect(accessTokenExpiresAt - before).toBeLessThan(30 * MINUTE + 10_000);
    expect(refreshTokenExpiresAt - before).toBeGreaterThanOrEqual(30 * DAY);
    expect(refreshTokenExpiresAt - before).toBeLessThan(30 * DAY + 10_000);
  });

  it("is still good at 29 minutes and refused at 31", async () => {
    const { accessToken, call } = await signedIn();
    later(29 * MINUTE);
    expect((await call(accessToken)).status).toBe(200);
    later(2 * MINUTE);
    expect((await call(accessToken)).status).toBe(401);
  });

  it("a session held open past the expiry keeps working: the 401 is answered by a refresh, with no login", async () => {
    const { accessToken, refreshToken, call, refresh } = await signedIn();
    expect((await call(accessToken)).status).toBe(200);
    later(31 * MINUTE);
    expect((await call(accessToken)).status).toBe(401);
    const renewed = await refresh(refreshToken);
    expect(renewed.status).toBe(200);
    expect(renewed.body.accessTokenExpiresAt - Date.now()).toBeGreaterThan(29 * MINUTE);
    expect((await call(renewed.body.accessToken)).status).toBe(200);
    // And again, half an hour on, from the cookie that refresh rotated to.
    later(31 * MINUTE);
    const again = await refresh(refreshCookieOf(renewed));
    expect(again.status).toBe(200);
    expect((await call(again.body.accessToken)).status).toBe(200);
  });
});
