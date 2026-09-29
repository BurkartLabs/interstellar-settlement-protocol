// The Assets tab: what the corporation holds and where.
// AB#739 (ISP-53): everything here moved from app.js unchanged. ISP-79 (AB#768): drawn from the design system.
// AB#2486 (Board review 2026-09-26, item 35): both tabs are filtered to All or one station or planet, and sorted by type,
// location, status or details. Each tab is a list of rows first (inventoryRows, infrastructureRows), which the filter and
// the sort act on before any markup is drawn; the choice is remembered per viewer.

import { escapeHtml } from "../html.js";
import { appState, viewerStorage } from "../state.js";
import { leaseSlotsUsed } from "../leaseSlots.js"; // ISP-98 (AB#788)
import { getAllInventory } from "./shared.js";

// ─── Assets ──────────────────────────────────────────────────────────────────
import { numberMarkup } from "../numberChange.js"; // AB#745: marks a number that is acknowledged when it changes
import { refHtml } from "../html.js"; // ISP-249 (AB#945)

export const ASSETS_STORAGE_KEY = "isp.assetsView.v1";
export const ASSET_SORTS = [
  ["type", "Type"],
  ["location", "Location"],
  ["status", "Status"],
  ["details", "Details (largest first)"]
];

/** The viewer's filter and sort; anything unreadable is All, by type. */
export function readAssetsView(storage = viewerStorage()) {
  try {
    const saved = JSON.parse(storage?.getItem(ASSETS_STORAGE_KEY) || "{}");
    return {
      filter: typeof saved.filter === "string" ? saved.filter : "all",
      sort: ASSET_SORTS.some(([key]) => key === saved.sort) ? saved.sort : "type"
    };
  } catch {
    return { filter: "all", sort: "type" };
  }
}

