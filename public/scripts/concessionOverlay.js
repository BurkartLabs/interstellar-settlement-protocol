// ISP-229 (AB#924): the Starmap's Concessions overlay and the system panel's concession section, as data and HTML.
// Pure: no DOM and no requests, so node tests read it. public/scripts/starmap.js draws what this decides and
// views/starmap.js fetches and binds (docs/design/TERRITORY.md, "How it surfaces").
//
// The readings are the server's: GET /api/starmap/concessions (every system's holders and open petitions),
// GET /api/systems/:id/control (the top three, rounded, and who is eligible) and GET /api/accounts/:id/concessions/:id
// (the viewer's own eligibility, what a petition costs, and, for a holder, what it manages). Colours come from the
// design system's series tokens, every one named in the legend; the viewer's own holder is always the first (cyan).

import { escapeHtml } from "./html.js";
import { LEADER_TOKENS, OTHER_TOKEN, OWN_TOKEN, QUIET_TOKEN } from "./dominanceOverlay.js";
import { utcTime } from "./timeFormat.js"; // ISP-249 (AB#945)

export const CONCESSION_OVERLAY = "concessions";
/** A system the ISA never concedes: drawn muted and named "ISA administered". */
export const ISA_TOKEN = "--muted";
const n = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");
/** A time as the ISA register writes it (ISP-249, AB#945: the guide's format, public/scripts/timeFormat.js). */
export function isaTime(t) {
  return utcTime(t, { withDate: true });
}

/**
 * Each system's colour and marks, and the legend that names them: { bySystem: { id: { token, holder, pending, isa } },
 * legend: [{ key, token, label, systems, own, marker }] }. Holders take the palette by how many systems they hold (then
 * by name), the viewer's own first; a system with a petition under review carries a dashed ring.
 */
export function concessionKey(reading, ownNames = []) {
  const bySystem = {};
  const legend = [];
  if (!reading?.systems) return { bySystem, legend };
  const held = new Map();
  for (const s of Object.values(reading.systems)) for (const h of s?.holders || []) held.set(h.name, (held.get(h.name) || 0) + 1);
  const own = [...held.keys()].find((name) => ownNames.includes(name)) || "";
  const others = [...held.keys()].filter((name) => name !== own).sort((a, b) => held.get(b) - held.get(a) || a.localeCompare(b));
  const slot = new Map(others.slice(0, LEADER_TOKENS.length).map((name, i) => [name, LEADER_TOKENS[i]]));
  if (own) legend.push({ key: `holder:${own}`, token: OWN_TOKEN, label: own, systems: held.get(own), own: true });
  for (const [name, token] of slot) legend.push({ key: `holder:${name}`, token, label: name, systems: held.get(name), own: false });
  const rest = others.slice(LEADER_TOKENS.length);
  if (rest.length) legend.push({ key: "other", token: OTHER_TOKEN, label: `Other holders (${rest.length})`, systems: rest.reduce((a, name) => a + held.get(name), 0), own: false });
  let open = 0, isa = 0, pending = 0;
  for (const [id, s] of Object.entries(reading.systems)) {
    const holder = s?.holders?.[0]?.name || null;
    const hasPetition = Boolean(s?.petitions?.length);
    if (hasPetition) pending += 1;
    if (!s?.concedable) { isa += 1; bySystem[id] = { token: ISA_TOKEN, holder: null, pending: false, isa: true }; continue; }
    if (!holder) { open += 1; bySystem[id] = { token: QUIET_TOKEN, holder: null, pending: hasPetition, isa: false }; continue; }
    bySystem[id] = { token: holder === own ? OWN_TOKEN : slot.get(holder) || OTHER_TOKEN, holder, holders: s.holders.map((h) => h.name), pending: hasPetition, own: holder === own, grace: s.holders.some((h) => h.state === "grace") };
  }
  if (open) legend.push({ key: "open", token: QUIET_TOKEN, label: "No concession: open to petition", systems: open, own: false });
  if (isa) legend.push({ key: "isa", token: ISA_TOKEN, label: "ISA administered: never conceded", systems: isa, own: false });
  if (pending) legend.push({ key: "pending", token: "--series-3", label: "Petition under review", systems: pending, own: false, marker: "dashed" });
  return { bySystem, legend };
}

