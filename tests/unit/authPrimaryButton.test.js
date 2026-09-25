// AB#1759 (ISP-290, visual-design Critique AB#1757): login and register each get exactly one primary (cyan)
// control -- everything else is secondary or a plain link -- per the Critique's "cyan on at most one primary
// control per screen" rule. .btn-hero-outline (still cyan) stays on the landing page (public/index.html), out of
// this story's scope; login/register's non-primary actions use the new, muted .btn-hero-secondary instead.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

describe("login and register have exactly one primary control (AB#1759)", () => {
  for (const page of ["public/login.html", "public/register.html"]) {
    it(`${page}: exactly one .btn-hero-fill, no .btn-hero-outline`, () => {
      const html = read(page);
      const actions = html.match(/<(?:button|a)[^>]*class="btn-hero[^"]*"[^>]*>/g) || [];
      expect(actions.length, "at least one action control").toBeGreaterThan(1);

      const primaries = actions.filter((tag) => /\bbtn-hero-fill\b/.test(tag));
      expect(primaries, "exactly one primary (cyan-fill) control").toHaveLength(1);

      const outline = actions.filter((tag) => /\bbtn-hero-outline\b/.test(tag));
      expect(outline, "no leftover .btn-hero-outline (cyan) actions -- secondary actions use .btn-hero-secondary").toHaveLength(0);

      const secondaries = actions.filter((tag) => /\bbtn-hero-secondary\b/.test(tag));
      expect(primaries.length + secondaries.length, "every action is either the one primary or a secondary").toBe(actions.length);
    });

    it(`${page}: the primary control is still first in the action list (tab order unchanged)`, () => {
      const html = read(page);
      const actions = html.match(/<(?:button|a)[^>]*class="btn-hero[^"]*"[^>]*>/g) || [];
      expect(actions[0]).toMatch(/\bbtn-hero-fill\b/);
    });
  }
});
