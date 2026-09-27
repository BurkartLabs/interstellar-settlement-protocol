// public/scripts/arbitrationCouncil.js: the Galactic Arbitration Council's chambers (ISP-243, AB#939; docs/design/
// WARFARE.md, "How it surfaces"; the voice is docs/design/BUREAUCRATIC_UI.md), as HTML. Pure: it draws what the server
// sent (the caller's records for a claim type, the evidence preview, its own cases and the public docket), so a test
// renders it without a page. views/arbitrationCouncil.js fetches, binds and posts; the server decides everything.
//
// Three parts, as a court registry: filing (claim type, then the record, then the evidence preview with the rule beside
// it, then the fee to confirm; no field is free text), the corporation's own cases (the evidence, the window, the cure
// for a respondent, the ruling in the Council's words), and the public docket. Times are UTC in the ISA's year (the
// real year + 121, BUREAUCRATIC_UI.md), each a <time> with the real instant, until ISP-249's one formatter replaces this.
import { escapeHtml } from "./html.js";
import { timeHtml } from "./timeFormat.js"; // ISP-249 (AB#945)

const n = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");
const cr = (v) => `${n(v)} credits`;
const pad = (v) => String(v).padStart(2, "0");

/** A time as the ISA writes it: "2147-10-02 00:00 UTC", in a <time> carrying the real instant. */
export function isaTime(t) {
  return timeHtml(t, { withDate: true }); // ISP-249 (AB#945): the one formatter
}
/** A deadline: within a day it also says how far away it is (BUREAUCRATIC_UI.md, Timestamps). */
function deadline(t, now) {
  const left = t - now;
  if (left <= 0 || left > 86_400_000) return isaTime(t);
  const h = Math.floor(left / 3_600_000), m = Math.floor((left % 3_600_000) / 60_000);
  return `in ${h ? `${h} h ` : ""}${m} min (${isaTime(t)})`;
}

/** The claim types, in the catalog's order, as the filing screen explains them (WARFARE.md, "The claim types"). */
export const CLAIMS = [
  { id: "mercenary-readiness", title: "Mercenary readiness", files: "The renter of a hired fleet", record: "a mercenary contract you hired, running or ended in the last 7 days",
    rule: "Upheld if the owner's readiness fell below the readiness you were shown at hire in any hour of the term. Refund = the price × each hour's shortfall ÷ the hire readiness, ÷ the term's hours, paid from the contract's escrow while it runs." },
  { id: "tariff-overcharge", title: "Tariff overcharge", files: "The seller or shipper", record: "a sale or transfer of yours that paid a concession tariff in the last 30 days",
    rule: "The lawful rate is the lower of the rate when the listing was posted and the rate in force, capped at the system's cap, and 0 if no concession was granted. Upheld if you were charged more; the excess × the base is repaid by those who received it." },
  { id: "concession-arbitrated", title: "Arbitrated concession", files: "The petitioner or challenger", record: "your open petition or challenge in Wolf 359 or Epsilon Indi, contested by another",
    rule: "TERRITORY.md's rules at the 7-day review's end. Scores within 1 point go to the higher extraction share, then the earlier filing. The fee is the petition fee, kept either way." },
  { id: "patent-royalty", title: "Patent royalty", files: "The patent's holder", record: "another corporation's recorded uses of your patent",
    rule: "Royalty due = each use × the patent's rate, against the royalty the settlement recorded. Upheld if more was due. A debt still being withheld from the user's sales is being collected, and is not a shortfall." },
  { id: "credit-default", title: "Credit default", files: "The ISA only", record: "a loan or bond series in default recovery",
    rule: "Docketed by the ISA when recovery starts, and always upheld: the ruling is the recovery's result. No corporation files one." }
];
const claim = (type) => CLAIMS.find((c) => c.id === type) || { title: type, rule: "" };

