import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { bodyFeatures, isProcedural, seededRandom, SURFACES } from "../../public/scripts/bodyRender.js";
import { normalizeSystems } from "../../server/game/shape.js";

// starmap.js preloads planet images when it is imported; node has no Image.
globalThis.Image ??= class { set src(_v) {} };
const { bodyRenderKind } = await import("../../public/scripts/starmap.js");

// AB#742 (ISP-56): the 20 bodies outside Sol are fictional, so each is drawn from a style in data/systems.json, seeded
// by its id. This walks the catalogue itself, so a body added there without a way to be drawn fails here.
const root = path.resolve(import.meta.dirname, "../..");
const systems = JSON.parse(fs.readFileSync(path.join(root, "data/systems.json"), "utf8"));
const every = systems.flatMap((s) => s.bodies.map((b) => ({ system: s.id, ...b })));
const outsideSol = every.filter((b) => b.system !== "sol");
const HEX = /^#[0-9a-f]{6}$/i;

describe("every body is drawn as something real, never the placeholder circle (AB#742)", () => {
  it("walks all 55 bodies in the twelve systems (AB#806 added six systems and 17 bodies)", () => {
    expect(systems).toHaveLength(12);
    expect(every).toHaveLength(55);
    expect(outsideSol).toHaveLength(37);
  });

  it("no body in any system falls back to the placeholder", () => {
    expect(every.filter((b) => bodyRenderKind(b) === "placeholder").map((b) => `${b.system}/${b.id}`)).toEqual([]);
  });

  it("the check can fail: a disc with no image and no style is the placeholder", () => {
    expect(bodyRenderKind({ id: "nowhere", type: "Planet" })).toBe("placeholder");
    expect(bodyRenderKind({ id: "nowhere", type: "Planet", style: { surface: "tartan" } })).toBe("placeholder");
  });

  it("every body outside Sol has a style entry; each disc is procedural and each field has a belt tint", () => {
    for (const body of outsideSol) {
      const { style } = body;
      expect(style, body.id).toBeTruthy();
      for (const key of ["base", "shadow", "accent"]) expect(style[key], `${body.id}.${key}`).toMatch(HEX);
      expect(style.glow, `${body.id}.glow`).toMatch(/^rgba\(/);
      if (body.type === "Field") {
        expect(style.surface, body.id).toBe("field");
        expect(bodyRenderKind(body)).toBe("belt");
      } else {
        expect(SURFACES, body.id).toContain(style.surface);
        expect(isProcedural(body), body.id).toBe(true);
        expect(bodyRenderKind(body)).toBe("procedural");
      }
    }
  });
});

describe("a procedural body is the same on every load (AB#742)", () => {
  const discs = outsideSol.filter((b) => b.type !== "Field");

  it("the generator is seeded: the same seed gives the same sequence, another seed a different one", () => {
    const a = seededRandom("ac-prime");
    const b = seededRandom("ac-prime");
    const c = seededRandom("bn-iron");
    const run = (r) => Array.from({ length: 8 }, r);
    expect(run(a)).toEqual(run(b));
    expect(run(seededRandom("ac-prime"))).not.toEqual(run(c));
  });

  it("each body's features are identical when generated twice, from a fresh copy of the body", () => {
    for (const body of discs) {
      const first = bodyFeatures(body);
      expect(first.length, body.id).toBeGreaterThan(3);
      expect(bodyFeatures(JSON.parse(JSON.stringify(body))), body.id).toEqual(first);
    }
  });

  it("no two bodies share a layout, and every feature sits on or near the disc", () => {
    const layouts = new Set(discs.map((b) => JSON.stringify(bodyFeatures(b))));
    expect(layouts.size).toBe(discs.length);
    for (const body of discs) {
      for (const f of bodyFeatures(body)) {
        const coords = [f.x, f.y, ...(f.points || []).flat()].filter((v) => v !== undefined);
        for (const v of coords) expect(Math.abs(v), `${body.id} ${f.kind}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("every moon is drawn somewhere (Bug #2112)", () => {
  it("each Moon names a parentId that is a Planet in its own system, so its planet's close-up draws it", () => {
    const orphans = [];
    for (const system of systems) {
      for (const moon of system.bodies.filter((b) => b.type === "Moon")) {
        const parent = system.bodies.find((b) => b.id === moon.parentId);
        if (parent?.type !== "Planet") orphans.push(`${system.id}/${moon.id}`);
      }
    }
    expect(orphans).toEqual([]);
  });
});

describe("a saved world gets the catalogue's styles on load (AB#742)", () => {
  it("moons persisted without a parent get the catalogue's parentId (Bug #2112)", () => {
    const saved = JSON.parse(JSON.stringify(systems));
    for (const s of saved) for (const b of s.bodies) if (b.id !== "luna") delete b.parentId;
    const moons = normalizeSystems(saved).flatMap((s) => s.bodies).filter((b) => b.type === "Moon");
    expect(moons.filter((m) => !m.parentId).map((m) => m.id)).toEqual([]);
  });

  it("bodies persisted before styles existed are drawn procedurally after a reload", () => {
    const saved = JSON.parse(JSON.stringify(systems));
    for (const s of saved) for (const b of s.bodies) delete b.style;
    const loaded = normalizeSystems(saved).flatMap((s) => s.bodies.map((b) => ({ system: s.id, ...b })));
    expect(loaded.filter((b) => b.system !== "sol" && !b.style).map((b) => b.id)).toEqual([]);
    expect(loaded.filter((b) => bodyRenderKind(b) === "placeholder").map((b) => b.id)).toEqual([]);
  });
});
