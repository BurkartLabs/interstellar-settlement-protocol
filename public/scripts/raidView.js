// ISP-181 (AB#875): the raid screens' markup: the incoming-raid alert, the garrison panel, the target picker, the
// caller's raids, and the private battle report. Text first: every figure is a word or a number in a table or a
// sentence, readable with graphics off. Pure, so it loads in node; public/scripts/views/raids.js fetches, binds and
// draws it. Every rule is the server's (server/raids.js, raidResolution.js, garrison.js); this only shows what it said.
import { escapeHtml } from "./html.js";
import { durationText } from "./shipyardPanel.js";
import { unitsText } from "./fleetView.js";

export const POSTURES = [
  { id: "balanced", label: "Balanced", note: "the default" },
  { id: "fortified", label: "Fortified", note: "harder to hit, hits back 20% less: keeps more of your units" },
  { id: "aggressive", label: "Aggressive", note: "hits 20% harder, easier to hit: costs a raider more, at more risk" }
]; // server/garrison.js's POSTURES
const utc = (ms) => new Date(ms).toISOString().slice(11, 16) + " UTC";
const day = (ms) => new Date(ms).toUTCString().slice(5, 11);
const cr = (n) => `${Math.round(n).toLocaleString("en-US")} credits`;
const n = (x) => Math.max(0, Math.floor(Number(x) || 0));
const UNIT_IDS = ["lf", "ds", "se", "at", "dt"];

/** How long until `t`, in words: "3 h 12 min", or "arriving". */
export const countdown = (t, now) => (t - now > 0 ? durationText(t - now) : "arriving");

/** The incoming-raid alert: every raid on the caller still inbound, with attacker, station, units and a countdown. */
export function incomingAlertHtml(incoming, { now = Date.now(), stationName, catalog = [], compact = false } = {}) {
  if (!incoming?.length) return "";
  return `<section class="raid-alert" role="alert" aria-label="Incoming raids">
    <h3 class="raid-alert__title">${incoming.length === 1 ? "A raid is on its way" : `${incoming.length} raids are on their way`}</h3>
    <ul class="raid-alert__list">${incoming.map((r) => `
      <li class="raid-alert__item" data-incoming-raid="${escapeHtml(r.id)}">
        <p><strong>${escapeHtml(r.attackerName ?? "A corporation")}</strong> is raiding your holdings at <strong>${escapeHtml(stationName(r.targetStationId))}</strong>.
          It arrives in <strong data-raid-countdown="${r.arrivesAt}">${countdown(r.arrivesAt, now)}</strong> (${utc(r.arrivesAt)}).</p>
        ${compact ? "" : `<p class="station__note">Coming: ${escapeHtml(unitsText(r.units, catalog))}. Whatever stands there when it arrives defends automatically.</p>`}
        <button type="button" class="ui-button ui-button--primary" data-raid-defend="${escapeHtml(r.targetStationId)}">Defend ${escapeHtml(stationName(r.targetStationId))}</button>
      </li>`).join("")}</ul>
  </section>`;
}

/**
 * The garrison at each station the caller holds or defends: defense troops standing there and on their way, the
 * posture, and a form to send troops from another garrison. `stations` are ids; the first incoming raid's station
 * leads.
 */