/** A case's state in the plain word and the protocol phrase (BUREAUCRATIC_UI.md, Status vocabulary). */
export function caseStatus(c, now = Date.now()) {
  if (c.state === "answering") return { plain: "Pending", protocol: `Filed, awaiting review; ruled ${c.decideAt ? isaTime(c.decideAt) : "after the window"}`, tone: "" };
  if (c.state === "enforcing") return { plain: "Active", protocol: `In force; award being collected, ${cr(c.paid)} of ${cr(c.ruling?.amount)} paid`, tone: "ui-badge--warn" };
  if (c.state === "ruled") return { plain: "Active", protocol: "Ruled", tone: "" };
  return { plain: "Complete", protocol: `Concluded${c.ruling?.at ? ` ${isaTime(c.ruling.at)}` : ""}`, tone: "ui-badge--success" };
}
const OUTCOME = { upheld: ["Upheld", "ui-badge--success"], dismissed: ["Dismissed", ""], cured: ["Cured", "ui-badge--success"] };
const outcomeBadge = (r) => (r && OUTCOME[r.outcome] ? `<span class="ui-badge ${OUTCOME[r.outcome][1]}">${OUTCOME[r.outcome][0]}${r.amount > 0 ? `: ${cr(r.amount)}` : r.order ? `: ${escapeHtml(r.order)}` : ""}</span>` : "");
const dl = (rows) => `<dl class="gac-terms">${rows.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
/** A run of hourly readings, as "100 ×2, 80 ×4, 70 ×18". */
export function runs(values) {
  const out = [];
  for (const v of values || []) { const last = out.at(-1); if (last && last[0] === v) last[1] += 1; else out.push([v, 1]); }
  return out.map(([v, k]) => `${v} ×${k}`).join(", ");
}

/** What a record is called in the filing list, by claim type. */
export function recordLabel(type, r, ctx = {}) {
  const station = (id) => ctx.stationName?.(id) || id;
  if (type === "mercenary-readiness") return `${escapeHtml(r.fleetName)}, hired from ${escapeHtml(r.owner)} · ${r.state === "hired" ? `term ends ${isaTime(r.endsAt)}` : `ended ${isaTime(r.endsAt)}`}`;
  if (type === "tariff-overcharge") return `${r.kind === "sale" ? `Sale of ${n(r.quantity)} ${escapeHtml(r.item)}` : "Transfer"} at ${escapeHtml(station(r.stationId))}, ${isaTime(r.at)} · tariff ${r.tariffPct}%, ${cr(r.tariffAmount)}`;
  if (type === "concession-arbitrated") return `Your ${r.kind} in ${escapeHtml(ctx.systemName?.(r.systemId) || r.systemId)} · filed ${isaTime(r.filedAt)}, review ends ${isaTime(r.reviewEndsAt)}`;
  if (type === "patent-royalty") return `${escapeHtml(ctx.subjectName?.(r.patent) || r.patent)}, used by ${escapeHtml(r.user)}`;
  return escapeHtml(r.recordId);
}

/** The evidence of a case or preview, as the server attached it, in words, by claim type: [label, value] rows. */
export function evidenceRows(type, e, ctx = {}) {
  if (!e) return [];
  if (type === "mercenary-readiness") {
    const c = e.contract;
    return ([
      ["Contract", `${escapeHtml(c.fleetName)}: ${n(c.termHours)} hours for ${cr(c.price)}, collateral ${cr(c.collateral)}, ${escapeHtml(c.allowedUse)}`],
      ["Term", `${isaTime(c.hiredAt)} to ${isaTime(c.endsAt)}`],
      ["Readiness at hire", `${n(e.hireReadiness)}`],
      ["Owner's readiness, hour by hour", e.hourlyReadiness.length ? escapeHtml(runs(e.hourlyReadiness)) : "No hour of the term has run yet"],
      ["Hours below hire readiness", `${n(e.hoursBelow)} of the ${n(e.hourlyReadiness.length)} hours run`],
      ["Refund on this evidence", cr(e.refund)]
    ]);
  }
  if (type === "tariff-overcharge") {
    const s = e.settlement;
    return ([
      ["Settlement", `${s.kind === "sale" ? "Sale" : "Transfer"} at ${escapeHtml(ctx.stationName?.(s.stationId) || s.stationId)}, ${isaTime(s.at)}`],
      ["Charged", `${s.chargedPct}% on a base of ${cr(s.base)}: ${cr(s.amount)}, of which the ISA's levy ${cr(s.levy)}`],
      ["Rate when posted", s.postedPct === null || s.postedPct === undefined ? "Not a listing (charged at the rate in force)" : `${s.postedPct}%`],
      ["Holders' rates then", e.holders.map((h) => `${h.ratePct}% (${h.stateAt || "state not on record"})`).join("; ")],
      ["System cap", `${e.capPct}%`],
      ["Lawful rate", `${e.lawfulPct}%`],
      ["Excess", cr(e.excess)]
    ]);
  }
  if (type === "concession-arbitrated") {
    const party = (p, who) => `${who}: score ${Math.round(p.score * 100)}, extraction ${Math.round(p.extraction * 100)}%, ${p.eligible ? "eligible" : "not eligible"} (${n(p.streakDays)} days)`;
    return ([
      ["System", escapeHtml(ctx.systemName?.(e.systemId) || e.systemId)],
      [`The ${escapeHtml(e.petition.kind)}`, `filed ${isaTime(e.petition.filedAt)}, review ends ${isaTime(e.petition.reviewEndsAt)}`],
      ["Control readings", `${escapeHtml(party(e.claimant, "Claimant"))}<br>${escapeHtml(party(e.respondent, "Respondent"))}${e.stale ? "<br>The readings are stale: nothing is decided until they are fresh." : ""}`]
    ]);
  }
  if (type === "patent-royalty") {
    return ([
      ["Patent", `${escapeHtml(ctx.subjectName?.(e.patent.subjectId) || e.patent.subjectName)} at ${e.patent.ratePct}%, in force until ${isaTime(e.patent.endsAt)}`],
      ["Recorded uses", `${n(e.uses.length)}, on a base of ${cr(e.uses.reduce((s, u) => s + (u.base || 0), 0))}`],
      ["Royalty due at the rate", cr(e.due)],
      ["Royalty recorded", `${cr(e.recorded)}, of which paid ${cr(e.paid)}`],
      ["Still being withheld", cr(e.debtOwed)],
      ["Shortfall", cr(e.shortfall)]
    ]);
  }
  if (type === "credit-default") {
    return ([["Record", `${escapeHtml(e.record.kind)} ${escapeHtml(e.record.id)}`], ["Owed at recovery", cr(e.owedBefore)], ["Collected", cr(e.collected)], ["Shortfall", cr(e.shortfall)]]);
  }
  return [];
}
/** The evidence as one list. */
export const evidenceHtml = (type, e, ctx = {}) => (e ? dl(evidenceRows(type, e, ctx)) : "");

