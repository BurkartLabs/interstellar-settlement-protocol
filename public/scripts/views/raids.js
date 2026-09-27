// ISP-181 (AB#875): the raid screens. The Overview and the Fleet tab show an incoming raid with a countdown and a
// one-click route to that station's garrison; the Fleet tab's Raids section has the garrison panels (posture and
// reinforcements), the target picker, the caller's raids, and the private battle report. The markup is raidView.js;
// every rule is the server's, and every order is drawn again from its answer.
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { deepClone } from "../helpers.js";
import { battleReportHtml, countdown, garrisonPanelHtml, incomingAlertHtml, outgoingRaidsHtml, targetPickerHtml } from "../raidView.js";
import { unitsText } from "../fleetView.js";
import { appState } from "../state.js";
import { pushFeedback, setTab, showTradeConfirmation, updateAllViews } from "./shared.js";
import { codeSlotHtml } from "../sectionCodes.js"; // ISP-250 (AB#946): the drawn sections' document codes

const raids = { accountId: null, data: null, at: 0, loading: false, targets: {}, pick: { fleetId: "", stationId: "" }, report: null };
const REFRESH_MS = 15_000;
const stationName = (id) => (appState.stationRegistry || []).find((s) => s.id === id)?.name || "a station";
const accountPath = (rest) => `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay${rest}`;
const get = async (path) => parseJsonResponse(await apiFetch(accountPath(path)));
const post = async (path, body) => parseJsonResponse(await apiFetch(accountPath(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }));
let clock = null;

/** Stations the corporation has something at: a garrison, goods, a fleet, troops on the way, or an incoming raid. */
function heldStations(corp, incoming) {
  const ids = new Set(incoming.map((r) => r.targetStationId));
  for (const [id, q] of Object.entries(corp?.military?.garrisons || {})) if (Number(q) > 0) ids.add(id);
  for (const [id, stock] of Object.entries(corp?.inventory || {})) if (Object.values(stock || {}).some((q) => Number(q) > 0)) ids.add(id);
  for (const f of corp?.military?.fleets || []) if (f.stationId) ids.add(f.stationId);
  for (const m of corp?.garrisonMoves || []) ids.add(m.toStationId);
  return [...ids].filter((id) => (appState.stationRegistry || []).some((s) => s.id === id));
}

async function load(force = false) {
  if (raids.accountId !== appState.accountId) Object.assign(raids, { accountId: appState.accountId, data: null, targets: {}, report: null, pick: { fleetId: "", stationId: "" } });
  if (raids.loading || (!force && raids.data && Date.now() - raids.at < REFRESH_MS)) return;
  raids.loading = true;
  try {
    raids.data = await get("/raids");
    raids.at = Date.now();
  } catch { /* the next render tries again */ } finally {
    raids.loading = false;
  }
  draw(appState.data);
}

async function loadTargets(stationId) {
  if (!stationId) return;
  try { raids.targets[stationId] = await get(`/raids/targets/${encodeURIComponent(stationId)}`); } catch (e) { raids.targets[stationId] = { stationId, you: [{ text: e?.message || "Could not read the targets." }], targets: [] }; }
  draw(appState.data);
}

function draw(data) {
  const corp = data?.corp || {};
  const catalog = appState.units || [];
  const now = Date.now();
  const incoming = raids.data?.incoming || [];
  const alert = incomingAlertHtml(incoming, { now, stationName, catalog, compact: true });
  const overview = document.getElementById("overview-raid-alert");
  if (overview) overview.innerHTML = alert;
  const fleetAlert = document.getElementById("fleet-raid-alert");
  if (fleetAlert) fleetAlert.innerHTML = incomingAlertHtml(incoming, { now, stationName, catalog });
  const root = document.getElementById("fleet-raids");
  if (!root) return;
  const fleets = corp.military?.fleets || [];
  const ready = fleets.filter((f) => f.stationId && !f.transit && !f.contract);
  if (!ready.some((f) => f.id === raids.pick.fleetId)) raids.pick.fleetId = ready[0]?.id || "";
  if (!raids.pick.stationId) raids.pick.stationId = ready.find((f) => f.id === raids.pick.fleetId)?.stationId || "";
  const stations = (appState.stationRegistry || []).map((s) => s.id);
  const list = raids.targets[raids.pick.stationId] || null;
  const report = raids.report ? (corp.raidReports || []).find((r) => r.raidId === raids.report) : null;
  root.innerHTML = `
    <section class="ui-stack" aria-labelledby="raid-garrisons-title">
      <h4 id="raid-garrisons-title" class="raid-heading">${codeSlotHtml("raid-garrisons")}Garrisons</h4>
      <div class="ui-grid station__grid">${garrisonPanelHtml(corp, heldStations(corp, incoming), { stationName, now, incoming })}</div>
    </section>
    <section class="ui-stack" aria-labelledby="raid-picker-title">
      <h4 id="raid-picker-title" class="raid-heading">${codeSlotHtml("raid-picker")}Raid a corporation</h4>
      ${targetPickerHtml({ fleets, stationId: raids.pick.stationId, stations, list, stationName, catalog })}
    </section>
    <section class="ui-stack" aria-labelledby="raid-mine-title">
      <h4 id="raid-mine-title" class="raid-heading">${codeSlotHtml("raid-mine")}Your raids and reports</h4>
      ${outgoingRaidsHtml(raids.data?.outgoing || [], { now, stationName, reports: corp.raidReports || [] })}
      ${(corp.raidReports || []).filter((r) => r.side === "defender").slice(0, 5).map((r) => `<p class="raid-list__item"><span>Raided by ${r.attacker.name ?? "a corporation"} at ${r.station}</span> <button type="button" class="ui-button ui-button--secondary" data-raid-report="${r.raidId}">Report</button></p>`).join("")}
      ${report ? battleReportHtml(report, { catalog }) : ""}
    </section>`;
  const picker = root.querySelector("[data-raid-picker]");
  if (picker) picker.fleetId.value = raids.pick.fleetId;
  if (raids.pick.stationId && !raids.targets[raids.pick.stationId]) { raids.targets[raids.pick.stationId] = null; loadTargets(raids.pick.stationId); }
}

