import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { cacheControlFor, CACHE_IMAGES, CACHE_IMMUTABLE, CACHE_REVALIDATE } from "../../server/staticCache.js";

// AB#964 (ISP-268): static files carry a Cache-Control for what they are, and text is compressed when the browser
// accepts it. Through the real server and its express.static.

const { getApp } = await import("../helpers/app.js");
let app;
beforeAll(async () => { ({ app } = await getApp()); });

describe("ISP-268 cache headers on static files (AB#964)", () => {
  it("keeps a versioned vendor file a year, an image a week, and revalidates pages, scripts and styles", async () => {
    const vendor = await request(app).get("/vendor/chart.js-4.4.3/chart.umd.min.js");
    expect(vendor.status).toBe(200);
    expect(vendor.headers["cache-control"]).toBe(CACHE_IMMUTABLE);
    const font = await request(app).get("/vendor/inter-5.3.0/inter-latin-wght-normal.woff2");
    expect(font.status).toBe(200);
    expect(font.headers["cache-control"]).toBe(CACHE_IMMUTABLE);
    const image = await request(app).get("/images/planets/earth.jpg");
    expect(image.status).toBe(200);
    expect(image.headers["cache-control"]).toBe(CACHE_IMAGES);
    for (const path of ["/styles.css", "/scripts/app.js", "/login.html"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers["cache-control"], path).toBe(CACHE_REVALIDATE);
      expect(res.headers.etag, path).toBeTruthy(); // so a revalidation is a 304, not the file again
    }
  });

  it("answers an unchanged script with 304", async () => {
    const first = await request(app).get("/scripts/app.js");
    const again = await request(app).get("/scripts/app.js").set("If-None-Match", first.headers.etag);
    expect(again.status).toBe(304);
  });

  it("the rule by path: vendor, then images by folder or extension, then everything else", () => {
    expect(cacheControlFor("/vendor/x-1.0/x.js")).toBe(CACHE_IMMUTABLE);
    expect(cacheControlFor("images/a.jpg")).toBe(CACHE_IMAGES);
    expect(cacheControlFor("/favicon.svg")).toBe(CACHE_IMAGES);
    expect(cacheControlFor("\\scripts\\app.js")).toBe(CACHE_REVALIDATE);
    expect(cacheControlFor("/index.html")).toBe(CACHE_REVALIDATE);
  });
});

describe("ISP-268 compression (AB#964)", () => {
  it("gzips the stylesheet and a script for a browser that accepts it, and not for one that does not", async () => {
    for (const path of ["/styles.css", "/scripts/starmap.js"]) {
      const gz = await request(app).get(path).set("Accept-Encoding", "gzip");
      expect(gz.headers["content-encoding"], path).toBe("gzip");
      const plain = await request(app).get(path).set("Accept-Encoding", "identity");
      expect(plain.headers["content-encoding"], path).toBeUndefined();
    }
  });
});
