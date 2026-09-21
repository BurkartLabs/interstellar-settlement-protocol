// server/gameplayInput.js
// Hostile input on the gameplay routes (AB#731, ISP-45). Every route under /api/accounts/:accountId/gameplay is
// described here: each number is a whole number in a stated range, and each id is in the catalog it names or in the
// caller's own state. One middleware checks a request against its entry before any handler runs, so a refusal (400)
// never follows a partial write. Messages say what to enter and never repeat the request back.
//
// tests/integration/gameplay-input.test.js enumerates the routes Express has registered and fails if one is missing
// here, then posts "abc", NaN, Infinity, -5, 0, 2.5, a missing field and a 10,000-character string to every field.

/** Longer than any id or name the game uses; anything longer is refused unread. */
export const MAX_ID_LENGTH = 64;
/** Lines one transfer may carry (AB#717). */
const MAX_TRANSFER_LINES = 10;

const int = (min, max, label, extra = {}) => ({ kind: "int", min, max, label, ...extra });
const choice = (values, label, extra = {}) => ({ kind: "choice", values, label, ...extra });
const id = (catalog, label, extra = {}) => ({ kind: "id", catalog, label, ...extra });

const MISSION = { body: { missionId: id("missions", "a contract") } };
const NOTHING = {};

/**
 * Every gameplay route, keyed "METHOD /path" below the /gameplay mount. `optional: true` marks the few fields the
 * game's own client leaves out, where the route has a default; they are still checked whenever they are sent.
 */
export const GAMEPLAY_INPUT = {
  "POST /hire": { body: { count: int(1, 1000, "the number of employees to hire") } },
  "POST /rent-office": {
    body: {
      stationId: id("stations", "a station"),
      // The client sends no length on a first lease; the route leases for 7 days.
      durationDays: choice([7, 14, 21, 28], "a lease length of 7, 14, 21 or 28 days", { optional: true })
    }
  },
  "POST /renew-office": {
    body: { stationId: id("stations", "a station"), durationDays: choice([7, 14, 21, 28], "a lease length of 7, 14, 21 or 28 days") }
  },
  "POST /purchase-lease": { body: { body: id("leaseBodies", "a celestial body the ISA leases") } },
  "POST /transfer-resources": { custom: "transfer" },
  "POST /travel": { oneOf: { toSystemId: id("systems", "a star system"), toStationId: id("stations", "a station") } },
  "POST /lease/:leaseId/build-extractor": { params: { leaseId: id("ownLeases", "one of your mining leases") } },
  "POST /lease/:leaseId/start-mining": {
    params: { leaseId: id("ownLeases", "one of your mining leases") },
    body: {
      amount: int(10, 250, "a throughput from 10 to 250 tons per hour"),
      hours: int(1, 72, "a cycle length from 1 to 72 hours"),
      extractorId: id("ownExtractors", "one of your extractors")
    }
  },
  "POST /build-extractor": NOTHING,
  "POST /build-assembly-facility": NOTHING,
  "POST /build-mining-probe": NOTHING,
  "POST /build-refinery": NOTHING,
  "GET /belt-compositions": NOTHING,
  "POST /scout-belt": { body: { beltKey: id("belts", "an asteroid belt") } },
  "POST /launch-expedition": {
    body: { beltKey: id("belts", "an asteroid belt"), duration: id("expeditionDurations", "an expedition length") }
  },
  "POST /start-refinery": {
    body: {
      refineryId: id("ownRefineries", "one of your refineries"),
      chainId: id("refineryChains", "a refinery chain"),
      inputQuantity: int(1, 10_000_000, "an input quantity of at least 1")
    }
  },
  "POST /accept-mission": MISSION,
  "POST /abandon-mission": MISSION,
  "POST /complete-mission": MISSION,
  "POST /mine": {
    body: {
      amount: int(10, 250, "a throughput from 10 to 250 tons per hour"),
      hours: int(1, 72, "a cycle length from 1 to 72 hours"),
      // The older mining panel sends "" when no extractor is picked; the route then uses the first idle one.
      extractorId: id("ownExtractors", "one of your extractors", { optional: true })
    }
  },
  "POST /queue-rnd": { body: { techId: id("techs", "a research project") } },
  "POST /queue-ceo": { body: { programId: id("programs", "a CEO Insight program") } }
};

const refuse = (error) => ({ ok: false, error });
// Not sent: left out, or empty. An explicit null is sent, and refused: JSON turns NaN and Infinity into null.
const isAbsent = (v) => v === undefined || v === "";

