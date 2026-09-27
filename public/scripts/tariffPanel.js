// public/scripts/tariffPanel.js: a system's concession tariff in the starmap's system panel (ISP-231, AB#926;
// docs/design/WARFARE.md, "Tariffs"). Pure: HTML from the caller's tariff summary (GET /api/accounts/:id/tariffs), so
// tests read it without a page.
//
// Everyone sees a held system's rate and any pending change, with the time it takes effect in UTC, before trading or
// shipping there. The holder also sees its schedule: the rate it filed, the system's rate where two holders share it,
// what it has collected and what the next daily payout brings, and, docked in the system, the form that files a rate.
import { escapeHtml } from "./html.js";
import { toCurrency } from "./helpers.js";
import { utcMinute } from "./tariffs.js";

const pctText = (p) => `${Number(p).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** The public line: the rate, and a pending change. "" for a system nobody holds. */
export function tariffLineHtml(view) {
  if (!view?.held) return "";
  const pending = view.pending ? ` It becomes <strong>${pctText(view.pending.pct)}</strong> at ${escapeHtml(utcMinute(view.pending.effectiveAt))}.` : "";
  return `<p class="starmap__tariff" data-role="system-tariff">ISA concession tariff: <strong>${pctText(view.pct)}</strong> on sales here and goods shipped in (cap ${pctText(view.cap)}).${pending}</p>`;
}

/** The holder's schedule and, docked there, the form. "" when the viewer does not hold the system. */
export function tariffHoldingHtml(h, systemName) {
  if (!h) return "";
  const pending = h.pending ? `<li>Filed: <strong>${pctText(h.pending.pct)}</strong>, in force at ${escapeHtml(utcMinute(h.pending.effectiveAt))}</li>` : "";
  const shared = h.holders > 1 ? `<li>The system charges <strong>${pctText(h.systemPct)}</strong>: the lower of its two holders' rates</li>` : "";
  const form = h.docked
    ? `<form class="starmap__tariff-form" data-form="file-tariff" data-system-id="${escapeHtml(h.systemId)}">
        <label class="ui-field"><span class="ui-field__label">New rate (%)</span>
          <input class="ui-input" type="number" name="pct" min="0" max="${h.cap}" step="0.25" value="${h.pending ? h.pending.pct : h.pct}" required /></label>
        <button class="ui-button ui-button--secondary" type="submit">File rate</button>
      </form>
      <p class="ui-panel__meta">An increase takes effect 72 hours after it is filed, and traders see it meanwhile; a decrease takes effect at once.</p>
      <p class="ui-panel__meta" data-role="tariff-status" role="status" aria-live="polite"></p>`
    : `<p class="ui-panel__meta">A rate is filed at ${escapeHtml(systemName)}'s ISA Claims &amp; Leases: travel there to change it.</p>`;
  return `<section class="starmap__tariff-holding" data-role="tariff-holding" aria-label="Your tariff">
    <h4 class="starmap__subhead">Your tariff</h4>
    <ul class="ui-list">
      <li>In force: <strong>${pctText(h.pct)}</strong> of a ${pctText(h.cap)} cap</li>
      ${pending}${shared}
      <li>Collected to date: <strong>${escapeHtml(toCurrency(h.paidTotal))}</strong></li>
      <li>At the next payout (00:00 UTC): <strong>${escapeHtml(toCurrency(h.accrued))}</strong>, after the ISA's levy</li>
    </ul>
    ${form}
  </section>`;
}

/** Both, for the system panel. */
export function tariffPanelHtml(systemId, summary, systemName) {
  return tariffLineHtml(summary?.systems?.[systemId]) + tariffHoldingHtml((summary?.holdings || []).find((h) => h.systemId === systemId), systemName);
}
