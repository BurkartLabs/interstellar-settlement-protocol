import { describe, it, expect } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { MAX_DEFINED_LEVEL } from "../../server/game/catalog.js";

// ISP-111 (AB#803): the level panel browses the ladder from GET /api/bootstrap, one entry per level the data defines.
describe("GET /api/bootstrap's levelLadder (AB#803)", () => {
  it("lists every defined level in order, each with labelled unlocks", async () => {
    const { app } = await getApp();
    const res = await request(app).get("/api/bootstrap");
    expect(res.status).toBe(200);
    const ladder = res.body.levelLadder;
    expect(ladder.map((l) => l.level)).toEqual(Array.from({ length: MAX_DEFINED_LEVEL }, (_, i) => i + 1));
    for (const l of ladder) for (const u of l.unlocks) expect(u.label, `level ${l.level}: ${u.key}`).not.toBe(u.key);
  });
});
