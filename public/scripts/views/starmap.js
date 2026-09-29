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
import { pushFeedback, refreshFromServer, setTab, showTradeConfirmation, updateAllViews } from "./shared.js";
import { refusalMeaning } from "../protocol.js"; // ISP-254 Bd (AB#4819)
import { isDominanceOverlay } from "../dominanceOverlay.js"; // ISP-218 (AB#913)
import { CONCESSION_OVERLAY } from "../concessionOverlay.js"; // ISP-229 (AB#924)
import { RATS_OVERLAY } from "../ratsOverlay.js"; // ISP-285 (AB#992)

export const starmap = createStarmapController({
  canvas: document.getElementById("starmap-canvas"),
  fallbackEl: document.getElementById("starmap-fallback"),
  detailsEl: document.getElementById("map-details"),
  overlaySelect: document.getElementById("map-overlay"),
  resourceSelect: document.getElementById("map-resource"), // ISP-143 (AB#837)
  resourceLegend: document.getElementById("starmap-resource-legend"),
  dominanceLegend: document.getElementById("starmap-dominance-legend"), // ISP-218 (AB#913)
  onOverlayChange(overlay) { if (isDominanceOverlay(overlay)) loadDominanceIntoStarmap(); if (overlay === CONCESSION_OVERLAY) loadConcessionsIntoStarmap(); if (overlay === RATS_OVERLAY) loadRatsActivity(); }, // ISP-218 (AB#913), ISP-229 (AB#924), ISP-285 (AB#992)
  onSystemShown(systemId) { loadSystemConcession(systemId); loadRatsActivity(); }, // ISP-229 (AB#924); ISP-285 (AB#992): the panel's pirate activity
  onHuntOpen(beltKey) { loadHuntPreview(beltKey); }, // ISP-285 (AB#992)
  onHuntSend(beltKey, fleetId) { sendHunt(beltKey, fleetId); }, // ISP-285 (AB#992)
  getMilitary: () => appState.data?.corp?.military || null, // ISP-285 (AB#992)
  getUnitCatalog: () => appState.units || [], // ISP-285 (AB#992)
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
      pushFeedback(`Tariff filed for ${name}.`, "success", { meaning: "active", screen: "starmap" }); // ISP-255 (AB#951)
      return null;
    } catch (err) {
      return { message: err.message || "The tariff could not be filed.", code: err.code }; // its code: Unfunded or Denied
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
      pushFeedback(beltScoutedText(beltKey, appState.data?.world?.systems), "ok", { meaning: "complete", screen: "starmap" }); // AB#1257; ISP-254 Bd (AB#4819)
    } catch (err) {
      // Bug #2339: the refusal beside the button that met it, as well as in the Overview's Command Log.
      const denied = { meaning: refusalMeaning(err), screen: "starmap" }; // ISP-254 Bd (AB#4819)
      starmap.setBeltNotice({ beltKey, message: err.message || "Belt scouting failed.", protocol: denied });
      pushFeedback(err.message || "Belt scouting failed.", "warn", denied);
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
      pushFeedback("Mining expedition launched!", "ok", { meaning: "active", screen: "starmap" }); // ISP-254 Bd (AB#4819)
    } catch (err) {
      const denied = { meaning: refusalMeaning(err), screen: "starmap" }; // ISP-254 Bd (AB#4819)
      starmap.setBeltNotice({ beltKey, message: err.message || "Expedition launch failed.", protocol: denied }); // Bug #2339
      pushFeedback(err.message || "Expedition launch failed.", "warn", denied);
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
// ─── ISP-285 (AB#992): Rats on the Starmap, and hunting them ────────────────────────────────────────────────────────

const account = () => `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay`;
/** Every system's pirate activity as the server has it now, for the overlay and the panels. */
export async function loadRatsActivity() {
  if (!appState.accountId) return;
  try {
    starmap.setRatsActivity(await parseJsonResponse(await apiFetch(`${account()}/rats/activity`)));
  } catch (err) {
    pushFeedback(err.message || "The Rats' activity could not be read.", "warn");
  }
}
/** Send the chosen fleet; when the hunt is due, read the account and the activity again, for its report and the quiet belt. */
async function sendHunt(beltKey, fleetId) {
  try {
    const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
    const response = await apiFetch(`${account()}/fleets/${encodeURIComponent(fleetId)}/hunt`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ beltKey })
    });
    const answer = await parseJsonResponse(response);
    appState.data = deepClone(answer.state);
    starmap.setHuntPreview(beltKey, null);
    starmap.setBeltNotice(null);
    updateAllViews();
    showActionReceipt(answer, { returnFocusTo: receiptTrigger });
    const wait = Math.max(0, Number(answer.hunt?.endsAt) - Date.now()) + 6_000; // the server's hunt ticker runs every 5 s
    setTimeout(async () => { await refreshFromServer(); loadRatsActivity(); starmap.rerender(); }, wait);
  } catch (err) {
    starmap.setBeltNotice({ beltKey, message: err.message || "The hunt could not be sent.", protocol: { meaning: refusalMeaning(err), screen: "starmap" } }); // ISP-255d (AB#4826)
    loadHuntPreview(beltKey);
  }
}

/** A belt's hunt screen: the fleets that can hunt it now, and the battle the resolver expects for each. */
async function loadHuntPreview(beltKey) {
  try {
    starmap.setHuntPreview(beltKey, await parseJsonResponse(await apiFetch(`${account()}/belts/${encodeURIComponent(beltKey)}/hunt`)));
  } catch (err) {
    starmap.setHuntPreview(beltKey, null);
    starmap.setBeltNotice({ beltKey, message: err.message || "The hunt screen could not be read.", protocol: { meaning: "failed", screen: "starmap" } }); // ISP-255d (AB#4826)
  }
}
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
