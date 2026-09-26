// ISP-116 (AB#808): on a phone the Starmap's cluster view names only the system you are in, the selected one and its
// neighbours; every other system is a dot, named when tapped. A spec that finds a system by its name falls back to
// tapping its star where data/systems.json puts it (mapPosition, fractions of the canvas).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SYSTEMS = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "systems.json"), "utf8"));

/** Taps `name`'s star on the cluster canvas at its catalog position. */
export async function tapStarByCatalog(canvas, name) {
  const system = SYSTEMS.find((s) => s.name === name);
  if (!system) throw new Error(`${name} is not in data/systems.json`);
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: system.mapPosition.x * box.width, y: system.mapPosition.y * box.height } });
}
