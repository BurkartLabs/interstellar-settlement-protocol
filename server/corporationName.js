// Corporation names (Bug #433).
//
// The name is the only trust signal on the order book, in trade history, on the forums and in mail, and nothing ever
// renames a corporation, so it is checked once, when the corporation is created. Letters are ASCII on purpose: a
// Cyrillic "Е" would otherwise let "GЕX Commodities Authority" pass for the exchange authority.

export const CORPORATION_NAME_MIN_LENGTH = 3;
export const CORPORATION_NAME_MAX_LENGTH = 40;

/** Every name the game's own messages are signed with. Senders use these, so the reserved list cannot miss one. */
export const SYSTEM_SENDERS = Object.freeze({
  AUTHORITY: "Interstellar Settlement Authority",
  SYSTEM: "ISA System",
  MINERAL_SURVEY: "ISA Mineral Survey Division"
});

// ISP-66: the same character set a CEO's own name is checked against — a name is a name, and one rule for both
// means "what characters are allowed in a name" has one answer, not two that could drift.
export const NAME_CHARS = /^[A-Za-z0-9 \-'.&]+$/;
const ALLOWED = NAME_CHARS;

/** Case, and runs of spaces, do not make two names different. */
export function nameKey(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The name to store, or why not. `existingNames` are the other corporations' names; `reservedNames` are the game's own
 * institutions, refused when they appear as whole words anywhere in the name ("GEX Commodities Authority Holdings"),
 * but not inside other words ("Visa Systems" does not contain "ISA System").
 */
export function validateCorporationName(raw, { existingNames = [], reservedNames = [] } = {}) {
  // Bug #2050: ["Type Corp Four"] was read as "Type Corp Four". A name is a string or it is refused.
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return { error: `A corporation name must be ${CORPORATION_NAME_MIN_LENGTH} to ${CORPORATION_NAME_MAX_LENGTH} characters.` };
  }
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "A corporation name is required." };
  if (name.length < CORPORATION_NAME_MIN_LENGTH || name.length > CORPORATION_NAME_MAX_LENGTH) {
    return { error: `A corporation name must be ${CORPORATION_NAME_MIN_LENGTH} to ${CORPORATION_NAME_MAX_LENGTH} characters.` };
  }
  if (!ALLOWED.test(name)) return { error: "A corporation name may use letters, digits, spaces and - ' . & only." };

  const key = nameKey(name);
  const reserved = reservedNames.some((r) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(nameKey(r))}($|[^a-z0-9])`).test(key));
  if (reserved) return { error: "That name belongs to an institution in the game; choose another." };
  if (existingNames.some((n) => nameKey(n) === key)) return { error: "A corporation with this name already exists." };
  return { name };
}