/** Step 1: the claim type. */
function typeStep(state) {
  return `<fieldset class="gac-step" data-gac-step="type">
    <legend class="gac-step__title"><span class="gac-step__n" aria-hidden="true">1</span> Claim type</legend>
    <ul class="gac-choices">${CLAIMS.map((c) => {
      const isa = c.id === "credit-default";
      return `<li><label class="gac-choice${isa ? " gac-choice--off" : ""}">
        <input type="radio" name="gac-type" value="${c.id}"${state.type === c.id ? " checked" : ""}${isa ? " disabled" : ""} data-role="gac-type">
        <span><strong>${c.title}</strong><span class="gac-choice__meta">${c.files} files it, on ${c.record}.</span></span>
      </label></li>`;
    }).join("")}</ul>
  </fieldset>`;
}

/** Step 2: the record (only records the caller is party to and the type applies to). */
function recordStep(state, ctx) {
  if (!state.type) return "";
  const body = state.records === null
    ? `<p class="ui-panel__meta">Reading your records…</p>`
    : state.records.length
      ? `<ul class="gac-choices">${state.records.map((r) => `<li><label class="gac-choice">
          <input type="radio" name="gac-record" value="${escapeHtml(r.recordId)}"${state.recordId === r.recordId ? " checked" : ""} data-role="gac-record">
          <span>${recordLabel(state.type, r, ctx)}</span></label></li>`).join("")}</ul>`
      : `<div class="ui-state"><p class="ui-state__title">No record to file on.</p><p class="ui-state__why">A ${escapeHtml(claim(state.type).title.toLowerCase())} case is filed on ${escapeHtml(claim(state.type).record)}, without a case on it already. You have none.</p></div>`;
  return `<fieldset class="gac-step" data-gac-step="record">
    <legend class="gac-step__title"><span class="gac-step__n" aria-hidden="true">2</span> Record</legend>
    <p class="ui-panel__meta">The respondent is the record's other party. The Council takes no statement from either side.</p>
    ${body}
  </fieldset>`;
}

