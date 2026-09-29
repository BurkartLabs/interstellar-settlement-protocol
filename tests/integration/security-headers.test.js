import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";

// AB#753 (ISP-65): every response carries the security headers, the content security policy lets no inline or
// evaluated script run, and a request from another origin is refused. One origin is allowlisted here, through the
// same ISP_APP_ORIGIN the sockets read, so the allowed path is tested too. It must be set before the server loads.
const PARTNER = "https://partner.example";
process.env.ISP_APP_ORIGIN = PARTNER;
const { getApp } = await import("../helpers/app.js");

let app;
beforeAll(async () => { ({ app } = await getApp()); });

/** A CSP header as { directive: [sources] }. */
function parseCsp(header) {
  return Object.fromEntries(String(header || "").split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...sources] = d.split(/\s+/);
    return [name, sources];
  }));
}

describe("security headers (AB#753)", () => {
  // A page, a script, a JSON route, a login refusal and a 404: every kind of response the server sends.
  it.each([
    ["the game page", "get", "/"],
    ["the login page", "get", "/login.html"],
    ["a script", "get", "/scripts/app.js"],
    ["a JSON route", "get", "/api/research"],
    ["a refused login", "post", "/api/auth/login"],
    ["a missing page", "get", "/no-such-page"]
  ])("%s carries CSP, nosniff, a referrer policy and frame-ancestors 'none'", async (_label, method, path) => {
    const res = await request(app)[method](path);
    const csp = parseCsp(res.headers["content-security-policy"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("same-origin");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("lets no inline or evaluated script run: no 'unsafe-inline' or 'unsafe-eval' in script-src, and none in attributes", async () => {
    const csp = parseCsp((await request(app).get("/")).headers["content-security-policy"]);
    expect(csp["script-src"]).toBeDefined();
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
    expect(csp["script-src-attr"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["default-src"]).toEqual(["'self'"]);
    // AB#959: reports are on only when ISP_CSP_REPORT_FILE is set (tests/integration/csp-report.test.js)
    expect(csp["report-uri"]).toBeUndefined();
  });

  it("has no CSP report route unless reporting is on (AB#959)", async () => {
    const res = await request(app).post("/csp-report").set("Content-Type", "application/csp-report").send("{}");
    expect(res.status).not.toBe(204);
  });

  it("AB#964: every page loads its scripts, styles and fonts from this server alone, and the policy allows no other origin", async () => {
    const csp = parseCsp((await request(app).get("/")).headers["content-security-policy"]);
    const pages = ["index.html", "login.html", "register.html", "check-email.html", "verify-email.html", "forgot-password.html", "reset-password.html", "how-to-start.html", "styleguide/index.html", "styleguide/tokens.html"];
    for (const page of pages) {
      const html = readFileSync(new URL(`../../public/${page}`, import.meta.url), "utf8");
      expect(html, page).not.toMatch(/<(script|link)[^>]*(src|href)="https?:\/\//);
    }
    expect(csp["script-src"]).toEqual(["'self'"]);
    expect(csp["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp["font-src"]).toEqual(["'self'"]);
  });
});

describe("CORS (AB#753)", () => {
  const EVIL = "https://evil.example";

  it("refuses a preflight from another origin, and says nothing that would let it through", async () => {
    const res = await request(app).options("/api/auth/login").set("Origin", EVIL).set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it.each([
    ["a login", "post", "/api/auth/login"],
    ["a registration", "post", "/api/auth/register"],
    ["a public catalogue read", "get", "/api/research"]
  ])("refuses %s sent from another origin before the route runs", async (_label, method, path) => {
    const res = await request(app)[method](path).set("Origin", EVIL).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/another site/);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("lets the game's own page through: a same-origin request carries its own host as Origin", async () => {
    const res = await request(app).post("/api/auth/login").set("Host", "game.example").set("Origin", "https://game.example").send({});
    expect(res.status).not.toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined(); // same origin needs no CORS header
  });

  it("lets a request with no Origin through: a page load, a same-origin GET, a script", async () => {
    expect((await request(app).get("/api/research")).status).toBe(200);
  });

  it("allows an origin named in ISP_APP_ORIGIN, and says so only to that origin", async () => {
    const pre = await request(app).options("/api/auth/login").set("Origin", PARTNER).set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization,content-type");
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe(PARTNER);
    expect(pre.headers["access-control-allow-headers"].toLowerCase()).toContain("authorization");
    expect(pre.headers.vary).toMatch(/Origin/);
    const res = await request(app).get("/api/research").set("Origin", PARTNER);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(PARTNER);
  });

  it("does not treat a look-alike host as the game's own", async () => {
    const res = await request(app).post("/api/auth/login").set("Host", "game.example").set("Origin", "https://game.example.evil.example").send({});
    expect(res.status).toBe(403);
  });
});
