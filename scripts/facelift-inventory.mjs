// ISP-245 (AB#941): from scripts/facelift-sweep.mjs's screenshots and findings, the contact sheets (one per width,
// every screen's first screenful, and one at 1280 of the screens with their v0.6-v0.13 records in them) and the
// inventory, docs/design/FACELIFT_INVENTORY.md. Run by `npm run look:facelift` after the sweep; alone:
//   node scripts/facelift-inventory.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "e2e", "screenshots", "ab-941");
const OUT = path.join(ROOT, "docs", "ab-941");
const INVENTORY = path.join(ROOT, "docs", "design", "FACELIFT_INVENTORY.md");
const WIDTHS = [375, 768, 1280];
const results = JSON.parse(fs.readFileSync(path.join(SHOTS, "inventory.json"), "utf8"));

/**
 * Each screen's group and the version that added it, from the work item that built it (its AB# in the markup or the
 * view's header, and that item's version tag in Azure DevOps). A screen split into subpages by the Board's review of
 * 2026-09-26 (AB#2468 to AB#2474) was added in v1.0 as a subpage; what is on it may be older, and is said so.
 */
const PRE = "≤ v0.5 (on the system since ISP-26)";
const META = [
  [/^page-/, "Before play", PRE],
  [/^shell$/, "Shell", "v0.5 (ISP-74, ISP-83)"],
  [/^overview$/, "Company", PRE],
  [/^inbox$/, "Company", PRE],
  [/^inbox--/, "Company", "v0.12 (conversations, AB#910)"],
  [/^finance$/, "Company", PRE],
  [/^finance--/, "Company", "v1.0 subpage (AB#2470); statements v0.8 (AB#714), rating v0.9 (ISP-148)"],
  [/^ceo$/, "Company", PRE],
  [/^missions$/, "Company", PRE],
  [/^conglomerate$/, "Company", "v0.12 (ISP-200)"],
  [/^conglomerate--treasury$/, "Company", "v0.12 (ISP-204)"],
  [/^conglomerate--hangar$/, "Company", "v0.12 (ISP-205)"],
  [/^conglomerate--station$/, "Company", "v0.12 (ISP-213)"],
  [/^conglomerate--/, "Company", "v0.12"],
  [/^station$/, "Station", PRE],
  [/^station--construction$/, "Station", "v1.0 subpage (AB#2471); the panel v0.6 (ISP-95)"],
  [/^station--/, "Station", "v1.0 subpage (AB#2471)"],
  [/^operations/, "Station", "v1.0 (AB#2471)"],
  [/^fleet/, "Station", "v0.10 (ISP-175)"],
  [/^building-conglomerate-affairs-bureau$/, "Station building", "v0.12 (ISP-200)"],
  [/^building-corporate-registry-charters$/, "Station building", "v0.13 (ISP-237, the patent office)"],
  [/^building-deep-space-development-bank$/, "Station building", "v0.9 (ISP-151)"],
  [/^building-earth-assembly$/, "Station building", "v0.13 (ISP-240, lobbying)"],
  [/^building-galactic-arbitration-council$/, "Station building", "v0.13 (ISP-243)"],
  [/^building-intergalactic-stock-exchange$/, "Station building", "v0.9 (ISP-161)"],
  [/^building-interplanetary-trade-commission$/, "Station building", "v0.13 (ISP-233, ISP-240)"],
  [/^building-isa-claims-leases$/, "Station building", `${PRE}; concessions v0.13 (ISP-229)`],
  [/^building-/, "Station building", PRE],
  [/^facility-/, "Station building", `${PRE}; upgrades v0.6 (ISP-103)`],
  [/^rnd$/, "Industry", PRE],
  [/^refinery$/, "Industry", `${PRE}; Tier 4 v0.11 (ISP-189)`],
  [/^logistics$/, "Industry", PRE],
  [/^market$/, "Market", PRE],
  [/^market--players$/, "Market", "v1.0 subpage (AB#2472); buy orders v0.6 (AB#1054)"],
  [/^market--mercs$/, "Market", "v1.0 subpage (AB#2472); mercenaries v0.10 (ISP-176)"],
  [/^market--/, "Market", "v1.0 subpage (AB#2472)"],
  [/^assets/, "Market", PRE],
  [/^chat/, "Comms", PRE],
  [/^forums/, "Comms", PRE],
  [/^starmap$/, "Map", `${PRE}; overlays v0.12-v0.13 (ISP-218, ISP-229)`],
  [/^travel$/, "Map", PRE]
];
const metaOf = (screen) => META.find(([re]) => re.test(screen)) || [null, "Other", "unknown"];
const GROUPS = ["Before play", "Shell", "Company", "Station", "Station building", "Industry", "Market", "Comms", "Map", "Other"];
const screens = Object.keys(results).sort((a, b) => GROUPS.indexOf(metaOf(a)[1]) - GROUPS.indexOf(metaOf(b)[1]) || a.localeCompare(b));

