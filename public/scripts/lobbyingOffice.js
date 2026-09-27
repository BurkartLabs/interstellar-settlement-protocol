// public/scripts/lobbyingOffice.js: the lobbying office at the Earth Assembly and at the Interplanetary Trade Commission
// (ISP-240, AB#935; docs/design/WARFARE.md, "Lobbying"). Pure: HTML from the caller's office (GET
// /api/accounts/:id/lobbying) and the form's state, so tests read it without a page.
//
// Each faction's building shows the caller's standing with it, the parameters that faction's campaigns move, with their
// base and in-force values in the chosen system, a form to open a campaign whose preview is the server's own outcome
// for that spend (public/scripts/lobbying.js), and the faction's register, grouped by parameter so the campaigns on one
// rule are read together, each with the pledgers on both sides. Amounts are shown only for the caller's own pledges.
import { escapeHtml, refHtml } from "./html.js";
import { preview } from "./lobbying.js";
import { utcMinute } from "./tariffs.js";
import { codeSlotHtml } from "./sectionCodes.js"; // ISP-250 (AB#946): the drawn sections' document codes

export const FACTIONS = Object.freeze({
  "earth-assembly": { name: "Earth Assembly", building: "earth-assembly" },
  "interplanetary-trade-commission": { name: "Interplanetary Trade Commission", building: "interplanetary-trade-commission" }
});
export const PARAMETER_LABELS = Object.freeze({
  tariffCapPct: { name: "Tariff cap", unit: "%", what: "the most a concession holder may charge on sales and goods shipped in" },
  salesTaxPct: { name: "Exchange sales tax", unit: "%", what: "the GEX tax on sales settled at the system's stations" },
  dumpingPriceThresholdPct: { name: "ITC price line", unit: "% of normal value", what: "sales below it count toward a dumping investigation" },
  dumpingVolumeThresholdPct: { name: "ITC volume line", unit: "% of normal volume", what: "how much must be sold below the price line before the ITC acts" }
});
const n = (v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const pct = (v, p) => `${n(v)}${PARAMETER_LABELS[p]?.unit || ""}`;

/** The faction's parameters, in catalog order. */
export function factionParameters(office, faction) {
  return Object.entries(office?.parameters || {}).filter(([, spec]) => spec.faction === faction).map(([id]) => id);
}

/** The form's preview: what the spend would do with nobody opposing it, or why it cannot be read. */
export function previewText(office, form) {
  const spec = office?.parameters?.[form.parameter];
  const system = office?.systems?.find((s) => s.id === form.systemId);
  const value = system?.values?.[form.parameter];
  if (!spec || !value) return "Choose a parameter and a system.";
  if (!value.lobbyable) return `${PARAMETER_LABELS[form.parameter].name} cannot be lobbied in ${system.name}.`;
  const p = preview(value.base, form.direction, Number(form.credits) || 0, Number(form.standing) || 0, spec, office.terms.creditsPerStandingPoint);
  if (!p) return "This campaign's curve cannot be evaluated.";
  if (!(p.I > 0)) return `Enter the credits or standing you would pledge to see what it would move. A campaign moves the ${PARAMETER_LABELS[form.parameter].name.toLowerCase()} by at most ${n(spec.maxShift)}, in steps of ${n(spec.step)}.`;
  const moved = p.to !== value.base;
  return `With nobody opposing it, ${n(p.I)} of influence pulls ${n(p.pull)} of the ${n(spec.maxShift)} a campaign can move. ` +
    (moved
      ? `The ${PARAMETER_LABELS[form.parameter].name.toLowerCase()} would go from ${pct(value.base, form.parameter)} to ${pct(p.to, form.parameter)} for ${office.terms.durationDays} days.`
      : `That is under one step of ${n(spec.step)}, so it would not move.`) +
    ` Doubling the spend never doubles the pull.`;
}

function standingHtml(office, faction) {
  const s = office.standing?.[faction] ?? 0;
  const t = office.terms;
  return `<section class="ui-panel station__panel lobby-section" data-lobby-standing aria-labelledby="lobby-standing-title">
    <h3 id="lobby-standing-title">${codeSlotHtml(`${faction}-standing`)}Your standing</h3>
    <p class="lobby-standing"><strong data-role="lobby-standing-value">${n(s)}</strong> of ${n(office.standingMax)}</p>
    <p class="ui-panel__meta">It decays by 2% of its value each day. Opening a campaign needs ${n(t.openStandingMin)} and spends ${n(t.openStandingCost)}; pledging needs ${n(t.pledgeStandingMin)}. A standing point pledged is worth ${n(t.creditsPerStandingPoint)} credits of influence.</p>
  </section>`;
}

function valuesHtml(office, faction, systemId) {
  const system = office.systems.find((s) => s.id === systemId);
  const options = office.systems.map((s) => `<option value="${escapeHtml(s.id)}"${s.id === systemId ? " selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
  const rows = factionParameters(office, faction).map((p) => {
    const v = system?.values?.[p];
    if (!v) return "";
    const status = !v.lobbyable ? "Not lobbyable here"
      : v.campaign ? `Campaign ${v.campaign.state === "in-force" ? "in force" : "taking pledges"} (${v.campaign.direction})`
      : v.cooldownUntil ? `Next campaign from ${utcMinute(v.cooldownUntil)}` : "Open to a campaign";
    return `<tr data-lobby-value="${escapeHtml(p)}"><td data-label="Rule"><strong>${escapeHtml(PARAMETER_LABELS[p].name)}</strong></td>
      <td data-label="Base">${escapeHtml(pct(v.base, p))}</td><td data-label="In force"${v.inForce !== v.base ? ' class="lobby-moved"' : ""}>${escapeHtml(pct(v.inForce, p))}</td><td data-label="Status">${escapeHtml(status)}</td></tr>`;
  }).join("");
  return `<section class="ui-panel station__panel lobby-section" data-lobby-values aria-labelledby="lobby-values-title">
    <h3 id="lobby-values-title">${codeSlotHtml(`${faction}-rules`)}The rules in a system</h3>
    <label class="ui-field"><span class="ui-field__label">System</span><select class="ui-select" data-role="lobby-system">${options}</select></label>
    <div class="ui-table-wrap"><table class="ui-table lobby-values"><thead><tr><th>Rule</th><th>Base</th><th>In force</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    <dl class="lobby-glossary">${factionParameters(office, faction).map((p) => `<dt>${escapeHtml(PARAMETER_LABELS[p].name)}</dt><dd>${escapeHtml(PARAMETER_LABELS[p].what)}</dd>`).join("")}</dl>
  </section>`;
}

function openFormHtml(office, faction, form) {
  const params = factionParameters(office, faction);
  const s = office.standing?.[faction] ?? 0;
  const can = s >= office.terms.openStandingMin;
  const opt = (v, label, sel) => `<option value="${escapeHtml(v)}"${v === sel ? " selected" : ""}>${escapeHtml(label)}</option>`;
  return `<section class="ui-panel station__panel lobby-section" data-lobby-open aria-labelledby="lobby-open-title">
    <h3 id="lobby-open-title">${codeSlotHtml(`${faction}-open`)}Open a campaign</h3>
    ${can ? "" : `<p class="station__blocked">Opening a campaign needs ${n(office.terms.openStandingMin)} standing with the ${escapeHtml(FACTIONS[faction].name)}; you have ${n(s)}.</p>`}
    <form class="lobby-form" data-form="lobby-open">
      <label class="ui-field"><span class="ui-field__label">Rule</span><select class="ui-select" name="parameter">${params.map((p) => opt(p, PARAMETER_LABELS[p].name, form.parameter)).join("")}</select></label>
      <label class="ui-field"><span class="ui-field__label">System</span><select class="ui-select" name="systemId">${office.systems.map((x) => opt(x.id, x.name, form.systemId)).join("")}</select></label>
      <label class="ui-field"><span class="ui-field__label">Direction</span><select class="ui-select" name="direction">${opt("raise", "Raise it", form.direction)}${opt("lower", "Lower it", form.direction)}</select></label>
      <label class="ui-field"><span class="ui-field__label">Credits to pledge</span><input class="ui-input" type="number" name="credits" min="0" step="1" value="${escapeHtml(String(form.credits ?? 0))}" /></label>
      <label class="ui-field"><span class="ui-field__label">Standing to pledge</span><input class="ui-input" type="number" name="standing" min="0" step="0.01" max="${escapeHtml(String(s))}" value="${escapeHtml(String(form.standing ?? 0))}" /></label>
      <p class="lobby-preview" data-role="lobby-preview" role="status" aria-live="polite">${escapeHtml(previewText(office, form))}</p>
      <button type="submit" class="ui-button ui-button--primary"${can ? "" : " disabled"}>Open campaign</button>
      <p class="ui-panel__meta">Pledges are final and paid to the faction, win or lose. Pledging stays open ${n(office.terms.pledgeHours)} hours, to anyone with standing, on either side.</p>
      <p class="lobby-status" data-role="lobby-status" role="status" aria-live="polite"></p>
    </form>
  </section>`;
}

function campaignHtml(c, office) {
  const side = (s) => c.pledgers.filter((p) => p.side === s).map((p) => escapeHtml(p.name));
  const own = c.own?.length ? `<p class="ui-panel__meta">Your pledges: ${c.own.map((p) => `${p.side}, ${[p.credits ? `${n(p.credits)} credits` : "", p.standing ? `${n(p.standing)} standing` : ""].filter(Boolean).join(" and ")}`).map(escapeHtml).join("; ")}</p>` : "";
  const when = c.state === "pledging" ? `Pledges close ${utcMinute(c.closesAt)}` : c.result ? (c.result.to !== c.result.from ? `${pct(c.result.from, c.parameter)} → ${pct(c.result.to, c.parameter)} until ${utcMinute(c.result.endsAt)}` : "It moved nothing") : "Closing";
  const pledgeForm = c.state === "pledging"
    ? `<form class="lobby-pledge" data-form="lobby-pledge" data-campaign-id="${escapeHtml(c.id)}">
        <label class="ui-field"><span class="ui-field__label">Side</span><select class="ui-select" name="side">${["for", "against"].map((x) => `<option value="${x}">${x === "for" ? "For it" : "Against it"}</option>`).join("")}</select></label>
        <label class="ui-field"><span class="ui-field__label">Credits</span><input class="ui-input" type="number" name="credits" min="0" step="1" value="0" /></label>
        <label class="ui-field"><span class="ui-field__label">Standing</span><input class="ui-input" type="number" name="standing" min="0" step="0.01" value="0" /></label>
        <button type="submit" class="ui-button ui-button--secondary">Pledge</button>
      </form>`
    : "";
  return `<li class="lobby-campaign" data-lobby-campaign="${escapeHtml(c.id)}">
    <p class="lobby-campaign__title"><strong>${escapeHtml(c.systemName)}</strong>: ${c.direction === "raise" ? "raise" : "lower"} it <span class="ui-badge">${escapeHtml(c.state === "in-force" ? "in force" : c.state)}</span> ${refHtml(c.ref)}</p>
    <p class="ui-panel__meta">Opened by ${escapeHtml(c.openedBy)}${c.openedByYou ? " (you)" : ""}. ${escapeHtml(when)}.</p>
    <div class="lobby-sides"><p><span class="lobby-side lobby-side--for">For</span> ${side("for").join(", ") || "nobody yet"}</p><p><span class="lobby-side lobby-side--against">Against</span> ${side("against").join(", ") || "nobody yet"}</p></div>
    ${own}${pledgeForm}
  </li>`;
}

function registerHtml(office, faction) {
  const params = factionParameters(office, faction);
  const groups = params.map((p) => {
    const list = office.campaigns.filter((c) => c.parameter === p);
    return list.length ? `<h4 class="lobby-group" data-lobby-group="${escapeHtml(p)}">${escapeHtml(PARAMETER_LABELS[p].name)}</h4><ul class="lobby-list">${list.map((c) => campaignHtml(c, office)).join("")}</ul>` : "";
  }).join("");
  return `<section class="ui-panel station__panel lobby-section" data-lobby-register aria-labelledby="lobby-register-title">
    <h3 id="lobby-register-title">${codeSlotHtml(`${faction}-register`)}The register</h3>
    <p class="ui-panel__meta">Every campaign is registered: who opened it, who pledged and on which side. The amounts are not published.</p>
    ${groups || `<p class="ui-panel__meta">No campaigns are running at the ${escapeHtml(FACTIONS[faction].name)}.</p>`}
  </section>`;
}

/** The whole office for `faction`: standing, the rules in the chosen system, the form, the register. */
export function lobbyingOfficeHtml({ office, error, faction, form }) {
  if (error) return `<p class="station__blocked" data-role="lobby-error">${escapeHtml(error)}</p>`;
  if (!office) return `<p class="ui-panel__meta">Reading the register…</p>`;
  return standingHtml(office, faction) + valuesHtml(office, faction, form.systemId) + openFormHtml(office, faction, form) + registerHtml(office, faction);
}
