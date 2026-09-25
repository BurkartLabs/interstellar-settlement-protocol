// server/routes/auth.js: the auth routes, split out of server/index.js (AB#1815).
import jwt from "jsonwebtoken";
import { loginIpLimiter, loginAccountLimiter, registerLimiter, refreshLimiter } from "../rateLimiters.js";
import { createAccount, authenticateAccount, getAccountById, getDummyAccount, hasRefreshToken, revokeRefreshToken, resetDummyAccountProgress } from "../gameState.js";
import { DEV_SURFACE } from "../app.js";
import { issueTokens, JWT_SECRET, requireAuth, sendSession, clearRefreshCookie, readRefreshCookie } from "../auth.js";

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
      sendSession(res, 201, account, issueTokens(account.id));
    } catch (error) {
      console.error("[auth/register]", error);
      res.status(500).json({ error: "Registering failed on our side. Try again in a minute." });
    }
  });

  if (DEV_SURFACE) {
    app.post("/api/auth/dummy-login", (_req, res) => {
      const account = getDummyAccount();
      sendSession(res, 200, account, issueTokens(account.id));
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

      sendSession(res, 200, account, issueTokens(account.id));
    } catch (error) {
      console.error("[auth/login]", error);
      res.status(500).json({ error: "Logging in failed on our side. Try again in a minute." });
    }
  });

  // AB#757: the refresh token is read from the isp_refresh cookie only; one in the body is ignored. Every refusal
  // clears the cookie, so a dead token is not sent again on every page load.
  app.post("/api/auth/refresh", refreshLimiter, (req, res) => {
    const refuse = (error) => {
      clearRefreshCookie(res);
      res.status(401).json({ error });
    };
    const token = readRefreshCookie(req);
    if (!token) {
      refuse("Not signed in.");
      return;
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.kind !== "refresh") {
        refuse("Invalid token type.");
        return;
      }

      if (!hasRefreshToken(payload.sub, token)) {
        refuse("Refresh token has been revoked.");
        return;
      }

      const account = getAccountById(payload.sub);
      if (!account) {
        refuse("Account not found.");
        return;
      }

      revokeRefreshToken(payload.sub, token);
      sendSession(res, 200, account, issueTokens(payload.sub));
    } catch {
      refuse("Invalid or expired refresh token.");
    }
  });

  // AB#757: logout revokes the token in the caller's own cookie, and nothing named in a body: before, anyone who
  // knew an account id and a refresh token could revoke it unauthenticated. Without the cookie it revokes nothing.
  app.post("/api/auth/logout", (req, res) => {
    const token = readRefreshCookie(req);
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
        if (payload.kind === "refresh") revokeRefreshToken(payload.sub, token);
      } catch {
        // A token this server never signed revokes nothing.
      }
    }
    clearRefreshCookie(res);
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