// ─── the contact sheets ──────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
// the sheet is a page beside the screenshots that names them, so hundreds of thumbnails load as files, not as one huge page
const img = (file) => encodeURI(file);
async function shootSheet(html, file) {
  const at = path.join(SHOTS, `sheet-${file.replace(/\.png$/, "")}.html`);
  fs.writeFileSync(at, html);
  await page.goto(`file:///${at.replace(/\\/g, "/")}`, { waitUntil: "load" });
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
}
function sheetHtml(title, cells, thumbW, thumbH) {
  return `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 16px; background: #10151c; color: #e6edf3; font: 13px system-ui, sans-serif; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, ${thumbW}px); gap: 12px; }
    figure { margin: 0; } figcaption { margin-top: 4px; word-break: break-all; }
    .t { width: ${thumbW}px; height: ${thumbH}px; background-size: 100% auto; background-repeat: no-repeat; background-position: top; border: 1px solid #334; }
  </style><h1>${title}</h1><div class="grid">${cells.map(([name, file]) => `<figure><div class="t" style="background-image:url(${img(file)})"></div><figcaption>${name}</figcaption></figure>`).join("")}</div>`;
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const sheets = [];
for (const w of WIDTHS) {
  const cells = screens.filter((s) => results[s][w]?.base).map((s) => [s, results[s][w].base.view || results[s][w].base.shot]);
  const [tw, th] = w === 375 ? [150, 324] : w === 768 ? [192, 256] : [256, 160];
  const file = `contact-${w}.png`;
  await shootSheet(sheetHtml(`ISP facelift inventory (AB#941): ${cells.length} screens at ${w}px, first screenful each`, cells, tw, th), file);
  sheets.push([w, cells.length, file]);
}
// one sheet per seed with v0.6-v0.13 records, at 1280
const sources = [...new Set(screens.flatMap((s) => Object.keys(results[s][1280] || {})))].filter((x) => x !== "base");
for (const source of sources) {
  const cells = screens.filter((s) => results[s][1280]?.[source]).map((s) => [s, results[s][1280][source].view || results[s][1280][source].shot]);
  const file = `contact-1280-${source}.png`;
  await shootSheet(sheetHtml(`The same screens with ${source}'s records, at 1280px: ${cells.length} screens`, cells, 256, 160), file);
  sheets.push([`1280 with ${source}'s records`, cells.length, file]);
}
await browser.close();

// ─── the inventory ───────────────────────────────────────────────────────────
const uniq = (xs) => [...new Set(xs)];
/** A control built from one of the system's components counts as on it: a <button> that is a .ui-card--interactive is. */
const realComponent = (c) => !(/^a <button> without \.ui-button: button[^:]*\.ui-/.test(c));
const cell = (xs, max = 4) => (xs.length ? `${xs.slice(0, max).map((x) => `\`${x.replace(/\|/g, "\\|").replace(/`/g, "'")}\``).join("<br>")}${xs.length > max ? `<br>and ${xs.length - max} more` : ""}` : "");
const rows = screens.map((s) => {
  const [, group, version] = metaOf(s);
  const all = Object.entries(results[s]).flatMap(([w, bySource]) => Object.entries(bySource).map(([source, r]) => ({ w, source, ...r })));
  const tokens = uniq(all.flatMap((r) => r.offSystem.tokens.map((t) => t.replace(/\s*\{.*$/, ""))));
  const components = uniq(all.flatMap((r) => r.offSystem.components.filter(realComponent).map((c) => c.replace(/:.*$/, ""))));
  const componentsWhere = uniq(all.flatMap((r) => r.offSystem.components.filter(realComponent).map((c) => c.replace(/^[^:]*:\s*/, ""))));
  const inline = uniq(all.flatMap((r) => r.offSystem.inline));
  const defects = uniq(all.flatMap((r) => r.findings.map((f) => `${r.w}: ${f}`)));
  const on = !tokens.length && !components.length && !inline.length;
  return { s, group, version, on, tokens, components, componentsWhere, inline, defects, seen: uniq(all.map((r) => r.source)) };
});
const off = rows.filter((r) => !r.on);
const byGroup = GROUPS.map((g) => [g, rows.filter((r) => r.group === g)]).filter(([, rs]) => rs.length);
const md = `# Facelift inventory (ISP-245, AB#941)

