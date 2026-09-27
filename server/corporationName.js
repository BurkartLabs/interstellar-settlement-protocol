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

// ISP-121 (AB#813): letters that pass for Latin ones. The character rule below already refuses anything but ASCII, so
// these are defence in depth: the reserved-name check runs on the folded name first, and would still hold if the
// character rule were ever widened.
const LOOKALIKES = {
  // Cyrillic
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", ѕ: "s",
  і: "i", ї: "i", ј: "j", ԁ: "d", ӏ: "l", ɡ: "g", ԛ: "q", ԝ: "w",
  // Greek
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", μ: "u", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", γ: "y"
};
// ASCII stand-ins: digits and symbols for the letters they are read as. "i", "l", "1", "|" and "!" are one letter here,
// so "GEX Commodltles" and "1SA System" are the names they imitate.
const ASCII_LOOKALIKES = { 0: "o", 1: "l", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", $: "s", "@": "a", "|": "l", "!": "l", i: "l" };

/**
 * A name as a reader would take it (AB#813): accents dropped, look-alike letters and digits made the letters they
 * imitate, "rn" read as "m" and "vv" as "w", lower case, and every run of spaces or separators (- ' . & _) one space.
 */
export function foldName(name) {
  let s = String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  s = [...s].map((ch) => LOOKALIKES[ch] ?? ch).join("");
  s = [...s].map((ch) => ASCII_LOOKALIKES[ch] ?? ch).join("");
  s = s.replace(/rn/g, "m").replace(/vv/g, "w");
  return s.replace(/[\s\-'.&_]+/g, " ").trim();
}

/** Whether `name` passes for a reserved name: as whole words anywhere in it, or, run together, as the whole of it (or
 *  inside it, for names long enough that it cannot be chance). "Visa Systems" does not contain "ISA System". */
function passesFor(name, reserved) {
  const key = foldName(name);
  const compact = key.replace(/ /g, "");
  return reserved.some((r) => {
    const want = foldName(r);
    if (!want) return false;
    if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(want)}($|[^a-z0-9])`).test(key)) return true;
    const run = want.replace(/ /g, "");
    return compact === run || (run.length >= 12 && compact.includes(run));
  });
}

/**
 * The name to store, or why not. `existingNames` are the other corporations' names; `reservedNames` are the game's own
 * institutions, refused when they appear as whole words anywhere in the name ("GEX Commodities Authority Holdings"),
 * but not inside other words ("Visa Systems" does not contain "ISA System"). ISP-197 (AB#891): a conglomerate's name is
 * checked by this same function with `noun: "conglomerate"`, and every refusal carries a `code` saying which rule it broke.
 */
export function validateCorporationName(raw, { existingNames = [], reservedNames = [], noun = "corporation" } = {}) {
  const length = { error: `A ${noun} name must be ${CORPORATION_NAME_MIN_LENGTH} to ${CORPORATION_NAME_MAX_LENGTH} characters.`, code: "name-length" };
  // Bug #2050: ["Type Corp Four"] was read as "Type Corp Four". A name is a string or it is refused.
  if (raw !== undefined && raw !== null && typeof raw !== "string") return length;
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: `A ${noun} name is required.`, code: "name-required" };
  if (name.length < CORPORATION_NAME_MIN_LENGTH || name.length > CORPORATION_NAME_MAX_LENGTH) return length;
  // AB#813: an institution's name is refused however it is dressed up, before the character rule, so a look-alike is
  // told it is taken rather than only that a letter is not allowed. The message never repeats the name back.
  if (passesFor(name, reservedNames)) return { error: "That name belongs to an institution in the game; choose another.", code: "name-reserved" };
  if (!ALLOWED.test(name)) return { error: `A ${noun} name may use letters, digits, spaces and - ' . & only.`, code: "name-characters" };
  // AB#813: another player's name, the same way ("Kessler 0re Brokers" is Kessler Ore Brokers).
  if (existingNames.some((n) => foldName(n) === foldName(name))) {
    return { error: noun === "corporation" ? "A corporation with this name already exists." : "A corporation or conglomerate already has this name.", code: "name-taken" };
  }
  return { name };
}
