// server/realtime.js: socket.io: rooms, the auth boundary, per-account and global emits, and chat, split out of server/index.js (AB#1815).
import { marketView } from "./marketView.js";
import { postView } from "./publicViews.js";
import { threadSummary } from "./forumPages.js"; // AB#995
import { publicSystems } from "./catalogView.js"; // Bug #2355
import { appendChatMessage, getAccountById, getState } from "./gameState.js";
// Bug #1260: notifications made inside gameState (a level reached) reach the account's own sockets as every other
// notification does, as notifications:new, so the badge and the list update without a reload.
import { onAccountNotification } from "./gameState.js";
import { io } from "./app.js";
import { verifyAccessToken } from "./auth.js";
import { chatLineGate } from "./rateLimiters.js"; // AB#995
import { appendChatLine } from "./game/chatHistory.js"; // AB#995
import { conglomerateRoomsFor, isMemberAccount, onConglomerateEvent } from "./game/membership.js"; // ISP-198 (AB#892)

/** Characters in one chat line: the chat input's maxlength (Bug #1127). */
const CHAT_MAX_LENGTH = 300;

function stripHtml(input) {
  return String(input || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// Bug #710: a socket carries the same access token as the HTTP API (socket.handshake.auth.token). Anyone may still
// connect to read public state, but only a verified socket may chat, and the server decides who is speaking.
/** The socket.io room for one account's sockets. */
function accountRoom(accountId) {
  return `account:${accountId}`;
}

/**
 * Re-verify the token a socket connected with. A socket that authenticated once and is still in its account room but
 * whose token has since expired is dropped back to anonymous here rather than kept signed in for the life of the
 * connection: it leaves the room, loses socket.data.accountId, and is told "auth:expired" so the page can refresh its
 * token and reconnect (ISP-67). A socket that was never authenticated is left alone. Returns the account id still
 * good for this socket, or undefined.
 */
function checkSocketAuth(socket) {
  const verified = verifyAccessToken(socket.data.token);
  if (verified.accountId) return verified.accountId;
  if (socket.data.accountId) {
    socket.leave(accountRoom(socket.data.accountId));
    socket.data.accountId = undefined;
    socket.emit("auth:expired");
  }
  return undefined;
}

/**
 * Send an event about one account to that account's sockets only (Bug #1021: these used to be io.emit broadcasts, so
 * every connected client received every corporation's finances, mining, inventory and notification text). Global
 * events (market, forums, chat) still use io.emit; tests/integration/socket-rooms.test.js checks there are no others.
 * Each member's token is re-checked before delivery (ISP-67), so a room a socket never formally left because it
 * disconnected loses nothing, but one that just expired stops hearing this account the moment there is something to
 * hear.
 */
function emitToAccount(accountId, event, payload) {
  if (!accountId) return;
  const room = io.sockets.adapter.rooms.get(accountRoom(accountId));
  if (!room) return;
  for (const socketId of [...room]) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && checkSocketAuth(socket) === accountId) socket.emit(event, payload);
  }
}

/**
 * Send the market to every connected socket as that socket's account should see it: the newest orders plus its own
 * (Bug #425: the book is never cut, so what is sent is capped here instead). The viewer is re-verified through
 * checkSocketAuth (Bug #1766), not read off socket.data.accountId directly: a socket whose token expired since
 * connecting kept seeing "this is your own listing" highlighting for its last-known account until some other
 * per-account event happened to re-check it first.
 */
function emitMarketUpdated() {
  const market = getState().market;
  for (const peer of io.of("/").sockets.values()) peer.emit("market:updated", marketView(market, checkSocketAuth(peer)));
}

/**
 * AB#2331: tell every connected socket that these belt slots emptied or filled, so an open belt panel refetches what
 * its account may see of them (GET .../gameplay/belt-compositions). Only the keys go out: which belts, not whose.
 */
function emitBeltsChanged(keys) {
  if (!keys?.length) return;
  for (const peer of io.of("/").sockets.values()) peer.emit("belts:changed", { keys });
}

