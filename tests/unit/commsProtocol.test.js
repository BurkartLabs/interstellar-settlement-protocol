import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { commsMeaning, statusLineHtml } from "../../public/scripts/commsProtocol.js";
import { setSectionCodes } from "../../public/scripts/sectionCodes.js";

// ISP-255c1 (AB#4830): the Comms group's statuses and refusals (chat, conversations, the Inbox's memoranda, the Forums)
// carry the protocol line after their unchanged plain words. A refusal is Denied; a request the server could not act on
// or that never reached it is Unsuccessful, read from the server's own status and code. docs/ab-4830/strings.md.
const read = (file) => readFileSync(new URL(`../../public/scripts/${file}`, import.meta.url), "utf8");
const LINE = (phrase, code) => `<span class="protocol-line">${phrase}<span class="protocol-line__code" aria-hidden="true"> // ${code}</span></span>`;

afterEach(() => setSectionCodes(null));

describe("a Comms refusal's meaning, from what the server said (AB#4830)", () => {
  it("is Denied for a refusal, Unsuccessful for a 5xx, a store failure or no answer at all", () => {
    expect(commsMeaning({ status: 400, error: "A message needs a body." })).toBe("refused");
    expect(commsMeaning({ status: 429, error: "Too many messages." })).toBe("refused");
    expect(commsMeaning({ status: 503, error: "Messages cannot be sent right now. Nothing was sent; try again shortly." })).toBe("failed");
    expect(commsMeaning({ code: "rate-limited", error: "That is more than 10 lines in 10 seconds." })).toBe("refused");
    expect(commsMeaning({ code: "line-too-long", error: "A chat line is at most 300 characters." })).toBe("refused");
    expect(commsMeaning({ code: "store-unavailable", error: "Chat is unavailable right now." })).toBe("failed");
    expect(commsMeaning(Object.assign(new Error("Thread not found."), { status: 404 }))).toBe("refused");
    expect(commsMeaning(Object.assign(new Error("The forums are unavailable."), { status: 500 }))).toBe("failed");
    expect(commsMeaning(new TypeError("Failed to fetch"))).toBe("failed"); // never answered
  });

  it("keeps protocol.js's Unfunded for a funding refusal", () => {
    expect(commsMeaning(Object.assign(new Error("Posting costs 10 credits."), { status: 409, code: "insufficient-credits" }))).toBe("unfunded");
  });
});

describe("a status line: plain words first, escaped, then the line (AB#4830)", () => {
  it("draws the words and the Inbox's code", () => {
    setSectionCodes({ screens: [{ id: "inbox", code: "CORP-COM-3" }] });
    expect(statusLineHtml("Draft saved.", { meaning: "complete", screen: "inbox" })).toBe(`Draft saved. ${LINE("Concluded", "CORP-COM-3")}`);
    expect(statusLineHtml("<b>x</b> refused", { meaning: "refused", screen: "inbox" })).toMatch(/^&lt;b&gt;x&lt;\/b&gt; refused <span class="protocol-line">Denied/);
  });

  it("draws nothing for no words, so clearing a status clears its line", () => {
    expect(statusLineHtml("", { meaning: "refused", screen: "inbox" })).toBe("");
  });
});

describe("every Comms site passes its protocol (a source check, AB#4830)", () => {
  const cases = [
    ["app.js", 'pushFeedback(refusal.error, "warn", { meaning: commsMeaning(refusal), screen: "chat" })'],
    ["views/comms.js", 'protocolLineHtml({ meaning: state.errorMeaning || "failed", screen: "chat" })'],
    ["views/conversations.js", 'setStatusLine(status, data.error || "The message was not sent.", { meaning: commsMeaning({ status: code, code: data.code, error: data.error }), screen: "inbox" })'],
    ["views/conversations.js", 'protocol: { meaning: commsMeaning({ status, code: data.code, error: data.error }), screen: "inbox" }'],
    ["views/inbox.js", 'pushFeedback("Draft deleted.", "success", { meaning: "cancelled", screen: "inbox" })'],
    ["views/inbox.js", 'setStatusLine(status, "Write a message first.", { meaning: "refused", screen: "inbox" })'],
    ["views/inbox.js", 'setStatusLine(status, "Draft saved.", { meaning: "complete", screen: "inbox" })'],
    ["views/inbox.js", 'setStatusLine(status, picked.error, picked.protocol || { meaning: "refused", screen: "inbox" })'],
    ["views/inbox.js", 'setStatusLine(status, sent.error, sent.protocol || { meaning: "refused", screen: "inbox" })'],
    ["views/forums.js", 'pushFeedback("Sign in to like posts.", "warn", { meaning: "refused", screen: "forums" })'],
    ["views/forums.js", 'pushFeedback(`Like failed: ${err.message}`, "warn", { meaning: commsMeaning(err), screen: "forums" })'],
    ["views/forums.js", 'setStatusLine(statusEl, "Reply cannot be empty.", { meaning: "refused", screen: "forums" })'],
    ["views/forums.js", 'setStatusLine(statusEl, `Failed to post reply: ${err.message}`, { meaning: commsMeaning(err), screen: "forums" })'],
    ["views/forums.js", 'setStatusLine(statusEl, "Category, title, and body are all required.", { meaning: "refused", screen: "forums" })'],
    ["views/forums.js", 'setStatusLine(statusEl, `Failed to post thread: ${err.message}`, { meaning: commsMeaning(err), screen: "forums" })'],
    ["views/forums.js", 'This thread could not be loaded: ${escapeHtml(open.error)} ${protocolLineHtml({ meaning: "failed", screen: "forums" })}'],
    ["views/forums.js", 'The threads could not be loaded: ${escapeHtml(list.error)} ${protocolLineHtml({ meaning: "failed", screen: "forums" })}']
  ];
  it.each(cases)("%s: %s", (file, call) => {
    expect(read(file)).toContain(call);
  });
});
