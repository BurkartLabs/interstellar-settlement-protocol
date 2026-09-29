// The Starmap tab: the map controller, and the belt compositions it shows.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { showActionReceipt } from "./receiptModal.js"; // AB#744
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { starmapMiningState } from "../beltCompositions.js";
import { deepClone } from "../helpers.js";
import { clientPrices } from "../clientPrices.js"; // Bug #4775
import { beltScoutedText } from "../miningFeedback.js";
import { createStarmapController } from "../starmap.js";
import { appState, techTree } from "../state.js";
import { pushFeedback, setTab, showTradeConfirmation, updateAllViews } from "./shared.js";
import { isDominanceOverlay } from "../dominanceOverlay.js"; // ISP-218 (AB#913)
import { CONCESSION_OVERLAY } from "../concessionOverlay.js"; // ISP-229 (AB#924)

export const starmap = createStarmapController({
  canvas: document.getElementById("starmap-canvas"),
  fallbackEl: document.getElementById("starmap-fallback"),
  detailsEl: document.getElementById("map-details"),
  overlaySelect: document.getElementById("map-overlay"),
  resourceSelect: document.getElementById("map-resource"), // ISP-143 (AB#837)
  resourceLegend: document.getElementById("starmap-resource-legend"),
  dominanceLegend: document.getElementById("starmap-dominance-legend"), // ISP-218 (AB#913)
  onOverlayChange(overlay) { if (isDominanceOverlay(overlay)) loadDominanceIntoStarmap(); if (overlay === CONCESSION_OVERLAY) loadConcessionsIntoStarmap(); }, // ISP-218 (AB#913), ISP-229 (AB#924)
  onSystemShown(systemId) { loadSystemConcession(systemId); }, // ISP-229 (AB#924)
  onConcessionAction(action, systemId, data) { concessionAction(action, systemId, data); }, // ISP-229 (AB#924)
  resetButton: document.getElementById("map-reset"),
  researchCatalog: techTree, // Bug #1270: the lock names the research a jump needs
  getCorpLevel: () => appState.data?.corp?.level || 0,
  getExpeditionLaunchCost: () => clientPrices(appState.economy).expeditionLaunchCost, // Bug #4775
  getMemberStation: () => appState.conglomerate?.station || null, // ISP-212 (AB#907)
  getSystemsCatalog: () => appState.systemsCatalog, // ISP-112 (AB#804)
  getNavigation: () => appState.navigation,
  // ISP-231 (AB#926): a holder files its system's tariff; the summary is read again so the panel shows the new schedule
  async onFileTariff(systemId, pct) {
    try {
      await parseJsonResponse(await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/tariffs/${encodeURIComponent(systemId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pct })
      }));
      await loadTariffs();
      const name = (appState.systemsCatalog || []).find((s) => s.id === systemId)?.name || systemId;
      pushFeedback(`Tariff filed for ${name}.`, "success");
      return null;
    } catch (err) {
      return err.message || "The tariff could not be filed.";
    }
  },
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
      // Bug #2339: the refusal beside the button that met it, as well as in the Overview's Command Log.
      starmap.setBeltNotice({ beltKey, message: err.message || "Belt scouting failed." });
      pushFeedback(err.message || "Belt scouting failed.", "warn");
      loadBeltCompositionsIntoStarmap(); // AB#2331: a refusal may mean the belt is gone; show what is there
    }
  },
  /** AB#821: the launch panel's Rats figures and escorts, the server's (docs/design/rats.md, section 7). */
  async onExpeditionOutlook(beltKey, duration) {
    if (!appState.accountId) return;
    try {
      const query = new URLSearchParams({ beltKey, duration });
      starmap.setExpeditionOutlook(await parseJsonResponse(await apiFetch(
        `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/expedition-outlook?${query}`)));
    } catch (_) { /* the panel keeps saying it is reading them; the launch route still decides */ }
  },
  async onLaunchExpedition(beltKey, duration, escort = {}) {
    if (!appState.accountId) return;
    try {
      const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
      const response = await apiFetch(
        `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/launch-expedition`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beltKey, duration, ...escort }) } // AB#821: escortFleetId or escortContractId
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
    appState.remoteDispatchYieldPct = data.remoteDispatchYieldPct ?? null; // Bug #4656
  } catch (_) { /* silent */ }
}

/** Bug #1264: fetch the revealed compositions and hand them to the Starmap when they land (it redraws an open belt
 * panel). Called on every entry into the game (enterGame: log in, register, restore after a reload) and on refresh;
 * before, a reload never fetched them, so a scouted belt showed neither its composition nor a Scout button. */
export function loadBeltCompositionsIntoStarmap() {
  return refreshBeltCompositions().then(() => starmap.setAsteroidMining(starmapMiningState(appState.data, appState.beltCompositions,
    { belts: appState.belts, respawnChancePerHour: appState.beltRespawnChance, remoteDispatchYieldPct: appState.remoteDispatchYieldPct })));
}