/**
 * AB#995: what changed in the forums, to every connected socket as its account should see it (no account ids, Bug
 * #1134): `kind` "thread" (a new thread), "reply" (a new reply, in `reply`) or "like" (the thread, and `reply` when a
 * reply was liked), with the thread's summary. It used to send every thread and every reply on each post; clients now
 * page the rest (docs/design/messaging.md "Live delivery"). The viewer is re-verified through checkSocketAuth (Bug #1766).
 */
function emitForumsUpdated(kind, thread, reply = null) {
  for (const peer of io.of("/").sockets.values()) {
    const viewer = checkSocketAuth(peer);
    peer.emit("forums:updated", { kind, thread: threadSummary(thread, viewer), ...(reply ? { reply: postView(reply, viewer) } : {}) });
  }
}

/** The shared state as `viewer` (an account id, or null) should see it: the bootstrap and a socket's state:init. */
function sharedStateView(viewer) {
  // Bug #2355: the belt state (AB#2329) and the catalog's belt contents stay on the server; a player's scouted belts
  // come from GET .../belt-compositions.
  const { belts, ...state } = getState();
  const world = state.world ? { ...state.world, systems: publicSystems(state.world.systems) } : state.world;
  // AB#995: the forums' categories only; threads and replies are read a page at a time (GET /api/forums/threads)
  return { ...state, world, market: marketView(state.market, viewer), forums: { categories: state.forums?.categories || [] } };
}

/** The chat channels anyone may post to. "private" is gone: it was a public broadcast wearing the name (D-0.12-1). */
const PUBLIC_CHAT_CHANNELS = new Set(["global", "trade"]);

/**
 * Where a message goes, decided by the server: "global" and "trade" as asked; "local" (or "local:<own system>") is the
 * sender's current system as the server knows it. Anything else, including another system's local channel, is null.
 */
export function resolveChatChannel(requested, corp) {
  if (typeof requested !== "string") return null;
  if (PUBLIC_CHAT_CHANNELS.has(requested)) return requested;
  const home = `local:${corp?.currentSystemId || "sol"}`;
  if (requested === "local" || requested === home) return home;
  return null;
}

/** The socket.io room for one conglomerate's members (ISP-198, AB#892). */
function conglomerateRoom(conglomerateId) {
  return `cong:${conglomerateId}`;
}

/**
 * A membership event (server/game/membership.js): the joining account's sockets enter the conglomerate's room and the
 * leaving account's leave it, then the event goes to every socket in the room whose account is still a member (checked
 * now, not when it joined) and to the affected accounts' own sockets, once each. A socket of any other account hears
 * nothing.
 */
function deliverConglomerateEvent({ conglomerateId, event, payload, accounts = [], join = [], leave = [] }) {
  const room = conglomerateRoom(conglomerateId);
  const socketsOf = (accountId) => [...(io.sockets.adapter.rooms.get(accountRoom(accountId)) || [])].map((id) => io.sockets.sockets.get(id)).filter(Boolean);
  for (const accountId of join) for (const socket of socketsOf(accountId)) socket.join(room);
  for (const accountId of leave) for (const socket of socketsOf(accountId)) socket.leave(room);
  const sent = new Set();
  for (const socketId of [...(io.sockets.adapter.rooms.get(room) || [])]) {
    const socket = io.sockets.sockets.get(socketId);
    const accountId = socket && checkSocketAuth(socket);
    if (!accountId || !isMemberAccount(accountId, conglomerateId)) { socket?.leave(room); continue; }
    socket.emit(event, payload);
    sent.add(socketId);
  }
  for (const accountId of accounts) {
    for (const socket of socketsOf(accountId)) {
      if (sent.has(socket.id) || checkSocketAuth(socket) !== accountId) continue;
      socket.emit(event, payload);
      sent.add(socket.id);
    }
  }
}

