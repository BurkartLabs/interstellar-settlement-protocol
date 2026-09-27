// ISP-156 (AB#850): the bond board, as HTML: the series open for subscribing, the issue form with its preview, the
// caller's holdings with each one's next coupon, and the series it issued. Pure: no DOM and no requests, so node tests
// read it. views/bondBoard.js fetches, binds and draws what this returns.
//
// Every figure is the server's (GET /bonds, POST /bonds/preview): the grade, its implied yield, the underwriter's
// share, the coupons and the next payment. The page only formats them.

import { escapeHtml } from "./html.js";
import { bankTime, cr } from "./devBank.js";
import { refHtml } from "./html.js"; // ISP-249 (AB#945)

const pct = (n) => `${Number(n).toFixed(2).replace(/\.?0+$/, "")}%`;

/** How long until `t`: "5 h 12 min", "12 min", or "closing". */
export function countdown(t, now) {
  const min = Math.ceil((t - now) / 60_000);
  if (min <= 0) return "closing";
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

/** A series' standing as a badge: subscribing, current, in arrears, defaulted, redeemed or lapsed. */
export function seriesBadge(s) {
  const [label, mod] = {
    subscribing: ["Subscribing", "open"], closing: ["Closing", "open"], live: ["Current", "ok"], arrears: ["In arrears", "late"],
    defaulted: ["Defaulted", "late"], redeemed: ["Redeemed", "done"], lapsed: ["Lapsed", "done"]
  }[s.state] ?? [s.state, "done"];
  return `<span class="ui-badge bond-badge bond-badge--${mod}" data-state="${escapeHtml(s.state)}">${label}</span>`;
}

/** The series open for subscribing: issuer, grade, coupon against its grade's yield, maturity, units left, time left. */
export function openSeriesHtml(board, ownIds = new Set()) {
  if (!board.open.length) return `<p class="station__note">No series is open for subscribing. The Bank lists new issues here as corporations make them.</p>`;
  return `<div class="bond-series-list">${board.open.map((s) => `
    <article class="bond-series" data-series="${escapeHtml(s.id)}">
      <header class="bond-series__header">
        <h4>${escapeHtml(s.issuerName ?? "A corporation")} ${refHtml(s.ref)}</h4>
        <span class="ui-badge bond-grade" title="The issuer's grade with this series sold">${escapeHtml(s.grade)}</span>
      </header>
      <dl class="bond-terms">
        <div><dt>Coupon</dt><dd>${pct(s.couponPct30)} per 30 days <span class="bond-terms__aside">(grade ${escapeHtml(s.grade)} implies ${pct(s.impliedYieldPct30)})</span></dd></div>
        <div><dt>Maturity</dt><dd>${s.maturityDays} days after the window closes</dd></div>
        <div><dt>Units left</dt><dd>${cr(s.left)} of ${cr(s.quantity)}, ${cr(s.faceValue)} credits each</dd></div>
        <div><dt>Window closes in</dt><dd data-role="bond-countdown" data-closes="${s.closesAt}">${countdown(s.closesAt, board.now)}</dd></div>
      </dl>
      ${ownIds.has(s.id) ? `<p class="station__note">Your own series: an issuer cannot subscribe to it.</p>` : `
      <form class="bond-subscribe" data-role="bond-subscribe" data-series="${escapeHtml(s.id)}" novalidate>
        <label class="bank-quote-form__field">Units
          <input class="ui-input" name="units" type="number" inputmode="numeric" min="1" max="${s.left}" step="1" value="${Math.min(5, s.left)}">
        </label>
        <button type="submit" class="ui-button ui-button--primary">Subscribe</button>
        <p class="bank-quote-form__status" data-role="bond-status" aria-live="polite"></p>
      </form>`}
    </article>`).join("")}</div>`;
}

/**
 * The issue form, or why the caller may not issue. The coupon field has the grade-implied yield beside it; the preview
 * (the server's) shows the grade with the series sold, the underwriter's share, and the coupons over the bond's life.
 */
export function issueFormHtml(board, form = {}, preview = null, previewError = null) {
  const e = board.eligibility;
  if (!e.eligible) {
    return `<div class="bond-ineligible" data-role="bond-ineligible">
      <p><strong>Your corporation cannot issue bonds yet.</strong> ${escapeHtml(e.why)}</p>
      <p class="station__note">The Bank lists series from corporations at level ${e.minLevel} or above, graded B or better. Your grade: ${escapeHtml(e.grade ?? "NR")}; your level: ${e.level}.</p>
    </div>`;
  }
  const t = board.terms;
  const f = { quantity: 100, couponPct30: t.impliedYieldPct30[e.grade] ?? 5, maturityDays: t.maturityDays[1] ?? t.maturityDays[0], windowHours: t.windowHours[0], ...form };
  const grade = preview?.grade ?? e.grade;
  const yieldNow = preview?.impliedYieldPct30 ?? t.impliedYieldPct30[grade];
  const options = (list, chosen, unit) => list.map((v) => `<option value="${v}"${v === Number(chosen) ? " selected" : ""}>${v} ${unit}</option>`).join("");
  return `
    <form class="bond-issue" data-role="bond-issue" novalidate>
      <label class="bank-quote-form__field">Units of ${cr(t.faceValue)} credits
        <input class="ui-input" name="quantity" type="number" inputmode="numeric" min="${t.minQuantity}" max="${t.maxQuantity}" step="1" value="${escapeHtml(String(f.quantity))}">
      </label>
      <div class="bank-quote-form__field bond-issue__coupon">
        <label for="bond-coupon">Coupon, % per 30 days</label>
        <div class="bond-issue__coupon-row">
          <input class="ui-input" id="bond-coupon" name="couponPct30" type="number" inputmode="decimal" min="${t.minCouponPct30}" max="${t.maxCouponPct30}" step="${t.couponStepPct30}" value="${escapeHtml(String(f.couponPct30))}">
          <span class="bond-issue__yield" data-role="bond-yield">Grade ${escapeHtml(grade)} implies <strong>${pct(yieldNow)}</strong></span>
        </div>
      </div>
      <label class="bank-quote-form__field">Maturity
        <select class="ui-select" name="maturityDays">${options(t.maturityDays, f.maturityDays, "days")}</select>
      </label>
      <label class="bank-quote-form__field">Open for subscribing
        <select class="ui-select" name="windowHours">${options(t.windowHours, f.windowHours, "hours")}</select>
      </label>
      ${bondPreviewHtml(preview, previewError)}
      <div class="bank-quote__actions">
        <button type="submit" class="ui-button ui-button--primary" data-role="bond-issue-submit"${preview ? "" : " disabled"}>Issue series</button>
      </div>
      <p class="bank-quote-form__status" data-role="bond-issue-status" aria-live="polite"></p>
    </form>`;
}

/** The server's preview of a series before it is issued, or why it would be refused. */
export function bondPreviewHtml(p, error = null) {
  if (error) return `<p class="bond-preview bond-preview--refused" data-role="bond-preview">${escapeHtml(error)}</p>`;
  if (!p) return `<p class="bond-preview" data-role="bond-preview">Pricing your series…</p>`;
  const share = Math.round(p.underwriterShare * 100);
  return `
    <dl class="bond-preview bank-quote__terms" data-role="bond-preview">
      <div><dt>Grade with this series sold</dt><dd>${escapeHtml(p.grade)}${p.grade !== p.gradeNow ? ` (from ${escapeHtml(p.gradeNow)})` : ""}</dd></div>
      <div><dt>Underwriter at this coupon</dt><dd>takes ${share}% of what is unsold</dd></div>
      <div><dt>Coupons over the bond's life</dt><dd data-term="coupons">${cr(p.couponCostIfSold)} credits if every unit sells (${p.schedule.length} payments)</dd></div>
      <div><dt>Repaid in all</dt><dd>${cr(p.repayIfSold)} credits: ${cr(p.face)} face and the coupons</dd></div>
    </dl>`;
}

/** The caller's holdings: issuer, units, coupon, next coupon date and amount, maturity, standing and recovery value. */
export function holdingsHtml(board) {
  if (!board.holdings.length) return `<p class="station__note">You hold no bonds. Subscribe to an open series above.</p>`;
  return `<div class="bond-holdings">${board.holdings.map(({ units, series: s, next, value }) => `
    <article class="bond-holding${s.state === "arrears" || s.state === "defaulted" ? " bond-holding--late" : ""}" data-series="${escapeHtml(s.id)}">
      <header class="bond-series__header"><h4>${escapeHtml(s.issuerName ?? "A corporation")} · ${cr(units)} unit${units === 1 ? "" : "s"} ${refHtml(s.ref)}</h4>${seriesBadge(s)}</header>
      <dl class="bond-terms">
        <div><dt>Coupon</dt><dd>${pct(s.couponPct30)} per 30 days, paid every ${s.couponEveryDays} days</dd></div>
        <div><dt>Next coupon</dt><dd data-role="bond-next">${next ? `${cr(next.coupon)} credits, ${bankTime(next.at)}${next.face ? `, with ${cr(next.face)} face back` : ""}` : s.state === "subscribing" || s.state === "closing" ? `${s.couponEveryDays} days after the window closes (${bankTime(s.closesAt)} at the latest)` : "none: nothing left to pay"}</dd></div>
        <div><dt>Matures</dt><dd>${s.maturesAt ? bankTime(s.maturesAt) : `${s.maturityDays} days after the window closes`}</dd></div>
        ${s.arrears > 0 ? `<div><dt>Arrears</dt><dd class="bank-loan__arrears">${s.state === "defaulted" ? "Defaulted: what is recovered is paid to holders by units" : `The issuer is behind since ${bankTime(s.arrearsSince)}; what it owes you accrues penalty interest`}</dd></div>` : ""}
        <div><dt>Counts for</dt><dd>${cr(value)} credits in default recovery (90% of face)</dd></div>
      </dl>
    </article>`).join("")}</div>`;
}

/** The series the caller issued: sold, lapsed, next payment due, arrears. */
export function issuedHtml(board) {
  if (!board.issued.length) return "";
  return `<div class="bond-holdings">${board.issued.map((s) => `
    <article class="bond-holding${s.state === "arrears" || s.state === "defaulted" ? " bond-holding--late" : ""}" data-series="${escapeHtml(s.id)}">
      <header class="bond-series__header"><h4>${cr(s.quantity)} units at ${pct(s.couponPct30)}, ${s.maturityDays} days</h4>${seriesBadge(s)}</header>
      <dl class="bond-terms">
        <div><dt>Sold</dt><dd>${cr(s.sold)} of ${cr(s.quantity)}${s.underwriterUnits ? ` (${cr(s.underwriterUnits)} to the underwriter)` : ""}${s.lapsedUnits ? `, ${cr(s.lapsedUnits)} lapsed` : ""}</dd></div>
        <div><dt>${s.state === "subscribing" ? "Window closes in" : "Next payment due"}</dt><dd>${s.state === "subscribing" ? countdown(s.closesAt, board.now) : s.next ? `${cr(s.next.coupon + s.next.face)} credits, ${bankTime(s.next.at)}` : "none"}</dd></div>
        ${s.arrears > 0 ? `<div><dt>Arrears</dt><dd class="bank-loan__arrears">${cr(s.arrears)} credits owed since ${bankTime(s.arrearsSince)}</dd></div>` : ""}
      </dl>
    </article>`).join("")}</div>`;
}
