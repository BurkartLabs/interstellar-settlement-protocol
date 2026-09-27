// server/itcService.js: the Interplanetary Trade Commission's dumping watch (ISP-232, AB#927; docs/design/WARFARE.md,
// "Dumping, and the Trade Commission's watch"). The rule is server/game/dumping.js; this keeps the records and runs it.
//
// What it reads: each corporation's exchange sales at a price it chose, recorded as they settle (recordOwnSale, from
// server/marketSettlement.js paySeller: its listings filled, and its sales into others' buy orders). Sales to the NPC
// standing bid are never recorded (the ISA's bid sets that price), nor sales to a conglomerate partner (they cannot
// hurt a rival). Normal value is the market's price history, every trade included.
//
// When: itcTick, once a UTC day. It first levies each investigation opened levyAfterHours ago, on exactly the sales it
// named, then runs the watch over the window that ended at 00:00 UTC and opens an investigation for each finding,
// notifying the corporation in the ISA's voice with the numbers. A sale in a finding is marked, so no later window
// counts it again: one duty per investigation.
//
// Paying: the duty comes from the corporation's credits, never below zero; the rest is owed, and withholdDuty takes
// withholdPct of the net proceeds of each later exchange sale (both sale paths call it) until it is paid. No interest;
// goods, buildings, leases and fleets are never touched, and trading is never blocked. Paid duty is booked as
// "anti-dumping-duty" and leaves the money supply, counted here as the Commission's sink.
//
// Kept in itc.json in the data directory: the sales log (the watch's days only), the findings and the sink's total.
// What a corporation owes is on the corporation itself (corp.itcDuty: { owed, withholdPct }), so its sale confirmation
// can show the withholding before it sells. Corporations are named by publicId; no account id is stored. It fails closed: an item
// without a normal value is never found dumping, and an error in the watch opens nothing and is logged.

import fs from "node:fs";
import path from "node:path";
import { dataDir, safeWriteFile } from "./game/catalog.js";
import { WARFARE_CATALOG } from "./warfare.js";
import { applyCredits } from "./finances.js";
import { addAccountNotification, getState, mutateAccountState } from "./gameState.js";
import { accountByCorp } from "./game/membership.js";
import { formatCredits } from "./receipts.js";
import { assess, normalOf, watchDays } from "./game/dumping.js";
import { withheldFrom } from "../public/scripts/itcDuty.js";
import { onDumpingFinding } from "./standingService.js"; // ISP-238 (AB#933)
import { dumpingTermsIn } from "./lobbyingService.js"; // ISP-239 (AB#934): the lines in force in a sale's system
import { stationById } from "./game/stations.js";

const FILE = path.join(dataDir, "itc.json");
const DAY_MS = 86_400_000;
const HOUR = 3_600_000;
const TERMS = WARFARE_CATALOG.dumping;
let store = readStore();

