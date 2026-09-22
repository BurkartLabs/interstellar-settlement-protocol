// Before the server module loads (vitest gives each test file its own copy): tests/setup.js turns the dev surface on.
process.env.ISP_DEV = "1";
process.env.NODE_ENV = "production";

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import request from "supertest";
import { getApp } from "../helpers/app.js";

// Bug #423 and Bug #1069: the demo-account routes and the developer kanban board were live on every server. They exist
// only when ISP_DEV=1 and NODE_ENV is not production; everywhere else they are not registered at all.
describe("the dev surface does not exist in production, even with ISP_DEV=1 (Bug #423, #1069)", () => {
  const kanbanFile = new URL("../../kanban/kanbanState.json", import.meta.url);
  // Bug #1221: load the server in a hook (10 s), so the first test's 5 s is its own request and not the module import.
  beforeAll(async () => { await getApp(); });

  for (const [method, path] of [["post", "/api/auth/dummy-login"], ["post", "/api/auth/dummy-reset"], ["get", "/kanban/api"], ["post", "/kanban/api"], ["get", "/kanban/"]]) {
    it(`${method.toUpperCase()} ${path} answers 404`, async () => {
      const { app } = await getApp();
      const before = fs.existsSync(kanbanFile) ? fs.readFileSync(kanbanFile, "utf8") : null;
      const res = await request(app)[method](path).send({ written: "by the test" });
      expect(res.status).toBe(404);
      expect(fs.existsSync(kanbanFile) ? fs.readFileSync(kanbanFile, "utf8") : null).toBe(before);
    });
  }
});
