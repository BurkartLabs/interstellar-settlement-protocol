// The Assets tab: what the corporation holds and where.
// AB#739 (ISP-53): everything here moved from app.js unchanged. ISP-79 (AB#768): drawn from the design system.

import { escapeHtml } from "../html.js";
import { appState } from "../state.js";
import { leaseSlotsUsed } from "../leaseSlots.js"; // ISP-98 (AB#788)
import { getAllInventory } from "./shared.js";

// ─── Assets ──────────────────────────────────────────────────────────────────
import { numberMarkup } from "../numberChange.js"; // AB#745: marks a number that is acknowledged when it changes
import { refHtml } from "../html.js"; // ISP-249 (AB#945)
export function renderAssets(data) {
  const contentEl = document.getElementById("assets-content");
  if (!contentEl) return;

  const allInventory = getAllInventory();
  const stationRegistry = appState.stationRegistry || [];
  const corp = data.corp || {};

  // ── Active sub-tab ──
  const activeTab = contentEl.dataset.activeTab || "inventory";

  // ── Inventory: single consolidated table ──
  // Build flat rows: resource, station, qty  — then aggregate totals
  const resourceMap = {}; // { resourceName: { stationId: qty } }
  for (const st of stationRegistry) {
    const inv = allInventory[st.id] || {};
    for (const [item, qty] of Object.entries(inv)) {
      const q = Number(qty);
      if (q <= 0) continue;
      if (!resourceMap[item]) resourceMap[item] = {};
      resourceMap[item][st.id] = q;
    }
  }

  const resourceNames = Object.keys(resourceMap).sort();
  // A resource is a group of rows, one per station holding it: the design system's group row, so a phone shows the
  // stations as cards under the resource's name (a rowspan cell would be lost there).
  let inventoryRows = "";
  let grandTotal = 0;
  if (resourceNames.length === 0) {
    inventoryRows = `<tr class="ui-table__muted"><td colspan="2" data-label="Inventory">No resources in inventory.</td></tr>`;
  } else {
    for (const resource of resourceNames) {
      const stationEntries = Object.entries(resourceMap[resource]);
      grandTotal += stationEntries.reduce((s, [, q]) => s + q, 0);
      inventoryRows += `<tr class="ui-table__group"><th colspan="2" scope="rowgroup">${escapeHtml(resource)}</th></tr>`;
      for (const [stId, qty] of stationEntries) {
        const stName = stationRegistry.find((s) => s.id === stId)?.name || stId;
        inventoryRows += `<tr>
            <td data-label="Location">${escapeHtml(stName)}</td>
            <td class="ui-figure" data-label="Qty">${numberMarkup(`assets:inventory:${stId}:${resource}`, qty, qty.toLocaleString())}</td>
          </tr>`;
      }
    }
  }

  const inventoryPanel = `
    <table class="ui-table">
      <thead><tr><th scope="col">Resource and location</th><th scope="col" class="ui-table__num">Qty</th></tr></thead>
      <tbody>${inventoryRows}</tbody>
      ${grandTotal > 0 ? `<tfoot><tr class="ui-table__total"><td data-label="Total">All stations</td><td class="ui-figure" data-label="Qty">${grandTotal.toLocaleString()}</td></tr></tfoot>` : ""}
    </table>`;

  // ── Infrastructure: offices + leases + extractors in one table ──
  const offices = corp.offices || [];
  const leases = corp.miningLeases || [];
  const extractors = corp.mining?.silicateExtractors || [];

  let infraRows = "";
  const statusBadge = (tone, text) => `<span class="ui-badge${tone ? ` ui-badge--${tone}` : ""}">${text}</span>`;
  const row = (asset, location, status, details) => `<tr>
      <td data-label="Asset">${asset}</td>
      <td data-label="Location">${location}</td>
      <td data-label="Status">${status}</td>
      <td class="ui-figure" data-label="Details">${details}</td>
    </tr>`;
  // Offices
  const seenStations = new Set();
  for (const o of offices) {
    if (seenStations.has(o.stationId)) continue;
    seenStations.add(o.stationId);
    const st = stationRegistry.find(s => s.id === o.stationId);
    const expired = o.rentedUntil && o.rentedUntil <= Date.now();
    infraRows += row("Office Lease", escapeHtml(st?.name || o.stationId), expired ? statusBadge("danger", "Expired") : statusBadge("success", "Active"), "—");
  }

  // Mining leases
  for (const l of leases) {
    const exCount = leaseSlotsUsed(l); // ISP-98 (AB#788): extractors and the other buildings on the lease
    const leaseExtractors = extractors.filter(ex => ex.leaseId === l.id);
    const totalMined = leaseExtractors.reduce((sum, ex) => sum + Number(ex.totalMined || 0), 0);
    infraRows += row(`Mining Lease ${refHtml(l.ref)}`, escapeHtml(l.body), statusBadge("success", "Active"), `${exCount}/${l.buildingSlots || 2} slots · ${totalMined.toLocaleString()} mined`);
  }

  // Extractors — show actual location (lease body) in the location column
  for (const ex of extractors) {
    const status = ex.downtimeActive ? statusBadge("warn", "Downtime") : ex.active ? statusBadge("success", "Active") : statusBadge("", "Idle");
    // Resolve location with the most authoritative source first:
    //   1. ex.body — stored directly on the extractor (post-fix)
    //   2. lease.body when leaseId resolves
    //   3. lease whose extractorIds list contains us (legacy linkage)
    //   4. nothing → show "Unassigned" rather than silently defaulting to the
    //      first lease, which masks broken leaseId links and frustrates the
    //      player when a yard "moves" between hydrations.
    let locationBody = ex.body || null;
    if (!locationBody) {
      let lease = ex.leaseId ? leases.find(l => l.id === ex.leaseId) : null;
      if (!lease) {
        const stripped = ex.leaseId ? String(ex.leaseId).split("::").pop() : null;
        if (stripped) lease = leases.find(l => String(l.id).split("::").pop() === stripped);
      }
      if (!lease) lease = leases.find(l => Array.isArray(l.extractorIds) && l.extractorIds.includes(ex.id));
      if (lease?.body) locationBody = lease.body;
    }
    const yardName = ex.name || ex.id;
    const locationLabel = locationBody
      ? `${escapeHtml(yardName)} — ${escapeHtml(locationBody)}`
      : `${escapeHtml(yardName)} ${statusBadge("warn", "Unassigned")}`;
    infraRows += row("Extractor", locationLabel, status, `${Number(ex.totalMined || 0).toLocaleString()} mined`);
  }

  if (!infraRows) {
    infraRows = `<tr class="ui-table__muted"><td colspan="4" data-label="Infrastructure">No infrastructure registered.</td></tr>`;
  }

  const infraPanel = `
    <table class="ui-table">
      <thead><tr><th scope="col">Asset</th><th scope="col">Location / ID</th><th scope="col">Status</th><th scope="col" class="ui-table__num">Details</th></tr></thead>
      <tbody>${infraRows}</tbody>
    </table>`;

  // ── Summary bar ──
  const totalResources = resourceNames.length;
  const totalOffices = seenStations.size;
  const totalLeases = leases.length;
  const totalExtractors = extractors.length;

  const tab = (id, label) => `<button class="ui-tab" type="button" role="tab" id="assets-tab-${id}" aria-controls="assets-panel-${id}" aria-selected="${activeTab === id}" data-assets-tab="${id}">${label}</button>`;
  const panel = (id, body) => `<div class="ui-tabpanel" role="tabpanel" id="assets-panel-${id}" aria-labelledby="assets-tab-${id}" data-assets-panel="${id}"${activeTab === id ? "" : " hidden"}>${body}</div>`;
  const tile = (value, label) => `<div class="kpi-tile"><span class="kpi-tile__label">${label}</span><span class="kpi-tile__value">${value}</span></div>`;
  contentEl.innerHTML = `
    <section class="kpi-strip" aria-label="Holdings">
      ${tile(grandTotal.toLocaleString(), "Units Stored")}
      ${tile(totalResources, "Resource Types")}
      ${tile(totalOffices, "Offices")}
      ${tile(totalLeases, "Leases")}
      ${tile(totalExtractors, "Extractors")}
    </section>

    <div class="ui-tabs" role="tablist" aria-label="Assets">${tab("inventory", "Inventory")}${tab("infrastructure", "Infrastructure")}</div>
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
}
