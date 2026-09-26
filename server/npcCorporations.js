// Sol's NPC corporations and the authorities (ISP-121, AB#813; docs/design/npc-corporations.md, AB#812).
//
// data/npc-corporations.json is the roster. Its names, with the system senders and the standing orders' buyers, are
// the names no player may register (Bug #433). The file is read once, when the server starts. If it cannot be read or
// is malformed, `reservedNamesError` says why and registration answers 503 (server/routes/auth.js): a broken list
// fails closed, never open with every name allowed.
//
// ISP_NPC_CATALOG points at another file, for the test that proves the fail-closed path.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "npc-corporations.json");

/** The catalog at `file`, checked for the fields reservation needs; throws with the reason when it is unusable. */
export function readNpcCatalog(file = process.env.ISP_NPC_CATALOG || DEFAULT_FILE) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const corporations = Array.isArray(raw?.corporations) ? raw.corporations : null;
  const authorities = Array.isArray(raw?.authorities) ? raw.authorities : null;
  if (!corporations || !corporations.length) throw new Error("no corporations");
  if (!authorities || !authorities.length) throw new Error("no authorities");
  for (const entry of [...corporations, ...authorities]) {
    if (typeof entry?.name !== "string" || !entry.name.trim()) throw new Error("an entry without a name");
  }
  return { corporations, authorities };
}

let catalog = null;
let loadError = null;
try {
  catalog = readNpcCatalog();
} catch (error) {
  loadError = error;
  console.error("[npc-corporations] the NPC catalog could not be read; registration is refused until it can:", error?.message);
}

/** The roster, or null when it could not be read. */
export const NPC_CATALOG = catalog;
/** Why the roster could not be read, or null. Registration refuses with 503 while this is set. */
export const reservedNamesError = loadError;
/** Every NPC corporation and authority name in the roster ([] when it could not be read). */
export const NPC_NAMES = Object.freeze(catalog ? [...catalog.corporations, ...catalog.authorities].map((e) => e.name.trim()) : []);
