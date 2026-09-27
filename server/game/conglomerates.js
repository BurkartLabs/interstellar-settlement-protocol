// server/game/conglomerates.js: the conglomerates themselves, and the charter that founds one (ISP-197, AB#891;
// docs/design/CONGLOMERATES.md, Part 1, "The charter"). The numbers are data/conglomerates.json (AB#890).
//
// Conglomerates live in the accounts snapshot beside the accounts (accountsStore.conglomerates), not in the global state:
// the charter takes the fee from a corporation and creates the conglomerate as one change, and one file written once is
// what makes that one change on disk as well as in memory. The global state is also sent to clients; this is not.
//
// Names are unique however they are written: an index keyed by the folded name (foldName, AB#813) refuses a second
// conglomerate with a name the first already holds, whatever path reached the insert. migrations/35_conglomerates.sql
// is the same rule as a unique index, for v0.6's Postgres.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONGLOMERATE_CATALOG } from "../conglomerates.js";
import { foldName, validateCorporationName } from "../corporationName.js";
import { applyCredits } from "../finances.js";
import { reservedNamesError } from "../npcCorporations.js";
import { createId, deepClone } from "./catalog.js";
import { RESERVED_CORPORATION_NAMES } from "./world.js";
import { accountsStore, closeFinancialDays, sanitizeAccount, saveAccountsNow } from "./store.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");

/**
 * The names a conglomerate may not take: every name a corporation may not, plus the short codes the game's institutions
 * sign with (every faction code in the building and station catalogs, and GEX, the exchange's own short name). A
 * conglomerate speaks for many corporations at once, so "ISA Frontier Group" would pass for the Authority's own body.
 */
export const RESERVED_CONGLOMERATE_NAMES = Object.freeze([...new Set([
  ...RESERVED_CORPORATION_NAMES,
  "GEX",
  ...["buildings.json", "stations.json"].flatMap((file) => {
    const doc = JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
    return Object.values(doc).filter(Array.isArray).flat().map((e) => e?.factionCode).filter((c) => typeof c === "string" && c);
  })
])]);

/** Every conglomerate, the stored list itself. */
export function conglomerateList() {
  if (!Array.isArray(accountsStore.conglomerates)) accountsStore.conglomerates = [];
  return accountsStore.conglomerates;
}

/**
 * Whether the conglomerate still holds its name: always while it exists, and for nameReleaseDays after it is dissolved,
 * so a dissolved name cannot be seized at once to impersonate the old group (ISP-199, AB#893).
 */
export function holdsName(c, now = Date.now()) {
  return !c.dissolvedAt || now < c.dissolvedAt + CONGLOMERATE_CATALOG.nameReleaseDays * DAY_MS;
}

/** The unique index: folded name to conglomerate id, over every conglomerate that holds its name, built at each insert. */
function nameIndex(now = Date.now()) {
  return new Map(conglomerateList().filter((c) => holdsName(c, now)).map((c) => [foldName(c.name), c.id]));
}

/** Add a conglomerate. Throws when its name is already held (the unique index), so no path can store two. */
function insertConglomerate(record) {
  if (nameIndex().has(foldName(record.name))) throw new Error("conglomerate name already held");
  conglomerateList().push(record);
}

/** What anyone signed in may see of a conglomerate: never an account id, never a corporation's own figures. */
export function publicConglomerate(c) {
  return { id: c.id, name: c.name, emblem: c.emblem, colour: c.colour, level: c.level, memberCount: c.members.length, maxMembers: c.maxMembers };
}

/** The public directory, oldest first. */
export function conglomerateDirectory() {
  return conglomerateList().filter((c) => !c.dissolvedAt).map(publicConglomerate);
}

/** The refusal for each rule the charter checks: an HTTP status, a code, and copy saying what to do about it. */
const REFUSALS = {
  "charter-unavailable": ({ status = 503 } = {}) => ({ status, error: "The Conglomerate Affairs Bureau cannot file charters just now; try again later." }),
  "already-in-conglomerate": () => ({ status: 409, error: "Your corporation is already in a conglomerate. Leave it before you found another." }),
  "founder-too-young": ({ from }) => ({ status: 409, error: `A corporation can found a conglomerate ${CONGLOMERATE_CATALOG.minFounderAgeDays} days after it was registered. Yours can from ${new Date(from).toISOString().slice(0, 16).replace("T", " ")} UTC.` }),
  "join-cooldown": ({ until }) => ({ status: 409, error: `Your corporation left a conglomerate recently and cannot found or join one until ${new Date(until).toISOString().slice(0, 16).replace("T", " ")} UTC.` }),
  "not-at-bureau": () => ({ status: 409, error: "Charters are filed at the Conglomerate Affairs Bureau on Earth Station Prime. Travel there, then file." }),
  "insufficient-credits": ({ needed, held }) => ({ status: 409, error: `The charter costs ${needed.toLocaleString("en-US")} credits (a ${CONGLOMERATE_CATALOG.charterFee.toLocaleString("en-US")} fee and a ${CONGLOMERATE_CATALOG.charterDeposit.toLocaleString("en-US")} deposit into the new treasury). Your corporation holds ${held.toLocaleString("en-US")}.` }),
  "invalid-emblem": () => ({ status: 400, error: `Choose an emblem from the Bureau's ${CONGLOMERATE_CATALOG.emblems}.` }),
  "invalid-colour": () => ({ status: 400, error: `Choose a colour from the Bureau's ${CONGLOMERATE_CATALOG.colours}.` })
};

