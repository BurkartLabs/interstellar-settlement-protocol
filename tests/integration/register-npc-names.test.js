import { describe, it, expect } from "vitest";
import fs from "node:fs";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { storedAccountByEmail } from "../helpers/api.js";
import { NPC_NAMES } from "../../server/npcCorporations.js";
import { serverCode } from "../helpers/serverSource.js";

// ISP-121 (AB#813): Bug #433 showed a player could register as "GEX Commodities Authority" and list goods as the
// exchange. Every NPC corporation and authority is refused however the name is dressed up, and a refusal creates
// nothing and never repeats the name back.
const REFUSED = "That name belongs to an institution in the game; choose another.";
const CYRILLIC = { a: "а", e: "е", o: "о", p: "р", c: "с", x: "х", y: "у", A: "А", E: "Е", O: "О", C: "С", P: "Р", H: "Н", K: "К", M: "М", T: "Т", B: "В", X: "Х" };
const DIGITS = { o: "0", O: "0", l: "1", i: "1", I: "1", e: "3", E: "3", s: "5", S: "5", a: "4" };
/** `name` with its first letter that has a stand-in in `table` replaced by it. */
const swapOne = (name, table) => {
  const at = [...name].findIndex((ch) => table[ch]);
  return at < 0 ? null : [...name].map((ch, i) => (i === at ? table[ch] : ch)).join("");
};

let seq = 0;
async function register(corpName) {
  const { app } = await getApp();
  seq += 1;
  const email = `npc-name-${Date.now()}-${seq}@example.com`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "supersecret123", ceoName: "Name Tester", corpName });
  return { res, email };
}

describe("registering as an NPC corporation or authority is refused (AB#813)", () => {
  const variants = (name) => [
    ["as written", name],
    ["in upper case", name.toUpperCase()],
    ["in lower case", name.toLowerCase()],
    ["with extra spaces", `  ${name.replace(/ /g, "   ")}  `],
    ["with a Cyrillic look-alike letter", swapOne(name, CYRILLIC)],
    ["with a digit for a letter", swapOne(name, DIGITS)],
    ["run together", name.replace(/ /g, "")],
    ["as part of a longer name", `${name} Holdings`]
  ].filter(([, v]) => v && v.trim().replace(/\s+/g, " ").length <= 40); // past 40 the length rule refuses it first

  for (const name of NPC_NAMES) {
    it(`${name}: every variant gets 400, the same message, no account, and no echo`, async () => {
      for (const [how, variant] of variants(name)) {
        const { res, email } = await register(variant);
        expect(res.status, `${how}: ${variant}`).toBe(400);
        expect(res.body.error, how).toBe(REFUSED);
        expect(res.body.field, how).toBe("corpName");
        expect(JSON.stringify(res.body), how).not.toContain(variant.trim()); // the name is not repeated back
        expect((await storedAccountByEmail(email)).raw, `${how}: no account`).toBeUndefined();
      }
    }, 30_000);
  }

  it("still lets through names that only share a word or sit inside another word", async () => {
    const n = Date.now() % 100000;
    for (const ok of [`Meridian Mining ${n}`, `Visa Systems ${n}`, `Olympus Freight ${n}`]) {
      const { res } = await register(ok);
      expect(res.status, ok).toBe(201);
    }
  });
});

describe("nothing renames a corporation (AB#813)", () => {
  it("assigns corporationName nowhere in the server, so every name went through registration's check", () => {
    const files = fs.readdirSync(new URL("../../server", import.meta.url), { recursive: true }).map((f) => f.replaceAll("\\", "/")).filter((f) => f.endsWith(".js"));
    const assigning = [];
    for (const file of files) {
      const source = fs.readFileSync(new URL(`../../server/${file}`, import.meta.url), "utf8");
      if (/\bcorporationName\s*=[^=]/.test(source) || /\[["']corporationName["']\]\s*=[^=]/.test(source)) assigning.push(file);
    }
    expect(assigning).toEqual([]);
    expect(serverCode()).not.toMatch(/\/rename/); // no rename route; one would need this check first
  });
});
