// public/scripts/operations.js: the Operations view (AB#2471; Board review item 30, "one view where we can see ALL of
// our mining operations, our research, travel, probes, attacks"; docs/design/p010-scroll-audit.md, "What Operations
// would hold"). Pure: every thing in progress, one row each, from the account state the page already has, with what it
// is, when it ends and the tab it is run from. The detail of each stays on its own tab; this is the one place that
// lists them all.
import { escapeHtml } from "./html.js";
import { deadline } from "./timeFormat.js";

const H = 3_600_000;
export const KINDS = Object.freeze({
  mining: { label: "Mining", tab: "operations", sub: "mining" },
  expedition: { label: "Expedition", tab: "starmap" },
  probe: { label: "Probe", tab: "starmap" },
  refining: { label: "Refining", tab: "refinery" },
  research: { label: "Research", tab: "rnd" },
  program: { label: "CEO program", tab: "ceo" },
  shipment: { label: "Shipment", tab: "logistics" },
  travel: { label: "Travel", tab: "travel" },
  training: { label: "Training", tab: "fleet" },
  shipyard: { label: "Shipyard", tab: "fleet" },
  raid: { label: "Raid", tab: "fleet" }
});
const num = (v) => Number(v) || 0;
const future = (t, now) => num(t) > now;

/**
 * Everything the corporation has in progress at `now`, soonest first: [{ kind, what, endsAt, startsAt? }]. `data` is the
 * account state (corp, queues); `ctx` names things: techName(id), programName(id), chainName(id), systemName(id),
 * stationName(id), unitName(id). A thing already due, or queued and not started, is shown with its start.
 */
export function operationsRows(data, now = Date.now(), ctx = {}) {
  const corp = data?.corp || {};
  const rows = [];
  const push = (kind, what, endsAt, startsAt = null) => rows.push({ kind, what, endsAt: num(endsAt), ...(startsAt && startsAt > now ? { startsAt } : {}) });
  for (const x of corp.mining?.silicateExtractors || []) {
    if (x?.active !== false && future(x?.endsAt, now)) push("mining", `${x.name || "Extractor Yard"} cycle`, x.endsAt);
  }
  const am = corp.asteroidMining || {};
  for (const e of am.activeExpeditions || []) {
    const [systemId] = String(e.beltKey || "").split(":");
    if (future(e.completesAt, now)) push("expedition", `${e.resource ? `${e.resource} expedition` : "Expedition"} in ${ctx.systemName?.(systemId) || systemId || "a belt"}`, e.completesAt);
  }
  for (const p of am.fabricationQueue || []) if (future(p.completesAt, now)) push("probe", "Survey probe fabrication", p.completesAt);
  for (const r of [...(corp.refineries || []), ...(corp.synthesisArrays || [])]) {
    if (r?.active && future(r.endsAt, now)) push("refining", `${r.name || "Refinery"}: ${ctx.chainName?.(r.chainId) || r.chainId || "a run"}`, r.endsAt);
  }
  for (const q of data?.queues?.corporateRnD || []) {
    const start = num(q.startedAt);
    const end = start ? start + num(q.durationHours) * H : 0;
    if (start && end > now) push("research", ctx.techName?.(q.techId) || q.name || q.techId || "Research", end, start);
  }
  for (const q of data?.queues?.ceoInsight || []) {
    const start = num(q.startedAt);
    const end = start ? start + num(q.durationHours) * H : num(q.endsAt);
    if (end > now) push("program", ctx.programName?.(q.programId || q.id) || q.name || q.title || "CEO program", end, start);
  }
  for (const s of corp.shipments || []) {
    if (s?.status === "in-transit" && future(s.arrivesAt, now)) push("shipment", `Shipment to ${ctx.stationName?.(s.toStationId) || s.toStationId}`, s.arrivesAt);
  }
  if (corp.travel && future(corp.travel.arrivesAt, now)) push("travel", `Travel to ${ctx.systemName?.(corp.travel.toSystemId) || corp.travel.toSystemId}`, corp.travel.arrivesAt);
  for (const j of corp.training?.queue || []) if (future(j.completesAt, now)) push("training", `${num(j.quantity)} × ${ctx.unitName?.(j.unitId) || j.unitId}`, j.completesAt, j.startsAt);
  for (const j of corp.shipyard?.queue || []) if (future(j.completesAt, now)) push("shipyard", `${num(j.quantity)} × ${ctx.unitName?.(j.unitId) || j.unitId}`, j.completesAt, j.startsAt);
  for (const f of corp.military?.fleets || []) {
    if (f?.transit?.raidId && future(f.transit.arrivesAt, now)) push("raid", `${f.name || "A fleet"} raiding ${ctx.stationName?.(f.transit.toStationId) || f.transit.toStationId}`, f.transit.arrivesAt);
  }
  return rows.sort((a, b) => a.endsAt - b.endsAt);
}

/** The rows as the Operations list, or why it is empty. Each row links to the tab the thing is run from. */
export function operationsHtml(rows, now = Date.now()) {
  if (!rows.length) {
    return `<div class="ui-state"><p class="ui-state__title">Nothing in progress.</p><p class="ui-state__why">Mining cycles, expeditions, refinery runs, research, CEO programs, shipments, travel, training and raids appear here while they run.</p></div>`;
  }
  return `<ul class="ops-list">${rows.map((r) => {
    const k = KINDS[r.kind];
    return `<li class="ops-row" data-op-kind="${r.kind}">
      <span class="ui-badge ops-row__kind">${k.label}</span>
      <span class="ops-row__what">${escapeHtml(r.what)}</span>
      <span class="ops-row__when">${r.startsAt ? `starts ${deadline(r.startsAt, now)}, ` : ""}ends ${deadline(r.endsAt, now)}</span>
      <button type="button" class="ui-button ui-button--secondary ops-row__go" data-op-tab="${k.tab}"${k.sub ? ` data-op-sub="${k.sub}"` : ""}>Open</button>
    </li>`;
  }).join("")}</ul>`;
}

/** A one-line count by kind, for the view's lede: "3 in progress: 2 Mining, 1 Research". */
export function operationsSummary(rows) {
  if (!rows.length) return "Nothing in progress.";
  const by = {};
  for (const r of rows) by[r.kind] = (by[r.kind] || 0) + 1;
  return `${rows.length} in progress: ${Object.entries(by).map(([k, n]) => `${n} ${KINDS[k].label}`).join(", ")}. Soonest to finish first.`;
}

