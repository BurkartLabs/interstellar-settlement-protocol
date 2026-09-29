// public/scripts/protocol.js: the bureaucratic voice's protocol line (ISP-254, AB#950; docs/design/BUREAUCRATIC_UI.md,
// "Status vocabulary"). The guide's first rule is that the plain words always stay, so the protocol phrase is added
// beside a plain status or message, never in its place: the plain words first, then the phrase, then the screen's
// document code. The phrase is visible text a screen reader hears after the plain words; the code is aria-hidden, like
// every code (the guide's accessibility rule), and is left out when the registry has not loaded. The plain messages,
// server errors included, are not rewritten: that keeps ISP-6's rule (an error says what to do next) where it already
// holds. Pure, so the server loads PROTOCOL and protocolOf to check a notification's protocol before storing it.

import { escapeHtml } from "./html.js";
import { codeOf } from "./sectionCodes.js";

/** Each plain meaning's protocol phrase, as the guide's table words it (written in sentence case; CSS sets the caps). */
export const PROTOCOL = {
  pending: "Filed, awaiting review",
  queued: "Lodged",
  active: "In force",
  complete: "Concluded",
  failed: "Unsuccessful",
  expired: "Lapsed",
  refused: "Denied",
  unfunded: "Unfunded, balance insufficient",
  cancelled: "Withdrawn",
  suspended: "Suspended",
  owed: "In arrears"
};

const SCREEN = /^[a-z][a-z0-9-]{1,40}$/;

/** `{ meaning, screen }` when the meaning is one the guide defines and the screen id is well formed, else null. */
export function protocolOf(value) {
  if (!value || typeof value !== "object" || !Object.hasOwn(PROTOCOL, value.meaning)) return null;
  return SCREEN.test(String(value.screen || "")) ? { meaning: value.meaning, screen: value.screen } : { meaning: value.meaning };
}

/**
 * A refusal's meaning: "unfunded" when the server refused only for want of credits, else "refused". Every such refusal
 * is written by one function (fundingRequirementMessage, server/routes/helpers.js): "<action> requires N credits.
 * Current reserves: M credits."
 */
export function refusalMeaning(message) {
  return /requires [\d,]+ credits?\..*Current reserves:/s.test(String(message || "")) ? "unfunded" : "refused";
}

/** The protocol line as markup: `<span class="protocol-line">Lodged // CORP-RND-1</span>`, or "" for no protocol. */
export function protocolLineHtml(protocol) {
  const p = protocolOf(protocol);
  if (!p) return "";
  const code = p.screen ? codeOf(p.screen) : "";
  return `<span class="protocol-line">${escapeHtml(PROTOCOL[p.meaning])}${code ? `<span class="protocol-line__code" aria-hidden="true"> // ${escapeHtml(code)}</span>` : ""}</span>`;
}
