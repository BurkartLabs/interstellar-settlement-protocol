// ISP-70 (AB#759): fills in the design-token specimen at /styleguide/tokens from the live stylesheet. Every value is
// read with getComputedStyle, so the page shows the tokens as the browser resolves them, and the contrast table is
// measured with the same module the build's test uses (tokenContrast.js).

import { measure, SURFACES } from "./tokenContrast.js";

const root = getComputedStyle(document.documentElement);
const value = (name) => root.getPropertyValue(name).trim();
const names = (el, attr) => el.getAttribute(attr).split(/\s+/).filter(Boolean);

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function label(name) {
  const box = node("div", "sg-label");
  box.append(node("span", "sg-name", name), node("span", "sg-value", value(name)));
  return box;
}

for (const el of document.querySelectorAll("[data-swatches]")) {
  for (const name of names(el, "data-swatches")) {
    const swatch = node("div", "sg-swatch");
    const chip = node("div", "sg-chip");
    chip.style.setProperty("background", `var(${name})`);
    swatch.append(chip, label(name));
    el.append(swatch);
  }
}

for (const el of document.querySelectorAll("[data-text-grid]")) {
  for (const surface of SURFACES) {
    const panel = node("div", "sg-text-panel");
    panel.style.setProperty("background", `var(${surface})`);
    panel.append(node("p", "sg-text-surface", surface));
    for (const text of ["--text", "--text-soft", "--muted"]) {
      const line = node("p", "sg-text-line", `${text}: 1,284 credits`);
      line.style.setProperty("color", `var(${text})`);
      panel.append(line);
    }
    el.append(panel);
  }
}

for (const el of document.querySelectorAll("[data-fills]")) {
  for (const name of names(el, "data-fills")) {
    const row = node("div", "sg-fill-row");
    row.append(node("p", "sg-fill-name", name));
    const on = `--on-${name}`;
    for (const [state, token] of [["rest", `--${name}`], ["hover", `--${name}-hover`], ["pressed", `--${name}-pressed`]]) {
      const chip = node("div", "sg-fill");
      chip.append(node("span", "sg-fill-state", state), node("span", "sg-fill-hex", value(token)));
      chip.style.setProperty("background", `var(${token})`);
      chip.style.setProperty("color", `var(${on})`);
      row.append(chip);
    }
    const asText = node("p", "sg-fill-text", `As text: --${name}`);
    asText.style.setProperty("color", `var(--${name})`);
    row.append(asText);
    el.append(row);
  }
}

for (const el of document.querySelectorAll("[data-type-scale]")) {
  for (const name of names(el, "data-type-scale")) {
    const row = node("div", "sg-type-row");
    const sample = node("p", "sg-type-sample", "Silicates 12,480 t · 1,111.08 cr");
    sample.style.setProperty("font-size", `var(${name})`);
    row.append(label(name), sample);
    el.append(row);
  }
}

for (const el of document.querySelectorAll("[data-space]")) {
  for (const name of names(el, "data-space")) {
    const row = node("div", "sg-space-row");
    const bar = node("div", "sg-space-bar");
    bar.style.setProperty("width", `var(${name})`);
    row.append(label(name), bar);
    el.append(row);
  }
}

for (const el of document.querySelectorAll("[data-radii]")) {
  for (const name of names(el, "data-radii")) {
    const box = node("div", "sg-radius");
    box.style.setProperty("border-radius", `var(${name})`);
    box.append(label(name));
    el.append(box);
  }
}

for (const el of document.querySelectorAll("[data-values]")) {
  const body = node("tbody");
  for (const name of names(el, "data-values")) {
    const tr = node("tr");
    tr.append(node("th", "", name), node("td", "", value(name)));
    body.append(tr);
  }
  el.append(body);
}

for (const el of document.querySelectorAll("[data-contrast]")) {
  const rows = measure(value);
  const head = node("thead");
  const hr = node("tr");
  for (const h of ["On", "Colour", "Ratio", "Needs", ""]) hr.append(node("th", "", h));
  head.append(hr);
  const body = node("tbody");
  for (const r of rows) {
    const tr = node("tr");
    const ok = r.ratio >= r.min;
    tr.append(node("td", "", r.bg), node("td", "", r.fg), node("td", "sg-num", `${r.ratio.toFixed(2)}:1`), node("td", "sg-num", `${r.min}:1`), node("td", ok ? "sg-pass" : "sg-fail", ok ? "pass" : "FAIL"));
    body.append(tr);
  }
  el.append(head, body);
  const failing = rows.filter((r) => r.ratio < r.min).length;
  const worstText = Math.min(...rows.filter((r) => r.kind === "text").map((r) => r.ratio));
  document.querySelector("[data-contrast-summary]").textContent =
    `${rows.length} pairs, ${failing === 0 ? "all passing" : `${failing} failing`}. The lowest text-on-surface ratio is ${worstText.toFixed(2)}:1; AA asks 4.5:1.`;
}
