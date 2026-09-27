// server/patents.js: filing patents at Corporate Registry & Charters (ISP-235, AB#930; docs/design/WARFARE.md, Lawfare).
// The first corporation to complete a patentable research node (tier `patents.minResearchTier` and up) or refinery chain
// (stage `patents.minChainStage` and up) may file within `patents.filingWindowHours` of completing it, paying
// `patents.filingFee` to the ISA. One patent per subject, ever: a term does not renew, and nobody files again after it.
// The royalty rate is set at filing, within the catalog's bound for its kind. Charging it is ISP-236 (AB#931).
//
// Who completed first is read from server records only: `researchCompletedAt` (written by the R&D tick, the research's
// scheduled end) and `chainFirstRunAt` (written when a run delivers) on each corporation. When the order cannot be
// established, filing is refused: a corporation holds the subject with no record (completed before the records
// existed, or granted), or two corporations completed it in the same millisecond.
//
// Kept in patents.json in the data directory. Holders are corporation publicIds and names, all public (the Registry's
// list), never an account id. Filing is one synchronous check-then-write, so of two filings for one subject exactly
// one succeeds.

import fs from "node:fs";
import path from "node:path";
import { dataDir, safeWriteFile, createId, REFINERY_CHAINS, RESEARCH_LIBRARY } from "./game/catalog.js";
import { accountsStore, mutateAccountState } from "./game/store.js";
import { accountByCorp } from "./game/membership.js";
import { applyCredits } from "./finances.js";
import { ECONOMY } from "./economy.js";
import { settleTransfer } from "./settlement.js";
import { WARFARE_CATALOG } from "./warfare.js";
import { ROYALTY_PAID, ROYALTY_RECEIVED, royaltyOn } from "../public/scripts/patentRoyalty.js"; // ISP-237 (AB#932): the quote's arithmetic

const FILE = path.join(dataDir, "patents.json");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const PATENT_KINDS = Object.freeze(["research", "chain"]);
let store = readStore();

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return parsed && Array.isArray(parsed.patents) ? parsed : { patents: [] };
  } catch {
    return { patents: [] };
  }
}
const save = () => safeWriteFile(FILE, JSON.stringify(store));
const no = (status, code, error) => ({ refused: { status, code, error } });
const terms = () => WARFARE_CATALOG.patents;

/** The subject a kind and id name, if it is patentable: { name, maxPct }; otherwise null. */
export function patentable(kind, subjectId) {
  const t = terms();
  if (kind === "research") {
    const node = Object.hasOwn(RESEARCH_LIBRARY, subjectId) ? RESEARCH_LIBRARY[subjectId] : null;
    return node && Number(node.tier) >= t.minResearchTier ? { name: node.name, maxPct: t.royaltyMaxPct } : null;
  }
  if (kind === "chain") {
    const chain = Object.hasOwn(REFINERY_CHAINS, subjectId) ? REFINERY_CHAINS[subjectId] : null;
    return chain && Number(chain.stage) >= t.minChainStage ? { name: chain.id, maxPct: t.chainRoyaltyMaxPct } : null;
  }
  return null;
}

/** When `corp` completed the subject, from its server record; 0 when it holds it with no record; null when it has not. */
function completedAt(corp, kind, subjectId) {
  if (kind === "research") {
    const at = Number(corp?.researchCompletedAt?.[subjectId]);
    if (at > 0) return at;
    return (corp?.unlockedTech || []).includes(subjectId) ? 0 : null;
  }
  const at = Number(corp?.chainFirstRunAt?.[subjectId]);
  if (at > 0) return at;
  const chain = REFINERY_CHAINS[subjectId];
  return chain?.outputs?.some((o) => Number(corp?.stats?.[`manufactured:${o.item}`]) > 0) ? 0 : null;
}

/**
 * Who completed the subject first: { publicId, at }, or { unknown: reason } when the order cannot be established, or
 * null when nobody has.
 */
export function firstCompleter(kind, subjectId, accounts = accountsStore.accounts) {
  const done = [];
  for (const account of Object.values(accounts || {})) {
    const corp = account?.state?.corp;
    const at = completedAt(corp, kind, subjectId);
    if (at === null || !corp?.publicId) continue;
    if (at === 0) return { unknown: "completed before the Registry kept completion records" };
    done.push({ publicId: corp.publicId, at });
  }
  if (!done.length) return null;
  done.sort((a, b) => a.at - b.at);
  if (done.length > 1 && done[0].at === done[1].at) return { unknown: "two corporations completed it at the same moment" };
  return done[0];
}

