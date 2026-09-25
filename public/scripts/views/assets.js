// The Assets tab: what the corporation holds and where.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { escapeHtml } from "../html.js";
import { appState } from "../state.js";
import { getAllInventory } from "./shared.js";

// ─── Assets ──────────────────────────────────────────────────────────────────
import { numberMarkup } from "../numberChange.js"; // AB#745: marks a number that is acknowledged when it changes
export function renderAssets(data) {
  const bannerEl = document.getElementById("assets-station-banner");
  if (bannerEl) bannerEl.innerHTML = "";

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
  let inventoryRows = "";
  let grandTotal = 0;
  if (resourceNames.length === 0) {
    inventoryRows = `<tr><td colspan="3" class="assets-empty">No resources in inventory.</td></tr>`;
  } else {
    for (const resource of resourceNames) {
      const stations = resourceMap[resource];
      const stationEntries = Object.entries(stations);
      const total = stationEntries.reduce((s, [, q]) => s + q, 0);
      grandTotal += total;

      // First station row includes the resource name with rowspan
      let first = true;
      for (const [stId, qty] of stationEntries) {
        const st = stationRegistry.find(s => s.id === stId);
        const stName = st?.name || stId;
        if (first) {
          inventoryRows += `<tr>
            <td class="assets-resource-name" rowspan="${stationEntries.length}">${escapeHtml(resource)}</td>
            <td>${escapeHtml(stName)}</td>
            <td class="num">${numberMarkup(`assets:inventory:${stId}:${resource}`, qty, qty.toLocaleString())}</td>
          </tr>`;
          first = false;
        } else {
          inventoryRows += `<tr>
            <td>${escapeHtml(stName)}</td>
            <td class="num">${numberMarkup(`assets:inventory:${stId}:${resource}`, qty, qty.toLocaleString())}</td>
          </tr>`;
        }
      }
    }
  }

  const inventoryPanel = `
    <table class="assets-table">
      <thead><tr><th>Resource</th><th>Location</th><th class="num">Qty</th></tr></thead>
      <tbody>${inventoryRows}</tbody>
      ${grandTotal > 0 ? `<tfoot><tr><td colspan="2">Total</td><td class="num">${grandTotal.toLocaleString()}</td></tr></tfoot>` : ""}
    </table>`;

  // ── Infrastructure: offices + leases + extractors in one table ──
  const offices = corp.offices || [];
  const leases = corp.miningLeases || [];
  const extractors = corp.mining?.silicateExtractors || [];

  let infraRows = "";
  // Offices
  const seenStations = new Set();
  for (const o of offices) {
    if (seenStations.has(o.stationId)) continue;
    seenStations.add(o.stationId);
    const st = stationRegistry.find(s => s.id === o.stationId);
    const expired = o.rentedUntil && o.rentedUntil <= Date.now();
    const statusCls = expired ? "expired" : "operational";
    const statusText = expired ? "Expired" : "Active";
    infraRows += `<tr>
      <td>Office Lease</td>
      <td>${escapeHtml(st?.name || o.stationId)}</td>
      <td><span class="building-status-badge ${statusCls}">${statusText}</span></td>
      <td class="muted">—</td>
    </tr>`;
  }

  // Mining leases
  for (const l of leases) {
    const exCount = (l.extractorIds || []).length;
    const leaseExtractors = extractors.filter(ex => ex.leaseId === l.id);
    const totalMined = leaseExtractors.reduce((sum, ex) => sum + Number(ex.totalMined || 0), 0);
    infraRows += `<tr>
      <td>Mining Lease</td>
      <td>${escapeHtml(l.body)}</td>
      <td><span class="building-status-badge operational">Active</span></td>
      <td class="num">${exCount}/${l.buildingSlots || 2} slots · ${totalMined.toLocaleString()} mined</td>
    </tr>`;
  }

  // Extractors — show actual location (lease body) in the location column
  for (const ex of extractors) {
    const status = ex.downtimeActive ? "Downtime" : ex.active ? "Active" : "Idle";
    const statusCls = ex.downtimeActive ? "downtime" : ex.active ? "operational" : "idle";
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
      ? `${escapeHtml(yardName)} <span class="muted">— ${escapeHtml(locationBody)}</span>`
      : `${escapeHtml(yardName)} <span class="muted" style="color:var(--color-warn)">— Unassigned</span>`;
    infraRows += `<tr>
      <td>Extractor</td>
      <td>${locationLabel}</td>
      <td><span class="building-status-badge ${statusCls}">${status}</span></td>
      <td class="num">${Number(ex.totalMined || 0).toLocaleString()} mined</td>
    </tr>`;
  }

  if (!infraRows) {
    infraRows = `<tr><td colspan="4" class="assets-empty">No infrastructure registered.</td></tr>`;
  }

  const infraPanel = `
    <table class="assets-table">
      <thead><tr><th>Asset</th><th>Location / ID</th><th>Status</th><th class="num">Details</th></tr></thead>
      <tbody>${infraRows}</tbody>
    </table>`;

  // ── Summary bar ──
  const totalResources = resourceNames.length;
  const totalOffices = seenStations.size;
  const totalLeases = leases.length;
  const totalExtractors = extractors.length;

  contentEl.innerHTML = `
    <div class="assets-summary-bar">
      <div class="assets-stat"><span class="assets-stat-value">${grandTotal.toLocaleString()}</span><span class="assets-stat-label">Units Stored</span></div>
      <div class="assets-stat"><span class="assets-stat-value">${totalResources}</span><span class="assets-stat-label">Resource Types</span></div>
      <div class="assets-stat"><span class="assets-stat-value">${totalOffices}</span><span class="assets-stat-label">Offices</span></div>
      <div class="assets-stat"><span class="assets-stat-value">${totalLeases}</span><span class="assets-stat-label">Leases</span></div>
      <div class="assets-stat"><span class="assets-stat-value">${totalExtractors}</span><span class="assets-stat-label">Extractors</span></div>
    </div>

    <nav class="assets-tab-nav">
      <button class="assets-tab-btn${activeTab === "inventory" ? " active" : ""}" data-assets-tab="inventory">Inventory</button>
      <button class="assets-tab-btn${activeTab === "infrastructure" ? " active" : ""}" data-assets-tab="infrastructure">Infrastructure</button>
    </nav>

    <div class="assets-panel-body">
      <div class="assets-panel${activeTab === "inventory" ? " active" : ""}" data-assets-panel="inventory">${inventoryPanel}</div>
      <div class="assets-panel${activeTab === "infrastructure" ? " active" : ""}" data-assets-panel="infrastructure">${infraPanel}</div>
    </div>
  `;

  // Bind tab switching
  contentEl.querySelectorAll(".assets-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.assetsTab;
      contentEl.dataset.activeTab = tab;
      contentEl.querySelectorAll(".assets-tab-btn").forEach(b => b.classList.toggle("active", b.dataset.assetsTab === tab));
      contentEl.querySelectorAll(".assets-panel").forEach(p => p.classList.toggle("active", p.dataset.assetsPanel === tab));
    });
  });
}
