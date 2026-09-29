import { describe, it, expect } from "vitest";
import fs from "node:fs";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { storedAccountByEmail } from "../helpers/api.js";
import { RESERVED_CORPORATION_NAMES } from "../../server/gameState.js";
import { SYSTEM_SENDERS } from "../../server/corporationName.js";

// Bug #433: a player could register as "GEX Commodities Authority", a system sender, or another corporation's name.
let seq = 0;
const register = async (corpName) => {
  const { app } = await getApp();
  seq += 1;
  const email = `name-${Date.now()}-${seq}@example.com`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "supersecret123", ceoName: "Name Tester", corpName });
  res.email = email; // AB#2288: registration answers with no account; read it by email
  return res;
};

describe("POST /api/auth/register validates the corporation name (Bug #433)", () => {
  it("creates a corporation with a good name, stored trimmed", async () => {
    const n = Date.now() % 100000;
    const res = await register(`  Clean   Name ${n} `);
    expect(res.status).toBe(201);
    expect((await storedAccountByEmail(res.email)).account.state.corp.corporationName).toBe(`Clean Name ${n}`);
  });

  it("refuses a name already taken, ignoring case and spacing, and creates no account", async () => {
    const name = `Taken Name ${Date.now() % 100000}`;
    expect((await register(name)).status).toBe(201);
    const again = await register(`  ${name.toUpperCase().replace(" ", "   ")} `);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("A corporation with this name already exists. Choose another name.");
  });

  it("refuses a blank name instead of giving everyone the same default", async () => {
    const res = await register("");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("A corporation name is required.");
  });

  it("refuses every name the game itself speaks as, taken from the server's own lists", async () => {
    expect(RESERVED_CORPORATION_NAMES.length).toBeGreaterThanOrEqual(9);
    for (const name of RESERVED_CORPORATION_NAMES) {
      const res = await register(name);
      expect(res.status, name).toBe(400);
      expect(res.body.error).toBe("That name belongs to an institution in the game; choose another.");
    }
    expect((await register(`${RESERVED_CORPORATION_NAMES[0]} Holdings`)).status).toBe(400);
  });

  it("reserves every system sender and NPC buyer", async () => {
    const { NPC_BUY_SEED } = await import("../../server/gameState.js");
    for (const name of [...Object.values(SYSTEM_SENDERS), ...NPC_BUY_SEED.map((s) => s.buyer)]) {
      expect(RESERVED_CORPORATION_NAMES, name).toContain(name);
    }
  });
});

// A sender name written out as a string could be one nobody reserved. Every fromName literal in the server and the
// client scripts must be a reserved name; new senders belong in SYSTEM_SENDERS, which reserves them.
describe("every name the game signs messages with is reserved (Bug #433)", () => {
  it("finds no fromName literal that a player could register", () => {
    const dirs = ["server", "public/scripts"];
    const unreserved = [];
    for (const dir of dirs) {
      // AB#739: recursive, so client code in public/scripts/views/ (and server code in its subfolders) is read too.
      const files = fs.readdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true }).map((f) => f.replaceAll("\\", "/")).filter((f) => f.endsWith(".js"));
      for (const file of files) {
        const source = fs.readFileSync(new URL(`../../${dir}/${file}`, import.meta.url), "utf8");
        for (const m of source.matchAll(/fromName\s*[:=]\s*["'`]([^"'`$]+)["'`]/g)) {
          if (!RESERVED_CORPORATION_NAMES.includes(m[1])) unreserved.push(`${dir}/${file}: ${m[1]}`);
        }
      }
    }
    expect(unreserved).toEqual([]);
  });
});
