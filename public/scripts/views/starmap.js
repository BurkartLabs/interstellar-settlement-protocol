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
import { isDominanceOverlay } from "../dominanceOverlay.js"; // ISP-218 (AB#913)

export const starmap = createStarmapController({
  canvas: document.getElementById("starmap-canvas"),
  fallbackEl: document.getElementById("starmap-fallback"),
  detailsEl: document.getElementById("map-details"),
  overlaySelect: document.getElementById("map-overlay"),
  resourceSelect: document.getElementById("map-resource"), // ISP-143 (AB#837)
  resourceLegend: document.getElementById("starmap-resource-legend"),
  dominanceLegend: document.getElementById("starmap-dominance-legend"), // ISP-218 (AB#913)
  onOverlayChange(overlay) { if (isDominanceOverlay(overlay)) loadDominanceIntoStarmap(); }, // ISP-218 (AB#913)
  resetButton: document.getElementById("map-reset"),
  researchCatalog: techTree, // Bug #1270: the lock names the research a jump needs
  getCorpLevel: () => appState.data?.corp?.level || 0,
  getMemberStation: () => appState.conglomerate?.station || null, // ISP-212 (AB#907)
  getSystemsCatalog: () => appState.systemsCatalog, // ISP-112 (AB#804)
  getNavigation: () => appState.navigation,
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
      return { ok: true };
    } catch (err) {
      pushFeedback(err.message || "Docking request failed.", "warn");
      // Bug #4651: the feedback list is on the Overview; the map shows the reason where the order was given
      return { error: err.message || "Docking request failed." };
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
      starmap.setBeltNotice(null);
      updateAllViews();
      showActionReceipt(account, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
      pushFeedback(beltScoutedText(beltKey, appState.data?.world?.systems), "ok"); // AB#1257: names, not "sol:belt"
    } catch (err) {
      // Bug #2339: the refusal beside the button that met it, as well as in the Overview's Command Feedback.
      starmap.setBeltNotice({ beltKey, message: err.message || "Belt scouting failed." });
      pushFeedback(err.message || "Belt scouting failed.", "warn");
      loadBeltCompositionsIntoStarmap(); // AB#2331: a refusal may mean the belt is gone; show what is there
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
      starmap.setBeltNotice(null);
      updateAllViews();
      showActionReceipt(account, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
      pushFeedback("Mining expedition launched!", "ok");
    } catch (err) {
      starmap.setBeltNotice({ beltKey, message: err.message || "Expedition launch failed." }); // Bug #2339
      pushFeedback(err.message || "Expedition launch failed.", "warn");
      loadBeltCompositionsIntoStarmap(); // AB#2331
    }
  }
});

/** The scouted belts' compositions, and (AB#2331) every slot as this account may see it: whether a belt is there, its
 * generation and next draw, and for a belt scouted in this generation its rarity and reserve (docs/design/belts.md). */
export async function refreshBeltCompositions() {
  if (!appState.accountId) return;
  try {
    const res = await apiFetch(
      `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/belt-compositions`
    );
    const data = await parseJsonResponse(res);
    appState.beltCompositions = data.compositions || {};
    appState.belts = data.belts || {};
    appState.beltRespawnChance = data.respawnChancePerHour ?? null;
  } catch (_) { /* silent */ }
}

/** Bug #1264: fetch the revealed compositions and hand them to the Starmap when they land (it redraws an open belt
 * panel). Called on every entry into the game (enterGame: log in, register, restore after a reload) and on refresh;
 * before, a reload never fetched them, so a scouted belt showed neither its composition nor a Scout button. */
export function loadBeltCompositionsIntoStarmap() {
  return refreshBeltCompositions().then(() => starmap.setAsteroidMining(starmapMiningState(appState.data, appState.beltCompositions,
    { belts: appState.belts, respawnChancePerHour: appState.beltRespawnChance })));
}

/**
 * ISP-218 (AB#913): the dominance reading (GET /api/starmap/dominance, ISP-217), handed to the Starmap with the viewer's
 * own corporation and conglomerate, which the map marks. Read when a dominance overlay is chosen; it changes once a day.
 */
export async function loadDominanceIntoStarmap() {
  try {
    const reading = await parseJsonResponse(await apiFetch("/api/starmap/dominance"));
    starmap.setDominance(reading, { corporation: appState.data?.corp?.corporationName || "", conglomerate: appState.conglomerate?.name || "" });
  } catch (err) {
    pushFeedback(err.message || "The dominance reading could not be loaded.", "warn");
  }
}
