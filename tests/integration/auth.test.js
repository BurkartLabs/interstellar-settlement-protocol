import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { freshAgent, registerAccount, authed } from "../helpers/api.js";

describe("Auth routes", () => {
  describe("POST /api/auth/register", () => {
    it("creates a new account and returns tokens (201)", async () => {
      const { app } = await getApp();
      const { account, accessToken, refreshToken } = await registerAccount(app);
      expect(account.id).toBeTruthy();
      expect(account.email).toMatch(/@example\.com$/);
      expect(accessToken).toBeTruthy();
      expect(refreshToken).toBeTruthy();
    });

    it("rejects duplicate email with 400", async () => {
      const { app } = await getApp();
      const { body } = await registerAccount(app);
      const res = await freshAgent(app).post("/api/auth/register").send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });

    it("rejects missing fields with 400", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).post("/api/auth/register").send({
        email: "bad@example.com"
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });

    it("rejects too-short password with 400", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).post("/api/auth/register").send({
        email: `short-${Date.now()}@example.com`,
        password: "short",
        ceoName: "Ceo",
        corpName: "Corp"
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid email with 400", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).post("/api/auth/register").send({
        email: "no-at-sign",
        password: "longenough123",
        ceoName: "Ceo",
        corpName: "Corp"
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/auth/login", () => {
    it("returns tokens for correct credentials", async () => {
      const { app } = await getApp();
      const { body } = await registerAccount(app);
      const res = await freshAgent(app).post("/api/auth/login").send({
        email: body.email,
        password: body.password
      });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.body.account.email.toLowerCase()).toBe(body.email.toLowerCase());
    });

    it("returns 401 for wrong password", async () => {
      const { app } = await getApp();
      const { body } = await registerAccount(app);
      const res = await freshAgent(app).post("/api/auth/login").send({
        email: body.email,
        password: "wrong-password-123"
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 for unknown email", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).post("/api/auth/login").send({
        email: `nobody-${Date.now()}@example.com`,
        password: "anything12345"
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/auth/refresh", () => {
    it("rotates a valid refresh token and returns new pair", async () => {
      const { app } = await getApp();
      const { refreshToken } = await registerAccount(app);
      const res = await freshAgent(app).post("/api/auth/refresh").send({ refreshToken });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      // Note: tokens issued in the same second are byte-identical because JWT
      // iat has second resolution. We don't assert non-equality here.
    });

    it("rejects re-use of an already-rotated token (revoked) with 401", async () => {
      const { app } = await getApp();
      const { refreshToken } = await registerAccount(app);
      // Wait past the JWT 1-second iat boundary so the rotated token is a
      // distinct string from the original (otherwise the original gets
      // re-stored as a side-effect of issueTokens producing the same bytes).
      await new Promise((r) => setTimeout(r, 1100));
      const rotated = await freshAgent(app).post("/api/auth/refresh").send({ refreshToken });
      expect(rotated.status).toBe(200);
      expect(rotated.body.refreshToken).not.toBe(refreshToken);
      // Now attempt to re-use the original (revoked) token
      const reuse = await freshAgent(app).post("/api/auth/refresh").send({ refreshToken });
      expect(reuse.status).toBe(401);
    });

    it("rejects missing refresh token with 400", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).post("/api/auth/refresh").send({});
      expect(res.status).toBe(400);
    });

    it("rejects malformed token with 401", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).post("/api/auth/refresh").send({
        refreshToken: "not-a-real-jwt"
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("revokes the supplied refresh token (idempotent 200)", async () => {
      const { app } = await getApp();
      const { account, refreshToken } = await registerAccount(app);
      const r1 = await freshAgent(app).post("/api/auth/logout").send({
        accountId: account.id,
        refreshToken
      });
      expect(r1.status).toBe(200);
      // Subsequent refresh attempt should now fail
      const r2 = await freshAgent(app).post("/api/auth/refresh").send({ refreshToken });
      expect(r2.status).toBe(401);
    });
  });

  describe("GET /api/auth/session", () => {
    it("returns the account for a valid bearer token", async () => {
      const { app } = await getApp();
      const { accessToken, account } = await registerAccount(app);
      const res = await authed(app, accessToken).get("/api/auth/session");
      expect(res.status).toBe(200);
      expect(res.body.account.id).toBe(account.id);
    });

    it("returns 401 with no Authorization header", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).get("/api/auth/session");
      expect(res.status).toBe(401);
    });

    it("returns 401 for a tampered/invalid token", async () => {
      const { app } = await getApp();
      const res = await authed(app, "not.a.real.jwt").get("/api/auth/session");
      expect(res.status).toBe(401);
    });
  });

  describe("Dummy account routes", () => {
    it("POST /api/auth/dummy-login returns tokens when ALLOW_DUMMY_AUTH is on", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).post("/api/auth/dummy-login").send({});
      expect(res.status).toBe(200);
      expect(res.body.account.id).toBe("dummy");
      expect(res.body.accessToken).toBeTruthy();
    });

    it("POST /api/auth/dummy-reset resets the dummy account", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).post("/api/auth/dummy-reset").send({});
      expect(res.status).toBe(200);
      expect(res.body.id).toBe("dummy");
    });
  });

  describe("requireAccountAccess middleware", () => {
    it("rejects requests where the URL accountId does not match the JWT subject (403)", async () => {
      const { app } = await getApp();
      const a = await registerAccount(app);
      const b = await registerAccount(app);
      // Use account A's token to look up account B → must be denied
      const res = await authed(app, a.accessToken).get(
        `/api/accounts/${b.account.id}`
      );
      expect(res.status).toBe(403);
    });

    it("allows the owner to read their own account", async () => {
      const { app } = await getApp();
      const a = await registerAccount(app);
      const res = await authed(app, a.accessToken).get(
        `/api/accounts/${a.account.id}`
      );
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(a.account.id);
    });
  });

  describe("Public data routes", () => {
    it("GET /api/bootstrap returns state with version", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).get("/api/bootstrap");
      expect(res.status).toBe(200);
      expect(res.body.version).toBeDefined();
      expect(res.body.market).toBeDefined();
    });

    it("GET /api/stations returns the station catalog", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).get("/api/stations");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.stations)).toBe(true);
      expect(res.body.stations.length).toBeGreaterThan(0);
    });

    it("GET /api/buildings returns the building catalog", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).get("/api/buildings");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.buildings)).toBe(true);
    });
  });

  describe("POST /api/dev/set-credits", () => {
    it("updates account credits when given a finite number", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).post("/api/dev/set-credits").send({
        accountId: "dummy",
        credits: 1234
      });
      expect(res.status).toBe(200);
      expect(res.body.credits).toBe(1234);
    });

    it("rejects non-numeric credits with 400", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).post("/api/dev/set-credits").send({
        accountId: "dummy",
        credits: "many"
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown account", async () => {
      const { app } = await getApp();
      const res = await freshAgent(app).post("/api/dev/set-credits").send({
        accountId: "nope-not-a-real-account",
        credits: 100
      });
      expect(res.status).toBe(404);
    });
  });
});
