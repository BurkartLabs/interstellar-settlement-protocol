// ISP-285 (AB#992; docs/design/rats.md): Rats on the Starmap. The Pirates overlay colours each system by its pirate
// activity as the server has it (GET .../rats/activity: an hour-long unescorted expedition's chance of meeting Rats, the
// launch screen's and the tick's formula), and rings a system with a belt a hunt has cleared. A belt's panel says its
// chance now and its quiet period, and offers a hunt: the fleets that can hunt it now, each with the battle the resolver
// expects, before anything is sent (GET .../belts/:beltKey/hunt). A hunt's result is the v0.10 battle report
// (raidView.js battleTablesHtml). Pure, so it loads in node: views/starmap.js fetches and binds, starmap.js draws.
// Every figure is the server's; nothing here computes a chance, a fight or a bounty.
import { escapeHtml } from "./html.js";
import { utcTime } from "./timeFormat.js";
import { unitsText } from "./fleetView.js";
import { battleTablesHtml } from "./raidView.js";

/** The overlay's id: the picker's existing Pirates entry, which now shows activity rather than the raw density. */
export const RATS_OVERLAY = "pirates";
/** The legend's bands: an hour's chance of meeting Rats, from the quietest system (Sirius, 13%) to the busiest (51%). */
export const RATS_BANDS = [0.15, 0.25, 0.35, 0.45];

const pct = (p) => `${Math.round((Number(p) || 0) * 100)}%`;
const cr = (v) => `${Math.round(Number(v) || 0).toLocaleString("en-US")} credits`;
const utc = (t) => utcTime(t, { withDate: true });

/** Which band a chance falls in, 0 (quietest) to RATS_BANDS.length (busiest). */
export function ratsBand(chance) {
  const c = Number(chance) || 0;
  let band = 0;
  for (const edge of RATS_BANDS) if (c >= edge) band += 1;
  return band;
}
/** A band's colour on the map: from a calm teal to an alarm red, in five steps the legend names. */
export function ratsColor(chance) {
  const f = ratsBand(chance) / RATS_BANDS.length;
  return `rgba(${Math.round(60 + f * 195)}, ${Math.round(200 - f * 150)}, ${Math.round(190 - f * 140)}, 0.92)`;
}
/** A system's reading, by id, from the server's activity. */
export const activityOf = (activity, systemId) => (activity?.systems || []).find((s) => s.id === systemId) || null;

/** The legend: what the colour means, its bands, and the ring round a system whose belt was hunted. */
export function ratsLegendHtml(activity) {
  if (!activity?.systems) return `<p class="starmap__subhead">Pirate activity</p><p class="ui-panel__meta" data-rats-legend-loading>Reading the Rats' activity from the ISA...</p>`;
  const edges = [0, ...RATS_BANDS];
  const swatches = edges.map((lo, i) => {
    const hi = RATS_BANDS[i];
    const label = hi === undefined ? `${pct(lo)} or more` : `${pct(lo)} to ${pct(hi)}`;
    return `<li><span class="starmap__band" style="background:${ratsColor(lo)}" aria-hidden="true"></span>${i === 0 ? "calm, " : i === edges.length - 1 ? "busiest, " : ""}${label}</li>`;
  }).join("");
  const quiet = activity.systems.filter((s) => s.quietBelts?.length).length;
  return `<p class="starmap__subhead">Pirate activity: the chance an hour-long probe with no escort meets Rats there</p>
    <ul class="starmap__bands" aria-label="Pirate activity, calm to busiest" data-rats-legend>${swatches}</ul>
    <p class="ui-panel__meta">A green ring marks a system with a belt a hunt cleared: its Rats come at ${pct(activity.quietRateFactor)} of the rate until they regrow. ${quiet ? `${quiet} system${quiet === 1 ? " is" : "s are"} quiet now.` : "None is quiet now."}</p>`;
}

