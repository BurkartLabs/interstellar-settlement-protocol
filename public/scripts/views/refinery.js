// The Refinery Chains tab.
// AB#739 (ISP-53): everything here moved from app.js unchanged. ISP-79 (AB#768): drawn from the design system.

import { showActionReceipt } from "./receiptModal.js"; // AB#744
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { deepClone, formatDurationHours, toCurrency } from "../helpers.js";
import { escapeHtml, refineryBuildButtonHtml } from "../html.js";
import { refineMinimum, refineQuantityCheck, refineQuantityFieldValue } from "../refineQuantity.js";
import { inputsLabel, maxBatches } from "../refineryRun.js"; // AB#825: "150 Iron Ore + 50 Nickel"
import { appState } from "../state.js";
import { clientPrices } from "../clientPrices.js";
import { refineryMultiplierFor, refineryOutput } from "../refineryOutput.js"; // ISP-97 (AB#787), AB#794: output by tier
import { cycleProgressPercent, pushFeedback, updateAllViews } from "./shared.js";


export function renderRefinery(data) {
  const catalog = document.getElementById("resource-catalog");
  // AB#2353: data/refinery-chains.json's list, sent with the world (server/game/shape.js); the page kept a copy of it,
  // and the copy missed Iron Ore when AB#831 added it.
  catalog.innerHTML = (data.world?.resourceCatalog || []).map((res) => `<li class="ui-badge">${escapeHtml(res)}</li>`).join("");

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
    activeEl.innerHTML = `<div class="ui-state"><p class="ui-state__title">${hasRefinery ? "No active refinery cycles." : "No refinery yet."}</p><p class="ui-state__why">${hasRefinery ? "Start a production run below." : "Build a Refinery to begin processing raw materials."}</p></div>`;
  } else {
    activeEl.innerHTML = activeRefineries.map((ref) => {
      const chain = refineryChains.find((c) => c.id === ref.chainId);
      const progress = cycleProgressPercent(ref);
      const remainingMs = Math.max(0, Number(ref.endsAt || 0) - Date.now());
      const scale = Math.max(1, Number(ref.cycleScale || 1));
      // AB#825: what the run took, as it recorded at its start, or its chain's inputs times its batches.
      const taken = ref.inputs || (chain?.inputs || []).map((i) => ({ item: i.item, quantity: Number(i.quantityPerCycle) * scale }));
      const multiplier = refineryMultiplierFor(ref.tier, appState.economy?.buildings); // AB#794: this refinery's tier
      const outputLabel = chain
        ? chain.outputs.map((o) => `${refineryOutput(o.quantityPerCycle, scale, ref.tier, multiplier)} ${o.item}`).join(", ")
        : "Unknown";
      // Bug #692: outputs land where the inputs came from, whatever station the corporation is at when the cycle ends.
      const deliveryStation = (appState.stationRegistry || []).find((s) => s.id === ref.stationId);
      const deliveryLabel = deliveryStation?.name || ref.stationId || "an unknown station";
      const name = `${ref.name}${Number(ref.tier) >= 2 ? " · Refinery Complex" : ""}`;
      return `
        <article class="ui-card">
          <h4 class="ui-card__title">${escapeHtml(name)}</h4>
          <p class="ui-card__body">Processing: ${taken.length ? escapeHtml(inputsLabel(taken)) : "Unknown"} → ${escapeHtml(outputLabel)}</p>
          <p class="ui-card__meta">Delivers to: ${escapeHtml(deliveryLabel)}</p>
          <p class="ui-card__meta research__timing"><span class="ui-figure">${progress.toFixed(1)}%</span><span>${formatDurationHours(remainingMs)} remaining</span></p>
          <div class="progress-wrap" role="progressbar" aria-label="${escapeHtml(name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><div class="progress-bar" style="width:${progress.toFixed(1)}%"></div></div>
        </article>
      `;
    }).join("");
  }

  // ── Available Chains ──
  const chainsEl = document.getElementById("refinery-chains");
  // Capture which refine-quantity input has focus (and its caret) so we can
  // restore it after re-rendering — otherwise periodic re-renders steal focus.
  const focusedInput = document.activeElement && document.activeElement.classList?.contains("refinery__quantity")
    ? {
        id: document.activeElement.id,
        selStart: document.activeElement.selectionStart,
        selEnd: document.activeElement.selectionEnd
      }
    : null;
  // The last start or build outcome, above the chains: a tone class, never a colour written here.
  const statusHtml = refineryStatus?.text
    ? `<p class="refinery__status refinery__status--${refineryStatus.type === "ok" ? "ok" : "warn"}" role="status">${escapeHtml(refineryStatus.text)}</p>`
    : "";
  const statusEl = document.getElementById("refinery-status");
  if (statusEl) statusEl.innerHTML = statusHtml;

  chainsEl.innerHTML = refineryChains
    .map((chain) => {
      const techGated = Array.isArray(chain.requiresTechIds) && !chain.requiresTechIds.every((t) => unlockedTech.has(t));
      const outputLabel = Array.isArray(chain.outputs)
        ? chain.outputs.map((o) => typeof o === "string" ? o : `${o.quantityPerCycle} ${o.item}`).join(", ")
        : String(chain.outputs);
      // AB#825: a chain takes `inputs`. A chain with several (the v0.8 tracks', AB#833) shows them all, and its start
      // form is the multi-input panel's (AB#836).
      const inputs = chain.inputs || [];
      const input = inputs[0]?.item || "";
      const multiInput = inputs.length > 1;
      const inputAvailable = Number(inventory[input] || 0);
      const perCycle = Number(inputs[0]?.quantityPerCycle || 100);
      // Whole batches, at least 100 units: the rule start-refinery checks too (refineQuantity.js).
      const minQty = refineMinimum(perCycle);
      const hasInput = inputAvailable >= minQty;
      const idleRefinery = refineries.find((r) => !r.active);
      const canStart = hasRefinery && !techGated && hasInput && idleRefinery && !multiInput;
      // Default the quantity input to whichever is larger: the minimum, or as
      // much of the player's stock as fits in whole batches.
      // AB#825: never more than a week of batches, the most one run may take.
      const computedDefault = Math.min(maxBatches(chain) * perCycle, Math.max(minQty, Math.floor(inputAvailable / perCycle) * perCycle || minQty));
      // What the player typed stays as typed, blank included (AB#1255); Start Run checks it and refuses, not the render.
      const fieldValue = refineQuantityFieldValue(appState.refineQuantityOverrides[chain.id], computedDefault);
      const quantityError = appState.refineQuantityErrors[chain.id];
      const inputId = `refine-qty-${chain.id}`;
      const errorId = `${inputId}-error`;

      return `
        <section class="ui-card refinery__chain">
          <h4 class="ui-card__title">${escapeHtml(inputs.map((i) => i.item).join(" + "))} Refining</h4>
          <p class="ui-card__body">${escapeHtml(inputsLabel(inputs.map((i) => ({ item: i.item, quantity: i.quantityPerCycle }))))} per batch → ${escapeHtml(outputLabel)}</p>
          <p class="ui-card__meta">Cycle: ${chain.cycleDurationHours || "?"}h per batch</p>
          ${techGated
            // ISP-292 (AB#1761): a requirement not yet met, not a warning — the muted token, not amber.
            ? `<p class="ui-card__meta">Requires: ${escapeHtml((chain.requiresResearch || []).join(", "))}</p>`
            : `<p class="ui-card__meta"><span class="ui-badge ui-badge--success">Research unlocked</span></p>`
          }
          ${multiInput
            ? `<p class="ui-card__meta">Inventory: ${escapeHtml(inputs.map((i) => `${Number(inventory[i.item] || 0).toLocaleString()} ${i.item}`).join(", "))}</p>`
            : `<p class="ui-card__meta">Inventory: ${inputAvailable.toLocaleString()} ${escapeHtml(input)}${!hasInput && !techGated ? ` (need ${minQty})` : ""}</p>`}
          ${canStart
            ? `<div class="ui-field">
                <label for="${escapeHtml(inputId)}" class="ui-field__label">Quantity</label>
                <input id="${escapeHtml(inputId)}" class="ui-input refinery__quantity" type="number"
                  min="${minQty}" step="${perCycle}" value="${escapeHtml(fieldValue)}" data-chain-id="${escapeHtml(chain.id)}"${quantityError ? ` aria-invalid="true" aria-describedby="${escapeHtml(errorId)}"` : ""} />
                <span class="ui-field__hint">Min ${minQty}, step ${perCycle}</span>
                ${quantityError ? `<p id="${escapeHtml(errorId)}" class="ui-field__error" role="alert">${escapeHtml(quantityError)}</p>` : ""}
              </div>
              <button class="ui-button ui-button--secondary refinery__start" type="button" data-chain-id="${escapeHtml(chain.id)}" data-refinery-id="${escapeHtml(idleRefinery.id)}" data-quantity-input="${escapeHtml(inputId)}" data-per-cycle="${perCycle}" data-input="${escapeHtml(input)}" data-available="${inputAvailable}" data-hours="${Number(chain.cycleDurationHours) || 0}">Start Run</button>`
            // AB#825: a chain of several inputs starts from AB#836's form; until then the card says so.
            : multiInput && hasRefinery && !techGated
              ? `<p class="ui-card__meta">This chain takes several inputs. Starting it from this page arrives in a later build.</p>`
            : belowRefineryCap && canBuildRefinery
              ? refineryBuildButtonHtml({ hasRefinery, used: buildings.length, slots: buildingSlots })
              : !hasRefinery && !canBuildRefinery
                // ISP-292 (AB#1761): a requirement not yet met, not a warning — the muted token, not amber.
                ? `<p class="ui-card__meta">Refinery construction requires: Material Compression I and Nano-Lattice Weaving research.</p>`
                : hasRefinery && !idleRefinery
                  ? `<p class="ui-card__meta"><span class="ui-badge ui-badge--warn">All refineries busy</span></p>`
                  : ""
          }
        </section>
      `;
    })
    .join("");

  // ── Event delegation for start/build ──
  // Track quantity edits so re-renders (every few seconds) don't blow them away.
  chainsEl.oninput = (e) => {
    const qty = e.target.closest(".refinery__quantity");
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
    const startBtn = e.target.closest(".refinery__start");
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
        const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
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
        showActionReceipt(account, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
      } catch (error) {
        startBtn.disabled = false;
        startBtn.textContent = "Start Run";
        appState.refineQuantityErrors[chainId] = error.message;
        pushFeedback(`Refinery error: ${error.message}`, "warn");
        updateAllViews();
      }
      return;
    }

    const buildBtn = e.target.closest(".refinery__build");
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
      const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
      let receiptAnswer = null; // AB#744: the server's answer; none when built offline, so no receipt
      try {
        if (appState.accountId) {
          const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/build-refinery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          const account = await parseJsonResponse(response);
          receiptAnswer = account;
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
        showActionReceipt(receiptAnswer, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
        pushFeedback("Refinery commissioned.", "ok");
      } catch (error) {
        appState.refineryStatus = { type: "warn", text: error.message };
        updateAllViews();
        pushFeedback(`Build error: ${error.message}`, "warn");
      }
    }
  };
}
