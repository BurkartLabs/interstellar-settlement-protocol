import { describe, it, expect } from "vitest";
import { messageListItemsHtml } from "../../public/scripts/html.js";

// Bug #754: the Drafts list put a draft's recipient name into innerHTML unescaped. On the shared dummy account a
// draft addressed to "<img onerror=...>" ran script in every later visitor's browser.
describe("messageListItemsHtml (Bug #754)", () => {
  const date = () => "21 Sep";
  const draft = (over = {}) => ({ id: "msg-1", folder: "draft", toCorpName: "Frontier Protocol Ventures", subject: "Terms", sentAt: 0, readAt: 1, ...over });

  it("renders a draft's recipient as text, and its id as an escaped attribute", () => {
    const html = messageListItemsHtml([draft({ toCorpName: "<img src=x onerror=window.__x=1>", id: "\"><script>alert(1)</script>" })], date);
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain("To: &lt;img src=x onerror=window.__x=1&gt;");
  });

  it("escapes every field a message row shows: sender, subject, recipient", () => {
    const html = messageListItemsHtml([
      { id: "m2", folder: "inbox", fromName: "<b>Evil</b>", subject: "<svg onload=alert(2)>", sentAt: 0, readAt: null },
      draft({ subject: "<i>x</i>" })
    ], date);
    expect(html).not.toMatch(/<b>|<svg|<i>/);
    expect(html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
  });

  it("still renders ordinary rows, unread dot and all", () => {
    const html = messageListItemsHtml([
      { id: "m3", folder: "inbox", fromName: "ISA System", subject: "Welcome", sentAt: 0, readAt: null },
      draft({ toCorpName: "" })
    ], date);
    expect(html).toContain('class="inbox-msg-item unread" data-msg-id="m3"');
    expect(html).toContain('<span class="inbox-unread-dot"></span>');
    expect(html).toContain("To: (no recipient)");
    expect(html).toContain('<span class="inbox-msg-date">21 Sep</span>');
  });
});
