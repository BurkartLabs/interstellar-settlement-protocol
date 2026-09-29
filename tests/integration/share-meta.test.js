import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { embeddableElsewhere } from "../../server/staticCache.js";
import { fillPublicUrl, PUBLIC_URL_TOKEN } from "../../server/publicPages.js";

// AB#954 (ISP-258): the landing is shareable and findable: a favicon on every page, the landing's description, canonical
// URL and link-preview tags carrying the one configured public URL (ISP_PUBLIC_URL), a preview image others may embed,
// and robots.txt. Through the real server.

const { getApp } = await import("../helpers/app.js");
let app;
const saved = process.env.ISP_PUBLIC_URL;
beforeAll(async () => { ({ app } = await getApp()); process.env.ISP_PUBLIC_URL = "https://isp.example"; });
afterAll(() => { if (saved === undefined) delete process.env.ISP_PUBLIC_URL; else process.env.ISP_PUBLIC_URL = saved; });

const meta = (html, key) => html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1];

describe("ISP-258 the landing's canonical URL and link preview (AB#954)", () => {
  it("fills every absolute URL from ISP_PUBLIC_URL, at / and /index.html alike, and leaves no token", async () => {
    for (const path of ["/", "/index.html"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.headers["cache-control"]).toBe("no-cache");
      expect(res.text).not.toContain(PUBLIC_URL_TOKEN);
      expect(res.text).toContain('<link rel="canonical" href="https://isp.example/" />');
      expect(meta(res.text, "og:url")).toBe("https://isp.example/");
      expect(meta(res.text, "og:image")).toBe("https://isp.example/images/og/landing.jpg");
      expect(meta(res.text, "twitter:image")).toBe("https://isp.example/images/og/landing.jpg");
    }
  });

  it("gives a title, a description and a large image card, and the image is there at the size it says", async () => {
    const html = (await request(app).get("/")).text;
    expect(meta(html, "description").length).toBeGreaterThan(80);
    expect(meta(html, "og:title")).toBe("The Interstellar Settlement Protocol");
    expect(meta(html, "og:description")).toBe(meta(html, "description"));
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
    expect([meta(html, "og:image:width"), meta(html, "og:image:height")]).toEqual(["1200", "630"]);
    const img = await request(app).get("/images/og/landing.jpg");
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");
    expect(img.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });

  it("the canonical URL is written once, as the token: no public file names a domain for it", () => {
    const pages = readdirSync(new URL("../../public/", import.meta.url)).filter((f) => f.endsWith(".html"));
    for (const f of pages) {
      const html = readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8");
      for (const m of html.matchAll(/<(?:link rel="canonical" href|meta (?:property|name)="(?:og:url|og:image|twitter:image)" content)="([^"]*)"/g)) {
        expect(m[1].startsWith(PUBLIC_URL_TOKEN), `${f}: ${m[1]}`).toBe(true);
      }
    }
    expect(fillPublicUrl(`${PUBLIC_URL_TOKEN}/a ${PUBLIC_URL_TOKEN}/b`, "https://x.test")).toBe("https://x.test/a https://x.test/b");
    expect(fillPublicUrl(`${PUBLIC_URL_TOKEN}/a`, null)).toBe("/a");
  });
});

describe("ISP-258 favicon and robots.txt (AB#954)", () => {
  it("serves the favicon in every form a page or a crawler asks for, and every public page links it", async () => {
    const ico = await request(app).get("/favicon.ico");
    expect(ico.status).toBe(200);
    expect(ico.headers["content-type"]).toMatch(/icon/);
    expect(ico.body.readUInt16LE(2)).toBe(1); // an ICO
    expect(ico.body.readUInt16LE(4)).toBe(3); // 16, 32 and 48
    for (const path of ["/favicon.svg", "/apple-touch-icon.png"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers["cross-origin-resource-policy"], path).toBe("cross-origin");
    }
    const pages = [...readdirSync(new URL("../../public/", import.meta.url)).filter((f) => f.endsWith(".html")), "styleguide/index.html", "styleguide/tokens.html"];
    for (const f of pages) expect(readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8"), f).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(existsSync(new URL("../../public/favicon.svg", import.meta.url))).toBe(true);
  });

  it("robots.txt lets the pages be indexed, and not the API or the style guide", async () => {
    const res = await request(app).get("/robots.txt");
    expect(res.status).toBe(200);
    const rules = res.text.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(rules).toEqual(["User-agent: *", "Allow: /", "Disallow: /api/", "Disallow: /styleguide/"]);
  });

  it("only the preview image and the icons may be embedded elsewhere; the rest stays same-origin", async () => {
    expect(embeddableElsewhere("\\images\\og\\landing.jpg")).toBe(true);
    expect(embeddableElsewhere("/favicon.ico")).toBe(true);
    expect(embeddableElsewhere("/images/elara_voss.jpg")).toBe(false);
    expect(embeddableElsewhere("/scripts/app.js")).toBe(false);
    const other = await request(app).get("/images/planets/earth.jpg");
    expect(other.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });
});
