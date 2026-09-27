// Bug #4691: takes stale entries off data/design-allowlist.json, one entry per stale occurrence the design check
// reports (scripts/design-check.mjs). A story that fixes its screens runs this, then the check, before its PR, so the
// list only shrinks and never fails on main for a fix that already landed. It never adds an entry.
//
// Usage: node scripts/design-allowlist-prune.mjs   (prints how many it took off)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { designCheck } from "./design-check.mjs";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "design-allowlist.json");
const list = JSON.parse(fs.readFileSync(FILE, "utf8"));
const { stale } = designCheck(undefined, list);
const drop = new Map();
for (const e of stale) drop.set(`${e.file}|${e.key}`, (drop.get(`${e.file}|${e.key}`) || 0) + 1);
// The last entries of a key go first: the check spends an entry's room in list order, so the stale ones are the last.
const keep = [];
for (const e of [...list.entries].reverse()) {
  const k = `${e.file}|${e.key}`;
  if (drop.get(k) > 0) { drop.set(k, drop.get(k) - 1); continue; }
  keep.unshift(e);
}
const eol = fs.readFileSync(FILE, "utf8").includes("\r\n") ? "\r\n" : "\n";
fs.writeFileSync(FILE, JSON.stringify({ ...list, entries: keep }, null, 2).replace(/\n/g, eol) + eol);
console.log(`[design-allowlist-prune] took ${list.entries.length - keep.length} stale entr${list.entries.length - keep.length === 1 ? "y" : "ies"} off; ${keep.length} left.`);
