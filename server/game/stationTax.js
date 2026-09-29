// server/game/stationTax.js: the sales tax at a conglomerate's own station (ISP-212b, AB#4655; docs/design/
// CONGLOMERATES.md Part 2, "What the station gives members": "An exchange the conglomerate governs").
//
// - At a station a conglomerate owns, an exchange sale pays the station's tax in place of the ISA's exchange tax:
//   nothing for a member of that conglomerate, and for anyone else the rate its stakeholders voted from
//   stationTaxOptions (server/game/stationGovernance.js, the "tax" setting). The ISA's lease royalty and the insight
//   discount belong to the ISA's tax and do not apply there; members always pay 0.
// - What a non-member pays goes to the conglomerate's treasury, one ledger row per sale.
// - Everywhere else, and at a station whose conglomerate is gone, the ISA's tax is unchanged.
// Both sale paths (server/routes/market.js, the NPC buy orders; server/marketSettlement.js, a filled listing) read the
// rate here, and GET /tariffs sends it to the Exchange's quote, which uses the same stationTaxBreakdown.

import { CONGLOMERATE_CATALOG } from "../conglomerates.js";
import { salesTaxBaseAt } from "../lobbyingService.js";
import { stationTaxBreakdown } from "../../public/scripts/exchangeTax.js";
import { exchangeTaxBreakdown } from "./progression.js";
import { moveTreasury } from "./conglomerates.js";
import { findConglomerate } from "./membership.js";
import { ensureStation } from "./stationGovernance.js";
import { stationById } from "./stations.js";
import { saveAccountsNow } from "./store.js";

/**
 * The station tax a sale by `corp` at `stationId` pays: { conglomerateId, conglomerateName, stationName, member,
 * votedPct, pct }, or null where the ISA's exchange tax applies.
 */
export function stationTaxAt(corp, stationId, catalog = CONGLOMERATE_CATALOG) {
  const station = stationById(stationId);
  if (station?.owner?.type !== "conglomerate") return null;
  const c = findConglomerate(station.owner.id);
  if (!c?.station || c.station.id !== station.id || c.dissolvedAt || !c.members?.length) return null;
  const votedPct = ensureStation(c, catalog).settings.taxPct;
  const member = Boolean(corp?.publicId) && c.members.some((m) => m.corp === corp.publicId);
  return { conglomerateId: c.id, conglomerateName: c.name, stationName: station.name, member, votedPct, pct: member ? 0 : votedPct };
}

/** The tax breakdown for a sale by `state`'s corporation at `stationId`: the station's, or the ISA's in force there. */
export function saleTaxBreakdownAt(state, stationId) {
  const st = stationTaxAt(state?.corp, stationId);
  return st ? stationTaxBreakdown(st) : exchangeTaxBreakdown(state, salesTaxBaseAt(stationId)); // ISP-239 (AB#934)
}

/**
 * After the seller's sale is saved: credit `amount`, the station tax it paid, to the conglomerate's treasury. Nothing
 * for a member's sale (0) or at another station. `seller` is the selling corporation, named on the ledger row's note.
 */
export function payStationTax(breakdown, amount, seller, now = Date.now()) {
  const st = breakdown?.station;
  if (!st || !(amount > 0)) return null;
  const c = findConglomerate(st.conglomerateId);
  if (!c || c.dissolvedAt) return null;
  const row = moveTreasury(c, { at: now, kind: "station-tax", corp: null, amount, by: "exchange", note: `${st.pct}% on a sale by ${seller?.corporationName || "a corporation"} at ${st.stationName}` });
  saveAccountsNow();
  return row;
}
