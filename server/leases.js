// Mining leases: which body a lease is for, what it costs, and whether the corporation can reach it (Bug #691).
//
// Before this, POST /gameplay/purchase-lease took any string as the body: bodies that do not exist, bodies in
// systems the corporation had never reached, strings of any length and markup, all at a default 25,000. The catalog
// (data/systems.json) is now the only source of what can be leased and for how much, and anything it does not
// price fails closed.

/** Longer than any real body name, short enough that nothing unbounded is ever looked up. */
export const LEASE_BODY_MAX_LENGTH = 64;

import { canReachSystem } from "../public/scripts/navigation.js";

// The travel gate lives in public/scripts/navigation.js, shared with the travel route and the starmap (Bug #976).
export { researchForSystem } from "../public/scripts/navigation.js";

/** A corporation can reach Sol, the system it is in, and any system its research opens. */
export function systemAccessible(corp, systemId) {
  return canReachSystem(corp?.unlockedTech, corp?.currentSystemId, systemId);
}

/**
 * Resolve what a player asked to lease against the catalog. Returns { ok: true, body, bodyId, systemId, cost } with
 * the catalog's own name, or { ok: false, error }. The error never repeats the input.
 */
export function resolveLeaseBody(catalog, corp, input) {
  const requested = typeof input === "string" ? input.trim() : "";
  if (!requested) return { ok: false, error: "A celestial body must be specified." };
  if (requested.length > LEASE_BODY_MAX_LENGTH) return { ok: false, error: "That is not a celestial body the ISA recognises." };

  const wanted = requested.toLowerCase();
  for (const system of catalog) {
    const body = (system.bodies || []).find((b) => b.name.toLowerCase() === wanted || String(b.id).toLowerCase() === wanted);
    if (!body) continue;
    if (!Number.isFinite(body.leaseCost) || body.leaseCost <= 0) {
      return { ok: false, error: `The ISA does not issue mining leases on ${body.name}.` };
    }
    if (!systemAccessible(corp, system.id)) {
      return { ok: false, error: `${body.name} is in ${system.name}, which your corporation cannot reach yet.` };
    }
    return { ok: true, body: body.name, bodyId: body.id, systemId: system.id, cost: body.leaseCost };
  }
  return { ok: false, error: "That is not a celestial body the ISA recognises." };
}

/** How many stored leases name a body the catalog does not have. A count only: it is logged, never who holds them. */
export function unknownLeaseBodies(catalog, accounts) {
  const known = new Set(catalog.flatMap((s) => (s.bodies || []).map((b) => b.name)));
  let n = 0;
  for (const account of accounts) {
    for (const lease of account?.state?.corp?.miningLeases || []) {
      if (!known.has(lease?.body || lease)) n++;
    }
  }
  return n;
}