/** The legend under the map: a swatch (or the dashed ring) and a name for every mark shown. */
export function concessionLegendHtml(key) {
  if (!key.legend.length) return `<p class="ui-panel__meta">Reading the ISA's concession register…</p>`;
  return `<p class="starmap__subhead">ISA concessions: each system in its holder's colour.</p>
    <ul class="dominance-legend" data-concession-legend>${key.legend.map((e) => `
      <li class="dominance-legend__item${e.own ? " dominance-legend__item--own" : ""}" data-legend-key="${escapeHtml(e.key)}"><span class="dominance-legend__swatch ${e.marker === "dashed" ? "concession-swatch--pending" : `dominance-swatch--${e.token.slice(2)}`}" aria-hidden="true"></span><span>${e.own ? `<strong>You: ${escapeHtml(e.label)}</strong>` : escapeHtml(e.label)} · ${e.systems} system${e.systems === 1 ? "" : "s"}</span></li>`).join("")}
    </ul>
    <p class="ui-panel__meta">A concession is an ISA licence to a share of its fees here, never ownership: nobody's leases, buildings or goods change hands.</p>`;
}

/** The public part of a system's section: the holder(s), the control scores and any petition under review. */
function publicPart(summary, control, ownNames) {
  const holders = summary?.holders || [];
  const holderHtml = holders.length
    ? `<ul class="dominance-details" data-concession-holders>${holders.map((h) => `<li><span>${escapeHtml(h.name)}${ownNames.includes(h.name) ? " (you)" : ""} · ${h.type === "conglomerate" ? "conglomerate" : "corporation"}${h.state === "grace" ? " · upkeep unpaid, benefits suspended" : ""}</span><strong>to ${isaTime(h.termEndsAt)}</strong></li>`).join("")}</ul>`
    : `<p class="ui-panel__meta" data-concession-holders>No concession is held here.</p>`;
  const rows = (control?.holders || []).map((h) => `<li${ownNames.includes(h.name) ? ' class="dominance-details__own"' : ""}><span>${escapeHtml(h.name)}${h.eligible ? ' <span class="ui-badge ui-badge--success">Eligible</span>' : ""}</span><strong>${h.score}%</strong></li>`).join("");
  const others = control?.others > 0 ? `<li class="dominance-details__others"><span>Others</span><strong>${control.others}%</strong></li>` : "";
  const controlHtml = control
    ? rows ? `<ol class="dominance-details" data-concession-control>${rows}${others}</ol><p class="ui-panel__meta">Control: shares of leases, tonnes and sales here over 7 days, at this system's weights, rounded to 5%.${control.stale ? " These readings are stale: nobody is eligible until they are fresh." : ""}</p>` : `<p class="ui-panel__meta" data-concession-control>No control here in the last 7 days.</p>`
    : `<p class="ui-panel__meta">Reading control scores…</p>`;
  const petitions = (summary?.petitions || []).map((p) => `<li><span>${escapeHtml(p.name)} · ${p.kind === "challenge" ? "challenge" : "petition"}</span><strong>review ends ${isaTime(p.reviewEndsAt)}</strong></li>`).join("");
  return `<h4 class="starmap__subhead">Holder</h4>${holderHtml}
    <h4 class="starmap__subhead">Control</h4>${controlHtml}
    ${petitions ? `<h4 class="starmap__subhead">Under review</h4><ul class="dominance-details concession-petitions" data-concession-petitions>${petitions}</ul>` : ""}`;
}

/** The viewer's petition: its streak, what it costs, and the action (or why not). */
function petitionPart(status) {
  const p = status?.petition;
  if (!p) return "";
  const streak = `<p class="ui-panel__meta" data-concession-streak>As ${escapeHtml(status.holder.name)}: eligible on ${status.streakDays} of the last ${status.needDays} days${status.eligible ? " (eligible now)" : ""}.</p>`;
  if (p.open) return `${streak}<p class="ui-panel__meta">Your petition is under review until ${isaTime(p.open.reviewEndsAt)}.</p>`;
  const verb = p.kind === "challenge" ? "Challenge" : "Petition";
  return `${streak}
    <div class="concession-actions"><button type="button" class="ui-button ui-button--primary" data-role="concession-petition" data-kind="${p.kind}" data-fee="${p.fee}" data-upkeep="${p.upkeepIfGranted}" data-after="${p.concessionsAfter}"${p.refusal ? ' disabled aria-describedby="concession-why"' : ""}>${verb} for ${n(p.fee)} credits</button></div>
    ${p.refusal ? `<p class="concession-why" id="concession-why">${escapeHtml(p.refusal)}</p>` : `<p class="ui-panel__meta">Then about ${n(p.upkeepIfGranted)} credits a day in upkeep while you hold it.</p>`}`;
}

