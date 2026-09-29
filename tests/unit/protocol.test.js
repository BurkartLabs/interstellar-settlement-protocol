import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { PROTOCOL, protocolOf, refusalMeaning, protocolLineHtml } from "../../public/scripts/protocol.js";
import { setSectionCodes } from "../../public/scripts/sectionCodes.js";
import { notificationItemsHtml, queueItemsHtml, researchNodeHtml } from "../../public/scripts/html.js";
import { sanitizeNotification, pushSystemNotification } from "../../server/game/progression.js";
import { CONSTRUCTIONS } from "../../server/construction.js";

// ISP-254 (AB#950): the protocol line (public/scripts/protocol.js) says what docs/design/BUREAUCRATIC_UI.md says, beside
// the plain words and never instead of them.
const GUIDE = readFileSync(new URL("../../docs/design/BUREAUCRATIC_UI.md", import.meta.url), "utf8");
const KEY = { Pending: "pending", Queued: "queued", Active: "active", Complete: "complete", Failed: "failed", Expired: "expired", Refused: "refused", "Insufficient funds": "unfunded", Cancelled: "cancelled", Suspended: "suspended", Owed: "owed" };
const REGISTRY = { screens: [{ id: "rnd", code: "CORP-RND-1" }, { id: "refinery", code: "CORP-IND-1" }, { id: "logistics", code: "CORP-LOG-1" }] };

afterEach(() => setSectionCodes(null));

describe("the vocabulary is the guide's (ISP-254, AB#950)", () => {
  const section = GUIDE.slice(GUIDE.indexOf("## Status vocabulary"), GUIDE.indexOf("## Timestamps"));
  const rows = [...section.matchAll(/^\| \*\*([^*]+)\*\* \| ([^|]+) \|/gm)].map((m) => [m[1].trim(), m[2].trim()]);

  it("has one phrase for every row of the guide's status table, worded as the table words it", () => {
    expect(rows.length).toBe(11);
    for (const [plain, protocol] of rows) {
      expect(KEY[plain], `no key for the guide's "${plain}"`).toBeTruthy();
      expect(PROTOCOL[KEY[plain]].toUpperCase(), plain).toBe(protocol);
    }
    expect(Object.keys(PROTOCOL).sort()).toEqual(Object.values(KEY).sort());
  });
});

describe("the protocol line", () => {
  it("is the phrase, then the screen's code, the code aria-hidden", () => {
    setSectionCodes(REGISTRY);
    expect(protocolLineHtml({ meaning: "queued", screen: "rnd" })).toBe('<span class="protocol-line">Lodged<span class="protocol-line__code" aria-hidden="true"> // CORP-RND-1</span></span>');
  });

  it("leaves the code out when the registry has not loaded or does not know the screen, and keeps the phrase", () => {
    expect(protocolLineHtml({ meaning: "refused", screen: "rnd" })).toBe('<span class="protocol-line">Denied</span>');
    setSectionCodes(REGISTRY);
    expect(protocolLineHtml({ meaning: "refused", screen: "nowhere" })).toBe('<span class="protocol-line">Denied</span>');
  });

  it("draws nothing for a meaning the guide does not define, or no protocol at all", () => {
    for (const bad of [null, undefined, {}, { meaning: "celebrated" }, { meaning: "__proto__" }, "queued"]) expect(protocolLineHtml(bad)).toBe("");
  });

  it("accepts only well-formed screen ids, so nothing a client sends reaches a code lookup unchecked", () => {
    expect(protocolOf({ meaning: "active", screen: "refinery" })).toEqual({ meaning: "active", screen: "refinery" });
    expect(protocolOf({ meaning: "active", screen: "<img src=x>" })).toEqual({ meaning: "active" });
    expect(protocolOf({ meaning: "active", screen: "a".repeat(80) })).toEqual({ meaning: "active" });
  });
});

describe("a refusal's meaning", () => {
  it("is Unfunded for the server's insufficient-credits message, and Denied for any other", () => {
    expect(refusalMeaning("Quantum Coherence queueing requires 45,000 credits. Current reserves: 3,120 credits.")).toBe("unfunded");
    expect(refusalMeaning("Refinery construction requires 1 credit. Current reserves: 0 credits. Sell goods first.")).toBe("unfunded");
    expect(refusalMeaning("Not enough Nickel at this station. Need 150 but only have 149.")).toBe("refused");
    expect(refusalMeaning("Transfer failed.")).toBe("refused");
    expect(refusalMeaning(undefined)).toBe("refused");
  });
});

describe("the shared renderers draw a protocol only where their caller asks (the Company group is a later slice)", () => {
  it("a notification's line follows its plain words; one without a protocol is unchanged", () => {
    setSectionCodes(REGISTRY);
    const at = () => "09:42 UTC";
    const withLine = notificationItemsHtml([{ id: "n1", title: "R&D Queued", body: "Quantum Coherence has been queued.", type: "research", createdAt: 1, protocol: { meaning: "queued", screen: "rnd" } }], at, protocolLineHtml);
    expect(withLine).toContain("09:42 UTC | research <span class=\"protocol-line\">Lodged");
    expect(withLine.indexOf("R&amp;D Queued")).toBeLessThan(withLine.indexOf("protocol-line"));
    const plain = notificationItemsHtml([{ id: "n2", title: "Troops Trained", body: "Ready.", type: "infrastructure", createdAt: 1 }], at, protocolLineHtml);
    expect(plain).not.toContain("protocol-line");
  });

  it("a queue item and a research node carry the line only when given one", () => {
    const item = { name: "Quantum Coherence", effect: "Faster runs.", durationHours: 4, costCredits: 100, startedAt: null };
    const base = { progressOf: () => 0, remainingLabel: () => "", formatCredits: String };
    expect(queueItemsHtml([item], "Corporate R&D", base)).not.toContain("protocol-line");
    expect(queueItemsHtml([item], "Corporate R&D", { ...base, protocolOf: () => protocolLineHtml({ meaning: "queued" }) })).toContain('Queued · 100 committed <span class="protocol-line">Lodged</span>');
    expect(researchNodeHtml({ name: "X", tier: 1, effect: "E", state: "done" })).not.toContain("protocol-line");
    expect(researchNodeHtml({ name: "X", tier: 1, effect: "E", state: "done", protocolLine: protocolLineHtml({ meaning: "complete" }) })).toContain("Complete</span> <span class=\"protocol-line\">Concluded");
  });
});

describe("notifications carry a checked protocol from the server", () => {
  it("keeps a valid protocol, and drops one the guide does not define", () => {
    const account = { id: "acc-1" };
    pushSystemNotification(account, { type: "research", title: "R&D Queued", body: "b", protocol: { meaning: "queued", screen: "rnd" } });
    pushSystemNotification(account, { type: "research", title: "Forged", body: "b", protocol: { meaning: "<script>", screen: "rnd" } });
    const [forged, queued] = account.notifications.map(sanitizeNotification);
    expect(queued.protocol).toEqual({ meaning: "queued", screen: "rnd" });
    expect(forged).not.toHaveProperty("protocol");
  });

  it("the Industry buildings' notifications say Concluded on the Refinery screen", () => {
    const industry = Object.values(CONSTRUCTIONS).filter((c) => /Refinery|Synthesis Array/.test(c.notification?.title || ""));
    expect(industry.map((c) => c.notification.title).sort()).toEqual(["Refinery Commissioned", "Refinery Complex Online", "Synthesis Array Commissioned"]);
    for (const c of industry) expect(c.notification.protocol).toEqual({ meaning: "complete", screen: "refinery" });
  });
});
