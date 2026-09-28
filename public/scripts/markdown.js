// ISP (AB#2467): a message body's Markdown, as HTML that is safe to put in innerHTML. A player writes these, so the
// text is an attacker's (DOCTRINE, security first). No HTML the writer typed survives, however it is spelled.
//
// It is a small renderer on purpose, with no library and no sanitiser pass after the fact. Every piece of the writer's
// text that reaches the output goes through escapeHtml as it is emitted (AB#1002's rule: never interpolate a string
// that was not escaped), and the only tags are the ones written here: p, br, strong, em, code, ul, ol, li and a.
// A link is emitted only when the URL parses as http, https or mailto (new URL, the browser's own parser, so no
// spelling of "javascript:" gets through). Any other link stays as the text that was typed.
//
// What it reads:
//   **bold** or __bold__     *italic* or _italic_ (an underscore inside a word is a character, not emphasis)
//   `code`                   [label](https://example.com)
//   - item, * item, + item   1. item or 1) item          a blank line starts a paragraph; a line break is kept
import { escapeHtml } from "./html.js";

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** The URL as an href when it is http, https or mailto, else null. Normalised by the parser (quotes become %22). */
export function safeHref(raw) {
  const text = String(raw ?? "").trim();
  if (!text || /[\u0000-\u001f\u007f\s]/.test(text)) return null;
  // Absolute URLs only: a relative one has no scheme to check, and nothing in a message needs to point inside the game.
  if (!/^(https?:\/\/|mailto:)/i.test(text)) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
}

// The inline rules, tried leftmost first. Each pattern's text is raw; what it emits is built from escaped parts.
const INLINE = [
  { re: /`([^`\n]+)`/y, html: (m) => `<code>${escapeHtml(m[1])}</code>` },
  {
    re: /\[([^\]\n]+)\]\(([^()\s]+)\)/y,
    html: (m) => {
      const href = safeHref(m[2]);
      // A refused link is the text that was typed, inert: the reader sees what the writer wrote.
      if (!href) return escapeHtml(m[0]);
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${inlineHtml(m[1])}</a>`;
    }
  },
  { re: /\*\*(?=\S)([^\n]*?\S)\*\*/y, html: (m) => `<strong>${inlineHtml(m[1])}</strong>` },
  { re: /__(?=\S)([^\n]*?\S)__(?![A-Za-z0-9])/y, html: (m, before) => /[A-Za-z0-9]$/.test(before) ? null : `<strong>${inlineHtml(m[1])}</strong>` },
  { re: /\*(?=\S)([^*\n]*?\S)\*/y, html: (m) => `<em>${inlineHtml(m[1])}</em>` },
  { re: /_(?=\S)([^_\n]*?\S)_(?![A-Za-z0-9])/y, html: (m, before) => /[A-Za-z0-9]$/.test(before) ? null : `<em>${inlineHtml(m[1])}</em>` }
];

/** One line's inline Markdown as HTML. */
export function inlineHtml(text) {
  const src = String(text ?? "");
  let out = "";
  let plain = "";
  let i = 0;
  while (i < src.length) {
    let matched = false;
    if ("`[*_".includes(src[i])) {
      for (const rule of INLINE) {
        rule.re.lastIndex = i;
        const m = rule.re.exec(src);
        if (!m) continue;
        const html = rule.html(m, src.slice(0, i));
        if (html === null) continue;
        out += escapeHtml(plain) + html;
        plain = "";
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) { plain += src[i]; i += 1; }
  }
  return out + escapeHtml(plain);
}

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;

/** A message body's Markdown as block HTML: paragraphs (line breaks kept), bulleted and numbered lists. */
export function markdownHtml(text) {
  const blocks = [];
  for (const line of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const last = blocks.at(-1);
    const bullet = line.match(BULLET);
    const numbered = !bullet && line.match(NUMBERED);
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const item = bullet ? bullet[1] : numbered[2];
      if (last?.kind === kind) last.lines.push(item);
      else blocks.push({ kind, lines: [item], start: numbered ? Number(numbered[1]) : 1 });
    } else if (!line.trim()) {
      blocks.push({ kind: "gap" });
    } else if (last?.kind === "p") {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "p", lines: [line] });
    }
  }
  return blocks.map((b) => {
    if (b.kind === "gap") return "";
    if (b.kind === "p") return `<p>${b.lines.map(inlineHtml).join("<br>")}</p>`;
    const items = b.lines.map((l) => `<li>${inlineHtml(l)}</li>`).join("");
    return b.kind === "ol" ? `<ol${b.start !== 1 ? ` start="${b.start}"` : ""}>${items}</ol>` : `<ul>${items}</ul>`;
  }).join("");
}
