// server/routes/conversations.js: private messages between corporations (AB#910, docs/design/messaging.md).
//
// Every route is under /api/accounts/:accountId, so requireAuth and requireAccountAccess have run (index.js) and
// req.auth.accountId is the caller. The sender is always that account: nothing in the body can name another one.
// Free text to any corporation, with no filter, block, report or moderation (Board: AB#707, AB#696). The limits are the
// server's: body size (413), page size (capped), and the per-sender rate limiters (429 with Retry-After).
import {
  conversationExists, listConversationMessages, listConversations, markConversationRead, messageView, sendConversationMessage
} from "../game/conversations.js";
import { resolveMailRecipient } from "../game/messaging.js";
import { emitToAccount } from "../realtime.js";
import { messageHourLimiter, messageMinuteLimiter, newConversationLimiter } from "../rateLimiters.js";

/** Run an express-rate-limit middleware here; true when it let the request through, false when it answered 429. */
function passes(limiter, req, res) {
  return new Promise((resolve, reject) => {
    const result = limiter(req, res, (error) => (error ? reject(error) : resolve(true)));
    Promise.resolve(result).then(() => { if (res.headersSent) resolve(false); }, reject);
  });
}

const refuse = (res, result) => res.status(result.status || 400).json({ error: result.error });

export function registerConversationRoutes(app) {
  app.get("/api/accounts/:accountId/conversations", (req, res) => {
    const page = listConversations(req.auth.accountId, { cursor: req.query?.cursor, limit: req.query?.limit, archived: req.query?.archived === "1" });
    if (page.error) return refuse(res, page);
    res.json(page);
  });

  app.post("/api/accounts/:accountId/conversations/send", messageMinuteLimiter, messageHourLimiter, async (req, res, next) => {
    try {
      const from = req.auth.accountId; // never req.body.from*: the sender is the token's account
      const toCorpId = typeof req.body?.toCorpId === "string" ? req.body.toCorpId.trim() : "";
      const recipient = toCorpId && toCorpId.length <= 64 ? resolveMailRecipient({ toCorpId }).account : null;
      // Only a first message to a corporation counts against the new-conversation limit.
      if (recipient && !conversationExists(from, recipient.id) && !(await passes(newConversationLimiter, req, res))) return;
      const result = sendConversationMessage(from, { toCorpId, body: req.body?.body });
      if (result.error) return refuse(res, result);
      // Stored first, then delivered: to the recipient's own room and the sender's (their other tabs), never io.emit.
      // The event names corporations by publicId; no account id goes in it (Bug #1134).
      emitToAccount(result.recipientAccountId, "conversations:new", { conversationId: result.conversationId, message: messageView(result.message, result.recipientAccountId) });
      if (result.recipientAccountId !== from) emitToAccount(from, "conversations:new", { conversationId: result.conversationId, message: messageView(result.message, from) });
      res.status(201).json({ conversationId: result.conversationId, message: messageView(result.message, from) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/accounts/:accountId/conversations/:conversationId/messages", (req, res) => {
    const page = listConversationMessages(req.auth.accountId, req.params.conversationId, { cursor: req.query?.cursor, limit: req.query?.limit });
    if (page.error) return refuse(res, page);
    res.json(page);
  });

  app.post("/api/accounts/:accountId/conversations/:conversationId/read", (req, res) => {
    const result = markConversationRead(req.auth.accountId, req.params.conversationId);
    if (result.error) return refuse(res, result);
    res.json(result);
  });
}
