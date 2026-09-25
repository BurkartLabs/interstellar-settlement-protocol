// The Refinery Chains tab.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { deepClone, formatDurationHours, toCurrency } from "../helpers.js";
import { escapeHtml, refineryBuildButtonHtml } from "../html.js";
import { refineMinimum, refineQuantityCheck, refineQuantityFieldValue } from "../refineQuantity.js";
import { appState } from "../state.js";
import { clientPrices } from "../clientPrices.js";
import { cycleProgressPercent, pushFeedback, updateAllViews } from "./shared.js";

// TODO(AB#824): Remove duplicate. This should be stored in the database
export const RESOURCE_CATALOG = [
  "Silicates", "Helium-3", "Nickel", "Titanium", "Carbon",
  "Water Ice", "Rare Earths", "Thorium", "Hydrogen", "Lithium",
  "Cobalt", "Uranium", "Exotic Matter"
];

export function renderRefinery(data) {
  const catalog = document.getElementById("resource-catalog");
  catalog.innerHTML = RESOURCE_CATALOG.map((res) => `<span class="pill">${escapeHtml(res)}</span>`).join("");

  const refineries = data.corp?.refineries || [];
  const corp = data.corp || {};
  const unlockedTech = new Set(data.corp?.unlockedTech || []);
  const stationId = data.corp?.currentStationId || "earth-station-prime";
  const inventoryByStation = data.corp?.inventory || {};
  const inventory = inventoryByStation[stationId] || {};
  const buildings = Array.isArray(corp.buildings) ? corp.buildings : [];
  const buildingSlots = Number(corp.buildingSlots || 2);
  const hasOpenBuildingSlot = buildings.length < buildingSlots;
  const hasRefinery = refineries.length > 0;
  const MAX_REFINERIES = 2;
  const belowRefineryCap = refineries.length < MAX_REFINERIES;
  const canBuildRefinery = unlockedTech.has("tt-material-compression") && unlockedTech.has("tt-nano-lattice");
  const refineryStatus = appState.refineryStatus;

  // ── Active Runs ──
  const refineryChains = data.world?.refineryChains || [];

  const activeEl = document.getElementById("refinery-active-runs");
  const activeRefineries = refineries.filter((r) => r.active);
  if (!activeRefineries.length) {
    activeEl.innerHTML = `<article class="queue-item"><p class="muted">${hasRefinery ? "No active refinery cycles. Start a production run below." : "Build a Refinery to begin processing raw materials."}</p></article>`;
  } else {
    activeEl.innerHTML = activeRefineries.map((ref) => {
      const chain = refineryChains.find((c) => c.id === ref.chainId);
      const progress = cycleProgressPercent(ref);
      const remainingMs = Math.max(0, Number(ref.endsAt || 0) - Date.now());
      const scale = Math.max(1, Number(ref.cycleScale || 1));
      const totalInput = chain ? Number(chain.inputQuantityPerCycle || 100) * scale : 0;
      const outputLabel = chain
        ? chain.outputs.map((o) => `${(Number(o.quantityPerCycle) || 0) * scale} ${o.item}`).join(", ")
        : "Unknown";
      // Bug #692: outputs land where the inputs came from, whatever station the corporation is at when the cycle ends.
      const deliveryStation = (appState.stationRegistry || []).find((s) => s.id === ref.stationId);
      const deliveryLabel = deliveryStation?.name || ref.stationId || "an unknown station";
      return `
        <article class="queue-item">
          <h3>${escapeHtml(ref.name)}</h3>
          <p class="muted">Processing: ${chain ? `${totalInput.toLocaleString()} ${escapeHtml(chain.input)}` : "Unknown"} → ${escapeHtml(outputLabel)}</p>
          <p class="muted">Delivers to: ${escapeHtml(deliveryLabel)}</p>
          <p class="muted">Remaining: ${formatDurationHours(remainingMs)} (${progress.toFixed(1)}%)</p>
          <div class="progress-wrap"><div class="progress-bar" style="width:${progress.toFixed(1)}%"></div></div>
        </article>
      `;
    }).join("");
  }

  // ── Available Chains ──
  const chainsEl = document.getElementById("refinery-chains");
  // Capture which refine-quantity input has focus (and its caret) so we can
  // restore it after re-rendering — otherwise periodic re-renders steal focus.
  const focusedInput = document.activeElement && document.activeElement.classList?.contains("refine-quantity-input")
    ? {
        id: document.activeElement.id,
        selStart: document.activeElement.selectionStart,
        selEnd: document.activeElement.selectionEnd
      }
    : null;
  const statusHtml = refineryStatus?.text
    ? `<article class="queue-item"><p class="muted" style="color:${refineryStatus.type === "ok" ? "var(--color-accent)" : "var(--color-warn)"}">${escapeHtml(refineryStatus.text)}</p></article>`
    : "";

  chainsEl.innerHTML = statusHtml + refineryChains
    .map((chain) => {
      const techGated = Array.isArray(chain.requiresTechIds) && !chain.requiresTechIds.every((t) => unlockedTech.has(t));
      const outputLabel = Array.isArray(chain.outputs)
        ? chain.outputs.map((o) => typeof o === "string" ? o : `${o.quantityPerCycle} ${o.item}`).join(", ")
        : String(chain.outputs);
      const inputAvailable = Number(inventory[chain.input] || 0);
      const perCycle = Number(chain.inputQuantityPerCycle || 100);
      // Whole batches, at least 100 units: the rule start-refinery checks too (refineQuantity.js).
      const minQty = refineMinimum(perCycle);
      const hasInput = inputAvailable >= minQty;
      const idleRefinery = refineries.find((r) => !r.active);
      const canStart = hasRefinery && !techGated && hasInput && idleRefinery;
      // Default the quantity input to whichever is larger: the minimum, or as
      // much of the player's stock as fits in whole batches.
      const computedDefault = Math.max(minQty, Math.floor(inputAvailable / perCycle) * perCycle || minQty);
      // What the player typed stays as typed, blank included (AB#1255); Start Run checks it and refuses, not the render.
      const fieldValue = refineQuantityFieldValue(appState.refineQuantityOverrides[chain.id], computedDefault);
      const quantityError = appState.refineQuantityErrors[chain.id];
      const inputId = `refine-qty-${chain.id}`;

      return `
        <section class="data-card">
          <h3>${escapeHtml(chain.input)} Refining</h3>
          <p class="muted">${perCycle} ${escapeHtml(chain.input)} per batch → ${escapeHtml(outputLabel)}</p>
          <p class="muted">Cycle: ${chain.cycleDurationHours || "?"}h per batch</p>
          ${techGated
            // ISP-292 (AB#1761): a requirement not yet met, not a warning — the muted token, not amber.
            ? `<p class="muted">Requires: ${escapeHtml((chain.requiresResearch || []).join(", "))}</p>`
            : `<p class="muted" style="color:var(--color-accent)">Research: ✓ Unlocked</p>`
          }
          <p class="muted">Inventory: ${inputAvailable.toLocaleString()} ${escapeHtml(chain.input)}${!hasInput && !techGated ? ` (need ${minQty})` : ""}</p>
          ${canStart
            ? `<div class="refine-quantity-row" style="display:flex;gap:0.5rem;align-items:center;margin:0.5rem 0;">
                <label for="${escapeHtml(inputId)}" class="muted" style="font-size:0.85rem;">Quantity</label>
                <input id="${escapeHtml(inputId)}" class="refine-quantity-input" type="number"
                  min="${minQty}" step="${perCycle}" value="${escapeHtml(fieldValue)}"
                  data-chain-id="${escapeHtml(chain.id)}"
                  style="width:9rem;padding:0.3rem 0.5rem;background:var(--color-bg-deep);border:1px solid var(--color-border);color:var(--color-text);border-radius:4px;" />
                <span class="muted" style="font-size:0.8rem;">min ${minQty}, step ${perCycle}</span>
              </div>
              ${quantityError ? `<p class="refine-quantity-error" role="alert" style="color:var(--warn);margin:0 0 0.5rem;">${escapeHtml(quantityError)}</p>` : ""}
              <button class="btn btn-accent refinery-start-btn" data-chain-id="${escapeHtml(chain.id)}" data-refinery-id="${escapeHtml(idleRefinery.id)}" data-quantity-input="${escapeHtml(inputId)}" data-per-cycle="${perCycle}" data-input="${escapeHtml(chain.input)}" data-available="${inputAvailable}" data-hours="${Number(chain.cycleDurationHours) || 0}">Start Run</button>`
            : belowRefineryCap && canBuildRefinery
              ? refineryBuildButtonHtml({ hasRefinery, used: buildings.length, slots: buildingSlots })
              : !hasRefinery && !canBuildRefinery
                // ISP-292 (AB#1761): a requirement not yet met, not a warning — the muted token, not amber.
                ? `<p class="muted">Refinery construction requires: Material Compression I and Nano-Lattice Weaving research.</p>`
                : hasRefinery && !idleRefinery
                  ? `<p class="muted" style="color:var(--color-warn)">All refineries busy.</p>`
                  : ""
          }
        </section>
      `;
    })
    .join("");

  // ── Event delegation for start/build ──
  // Track quantity edits so re-renders (every few seconds) don't blow them away.
  chainsEl.oninput = (e) => {
    const qty = e.target.closest(".refine-quantity-input");
    if (!qty) return;
    const chainId = qty.getAttribute("data-chain-id");
    if (!chainId) return;
    appState.refineQuantityOverrides[chainId] = qty.value;
    delete appState.refineQuantityErrors[chainId]; // the reason was about the old value
  };

  // Restore focus/caret on the quantity input that was being edited.
  if (focusedInput?.id) {
    const restored = document.getElementById(focusedInput.id);
    if (restored && typeof restored.focus === "function") {
      restored.focus();
      try {
        if (focusedInput.selStart != null && typeof restored.setSelectionRange === "function") {
          restored.setSelectionRange(focusedInput.selStart, focusedInput.selEnd ?? focusedInput.selStart);
        }
      } catch (_) { /* ignore — number inputs don't always allow selection */ }
    }
  }

  chainsEl.onclick = async (e) => {
    const startBtn = e.target.closest(".refinery-start-btn");
    if (startBtn && appState.accountId) {
      const chainId = startBtn.getAttribute("data-chain-id");
      const refineryId = startBtn.getAttribute("data-refinery-id");
      const qtyInputId = startBtn.getAttribute("data-quantity-input");
      const qtyInput = qtyInputId ? document.getElementById(qtyInputId) : null;
      const input = startBtn.getAttribute("data-input");
      // AB#1255: what is in the field, checked and sent as it is, or refused beside it; never replaced by a default.
      const check = refineQuantityCheck(qtyInput ? qtyInput.value : "", {
        perCycle: Number(startBtn.getAttribute("data-per-cycle")),
        input,
        available: Number(startBtn.getAttribute("data-available"))
      });
      if (!check.ok) {
        appState.refineQuantityErrors[chainId] = check.reason;
        updateAllViews();
        return;
      }
      startBtn.disabled = true;
      startBtn.textContent = "Starting…";
      try {
        const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/start-refinery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chainId, refineryId, inputQuantity: check.quantity })
        });
        const account = await parseJsonResponse(response);
        delete appState.refineQuantityOverrides[chainId];
        delete appState.refineQuantityErrors[chainId];
        const hours = Number(startBtn.getAttribute("data-hours")) * check.batches;
        const started = `Refinery run started: ${check.quantity.toLocaleString("en-US")} ${input}, ready in ${hours}h.`;
        appState.refineryStatus = { type: "ok", text: started };
        pushFeedback(started, "ok");
        appState.data = deepClone(account.state);
        appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
        updateAllViews();
      } catch (error) {
        startBtn.disabled = false;
        startBtn.textContent = "Start Run";
        appState.refineQuantityErrors[chainId] = error.message;
        pushFeedback(`Refinery error: ${error.message}`, "warn");
        updateAllViews();
      }
      return;
    }

    const buildBtn = e.target.closest(".refinery-build-btn");
    if (buildBtn) {
      const disabledReason = buildBtn.getAttribute("data-disabled-reason");
      if (disabledReason) {
        appState.refineryStatus = { type: "warn", text: disabledReason };
        updateAllViews();
        pushFeedback(`Build error: ${disabledReason}`, "warn");
        return;
      }

      buildBtn.disabled = true;
      buildBtn.textContent = "Building…";
      try {
        if (appState.accountId) {
          const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/build-refinery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
        } else {
          const corp = appState.data?.corp;
          if (!corp) {
            throw new Error("Corporation state is unavailable.");
          }

          const unlockedTechSet = new Set(corp.unlockedTech || []);
          if (!unlockedTechSet.has("tt-material-compression") || !unlockedTechSet.has("tt-nano-lattice")) {
            throw new Error("Refinery construction requires Material Compression I and Nano-Lattice Weaving research.");
          }

          const buildings = Array.isArray(corp.buildings) ? corp.buildings : (corp.buildings = []);
          const buildingSlots = Number(corp.buildingSlots || 2);
          if (buildings.length >= buildingSlots) {
            throw new Error(`Refinery requires 1 open building slot. Current usage: ${buildings.length}/${buildingSlots}.`);
          }

          if (!corp.finances || typeof corp.finances !== "object") {
            corp.finances = { credits: 0, assets: 0 };
          }
          const { refineryCost: buildCost, refineryAssetValue: assetValue } = clientPrices(appState.economy);
          if (Number(corp.finances.credits || 0) < buildCost) {
            throw new Error(`Refinery construction requires ${toCurrency(buildCost)} credits.`);
          }

          buildings.push({ name: "Refinery", tier: 1, status: "Operational" });

          if (!Array.isArray(corp.refineries)) corp.refineries = [];
          const nextIndex = corp.refineries.length + 1;
          corp.refineries.push({
            id: `ref-${nextIndex}`,
            name: `Refinery #${nextIndex}`,
            tier: 1,
            active: false,
            chainId: null,
            startedAt: null,
            lastTickAt: null,
            endsAt: null,
            cyclesCompleted: 0,
            totalInputConsumed: 0,
            totalOutputProduced: 0
          });

          corp.finances.credits -= buildCost;
          corp.finances.assets = Number(corp.finances.assets || 0) + assetValue;
        }

        appState.refineryStatus = { type: "ok", text: "Refinery commissioned." };
        updateAllViews();
        pushFeedback("Refinery commissioned.", "ok");
      } catch (error) {
        appState.refineryStatus = { type: "warn", text: error.message };
        updateAllViews();
        pushFeedback(`Build error: ${error.message}`, "warn");
      }
    }
  };
}