Every screen of the game at 375, 768 and 1280, as of this branch, held against the design system ISP-25 built (tokens,
components, the app shell) and ISP-26 put every v0.5 screen on. It is made by one command, \`npm run look:facelift\`:
scripts/facelift-sweep.mjs looks at every screen and records what it finds, and scripts/facelift-inventory.mjs
writes this file and the contact sheets from that. Rerun it after a change; v1.0-31 reuses it.

**${screens.length} screens**, each at three widths: the pages before play, the shell, every tab, each tab's subpages,
every building the Station opens and a corporation facility. ${rows.filter((r) => r.on).length} are on the system;
**${off.length} are not**.

Contact sheets (first screenful of each screen), in docs/ab-941/:
${sheets.map(([w, n, f]) => `- \`${f}\`: ${n} screens at ${w}${typeof w === "number" ? "px" : ""}`).join("\n")}

## How each column is decided

- **Added in**: the version of the work item that built the screen (its AB# in the markup or its view's header, and
  that item's version tag). "≤ v0.5" is a screen ISP-26 already put on the system. A "v1.0 subpage" is one the Board's
  review of 2026-09-26 split out (AB#2468 to AB#2474); what is on it may be older, and says so.
- **On the system** is "no" when anything below is seen on the screen at any width, for the base corporation or one of
  the seeds with v0.6 to v0.13 records:
  - **tokens**: a style rule applied on the screen that sets a colour, a shadow, a font size or a font family written
    out instead of a design token (the rule's selector is listed);
  - **components**: a control not built from the system's components: a \`<button>\` with no \`.ui-\` component class, an \`<input>\`
    without \`.ui-input\`, a \`<select>\` without \`.ui-select\`, a \`<textarea>\` without \`.ui-textarea\`, a \`<table>\`
    without \`.ui-table\`;
  - **inline**: an inline style that sets a colour or a font.
- **Defects**, prefixed by width, are the shared checks (e2e/screenFindings.mjs): sideways scroll, a box off screen,
  words wider than their control, a legacy component, and at 375 text under 14px and a control under 44px.
- **Seen with**: \`base\` is a busy corporation with a conglomerate and a fleet (seed-industry-account +
  seed-company-station). The others are the seeds of the v0.6 to v0.13 screens, each looked at at 375 and 1280 with its
  records in it.

## What a person looked at, and what that found

The contact sheets were looked at, every screen, at every width, by the Builder that made them (2026-09-29), and the
screens they flag were opened full size. The Board's own look is still owed: the acceptance asks for a human's.
- Every screen has a title with its document code, the shell around it, and nothing outside the system's look at
  thumbnail size; the v0.6 to v0.13 screens (conglomerates, the Fleet, the Development Bank, the Stock Exchange, the
  Council, lobbying, patents) read as the same product as the v0.5 ones.
- **On a phone, every in-game screen starts below three collapsed sidebar panels** (Corporation Identity, Milestones,
  Quick Actions): the screen's own title sits under the header and the panels, a third or more of the way down the
  812px viewport, on all 53 in-game screens.
- **Logistics** scrolls sideways at 375 (169px) and 768 (24px): its in-flight table is wider than the screen.
- **Operations** scrolls sideways at 768 (18px): a row's Open button is past the edge.
- An earlier run's phone shots lost the sticky header in two places (the Conglomerate Affairs Bureau and the Orbital
  Executive Suites at 375); their full-page shots had it at the top, so it was the capture, not the game. The sweep now
  waits for the repaint, and these sheets have the header in place.

Filed from this inventory (2026-09-29), none fixed here:
- Bug #4841: Logistics scrolls sideways at 375 and 768 (the in-flight table).
- Bug #4842: Operations scrolls sideways at 768 (a row's Open button).
- Bug #4843: the Loan Board's selects are .ui-input, not .ui-select.
- Bug #4844: page and header titles use clamp(), not a type token.
- Bug #4845: the prerequisite trees' nodes and the sidebar toggles are buttons outside the components.
- Bug #4846: on a phone every screen starts below the three collapsed sidebar panels.

## Off the system, by group

| Group | Screens | Off the system |
|---|---|---|
${byGroup.map(([g, rs]) => `| ${g} | ${rs.length} | ${rs.filter((r) => !r.on).length} |`).join("\n")}

## Every screen

| Screen | Group | Added in | On the system | Tokens (selectors) | Components | Inline | Defects | Seen with |
|---|---|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.s} | ${r.group} | ${r.version} | ${r.on ? "yes" : "**no**"} | ${cell(r.tokens)} | ${cell(r.components.map((c, i) => c))}${r.componentsWhere.length ? `<br>at ${cell(r.componentsWhere, 3)}` : ""} | ${cell(r.inline, 2)} | ${cell(r.defects, 5)} | ${r.seen.join(", ")} |`).join("\n")}
`;
fs.writeFileSync(INVENTORY, md);
console.log(`${screens.length} screens, ${off.length} off the system; wrote ${path.relative(ROOT, INVENTORY)} and ${sheets.length} contact sheets`);
