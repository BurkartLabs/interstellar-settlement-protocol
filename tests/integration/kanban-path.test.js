import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { getApp } from "../helpers/app.js";

// Bug #4828: the dev kanban board wrote the repository's tracked kanban/kanbanState.json from any server, so every full
// suite (rate-limit-coverage walks every POST route with a body) cut it from 258 lines to 1 in whatever checkout ran it.
const TRACKED = path.join(process.cwd(), "kanban", "kanbanState.json");
const bytes = () => (fs.existsSync(TRACKED) ? fs.readFileSync(TRACKED) : null);

describe("the dev kanban board under test (Bug #4828)", () => {
  afterEach(() => { delete process.env.ISP_KANBAN_PATH; });

  it("saves into the test's data directory and leaves the tracked file byte for byte", async () => {
    const { app } = await getApp();
    const before = bytes();
    const board = { columns: [{ id: "todo", name: "To Do", cards: [{ id: "c1", title: "from a test" }] }] };
    expect((await request(app).post("/kanban/api").send(board)).status).toBe(200);
    expect(bytes()).toEqual(before);
    expect(JSON.parse(fs.readFileSync(path.join(process.env.ISP_DATA_DIR, "kanbanState.json"), "utf8"))).toEqual(board);
    expect((await request(app).get("/kanban/api")).body).toEqual(board);
  });

  it("uses ISP_KANBAN_PATH when it names a file", async () => {
    const { app } = await getApp();
    const file = path.join(process.env.ISP_DATA_DIR, "elsewhere.json");
    process.env.ISP_KANBAN_PATH = file;
    const board = { columns: [] };
    expect((await request(app).post("/kanban/api").send(board)).status).toBe(200);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(board);
  });
});
