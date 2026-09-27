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
    levelSince: now, // ISP-202 (AB#896): when it reached its level; the next needs minDaysAtPrevious here
    founder: corp.publicId,
    members: [{ corp: corp.publicId, role: "founder", joinedAt: now }],
    treasury: { credits: 0 },
    ledger: [], // ISP-204 (AB#898): the deposit below is its first row
    withdrawals: [],
    upkeepPaidThrough: dayStartOf(now) + DAY_MS,
    arrearsOwed: 0,
    invitations: [],
    applications: [],
    arrearsSince: null
  };
  try {
    applyCredits(corp, -catalog.charterFee, "conglomerate-charter", now);
    applyCredits(corp, -catalog.charterDeposit, "conglomerate-deposit", now);
    hooks.afterCharge?.();
    moveTreasury(record, { at: now, kind: "charter-deposit", corp: corp.publicId, amount: catalog.charterDeposit, by: corp.publicId });
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

// ─── Levels (ISP-202, AB#896; docs/design/CONGLOMERATES.md, "The level ladder, 5 to 100 members") ───────────────────

/** A day's upkeep at `members`: each member pays upkeepBase, plus upkeepPerMemberStep for every member above upkeepMinMembers. */
export function dailyUpkeep(members, catalog = CONGLOMERATE_CATALOG) {
  const n = Math.max(0, Math.floor(Number(members) || 0));
  return n * (catalog.upkeepBase + catalog.upkeepPerMemberStep * Math.max(0, n - catalog.upkeepMinMembers));
}

/**
 * What each level requirement reads, and every server function that writes it (T-019: a requirement on a stat nothing
 * writes can never be met). tests/integration/conglomerate-levels.test.js holds each name to a function that writes
 * the stat. The fourth requirement, not in arrears, arrived with upkeep (ISP-204, AB#898), which is what sets it.
 */
export const LEVEL_STAT_WRITERS = Object.freeze({
  "treasury.credits": Object.freeze(["moveTreasury", "foundConglomerate", "buyConglomerateLevel", "dissolveConglomerate", "depositToTreasury", "withdrawFromTreasury", "settleTreasury"]),
  members: Object.freeze(["foundConglomerate", "answerInvitation", "answerApplication", "leaveConglomerate", "removeMember", "settleSuccession", "dissolveConglomerate"]),
  levelSince: Object.freeze(["foundConglomerate", "buyConglomerateLevel", "settleTreasury"]),
  // ISP-204 (AB#898): upkeep puts a conglomerate in arrears; paying what is owed ends them.
  arrearsSince: Object.freeze(["settleTreasury", "payArrears"])
});

const plain = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");

/**
 * The next level and whether the conglomerate may buy it now: { level, next, requirements, ready }, { top: true } at
 * the last level, or { refusal } when the catalog's rows for this level cannot be read (fails closed). Each requirement
 * is { id, stat, label, need, have, met }, read from server state only.
 */
export function levelStatus(c, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  const current = catalog?.levels?.[c.level - 1];
  if (!current || current.level !== c.level) return { refusal: "This conglomerate's level is not one the Bureau knows." };
  const next = catalog.levels[c.level];
  if (!next) return { level: c.level, top: true };
  const whole = (v) => Number.isInteger(v) && v >= 0;
  if (next.level !== c.level + 1 || !whole(next.cost) || !whole(next.maxMembers) || !whole(next.minDaysAtPrevious) || (next.researchRequired || []).length) {
    return { refusal: `The Bureau cannot read level ${c.level + 1}'s terms.` };
  }
  const members = c.members.length;
  const treasury = Math.floor(Number(c.treasury?.credits) || 0);
  const reserve = dailyUpkeep(members, catalog) * catalog.levelReserveDays;
  const needed = Math.ceil((current.maxMembers * catalog.levelFillPct) / 100);
  const since = Number(c.levelSince ?? c.foundedAt) || 0;
  const readyAt = since + next.minDaysAtPrevious * DAY_MS;
  const requirements = [
    { id: "funds", stat: "treasury.credits", label: `The treasury pays ${plain(next.cost)} credits and keeps ${plain(reserve)} (${catalog.levelReserveDays} days of upkeep for ${members})`, need: next.cost + reserve, have: treasury, met: treasury >= next.cost + reserve },
    { id: "members", stat: "members", label: `At least ${needed} members (${catalog.levelFillPct}% of ${current.maxMembers})`, need: needed, have: members, met: members >= needed },
    { id: "days", stat: "levelSince", label: `${next.minDaysAtPrevious} days at level ${c.level}`, need: readyAt, have: now, met: now >= readyAt },
    { id: "arrears", stat: "arrearsSince", label: "No upkeep in arrears", need: 0, have: Math.floor(Number(c.arrearsOwed) || 0), met: !c.arrearsSince }
  ];
  return { level: c.level, next: { level: next.level, maxMembers: next.maxMembers, cost: next.cost }, requirements, ready: requirements.every((r) => r.met) };
}

// ─── The treasury: its ledger, upkeep and arrears (ISP-204, AB#898; docs/design/CONGLOMERATES.md, "The treasury and
// upkeep" and "Pooling") ────────────────────────────────────────────────────────────────────────────────────────────
//
// moveTreasury is the only way the balance changes, and it writes exactly one ledger row, so the ledger's amounts sum to
// the balance (an opening row stands for what an older conglomerate held before the ledger existed). Rows are frozen
// and no route edits or removes one: a correction is a new row. settleTreasury brings a conglomerate up to `now` on
// every read: announced withdrawals that are due, and each UTC midnight's upkeep, in the order they fell.

export const dayStartOf = (t) => Math.floor(t / DAY_MS) * DAY_MS;

/** Give an older conglomerate a ledger (one opening row for what it holds), a withdrawal list and an upkeep clock. */
export function ensureTreasury(c, now = Date.now()) {
  if (!c.treasury || typeof c.treasury !== "object") c.treasury = { credits: 0 };
  if (!Array.isArray(c.ledger)) {
    const credits = Math.max(0, Math.floor(Number(c.treasury.credits) || 0));
    c.treasury.credits = credits;
    c.ledger = credits ? [{ id: createId("cled"), at: Number(c.foundedAt) || now, kind: "opening", corp: c.founder, item: "credits", amount: credits, balanceAfter: credits, by: "bureau" }] : [];
  }
  if (!Array.isArray(c.withdrawals)) c.withdrawals = [];
  if (!Number.isFinite(c.upkeepPaidThrough)) c.upkeepPaidThrough = dayStartOf(now) + DAY_MS; // the first charge: next midnight
  if (!Number.isFinite(c.arrearsOwed)) c.arrearsOwed = 0;
  if (c.arrearsSince === undefined) c.arrearsSince = null;
}

/**
 * Move the treasury by `amount` (signed, whole credits) and write the one ledger row that says so. Throws, changing
 * nothing, on an amount that is not a whole number or a balance that would fall below zero.
 */
export function moveTreasury(c, { at, kind, corp = null, amount, by = null, note }) {
  if (!Number.isSafeInteger(amount)) throw new TypeError(`moveTreasury: ${String(amount)} is not a whole number of credits`);
  const after = Math.floor(Number(c.treasury.credits) || 0) + amount;
  if (after < 0) throw new RangeError("moveTreasury: the treasury cannot go below zero");
  const row = Object.freeze({ id: createId("cled"), at, kind, corp, item: "credits", amount, balanceAfter: after, by, ...(note ? { note } : {}) });
  c.ledger.push(row);
  c.treasury.credits = after;
  return row;
}

/** A ledger row that moves nothing: a withdrawal announced, blocked or failed, upkeep not paid, a level lost. */
export function noteTreasury(c, { at, kind, corp = null, by = null, note }) {
  const row = Object.freeze({ id: createId("cled"), at, kind, corp, item: "credits", amount: 0, balanceAfter: Math.floor(Number(c.treasury.credits) || 0), by, ...(note ? { note } : {}) });
  c.ledger.push(row);
  return row;
}

const accountOfCorp = (publicId) => Object.values(accountsStore.accounts || {}).find((a) => a?.state?.corp?.publicId === publicId) || null;

/** Pay what upkeep is owed, if the treasury now holds it all: the arrears end. Returns whether it paid. */
export function payArrears(c, now = Date.now()) {
  if (!(c.arrearsOwed > 0) || c.treasury.credits < c.arrearsOwed) return false;
  moveTreasury(c, { at: now, kind: "arrears-paid", amount: -c.arrearsOwed, by: "bureau", note: `upkeep owed since ${new Date(c.arrearsSince).toISOString().slice(0, 10)}` });
  c.arrearsOwed = 0;
  c.arrearsSince = null;
  return true;
}

/**
 * Bring the treasury up to `now`: due announced withdrawals are paid (or fail when the treasury no longer holds them),
 * and each UTC midnight charges a day's upkeep, or, when the treasury cannot pay it, adds it to the arrears. After
 * arrearsDropDays in arrears the conglomerate drops a level (nobody is removed) and the count starts again. Returns
 * the events to tell members about: [{ event, payload, notify? }].
 */
export function settleTreasury(c, now = Date.now(), catalog = CONGLOMERATE_CATALOG) {
  if (c.dissolvedAt) return [];
  ensureTreasury(c, now);
  const events = [];
  for (;;) {
    const due = c.withdrawals.filter((w) => w.state === "pending" && w.completesAt <= now).sort((a, b) => a.completesAt - b.completesAt)[0];
    const midnight = c.upkeepPaidThrough <= now ? c.upkeepPaidThrough : Infinity;
    if (!due && midnight === Infinity) break;
    if (due && due.completesAt <= midnight) {
      const account = accountOfCorp(due.corp);
      if (account && c.treasury.credits >= due.amount) {
        moveTreasury(c, { at: due.completesAt, kind: "withdrawal", corp: due.corp, amount: -due.amount, by: due.corp, note: "announced" });
        applyCredits(account.state.corp, due.amount, "conglomerate-withdrawal", due.completesAt);
        due.state = "paid";
      } else {
        noteTreasury(c, { at: due.completesAt, kind: "withdrawal-failed", corp: due.corp, by: "bureau", note: account ? "the treasury no longer held it" : "the corporation no longer exists" });
        due.state = "failed";
      }
      events.push({ event: "conglomerate:treasury", payload: { kind: `withdrawal-${due.state}`, corp: due.corp, amount: due.amount } });
      continue;
    }
    const day = midnight;
    const upkeep = dailyUpkeep(c.members.length, catalog);
    if (!(c.arrearsOwed > 0) && c.treasury.credits >= upkeep) {
      if (upkeep > 0) moveTreasury(c, { at: day, kind: "upkeep", amount: -upkeep, by: "bureau", note: `${c.members.length} members` });
    } else {
      c.arrearsOwed = (c.arrearsOwed || 0) + upkeep;
      if (!c.arrearsSince) c.arrearsSince = day;
      noteTreasury(c, { at: day, kind: "upkeep-unpaid", by: "bureau", note: `${upkeep} owed for ${c.members.length} members; ${c.arrearsOwed} in arrears` });
      if (!payArrears(c, day) && day - c.arrearsSince >= catalog.arrearsDropDays * DAY_MS && c.level > 1) {
        c.level -= 1;
        c.maxMembers = catalog.levels[c.level - 1].maxMembers;
        c.levelSince = day;
        c.arrearsSince = day; // another arrearsDropDays before the next
        noteTreasury(c, { at: day, kind: "level-lost", by: "bureau", note: `level ${c.level}, room for ${c.maxMembers}` });
        events.push({ event: "conglomerate:level-lost", payload: { level: c.level, maxMembers: c.maxMembers }, notify: { title: `${c.name} lost a level`, body: `Upkeep went unpaid for ${catalog.arrearsDropDays} days, so it dropped to level ${c.level} (room for ${c.maxMembers}). Nobody was removed; it cannot admit anyone until it is below the new cap. Deposit enough to pay the arrears to stop it.` } });
      }
    }
    c.upkeepPaidThrough += DAY_MS;
  }
  return events;
}