function readStore() {
  const empty = { sales: [], findings: [], sinkTotal: 0, watchedDay: null, seq: 0, findingSeq: 0 };
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return parsed && typeof parsed === "object" && Array.isArray(parsed.sales) ? { ...empty, ...parsed } : empty;
  } catch {
    return empty;
  }
}
const save = () => safeWriteFile(FILE, JSON.stringify(store));
const plain = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");
const price = (v) => (Math.round(v * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
const dayText = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/**
 * Record one of `seller`'s own-priced sales (a listing filled, or a sale into another's buy order) for the watch.
 * `partner` is true when the buyer is in the seller's conglomerate: such a sale is not recorded.
 */
export function recordOwnSale(seller, { item, quantity, unitPrice, partner = false, stationId = null, at = Date.now() }) {
  try {
    if (partner || !seller?.publicId || !(quantity > 0) || !(unitPrice > 0)) return;
    store.seq += 1;
    store.sales.push({ id: `its-${store.seq}`, corp: seller.publicId, item, quantity, unitPrice, at, findingId: null, systemId: stationById(stationId)?.systemId || null });
    const keepFrom = at - (TERMS.windowDays + 1) * DAY_MS;
    store.sales = store.sales.filter((s) => s.at >= keepFrom);
    save();
  } catch (error) {
    console.error(`[itc] a sale was not recorded for the watch: ${error?.message || error}`);
  }
}

/** What the corporation owes the Commission now, in credits. */
export const dutyOwed = (corp) => Math.floor(Number(corp?.itcDuty?.owed) || 0);

/**
 * At a sale's settlement, inside the seller's own state change: withhold withholdPct of `net` toward duty owed.
 * Books it as "anti-dumping-duty" and returns the credits withheld (0 when nothing is owed). Never throws.
 */
export function withholdDuty(corp, net) {
  try {
    const withheld = withheldFrom(net, corp?.itcDuty);
    if (!(withheld > 0)) return 0;
    applyCredits(corp, -withheld, "anti-dumping-duty");
    const owed = dutyOwed(corp) - withheld;
    if (owed > 0) corp.itcDuty = { ...corp.itcDuty, owed };
    else delete corp.itcDuty;
    store.sinkTotal += withheld;
    save();
    return withheld;
  } catch (error) {
    console.error(`[itc] duty was not withheld: ${error?.message || error}`);
    return 0;
  }
}

function notify(publicId, title, body) {
  const account = accountByCorp(publicId);
  if (account) addAccountNotification(account.id, { type: "market", title, body });
}

/** Levy one investigation's duty: from credits, never below zero; the rest owed. */
function levy(f, now) {
  const account = accountByCorp(f.corp);
  let paid = 0;
  if (account) {
    mutateAccountState(account.id, (state) => {
      paid = Math.max(0, Math.min(f.duty, Math.floor(Number(state.corp.finances.credits) || 0)));
      if (paid > 0) applyCredits(state.corp, -paid, "anti-dumping-duty", now);
      const rest = f.duty - paid;
      if (rest > 0) state.corp.itcDuty = { owed: dutyOwed(state.corp) + rest, withholdPct: TERMS.withholdPct };
    });
  }
  const rest = f.duty - paid; // a corporation that no longer exists owes nothing to anyone
  store.sinkTotal += paid;
  Object.assign(f, { leviedAt: now, paid, owedAtLevy: rest });
  notify(f.corp, "ITC Anti-Dumping Duty Levied",
    `${f.id}. The Interplanetary Trade Commission has levied the anti-dumping duty of ${formatCredits(f.duty)} on your ${plain(f.Q)} ${f.item}. ` +
    (rest > 0
      ? `${formatCredits(paid)} was taken from your reserves. The remaining ${formatCredits(rest)} is owed: ${TERMS.withholdPct}% of the net proceeds of each exchange sale will be withheld toward it until it is paid. No interest is charged.`
      : `It has been taken from your reserves. The investigation is closed.`));
}

/**
 * The watch, once a UTC day: levy what is due, then look at the window that ended at 00:00 UTC. Idempotent per day.
 * Returns { levied, opened }.
 */
export function itcTick(now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (store.watchedDay === day) return { levied: [], opened: [] };
  const levied = [];
  const opened = [];
  for (const f of store.findings) {
    if (!f.leviedAt && now >= f.openedAt + TERMS.levyAfterHours * HOUR) { levy(f, now); levied.push(f.id); }
  }
  try {
    const { window, normal, windowStartAt, windowEndAt } = watchDays(now, TERMS);
    const history = getState().market?.priceHistory || {};
    const open = store.sales.filter((s) => !s.findingId && s.at >= windowStartAt && s.at < windowEndAt);
    const groups = new Map();
    for (const s of open) {
      const key = `${s.corp}|${s.item}|${s.systemId || ""}`; // ISP-239 (AB#934): a system's lines may be lobbied
      groups.set(key, [...(groups.get(key) || []), s]);
    }
    for (const [key, sales] of groups) {
      const [corp, item, systemId] = key.split("|");
      const terms = dumpingTermsIn(systemId || null, now);
      const r = assess(sales, normalOf(history[item], normal, terms), terms);
      if (!r.found) continue;
      store.findingSeq = (store.findingSeq || 0) + 1;
      const f = { id: `ITC-${day.slice(0, 4)}-${String(store.findingSeq).padStart(6, "0")}`, corp, item, window: [window[0], window.at(-1)], N: r.N, line: r.line, volumeLine: r.volumeLine, Q: r.Q, P: r.P, duty: r.duty, openedAt: now, leviedAt: null, sales: r.dumped };
      for (const s of store.sales) if (r.dumped.includes(s.id)) s.findingId = f.id;
      store.findings.push(f);
      const found = accountByCorp(corp); // ISP-238 (AB#933): a finding costs ITC standing
      if (found) mutateAccountState(found.id, (state) => { onDumpingFinding(state.corp); });
      opened.push(f.id);
      notify(corp, "ITC Anti-Dumping Investigation",
        `${f.id}. The Interplanetary Trade Commission has opened an anti-dumping investigation. Between ${dayText(window[0])} and ${dayText(window.at(-1))} (UTC) ` +
        `you sold ${plain(r.Q)} ${item} at an average of ${price(r.P)} credits, below ${TERMS.priceThresholdPct}% of their normal value (${price(r.N)} credits; the line is ${price(r.line)}). ` +
        `The volume line for those ${TERMS.windowDays} days was ${plain(r.volumeLine)} units, and the sales were worth ${formatCredits(r.Q * r.N)} at normal value. ` +
        `A duty of ${formatCredits(r.duty)}, the dumping margin, will be levied at 00:00 UTC in ${TERMS.levyAfterHours} hours.`);
    }
  } catch (error) {
    console.error(`[itc] the dumping watch did not run: ${error?.message || error}`);
  }
  store.watchedDay = day;
  save();
  return { levied, opened };
}

/**
 * ISP-233 (AB#928): the watch as the next tick will read an item (public, aggregate): its normal value and daily volume,
 * the price line and the volume line for a window, and an alert when the last complete day closed under the line, with
 * the volume behind it. `normal` is null (and there is no alert) when the item has no normal value: the watch would
 * find nothing either. Sales made today are judged from the next tick, so its days are the ones shown.
 */
export function watchView(item, now = Date.now(), dumpingTerms = TERMS) {
  const TERMS = dumpingTerms; // ISP-239 (AB#934): a system's lobbied lines, when the view is for one
  const { window, normal: normalDays } = watchDays(now + DAY_MS, TERMS);
  const buckets = getState().market?.priceHistory?.[item] || [];
  const n = normalOf(buckets, normalDays, TERMS);
  const terms = { ...TERMS };
  const base = { item, terms, window: [window[0], window.at(-1)] };
  if (!n) return { ...base, normal: null, line: null, volumeLine: null, alert: null };
  const line = (n.price * TERMS.priceThresholdPct) / 100;
  const volumeLine = (TERMS.volumeThresholdPct / 100) * n.dailyVolume * TERMS.windowDays;
  const yesterday = new Date(now - DAY_MS).toISOString().slice(0, 10);
  const last = buckets.find((b) => b.day === yesterday && b.volume > 0);
  const alert = last && last.close < line
    ? { day: last.day, close: last.close, volume: last.volume, dropPct: Math.round(((n.price - last.close) / n.price) * 100), volumePct: Math.round((last.volume / n.dailyVolume) * 100) }
    : null;
  return { ...base, normal: { price: n.price, dailyVolume: n.dailyVolume }, line, volumeLine, alert };
}

/** ISP-233 (AB#928): the watch as it applies to one corporation: the public view, its own sales of the item not yet in a finding in that window, and what it owes. */
export function ownWatch(corp, item, now = Date.now()) {
  // ISP-239 (AB#934): judged by the lines in force where it is docked, against its sales in that system
  const systemId = stationById(corp?.currentStationId)?.systemId || null;
  const terms = dumpingTermsIn(systemId, now);
  const { windowStartAt } = watchDays(now + DAY_MS, terms);
  const sales = store.sales.filter((s) => s.corp === corp?.publicId && s.item === item && !s.findingId && s.at >= windowStartAt && (s.systemId || null) === systemId).map(({ id, quantity, unitPrice }) => ({ id, quantity, unitPrice }));
  return { ...watchView(item, now, terms), sales, owed: dutyOwed(corp) };
}

/** The Commission's findings about a corporation, newest first (for ISP-233's surfaces and tests). */
export function findingsFor(publicId) {
  return store.findings.filter((f) => f.corp === publicId).slice().reverse();
}

/** For tests: forget everything (and optionally the file). */
export function resetItc({ removeFile = false } = {}) {
  store = { sales: [], findings: [], sinkTotal: 0, watchedDay: null, seq: 0, findingSeq: 0 };
  if (removeFile) fs.rmSync(FILE, { force: true });
}

/** The Commission's sink so far: duty paid. */
export const itcSinkTotal = () => store.sinkTotal;
