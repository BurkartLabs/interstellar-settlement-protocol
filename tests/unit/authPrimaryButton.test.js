// AB#1759 (ISP-290, visual-design Critique AB#1757): login and register each get exactly one primary (cyan)
// control -- everything else is secondary or a plain link -- per the Critique's "cyan on at most one primary
// control per screen" rule. ISP-76 (AB#765) moved them onto the design system's .ui-button; the rule is unchanged, and
// the landing now keeps it too (its Log In was a second cyan control).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

describe("login, register and the landing have exactly one primary control (AB#1759)", () => {
  for (const page of ["public/login.html", "public/register.html", "public/index.html"]) {
    const html = read(page);
    const start = page.endsWith("index.html") ? html.indexOf('id="auth-shell"') : 0;
    const end = page.endsWith("index.html") ? html.indexOf('id="game-shell"') : html.length;
    const actions = html.slice(start, end).match(/<(?:button|a)[^>]*class="ui-button[^"]*"[^>]*>/g) || [];

    it(`${page}: exactly one .ui-button--primary, every other action secondary`, () => {
      expect(actions.length, "at least one action control").toBeGreaterThan(1);
      const primaries = actions.filter((tag) => /\bui-button--primary\b/.test(tag));
      expect(primaries, "exactly one primary (cyan-fill) control").toHaveLength(1);
      const secondaries = actions.filter((tag) => /\bui-button--secondary\b/.test(tag));
      expect(primaries.length + secondaries.length, "every action is either the one primary or a secondary").toBe(actions.length);
    });

    it(`${page}: the primary control is first in the action list (tab order)`, () => {
      expect(actions[0]).toMatch(/\bui-button--primary\b/);
    });
  }
});
