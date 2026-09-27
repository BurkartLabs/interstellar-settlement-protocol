// ISP-157 (AB#851): every corporation's share registry, its cap table (docs/design/v0.9-equity.md, section 1).
//
// The one authoritative record of who owns a corporation, on the issuer (`corp.shareRegistry`). Every corporation has
// 100,000 shares authorized, fixed; 10,000 are the founder's from creation, never sold and never bought back; the rest
// are unissued until an offering (ISP-158) sells them. Outside holders are rows in `holders[]`; the founder is not a
// row, because a corporation's own player is not an investor in it.
//
//   Invariant, checked after every mutation: founderShares + sum(holders[].shares) + unissued = authorized.
//
// Nothing here sells, moves or prices a share: this story only creates the registry, migrates existing accounts, and
// reads the cap table. No share has a real-money path (the Board, AB#703). Pure: no store, so the store's loader and
// the corporation factory can both use it without an import cycle.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "share-terms.json");
/** The registry's fixed numbers, as data. */
export const SHARE_TERMS = Object.freeze(JSON.parse(fs.readFileSync(FILE, "utf8")));

/** A new corporation's registry: the founder's 10,000, the rest unissued, private, the default payout ratio. */
export function newShareRegistry() {
  return {
    authorized: SHARE_TERMS.authorized,
    founderShares: SHARE_TERMS.founderShares,
    unissued: SHARE_TERMS.authorized - SHARE_TERMS.founderShares,
    holders: [],
    payoutRatioPct: SHARE_TERMS.payoutRatioPct.default,
    payoutRatioNextPct: null,
    state: "private",
    listedAt: null,
    lastDividendAt: null
  };
}

const whole = (n) => Number.isInteger(n) && n >= 0;

/** What is wrong with a registry, as sentences; [] when it holds the invariant and every field is in bounds. */
export function registryProblems(r) {
  if (!r || typeof r !== "object") return ["there is no share registry"];
  const out = [];
  if (r.authorized !== SHARE_TERMS.authorized) out.push(`authorized is ${r.authorized}, not ${SHARE_TERMS.authorized}`);
  if (r.founderShares !== SHARE_TERMS.founderShares) out.push(`founderShares is ${r.founderShares}, not ${SHARE_TERMS.founderShares}`);
  if (!whole(r.unissued)) out.push(`unissued is ${r.unissued}`);
  if (!Array.isArray(r.holders)) out.push("holders is not a list");
  const held = (Array.isArray(r.holders) ? r.holders : []).reduce((a, h) => {
    if (!(Number.isInteger(h?.shares) && h.shares > 0)) out.push(`a holding has ${h?.shares} shares`);
    return a + (Number(h?.shares) || 0);
  }, 0);
  if (r.founderShares + held + r.unissued !== r.authorized) out.push(`founder ${r.founderShares} + holders ${held} + unissued ${r.unissued} is not ${r.authorized}`);
  const p = SHARE_TERMS.payoutRatioPct;
  if (!(whole(r.payoutRatioPct) && r.payoutRatioPct >= p.min && r.payoutRatioPct <= p.max && r.payoutRatioPct % p.step === 0)) out.push(`payoutRatioPct is ${r.payoutRatioPct}`);
  if (!["private", "listed"].includes(r.state)) out.push(`state is ${r.state}`);
  return out;
}

/**
 * The one-off migration: give every corporation in `accounts` that has none its registry. Idempotent: a corporation
 * that already has one is left exactly as it is. Returns how many were added.
 */
export function migrateShareRegistries(accounts) {
  let added = 0;
  for (const account of Object.values(accounts || {})) {
    const corp = account?.state?.corp;
    if (corp && !corp.shareRegistry) { corp.shareRegistry = newShareRegistry(); added++; }
  }
  return added;
}

/**
 * The cap table anyone signed in may read: the corporation's name and id, its share counts, and each holder by
 * corporation name with its shares and percentage of shares outstanding. Never an account id or an e-mail.
 * `nameOf(holder)` gives a holder row's corporation name (the caller resolves player ids; "igsx-mm" is the exchange).
 */
export function publicCapTable(corp, nameOf = () => null) {
  const r = corp.shareRegistry;
  const outstanding = r.authorized - r.unissued;
  const pct = (shares) => Math.round((shares / outstanding) * 10_000) / 100;
  return {
    corpId: corp.publicId,
    corporationName: corp.corporationName || "",
    authorized: r.authorized,
    outstanding,
    unissued: r.unissued,
    state: r.state,
    holders: [
      { name: corp.corporationName || "", kind: "founder", shares: r.founderShares, pct: pct(r.founderShares) },
      ...r.holders.map((h) => ({ name: nameOf(h.holder) ?? "", kind: h.holder?.kind === "npc" ? "market-maker" : "corporation", shares: h.shares, pct: pct(h.shares) }))
    ]
  };
}

// ISP-158 (AB#852): the investor's side, derived here so the store's loader can call it without an import cycle.
/** Rebuild every investor's holding index (issuer ids) from the registries: the index is derived, never trusted. */
export function rebuildHoldingIndexes(accounts) {
  const index = new Map();
  for (const account of Object.values(accounts || {})) {
    const corp = account?.state?.corp;
    for (const h of corp?.shareRegistry?.holders || []) {
      if (h.holder?.kind !== "corp") continue;
      if (!index.has(h.holder.corpId)) index.set(h.holder.corpId, new Set());
      index.get(h.holder.corpId).add(corp.publicId);
    }
  }
  for (const account of Object.values(accounts || {})) {
    const corp = account?.state?.corp;
    if (corp) corp.holdingIndex = [...(index.get(corp.publicId) || [])];
  }
}