/** Step 3: the evidence preview, with the rule beside it, and step 4: the fee to confirm. */
function previewStep(state, ctx) {
  if (!state.recordId) return "";
  const p = state.preview;
  if (!p) return `<section class="gac-step" data-gac-step="preview"><h4 class="gac-step__title"><span class="gac-step__n" aria-hidden="true">3</span> Evidence</h4><p class="ui-panel__meta">${state.previewError ? escapeHtml(state.previewError) : "Reading the evidence…"}</p></section>`;
  return `<section class="gac-step" data-gac-step="preview" aria-labelledby="gac-preview-title">
    <h4 class="gac-step__title" id="gac-preview-title"><span class="gac-step__n" aria-hidden="true">3</span> Evidence the Council will attach</h4>
    <div class="gac-preview">
      <div class="gac-preview__evidence" data-gac-evidence>
        ${dl([["Claimant", escapeHtml(p.claimant.name)], ["Respondent", escapeHtml(p.respondent.name)], ["Amount claimed", cr(p.amountClaimed)], ...evidenceRows(p.type, p.evidence, ctx)])}
      </div>
      <aside class="gac-preview__rule" aria-label="The rule"><p class="gac-rule__head">The rule</p><p>${escapeHtml(claim(p.type).rule)}</p></aside>
    </div>
    <h4 class="gac-step__title"><span class="gac-step__n" aria-hidden="true">4</span> Fee</h4>
    <p class="ui-panel__meta">Filing costs <strong>${cr(p.fee)}</strong>, held until the ruling${p.type === "concession-arbitrated" ? " and kept either way, as a petition fee is" : ": returned if the case is upheld or cured, forfeited if it is dismissed"}. ${escapeHtml(p.respondent.name)} has ${n(p.responseHours)} hours to cure before the rule is applied.${p.freezesEscrow ? " Filing holds the contract's escrow until the ruling." : ""}</p>
    <button type="button" class="ui-button ui-button--primary" data-role="gac-file">File case (${cr(p.fee)})</button>
  </section>`;
}

/** The filing wizard. */
export function filingHtml(state, ctx = {}) {
  return `<section class="ui-panel station__panel gac-section" data-gac-filing aria-labelledby="gac-filing-title">
    <h3 id="gac-filing-title">File a case</h3>
    <p class="ui-panel__meta">A case has no words in it. You choose a claim type and a record you are party to; the Council attaches the ISA's own evidence and applies its published rule.</p>
    ${typeStep(state)}
    ${recordStep(state, ctx)}
    ${previewStep(state, ctx)}
    <p class="gac-status" data-role="gac-status" role="status" aria-live="polite">${state.status ? escapeHtml(state.status) : ""}</p>
  </section>`;
}