function writeAssetsView(view, storage = viewerStorage()) {
  try {
    storage?.setItem(ASSETS_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // storage blocked or full: the choice lasts until the page reloads
  }
}

/** A row belongs to a filter of "all", "station:<id>" (held at that station) or "body:<name>" (on or at that planet or moon). */
export function rowMatches(row, filter) {
  if (!filter || filter === "all") return true;
  if (filter.startsWith("station:")) return row.stationId === filter.slice("station:".length);
  if (filter.startsWith("body:")) return row.body === filter.slice("body:".length);
  return true;
}

const byText = (a, b) => String(a || "").localeCompare(String(b || ""), "en", { sensitivity: "base" });

/** Rows in the chosen order: text keys A to Z, details largest first; ties by type, then location. */
export function sortRows(rows, sort) {
  const tie = (a, b) => byText(a.type, b.type) || byText(a.location, b.location);
  const compare = {
    type: (a, b) => tie(a, b) || b.amount - a.amount,
    location: (a, b) => byText(a.location, b.location) || byText(a.type, b.type),
    status: (a, b) => byText(a.status, b.status) || tie(a, b),
    details: (a, b) => b.amount - a.amount || tie(a, b)
  }[sort] || ((a, b) => tie(a, b));
  return [...rows].sort(compare);
}

/** The places the filter offers: the stations and the planets and moons any row is at, each once, by name. */
export function filterOptions(rows, stationRegistry) {
  const stations = new Map();
  const bodies = new Set();
  for (const r of rows) {
    if (r.stationId) stations.set(r.stationId, stationRegistry.find((s) => s.id === r.stationId)?.name || r.stationId);
    if (r.body) bodies.add(r.body);
  }
  return {
    stations: [...stations].sort((a, b) => byText(a[1], b[1])).map(([id, name]) => ({ value: `station:${id}`, label: name })),
    bodies: [...bodies].sort(byText).map((name) => ({ value: `body:${name}`, label: name }))
  };
}

/** Goods at every station ("Stored"), and goods on their way to one ("In transit" or "Held"), one row per item and place.
 *  A shipment's place is where it is bound, which the row draws with an arrow. */
export function inventoryRows(allInventory, stationRegistry, shipments = []) {
  const stationOf = (id) => stationRegistry.find((s) => s.id === id);
  const rows = [];
  for (const st of stationRegistry) {
    for (const [item, qty] of Object.entries(allInventory[st.id] || {})) {
      const q = Number(qty);
      if (!(q > 0)) continue;
      rows.push({ kind: "stored", type: item, stationId: st.id, body: st.body || null, location: st.name || st.id, status: "Stored", amount: q });
    }
  }
  for (const s of shipments) {
    const to = stationOf(s.toStationId);
    const held = s.status === "held";
    for (const line of s.lines || []) {
      const q = Number(line.quantity);
      if (!(q > 0)) continue;
      rows.push({ kind: held ? "held" : "transit", type: line.item, stationId: s.toStationId, body: to?.body || null,
        location: to?.name || s.toStationId, status: held ? "Held" : "In transit", amount: q });
    }
  }
  return rows;
}

const badge = (tone, text) => `<span class="ui-badge${tone ? ` ui-badge--${tone}` : ""}">${escapeHtml(text)}</span>`;
const INVENTORY_TONES = { Stored: "", "In transit": "accent", Held: "warn" };

/** Offices, mining leases and extractors, one row each. */
export function infrastructureRows(corp, stationRegistry, now = Date.now()) {
  const offices = corp.offices || [];
  const leases = corp.miningLeases || [];
  const extractors = corp.mining?.silicateExtractors || [];
  const rows = [];

  // Offices
  const seenStations = new Set();
  for (const o of offices) {
    if (seenStations.has(o.stationId)) continue;
    seenStations.add(o.stationId);
    const st = stationRegistry.find((s) => s.id === o.stationId);
    const expired = o.rentedUntil && o.rentedUntil <= now;
    rows.push({ type: "Office Lease", assetHtml: "Office Lease", stationId: o.stationId, body: st?.body || null, location: st?.name || o.stationId,
      locationHtml: escapeHtml(st?.name || o.stationId), status: expired ? "Expired" : "Active", tone: expired ? "danger" : "success", amount: 0, detailsHtml: "—" });
  }

  // Mining leases
  for (const l of leases) {
    const exCount = leaseSlotsUsed(l); // ISP-98 (AB#788): extractors and the other buildings on the lease
    const totalMined = extractors.filter((ex) => ex.leaseId === l.id).reduce((sum, ex) => sum + Number(ex.totalMined || 0), 0);
    rows.push({ type: "Mining Lease", assetHtml: `Mining Lease ${refHtml(l.ref)}`, stationId: null, body: l.body || null, location: l.body || "",
      locationHtml: escapeHtml(l.body), status: "Active", tone: "success", amount: totalMined,
      detailsHtml: `${exCount}/${l.buildingSlots || 2} slots · ${totalMined.toLocaleString()} mined` });
  }

  // Extractors — show actual location (lease body) in the location column
  for (const ex of extractors) {
    // Resolve location with the most authoritative source first:
    //   1. ex.body — stored directly on the extractor (post-fix)
    //   2. lease.body when leaseId resolves
    //   3. lease whose extractorIds list contains us (legacy linkage)
    //   4. nothing → show "Unassigned" rather than silently defaulting to the
    //      first lease, which masks broken leaseId links and frustrates the
    //      player when a yard "moves" between hydrations.
    let locationBody = ex.body || null;
    if (!locationBody) {
      let lease = ex.leaseId ? leases.find((l) => l.id === ex.leaseId) : null;
      if (!lease) {
        const stripped = ex.leaseId ? String(ex.leaseId).split("::").pop() : null;
        if (stripped) lease = leases.find((l) => String(l.id).split("::").pop() === stripped);
      }
      if (!lease) lease = leases.find((l) => Array.isArray(l.extractorIds) && l.extractorIds.includes(ex.id));
      if (lease?.body) locationBody = lease.body;
    }
    const yardName = ex.name || ex.id;
    const [status, tone] = ex.downtimeActive ? ["Downtime", "warn"] : ex.active ? ["Active", "success"] : ["Idle", ""];
    const mined = Number(ex.totalMined || 0);
    rows.push({ type: "Extractor", assetHtml: "Extractor", stationId: null, body: locationBody, location: locationBody || "",
      locationHtml: locationBody ? `${escapeHtml(yardName)} — ${escapeHtml(locationBody)}` : `${escapeHtml(yardName)} ${badge("warn", "Unassigned")}`,
      status, tone, amount: mined, detailsHtml: `${mined.toLocaleString()} mined` });
  }
  return rows;
}

export function renderAssets(data) {
  const contentEl = document.getElementById("assets-content");
  if (!contentEl) return;

  const allInventory = getAllInventory();
  const stationRegistry = appState.stationRegistry || [];
  const corp = data.corp || {};

  // ── Active sub-tab ──
  const activeTab = contentEl.dataset.activeTab || "inventory";

  const inventory = inventoryRows(allInventory, stationRegistry, Array.isArray(corp.shipments) ? corp.shipments : []);
  const infrastructure = infrastructureRows(corp, stationRegistry);

  // ── The filter and the sort, over both tabs ──
  const options = filterOptions([...inventory, ...infrastructure], stationRegistry);
  const view = readAssetsView();
  const offered = new Set(["all", ...options.stations.map((o) => o.value), ...options.bodies.map((o) => o.value)]);
  const filter = offered.has(view.filter) ? view.filter : "all"; // a place the corporation no longer holds anything at
  const placeName = [...options.stations, ...options.bodies].find((o) => o.value === filter)?.label || "";

  // ── Inventory ──
  const invShown = sortRows(inventory.filter((r) => rowMatches(r, filter)), view.sort);
  const storedTotal = inventory.filter((r) => r.kind === "stored").reduce((s, r) => s + r.amount, 0);
  const shownTotal = invShown.reduce((s, r) => s + r.amount, 0);
  const emptyRow = (cols, label, text) => `<tr class="ui-table__muted"><td colspan="${cols}" data-label="${label}">${text}</td></tr>`;
  const inventoryBody = invShown.length
    ? invShown.map((r) => `<tr>
            <td data-label="Resource">${escapeHtml(r.type)}</td>
            <td data-label="Location">${r.kind === "stored" ? "" : '<span aria-label="bound for">→</span> '}${escapeHtml(r.location)}</td>
            <td data-label="Status">${badge(INVENTORY_TONES[r.status], r.status)}</td>
            <td class="ui-figure" data-label="Qty">${r.kind === "stored" ? numberMarkup(`assets:inventory:${r.stationId}:${r.type}`, r.amount, r.amount.toLocaleString()) : r.amount.toLocaleString()}</td>
          </tr>`).join("")
    : emptyRow(4, "Inventory", inventory.length ? `Nothing held at ${escapeHtml(placeName)}.` : "No resources in inventory.");
  const inventoryPanel = `
    <table class="ui-table">
      <thead><tr><th scope="col">Resource</th><th scope="col">Location</th><th scope="col">Status</th><th scope="col" class="ui-table__num">Qty</th></tr></thead>
      <tbody>${inventoryBody}</tbody>
      ${shownTotal > 0 ? `<tfoot><tr class="ui-table__total"><td colspan="3" data-label="Total">${filter === "all" ? "All locations" : escapeHtml(placeName)}</td><td class="ui-figure" data-label="Qty">${shownTotal.toLocaleString()}</td></tr></tfoot>` : ""}
    </table>`;

  // ── Infrastructure: offices + leases + extractors in one table ──
  const infraShown = sortRows(infrastructure.filter((r) => rowMatches(r, filter)), view.sort);
  const infraBody = infraShown.length
    ? infraShown.map((r) => `<tr>
      <td data-label="Asset">${r.assetHtml}</td>
      <td data-label="Location">${r.locationHtml}</td>
      <td data-label="Status">${badge(r.tone, r.status)}</td>
      <td class="ui-figure" data-label="Details">${r.detailsHtml}</td>
    </tr>`).join("")
    : emptyRow(4, "Infrastructure", infrastructure.length ? `No infrastructure at ${escapeHtml(placeName)}.` : "No infrastructure registered.");
  const infraPanel = `
    <table class="ui-table">
      <thead><tr><th scope="col">Asset</th><th scope="col">Location / ID</th><th scope="col">Status</th><th scope="col" class="ui-table__num">Details</th></tr></thead>
      <tbody>${infraBody}</tbody>
    </table>`;

  // ── Summary bar (the whole corporation, whatever the filter) ──
  const totalResources = new Set(inventory.filter((r) => r.kind === "stored").map((r) => r.type)).size;
  const totalOffices = infrastructure.filter((r) => r.type === "Office Lease").length;
  const totalLeases = infrastructure.filter((r) => r.type === "Mining Lease").length;
  const totalExtractors = infrastructure.filter((r) => r.type === "Extractor").length;

  const option = (o) => `<option value="${escapeHtml(o.value)}"${o.value === filter ? " selected" : ""}>${escapeHtml(o.label)}</option>`;
  const filterSelect = `<select id="assets-filter" class="ui-select">
        <option value="all"${filter === "all" ? " selected" : ""}>All locations</option>
        ${options.stations.length ? `<optgroup label="Stations">${options.stations.map(option).join("")}</optgroup>` : ""}
        ${options.bodies.length ? `<optgroup label="Planets and moons">${options.bodies.map(option).join("")}</optgroup>` : ""}
      </select>`;
  const sortSelect = `<select id="assets-sort" class="ui-select">${ASSET_SORTS.map(([key, label]) => `<option value="${key}"${key === view.sort ? " selected" : ""}>${label}</option>`).join("")}</select>`;

  const tab = (id, label) => `<button class="ui-tab" type="button" role="tab" id="assets-tab-${id}" aria-controls="assets-panel-${id}" aria-selected="${activeTab === id}" data-assets-tab="${id}">${label}</button>`;
  const panel = (id, body) => `<div class="ui-tabpanel" role="tabpanel" id="assets-panel-${id}" aria-labelledby="assets-tab-${id}" data-assets-panel="${id}"${activeTab === id ? "" : " hidden"}>${body}</div>`;
  const tile = (value, label) => `<div class="kpi-tile"><span class="kpi-tile__label">${label}</span><span class="kpi-tile__value">${value}</span></div>`;
  contentEl.innerHTML = `
    <section class="kpi-strip" aria-label="Holdings">
      ${tile(storedTotal.toLocaleString(), "Units Stored")}
      ${tile(totalResources, "Resource Types")}
      ${tile(totalOffices, "Offices")}
      ${tile(totalLeases, "Leases")}
      ${tile(totalExtractors, "Extractors")}
    </section>

    <div class="ui-tabs" role="tablist" aria-label="Assets">${tab("inventory", "Inventory")}${tab("infrastructure", "Infrastructure")}</div>
    <div class="assets__controls" role="group" aria-label="Filter and sort">
      <div class="ui-field"><label class="ui-field__label" for="assets-filter">Show</label>${filterSelect}</div>
      <div class="ui-field"><label class="ui-field__label" for="assets-sort">Sort by</label>${sortSelect}</div>
    </div>
    ${panel("inventory", inventoryPanel)}
    ${panel("infrastructure", infraPanel)}
  `;

  // Bind tab switching
  contentEl.querySelectorAll("[data-assets-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.assetsTab;
      contentEl.dataset.activeTab = tab;
      contentEl.querySelectorAll("[data-assets-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.assetsTab === tab)));
      contentEl.querySelectorAll("[data-assets-panel]").forEach(p => { p.hidden = p.dataset.assetsPanel !== tab; });
    });
  });

  // The filter and the sort: remembered, and the tab drawn again with them (focus stays on the control that changed).
  const bindChoice = (id, key) => contentEl.querySelector(`#${id}`)?.addEventListener("change", (event) => {
    writeAssetsView({ ...readAssetsView(), [key]: event.target.value });
    renderAssets(data);
    contentEl.querySelector(`#${id}`)?.focus();
  });
  bindChoice("assets-filter", "filter");
  bindChoice("assets-sort", "sort");
}