export function registerRealtime() {
  onConglomerateEvent(deliverConglomerateEvent);
  onAccountNotification((accountId, notification) => emitToAccount(accountId, "notifications:new", { accountId, notification }));

  io.use((socket, next) => {
    // The raw token is kept, not just its verdict, so checkSocketAuth can re-verify it later against the clock it is
    // checked at rather than the clock it connected at (ISP-67).
    socket.data.token = socket.handshake.auth?.token;
    const verified = verifyAccessToken(socket.data.token);
    if (verified.accountId) socket.data.accountId = verified.accountId;
    next();
  });

  io.on("connection", (socket) => {
    // Bug #1021: an authenticated socket joins its account's room, so per-account events reach only its owner.
    if (socket.data.accountId) socket.join(accountRoom(socket.data.accountId));
    // ISP-198 (AB#892): and its conglomerate's room, if its corporation is a member of one.
    if (socket.data.accountId) for (const id of conglomerateRoomsFor(socket.data.accountId)) socket.join(conglomerateRoom(id));
    socket.emit("state:init", sharedStateView(socket.data.accountId || null));

    socket.on("chat:send", (payload) => {
      // Fail closed: no verified account, no account, no allowed channel or no content means nothing is stored or sent.
      // Re-checked here rather than read off socket.data (ISP-67): a token good at connect time can have expired since.
      const accountId = checkSocketAuth(socket);
      if (!accountId) return;
      const corp = getAccountById(accountId)?.state?.corp;
      if (!corp) return;
      const channel = resolveChatChannel(payload?.channel, corp);
      if (!channel) return;
      // Bug #1127: kept as typed (the client renders it as text; stripping tags garbled "10 < price < 30"), and at most
      // CHAT_MAX_LENGTH characters, the chat box's own limit: a longer line is dropped like an empty one.
      const content = typeof payload?.content === "string" ? payload.content.trim() : "";
      if (!content) return;
      // AB#995: the server's limits, said out loud to the sender rather than a line silently lost. Size and rate only:
      // nothing reads what the line says (D-0.5-4, AB#696).
      const refuse = (error, extra = {}) => socket.emit("chat:refused", { channel, error, ...extra });
      if (content.length > CHAT_MAX_LENGTH) return refuse(`A chat line is at most ${CHAT_MAX_LENGTH} characters.`);
      const gate = chatLineGate(accountId);
      if (!gate.ok) return refuse(`That is more than ${gate.limit} lines in ${gate.windowSeconds} seconds. Try again in ${gate.retryAfterSeconds} seconds.`, { retryAfterSeconds: gate.retryAfterSeconds });

      // The author is the sender's own corporation; payload.author is ignored. No account id goes in the broadcast.
      const message = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        channel,
        author: stripHtml(corp.corporationName || "") || "Unnamed Corporation",
        content,
        createdAt: Date.now()
      };

      // AB#995: stored in the channel's history file first; a line that cannot be stored is not sent
      try { appendChatLine(message, getState().chatLog?.[channel]); } catch { return refuse("Chat is unavailable right now. Try again in a minute."); }
      appendChatMessage(channel, message);
      if (channel.startsWith("local:")) {
        // Local chat reaches the corporations in that system now, read at send time so travel needs no bookkeeping.
        // The recipient is re-verified through checkSocketAuth (Bug #1766), not read off socket.data.accountId
        // directly: a socket whose token expired since connecting kept receiving its last-known system's local
        // chat until some other per-account event happened to re-check it first.
        const systemId = channel.slice("local:".length);
        for (const peer of io.of("/").sockets.values()) {
          const peerAccountId = checkSocketAuth(peer);
          const peerCorp = peerAccountId ? getAccountById(peerAccountId)?.state?.corp : null;
          if (peerCorp && (peerCorp.currentSystemId || "sol") === systemId) peer.emit("chat:new", message);
        }
      } else {
        io.emit("chat:new", message);
      }
    });

    socket.on("disconnect", () => {
      // Placeholder for future presence tracking and local system channel cleanup.
    });
  });
}

export { emitBeltsChanged, emitMarketUpdated, emitToAccount, sharedStateView, emitForumsUpdated };
