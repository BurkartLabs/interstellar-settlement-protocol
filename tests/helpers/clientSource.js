// AB#739: public/scripts/app.js is split into a module per tab (public/scripts/views/) plus the shared modules AB#738
// moved out. A source check that read app.js as "the client's code" reads all of it now — reading app.js alone would
// leave a scan for something passing on a file the code has left, checking nothing. The client-side counterpart of
// serverSource.js.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

/**
 * Every module the entry reaches through relative imports ("./x.js", "../x.js"), keyed by repo-relative path, the
 * entry first. A module a later split adds is covered without editing any test. Bug #4836: a dynamic import("./x.js")
 * is followed too, since index.html's entry (scripts/boot.js) reaches the whole game through one, and a scan that
 * stopped at it would check the landing and nothing else.
 */
export function clientSources(entry = "public/scripts/app.js") {
  const seen = new Map();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    const text = read(rel);
    seen.set(rel, text);
    const specs = [
      ...[...text.matchAll(/(?:^|\n)\s*import\s[^;]*?["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]),
      ...[...text.matchAll(/\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)].map((m) => m[1])
    ];
    for (const spec of specs) visit(path.posix.join(path.posix.dirname(rel), spec));
  };
  visit(entry);
  return seen;
}

/** All of the client's code app.js loads, as one string (CRLF read as LF), for scans that look anywhere in it. */
export function clientCode(entry = "public/scripts/app.js") {
  return [...clientSources(entry).values()].join("\n").replace(/\r\n/g, "\n");
}
