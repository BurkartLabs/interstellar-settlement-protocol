// AB#995 (ISP-288): older chat history, a page at a time. state:init sends each channel's last 50 lines; this reads
// further back from the channel's history file (server/game/chatHistory.js). The channel is resolved the way chat:send
// resolves it, so a player reads global, trade and their own system's local channel, and no other system's.
import { requireAuth } from "../auth.js";
import { getAccountById, getState } from "../gameState.js";
import { resolveChatChannel } from "../realtime.js";
import { chatHistoryPage } from "../game/chatHistory.js";

export function registerChatRoutes(app) {
  app.get("/api/chat/:channel/history", requireAuth, (req, res) => {
    const corp = getAccountById(req.auth.accountId)?.state?.corp;
    const channel = corp ? resolveChatChannel(req.params.channel, corp) : null;
    if (!channel) {
      res.status(404).json({ error: "No such chat channel." });
      return;
    }
    let page;
    try {
      page = chatHistoryPage(channel, { cursor: req.query.cursor, limit: req.query.limit, seed: getState().chatLog?.[channel] });
    } catch {
      res.status(503).json({ error: "Chat history is unavailable right now. Try again in a minute." });
      return;
    }
    if (page.status) {
      res.status(page.status).json({ error: page.error });
      return;
    }
    res.json(page);
  });
}
