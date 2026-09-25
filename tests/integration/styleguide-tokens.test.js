import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";

// ISP-70 (AB#759): the design-token specimen answers at /styleguide/tokens, signed out, with the game's own stylesheet
// and the script that reads the tokens from it.
let app;
beforeAll(async () => {
  ({ app } = await getApp());
});

describe("/styleguide/tokens (ISP-70)", () => {
  it("serves the specimen page, which loads the stylesheet and the token reader", async () => {
    const res = await request(app).get("/styleguide/tokens");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("<h1 class=\"sg-title\">Design tokens</h1>");
    expect(res.text).toContain('href="/styles.css"');
    expect(res.text).toContain('src="/scripts/styleguideTokens.js"');
    for (const asset of ["/styles.css", "/scripts/styleguideTokens.js", "/scripts/tokenContrast.js"]) {
      expect((await request(app).get(asset)).status, asset).toBe(200);
    }
  });
});
