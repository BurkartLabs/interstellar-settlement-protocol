// server/catalogView.js: the systems catalog as anyone may see it (Bug #2355).
//
// A belt's contents are revealed by scouting it (Bug #1256; since AB#2330 per generation): the Starmap says "Material
// composition unknown. Scout this belt". /api/systems and the bootstrap's world sent every Field body's catalog
// composition and resource profile to any caller, signed in or not, so the scout gate hid nothing. A belt here keeps
// what the map draws (id, name, type, position, radius, style) and loses what is in it; a player's belts come only from
// GET /api/accounts/:id/gameplay/belt-compositions, which sends the belts that player scouted (beltView, AB#2331).
// Planets and moons are public: their profiles are what a lease yields, shown before a lease is bought (AB#829).

import { normalizeStateShape } from "./game/shape.js";
import { getSeedState } from "./game/world.js";

/** A body as the public sees it: a belt without its composition or resource profile; anything else unchanged. */
export function publicBody(body) {
  if (!body || body.type !== "Field") return body;
  const { composition, resourceProfile, ...drawn } = body;
  return drawn;
}

/** Every system with its belts' contents taken out. Copies; never changes what it is given. */
export function publicSystems(systems) {
  return (systems || []).map((system) => ({ ...system, bodies: (system.bodies || []).map(publicBody) }));
}

/**
 * Bug #4852: the world a player's page reads with its account: the catalog as anyone may see it (publicSystems, so a
 * belt's contents stay with the scout gate, Bug #2355), the resource catalog and the refinery chains. One object for
 * every account, built once and frozen, so a read neither copies it nor lets a caller change it.
 */
let PUBLIC_WORLD = null;
export function publicWorld() {
  if (PUBLIC_WORLD) return PUBLIC_WORLD;
  const world = normalizeStateShape(getSeedState()).world;
  const freeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };
  PUBLIC_WORLD = freeze({ ...world, systems: publicSystems(world.systems) });
  return PUBLIC_WORLD;
}
