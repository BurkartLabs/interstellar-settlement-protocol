// server/routes/messaging.js: the messaging routes, split out of server/index.js (AB#1815).
import { listAccountMessages, markMessageRead, moveMessage, sendPlayerMessage, findCorporations, saveDraft, deleteDraft } from "../gameState.js";
import { emitToAccount } from "../realtime.js";
import { recordLegacyMessage } from "../game/conversations.js";
import { messageMinuteLimiter, messageHourLimiter } from "../rateLimiters.js";

export function registerMessagingRoutes(app) {
  // ─── Messages ────────────────────────────────────────────────────────────────

  app.get("/api/accounts/:accountId/messages", (req, res) => {
    const messages = listAccountMessages(req.params.accountId);
    if (!messages) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    res.json({ messages });
  });

  // Bug #711: find a mail recipient. Behind requireAuth + requireAccountAccess (the /api/accounts/:accountId mount), and
  // it returns only what a sender needs to tell same-named corporations apart - never an account id or an email.
  app.get("/api/accounts/:accountId/corporations", (req, res) => {
    const name = typeof req.query?.name === "string" ? req.query.name.trim() : "";
    if (!name || name.length > 64) {
      res.status(400).json({ error: "Give between 1 and 64 characters of a corporation name." });
      return;
    }
    res.json({ corporations: findCorporations(name, 10) });
  });

  // Specific named routes FIRST (before :messageId wildcards)
  app.post("/api/accounts/:accountId/messages/send", messageMinuteLimiter, messageHourLimiter, (req, res) => {
    const { toCorpId, toCorpName, subject, body } = req.body ?? {};
    const result = sendPlayerMessage(req.params.accountId, {
      toCorpId: String(toCorpId || "").trim().slice(0, 64),
      toCorpName: String(toCorpName || "").trim().slice(0, 200),
      subject: String(subject || "").trim(),
      body: String(body || "").trim()
    });
    if (result.error) {
      // 404 no such corporation, 409 a name several share (with the candidates to choose from), 400 otherwise.
      res.status(result.status || 400).json({ error: result.error, ...(result.candidates ? { candidates: result.candidates } : {}) });
      return;
    }
    // AB#910: the same message goes into its conversation too, so conversations are complete from now on.
    recordLegacyMessage(result.legacy);
    // Delete the draft if a draftId was provided
    if (req.body?.draftId) {
      deleteDraft(req.params.accountId, String(req.body.draftId));
    }
    const messages = listAccountMessages(req.params.accountId);
    // Bug #1130: tell the recipient's open sessions, so their Inbox and its unread count refresh without a reload. The
    // account room keeps the event to that account's own sockets; the payload carries no ids (Bug #1134).
    emitToAccount(result.recipientAccountId, "messages:new", {});
    res.json({ ok: true, toName: result.toName, messages });
  });

  app.post("/api/accounts/:accountId/messages/draft", (req, res) => {
    const { draftId, toCorpId, toCorpName, subject, body } = req.body ?? {};
    const draft = saveDraft(req.params.accountId, {
      draftId: draftId ? String(draftId).trim() : null,
      toCorpId: String(toCorpId || "").trim(),
      toCorpName: String(toCorpName || "").trim(),
      subject: String(subject || "").trim(),
      body: String(body || "").trim()
    });
    if (!draft) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    res.json({ draft });
  });

  app.delete("/api/accounts/:accountId/messages/draft/:draftId", (req, res) => {
    const deleted = deleteDraft(req.params.accountId, req.params.draftId);
    res.json({ ok: deleted });
  });

  // Parameterised routes AFTER named routes
  app.post("/api/accounts/:accountId/messages/:messageId/read", (req, res) => {
    const msg = markMessageRead(req.params.accountId, req.params.messageId);
    if (!msg) {
      res.status(404).json({ error: "Message not found." });
      return;
    }
    res.json({ message: msg });
  });

  app.post("/api/accounts/:accountId/messages/:messageId/move", (req, res) => {
    const folder = String(req.body?.folder || "").trim();
    const msg = moveMessage(req.params.accountId, req.params.messageId, folder);
    if (!msg) {
      res.status(400).json({ error: "Invalid folder or message not found." });
      return;
    }
    res.json({ message: msg });
  });
}
