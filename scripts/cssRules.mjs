// Bug #4839: public/styles.css as a list of rules, for scripts/landing-css.mjs (which extracts the landing's) and the
// test that holds the extract to its source. Plain CSS only, which is all the stylesheet is: comments, strings,
// nested grouping at-rules (@media, @supports, @container, @layer) and leaf blocks. @font-face, @keyframes and the like
// are kept whole, as one leaf. No dependency: the project has no CSS parser of its own.
const GROUPING = /^@(media|supports|container|layer|document)\b/i;

/**
 * Every leaf rule: { context: the grouping at-rule preludes around it, outermost first; prelude: its selector or
 * at-rule; body: the text between its braces; start, end: its offsets in `css` (prelude start to closing brace) }.
 */
export function cssRules(css) {
  const rules = [];
  const n = css.length;
  let i = 0;
  const skipComment = () => { const end = css.indexOf("*/", i + 2); i = end < 0 ? n : end + 2; };
  const skipString = (q) => { i += 1; while (i < n && css[i] !== q) i += css[i] === "\\" ? 2 : 1; i += 1; };
  /** From i at a "{", past its matching "}". */
  const skipBlock = () => {
    let depth = 0;
    while (i < n) {
      const c = css[i];
      if (c === "/" && css[i + 1] === "*") { skipComment(); continue; }
      if (c === '"' || c === "'") { skipString(c); continue; }
      if (c === "{") depth += 1;
      if (c === "}") { depth -= 1; if (depth === 0) { i += 1; return; } }
      i += 1;
    }
  };
  const walk = (context, stopAtBrace) => {
    while (i < n) {
      while (i < n && /\s/.test(css[i])) i += 1;
      if (i >= n) return;
      if (css[i] === "/" && css[i + 1] === "*") { skipComment(); continue; }
      if (css[i] === "}") { if (stopAtBrace) { i += 1; return; } i += 1; continue; }
      const start = i;
      // the prelude runs to the first "{" or ";" outside strings and comments
      while (i < n && css[i] !== "{" && css[i] !== ";") {
        if (css[i] === "/" && css[i + 1] === "*") { skipComment(); continue; }
        if (css[i] === '"' || css[i] === "'") { skipString(css[i]); continue; }
        i += 1;
      }
      if (i >= n) return;
      const prelude = css.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
      if (css[i] === ";") { i += 1; continue; } // @import, @charset: no block
      if (GROUPING.test(prelude)) { i += 1; walk([...context, prelude], true); continue; }
      const open = i;
      skipBlock();
      rules.push({ context, prelude, body: css.slice(open + 1, i - 1), start, end: i });
    }
  };
  walk([], false);
  return rules;
}

/** A rule's identity for comparison: context, prelude and declarations, whitespace and comments folded. */
export function ruleKey(rule) {
  const body = rule.body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{};:,])\s*/g, "$1").replace(/;}/g, "}").replace(/;$/, "").trim();
  return `${rule.context.join(" ▸ ")} ▸ ${rule.prelude} { ${body} }`;
}

/** The rules back as a stylesheet, each grouping at-rule written around the run of rules that share it. */
export function writeRules(rules) {
  const out = [];
  let open = [];
  for (const r of rules) {
    let same = 0;
    while (same < open.length && same < r.context.length && open[same] === r.context[same]) same += 1;
    for (let k = open.length - 1; k >= same; k -= 1) out.push(`${"  ".repeat(k)}}`);
    for (let k = same; k < r.context.length; k += 1) out.push(`${"  ".repeat(k)}${r.context[k]} {`);
    open = r.context;
    const pad = "  ".repeat(r.context.length);
    const body = r.body.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => `${pad}  ${l}`).join("\n");
    out.push(`${pad}${r.prelude} {\n${body}\n${pad}}`);
  }
  for (let k = open.length - 1; k >= 0; k -= 1) out.push(`${"  ".repeat(k)}}`);
  return `${out.join("\n")}\n`;
}
