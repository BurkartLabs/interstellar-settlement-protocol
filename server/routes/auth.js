// server/routes/auth.js: the auth routes, split out of server/index.js (AB#1815).
import jwt from "jsonwebtoken";
import { loginIpLimiter, loginAccountLimiter, registerLimiter, refreshLimiter } from "../rateLimiters.js";
import { createAccount, authenticateAccount, getAccountById, getDummyAccount, hasRefreshToken, revokeRefreshToken, resetDummyAccountProgress } from "../gameState.js";
import { DEV_SURFACE } from "../app.js";
import { issueTokens, JWT_SECRET, requireAuth } from "../auth.js";

export function registerAuthRoutes(app) {
  app.post("/api/auth/register", registerLimiter, async (req, res) => {
    try {
      const { email, password, ceoName, corpName } = req.body ?? {};
      const result = await createAccount({ email, password, ceoName, corpName });

      if (result.error) {
        // ISP-66: `field` names which input the register page shows the message beside.
        res.status(400).json({ error: result.error, ...(result.code ? { code: result.code } : {}), ...(result.field ? { field: result.field } : {}) });
        return;
      }

      const account = result.account;
      const tokens = issueTokens(account.id);
      res.status(201).json({ account, ...tokens });
    } catch (error) {
      console.error("[auth/register]", error);
      res.status(500).json({ error: "Registering failed on our side. Try again in a minute." });
    }
  });

  if (DEV_SURFACE) {
    app.post("/api/auth/dummy-login", (_req, res) => {
      const account = getDummyAccount();
      const tokens = issueTokens(account.id);
      res.json({ account, ...tokens });
    });

    app.post("/api/auth/dummy-reset", (_req, res) => {
      const account = resetDummyAccountProgress();
      if (!account) {
        res.status(404).json({ error: "Dummy account not found." });
        return;
      }

      res.json(account);
    });
  }

  // POST /api/dev/set-credits is gone (Bug #423): it set any corporation's balance for anyone, and a credit-granting
  // route has no safe form in a shared economy. Tests set credits through gameState's mutateAccountState.

  app.post("/api/auth/login", loginIpLimiter, loginAccountLimiter, async (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      const account = await authenticateAccount(email, password);

      if (!account) {
        res.status(401).json({ error: "Invalid account credentials." });
        return;
      }

      const tokens = issueTokens(account.id);
      res.json({ account, ...tokens });
    } catch (error) {
      console.error("[auth/login]", error);
      res.status(500).json({ error: "Logging in failed on our side. Try again in a minute." });
    }
  });

  app.post("/api/auth/refresh", refreshLimiter, (req, res) => {
    const token = String(req.body?.refreshToken || "").trim();
    if (!token) {
      res.status(400).json({ error: "Refresh token is required." });
      return;
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.kind !== "refresh") {
        res.status(401).json({ error: "Invalid token type." });
        return;
      }

      if (!hasRefreshToken(payload.sub, token)) {
        res.status(401).json({ error: "Refresh token has been revoked." });
        return;
      }

      revokeRefreshToken(payload.sub, token);
      const tokens = issueTokens(payload.sub);
      const account = getAccountById(payload.sub);
      res.json({ account, ...tokens });
    } catch {
      res.status(401).json({ error: "Invalid or expired refresh token." });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = String(req.body?.refreshToken || "").trim();
    const accountId = String(req.body?.accountId || "").trim();
    if (token && accountId) {
      revokeRefreshToken(accountId, token);
    }
    res.json({ ok: true });
  });

  app.get("/api/auth/session", requireAuth, (req, res) => {
    const account = getAccountById(req.auth.accountId);
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    res.json({ account });
  });
}
