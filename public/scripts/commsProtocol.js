// public/scripts/commsProtocol.js: the protocol line for the Comms group (ISP-255c1, AB#4830; docs/design/BUREAUCRATIC_UI.md,
// "Status vocabulary"). public/scripts/protocol.js draws the line and is used as it is; this reads a Comms refusal's
// meaning from what the server said. A refusal is Denied (or Unfunded, protocol.js's rule); a request the server could
// not act on (a 5xx: its message store or chat history unavailable) or that never reached it is Unsuccessful, since
// nothing was decided about it. Pure, so it is unit-tested without a page.
import { escapeHtml } from "./html.js";
import { protocolLineHtml, refusalMeaning } from "./protocol.js";

/** The screens a Comms line is filed under: their codes are CORP-COM-1 to 3 (data/section-codes.json). */
export const COMMS_SCREENS = Object.freeze({ chat: "chat", forums: "forums", inbox: "inbox" });

/**
 * A Comms refusal's meaning: "failed" when the server answered 5xx or said its store was unavailable, or when the request
 * never got an answer (no status); else protocol.js's refusalMeaning ("unfunded" or "refused"). Takes an error from
 * parseJsonResponse (message, status, code), or `{ status, code, error }` from a route read directly.
 */
export function commsMeaning(refusal) {
  const status = Number(refusal?.status);
  const code = refusal?.code;
  if (code === "store-unavailable" || status >= 500) return "failed";
  if (refusal instanceof Error && !Number.isFinite(status)) return "failed"; // never answered: offline, or cut off
  return refusalMeaning(refusal instanceof Error ? refusal : { code, message: refusal?.error ?? refusal?.message });
}

/** The plain words, escaped, then the protocol line; "" for no words (a status cleared). */
export function statusLineHtml(text, protocol) {
  const plain = String(text ?? "");
  return plain ? `${escapeHtml(plain)} ${protocolLineHtml(protocol)}` : "";
}

/** Set a status element's words and protocol line (or clear it). */
export function setStatusLine(el, text, protocol) {
  if (el) el.innerHTML = statusLineHtml(text, protocol);
}
