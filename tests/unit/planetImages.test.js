import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// starmap.js preloads planet images when it is imported; node has no Image.
globalThis.Image ??= class { set src(_v) {} };
const { PLANET_IMAGE_PATHS } = await import("../../public/scripts/starmap.js");

// AB#741: every Sol planet and moon is drawn from a real image, none from FALLBACK_PLANET_STYLE, and every image is
// small enough for the canvas and credited. The catalog is data/systems.json, so a body added there without an image
// fails here.
const root = path.resolve(import.meta.dirname, "../..");
const systems = JSON.parse(fs.readFileSync(path.join(root, "data/systems.json"), "utf8"));
const sol = systems.find((s) => s.id === "sol");
const dir = path.join(root, "public/images/planets");
const credits = fs.readFileSync(path.join(dir, "CREDITS.md"), "utf8");
const fileOf = (p) => path.join(root, "public", p.replace(/^\//, ""));

describe("Sol bodies on the starmap have real images (AB#741)", () => {
  it("every Sol planet and moon has an image, so none falls back to the generic style", () => {
    const drawnAsDiscs = sol.bodies.filter((b) => b.type !== "Field");
    expect(drawnAsDiscs.length).toBe(17);
    for (const body of drawnAsDiscs) expect(PLANET_IMAGE_PATHS[body.id], body.id).toBeTruthy();
  });

  it("the asteroid belt has none, because it is drawn as a field of asteroids, never as a disc", () => {
    const fields = sol.bodies.filter((b) => b.type === "Field").map((b) => b.id);
    expect(fields).toEqual(["belt"]);
    expect(PLANET_IMAGE_PATHS.belt).toBeUndefined();
  });

  it("each image exists, is a JPEG, and is under 150 KB", () => {
    for (const [id, p] of Object.entries(PLANET_IMAGE_PATHS)) {
      const file = fileOf(p);
      expect(fs.existsSync(file), `${id}: ${p}`).toBe(true);
      const bytes = fs.readFileSync(file);
      expect(bytes.subarray(0, 3).toString("hex"), `${id} is a JPEG`).toBe("ffd8ff");
      expect(bytes.length, `${id} is ${bytes.length} bytes`).toBeLessThan(150 * 1024);
    }
  });

  it("every image is credited in CREDITS.md, and every image in the folder is used", () => {
    const used = new Set(Object.values(PLANET_IMAGE_PATHS).map((p) => path.basename(p)));
    const present = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f));
    expect(present.sort()).toEqual([...used].sort());
    for (const file of used) expect(credits, `${file} in CREDITS.md`).toMatch(new RegExp(`^\\| ${file.replace(".", "\\.")} \\|`, "m"));
    // No image row credits a foreign agency or carries a Creative Commons licence (the prose above the table names them).
    const rows = credits.split("\n").filter((l) => /^\| \w+\.jpg \|/.test(l));
    expect(rows).toHaveLength(used.size);
    for (const row of rows) expect(row).not.toMatch(/CC BY|\bDLR\b|\bESA\b/);
  });
});
