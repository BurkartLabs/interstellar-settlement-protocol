import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";

// ISP-72 (AB#761): /styleguide shows each core component in every state the story lists. Every specimen names itself
// (data-component, data-variant, data-state), so this reads the page as data and holds it to the full set, and holds
// each drawn-still state to a stylesheet rule that draws it. Whether the states look right is for the person looking
// at the page; whether a control is 44px and shows a focus ring in a real browser is e2e/styleguide.spec.js.
const read = (file) => readFileSync(new NodeURL(`../../${file}`, import.meta.url), "utf8");
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