/** A system panel's line: its activity, its Rat group, and any belt that is quiet. */
export function systemRatsHtml(reading, { catalog = [] } = {}) {
  if (!reading) return "";
  const quiet = (reading.quietBelts || []).map((q) => `<li data-rats-quiet="${escapeHtml(q.beltKey)}">A belt here is quiet until ${escapeHtml(utc(q.until))}: ${pct(q.chance)} an hour meanwhile.</li>`).join("");
  return `<div data-system-rats="${escapeHtml(reading.id)}">
    <p class="ui-panel__meta">Pirate activity: <strong>${pct(reading.chance)}</strong> an hour for a probe with no escort (density ${reading.density}). Each group: ${escapeHtml(unitsText(reading.group, catalog))}.</p>
    ${quiet ? `<ul class="ui-panel__meta">${quiet}</ul>` : ""}
  </div>`;
}

/** The belt panel's Rats section: its chance now, a quiet period, a hunt under way, and the button to plan one. */
export function beltRatsHtml({ beltKey, reading, quiet = null, hunting = [], catalog = [] }) {
  const chance = quiet ? reading?.quietBelts?.find((q) => q.beltKey === beltKey)?.chance : reading?.chance;
  const under = hunting.map((h) => `<li data-hunt-underway="${escapeHtml(h.fleetId)}">${escapeHtml(h.fleetName || h.fleetId)} is hunting here: back ${escapeHtml(utc(h.endsAt))}.</li>`).join("");
  return `<section class="ui-stack" data-belt-rats="${escapeHtml(beltKey)}">
    <h4 class="starmap__subhead">Rats in this belt</h4>
    ${reading ? `<p class="ui-panel__meta">An hour-long probe with no escort meets them <strong>${pct(chance)}</strong> of the time${reading.group ? `; each group is ${escapeHtml(unitsText(reading.group, catalog))}` : ""}.</p>` : `<p class="ui-panel__meta">Reading the Rats' activity from the ISA...</p>`}
    ${quiet ? `<p class="ui-panel__meta" data-belt-quiet>Quiet: a hunt cleared this belt. Its Rats regrow at ${escapeHtml(utc(quiet.until))}.</p>` : ""}
    ${under ? `<ul class="ui-panel__meta">${under}</ul>` : ""}
    ${quiet ? "" : `<div><button id="hunt-open-btn" class="ui-button ui-button--secondary" type="button">Hunt the Rats</button></div>`}
    <div id="hunt-panel" data-hunt-panel></div>
  </section>`;
}

const OUTCOME = { attacker: "Your fleet clears them", draw: "The fight breaks off: a draw", defender: "The Rats beat your fleet" };

/**
 * The hunt screen: the belt's group, and each fleet that can hunt it now with the resolver's expected battle, its
 * provisions and the net; one is chosen, then sent. `preview` is GET .../belts/:beltKey/hunt as the server answered.
 */
export function huntPanelHtml(preview, { catalog = [], chosen = null, systemName = "" } = {}) {
  if (!preview) return `<p class="ui-panel__meta">Asking the ISA who can hunt here...</p>`;
  const { belt, fleets = [], others = 0 } = preview;
  if (belt.quiet) return `<p class="ui-panel__meta">Nothing to hunt: this belt is quiet until ${escapeHtml(utc(belt.quiet.until))}.</p>`;
  if (!fleets.length) {
    return `<div class="ui-state" data-hunt-none><p class="ui-state__title">No fleet can hunt here now</p>
      <p class="ui-state__why">A hunting fleet must be stationed in ${escapeHtml(systemName || belt.systemId)} and free: not travelling, escorting, hunting or under contract.${others ? ` ${others} of your fleets ${others === 1 ? "is" : "are"} elsewhere or busy.` : " You have no fleet yet."}</p></div>`;
  }
  const pick = fleets.find((f) => f.fleetId === chosen) || fleets[0];
  const e = pick.expected;
  const options = fleets.map((f) => `<label class="raid-posture__option"><input type="radio" name="hunt-fleet" value="${escapeHtml(f.fleetId)}"${f.fleetId === pick.fleetId ? " checked" : ""}>
      <span><strong>${escapeHtml(f.name || f.fleetId)}</strong>: ${escapeHtml(unitsText(f.units, catalog))}. Expected: ${OUTCOME[f.expected.winner] || f.expected.winner}, net ${cr(f.expected.net)}.</span></label>`).join("");
  return `<form class="ui-stack" data-hunt-form>
    <fieldset class="raid-posture"><legend>Choose the fleet (${fleets.length} can hunt here now)</legend>${options}</fieldset>
    <article class="raid-report" data-hunt-expected aria-label="Expected battle">
      <h4 class="raid-report__title">Expected: ${OUTCOME[e.winner] || e.winner}</h4>
      <p>${escapeHtml(pick.name || pick.fleetId)} against the belt's Rats (${escapeHtml(unitsText(belt.group, catalog))}), as the ISA's resolver has it. The same fleet against the same group always ends this way.</p>
      <dl class="raid-terms">
        <div><dt>Provisions, paid now</dt><dd>${cr(pick.provisions)}</dd></div>
        <div><dt>Units expected lost</dt><dd>${cr(e.lostValue)} of ships and troops</dd></div>
        <div><dt>Bounty if it wins</dt><dd>${e.won ? cr(e.bounty) : "none"}</dd></div>
        <div><dt>Net</dt><dd><strong>${cr(e.net)}</strong></dd></div>
      </dl>
      <p class="ui-panel__meta">${e.won ? `A win also makes the belt quiet for a day, for everyone who mines it.` : `No bounty and no quiet period unless it wins.`}</p>
      ${battleTablesHtml(e.battle, { catalog, caption: "Expected forces and losses", attacker: "Your fleet", defender: "Rats" })}
    </article>
    <div><button id="hunt-send-btn" class="ui-button ui-button--primary" type="submit">Send ${escapeHtml(pick.name || "the fleet")} to hunt (${cr(pick.provisions)})</button></div>
  </form>`;
}

const RESULT = { attacker: "Hunt won", draw: "Hunt broke off: a draw", defender: "Hunt lost", "already-cleared": "Hunt found nothing" };

/** A hunt's report, in the v0.10 battle report's form: the outcome, the bounty and quiet period, the forces and rounds. */
export function huntReportHtml(report, { catalog = [], systemName = "" } = {}) {
  if (!report) return "";
  const where = systemName || report.systemId;
  const lead = report.outcome === "already-cleared"
    ? `Another corporation had cleared the Rats at ${escapeHtml(where)} first. The fleet came back without a fight; its provisions were spent.`
    : `The fleet fought the Rats at ${escapeHtml(where)}, ${escapeHtml(utc(report.resolvedAt))}.`;
  return `<article class="raid-report" data-hunt-report="${escapeHtml(report.id)}" aria-label="Hunt report">
    <h4 class="raid-report__title">${RESULT[report.outcome] || report.outcome}</h4>
    <p>${lead}</p>
    <dl class="raid-terms">
      <div><dt>Bounty</dt><dd>${report.bounty ? cr(report.bounty) : "none"}</dd></div>
      <div><dt>Units lost</dt><dd>${cr(report.lostValue)}</dd></div>
      <div><dt>Provisions</dt><dd>${cr(report.provisions)}</dd></div>
    </dl>
    ${report.quietUntil ? `<p>The belt is quiet until ${escapeHtml(utc(report.quietUntil))}: its Rats come at a quarter of the rate, for everyone.</p>` : ""}
    ${report.battle ? battleTablesHtml(report.battle, { catalog, caption: "Forces and losses", attacker: "Your fleet", defender: "Rats" }) : ""}
  </article>`;
}
