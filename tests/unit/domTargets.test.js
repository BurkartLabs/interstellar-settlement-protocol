import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// AB#1752: app.js wrote a milestone list into #milestone-list, a page which had never had that element, so the
// `if (milestones)` null-guard silenced the whole feature instead of erroring. Every literal getElementById target
// in app.js should resolve to a real id somewhere it can run — this is the general form of that one bug.
//
// app.js is loaded only by index.html (login.html and register.html have their own login-page.js/register-page.js
// — AB#1807 removed the leftover code that assumed otherwise). It also renders a great many of its own targets into
// the page at runtime via innerHTML (a lease card, an office form, a travel ETA) — those ids exist as `id="..."`
// literals inside app.js's own template strings, not in index.html's static markup. A target counts as real if it
// is a literal id in index.html, or anywhere in app.js's own source (which is where a runtime-rendered target's id
// is written down).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const appJs = read("public/scripts/app.js");
const indexHtml = read("public/index.html");

const idAttr = /\bid=(["'])([^"']+)\1/g;
const knownIds = new Set([
  ...[...appJs.matchAll(idAttr)].map((m) => m[2]),
  ...[...new JSDOM(indexHtml).window.document.querySelectorAll("[id]")].map((el) => el.id)
]);

const targets = [...new Set([...appJs.matchAll(/getElementById\((['"])([^'"]+)\1\)/g)].map((m) => m[2]))].sort();

describe("every getElementById target app.js reads resolves to a real id (AB#1752)", () => {
  it("found at least one target, so this test cannot silently assert nothing", () => {
    expect(targets.length).toBeGreaterThan(50);
  });

  it.each(targets)("#%s exists on index.html or in a template app.js renders", (id) => {
    expect(knownIds.has(id), `#${id}`).toBe(true);
  });
});
