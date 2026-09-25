// server/routes/account.js: the account routes, split out of server/index.js (AB#1815).
import { addAccountNotification, getAccountById, getStatements, listAccountNotifications, markAllNotificationsRead, markNotificationRead, markWalkthroughCompleted, resetWalkthroughCompletion } from "../gameState.js";
import { emitToAccount } from "../realtime.js";

export function registerAccountRoutes(app) {
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
