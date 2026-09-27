// public/scripts/patentOffice.js: the patent office at Corporate Registry & Charters (ISP-237, AB#932; docs/design/
// WARFARE.md, "Patents"), as HTML. Pure: it draws what the server sent (GET /api/accounts/:id/patents, the caller's own
// office, and GET /api/patents, the public register), so a test renders it without a page. views/patentOffice.js fetches,
// binds and posts; the server decides every filing.
//
// Four parts: what the corporation may file now, with each filing window's end and a rate in its kind's bound; its own
// patents and the royalties its statements show received; the patents it pays on, with what each costs it; and the
// public register (holder, subject, rate and term end).
import { escapeHtml } from "./html.js";
import { utcMinute } from "./tariffs.js";
import { chainRunRoyalty, researchRoyalty } from "./patentRoyalty.js";

const n = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");
const KIND = { research: "Research node", chain: "Refinery chain" };
const hoursLeft = (t, now) => Math.max(0, Math.ceil((t - now) / 3_600_000));
const day = (t) => utcMinute(t).slice(0, 10);

/**
 * How the office names a subject: `ctx.nameOf(kind, subjectId)` (the page's research and chain names) or the server's
 * subjectName.
 */
const nameFor = (p, ctx) => ctx.nameOf?.(p.kind, p.subjectId) || p.subjectName || p.subjectId;

function termsHtml(t) {
  return `<p class="ui-panel__meta patent-terms" data-role="patent-terms">Filing costs <strong>${n(t.filingFee)} credits</strong>, paid to the ISA. Only the first corporation to complete a thing may patent it, within ${n(t.filingWindowHours)} hours of completing it. A patent runs ${n(t.termDays)} days and is never renewed. The royalty is one rate for everyone but you: up to ${n(t.royaltyMaxPct)}% of a research node's cost, or up to ${n(t.chainRoyaltyMaxPct)}% of a refinery chain's output at the standing bid.</p>`;
}

/** What the corporation may file now, each with its window and a rate select, or why there is nothing. */
export function filingHtml(office, ctx) {
  const now = ctx.now ?? Date.now();
  const rows = office.filable.map((f) => {
    const id = `patent-rate-${f.kind}-${f.subjectId}`;
    const left = hoursLeft(f.windowEndsAt, now);
    return `<li class="patent-card" data-patent-filable="${escapeHtml(`${f.kind}:${f.subjectId}`)}">
      <p class="patent-card__title"><strong>${escapeHtml(nameFor(f, ctx))}</strong> <span class="ui-badge">${KIND[f.kind]}</span></p>
      <p class="patent-card__meta">You completed it first. The window closes ${escapeHtml(utcMinute(f.windowEndsAt))} (${left === 1 ? "1 hour" : `${n(left)} hours`} left).</p>
      <div class="patent-card__form">
        <label class="ui-field__label" for="${escapeHtml(id)}">Royalty rate</label>
        <select class="ui-select" id="${escapeHtml(id)}" data-role="patent-rate">
          ${Array.from({ length: f.maxPct + 1 }, (_, i) => `<option value="${i}"${i === Math.min(f.maxPct, f.kind === "chain" ? 2 : 10) ? " selected" : ""}>${i}%</option>`).join("")}
        </select>
        <button type="button" class="ui-button ui-button--primary" data-role="patent-file" data-kind="${escapeHtml(f.kind)}" data-subject-id="${escapeHtml(f.subjectId)}" data-rate-input="${escapeHtml(id)}">File patent (${n(office.terms.filingFee)} credits)</button>
      </div>
    </li>`;
  }).join("");
  return `<section class="ui-panel station__panel patent-section" data-patent-filing aria-labelledby="patent-filing-title">
    <h3 id="patent-filing-title">File a patent</h3>
    ${termsHtml(office.terms)}
    ${rows
      ? `<ul class="patent-list">${rows}</ul>`
      : `<div class="ui-state"><p class="ui-state__title">Nothing to file now.</p><p class="ui-state__why">Complete a research node of tier 3 or above, or deliver the first run of a stage 2 refinery chain, before any other corporation does. You then have ${n(office.terms.filingWindowHours)} hours to file here.</p></div>`}
    <p class="patent-status" data-role="patent-status" role="status" aria-live="polite"></p>
  </section>`;
}

