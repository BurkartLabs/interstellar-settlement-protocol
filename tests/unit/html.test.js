import { describe, it, expect } from "vitest";
import { escapeHtml, notificationItemsHtml } from "../../public/scripts/html.js";

// Bug #691: a notification's title, body and type reached innerHTML unescaped.
describe("notificationItemsHtml (Bug #691)", () => {
  const formatTime = () => "12:00";
  const item = (over = {}) => ({ id: "n1", title: "Mining Lease Approved", body: "Approved.", type: "administration", createdAt: 0, ...over });

  it("renders markup in any field as text", () => {
    const html = notificationItemsHtml([item({
      title: "<b>t</b>", body: "<img src=x onerror=alert(1)>", type: "<svg onload=alert(2)>", id: "\"><script>alert(3)</script>"
    })], formatTime);
    expect(html).not.toMatch(/<img|<svg|<script|<b>/);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;svg onload=alert(2)&gt;");
  });

  it("still renders an ordinary notification, unread marked", () => {
    const html = notificationItemsHtml([item()], formatTime);
    expect(html).toContain('<p class="ui-card__title">Mining Lease Approved</p>');
    expect(html).toContain("notifications__item is-unread"); // ISP-83 (AB#772): a design-system card
    expect(html).toContain("12:00 | administration");
  });

  it("escapes the five characters that matter", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});
