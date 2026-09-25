// AB#1049: data/research.json is the only definition of the research tree now — RESEARCH_LIBRARY
// (server/game/catalog.js) is built from it, and GET /api/research is how the client gets the same tree instead
// of keeping its own copy. "A test fails if the server gates on a technology id the file does not define" (this
// story's own acceptance line) is true by construction now: there is no second definition left to gate on.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getApp } from "../helpers/app.js";

const RESEARCH_JSON = JSON.parse(readFileSync(new URL("../../data/research.json", import.meta.url), "utf8"));

describe("GET /api/research (AB#1049)", () => {
  it("serves exactly the nodes data/research.json defines, no more and no fewer", async () => {
    const { app } = await getApp();
    const { default: request } = await import("supertest");
    const res = await request(app).get("/api/research");
    expect(res.status).toBe(200);
    expect(res.body.nodes.map((n) => n.id).sort()).toEqual(RESEARCH_JSON.nodes.map((n) => n.id).sort());
  });

  it("every field of every node matches research.json exactly, not a hand-copied approximation", async () => {
    const { app } = await getApp();
    const { default: request } = await import("supertest");
    const res = await request(app).get("/api/research");
    const byId = Object.fromEntries(res.body.nodes.map((n) => [n.id, n]));
    for (const node of RESEARCH_JSON.nodes) expect(byId[node.id]).toEqual(node);
  });

  it("does not require a login (a static catalog, like /api/ceo-insight)", async () => {
    const { app } = await getApp();
    const { default: request } = await import("supertest");
    expect((await request(app).get("/api/research")).status).toBe(200);
  });
});