/**
 * ISP-231 (AB#926): the caller's tariff summary: the rate it pays where it is docked (the sell confirmations and the
 * Logistics quotes read it from appState.tariffs), every held system's rate for the starmap, and its own holdings.
 * Read on entry and on every refresh, like the belt compositions; the Logistics view is drawn again when it lands.
 */
export async function loadTariffs() {
  if (!appState.accountId) return;
  try {
    appState.tariffs = await parseJsonResponse(await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/tariffs`));
    starmap.setTariffs(appState.tariffs);
    if (appState.data) updateAllViews(); // the Logistics quotes name the tariff
  } catch (_) { /* silent: the server's settlement and receipt still state the tariff */ }
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
// ─── ISP-229 (AB#924): ISA concessions on the Starmap ──────────────────────────────────────────────────────────────

const ownNames = () => ({ corporation: appState.data?.corp?.corporationName || "", conglomerate: appState.conglomerate?.name || "" });

/** Every system's concession holders and open petitions (public), for the overlay and each system's panel. */
export async function loadConcessionsIntoStarmap() {
  try {
    starmap.setConcessions(await parseJsonResponse(await apiFetch("/api/starmap/concessions")), ownNames());
    concessionsRead = true;
  } catch (err) {
    pushFeedback(err.message || "The ISA's concession register could not be read.", "warn");
  }
}

// One read of a system's control and the viewer's status at a time, and not again for a minute: the panel redraws often.
const systemReads = new Map();
async function loadSystemConcession(systemId, { force = false } = {}) {
  const last = systemReads.get(systemId);
  if (!force && last && (last.pending || Date.now() - last.at < 60_000)) return;
  systemReads.set(systemId, { pending: true, at: Date.now() });
  try {
    if (!starmapConcessionsLoaded()) await loadConcessionsIntoStarmap();
    const [control, status] = await Promise.all([
      parseJsonResponse(await apiFetch(`/api/systems/${encodeURIComponent(systemId)}/control`)),
      appState.accountId ? parseJsonResponse(await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/concessions/${encodeURIComponent(systemId)}`)) : null
    ]);
    starmap.setSystemConcession(systemId, { control, status });
  } catch (_) { /* the panel keeps saying it is reading */ }
  systemReads.set(systemId, { pending: false, at: Date.now() });
}
let concessionsRead = false;
const starmapConcessionsLoaded = () => concessionsRead;

const cr = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");
const concessionUrl = (systemId, what) => `/api/accounts/${encodeURIComponent(appState.accountId)}/concessions/${encodeURIComponent(systemId)}/${what}`;

/** Petition, set the lease discount or relinquish: the ISP-19 confirmation with what it costs, then the request. */
async function concessionAction(action, systemId, data) {
  if (!appState.accountId) return;
  const system = (appState.systemsCatalog || []).find((s) => s.id === systemId);
  const name = system?.name || systemId;
  let confirm, body = {}, path;
  if (action === "petition") {
    const verb = data.kind === "challenge" ? "Challenge" : "Petition";
    confirm = {
      heading: "ISA Claims & Leases", title: `${verb} for ${name}'s concession?`, confirmLabel: `Pay ${cr(data.fee)} credits`,
      rows: [
        { label: "Fee", value: `${cr(data.fee)} credits, kept whatever the ISA decides` },
        { label: "Review", value: "72 hours, in public; a rival may counter-petition" },
        { label: "Upkeep if granted", value: `about ${cr(data.upkeep)} credits a day (${data.after} concession${Number(data.after) === 1 ? "" : "s"} held, each dearer than the last)` },
        { label: "Grants", value: "a share of the ISA's lease fees here, and 25% off your own leases" }
      ]
    };
    path = concessionUrl(systemId, "petition");
  } else if (action === "discount") {
    confirm = {
      heading: "ISA Claims & Leases", title: `Discount everyone's new leases in ${name} by ${data.discountPct}%?`, confirmLabel: "Set the discount",
      rows: [{ label: "Applies", value: "after 72 hours' notice; no other change until then" }, { label: "Your fee share", value: "is taken on the discounted fee" }]
    };
    body = { discountPct: data.discountPct };
    path = concessionUrl(systemId, "lease-modifier");
  } else if (action === "relinquish") {
    confirm = {
      heading: "ISA Claims & Leases", title: `Give up ${name}'s concession?`, confirmLabel: "Relinquish",
      rows: [{ label: "Ends", value: "now: the fee share and the lease discounts stop" }, { label: "Kept", value: "every lease, building and good; nothing else changes" }, { label: "Then", value: "no new petition here for 7 days" }]
    };
    path = concessionUrl(systemId, "relinquish");
  } else return;
  if (!(await showTradeConfirmation(confirm))) return;
  try {
    await parseJsonResponse(await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    pushFeedback(action === "petition" ? "Petition filed with the ISA." : action === "discount" ? "Lease discount set; it applies after the notice." : "Concession relinquished.", "ok");
  } catch (err) {
    const line = document.querySelector('#map-details [data-role="concession-status"]');
    if (line) line.textContent = err.message || "The ISA refused that.";
    pushFeedback(err.message || "The ISA refused that.", "warn");
  }
  await loadConcessionsIntoStarmap();
  await loadSystemConcession(systemId, { force: true });
}
