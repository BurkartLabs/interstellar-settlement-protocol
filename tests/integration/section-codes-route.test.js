import { describe, it, expect } from "vitest";
import request from "supertest";
import fs from "node:fs";
import { getApp } from "../helpers/app.js";

// ISP-248 (AB#944): GET /api/section-codes serves the registry the page's headers fill from: every id and its code,
// and nothing else, to anyone (the signed-out pages have headers too).
describe("GET /api/section-codes (ISP-248, AB#944)", () => {
  it("serves every registered id with its code, without a login, and only those two fields", async () => {
    const { app } = await getApp();
    const res = await request(app).get("/api/section-codes");
    expect(res.status).toBe(200);
    const R = JSON.parse(fs.readFileSync(new URL("../../data/section-codes.json", import.meta.url), "utf8"));
    expect(res.body.screens).toEqual(R.screens.map(({ id, code }) => ({ id, code })));
    expect(res.body.sections).toEqual(R.sections.map(({ id, code }) => ({ id, code })));
    for (const method of ["post", "put", "patch", "delete"]) expect((await request(app)[method]("/api/section-codes").send({})).status, method).toBe(404);
  });
});
