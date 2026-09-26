import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";

// ISP-72 (AB#761): /styleguide shows each core component in every state the story lists. Every specimen names itself
// (data-component, data-variant, data-state), so this reads the page as data and holds it to the full set, and holds
// each drawn-still state to a stylesheet rule that draws it. Whether the states look right is for the person looking
// at the page; whether a control is 44px and shows a focus ring in a real browser is e2e/styleguide.spec.js.
// AB#2280: line endings normalised, because git writes these files with CRLF on a Windows checkout (core.autocrlf) and
// the rule checks below match text that spans a line break.
const read = (file) => readFileSync(new NodeURL(`../../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const PAGE = read("public/styleguide/index.html");
const CSS = read("public/styles.css");

/** Every opening tag carrying data-component, as an attribute map. */
const specimens = [...PAGE.matchAll(/<([a-z]+)\b([^>]*\bdata-component="[^"]+"[^>]*)>/g)].map((m) => ({
  tag: m[1],
  attrs: Object.fromEntries([...m[2].matchAll(/([a-z-]+)(?:="([^"]*)")?/g)].map((a) => [a[1], a[2] ?? ""]))
}));
const find = (component, extra = {}) => specimens.filter((s) => s.attrs["data-component"] === component && Object.entries(extra).every(([k, v]) => s.attrs[k] === v));

describe("/styleguide shows every component in every state (ISP-72)", () => {
  it("buttons: primary, secondary, ghost and danger, each at rest, hovered, focused, pressed, disabled and loading", () => {
    for (const variant of ["primary", "secondary", "ghost", "danger"]) {
      for (const state of ["rest", "hover", "focus", "active", "disabled", "loading"]) {
        const found = find("button", { "data-variant": variant, "data-state": state });
        expect(found, `${variant} ${state}`).toHaveLength(1);
        expect(found[0].attrs.class).toContain(`ui-button--${variant}`);
      }
    }
    expect(find("button", { "data-state": "disabled" }).every((s) => "disabled" in s.attrs)).toBe(true);
    expect(find("button", { "data-state": "loading" }).every((s) => s.attrs["aria-busy"] === "true")).toBe(true);
  });

  it("inputs and selects, in their states, each with a label, and every error tied to its field", () => {
    const inputs = find("input").map((s) => s.attrs["data-state"]).sort();
    expect(inputs).toEqual(["disabled", "filled", "focus", "hover", "invalid", "rest"]);
    expect(find("select").map((s) => s.attrs["data-state"]).sort()).toEqual(["disabled", "focus", "hover", "invalid", "rest"]);
    for (const m of PAGE.matchAll(/<(input|select)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
      expect(PAGE, `a label for #${m[2]}`).toContain(`for="${m[2]}"`);
      const described = /aria-describedby="([^"]+)"/.exec(m[0])?.[1];
      if (described) expect(PAGE, `#${described}`).toContain(`id="${described}"`);
      if (m[0].includes('aria-invalid="true"')) expect(described, `#${m[2]} names its error`).toBeTruthy();
    }
  });

  it("cards, a panel with its header, tabs, badges and tooltips, in theirs", () => {
    expect(find("card").map((s) => s.attrs["data-state"]).sort()).toEqual(["focus", "hover", "rest", "selected"]);
    expect(find("panel", { "data-state": "with-header" })).toHaveLength(1);
    expect(PAGE).toMatch(/class="ui-panel__header"[\s\S]*class="ui-panel__title"[\s\S]*class="ui-panel__actions"/);
    const tabs = [...PAGE.matchAll(/<button\b[^>]*role="tab"[^>]*data-state="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(tabs).toEqual(["disabled", "focus", "hover", "rest", "selected"]);
    expect(find("badge").map((s) => s.attrs["data-variant"]).sort()).toEqual(["accent", "danger", "neutral", "success", "warn"]);
    expect(find("tooltip").map((s) => s.attrs["data-state"]).sort()).toEqual(["closed", "open"]);
  });

  it("every state drawn standing still has a rule that draws it", () => {
    for (const variant of ["primary", "secondary", "ghost", "danger"]) {
      expect(CSS, `${variant} hover`).toContain(`.ui-button--${variant}.is-hover`);
      expect(CSS, `${variant} pressed`).toContain(`.ui-button--${variant}.is-active`);
    }
    for (const rule of [".ui-button.is-loading::before", ".ui-input.is-hover", ".ui-input.is-focus", ".ui-select.is-hover", ".ui-select.is-focus", ".ui-card--interactive.is-hover", ".ui-tab.is-hover", ".ui-tab.is-focus", ".ui-tooltip.is-open", ":focus-visible,\n.is-focus {"]) {
      expect(CSS, rule).toContain(rule);
    }
  });

  it("controls are 44px tall on a phone", () => {
    const phone = /@media \(max-width: 600px\) {\s*\.ui-button,\s*\.ui-input,\s*\.ui-select,\s*\.ui-tab {\s*min-height: 44px;/.test(CSS);
    expect(phone).toBe(true);
  });
});

// ISP-73 (AB#762): the data components. The table's switch to cards and its lack of sideways scroll are measured in a
// real browser by e2e/styleguide.spec.js; this holds the page to the set and the stylesheet to the rules that draw it.
describe("/styleguide shows every data component in every state (ISP-73)", () => {
  const section = (id) => PAGE.slice(PAGE.indexOf(`id="${id}"`), PAGE.indexOf("</section>", PAGE.indexOf(`id="${id}"`)));

  it("a data table whose every cell names its column, so a phone can show it as cards", () => {
    expect(find("table")).toHaveLength(1);
    const table = section("sg-table");
    const columns = [...table.matchAll(/<th\b[^>]*scope="col"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1].trim());
    expect(columns.length).toBeGreaterThanOrEqual(4);
    const cells = [...table.matchAll(/<td\b([^>]*)>/g)].map((m) => /data-label="([^"]*)"/.exec(m[1])?.[1]);
    expect(cells.length).toBeGreaterThanOrEqual(columns.length * 3);
    cells.forEach((label, i) => expect(label, `cell ${i}`).toBe(columns[i % columns.length]));
    expect(CSS).toMatch(/@media \(max-width: 767px\) {[\s\S]*?\.ui-table thead {[\s\S]*?\.ui-table td::before {\s*content: attr\(data-label\);/);
  });

  it("toasts: information, success, warning and error, each announced, each closable", () => {
    const toasts = find("toast");
    expect(toasts.map((s) => s.attrs["data-variant"]).sort()).toEqual(["danger", "info", "success", "warn"]);
    for (const t of toasts) {
      expect(t.attrs.role, t.attrs["data-variant"]).toBe(t.attrs["data-variant"] === "danger" ? "alert" : "status");
      if (t.attrs["data-variant"] !== "info") expect(t.attrs.class).toContain(`ui-toast--${t.attrs["data-variant"]}`);
    }
    expect([...section("sg-toasts").matchAll(/data-toast-close/g)]).toHaveLength(4);
  });

  it("the game's own modal: a confirmation, a confirmation of what cannot be undone, and a receipt", () => {
    const modals = find("modal");
    expect(modals.map((s) => s.attrs["data-variant"]).sort()).toEqual(["confirm", "danger", "receipt"]);
    for (const m of modals) {
      expect(m.attrs.class).toContain("modal-card");
      expect(m.attrs.role).toBe("dialog");
      expect(PAGE, m.attrs["aria-labelledby"]).toContain(`id="${m.attrs["aria-labelledby"]}"`);
    }
    expect(CSS).toMatch(/\.modal-card {[^}]*border-radius: var\(--radius-lg\);[^}]*box-shadow: var\(--elevation-overlay\);/);
  });

  it("progress at none, part and all, each saying its value; the mining cycle running and idle", () => {
    const bars = find("progress");
    expect(bars.map((s) => s.attrs["data-state"]).sort()).toEqual(["complete", "empty", "partial"]);
    for (const b of bars) {
      expect(b.attrs.role).toBe("progressbar");
      expect(b.attrs.class).toContain("progress-wrap");
      expect(Number(b.attrs["aria-valuenow"]), b.attrs["data-state"]).toBe({ empty: 0, partial: 62, complete: 100 }[b.attrs["data-state"]]);
    }
    expect(find("cycle").map((s) => s.attrs["data-state"]).sort()).toEqual(["idle", "running"]);
    expect(section("sg-progress")).toContain('class="cycle-figures"');
  });

  it("an empty state and an error state side by side, and they say different things (#577)", () => {
    const pair = section("sg-empty-error");
    const empty = find("empty-state");
    const error = find("error-state");
    expect(empty).toHaveLength(1);
    expect(error).toHaveLength(1);
    expect(pair).toContain('data-component="empty-state"');
    expect(pair).toContain('data-component="error-state"');
    expect(empty[0].attrs.role).toBe("status");
    expect(error[0].attrs.role).toBe("alert");
    // The empty state says why it is empty and what to do; the error says what failed and offers to try again.
    expect(pair).toMatch(/data-component="empty-state"[\s\S]*class="ui-state__why"[\s\S]*class="ui-button[^"]*"[^>]*>[^<]+</);
    expect(pair).toMatch(/data-component="error-state"[\s\S]*class="ui-state__why"[\s\S]*>Try again</);
    expect(CSS).toContain(".ui-state--error");
  });

  it("a skeleton that says it is loading, and stands still for anyone who asks for less motion", () => {
    const skeletons = find("skeleton");
    expect(skeletons).toHaveLength(1);
    expect(skeletons[0].attrs["aria-busy"]).toBe("true");
    expect(skeletons[0].attrs["aria-label"]).toMatch(/loading/i);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) {\s*\.ui-skeleton__line {\s*animation: none;/);
  });

  it("the game's KPI tile: a figure rising, falling and flat, a gain, a loss, and the primary tile", () => {
    const tiles = find("kpi");
    expect(tiles.map((s) => s.attrs["data-state"]).sort()).toEqual(["down", "flat", "loss", "gain", "up"].sort());
    expect(tiles.every((t) => t.attrs.class.includes("kpi-tile"))).toBe(true);
    expect(tiles.filter((t) => t.attrs["data-variant"] === "primary")).toHaveLength(1);
  });
});
