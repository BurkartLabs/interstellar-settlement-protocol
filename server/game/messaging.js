// server/game/messaging.js: part of the game state, split out of server/gameState.js by system (AB#737).

import { SYSTEM_SENDERS, CORPORATION_NAME_MAX_LENGTH } from "../corporationName.js";
import { createId } from "./catalog.js";
import { accountsStore, backfillCorpPublicIds, pushSystemMessage, scheduleAccountsSave } from "./store.js";

// ─── Messaging ───────────────────────────────────────────────────────────────

export const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function purgeExpiredTrash(account) {
  const cutoff = Date.now() - TRASH_TTL_MS;
  account.messages = (account.messages || []).filter(
    (m) => m.folder !== "trash" || Number(m.trashedAt || 0) > cutoff
  );
}

export function listAccountMessages(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  purgeExpiredTrash(account); // time-derived: in memory here, kept by the next write, and purged again if it is not (AB#963)
  // Bug #711: fromId and toAccountId are account ids. They stay in storage but never leave the server: a player's
  // mail names other corporations by publicId.
  return (account.messages || []).map(({ fromId, toAccountId, ...m }) => ({ ...m }));
}

// ─── Mail recipients (Bug #711) ──────────────────────────────────────────────
// Mail was addressed by corporation name and delivered to the first account whose name matched. Names are not unique
// (the registration default made collisions common), so it is now addressed by each corporation's publicId.

/** The name a player's mail is signed with. Never the email address. */
export const senderName = (account) => String(account?.state?.corp?.corporationName || "").trim() || "Unregistered corporation";

/** Bug #754: the longest corporation name there is (register.html's maxlength), so a longer recipient is none. */
// A mail recipient name longer than any corporation name cannot match one (Bug #754); the maximum is Bug #433's.
export const CORP_NAME_MAX_LENGTH = CORPORATION_NAME_MAX_LENGTH;
// Control characters (C0 and DEL). Written with escapes so the source holds no raw control bytes.
export const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
/** A draft's recipient as typed, made safe to keep: control characters removed, trimmed, capped. */
export const draftRecipientName = (value) => String(value || "").replace(CONTROL_CHARACTERS, "").trim().slice(0, CORP_NAME_MAX_LENGTH);

export const corpCard = (account) => {
  const corp = account.state.corp;
  return { publicId: corp.publicId, corporationName: corp.corporationName || "", ceo: corp.ceo || "", location: corp.location || "" };
};

/** Up to `limit` corporations whose name contains `query` (case-insensitive), described without anything private. */
export function findCorporations(query, limit = 10) {
  const wanted = String(query || "").trim().toLowerCase();
  if (!wanted) return [];
  backfillCorpPublicIds();
  return Object.values(accountsStore.accounts || {})
    .filter((a) => String(a?.state?.corp?.corporationName || "").toLowerCase().includes(wanted))
    .slice(0, limit)
    .map(corpCard);
}

/**
 * Who a message goes to: the corporation with publicId `toCorpId`, or - for drafts and older clients - the one
 * corporation named exactly `toCorpName`. Returns { account } or { status, error, candidates? }; nothing is delivered
 * on an error, so an ambiguous name can never reach the wrong player.
 */
export function resolveMailRecipient({ toCorpId, toCorpName } = {}) {
  backfillCorpPublicIds();
  const accounts = Object.values(accountsStore.accounts || {}).filter((a) => a?.state?.corp);
  const id = String(toCorpId || "").trim();
  if (id) {
    const account = accounts.find((a) => a.state.corp.publicId === id);
    return account ? { account } : { status: 404, error: "That corporation no longer exists." };
  }
  const typed = String(toCorpName || "").trim();
  if (!typed) return { status: 400, error: "Recipient corporation is required." };
  // Bug #754: no corporation name is longer than this or contains a control character, so such a name is refused
  // outright rather than truncated into something that might match a real corporation.
  CONTROL_CHARACTERS.lastIndex = 0;
  if (typed.length > CORP_NAME_MAX_LENGTH || CONTROL_CHARACTERS.test(typed)) {
    return { status: 400, error: "That is not a corporation name." };
  }
  const name = typed.toLowerCase();
  const matches = accounts.filter((a) => String(a.state.corp.corporationName || "").trim().toLowerCase() === name);
  if (matches.length === 1) return { account: matches[0] };
  if (!matches.length) return { status: 404, error: "No corporation has that name. Check the spelling: part of a name lists every corporation it matches." }; // Bug #4832: what to do next (ISP-6)
  return {
    status: 409,
    error: `${matches.length} corporations share that name. Choose which one you mean.`,
    candidates: matches.slice(0, 10).map(corpCard)
  };
}

export function markMessageRead(accountId, messageId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  const msg = (account.messages || []).find((m) => m.id === messageId);
  if (!msg) return null;
  if (!msg.readAt) {
    msg.readAt = Date.now();
    scheduleAccountsSave();
  }
  return { ...msg };
}

