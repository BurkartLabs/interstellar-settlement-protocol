// AB#4880: vendor the display styles' fonts. The CSP allows fonts from 'self' only (server/securityHeaders.js), so every
// face a style uses is copied here from its Fontsource package (latin subset, woff2) into public/vendor/fonts/<family>/,
// with the package's licence, and public/themes/fonts.css gets one @font-face per file. A browser downloads a face only
// when a rule on the page uses it, so declaring them all costs nothing until a style asks for one.
//
// Usage: node scripts/vendor-theme-fonts.mjs   (needs npm and tar; re-running replaces what it wrote)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "vendor", "fonts");
const CSS = path.join(ROOT, "public", "themes", "fonts.css");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

// [css family, package, kind, weights or axes]. "var": a variable font's latin wght file (plus italic/wdth when listed);
// "static": one file per weight.
const FONTS = [
  ["Big Shoulders Display", "@fontsource-variable/big-shoulders-display", "var"],
  ["Oswald", "@fontsource-variable/oswald", "var"],
  ["Space Mono", "@fontsource/space-mono", "static", [400, 700]],
  ["VT323", "@fontsource/vt323", "static", [400]],
  ["IBM Plex Mono", "@fontsource/ibm-plex-mono", "static", [400, 500, 600, 700]],
  ["Cinzel", "@fontsource-variable/cinzel", "var"],
  ["Jost", "@fontsource-variable/jost", "var"],
  ["Marcellus SC", "@fontsource/marcellus-sc", "static", [400]],
  ["Poiret One", "@fontsource/poiret-one", "static", [400]],
  ["Share Tech Mono", "@fontsource/share-tech-mono", "static", [400]],
  ["Architects Daughter", "@fontsource/architects-daughter", "static", [400]],
  ["Zen Kaku Gothic New", "@fontsource/zen-kaku-gothic-new", "static", [400, 500, 700, 900]],
  ["Archivo", "@fontsource-variable/archivo", "var", ["wdth"]],
  ["Michroma", "@fontsource/michroma", "static", [400]],
  ["Schibsted Grotesk", "@fontsource-variable/schibsted-grotesk", "var"],
  ["JetBrains Mono", "@fontsource-variable/jetbrains-mono", "var"],
  ["Manrope", "@fontsource-variable/manrope", "var"],
  ["Figtree", "@fontsource-variable/figtree", "var"],
  ["Barlow", "@fontsource/barlow", "static", [400, 500, 600, 700]],
  ["Barlow Condensed", "@fontsource/barlow-condensed", "static", [500, 600, 700]],
  ["Playfair Display", "@fontsource-variable/playfair-display", "var", ["italic"]],
  ["Source Serif 4", "@fontsource-variable/source-serif-4", "var"],
  ["Libre Caslon Text", "@fontsource/libre-caslon-text", "static", [400, 700]],
  ["Saira Condensed", "@fontsource/saira-condensed", "static", [500, 600, 700, 800]],
  ["Titillium Web", "@fontsource/titillium-web", "static", [300, 400, 600, 700]],
  ["Nunito Sans", "@fontsource-variable/nunito-sans", "var"],
  ["Doto", "@fontsource-variable/doto", "var"],
  ["Space Grotesk", "@fontsource-variable/space-grotesk", "var"],
  ["Orbitron", "@fontsource-variable/orbitron", "var"],
  ["Sora", "@fontsource-variable/sora", "var"]
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "isp-fonts-"));
const faces = [];
for (const [family, pkg, kind, extra = []] of FONTS) {
  const slug = family.toLowerCase().replace(/\s+/g, "-");
  const tgz = execFileSync(NPM, ["pack", pkg, "--pack-destination", tmp, "--silent"], { cwd: tmp, shell: process.platform === "win32" }).toString().trim().split(/\r?\n/).pop();
  const dir = path.join(tmp, slug);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["-xzf", tgz, "-C", slug], { cwd: tmp }); // relative paths: GNU tar reads "C:" as a host
  const files = path.join(dir, "package", "files");
  const dest = path.join(OUT, slug);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const lic = ["LICENSE", "LICENSE.md", "OFL.txt"].map((f) => path.join(dir, "package", f)).find((f) => fs.existsSync(f));
  if (lic) fs.copyFileSync(lic, path.join(dest, "LICENSE"));
  const take = (file, face) => {
    if (!fs.existsSync(path.join(files, file))) throw new Error(`${pkg}: no ${file}`);
    fs.copyFileSync(path.join(files, file), path.join(dest, file));
    faces.push({ family, src: `/vendor/fonts/${slug}/${file}`, ...face });
  };
  const base = slug;
  if (kind === "var") {
    const axis = extra.includes("wdth") ? "standard" : "wght"; // "standard" carries wght and wdth together
    take(`${base}-latin-${axis}-normal.woff2`, { weight: "100 900", style: "normal", stretch: axis === "standard" ? "62% 125%" : null });
    if (extra.includes("italic")) take(`${base}-latin-wght-italic.woff2`, { weight: "100 900", style: "italic" });
  } else {
    for (const w of extra) take(`${base}-latin-${w}-normal.woff2`, { weight: String(w), style: "normal" });
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

const css = [
  "/* AB#4880: the display styles' fonts, self-hosted (CSP font-src 'self'). Written by scripts/vendor-theme-fonts.mjs; do not edit. */",
  ...faces.map((f) => `@font-face { font-family: "${f.family}"; src: url("${f.src}") format("woff2"); font-weight: ${f.weight}; font-style: ${f.style};${f.stretch ? ` font-stretch: ${f.stretch};` : ""} font-display: swap; }`)
].join("\n") + "\n";
fs.mkdirSync(path.dirname(CSS), { recursive: true });
fs.writeFileSync(CSS, css);
console.log(`${faces.length} faces from ${FONTS.length} families -> public/vendor/fonts, public/themes/fonts.css`);