/** File a patent for the caller's corporation. { patent } or { refused }. Nothing is written or charged on a refusal. */
export function filePatent(accountId, { kind, subjectId, ratePct }, now = Date.now()) {
  const account = accountsStore.accounts?.[accountId];
  const corp = account?.state?.corp;
  if (!corp?.publicId) return no(404, "no-account", "Account not found.");
  const subject = PATENT_KINDS.includes(kind) ? patentable(kind, subjectId) : null;
  if (!subject) return no(400, "not-patentable", "That is not a patentable research node (tier 3 and up) or refinery chain (stage 2 and up).");
  if (!(Number.isInteger(ratePct) && ratePct >= 0 && ratePct <= subject.maxPct)) {
    return no(400, "rate-out-of-bounds", `A royalty on this is a whole number from 0 to ${subject.maxPct} percent.`);
  }
  if (store.patents.some((p) => p.kind === kind && p.subjectId === subjectId)) {
    return no(409, "already-patented", "This has been patented already. A patent is filed once and is not renewed.");
  }
  const mine = completedAt(corp, kind, subjectId);
  if (mine === null) return no(403, "not-completed", "Your corporation has not completed this, so it cannot patent it.");
  const first = firstCompleter(kind, subjectId);
  if (!first || first.unknown) return no(409, "order-unknown", `The Registry cannot establish who completed this first (${first?.unknown || "no record"}), so no patent can be filed.`);
  if (first.publicId !== corp.publicId) return no(403, "not-first", "Another corporation completed this first; only it may patent it.");
  const t = terms();
  if (now > first.at + t.filingWindowHours * HOUR) {
    return no(409, "window-closed", `The filing window closed ${t.filingWindowHours} hours after you completed it. It is now public for good.`);
  }
  const paid = t.filingFee > 0
    ? settleTransfer({ fromAccountId: accountId, toAccountId: "sink:fee", credits: t.filingFee, reason: "fee", idempotencyKey: `patent:${kind}:${subjectId}:${corp.publicId}` }, now)
    : { ok: true };
  if (!paid.ok) return no(402, "insufficient-credits", `Filing costs ${t.filingFee.toLocaleString("en-US")} credits.`);
  const patent = {
    id: createId("pat"), kind, subjectId, subjectName: subject.name,
    holder: { publicId: corp.publicId, name: corp.corporationName || "A corporation" },
    completedAt: first.at, filedAt: now, endsAt: now + t.termDays * DAY, ratePct, pending: null
  };
  store.patents.push(patent);
  save();
  return { patent: publicView(patent, now) };
}

function publicView(p, now) {
  return { id: p.id, kind: p.kind, subjectId: p.subjectId, subjectName: p.subjectName, holder: p.holder.name, ratePct: p.ratePct, filedAt: p.filedAt, endsAt: p.endsAt, active: now < p.endsAt };
}

/** The Registry's public list: every patent filed, newest first; holder by name only. */
export function publicPatents(now = Date.now()) {
  return { patents: [...store.patents].sort((a, b) => b.filedAt - a.filedAt).map((p) => publicView(p, now)) };
}

/**
 * ISP-237 (AB#932): the Registry's patent office for one corporation. `filable`: what it may file now (patentable, not
 * patented, completed first by it on a server record, inside the window), with the window's end; `mine`: its patents;
 * `paying`: others' patents in force on chains it has run or research it completed after the filing; `royalties`: what
 * its statements carry both ways (ISP-236 books them) and what it still owes holders. Null for an unknown account.
 */