/** One of the caller's cases: its parties, window, evidence, ruling, and a respondent's cure. */
export function caseHtml(c, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const s = caseStatus(c, now);
  const respondent = ctx.isMe?.(c.respondent);
  const curable = respondent && c.state === "answering" && now < c.windowEndsAt && !["concession-arbitrated", "credit-default"].includes(c.type);
  const owed = (c.debts || []).reduce((a, d) => a + (d.owed || 0), 0);
  return `<li class="gac-case" data-gac-case="${escapeHtml(c.ref)}">
    <details${ctx.open === c.ref ? " open" : ""}>
      <summary class="gac-case__summary">
        <span class="gac-ref">${escapeHtml(c.ref)}</span>
        <span class="gac-case__title">${escapeHtml(claim(c.type).title)}: ${escapeHtml(c.claimant.name)} v. ${escapeHtml(c.respondent.name)}</span>
        <span class="gac-case__status"><span class="ui-badge ${s.tone}">${s.plain}</span> ${outcomeBadge(c.ruling)}</span>
      </summary>
      <div class="gac-case__body">
        <p class="gac-protocol">${s.protocol}.</p>
        ${dl([
          ["You are", ctx.isMe?.(c.claimant) ? "the claimant" : respondent ? "the respondent" : "a party"],
          ["Filed", isaTime(c.filedAt)],
          ["Response window", c.state === "answering" ? `closes ${deadline(c.windowEndsAt, now)}` : `closed ${isaTime(c.windowEndsAt)}`],
          ["Amount claimed", cr(c.amountClaimed)],
          ["Filing fee", cr(c.feePaid)],
          owed > 0 ? ["Council debt owed", `${cr(owed)}, withheld from sales`] : null
        ])}
        <h5 class="gac-case__sub">Evidence as filed (the parties only)</h5>
        ${evidenceHtml(c.type, c.evidence, ctx)}
        ${c.ruling?.text ? `<h5 class="gac-case__sub">Ruling</h5><p class="gac-ruling" data-gac-ruling>${escapeHtml(c.ruling.text)}</p>` : ""}
        ${c.alert ? `<p class="gac-status">The Council could not rule yet: ${escapeHtml(c.alert)}</p>` : ""}
        ${curable ? `<button type="button" class="ui-button ui-button--secondary" data-role="gac-cure" data-ref="${escapeHtml(c.ref)}">Cure: pay ${cr(c.amountClaimed)}</button>` : ""}
      </div>
    </details>
  </li>`;
}

/** The caller's own cases, pinned above the docket. */
export function myCasesHtml(cases, ctx = {}) {
  return `<section class="ui-panel station__panel gac-section" data-gac-mine aria-labelledby="gac-mine-title">
    <h3 id="gac-mine-title">Your cases</h3>
    ${cases.length ? `<ul class="gac-cases">${cases.map((c) => caseHtml(c, ctx)).join("")}</ul>` : `<p class="ui-panel__meta">Your corporation is party to no case.</p>`}
  </section>`;
}

/** The public docket: every case, newest first, its public fields only. */
export function docketHtml(cases, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const rows = cases.map((c) => {
    const s = caseStatus(c, now);
    return `<li class="gac-docket__row" data-gac-docket="${escapeHtml(c.ref)}">
      <p class="gac-docket__head"><span class="gac-ref">${escapeHtml(c.ref)}</span> <span class="ui-badge ${s.tone}">${s.plain}</span> ${outcomeBadge(c.ruling)}</p>
      <p class="gac-docket__parties">${escapeHtml(claim(c.type).title)}: ${escapeHtml(c.claimant)} v. ${escapeHtml(c.respondent)}</p>
      <p class="gac-docket__meta">Filed ${isaTime(c.filedAt)}${c.amountClaimed > 0 ? ` · claimed ${cr(c.amountClaimed)}` : ""}${c.state === "enforcing" ? ` · ${cr(c.paid)} paid` : ""}</p>
    </li>`;
  }).join("");
  return `<section class="ui-panel station__panel gac-section" data-gac-docket-list aria-labelledby="gac-docket-title">
    <h3 id="gac-docket-title">The docket</h3>
    <p class="ui-panel__meta">Every case before the Council, newest first: reference, claim type, the parties and the ruling. The evidence stays with the parties.</p>
    ${rows ? `<ul class="gac-docket">${rows}</ul>` : `<p class="ui-panel__meta">The docket is empty.</p>`}
  </section>`;
}

/** The chambers: filing, the caller's cases and the docket, or the reading or error line. */
export function chambersHtml({ state, cases, docket, error }, ctx = {}) {
  if (error) return `<div class="ui-state ui-state--error" data-gac-chambers><p class="ui-state__title">The Council's registry could not be read.</p><p class="ui-state__why">${escapeHtml(error)}</p></div>`;
  if (!cases || !docket) return `<p class="ui-panel__meta" data-gac-chambers>Reading the registry…</p>`;
  return `<div class="gac-chambers" data-gac-chambers>
    ${filingHtml(state, ctx)}
    ${myCasesHtml(cases, ctx)}
    ${docketHtml(docket, ctx)}
  </div>`;
}