/** The holder's management view: its term, upkeep, fee share, and the lease discount it sets. */
export function holderPart(holds, holderName) {
  if (!holds) return "";
  const pending = holds.pendingLeaseDiscount;
  const options = Array.from({ length: holds.leaseDiscountMaxPct + 1 }, (_, i) => `<option value="${i}"${i === (pending?.pct ?? holds.leaseDiscountPct) ? " selected" : ""}>${i}%</option>`).join("");
  return `<section class="concession-holder" data-concession-holder>
      <h4 class="starmap__subhead">Your concession</h4>
      <dl class="concession-terms">
        <div><dt>Held by</dt><dd>${escapeHtml(holderName)}</dd></div>
        <div><dt>State</dt><dd>${holds.state === "grace" ? `<span class="concession-grace">Upkeep unpaid since ${isaTime(holds.graceSince)}: benefits suspended</span>` : "In force"}</dd></div>
        <div><dt>Term</dt><dd>to ${isaTime(holds.termEndsAt)}, renewed while you keep 25% control</dd></div>
        <div><dt>Upkeep</dt><dd>${n(holds.upkeepToday)} credits a day</dd></div>
        <div><dt>Fee share</dt><dd>${holds.feeSharePct}% of others' lease fees here: ${n(holds.feeShareCollected)} credits so far</dd></div>
        <div><dt>Your own leases</dt><dd>${holds.ownLeaseDiscountPct}% off</dd></div>
        <div><dt>Everyone's leases</dt><dd data-concession-discount>${holds.leaseDiscountPct}% off${pending ? `, ${pending.pct}% from ${isaTime(pending.effectiveAt)}` : ""}</dd></div>
      </dl>
      <form class="concession-discount" data-role="concession-discount" novalidate>
        <label class="ui-field__label" for="concession-discount-pct">Discount on everyone's new leases here</label>
        <div class="concession-actions">
          <select class="ui-select" id="concession-discount-pct" name="discountPct"${pending ? " disabled" : ""}>${options}</select>
          <button type="submit" class="ui-button ui-button--secondary"${pending ? ' disabled aria-describedby="concession-discount-why"' : ""}>Set the discount</button>
        </div>
        <p class="concession-why" id="concession-discount-why">${pending ? `A change is waiting out its notice until ${isaTime(pending.effectiveAt)}.` : `A change applies after ${holds.noticeHours} hours. It lowers everyone's price, never raises it.`}</p>
      </form>
      <div class="concession-actions"><button type="button" class="ui-button ui-button--danger" data-role="concession-relinquish">Relinquish the concession</button></div>
      <p class="concession-status" data-role="concession-status" role="status"></p>
    </section>`;
}

/** A system's whole concession section for the details panel. */
export function concessionDetailsHtml(summary, control, status, ownNames = []) {
  if (summary && !summary.concedable) {
    return `<div class="concession-section" data-concession-details><h4 class="starmap__subhead">ISA concession</h4>
      <p class="ui-panel__meta" data-concession-isa>ISA administered: never conceded.${control?.rule ? ` ${escapeHtml(control.rule)}` : ""}</p></div>`;
  }
  return `<div class="concession-section" data-concession-details>
    <h4 class="starmap__subhead">ISA concession</h4>
    ${control?.rule ? `<p class="ui-panel__meta" data-concession-rule>Rule: ${escapeHtml(control.rule)}</p>` : ""}
    ${publicPart(summary, control, ownNames)}
    ${status?.holds ? holderPart(status.holds, status.holder.name) : petitionPart(status)}
  </div>`;
}
