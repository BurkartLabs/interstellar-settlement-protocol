import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bodyResourceHtml, LEASE_RESOURCE } from "../../public/scripts/bodyInfo.js";

// AB#740: the starmap's body panel shows the server's catalogue, and nothing derived from a hash of a body's id.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const systems = JSON.parse(read("data/systems.json"));
const bodies = (Array.isArray(systems) ? systems : systems.systems).flatMap((s) => s.bodies || []);
const stations = JSON.parse(read("data/stations.json")).stations;
const starmap = read("public/scripts/starmap.js");

describe("the starmap body panel (AB#740)", () => {
  it("every leasable body shows its catalogue lease cost, where it is filed and what it produces", () => {
    const leasable = bodies.filter((b) => Number(b.leaseCost) > 0);
    expect(leasable.map((b) => b.name).sort()).toEqual(["Earth", "Luna", "Mars"]);
    for (const b of leasable) {
      const html = bodyResourceHtml(b, stations);
      expect(html, b.name).toContain(`data-lease-cost="${b.leaseCost}">${b.leaseCost.toLocaleString("en-US")} credits`);
      expect(html).toContain(stations.find((s) => s.body === b.name).name);
      expect(html).toContain(`<strong>${LEASE_RESOURCE}</strong>`);
      expect(html).not.toMatch(/\d+%/);
    }
  });

  it("a body with no lease terms says Not surveyed, with no number", () => {
    const other = bodies.find((b) => !(Number(b.leaseCost) > 0) && b.type !== "Field");
    const html = bodyResourceHtml(other, stations);
    expect(html).toContain("Not surveyed.");
    expect(html).not.toMatch(/\d/);
  });

  it("escapes a body's name", () => {
    expect(bodyResourceHtml({ name: "<img src=x>" }, [])).not.toContain("<img");
  });

  it("starmap.js has no hash-derived composition, and no panel template uses a seed", () => {
    expect(starmap).not.toMatch(/generatedComposition|asteroidComposition|isBodyScouted|onScoutBody/);
    const templates = [...starmap.matchAll(/innerHTML = `([\s\S]*?)`;/g)].map((m) => m[1]);
    expect(templates.length).toBeGreaterThan(3);
    for (const t of templates) expect(t).not.toMatch(/seed/i);
  });

  it("the client keeps no pretend scouting of planets", () => {
    expect(read("public/scripts/app.js")).not.toMatch(/scoutedBodies/);
  });
});
