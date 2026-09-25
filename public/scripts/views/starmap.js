// The Starmap tab: the map controller, and the belt compositions it shows.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { showActionReceipt } from "./receiptModal.js"; // AB#744
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { starmapMiningState } from "../beltCompositions.js";
import { deepClone } from "../helpers.js";
import { beltScoutedText } from "../miningFeedback.js";
import { createStarmapController } from "../starmap.js";
import { appState, techTree } from "../state.js";
import { pushFeedback, setTab, updateAllViews } from "./shared.js";

export const starmap = createStarmapController({
  canvas: document.getElementById("starmap-canvas"),
  fallbackEl: document.getElementById("starmap-fallback"),
  detailsEl: document.getElementById("map-details"),
  overlaySelect: document.getElementById("map-overlay"),
  resetButton: document.getElementById("map-reset"),
  researchCatalog: techTree, // Bug #1270: the lock names the research a jump needs
  getCorpLevel: () => appState.data?.corp?.level || 0,
  async onTravelToSystem(systemId) {
    if (!appState.accountId) return;
    try {
      const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
      const response = await apiFetch(
        `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/travel`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toSystemId: systemId }) }
      );
      const account = await parseJsonResponse(response);
      appState.data = deepClone(account.state);
      appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
      updateAllViews();
      showActionReceipt(account, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
      setTab("travel");
    } catch (err) {
      pushFeedback(err.message || "Interstellar travel request failed.", "warn");
    }
  },
  async onDockAtStation(stationId) {
    if (!appState.accountId) return;
    try {
      const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
      const response = await apiFetch(
        `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/travel`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toStationId: stationId }) }
      );
      const account = await parseJsonResponse(response);
      appState.data = deepClone(account.state);
      appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
      updateAllViews();
      showActionReceipt(account, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
      setTab("travel");
    } catch (err) {
      pushFeedback(err.message || "Docking request failed.", "warn");
    }
  },
  async onScoutBelt(systemId, bodyId, beltKey) {
    if (!appState.accountId) return;
    try {
      const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
      const response = await apiFetch(
        `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/scout-belt`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beltKey }) }
      );
      const account = await parseJsonResponse(response);
      appState.data = deepClone(account.state);
      await refreshBeltCompositions();
      updateAllViews();
      showActionReceipt(account, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
      pushFeedback(beltScoutedText(beltKey, appState.data?.world?.systems), "ok"); // AB#1257: names, not "sol:belt"
    } catch (err) {
      pushFeedback(err.message || "Belt scouting failed.", "warn");
    }
  },
  async onLaunchExpedition(beltKey, duration) {
    if (!appState.accountId) return;
    try {
      const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
      const response = await apiFetch(
        `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/launch-expedition`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beltKey, duration }) }
      );
      const account = await parseJsonResponse(response);
      appState.data = deepClone(account.state);
      updateAllViews();
      showActionReceipt(account, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
      pushFeedback("Mining expedition launched!", "ok");
    } catch (err) {
      pushFeedback(err.message || "Expedition launch failed.", "warn");
    }
  }
});

// TODO(AB#1050): Ensure this function is updated when we make asteroid belts dynamic
export async function refreshBeltCompositions() {
  if (!appState.accountId) return;
  try {
    const res = await apiFetch(
      `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/belt-compositions`
    );
    const data = await parseJsonResponse(res);
    appState.beltCompositions = data.compositions || {};
  } catch (_) { /* silent */ }
}

/** Bug #1264: fetch the revealed compositions and hand them to the Starmap when they land (it redraws an open belt
 * panel). Called on every entry into the game (enterGame: log in, register, restore after a reload) and on refresh;
 * before, a reload never fetched them, so a scouted belt showed neither its composition nor a Scout button. */
export function loadBeltCompositionsIntoStarmap() {
  return refreshBeltCompositions().then(() => starmap.setAsteroidMining(starmapMiningState(appState.data, appState.beltCompositions)));
}