export function garrisonPanelHtml(corp, stations, { stationName, now = Date.now(), incoming = [] } = {}) {
  const garrisons = corp?.military?.garrisons || {};
  const postures = corp?.garrisonPostures || {};
  const moves = corp?.garrisonMoves || [];
  const sources = Object.entries(garrisons).filter(([, q]) => n(q) > 0);
  if (!stations.length) return `<p class="station__note">You hold nothing at any station yet: there is nothing to defend.</p>`;
  return stations.map((id) => {
    const posture = postures[id] || "balanced";
    const onWay = moves.filter((m) => m.toStationId === id);
    const threat = incoming.find((r) => r.targetStationId === id);
    const from = sources.filter(([s]) => s !== id);
    return `<article class="ui-card raid-garrison${threat ? " raid-garrison--threat" : ""}" id="garrison-${escapeHtml(id)}" data-garrison="${escapeHtml(id)}">
      <h4 class="ui-card__title">${escapeHtml(stationName(id))}</h4>
      <dl class="raid-terms">
        <div><dt>Defense troops</dt><dd>${n(garrisons[id])}${onWay.length ? `, and ${onWay.reduce((a, m) => a + n(m.quantity), 0)} on the way (${onWay.map((m) => utc(m.arrivesAt)).join(", ")})` : ""}</dd></div>
        ${threat ? `<div><dt>Raid arrives</dt><dd data-raid-countdown="${threat.arrivesAt}">${countdown(threat.arrivesAt, now)}</dd></div>` : ""}
      </dl>
      <fieldset class="raid-posture">
        <legend>Posture</legend>
        ${POSTURES.map((p) => `<label class="raid-posture__option"><input type="radio" name="posture-${escapeHtml(id)}" value="${p.id}"${p.id === posture ? " checked" : ""}> <strong>${p.label}</strong> <span class="station__note">${p.note}</span></label>`).join("")}
        <button type="button" class="ui-button ui-button--secondary" data-set-posture="${escapeHtml(id)}">Set posture</button>
      </fieldset>
      ${from.length ? `<form class="raid-reinforce" data-reinforce="${escapeHtml(id)}">
        <label class="ui-field">Send troops from <select class="ui-select" name="from">${from.map(([s, q]) => `<option value="${escapeHtml(s)}">${escapeHtml(stationName(s))} (${n(q)})</option>`).join("")}</select></label>
        <label class="ui-field">Troops <input class="ui-input" name="quantity" type="number" min="1" step="1" value="1"></label>
        <button type="submit" class="ui-button ui-button--secondary">Send</button>
      </form>` : `<p class="station__note">Train Defense Troops at Headquarters, or send a fleet here, to reinforce it.</p>`}
      <p class="station__note" role="status"></p>
    </article>`;
  }).join("");
}