/** A whole number from a JSON number or a string of digits; anything else (2.5, "abc", "NaN", "1e3", objects) is null. */
export function wholeNumber(value) {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && /^-?\d{1,15}$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** An id as a trimmed string of sensible length, or null. */
export function idString(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s && s.length <= MAX_ID_LENGTH ? s : null;
}

/** Check one field against its spec. `has(catalog, value)` answers catalog and own-state membership. */
export function checkField(spec, value, has) {
  if (isAbsent(value)) return spec.optional ? { ok: true } : refuse(`Enter ${spec.label}.`);
  if (value === null) return refuse(`Enter ${spec.label}.`);
  if (spec.kind === "int") {
    const n = wholeNumber(value);
    if (n === null || n < spec.min || n > spec.max) return refuse(`Enter ${spec.label}: a whole number from ${spec.min.toLocaleString()} to ${spec.max.toLocaleString()}.`);
    return { ok: true };
  }
  if (spec.kind === "choice") {
    const n = wholeNumber(value);
    return n !== null && spec.values.includes(n) ? { ok: true } : refuse(`Choose ${spec.label}.`);
  }
  const s = idString(value);
  if (s === null || !has(spec.catalog, s)) {
    return refuse(spec.catalog.startsWith("own") ? `Choose ${spec.label}; that one is not on your books.` : `Choose ${spec.label} from the game's list.`);
  }
  return { ok: true };
}

function checkTransfer(body, has) {
  const from = idString(body?.fromStationId);
  if (from === null || !has("stations", from)) return refuse("Choose a station to move goods from, from the Logistics tab.");
  const lines = Array.isArray(body?.lines) ? body.lines : body && "item" in body ? [{ item: body.item, quantity: body.quantity }] : null;
  if (!lines || lines.length === 0) return refuse("Add at least one item to move.");
  if (lines.length > MAX_TRANSFER_LINES) return refuse(`A transfer carries at most ${MAX_TRANSFER_LINES} lines. Split it into two transfers.`);
  for (let i = 0; i < lines.length; i += 1) {
    const item = idString(lines[i]?.item);
    if (item === null || !has("ownStock", `${from}|${item}`)) return refuse(`Line ${i + 1}: pick an item held at that station.`);
    const qty = checkField(int(1, 1_000_000_000, `a quantity for line ${i + 1}`), lines[i]?.quantity, has);
    if (!qty.ok) return qty;
  }
  return { ok: true };
}

/** Validate one request against its route's entry: { ok: true } or { ok: false, error }. */
export function validateGameplayRequest(entry, { body, params }, has) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  if (entry.custom === "transfer") return checkTransfer(b, has);
  for (const [name, spec] of Object.entries(entry.params || {})) {
    const r = checkField(spec, params?.[name], has);
    if (!r.ok) return r;
  }
  if (entry.oneOf) {
    const sent = Object.keys(entry.oneOf).filter((k) => !isAbsent(b[k]));
    if (sent.length !== 1) return refuse(`Choose one destination: ${Object.values(entry.oneOf).map((s) => s.label).join(" or ")}.`);
    return checkField(entry.oneOf[sent[0]], b[sent[0]], has);
  }
  for (const [name, spec] of Object.entries(entry.body || {})) {
    const r = checkField(spec, b[name], has);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/** "/lease/lease-123/start-mining" matched against "/lease/:leaseId/start-mining": the params, or null. */
export function matchRoute(pattern, path) {
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return null;
  const params = {};
  for (let i = 0; i < want.length; i += 1) {
    if (want[i].startsWith(":")) params[want[i].slice(1)] = decodeURIComponent(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

/**
 * The middleware. `catalogs` maps a catalog name to a Set of ids; `corpOf(accountId)` returns the caller's corporation
 * for the own-state checks (their leases, extractors, refineries and stock). Mounted after requireAccountAccess, so the
 * account is the caller's own.
 */
export function gameplayInputMiddleware({ catalogs, corpOf }) {
  const entries = Object.entries(GAMEPLAY_INPUT).map(([key, entry]) => {
    const [method, pattern] = key.split(" ");
    return { method, pattern, entry };
  });
  return (req, res, next) => {
    let match = null;
    for (const e of entries) {
      if (e.method !== req.method) continue;
      const params = matchRoute(e.pattern, req.path);
      if (params) { match = { ...e, params }; break; }
    }
    if (!match) return next(); // not a gameplay route: Express answers 404
    let corp = null;
    const own = () => (corp ??= corpOf(req.params.accountId) || {});
    const has = (catalog, value) => {
      if (catalog === "ownLeases") return (own().miningLeases || []).some((l) => l?.id === value);
      if (catalog === "ownExtractors") return (own().mining?.silicateExtractors || []).some((x) => x?.id === value);
      if (catalog === "ownRefineries") return (own().refineries || []).some((r) => r?.id === value);
      if (catalog === "ownStock") {
        const [station, item] = [value.slice(0, value.indexOf("|")), value.slice(value.indexOf("|") + 1)];
        const held = own().inventory?.[station];
        return Boolean(held && Object.hasOwn(held, item) && Number(held[item]) > 0);
      }
      // Lease bodies match without regard to case, as the purchase route resolves them.
      if (catalog === "leaseBodies") return catalogs.leaseBodies?.has(value.toLowerCase()) === true;
      return catalogs[catalog]?.has(value) === true;
    };
    const result = validateGameplayRequest(match.entry, { body: req.body, params: match.params }, has);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return next();
  };
}
