// server/references.js: reference numbers (ISP-249, AB#945; docs/design/BUREAUCRATIC_UI.md, "Reference numbers").
// "Every interaction has a reference number" (LORE.md): a record someone may refer back to carries TYPE-YYYY-XXXXXX.
//   - TYPE is the record's three letters (REFERENCE_TYPES);
//   - YYYY the in-fiction year it was issued (public/scripts/timeFormat.js);
//   - XXXXXX six characters of Crockford base-32 (no I, L, O or U, so it is not misread aloud).
// The six characters come from an HMAC of the record's own id under this installation's secret (references-salt in
// the data directory, made once), so a reference never changes, is the same wherever it is shown, and is opaque: it is
// not a counter, reveals nothing about how many records exist, and is not derived from an account id. No route looks
// a record up by its reference (tests/integration/references.test.js holds the routes to that).
//
// A new record is given its reference when it is made; a record from an older save is given one the first time it is
// read (ensureRef), and it is kept. A record that already shows another reference (the arbitration docket's GAC-,
// the ITC's sequential ITC- of AB#927, the licence letters already sent) keeps it: a reference already given out
// never changes.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./game/catalog.js";
import { fictionYear } from "../public/scripts/timeFormat.js";

export const REFERENCE_TYPES = Object.freeze({
  LIC: "the corporation's ISA licence", LSE: "a mining lease", CON: "an ISA contract", MPR: "a mining probe return",
  RCP: "a trade receipt", RAD: "a raid and its battle report", ITC: "an ITC dumping finding", LOA: "a loan",
  BND: "a bond series", SHR: "a share offering", PAT: "a patent", CSN: "a concession", ARB: "an arbitration case",
  LOB: "a lobbying campaign"
});
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const REFERENCE_PATTERN = /^[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/;
const SALT_FILE = path.join(dataDir, "references-salt");
let salt = null;

function secret() {
  if (salt) return salt;
  try {
    salt = fs.readFileSync(SALT_FILE, "utf8").trim();
  } catch { /* made below */ }
  if (!salt || salt.length < 32) {
    salt = crypto.randomBytes(32).toString("hex");
    try { fs.writeFileSync(SALT_FILE, salt, { flag: "wx" }); } catch { salt = fs.readFileSync(SALT_FILE, "utf8").trim() || salt; }
  }
  return salt;
}

/** The reference for a record of `type` with id `recordId`, issued at `issuedAt` (ms). */
export function referenceFor(type, recordId, issuedAt = Date.now()) {
  if (!REFERENCE_TYPES[type]) throw new Error(`No reference type ${type}`);
  const mac = crypto.createHmac("sha256", secret()).update(`${type}:${recordId}`).digest();
  const bits = mac.readUInt32BE(0) >>> 2; // 30 bits: six base-32 characters
  let code = "";
  for (let i = 5; i >= 0; i -= 1) code += CROCKFORD[(bits >>> (i * 5)) & 31];
  const year = new Date(Number.isFinite(Number(issuedAt)) && Number(issuedAt) > 0 ? Number(issuedAt) : Date.now()).getUTCFullYear();
  return `${type}-${fictionYear(year)}-${code}`;
}

/**
 * Give `record` its reference if it has none, and return it. `recordId` defaults to record.id; `issuedAt` is when it
 * was issued (the year in the reference). Returns [ref, changed].
 */
export function ensureRef(record, type, { recordId = record?.id, issuedAt } = {}) {
  if (!record || typeof record !== "object") return [null, false];
  if (typeof record.ref === "string" && record.ref) return [record.ref, false];
  if (recordId === undefined || recordId === null || recordId === "") return [null, false];
  record.ref = referenceFor(type, recordId, issuedAt);
  return [record.ref, true];
}

/**
 * The records a corporation holds in its own state, given their references (lazily, for a save made before them):
 * its licence, leases, contracts, trade receipts, loans and battle reports. Returns whether anything changed, so the
 * caller saves it.
 */
export function ensureCorpRefs(corp) {
  if (!corp || typeof corp !== "object") return false;
  let changed = false;
  const mark = ([, c]) => { if (c) changed = true; };
  if (corp.publicId && !corp.licenceRef) { corp.licenceRef = referenceFor("LIC", corp.publicId, corp.foundedAt || corp.createdAt); changed = true; }
  for (const lease of corp.miningLeases || []) mark(ensureRef(lease, "LSE", { issuedAt: lease.issuedAt }));
  // a contract template is accepted again and again, so its reference is its template and the moment it was accepted
  for (const m of [...(corp.activeMissions || []), ...(corp.completedMissions || [])]) mark(ensureRef(m, "CON", { recordId: `${m.id}@${m.acceptedAt || m.completedAt || ""}`, issuedAt: m.acceptedAt || m.completedAt }));
  for (const row of corp.tradeHistory || []) mark(ensureRef(row, "RCP", { issuedAt: row.at }));
  for (const loan of corp.loans || []) mark(ensureRef(loan, "LOA", { issuedAt: loan.openedAt }));
  for (const report of corp.raidReports || []) mark(ensureRef(report, "RAD", { recordId: report.raidId || report.id, issuedAt: report.at }));
  return changed;
}