/** The target picker: your fleets that can go, a station, and who there may be raided and why not. */
export function targetPickerHtml({ fleets = [], stationId = "", stations = [], list = null, stationName, catalog = [] }) {
  const ready = fleets.filter((f) => f.stationId && !f.transit && !f.contract);
  if (!ready.length) return `<p class="station__note">Form a fleet with Attack Troops or ships to raid with. A fleet must be at a station, not travelling or offered for hire.</p>`;
  const you = (list?.you || []).map((y) => `<p class="raid-picker__you">${escapeHtml(y.text)}</p>`).join("");
  const rows = (list?.targets || []).map((t) => `
      <li class="raid-target${t.eligible ? "" : " raid-target--closed"}" data-target="${escapeHtml(t.corpId)}">
        <span class="raid-target__name">${escapeHtml(t.name)}</span>
        ${t.eligible ? `<button type="button" class="ui-button ui-button--primary" data-raid-target="${escapeHtml(t.corpId)}">Raid</button>`
          : `<span class="raid-target__why">${t.reasons.map((r) => escapeHtml(r.text) + (r.kind !== "protected" && r.until ? ` (${day(r.until)}, ${utc(r.until)})` : "")).join(" ")}</span>`}
      </li>`).join("");
  return `<form class="raid-picker" data-raid-picker>
      <label class="ui-field">Fleet <select class="ui-select" name="fleetId">${ready.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}: ${escapeHtml(unitsText(f.units, catalog))}, at ${escapeHtml(stationName(f.stationId))}</option>`).join("")}</select></label>
      <label class="ui-field">Station <select class="ui-select" name="stationId">${stations.map((s) => `<option value="${escapeHtml(s)}"${s === stationId ? " selected" : ""}>${escapeHtml(stationName(s))}</option>`).join("")}</select></label>
    </form>
    ${you}
    ${list ? (list.targets.length ? `<ul class="raid-targets">${rows}</ul>` : `<p class="station__note">Nobody else holds anything at ${escapeHtml(stationName(stationId))}.</p>`) : `<p class="station__note">Reading who holds anything there…</p>`}
    <p class="station__note">A raid arrives at least 4 hours after you declare it, and the defender is told what is coming. Loot is only goods, never credits.</p>`;
}

/** The caller's own raids: inbound with a countdown and Recall, returning, and done with a link to the report. */
export function outgoingRaidsHtml(outgoing, { now = Date.now(), stationName, reports = [] } = {}) {
  if (!outgoing?.length) return `<p class="station__note">You have not raided anyone.</p>`;
  const reported = new Set(reports.map((r) => r.raidId));
  return `<ul class="raid-list">${[...outgoing].sort((a, b) => b.declaredAt - a.declaredAt).slice(0, 10).map((r) => {
    const state = r.state === "inbound" ? `arrives in <span data-raid-countdown="${r.arrivesAt}">${countdown(r.arrivesAt, now)}</span>`
      : r.state === "resolved" ? `fought; the fleet is on its way home (${utc(r.returnsAt)})`
      : r.state === "recalled" ? "called off" : "done";
    return `<li class="raid-list__item">
      <span>${escapeHtml(r.targetName ?? "A corporation")} at ${escapeHtml(stationName(r.targetStationId))}: ${state}</span>
      ${r.state === "inbound" && r.arrivesAt > now ? `<button type="button" class="ui-button ui-button--secondary" data-raid-recall="${escapeHtml(r.id)}">Recall</button>` : ""}
      ${reported.has(r.id) ? `<button type="button" class="ui-button ui-button--secondary" data-raid-report="${escapeHtml(r.id)}">Report</button>` : ""}
    </li>`;
  }).join("")}</ul>`;
}

const WINNER = { attacker: "The raid succeeded", defender: "The raid was beaten off", draw: "The raid failed: a draw" };
/** The resolver's counts are expected values; a report shows them to the nearest whole unit. */
const whole = (x) => Math.round(Number(x) || 0);

/** The battle report, text first: who, where, the outcome, each side's forces, losses, the rounds, loot and damage. */
export function battleReportHtml(report, { catalog = [] } = {}) {
  if (!report) return "";
  const names = Object.fromEntries((catalog || []).map((u) => [u.id, u.name]));
  const fought = UNIT_IDS.filter((id) => n(report.attacker.before?.[id]) + n(report.defender.before?.[id]) > 0);
  const mine = report.side === "attacker" ? "attacker" : "defender";
  const left = (o) => fought.filter((id) => whole(o[id]) > 0).map((id) => `${whole(o[id])} ${escapeHtml(names[id] || id)}`).join(", ") || "none";
  const lootRows = Object.entries(report.loot || {});
  const damage = report.buildingsDamaged || [];
  return `<article class="raid-report" data-raid-report-view="${escapeHtml(report.raidId)}" aria-label="Battle report">
    <h4 class="raid-report__title">${WINNER[report.winner] || report.winner}</h4>
    <p>${escapeHtml(report.attacker.name ?? "A corporation")} raided ${escapeHtml(report.defender.name ?? "a corporation")} at ${escapeHtml(report.station)}, ${new Date(report.at).toUTCString().slice(5, 22)} UTC. The defense stood ${escapeHtml(report.posture || "balanced")}.</p>
    <table class="raid-table"><caption>Forces and losses (you were the ${mine})</caption>
      <thead><tr><th scope="col">Unit</th><th scope="col">Attacker</th><th scope="col">Lost</th><th scope="col">Defender</th><th scope="col">Lost</th></tr></thead>
      <tbody>${fought.map((id) => `<tr><th scope="row">${escapeHtml(names[id] || id)}</th><td>${n(report.attacker.before?.[id])}</td><td>${n(report.attacker.lost?.[id])}</td><td>${n(report.defender.before?.[id])}</td><td>${n(report.defender.lost?.[id])}</td></tr>`).join("")}</tbody>
    </table>
    <details class="raid-rounds"><summary>The ${report.rounds.length} round${report.rounds.length === 1 ? "" : "s"}, and what was left after each (to the nearest unit)</summary>
      <table class="raid-table"><thead><tr><th scope="col">Round</th><th scope="col">Attacker left</th><th scope="col">Defender left</th></tr></thead><tbody>
      ${report.rounds.map((r) => `<tr><td>${r.round}</td><td>${left(r.attacker.remaining)}</td><td>${left(r.defender.remaining)}</td></tr>`).join("")}
      </tbody></table>
    </details>
    <h5>Goods ${mine === "attacker" ? "taken" : "lost"}</h5>
    ${lootRows.length ? `<ul>${lootRows.map(([item, q]) => `<li>${n(q).toLocaleString("en-US")} ${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>None. Credits are never taken.</p>"}
    <h5>Buildings</h5>
    ${damage.length ? `<ul>${damage.map((b) => mine === "defender"
      ? `<li>${escapeHtml(b.name)}: condition ${b.before} to ${b.after}; repair ${cr(b.repairCost ?? 0)} (repairs open with ISP-287)</li>`
      : `<li>${escapeHtml(b.name)}: ${b.points} condition points</li>`).join("")}</ul>` : "<p>No building was damaged.</p>"}
  </article>`;
}