export function moveMessage(accountId, messageId, folder) {
  const validFolders = ["inbox", "archive", "trash"];
  if (!validFolders.includes(folder)) return null;
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  const msg = (account.messages || []).find((m) => m.id === messageId);
  if (!msg) return null;
  msg.folder = folder;
  if (folder === "trash") msg.trashedAt = Date.now();
  else msg.trashedAt = null;
  scheduleAccountsSave();
  return { ...msg };
}

export function sendPlayerMessage(fromAccountId, { toCorpId, toCorpName, subject, body }) {
  const sender = accountsStore.accounts?.[fromAccountId];
  if (!sender) return { error: "Sender not found." };

  const trimmedSubject = String(subject || "").trim().slice(0, 200) || "(no subject)";
  const trimmedBody = String(body || "").trim().slice(0, 8000);
  if (!trimmedBody) return { status: 400, error: "Message body cannot be empty." };

  // Bug #711: by publicId, or by a name only when exactly one corporation has it. Self-send is still allowed.
  const resolved = resolveMailRecipient({ toCorpId, toCorpName });
  if (!resolved.account) return resolved;
  const recipient = resolved.account;

  const sentAt = Date.now();
  const fromName = senderName(sender); // never the email address (Bug #711)
  const toName = recipient.state?.corp?.corporationName || "";
  const fromCorpId = sender.state?.corp?.publicId || null;
  const recipientCorpId = recipient.state?.corp?.publicId || null;

  // Delivered copy in recipient inbox
  if (!Array.isArray(recipient.messages)) recipient.messages = [];
  recipient.messages.unshift({
    id: createId("msg"),
    fromType: "player",
    fromId: fromAccountId,
    fromName,
    fromCorpId,
    toAccountId: recipient.id,
    toName,
    toCorpId: recipientCorpId,
    subject: trimmedSubject,
    body: trimmedBody,
    sentAt,
    readAt: null,
    folder: "inbox",
    trashedAt: null
  });

  // Sent copy in sender outbox
  if (!Array.isArray(sender.messages)) sender.messages = [];
  sender.messages.unshift({
    id: createId("msg"),
    fromType: "player",
    fromId: fromAccountId,
    fromName,
    fromCorpId,
    toAccountId: recipient.id,
    toName,
    toCorpId: recipientCorpId,
    subject: trimmedSubject,
    body: trimmedBody,
    sentAt,
    readAt: sentAt,
    folder: "sent",
    trashedAt: null
  });

  scheduleAccountsSave();
  // recipientAccountId is for the server alone: the send route uses it to pick the recipient's socket room (Bug #1130)
  // and must never put it in a response or an event (Bug #1134). So is `legacy`: the route copies it into the message's
  // conversation (AB#910), matched to the migration by the same fields.
  return {
    ok: true, toName, recipientAccountId: recipient.id,
    legacy: { fromId: fromAccountId, toAccountId: recipient.id, fromName, sentAt, subject: trimmedSubject, body: trimmedBody }
  };
}

export function saveDraft(accountId, { draftId, toCorpId, toCorpName, subject, body }) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  if (!Array.isArray(account.messages)) account.messages = [];
  // Bug #711: a draft keeps the recipient's publicId, so it is sent to the corporation it was written for.
  const draftCorpId = String(toCorpId || "").trim().slice(0, 64) || null;

  if (draftId) {
    const existing = account.messages.find((m) => m.id === draftId && m.folder === "draft");
    if (existing) {
      existing.toCorpId = draftCorpId;
      existing.toCorpName = draftRecipientName(toCorpName); // Bug #754: capped, no control characters
      existing.subject = String(subject || "").trim().slice(0, 200);
      existing.body = String(body || "").trim().slice(0, 8000);
      existing.updatedAt = Date.now();
      scheduleAccountsSave();
      return { ...existing };
    }
  }

  const draft = {
    id: createId("msg"),
    fromType: "player",
    fromId: accountId,
    fromName: senderName(account),
    toAccountId: null,
    toCorpId: draftCorpId,
    toCorpName: draftRecipientName(toCorpName), // Bug #754: capped, no control characters
    toName: "",
    subject: String(subject || "").trim().slice(0, 200),
    body: String(body || "").trim().slice(0, 8000),
    sentAt: Date.now(),
    readAt: Date.now(),
    folder: "draft",
    trashedAt: null
  };
  account.messages.unshift(draft);
  scheduleAccountsSave();
  return { ...draft };
}

export function deleteDraft(accountId, draftId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return false;
  const before = (account.messages || []).length;
  account.messages = (account.messages || []).filter((m) => !(m.id === draftId && m.folder === "draft"));
  if (account.messages.length !== before) {
    scheduleAccountsSave();
    return true;
  }
  return false;
}

export function addSystemMessageToAccount(accountId, { subject, body, fromName = SYSTEM_SENDERS.SYSTEM }) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  pushSystemMessage(account, { subject, body, fromName });
  scheduleAccountsSave();
  return (account.messages || [])[0];
}

