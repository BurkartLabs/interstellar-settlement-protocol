// AB#821 (docs/design/rats.md, section 7): the belt panel's escort picker and its Rats figures. Every number here is
// the server's (GET /expedition-outlook, worked by server/game/rats.js's launchOutlook from the functions the tick
// uses); this module only words and formats them, so the chance shown is the chance the expedition runs at.
import { toCurrency } from "./helpers.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** A chance or a share as the panel shows it: a whole percent, "under 1%" rather than a false 0%, "over 99%" rather than a false 100%. */
export function outlookPct(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return "—";
  if (x > 0 && x < 0.005) return "under 1%";
  if (x < 1 && x > 0.995) return "over 99%";
  return `${Math.round(x * 100)}%`;
}

/** The select's value for an escort option: "own:<fleetId>" or "hired:<contractId>"; "" is no escort. */
export const escortValue = (option) => `${option.kind}:${option.id}`;

/** The escort the select names, from the outlook, or null (none chosen, or one no longer offered). */
export function chosenEscort(outlook, value) {
  if (!value || !outlook?.escorts) return null;
  return outlook.escorts.find((o) => o.eligible && escortValue(o) === value) || null;
}

/** What launch-expedition is sent for a choice: { escortFleetId } for an own fleet, { escortContractId } for a hired one. */
export function escortLaunchFields(value) {
  const [kind, ...rest] = String(value || "").split(":");
  const id = rest.join(":");
  if (!id) return {};
  if (kind === "own") return { escortFleetId: id };
  if (kind === "hired") return { escortContractId: id };
  return {};
}

/** The escort picker: no escort, the fleets that can escort, and the ones that cannot, disabled, each with its reason. */
export function escortPickerHtml(outlook, value) {
  const escorts = outlook?.escorts || [];
  const able = escorts.filter((o) => o.eligible);
  const unable = escorts.filter((o) => !o.eligible);
  const label = (o) => `${o.name}${o.kind === "hired" ? " (hired)" : ""}`;
  const options = [`<option value="">No escort</option>`]
    .concat(able.map((o) => `<option value="${esc(escortValue(o))}"${escortValue(o) === value ? " selected" : ""}>${esc(label(o))}</option>`))
    .concat(unable.map((o) => `<option value="${esc(escortValue(o))}" disabled>${esc(label(o))} (cannot escort)</option>`));
  const why = unable.length
    ? `<div data-role="escort-unable">${unable.map((o) => `<p class="ui-panel__meta"><strong>${esc(label(o))}</strong> cannot escort: ${esc(o.why)}</p>`).join("")}</div>`
    : "";
  const none = escorts.length ? "" : `<p class="ui-panel__meta" data-role="escort-none">You have no fleets to escort with. A fleet stationed in this system, or one you hire for pve or raids, can guard the probe.</p>`;
  return `<div class="ui-field">
      <label class="ui-field__label" for="expedition-escort">Escort</label>
      <select id="expedition-escort" class="ui-select"${able.length ? "" : " disabled"}>${options.join("")}</select>
    </div>${why}${none}`;
}

/**
 * The Rats figures for the chosen length and escort: the chance of meeting them without an escort and with this one,
 * the chance the escort holds, the share of the haul expected home, and the provisions the escort is paid.
 */
export function launchRiskHtml(outlook, value) {
  if (!outlook?.unescorted) return `<p class="ui-panel__meta" data-role="launch-risk-loading">Reading the Rats in this belt…</p>`;
  const pick = chosenEscort(outlook, value);
  const rows = [
    ["Chance of meeting Rats, unescorted", outlookPct(outlook.unescorted.chance), "chance-unescorted"]
  ];
  if (pick) {
    rows.push([`Chance of meeting Rats, with ${pick.name}`, outlookPct(pick.chance), "chance-escorted"]);
    rows.push(["Chance the escort holds", outlookPct(pick.holdChance), "hold-chance"]);
    rows.push(["Haul expected home, unescorted", outlookPct(outlook.unescorted.keptShare), "kept-share-unescorted"]);
    rows.push([`Haul expected home, with ${pick.name}`, outlookPct(pick.keptShare), "kept-share"]);
    rows.push(["Escort provisions", toCurrency(pick.provisions), "provisions"]);
  } else {
    rows.push(["Haul expected home, unescorted", outlookPct(outlook.unescorted.keptShare), "kept-share-unescorted"]);
  }
  const quiet = outlook.quiet ? `<p class="ui-panel__meta" data-role="launch-quiet">A hunt has cleared this belt: the Rats are quiet here for now, and the chances below count it.</p>` : "";
  return `${quiet}<dl class="ui-kv launch-risk" data-role="launch-risk">${rows.map(([k, v, role]) =>
    `<dt>${esc(k)}</dt><dd data-risk="${role}">${esc(v)}</dd>`).join("")}</dl>`;
}