function refuse(code, detail = {}) {
  return { refused: { code, ...REFUSALS[code](detail) } };
}

/** Why this corporation may not found a conglomerate now, or null. The name is checked apart (charterNameCheck). */
export function charterRefusal(account, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const corp = account?.state?.corp;
  if (!corp?.publicId) return refuse("charter-unavailable");
  if (corp.conglomerateId) return refuse("already-in-conglomerate");
  const from = Number(account.createdAt) + catalog.minFounderAgeDays * DAY_MS;
  if (!Number.isFinite(from)) return refuse("charter-unavailable");
  if (now < from) return refuse("founder-too-young", { from });
  const until = Number(corp.joinCooldownUntil) || 0;
  if (until > now) return refuse("join-cooldown", { until });
  if (corp.currentStationId !== catalog.charterStationId) return refuse("not-at-bureau");
  const needed = catalog.charterFee + catalog.charterDeposit;
  const held = Number(corp.finances?.credits);
  if (!Number.isFinite(held)) return refuse("charter-unavailable");
  if (held < needed) return refuse("insufficient-credits", { needed, held: Math.floor(held) });
  return null;
}

/** The name the charter would store, or its refusal: the corporation-name rules, against every corporation's and every conglomerate's name. */
export function charterNameCheck(raw) {
  // AB#813: without the reserved list every name would pass, so the charter fails closed, as registration does.
  if (reservedNamesError) return refuse("charter-unavailable");
  const existingNames = [
    ...Object.values(accountsStore.accounts || {}).map((a) => a?.state?.corp?.corporationName).filter(Boolean),
    ...conglomerateList().filter((c) => holdsName(c)).map((c) => c.name)
  ];
  const result = validateCorporationName(raw, { existingNames, reservedNames: RESERVED_CONGLOMERATE_NAMES, noun: "conglomerate" });
  if (result.error) return { refused: { status: result.code === "name-taken" ? 409 : 400, code: result.code, error: result.error } };
  return { name: result.name };
}

/**
 * Found a conglomerate for `accountId`: the founder becomes its only member, the fee leaves the economy, and the deposit
 * becomes the treasury. Either every part happens or none does: a failure part-way (`hooks.afterCharge` lets a test
 * make one) puts the corporation back as it was and stores no conglomerate. Returns { account, conglomerate } or
 * { refused: { status, code, error } }.
 */
export function foundConglomerate(accountId, { name, emblem, colour } = {}, now = Date.now(), hooks = {}) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return { refused: { status: 404, code: "no-account", error: "Account not found." } };
  let catalog;
  try {
    catalog = CONGLOMERATE_CATALOG;
    if (!catalog) return refuse("charter-unavailable");
    closeFinancialDays(account, now);
    const refusal = charterRefusal(account, now, catalog);
    if (refusal) return refusal;
    if (!Number.isInteger(emblem) || emblem < 1 || emblem > catalog.emblems) return refuse("invalid-emblem");
    if (!Number.isInteger(colour) || colour < 1 || colour > catalog.colours) return refuse("invalid-colour");
    const named = charterNameCheck(name);
    if (named.refused) return named;
    name = named.name;
  } catch (error) {
    console.error("[conglomerates] the charter check could not run:", error?.message || error);
    return refuse("charter-unavailable");
  }

  const corp = account.state.corp;
  const before = { finances: deepClone(corp.finances), conglomerateId: corp.conglomerateId ?? null, count: conglomerateList().length };
  const first = catalog.levels[0];
  const record = {
    id: createId("cgl"),
    name,
    emblem,
    colour,
    level: first.level,
    maxMembers: first.maxMembers,
    foundedAt: now,
    founder: corp.publicId,
    members: [{ corp: corp.publicId, role: "founder", joinedAt: now }],
    treasury: { credits: catalog.charterDeposit },
    invitations: [],
    applications: [],
    arrearsSince: null
  };
  try {
    applyCredits(corp, -catalog.charterFee, "conglomerate-charter", now);
    applyCredits(corp, -catalog.charterDeposit, "conglomerate-deposit", now);
    hooks.afterCharge?.();
    insertConglomerate(record);
    corp.conglomerateId = record.id;
    corp.joinCooldownUntil = null;
  } catch (error) {
    corp.finances = before.finances;
    corp.conglomerateId = before.conglomerateId;
    conglomerateList().splice(before.count);
    console.error("[conglomerates] a charter failed part-way and was undone:", error?.message || error);
    return refuse("charter-unavailable", { status: 500 });
  }
  saveAccountsNow(); // a purchase: on disk now, the fee and the conglomerate in the same write
  return { account: sanitizeAccount(account), conglomerate: { ...publicConglomerate(record), treasury: { ...record.treasury }, role: "founder" } };
}
