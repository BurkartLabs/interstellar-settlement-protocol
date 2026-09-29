import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";

// ISP-257 (AB#953): the landing for a stranger. What a silent screenshot must carry above the fold (the verb, who it is
// for, one call to action, a real screen), and no prototype or developer copy on any public page.

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const page = read("public/index.html");
const landing = page.slice(page.indexOf('<section id="auth-shell"'), page.indexOf('<div id="game-shell"'));
const at = (needle) => landing.indexOf(needle);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("ISP-257 the landing for a public audience (AB#953)", () => {
  it("no public page says prototype, dummy or developer", () => {
    const pages = readdirSync(new URL("../../public/", import.meta.url)).filter((f) => f.endsWith(".html"));
    expect(pages.length).toBeGreaterThan(5);
    for (const f of pages) expect(read(`public/${f}`), f).not.toMatch(/prototype|dummy|developer/i);
  });

  it("says the verb in one sentence, and who it is for, between the title and the one call to action", () => {
    const verb = landing.match(/<p class="landing__verb">([\s\S]*?)<\/p>/)[1];
    expect(text(verb)).toMatch(/^Allocate [^.]*\.$/); // one sentence, the verb first
    expect(at('class="landing__verb"')).toBeGreaterThan(at('class="landing__title"'));
    expect(at('class="landing__audience"')).toBeGreaterThan(at('class="landing__verb"'));
    expect(at('class="landing__actions"')).toBeGreaterThan(at('class="landing__audience"'));
    expect((landing.match(/ui-button--primary/g) || []).length).toBe(1);
    expect(landing).toMatch(/<a href="\/register\.html" id="show-register-btn" class="ui-button ui-button--primary">Register Corporation<\/a>/);
  });

  it("shows real screens: the hero's and three proof points', each on disk, sized, and described", () => {
    const imgs = [...landing.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs).toHaveLength(4);
    for (const img of imgs) {
      const src = img.match(/src="([^"]+)"/)[1];
      expect(existsSync(new URL(`../../public${src}`, import.meta.url)), src).toBe(true);
      expect(img, src).toMatch(/width="\d+" height="\d+"/); // no layout shift as it loads
      expect(img.match(/alt="([^"]*)"/)[1].length, src).toBeGreaterThan(40);
    }
    expect(imgs[0]).toContain('fetchpriority="high"'); // the hero, above the fold on a wide page
    for (const img of imgs.slice(1)) expect(img).toContain('loading="lazy"');
  });
});
