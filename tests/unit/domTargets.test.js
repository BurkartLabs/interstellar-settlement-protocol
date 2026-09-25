import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { clientSources } from "../helpers/clientSource.js";

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
const indexHtml = read("public/index.html");

// AB#738: app.js is split into modules it imports (the dialogue card, the walkthrough), and their targets are as much
// the page's as app.js's own. Scanning app.js alone silently dropped 16 of them, so this reads every module app.js
// reaches through its imports, and a module added by a later split is covered without editing this file. AB#739 moved
// the walk to tests/helpers/clientSource.js and taught it "../" imports, which the tab modules in views/ use.
const sources = clientSources("public/scripts/app.js");
const appJs = [...sources.values()].join("\n");

const idAttr = /\bid=(["'])([^"']+)\1/g;
// An element a module builds itself (starmap.js's station modal: `overlay.id = "starmap-station-modal"`).
const idAssigned = /\.id\s*=\s*(["'])([^"']+)\1/g;
const knownIds = new Set([
  ...[...appJs.matchAll(idAttr)].map((m) => m[2]),
  ...[...appJs.matchAll(idAssigned)].map((m) => m[2]),
  ...[...new JSDOM(indexHtml).window.document.querySelectorAll("[id]")].map((el) => el.id)
]);

const targets = [...new Set([...appJs.matchAll(/getElementById\((['"])([^'"]+)\1\)/g)].map((m) => m[2]))].sort();

describe("every getElementById target app.js reads resolves to a real id (AB#1752)", () => {
  it("found at least one target, so this test cannot silently assert nothing", () => {
    expect(targets.length).toBeGreaterThan(50);
  });

  it("reads the modules app.js imports, not app.js alone (AB#738)", () => {
    for (const f of ["state.js", "apiClient.js", "helpers.js", "dialogue.js", "walkthroughUi.js"]) {
      expect([...sources.keys()], f).toContain(`public/scripts/${f}`);
    }
    expect(targets).toEqual(expect.arrayContaining(["dialogue-modal", "walkthrough-modal", "walkthrough-progress"]));
  });

  it("reads every tab module in views/, and what they import from the folder above (AB#739)", () => {
    const views = fs.readdirSync(path.join(ROOT, "public/scripts/views")).filter((f) => f.endsWith(".js"));
    expect(views.length).toBeGreaterThan(10);
    for (const f of views) expect([...sources.keys()], f).toContain(`public/scripts/views/${f}`);
    // Imported only by a tab module, through "../": missed if the walk followed "./" alone.
    expect([...sources.keys()]).toContain("public/scripts/exchangeView.js");
    expect(targets).toEqual(expect.arrayContaining(["exchange-buy-table", "forum-threads", "inbox-detail-subject"]));
  });

  it.each(targets)("#%s exists on index.html or in a template app.js renders", (id) => {
    expect(knownIds.has(id), `#${id}`).toBe(true);
  });
});
