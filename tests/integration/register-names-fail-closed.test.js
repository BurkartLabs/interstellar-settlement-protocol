import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { storedAccountByEmail } from "../helpers/api.js";

// ISP-121 (AB#813): set at the top level, which runs before the helper's beforeAll loads the server, so its NPC
// catalog cannot be read.
process.env.ISP_NPC_CATALOG = fileURLToPath(new URL("../fixtures/no-such-npc-catalog.json", import.meta.url));

// Without its reserved-name list, registration would let every name through, "GEX Commodities Authority" included.
// It refuses instead, 503, and creates nothing.
describe("registration fails closed when the reserved names cannot be read (AB#813)", () => {
  it("answers 503 for any name and creates no account", async () => {
    const { app } = await getApp();
    for (const corpName of ["GEX Commodities Authority", `Ordinary Mining ${Date.now() % 100000}`]) {
      const email = `closed-${Date.now()}-${corpName.length}@example.com`;
      const res = await request(app).post("/api/auth/register").send({ email, password: "supersecret123", ceoName: "Closed Tester", corpName });
      expect(res.status, corpName).toBe(503);
      expect(res.body.code).toBe("names-unavailable");
      expect((await storedAccountByEmail(email)).raw).toBeUndefined();
    }
  });
});
