// public/scripts/tariffs.js: a concession tariff's arithmetic, shared by the server's settlement (server/game/tariffs.js,
// server/tariffService.js; ISP-230, AB#925) and the quotes a trader sees before committing (ISP-231, AB#926), so the
// confirmation's numbers are the settlement's numbers (P-TWO-SOURCES).
import { taxOnSale } from "./exchangeTax.js";
import { utcTime } from "./timeFormat.js"; // ISP-249 (AB#945)

/** The tariff on `base` credits at `pct`, in whole credits (rounded as the exchange tax is). */
export function tariffOn(base, pct) {
  return pct > 0 && base > 0 ? Math.round((base * pct) / 100) : 0;
}

/** A transfer's tariff base: units x each item's normal value, in whole credits (0 for an item with none). */
export function transferBase(lines, normalValues = {}) {
  return Math.floor((lines || []).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(normalValues[l.item]) || 0), 0));
}

/** The tariff a transfer's lines pay at `pct`, as the server charges it at dispatch. */
export function transferTariff(lines, normalValues, pct) {
  return tariffOn(transferBase(lines, normalValues), pct);
}

/** A sale's settlement: the exchange tax (taxOnSale), then the tariff on the gross; `proceeds` is what the seller keeps. */
export function saleQuote(gross, breakdown, tariffPct = 0) {
  const taxed = taxOnSale(gross, breakdown);
  const tariff = tariffOn(gross, tariffPct);
  return { ...taxed, tariff, proceeds: taxed.proceeds - tariff };
}

/** A time as the ISA writes it (ISP-249, AB#945: the guide's format, public/scripts/timeFormat.js). */
export function utcMinute(t) {
  return utcTime(t, { withDate: true });
}
