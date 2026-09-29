// ISP-161 (AB#855): the Intergalactic Stock Exchange, as HTML: the primary offerings open now with the issuer's grade
// and trailing performance beside the price, the caller's portfolio with value, cost, dividends and return, and the
// caller's own side as an issuer (listing, cap table, payout ratio, offerings). Pure: no DOM and no requests, so node
// tests read it. views/stockExchange.js fetches, binds and draws what this returns.
//
// Every figure is the server's (GET /equity/offerings, GET /equity/holdings, GET /corporations/:corpId/cap-table):
// prices, values and the exit price are computed there. The page only formats them and adds them up.

import { escapeHtml, refHtml } from "./html.js";
import { bankTime, cr } from "./devBank.js";
import { countdown } from "./bondBoard.js";
import { protocolLineHtml } from "./protocol.js"; // ISP-255 (AB#951)

/** ISP-255 (AB#951): a status's protocol line in the Stock Exchange's building (GEX-MKT-13). */
const line = (meaning) => protocolLineHtml({ meaning, screen: "building-intergalactic-stock-exchange" });

const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${cr(Math.abs(n))}`;
const pctOf = (part, whole) => (whole > 0 ? `${part >= 0 ? "+" : "−"}${(Math.abs(part) * 100 / whole).toFixed(1)}%` : "");

/** A holding's return: what it is worth now plus the dividends it paid, less what it cost. */
export const holdingReturn = (h) => h.value + (h.dividendsReceived || 0) - h.costBasis;

/** The offerings open now. Each row carries what an investor weighs beside the price. */
export function offeringsHtml(d, ownCorpId = null) {
  if (!d.open.length) return `<p class="station__note">No offering is open. Listed corporations offer new shares here for 7 days at a time.</p>`;
  return `<div class="bond-series-list">${d.open.map((o) => `
    <article class="bond-series igsx-offering" data-offering="${escapeHtml(o.id)}">
      <header class="bond-series__header">
        <h4>${escapeHtml(o.issuerName ?? "A corporation")} ${refHtml(o.ref)}</h4>
        <span class="ui-badge bond-grade" title="The issuer's credit grade now">${escapeHtml(o.grade)}</span>
      </header>
      <dl class="bond-terms">
        <div><dt>Price per share</dt><dd><strong>${cr(o.pricePerShare)} credits</strong></dd></div>
        <div><dt>Company value at open</dt><dd>${cr(o.companyValue)} credits</dd></div>
        <div><dt>Shares outstanding at open</dt><dd>${cr(o.outstanding)} <span class="bond-terms__aside">(${cr(o.companyValue)} ÷ ${cr(o.outstanding)} = ${cr(o.pricePerShare)})</span></dd></div>
        <div><dt>Shares left</dt><dd>${cr(o.left)} of ${cr(o.quantity)}</dd></div>
        <div><dt>Net income, last 30 days</dt><dd class="${o.netIncome30 < 0 ? "igsx-loss" : ""}">${signed(o.netIncome30)} credits</dd></div>
        <div><dt>Payout ratio</dt><dd>${o.payoutRatioPct ?? 0}% of net income, paid weekly</dd></div>
        <div><dt>Closes in</dt><dd data-role="igsx-countdown" data-closes="${o.closesAt}">${countdown(o.closesAt, d.now)}</dd></div>
      </dl>
      ${ownCorpId && o.issuerCorpId === ownCorpId ? `<p class="station__note">Your own offering: an issuer cannot buy its own shares.</p>` : `
      <form class="bond-subscribe" data-role="igsx-buy" data-offering="${escapeHtml(o.id)}" novalidate>
        <label class="bank-quote-form__field">Shares
          <input class="ui-input" name="quantity" type="number" inputmode="numeric" min="1" max="${o.left}" step="1" value="${Math.min(100, o.left)}">
        </label>
        <button type="submit" class="ui-button ui-button--primary">Buy shares</button>
        <p class="bank-quote-form__status" data-role="igsx-status" aria-live="polite"></p>
      </form>`}
    </article>`).join("")}</div>`;
}

/** The portfolio: a total, then each holding with its value, cost, dividends received, return and the exit. */
export function portfolioHtml(holdings) {
  if (!holdings.length) return `<p class="station__note">You hold no shares. Buy into an open offering to start a portfolio.</p>`;
  const sum = (f) => holdings.reduce((a, h) => a + f(h), 0);
  const value = sum((h) => h.value), cost = sum((h) => h.costBasis), dividends = sum((h) => h.dividendsReceived || 0), ret = value + dividends - cost;
  return `
    <dl class="bond-terms igsx-total" data-role="igsx-total">
      <div><dt>Worth now</dt><dd><strong>${cr(value)} credits</strong></dd></div>
      <div><dt>Cost</dt><dd>${cr(cost)} credits</dd></div>
      <div><dt>Dividends received</dt><dd>${cr(dividends)} credits</dd></div>
      <div><dt>Return</dt><dd class="${ret < 0 ? "igsx-loss" : "igsx-gain"}">${signed(ret)} credits ${pctOf(ret, cost)}</dd></div>
    </dl>
    <div class="bond-holdings">${holdings.map((h) => {
      const r = holdingReturn(h);
      return `
      <article class="bond-series igsx-holding" data-issuer="${escapeHtml(h.issuerCorpId)}">
        <header class="bond-series__header"><h4>${escapeHtml(h.issuerName ?? "A corporation")} · ${cr(h.shares)} share${h.shares === 1 ? "" : "s"}</h4></header>
        <dl class="bond-terms">
          <div><dt>Value</dt><dd>${cr(h.value)} credits <span class="bond-terms__aside">(${cr(h.valuePerShare)} a share)</span></dd></div>
          <div><dt>Cost</dt><dd>${cr(h.costBasis)} credits</dd></div>
          <div><dt>Dividends received</dt><dd>${cr(h.dividendsReceived || 0)} credits</dd></div>
          <div><dt>Return</dt><dd class="${r < 0 ? "igsx-loss" : "igsx-gain"}">${signed(r)} credits ${pctOf(r, h.costBasis)}</dd></div>
        </dl>
        ${h.exitPrice > 0 ? `
        <form class="bond-subscribe" data-role="igsx-exit" data-issuer="${escapeHtml(h.issuerCorpId)}" novalidate>
          <label class="bank-quote-form__field">Shares to sell
            <input class="ui-input" name="quantity" type="number" inputmode="numeric" min="1" max="${h.shares}" step="1" value="${h.shares}">
          </label>
          <button type="submit" class="ui-button ui-button--secondary">Sell to the market maker</button>
          <p class="station__note igsx-hint">The market maker pays ${cr(h.exitPrice)} a share (value less 5%).</p>
          <p class="bank-quote-form__status" data-role="igsx-status" aria-live="polite"></p>
        </form>` : `<p class="station__note">${escapeHtml(h.issuerName ?? "The issuer")} is worth nothing on its last statement: the market maker pays nothing for its shares now.</p>`}
      </article>`;
    }).join("")}</div>`;
}

/** The caller's cap table: every holder with its shares and share of those outstanding. */
export function capTableHtml(t) {
  if (!t) return `<p class="station__note">Reading your cap table…</p>`;
  const who = { founder: "Founder", corporation: "Investor", "market-maker": "Market maker" };
  return `<div class="ui-table-wrap"><table class="ui-table igsx-cap-table" data-role="igsx-cap-table">
    <caption class="ui-table__caption">${cr(t.outstanding)} of ${cr(t.authorized)} shares outstanding, ${cr(t.unissued)} unissued</caption>
    <thead><tr><th scope="col">Holder</th><th scope="col" class="ui-table__num">Shares</th><th scope="col" class="ui-table__num">Of outstanding</th></tr></thead>
    <tbody>${t.holders.map((h) => `<tr><td data-label="Holder">${escapeHtml(h.name || "A corporation")} <span class="bond-terms__aside">${who[h.kind] ?? ""}</span></td><td class="ui-table__num" data-label="Shares">${cr(h.shares)}</td><td class="ui-table__num" data-label="Of outstanding">${h.pct}%</td></tr>`).join("")}</tbody>
  </table></div>`;
}

/** The payout-ratio control: the ratio now, a waiting change, and a select within the bounds (or when it may change). */
export function payoutHtml(s) {
  const b = s.payoutRatioBounds;
  const options = [];
  for (let v = b.min; v <= b.max; v += b.step) options.push(`<option value="${v}"${v === (s.payoutRatioNextPct ?? s.payoutRatioPct) ? " selected" : ""}>${v}%</option>`);
  return `
    <form class="igsx-payout" data-role="igsx-payout" novalidate>
      <p>Payout ratio now: <strong data-role="igsx-payout-now">${s.payoutRatioPct}%</strong> of each week's net income, paid to holders by shares.
        ${s.payoutRatioNextPct != null && s.payoutRatioNextPct !== s.payoutRatioPct ? `From the next period: <strong>${s.payoutRatioNextPct}%</strong>. ${line("queued")}` : ""}</p>
      <label class="bank-quote-form__field">Next period's ratio (${b.min}–${b.max}%, in steps of ${b.step})
        <select class="ui-select" name="payoutRatioPct"${s.canChangePayoutAt ? " disabled" : ""}>${options.join("")}</select>
      </label>
      <button type="submit" class="ui-button ui-button--secondary"${s.canChangePayoutAt ? " disabled" : ""}>Set payout ratio</button>
      <p class="station__note igsx-hint">${s.canChangePayoutAt ? `Changed this week: it may change again ${bankTime(s.canChangePayoutAt)}. ${line("suspended")}` : "It may change once in 7 days; the period in progress keeps its ratio."}</p>
      <p class="bank-quote-form__status" data-role="igsx-payout-status" aria-live="polite"></p>
    </form>`;
}

/** The caller as an issuer: listing (or why not), then the cap table, the payout ratio and its offerings. */
export function issuerHtml(d, capTable) {
  const s = d.issuer;
  if (!s) return `<p class="station__note">Your corporation could not be read. ${line("failed")}</p>`;
  if (s.state !== "listed") {
    const why = d.listing?.why;
    return `
      <p>Your corporation is not listed. Listing lets it offer new shares to other corporations; it sells nothing by itself.</p>
      ${why ? `<p class="station__note" data-role="igsx-listing-why">${escapeHtml(why)}</p>` : `
      <button type="button" class="ui-button ui-button--primary" data-role="igsx-list">List for ${cr(s.listingFee)} credits (1% of company value)</button>
      <p class="bank-quote-form__status" data-role="igsx-list-status" aria-live="polite"></p>`}
      <h4>Cap table</h4>
      ${capTableHtml(capTable)}`;
  }
  const open = d.mine.find((o) => o.state === "open" || o.state === "closing");
  return `
    <h4>Cap table</h4>
    ${capTableHtml(capTable)}
    <h4>Dividends</h4>
    ${payoutHtml(s)}
    <h4>Offerings</h4>
    ${open ? `<p>Open: ${cr(open.quantity)} shares at ${cr(open.pricePerShare)} credits, ${cr(open.left)} left; closes ${bankTime(open.closesAt)}. ${line("active")}</p>` : `
    <form class="bond-subscribe" data-role="igsx-offer" novalidate>
      <label class="bank-quote-form__field">New shares to offer
        <input class="ui-input" name="quantity" type="number" inputmode="numeric" min="100" step="1" value="${Math.max(100, Math.floor(s.outstanding / 20))}">
      </label>
      <button type="submit" class="ui-button ui-button--secondary">Open an offering</button>
      <p class="station__note igsx-hint">Priced at company value ÷ shares outstanding, open 7 days, then the market maker may take what is left.</p>
      <p class="bank-quote-form__status" data-role="igsx-offer-status" aria-live="polite"></p>
    </form>`}
    ${d.mine.filter((o) => o.state === "closed").slice(-3).map((o) => `<p class="station__note">Closed ${bankTime(o.closedAt)}: ${cr(o.soldToPlayers)} sold to corporations and ${cr(o.soldToMarketMaker)} to the market maker, of ${cr(o.quantity)} at ${cr(o.pricePerShare)}. ${line("complete")}</p>`).join("")}`;
}