export function patentOffice(accountId, now = Date.now()) {
  const corp = accountsStore.accounts?.[accountId]?.state?.corp;
  if (!corp?.publicId) return null;
  const t = terms();
  const filable = [];
  const consider = (kind, ids) => {
    for (const subjectId of ids) {
      const subject = patentable(kind, subjectId);
      if (!subject || store.patents.some((p) => p.kind === kind && p.subjectId === subjectId)) continue;
      const at = completedAt(corp, kind, subjectId);
      if (!(at > 0) || now > at + t.filingWindowHours * HOUR) continue;
      const first = firstCompleter(kind, subjectId);
      if (!first || first.unknown || first.publicId !== corp.publicId) continue;
      filable.push({ kind, subjectId, subjectName: subject.name, maxPct: subject.maxPct, completedAt: at, windowEndsAt: at + t.filingWindowHours * HOUR });
    }
  };
  consider("research", Object.keys(corp.researchCompletedAt || {}));
  consider("chain", Object.keys(corp.chainFirstRunAt || {}));
  filable.sort((a, b) => a.windowEndsAt - b.windowEndsAt);
  const views = (list) => [...list].sort((a, b) => b.filedAt - a.filedAt).map((p) => publicView(p, now));
  const uses = (p) => {
    const at = completedAt(corp, p.kind, p.subjectId);
    return p.kind === "chain" ? at !== null : at !== null && at >= p.filedAt;
  };
  const finances = corp.finances || {};
  return {
    terms: { filingFee: t.filingFee, filingWindowHours: t.filingWindowHours, termDays: t.termDays, royaltyMaxPct: t.royaltyMaxPct, chainRoyaltyMaxPct: t.chainRoyaltyMaxPct },
    filable,
    mine: views(store.patents.filter((p) => p.holder.publicId === corp.publicId)),
    paying: views(store.patents.filter((p) => p.holder.publicId !== corp.publicId && p.filedAt <= now && now < p.endsAt && uses(p))),
    royalties: {
      received: Math.round(Number(finances.incomeBySource?.[ROYALTY_RECEIVED]) || 0),
      paid: Math.round(Number(finances.expensesByCategory?.[ROYALTY_PAID]) || 0),
      owed: Math.round(Object.values(corp.patentDebts || {}).reduce((s, v) => s + (Number(v) || 0), 0))
    }
  };
}

/** The patent in force on a subject at `now`, or null (ISP-236 charges its royalty). */
export function patentInForce(kind, subjectId, now = Date.now()) {
  return store.patents.find((p) => p.kind === kind && p.subjectId === subjectId && p.filedAt <= now && now < p.endsAt) || null;
}

/** Tests only: forget every patent. */
export function resetPatentsForTests() {
  store = { patents: [], uses: [], accrued: {} };
}

// ─── Royalties (ISP-236, AB#931; WARFARE.md, "The royalty") ───────────────────
// A use is recorded where it happens, on the user's own state (`patentUses`: research completing in the R&D tick, a run
// delivering in the refinery code), and charged by patentTick: the rate in force at the moment of use times its base
// (a node's research cost; a run's outputs at their standing bids' base), in whole credits. The holder pays nothing on
// its own patent, and nothing is charged after the term. Credits pay what they can; the rest is the user's debt to
// the holder, `patentDebts`, withheld from later sales at `patents.withholdPct`. Nothing is ever refused for it.
// What is collected accrues to the holder and is paid by patentTick, so no sale or run moves two accounts at once.
// Every use is kept (`uses`): what the Arbitration Council's patent-royalty claim sums (AB#919).

const USES_KEPT = 10_000;
const royaltyBooks = () => { if (!Array.isArray(store.uses)) store.uses = []; if (!store.accrued || typeof store.accrued !== "object") store.accrued = {}; return store; };

/** The patent in force for a use, and the royalty it owes: 0 for the holder's own use, or when no patent is in force. */
export function royaltyFor(corp, { kind, subjectId, at, base }) {
  const patent = patentInForce(kind, subjectId, at);
  if (!patent || patent.holder.publicId === corp?.publicId) return { patent: null, royalty: 0 };
  return { patent, royalty: royaltyOn(Math.max(0, Number(base) || 0), patent.ratePct) }; // ISP-237 (AB#932): the quote's arithmetic
}

