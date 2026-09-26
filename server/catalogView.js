// server/catalogView.js: the systems catalog as anyone may see it (Bug #2355).
//
// A belt's contents are revealed by scouting it (Bug #1256; since AB#2330 per generation): the Starmap says "Material
// composition unknown. Scout this belt". /api/systems and the bootstrap's world sent every Field body's catalog
// composition and resource profile to any caller, signed in or not, so the scout gate hid nothing. A belt here keeps
// what the map draws (id, name, type, position, radius, style) and loses what is in it; a player's belts come only from
// GET /api/accounts/:id/gameplay/belt-compositions, which sends the belts that player scouted (beltView, AB#2331).
// Planets and moons are public: their profiles are what a lease yields, shown before a lease is bought (AB#829).

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