function patentDl(p, rows) {
  return `<dl class="patent-terms-list">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

/** The corporation's own patents, and the royalties its statements show received. */
export function minePatentsHtml(office, ctx) {
  const rows = office.mine.map((p) => `<li class="patent-card" data-patent-mine="${escapeHtml(p.id)}">
      <p class="patent-card__title"><strong>${escapeHtml(nameFor(p, ctx))}</strong> <span class="ui-badge">${KIND[p.kind]}</span> ${p.active ? `<span class="ui-badge ui-badge--success">In force</span>` : `<span class="ui-badge">Expired</span>`}</p>
      ${patentDl(p, [["Royalty", `${n(p.ratePct)}%`], ["Filed", escapeHtml(day(p.filedAt))], [p.active ? "Ends" : "Ended", escapeHtml(utcMinute(p.endsAt))]])}
    </li>`).join("");
  return `<section class="ui-panel station__panel patent-section" data-patent-mine-list aria-labelledby="patent-mine-title">
    <h3 id="patent-mine-title">Your patents</h3>
    <p class="patent-total" data-role="royalties-received">Royalties received: <strong>${n(office.royalties.received)} credits</strong></p>
    ${rows ? `<ul class="patent-list">${rows}</ul>` : `<p class="ui-panel__meta">You hold no patents.</p>`}
  </section>`;
}

/** What one patent costs the corporation each time it uses the subject, in words and credits. */
function costText(p, ctx) {
  if (p.kind === "research") {
    const cost = Number(ctx.researchCost?.(p.subjectId)) || 0;
    return `${n(p.ratePct)}% of its research cost of ${n(cost)}: <strong>${n(researchRoyalty(cost, p.ratePct))} credits</strong> when your research completes.`;
  }
  const chain = (ctx.chains || []).find((c) => c.id === p.subjectId);
  const outputs = (chain?.outputs || []).map((o) => ({ item: o.item, quantity: Number(o.quantityPerCycle) || 0 }));
  const { royalty } = chainRunRoyalty(outputs, p.ratePct, ctx.basePrices);
  return `${n(p.ratePct)}% of each run's output at the standing bid: <strong>${n(royalty)} credits</strong> a batch at a tier 1 Refinery, charged when the run delivers.`;
}

/** Others' patents the corporation pays on, and the royalties its statements show paid. */
export function payingHtml(office, ctx) {
  const rows = office.paying.map((p) => `<li class="patent-card" data-patent-paying="${escapeHtml(p.id)}">
      <p class="patent-card__title"><strong>${escapeHtml(nameFor(p, ctx))}</strong> <span class="ui-badge">${KIND[p.kind]}</span></p>
      ${patentDl(p, [["Holder", escapeHtml(p.holder)], ["Royalty", costText(p, ctx)], ["Ends", escapeHtml(utcMinute(p.endsAt))]])}
    </li>`).join("");
  return `<section class="ui-panel station__panel patent-section" data-patent-paying-list aria-labelledby="patent-paying-title">
    <h3 id="patent-paying-title">Patents you pay royalties on</h3>
    <p class="patent-total" data-role="royalties-paid">Royalties paid: <strong>${n(office.royalties.paid)} credits</strong></p>
    ${rows
      ? `<ul class="patent-list">${rows}</ul><p class="ui-panel__meta">A royalty never stops you: the research finishes and the run delivers in full. What your credits cannot cover is owed to the holder, and half of each later sale's proceeds goes toward it.</p>`
      : `<p class="ui-panel__meta">None of the chains you run or the research you have completed is under another corporation's patent.</p>`}
  </section>`;
}

/** The public register: every patent filed, newest first. */
export function registerHtml(register, ctx) {
  const rows = (register || []).map((p) => `<li class="patent-card" data-patent-register="${escapeHtml(p.id)}">
      <p class="patent-card__title"><strong>${escapeHtml(nameFor(p, ctx))}</strong> <span class="ui-badge">${KIND[p.kind] || escapeHtml(p.kind)}</span> ${p.active ? `<span class="ui-badge ui-badge--success">In force</span>` : `<span class="ui-badge">Expired</span>`}</p>
      ${patentDl(p, [["Holder", escapeHtml(p.holder)], ["Royalty", `${n(p.ratePct)}%`], [p.active ? "Ends" : "Ended", escapeHtml(utcMinute(p.endsAt))]])}
    </li>`).join("");
  return `<section class="ui-panel station__panel patent-section" data-patent-register-list aria-labelledby="patent-register-title">
    <h3 id="patent-register-title">The patent register</h3>
    <p class="ui-panel__meta">Every patent the Registry has filed, public to all.</p>
    ${rows ? `<ul class="patent-list">${rows}</ul>` : `<p class="ui-panel__meta">No patent has been filed yet.</p>`}
  </section>`;
}

/** The whole office under the building's header, or its loading or error line. */
export function patentOfficeHtml({ office, register, error }, ctx) {
  if (error) return `<div class="ui-state ui-state--error" data-patent-office><p class="ui-state__title">The patent office could not be read.</p><p class="ui-state__why">${escapeHtml(error)}</p></div>`;
  if (!office) return `<p class="ui-panel__meta" data-patent-office>Reading the patent office…</p>`;
  return `<div class="patent-office" data-patent-office>
    ${filingHtml(office, ctx)}
    ${minePatentsHtml(office, ctx)}
    ${payingHtml(office, ctx)}
    ${registerHtml(register, ctx)}
  </div>`;
}