/** Inside a mutation of the user's state: charge its recorded uses. Returns the uses that owed a royalty. */
export function chargePendingUses(corp, now = Date.now()) {
  const uses = Array.isArray(corp?.patentUses) ? corp.patentUses : [];
  if (!corp || !uses.length) return [];
  corp.patentUses = [];
  const books = royaltyBooks();
  const charged = [];
  for (const raw of uses) {
    // A run records what it delivered; its base is that at the standing bids' base (WARFARE.md)
    const use = raw.kind === "chain" && raw.base === undefined ? { ...raw, base: runBase(raw.delivered) } : raw;
    const { patent, royalty } = royaltyFor(corp, use);
    if (!(royalty > 0)) continue;
    const paid = Math.min(royalty, Math.max(0, Math.floor(Number(corp.finances?.credits) || 0)));
    if (paid > 0) applyCredits(corp, -paid, "patent-royalty", now);
    const owed = royalty - paid;
    if (owed > 0) {
      if (!corp.patentDebts || typeof corp.patentDebts !== "object") corp.patentDebts = {};
      corp.patentDebts[patent.id] = (corp.patentDebts[patent.id] || 0) + owed;
    }
    books.accrued[patent.holder.publicId] = (books.accrued[patent.holder.publicId] || 0) + paid;
    const record = { patentId: patent.id, user: corp.publicId, kind: use.kind, subjectId: use.subjectId, at: use.at, base: use.base, ratePct: patent.ratePct, royalty, paid };
    books.uses.push(record);
    charged.push(record);
  }
  if (books.uses.length > USES_KEPT) books.uses.splice(0, books.uses.length - USES_KEPT);
  if (charged.length) save();
  return charged;
}

/**
 * Inside a sale's mutation of the seller: withhold `patents.withholdPct` of the sale's net proceeds toward its royalty
 * debts, oldest first, and book it as patent royalty. Returns what was withheld (0 with no debt).
 */
export function withholdRoyaltyDebt(corp, proceeds, now = Date.now()) {
  const debts = corp?.patentDebts;
  if (!debts || !Object.keys(debts).length) return 0;
  let room = Math.floor(Math.max(0, Number(proceeds) || 0) * terms().withholdPct / 100);
  let taken = 0;
  const books = royaltyBooks();
  for (const id of Object.keys(debts)) {
    const patent = store.patents.find((p) => p.id === id);
    const x = patent ? Math.min(room, Math.max(0, debts[id])) : 0;
    if (x > 0) {
      books.accrued[patent.holder.publicId] = (books.accrued[patent.holder.publicId] || 0) + x;
      patent.withheld = (patent.withheld || 0) + x;
      debts[id] -= x;
      room -= x;
      taken += x;
    }
    if (!(debts[id] > 0)) delete debts[id];
    if (room <= 0) break;
  }
  if (taken) { applyCredits(corp, -taken, "patent-royalty", now); save(); }
  return taken;
}

/** Pay each holder what has accrued to it. A holder not found keeps its accrual. */
export function payRoyalties(now = Date.now()) {
  const books = royaltyBooks();
  const paid = [];
  for (const [publicId, credits] of Object.entries(books.accrued)) {
    if (!(credits > 0)) { delete books.accrued[publicId]; continue; }
    const account = accountByCorp(publicId);
    if (!account?.state?.corp) continue;
    mutateAccountState(account.id, (state) => { applyCredits(state.corp, credits, "patent-royalty-revenue", now); }, { sanitize: false, settleMining: false });
    delete books.accrued[publicId];
    paid.push({ publicId, credits });
  }
  if (paid.length) save();
  return paid;
}

/** The minute tick: charge every corporation's recorded uses, then pay the holders. */
export function patentTick(now = Date.now()) {
  for (const [accountId, account] of Object.entries(accountsStore.accounts || {})) {
    if (account?.state?.corp?.patentUses?.length) mutateAccountState(accountId, (state) => { chargePendingUses(state.corp, now); }, { sanitize: false, settleMining: false });
  }
  return payRoyalties(now);
}

/** Record a use on the user's own state, for patentTick to charge (only for a subject with a patent in force then). */
export function recordPatentUse(corp, use) {
  if (!corp || !patentInForce(use.kind, use.subjectId, use.at)) return;
  if (!Array.isArray(corp.patentUses)) corp.patentUses = [];
  corp.patentUses.push(use);
}

/** A research node completed at `at`: its base is the node's research cost. */
export function recordResearchUse(corp, techId, at) {
  const node = Object.hasOwn(RESEARCH_LIBRARY, techId) ? RESEARCH_LIBRARY[techId] : null;
  if (node) recordPatentUse(corp, { kind: "research", subjectId: techId, at, base: Number(node.costCredits) || 0 });
}

/** A run's base: what it delivered at the standing bids' base (WARFARE.md). */
export const runBase = (delivered) => (delivered || []).reduce((sum, { item, quantity }) => sum + (Number(quantity) || 0) * standingBase(item), 0);
const standingBase = (item) => Number(ECONOMY.npcBuyers.find((b) => b.item === item)?.unitPrice) || 0;
