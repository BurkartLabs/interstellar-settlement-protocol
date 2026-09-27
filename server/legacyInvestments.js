import fs from "node:fs";
import path from "node:path";

// Direct investments made before POST /api/investments was removed (Bug #689).
//
// That route took the investor's credits, paid nobody and never returned anything. Refunding is a product call, and the
// target and instrument strings were free text that is never repeated. ISP-158 (AB#852), the real share offerings,
// clears the vestigial `corp.investments`: what it held is first written to legacy-investments.json in the data
// directory (account, corporation, amount, time), kept there for the PM, and logged at startup. Nothing is refunded.

/** Every stored direct investment across `accounts`, as { accountId, amount, createdAt }. */
export function directInvestmentRecords(accounts) {
  return (accounts || []).flatMap((account) =>
    (account?.state?.corp?.investments || []).map((inv) => ({
      accountId: account.id,
      amount: Number(inv?.amount) || 0,
      createdAt: inv?.createdAt ?? null
    }))
  );
}

/**
 * AB#852: move every stored direct investment into the archive file `file` (merged with what it already holds, so a
 * second run adds nothing), then remove `corp.investments` from each corporation. Returns { archived, total, cleared }:
 * the records added this run, the credits they sunk, and the corporations cleared. The file is written before anything
 * is removed, so a failed write clears nothing.
 */
export function archiveDirectInvestments(accounts, file) {
  const list = Object.values(accounts || {});
  const fresh = list.flatMap((account) => (account?.state?.corp?.investments || []).map((inv) => ({
    accountId: account.id,
    corporationName: account?.state?.corp?.corporationName ?? null,
    amount: Number(inv?.amount) || 0,
    createdAt: inv?.createdAt ?? null
  })));
  let cleared = 0;
  for (const account of list) if (account?.state?.corp && "investments" in account.state.corp) cleared++;
  if (!cleared) return { archived: 0, total: 0, cleared: 0 };
  let kept = [];
  try { kept = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const key = (r) => `${r.accountId}|${r.createdAt}|${r.amount}`;
  const have = new Set(kept.map(key));
  const added = fresh.filter((r) => !have.has(key(r)));
  if (added.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([...kept, ...added], null, 2));
  }
  for (const account of list) if (account?.state?.corp) delete account.state.corp.investments;
  return { archived: added.length, total: added.reduce((a, r) => a + r.amount, 0), cleared };
}

/** At startup: report what the removed route stored, then archive it to `file` and clear it. Nothing is refunded. */
export function reportAndArchiveInvestments(accounts, file) {
  const records = directInvestmentRecords(Object.values(accounts || {}));
  if (records.length) console.warn(`[investments] ${records.length} direct investment(s) from the removed route (Bug #689):`, JSON.stringify(records));
  const a = archiveDirectInvestments(accounts, file);
  if (a.archived) console.warn(`[investments] archived ${a.archived} record(s), ${a.total} credits sunk, to ${path.basename(file)} for the PM (AB#852); not refunded.`);
  return a;
}
