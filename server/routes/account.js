// server/routes/account.js: the account routes, split out of server/index.js (AB#1815).
import { addAccountNotification, getAccountById, getStatements, listAccountNotifications, markAllNotificationsRead, markNotificationRead, markWalkthroughCompleted, resetWalkthroughCompletion } from "../gameState.js";
import { emitToAccount } from "../realtime.js";
import { checkDeletion, eraseAccount, exportAccountData } from "../accountData.js"; // ISP-264 (AB#960)
import { deleteAccountLimiter, exportDataLimiter } from "../rateLimiters.js";

/** ISP-264 (AB#960): why a deletion was refused. Every refusal changes nothing. */
const DELETION_REFUSALS = {
  "not-confirmed": "Type DELETE to confirm. Nothing was deleted.",
  "wrong-password": "That password is not correct. Nothing was deleted.",
  "no-account": "Account not found."
};

export function registerAccountRoutes(app) {
  // ISP-264 (AB#960; GDPR Article 20): everything held about the account, as a JSON file for its owner only (behind
  // requireAuth and requireAccountAccess like every /api/accounts/:accountId route), never stored by a cache.
  app.get("/api/accounts/:accountId/export", exportDataLimiter, (req, res) => {
    const data = exportAccountData(req.params.accountId);
    if (!data) { res.status(404).json({ error: "Account not found." }); return; }
    const day = data.exportedAt.slice(0, 10);
    res.set({ "Cache-Control": "no-store, private", Pragma: "no-cache", "Content-Disposition": `attachment; filename="isp-account-data-${day}.json"` });
    res.type("application/json").send(JSON.stringify(data, null, 2));
  });

  // ISP-264 (AB#960; GDPR Article 17): delete the account, with its password and the word DELETE. Limited per account
  // like a login, so the password cannot be guessed here faster than there. All or nothing (server/accountData.js).
  app.post("/api/accounts/:accountId/delete-account", deleteAccountLimiter, (req, res) => {
    const checked = checkDeletion(req.params.accountId, req.body || {});
    if (!checked.ok) {
      res.status(checked.outcome === "no-account" ? 404 : 400).json({ error: DELETION_REFUSALS[checked.outcome] });
      return;
    }
    try {
      eraseAccount(req.params.accountId);
    } catch (error) {
      console.error("[account] deletion failed and was rolled back:", error?.message || error);
      res.status(500).json({ error: "The account could not be deleted just now, and nothing was changed. Try again." });
      return;
    }
    // the refresh cookie's token is already gone from the server; the browser's copy goes too
    res.cookie("isp_refresh", "", { httpOnly: true, secure: true, sameSite: "strict", path: "/api/auth", maxAge: 0 });
    res.json({ deleted: true });
  });

  app.get("/api/accounts/:accountId", (req, res) => {
    const account = getAccountById(req.params.accountId);
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    res.json(account);
  });

  // AB#713: the corporation's daily statements (P&L, cash flow, balance sheet), newest first. Under requireAuth and
  // requireAccountAccess like the rest of /api/accounts/:accountId, so only the owner reads them. The one input is ?days=,
  // clamped to 1..90; anything that is not a number is refused.
  app.get("/api/accounts/:accountId/finances/statements", (req, res) => {
    let days = 90;
    if (req.query.days !== undefined) {
      const raw = Array.isArray(req.query.days) ? null : String(req.query.days).trim();
      const n = raw === null || raw === "" ? NaN : Number(raw);
      if (!Number.isFinite(n)) {
        res.status(400).json({ error: "days must be a number from 1 to 90." });
        return;
      }
      days = Math.max(1, Math.min(90, Math.floor(n)));
    }
    const result = getStatements(req.params.accountId, days);
    if (!result) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    res.json({ accountId: req.params.accountId, days, ...result });
  });

  app.post("/api/accounts/:accountId/walkthrough-complete", (req, res) => {
    const account = markWalkthroughCompleted(req.params.accountId);
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "onboarding",
      title: "Walkthrough Completed",
      body: "Onboarding has been marked complete for this profile."
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    res.json(account);
  });

  app.post("/api/accounts/:accountId/walkthrough-reset", (req, res) => {
    const account = resetWalkthroughCompletion(req.params.accountId);
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    const notification = addAccountNotification(req.params.accountId, {
      type: "onboarding",
      title: "Walkthrough Reset",
      body: "Onboarding flow has been reset and can be replayed."
    });
    if (notification) {
      emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
    }

    res.json(account);
  });

  app.get("/api/accounts/:accountId/notifications", (req, res) => {
    const payload = listAccountNotifications(req.params.accountId);
    if (!payload) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    res.json(payload);
  });

  app.post("/api/accounts/:accountId/notifications/:notificationId/read", (req, res) => {
    const updated = markNotificationRead(req.params.accountId, req.params.notificationId);
    if (!updated) {
      res.status(404).json({ error: "Notification not found." });
      return;
    }

    res.json({ notification: updated });
  });

  app.post("/api/accounts/:accountId/notifications/read-all", (req, res) => {
    const payload = markAllNotificationsRead(req.params.accountId);
    if (!payload) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    res.json(payload);
  });
}
