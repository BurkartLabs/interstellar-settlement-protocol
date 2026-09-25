import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// AB#1752: app.js wrote a milestone list into #milestone-list, a page which had never had that element, so the
// `if (milestones)` null-guard silenced the whole feature instead of erroring. Every literal getElementById target
// in app.js should resolve to a real id somewhere it can run — this is the general form of that one bug.
//
// app.js is loaded by index.html, login.html and register.html alike, and it also renders a great many of its own
// targets into the page at runtime via innerHTML (a lease card, an office form, a travel ETA) — those ids exist as
// `id="..."` literals inside app.js's own template strings, not in any static HTML file. A target counts as real
// if it is a literal id anywhere in the three pages' static markup, or anywhere in app.js's own source (which is
// where a runtime-rendered target's id is written down).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const appJs = read("public/scripts/app.js");
const pages = ["public/index.html", "public/login.html", "public/register.html"].map(read);

const idAttr = /\bid=(["'])([^"']+)\1/g;
const knownIds = new Set([
  ...[...appJs.matchAll(idAttr)].map((m) => m[2]),
  ...pages.flatMap((html) => [...new JSDOM(html).window.document.querySelectorAll("[id]")].map((el) => el.id))
]);

const targets = [...new Set([...appJs.matchAll(/getElementById\((['"])([^'"]+)\1\)/g)].map((m) => m[2]))].sort();

// Found by this test while writing it, not fixed here: each is its own bug so this stays a guard against new
// drift rather than a place old drift hides. Remove an entry once its bug lands, so a fix without a test update
// still turns this test red for anything the fix missed.
const KNOWN_ORPHANED = {
  "login-panel": 1807, "register-panel": 1807, "show-login-btn": 1807,
  "login-dummy-btn": 1807, "login-cancel-btn": 1807, "register-cancel-btn": 1807, // dead pre-page-split toggle
  "mine-cycle-list": 1806 // same shape as this story's own bug, one panel over
};

describe("every getElementById target app.js reads resolves to a real id (AB#1752)", () => {
  it("found at least one target, so this test cannot silently assert nothing", () => {
    expect(targets.length).toBeGreaterThan(50);
  });

  it.each(targets.filter((id) => !(id in KNOWN_ORPHANED)))("#%s exists on a page or in a template app.js renders", (id) => {
    expect(knownIds.has(id), `#${id}`).toBe(true);
  });

  it("the known-orphaned allowlist names only ids that are actually still missing", () => {
    for (const id of Object.keys(KNOWN_ORPHANED)) expect(knownIds.has(id), `#${id} — AB#${KNOWN_ORPHANED[id]} may be fixed; remove it from the allowlist`).toBe(false);
  });
});