function status(el, text) { const s = el?.closest("[data-garrison], .ui-stack")?.querySelector("[role=status]"); if (s) s.textContent = text; }
function redraw(account) { if (account?.state) appState.data = deepClone(account.state); updateAllViews(); }

async function onClick(event) {
  const b = event.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.raidDefend) {
      setTab("fleet");
      const panel = document.getElementById(`garrison-${b.dataset.raidDefend}`);
      panel?.scrollIntoView({ block: "center" });
      panel?.querySelector("input[type=radio]:checked")?.focus();
    } else if (b.dataset.setPosture) {
      const id = b.dataset.setPosture;
      const posture = document.querySelector(`input[name="posture-${CSS.escape(id)}"]:checked`)?.value;
      b.disabled = true;
      await post(`/garrisons/${encodeURIComponent(id)}/posture`, { posture });
      appState.data.corp.garrisonPostures = { ...(appState.data.corp.garrisonPostures || {}), [id]: posture };
      pushFeedback(`${stationName(id)} now defends ${posture}.`, "ok");
      updateAllViews();
    } else if (b.dataset.raidTarget) {
      const target = raids.targets[raids.pick.stationId]?.targets.find((t) => t.corpId === b.dataset.raidTarget);
      const fleet = (appState.data.corp.military?.fleets || []).find((f) => f.id === raids.pick.fleetId);
      const ok = await showTradeConfirmation({
        heading: "Declare a raid", title: `Raid ${target?.name ?? "this corporation"} at ${stationName(raids.pick.stationId)}?`, confirmLabel: "Declare raid",
        rows: [
          { label: "Fleet", value: `${fleet?.name ?? "Your fleet"}: ${unitsText(fleet?.units, appState.units || [])}` },
          { label: "Arrives", value: "in at least 4 hours; the defender is told now, and sees what you send" },
          { label: "It takes", value: "on a win, up to 20% of their goods above 10,000 credits' worth, as much as your survivors can carry" }
        ]
      });
      if (!ok) return;
      b.disabled = true;
      await post("/raids", { fleetId: raids.pick.fleetId, targetCorpId: b.dataset.raidTarget, targetStationId: raids.pick.stationId });
      pushFeedback(`Raid declared on ${target?.name ?? "the corporation"}.`, "ok");
      raids.targets = {};
      await refreshAccount();
      await load(true);
    } else if (b.dataset.raidRecall) {
      b.disabled = true;
      await post(`/raids/${encodeURIComponent(b.dataset.raidRecall)}/recall`, {});
      await refreshAccount();
      await load(true);
    } else if (b.dataset.raidReport) {
      raids.report = raids.report === b.dataset.raidReport ? null : b.dataset.raidReport;
      draw(appState.data);
      document.querySelector("[data-raid-report-view]")?.scrollIntoView({ block: "start" });
    }
  } catch (error) {
    b.disabled = false;
    status(b, error?.message || "That was refused.");
    pushFeedback(error?.message || "That was refused.", "error");
  }
}

async function onSubmit(event) {
  const form = event.target;
  if (form.matches("[data-reinforce]")) {
    event.preventDefault();
    try {
      await post("/garrisons/move", { fromStationId: form.from.value, toStationId: form.dataset.reinforce, quantity: Number(form.quantity.value) });
      pushFeedback(`${form.quantity.value} defense troops are on their way to ${stationName(form.dataset.reinforce)}.`, "ok");
      await refreshAccount();
    } catch (error) { status(form, error?.message || "The troops could not be sent."); }
  }
}

function onChange(event) {
  const picker = event.target.closest("[data-raid-picker]");
  if (!picker) return;
  raids.pick.fleetId = picker.fleetId.value;
  if (event.target.name === "fleetId") raids.pick.stationId = (appState.data.corp.military?.fleets || []).find((f) => f.id === picker.fleetId.value)?.stationId || raids.pick.stationId;
  else raids.pick.stationId = picker.stationId.value;
  draw(appState.data);
}

async function refreshAccount() {
  try { redraw(await parseJsonResponse(await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}`))); } catch { /* the view redraws on its next tick */ }
}

let bound = false;
/** Draw the raid screens from the account and the latest raid list; fetch the list when it is stale. */
export function renderRaids(data) {
  draw(data);
  load();
  if (!bound) {
    bound = true;
    for (const id of ["fleet-raids", "fleet-raid-alert", "overview-raid-alert"]) {
      const el = document.getElementById(id);
      el?.addEventListener("click", onClick);
      el?.addEventListener("submit", onSubmit);
      el?.addEventListener("change", onChange);
    }
  }
  if (!clock) clock = setInterval(() => {
    for (const el of document.querySelectorAll("[data-raid-countdown]")) el.textContent = countdown(Number(el.dataset.raidCountdown), Date.now());
    if (Date.now() - raids.at > REFRESH_MS) load();
  }, 15_000);
}
